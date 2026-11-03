/* ===========================================================================
   xlsx.js — minimal .xlsx reader (Node standard library only)
   ---------------------------------------------------------------------------
   An .xlsx is a ZIP of XML files. This reads the ZIP central directory,
   inflates the three parts that matter, and returns the strategic matrix.

   It exists so the algorithm used by tools/serve.ps1 can be run and tested:
   the two implementations follow the same steps in the same order. If one is
   changed, change the other.

   Not a general-purpose spreadsheet library: it reads text out of cells and
   nothing else. Formats, formulas, dates and merged cells are all ignored,
   which is all the strategic matrix needs.
   =========================================================================== */

const fs = require('fs');
const zlib = require('zlib');

/* ---- ZIP ---------------------------------------------------------------- */

/** Read every entry of a ZIP into a Map of name -> Buffer. */
function readZip(buf) {
  // The central directory is at the end, behind a variable-length comment, so
  // the End Of Central Directory record is found by scanning backwards.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('To nie jest plik xlsx (brak nagłówka ZIP).');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name and extra field, with its own lengths.
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* ---- XML ---------------------------------------------------------------- */
/* Regex rather than a parser: the shapes read here are fixed by the file
   format, and a dependency-free reader is worth more than generality. */

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

/** Concatenated text of every <t> inside a fragment. */
const innerText = frag =>
  [...frag.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : '';
};

/** "BC12" -> 55. Column letters are base-26 with A = 1. */
function colRef(ref) {
  const letters = ref.replace(/[^A-Za-z]/g, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 55 -> "BC". The inverse of colRef, for naming duplicate columns. */
function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

/* ---- Workbook ----------------------------------------------------------- */

/**
 * Open a workbook: its sheet list and the shared string table.
 * Shared out of readMatrix() so that readValuation() reads the same way.
 */
function openWorkbook(src) {
  // Accepts a path on disk or the raw bytes of the file. The bytes matter for
  // a backend that fetches the workbook from a document library through
  // Microsoft Graph arrives as a response body, and writing it to a temporary
  // file first would add a failure mode for no reason.
  const zip = readZip(Buffer.isBuffer(src) ? src : fs.readFileSync(src));
  const wb = zip.get('xl/workbook.xml');
  if (!wb) throw new Error('To nie jest plik xlsx (brak xl/workbook.xml).');

  const sheets = [...wb.toString('utf8').matchAll(/<sheet\b[^>]*\/?>/g)].map(m => ({
    name: attr(m[0], 'name'),
    rid: attr(m[0], 'r:id') || attr(m[0], 'id'),
  }));
  if (!sheets.length) throw new Error('Skoroszyt nie zawiera arkuszy.');

  // Excel keeps text in a shared table; other tools write it inline. Both work.
  const shared = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(innerText(m[1]));
  }
  return { zip, sheets, shared };
}

/** Rows of one sheet as an array of { columnIndex: text }. */
function sheetRows(bk, sheet) {
  // The sheet's XML file is named in the relationships, not by position.
  let target = 'worksheets/sheet1.xml';
  const rels = bk.zip.get('xl/_rels/workbook.xml.rels');
  if (rels && sheet.rid) {
    for (const m of rels.toString('utf8').matchAll(/<Relationship\b[^>]*\/?>/g)) {
      if (attr(m[0], 'Id') === sheet.rid) { target = attr(m[0], 'Target'); break; }
    }
  }
  target = target.replace(/^\/+/, '');
  if (!target.startsWith('xl/')) target = 'xl/' + target;

  const buf = bk.zip.get(target);
  if (!buf) throw new Error(`Nie mogę odczytać arkusza (${target}).`);

  const rows = [];
  for (const rm of buf.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const tag = cm[1] !== undefined ? cm[1] : cm[3];
      const body = cm[2] !== undefined ? cm[2] : '';
      const ref = attr('<c' + tag + '>', 'r');
      if (!ref) continue;
      const t = attr('<c' + tag + '>', 't');
      let val = '';
      if (t === 's') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        const i = v ? parseInt(decode(v[1]), 10) : -1;
        val = (i >= 0 && i < bk.shared.length) ? bk.shared[i] : '';
      } else if (t === 'inlineStr') {
        val = innerText(body);
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? decode(v[1]) : '';
      }
      cells[colRef(ref)] = String(val).trim();
    }
    rows.push(cells);
  }
  return rows;
}

const KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/i;   // PF-1234, and any other project prefix

/** A spreadsheet number: "1 234,5", "-722", "" -> number or null. */
function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the business-value workbook: per-year EBITDA and the project category
 * that Jira does not carry.
 *
 * Expected layout, as handed over by the data team in Oct 2026:
 *
 *   Issue Type | Key | Summary | Status | EBITDA w 2026 (PLN) |
 *   EBITDA w 2027 (PLN) | EBITDA w 2028 (PLN) | 3-letnia EBITDA | Project Type
 *
 * Every sheet in the workbook is read, and each row remembers which sheet it
 * came from — the handover has one sheet per reporting unit (Northwind Retail,
 * Finance & Legal).
 *
 * Columns are located by what their caption says, not by position, and rows
 * by the column that holds issue keys. The same reasoning as in readMatrix():
 * a workbook maintained by hand gains and loses columns, and a parser keyed to
 * position fails silently, with plausible-looking numbers in the wrong places.
 *
 * @returns {{file, sheets: string[], years: number[], rows: Array, dups: string[]}}
 */
function readValuation(src, opt) {
  const o = opt || {};
  const bk = openWorkbook(src);
  const out = [];
  const seen = new Map();
  const dups = [];
  const years = new Set();
  const sheetsRead = [];
  const problems = [];

  bk.sheets.forEach(sheet => {
    const rows = sheetRows(bk, sheet);
    if (!rows.length) return;

    // The key column holds the most cells shaped like an issue key.
    const hits = {};
    rows.forEach(c => Object.keys(c).forEach(k => {
      if (KEY_RE.test(c[k])) hits[k] = (hits[k] || 0) + 1;
    }));
    const keyCol = Object.keys(hits).sort((a, b) => hits[b] - hits[a])[0];
    if (!keyCol) { problems.push(`arkusz „${sheet.name}” nie ma kolumny z numerem PP`); return; }

    const firstData = rows.findIndex(c => KEY_RE.test(c[keyCol] || ''));

    // Captions: everything above the first data row.
    const cap = {};
    for (let i = 0; i < firstData; i++) {
      for (const k of Object.keys(rows[i])) {
        const v = rows[i][k];
        if (v && !cap[k]) cap[k] = v;
      }
    }

    // Columns by caption. A caption naming a year is that year's EBITDA; one
    // naming a multi-year total is the total; the rest are matched by name.
    const yearCol = {};
    let totalCol = null, typeCol = null, statusCol = null, nameCol = null, kindCol = null;
    for (const k of Object.keys(cap)) {
      const c = cap[k].toLowerCase();
      const y = c.match(/(20\d\d)/);
      if (/ebitda/.test(c) && y)                 { yearCol[+y[1]] = +k; years.add(+y[1]); }
      else if (/ebitda/.test(c))                 totalCol  = +k;
      else if (/project\s*type|typ\s*projektu|kategoria/.test(c)) typeCol = +k;
      else if (/status/.test(c))                 statusCol = +k;
      else if (/summary|nazwa|opis/.test(c))     nameCol   = +k;
      else if (/issue\s*type|rodzaj/.test(c))    kindCol   = +k;
    }
    if (!Object.keys(yearCol).length && totalCol === null) {
      problems.push(`arkusz „${sheet.name}” nie ma żadnej kolumny z EBITDA`);
      return;
    }
    sheetsRead.push(sheet.name);

    for (let i = firstData; i < rows.length; i++) {
      const key = (rows[i][keyCol] || '').trim();
      if (!KEY_RE.test(key)) continue;

      const y = {};
      Object.keys(yearCol).forEach(yr => { y[yr] = num(rows[i][yearCol[yr]]); });

      // The total is read from its own column rather than summed: the sheet
      // rounds each year to whole thousands, so the parts need not add up to
      // the published total, and the published total is the number people will
      // quote. Summed only when the column is missing.
      let eb3 = totalCol === null ? null : num(rows[i][totalCol]);
      if (eb3 === null) {
        const vs = Object.values(y).filter(v => v !== null);
        eb3 = vs.length ? vs.reduce((a, b) => a + b, 0) : null;
      }

      if (seen.has(key)) { dups.push(key); continue; }
      seen.set(key, true);

      out.push({
        k: key,
        s: sheet.name,
        y,
        eb3,
        pt: typeCol   === null ? null : (rows[i][typeCol]   || null),
        st: statusCol === null ? null : (rows[i][statusCol] || null),
        n:  nameCol   === null ? null : (rows[i][nameCol]   || null),
        t:  kindCol   === null ? null : (rows[i][kindCol]   || null),
      });
    }
  });

  if (!sheetsRead.length) {
    throw new Error('Nie udało się odczytać żadnego arkusza. ' + problems.join('; ') + '.');
  }

  return {
    // Display name: the workbook is read through a copy in the temp folder,
    // so the copy's own name would mean nothing to anyone.
    file: o.name || (typeof src === 'string' ? src.replace(/^.*[\\/]/, '') : 'workbook'),
    sheets: sheetsRead,
    years: [...years].sort(),
    rows: out,
    dups: [...new Set(dups)],
    problems,
  };
}

/**
 * Read the strategic matrix out of a workbook.
 *
 * @param {string} path     the .xlsx file
 * @param {object} opt      { sheet, skip } — see tools/serve.ps1
 * @returns {{strategic: string[], links: {k,i}[], rows: number, sheet: string,
 *            extras: {n: string, i: string[]}[]}}
 *
 * The key column is found by its CONTENT, not by a header name: it is the
 * column holding the most cells that look like a Jira key (PF-1234). The real
 * workbook has a two-row header with merged cells, a counts row beneath it and
 * no "Nr PF" caption anywhere, and a macro appends rows to two separate blocks,
 * so every row and column position shifts over time. Content is the only thing
 * that stays put.
 */
function readMatrix(src, opt) {
  const sheetWanted = (opt.sheet || '').trim();
  const skip = (opt.skip || []).map(s => s.trim().toLowerCase());
  const KEY = /^[A-Z][A-Z0-9]*-\d+$/i;   // PF-1234, and any other project prefix

  const zip = readZip(Buffer.isBuffer(src) ? src : fs.readFileSync(src));

  const wb = zip.get('xl/workbook.xml');
  if (!wb) throw new Error('To nie jest plik xlsx (brak xl/workbook.xml).');
  const wbText = wb.toString('utf8');

  const sheets = [...wbText.matchAll(/<sheet\b[^>]*\/?>/g)].map(m => ({
    name: attr(m[0], 'name'),
    rid: attr(m[0], 'r:id') || attr(m[0], 'id'),
  }));
  if (!sheets.length) throw new Error('Skoroszyt nie zawiera arkuszy.');

  let chosen = sheets[0];
  if (sheetWanted) {
    chosen = sheets.find(s => s.name.trim().toLowerCase() === sheetWanted.toLowerCase());
    if (!chosen) {
      throw new Error(`Nie ma arkusza "${sheetWanted}". Dostępne: ${sheets.map(s => s.name).join(', ')}.`);
    }
  }

  // The sheet's XML file is named in the relationships, not by position.
  let target = 'worksheets/sheet1.xml';
  const rels = zip.get('xl/_rels/workbook.xml.rels');
  if (rels && chosen.rid) {
    const relsText = rels.toString('utf8');
    for (const m of relsText.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      if (attr(m[0], 'Id') === chosen.rid) { target = attr(m[0], 'Target'); break; }
    }
  }
  target = target.replace(/^\/+/, '');
  if (!target.startsWith('xl/')) target = 'xl/' + target;

  const sheetBuf = zip.get(target);
  if (!sheetBuf) throw new Error(`Nie mogę odczytać arkusza (${target}).`);

  // Shared strings, when the file uses them. Excel does; other tools write the
  // text inline instead, and both have to work.
  const shared = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(innerText(m[1]));
  }

  // Rows as column index -> text.
  const rows = [];
  for (const rm of sheetBuf.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const tag = cm[1] !== undefined ? cm[1] : cm[3];
      const body = cm[2] !== undefined ? cm[2] : '';
      const ref = attr('<c' + tag + '>', 'r');
      if (!ref) continue;
      const t = attr('<c' + tag + '>', 't');
      let val = '';
      if (t === 's') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        const i = v ? parseInt(decode(v[1]), 10) : -1;
        val = (i >= 0 && i < shared.length) ? shared[i] : '';
      } else if (t === 'inlineStr') {
        val = innerText(body);
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? decode(v[1]) : '';
      }
      cells[colRef(ref)] = String(val).trim();
    }
    rows.push(cells);
  }
  if (!rows.length) throw new Error(`Arkusz "${chosen.name}" jest pusty.`);

  // --- the key column, by content ----------------------------------------
  const hits = {};
  rows.forEach(cells => {
    for (const k of Object.keys(cells)) {
      if (KEY.test(cells[k])) hits[k] = (hits[k] || 0) + 1;
    }
  });
  const keyCol = Object.keys(hits).sort((a, b) => hits[b] - hits[a])[0];
  if (!keyCol) {
    throw new Error(`W arkuszu "${chosen.name}" nie znalazłem ani jednej komórki z numerem zgłoszenia (np. PF-1234).`);
  }

  // Data begins at the first row holding a key; everything above is header,
  // including the counts row the workbook keeps between the two.
  const firstData = rows.findIndex(c => KEY.test(c[keyCol] || ''));

  // --- initiative columns -------------------------------------------------
  // A column's caption is the first non-empty, non-numeric text found anywhere
  // in the header rows: the real header spans two rows and merged cells store
  // their text only in the top-left one.
  const caption = {};
  for (let i = 0; i < firstData; i++) {
    for (const k of Object.keys(rows[i])) {
      const v = rows[i][k];
      if (!v || caption[k] || /^[\d\s.,%-]+$/.test(v)) continue;
      caption[k] = v;
    }
  }

  const initCols = [];
  const seen = new Map();
  for (const k of Object.keys(caption).map(Number).sort((a, b) => a - b)) {
    if (String(k) === String(keyCol)) continue;
    const name = caption[k];
    if (skip.includes(name.trim().toLowerCase())) continue;
    // Two columns in the real workbook carry the same caption. Disambiguate
    // with the column letter, which is how the people maintaining the sheet
    // already refer to them.
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    initCols.push({ col: k, name, raw: name });
  }
  for (const c of initCols) {
    if (seen.get(c.raw) > 1) c.name = `${c.raw} (${colLetter(c.col)})`;
  }
  if (!initCols.length) {
    throw new Error('W nagłówku nie ma żadnej kolumny z inicjatywą strategiczną.');
  }

  // --- data rows -----------------------------------------------------------
  // --- the name column, also by content -----------------------------------
  // Needed only for rows with no issue number: their name cannot come from
  // Jira, so it has to come from the sheet. Among the columns left of the
  // first initiative, the one carrying by far the most text is the name —
  // L.p. holds digits, Status and RAG hold a handful of repeated words.
  const firstInit = Math.min(...initCols.map(c => c.col));
  let nameCol = null, best = 0;
  for (let col = 1; col < firstInit; col++) {
    if (col === Number(keyCol)) continue;
    let len = 0;
    for (let i = firstData; i < rows.length; i++) len += (rows[i][col] || '').length;
    if (len > best) { best = len; nameCol = col; }
  }

  const links = [];
  const extras = [];
  let count = 0;
  for (let i = firstData; i < rows.length; i++) {
    const key = (rows[i][keyCol] || '').trim();
    if (!key) continue;

    // Any non-empty cell counts as a link: people write X, x, TAK or 1, and
    // insisting on one of them would only create support calls.
    const marked = initCols.filter(c => (rows[i][c.col] || '').trim()).map(c => c.name);

    // A row whose number is still a placeholder like "PP-" is work with no
    // Jira issue yet. It is handed over separately rather than dropped: the
    // sheet says it contributes to an initiative, and a report that quietly
    // loses rows is worse than one that admits what it cannot resolve.
    if (!KEY.test(key)) {
      extras.push({ n: (nameCol && rows[i][nameCol]) || key, i: marked });
      continue;
    }
    count++;
    marked.forEach(name => links.push({ k: key, i: name }));
  }

  return {
    strategic: initCols.map(c => c.name),
    links, rows: count, extras, sheet: chosen.name,
  };
}

module.exports = { readMatrix, readValuation };
