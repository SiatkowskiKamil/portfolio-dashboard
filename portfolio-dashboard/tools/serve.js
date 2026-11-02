/* ===========================================================================
   serve.js — static file server + Jira proxy, for local development
   ---------------------------------------------------------------------------
   Serves ../public on http://localhost:8000 and forwards /api/issues to Jira.
   Uses nothing but the Node standard library: no npm install, no configuration
   file, no dependencies.

   Run from this folder:   node serve.js
   Different port:         node serve.js 8080

   Why the static part exists: the browser refuses to read neighbouring files
   when a page is opened straight from disk, so data/*.json never loads and the
   app cannot start. Any static server fixes that; this one has no prerequisites.

   Why the proxy exists: a browser will not let the page call atlassian.net
   directly. Atlassian does not send the headers that would allow it, and that
   is browser policy — not a network problem and not a bad token, so a VPN
   makes no difference. A request made from this process is not a browser
   request, so the policy does not apply to it.

   -- Live Jira data ---------------------------------------------------------
   Credentials come from the environment and are never written to a file, never
   sent to the browser and never logged. Set them in the shell that starts the
   server:

     PowerShell
       $env:JIRA_EMAIL="twoj.email@firma.pl"
       $env:JIRA_TOKEN="WKLEJ_TUTAJ_NOWY_TOKEN"
       node tools\serve.js

     bash
       JIRA_EMAIL=twoj.email@firma.pl JIRA_TOKEN=... node tools/serve.js

   Then set CFG.apiBase = '/api' in public/js/config.js. Without the variables
   the static site still works; only live Jira is unavailable, and /api/issues
   replies with an explanation rather than failing silently.

   The token is a password. Closing the terminal discards it. Do not paste it
   into a script, a .env file inside the project, or anything that gets
   committed. A token that has been exposed should be revoked in the Atlassian
   account, not reused.
   =========================================================================== */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { readMatrix, readValuation } = require('./xlsx.js');

/* ---- Reference workbook ----------------------------------------------------
   The strategic-initiative matrix, maintained by hand in Excel. Hard-coded on
   purpose: the dashboard picks the file up with no configuration, exactly as
   the Power BI report did. Keep in step with tools/serve.ps1. */
const REFERENCE = {
  // dane/ first, then this path — same order as serve.ps1, so that replacing
  // the server with a newer version does not wipe the setting.
  name:  'inicjatywy',
  file:  process.env.REFERENCE_FILE || '',
  sheet: 'Strategia',   // '' = first sheet in the workbook
  // Captions that are NOT strategic initiatives. Anything else in the header
  // becomes one, so a new initiative needs no code change — only a new column.
  skip: ['Issue', 'Type', 'Issue Type', 'L.p.', 'Lp.', 'Nr PF', 'Nr. PF',
         'Rodzaj', 'Typ', 'Projekt', 'Projekt/Inicjatywa', 'Nazwa',
         'Status', 'RAG', 'RAG (ikona)'],
};

/* ---- Business-value workbook ------------------------------------------------
   Per-year EBITDA and the project category, handed over by the data team until
   their table is ready. Unlike the file above, this one is found relative to
   the script, in dane/ next to public/ — nothing to configure, and it travels
   with the folder when it is copied to another machine.

   It deliberately does NOT live under public/: everything there is served over
   HTTP, so the raw workbook could be downloaded past the Jira sign-in and past
   the reporting-unit filter. Here the server reads it from disk and hands out
   only the figures the page needs. Keep in step with tools/serve.ps1. */
/* ---- Uploading the strategic matrix ----------------------------------------
   The Strategic initiatives page gets a button that replaces the workbook.
   Who is allowed to do that is NOT decided here: in production IIS does it,
   with Windows Authentication and an AD group on the path. The name recorded
   in the metadata comes from the browser and is information, not access
   control. Keep in step with tools/serve.ps1. */
const UPLOAD = {
  allowed: true,
  maxBytes: 25 * 1024 * 1024,
};

const VALUATION = {
  file: process.env.VALUATION_FILE || null,   // null -> szukaj w dane/
  name: 'wartosc_biznesowa.xlsx',
};

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8000;

// Find public/ whether this script sits in tools/ or next to public/ itself.
const ROOT = [
  path.resolve(__dirname, '..', 'public'),
  path.resolve(__dirname, 'public'),
  path.resolve(process.cwd(), 'public'),
  process.cwd(),
].find(d => fs.existsSync(path.join(d, 'index.html')));

if (!ROOT) {
  console.error('\n  Nie znalazłem katalogu z plikiem index.html.');
  console.error('  Umieść serve.js w katalogu tools/ albo obok katalogu public/.\n');
  process.exit(1);
}

const JIRA_BASE  = (process.env.JIRA_BASE || 'https://your-company.atlassian.net').replace(/\/+$/, '');
const JIRA_EMAIL = process.env.JIRA_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_TOKEN || '';
const HAS_CREDS  = Boolean(JIRA_EMAIL && JIRA_TOKEN);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

/** Reply with a JSON body. The app reads `error` and shows it to the user. */
function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }).end(body);
}

/* ---------------------------------------------------------------------------
   GET /api/issues  ->  GET <jira>/rest/api/3/search/jql
   ---------------------------------------------------------------------------
   A deliberately narrow pass-through: one upstream path, and only the four
   parameters the app actually sends. Anything else is dropped, so this cannot
   be used as a general-purpose proxy into Jira by whatever else is running on
   this machine. Pagination stays in the browser — the app already follows
   nextPageToken, and this keeps the proxy stateless.
   --------------------------------------------------------------------------- */
const ALLOWED_PARAMS = ['jql', 'maxResults', 'fields', 'nextPageToken'];

function proxyIssues(req, res) {
  // Two models, one proxy. When the browser sends credentials they are passed
  // straight through, so Jira applies that person's permissions and the server
  // stores nothing. When it does not, the server's own account is used and
  // everyone sees identical figures. CFG.auth in config.js picks the model;
  // this end simply honours whichever arrives.
  let auth = req.headers.authorization || '';
  const fromUser = Boolean(auth);
  if (!auth) {
    if (!HAS_CREDS) {
      return sendJson(res, 503, {
        error: 'Brak danych logowania do Jiry. Albo zaloguj się w aplikacji '
             + "(CFG.auth = 'user'), albo uruchom serwer ze zmiennymi JIRA_EMAIL "
             + 'i JIRA_TOKEN. Szczegóły w komentarzu na górze tools/serve.js.',
      });
    }
    // Jira Cloud uses Basic auth with an API token in place of a password.
    auth = 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64');
  }

  const incoming = new URL(req.url, 'http://localhost');
  const q = new URLSearchParams();
  ALLOWED_PARAMS.forEach(p => {
    const v = incoming.searchParams.get(p);
    if (v !== null) q.set(p, v);
  });

  const target = new URL(JIRA_BASE + '/rest/api/3/search/jql?' + q.toString());
  // Jira Cloud is always https; http is here only so a local stand-in can be
  // used while testing, and it is called out loudly at start-up because the
  // token would cross the wire in the clear.
  const client = target.protocol === 'http:' ? http : https;

  const upstream = client.request({
    hostname: target.hostname,
    port: target.port || (target.protocol === 'http:' ? 80 : 443),
    path: target.pathname + target.search,
    method: 'GET',
    headers: { Authorization: auth, Accept: 'application/json' },
  }, up => {
    const chunks = [];
    up.on('data', c => chunks.push(c));
    up.on('end', () => {
      const body = Buffer.concat(chunks);

      if (up.statusCode === 401 || up.statusCode === 403) {
        console.log('  /api/issues -> Jira ' + up.statusCode + ' (odrzucone logowanie)');
        // Say whose credentials were rejected: the user can fix their own, but
        // only an operator can fix the server's.
        return sendJson(res, up.statusCode, {
          error: fromUser
            ? 'Jira odrzuciła logowanie (HTTP ' + up.statusCode + '). Sprawdź adres e-mail '
              + 'i czy token jest nadal ważny — tokeny Atlassiana wygasają.'
            : 'Jira odrzuciła dane logowania serwera (HTTP ' + up.statusCode + '). '
              + 'Sprawdź JIRA_EMAIL i czy token jest nadal ważny.',
        });
      }
      if (up.statusCode >= 400) {
        // Pass Jira's own message through: for a bad JQL it names the problem.
        console.log('  /api/issues -> Jira ' + up.statusCode);
        let detail = '';
        try {
          const j = JSON.parse(body.toString('utf8'));
          detail = [].concat(j.errorMessages || [], Object.values(j.errors || {})).join(' ');
        } catch (e) { /* not JSON; no detail to add */ }
        return sendJson(res, up.statusCode, {
          error: 'Jira zwróciła błąd ' + up.statusCode + (detail ? ': ' + detail : '.'),
        });
      }

      let n = '?';
      try { n = (JSON.parse(body.toString('utf8')).issues || []).length; } catch (e) {}
      console.log('  /api/issues -> Jira 200, ' + n + ' zgłoszeń');

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      }).end(body);
    });
  });

  // No connection at all: usually DNS, a proxy, or a firewall between this
  // machine and Atlassian. Say so, because the browser cannot tell the
  // difference between this and a server bug.
  upstream.on('error', err => {
    console.log('  /api/issues -> brak połączenia: ' + err.message);
    sendJson(res, 502, {
      error: 'Serwer nie mógł połączyć się z Jirą (' + err.message + '). '
           + 'Sprawdź adres w JIRA_BASE, sieć firmową i VPN.',
    });
  });

  upstream.setTimeout(30000, () => upstream.destroy(new Error('przekroczono limit czasu (30 s)')));
  upstream.end();
}

/* ---------------------------------------------------------------------------
   GET /api/reference  ->  the strategic matrix, read straight from the .xlsx
   ---------------------------------------------------------------------------
   Read fresh on every request, so saving in Excel and pressing F5 in the
   browser is the whole refresh cycle. The file is read through a copy, so it
   can stay open in Excel while the server reads it.
   --------------------------------------------------------------------------- */
/* A hand-written path, tried with both extensions: .xlsx and .xlsm are the
   same format inside, and the two are easy to confuse when copying a path. */
function resolveRefFile(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  const alt = /\.xlsx$/i.test(p) ? p.replace(/\.xlsx$/i, '.xlsm')
            : /\.xlsm$/i.test(p) ? p.replace(/\.xlsm$/i, '.xlsx') : null;
  return (alt && fs.existsSync(alt)) ? alt : null;
}

/** What is actually in the folder the configured path points at. */
function refFolderHint(p) {
  if (!p) return '';
  const dir = path.dirname(p);
  // Pod Linuksem path.dirname() nie rozumie sciezki windowsowej i zwraca '.',
  // a wtedy podpowiedz bylaby bzdurna. serve.js sluzy do pracy nad kodem;
  // produkcyjnie dziala serve.ps1 na Windows.
  if (dir === '.' || dir === p) return '';
  if (!fs.existsSync(dir)) return ` Folder ${dir} nie istnieje albo jest niedostępny.`;
  const base = path.basename(p).replace(/\.[^.]*$/, '');
  const found = fs.readdirSync(dir).filter(n => n.startsWith(base));
  return found.length
    ? ` W folderze ${dir} widzę: ${found.join(', ')}.`
    : ` W folderze ${dir} nie ma żadnego pliku o nazwie zaczynającej się od "${base}".`;
}

function proxyReference(req, res) {
  const file = findInDane(REFERENCE.name) || resolveRefFile(REFERENCE.file);
  if (!file) {
    return sendJson(res, 503, {
      error: 'Nie znalazłem pliku z macierzą inicjatyw. ' + daneHint(REFERENCE.name) +
        (REFERENCE.file
          ? ` Sprawdziłem też ścieżkę z serve.js (w obu rozszerzeniach): ${REFERENCE.file}.` +
            refFolderHint(REFERENCE.file)
          : ' Możesz też wpisać pełną ścieżkę w REFERENCE.file w tools/serve.js.'),
    });
  }
  let tmp = null;
  try {
    tmp = path.join(require('os').tmpdir(), 'ref-' + process.pid + '.xlsx');
    fs.copyFileSync(file, tmp);
    const data = readMatrix(tmp, REFERENCE);
    console.log(`  /api/reference -> ${data.sheet}, ${data.rows} poz., ${data.links.length} powiązań`);
    // When the workbook came from an upload, say when and from whom: that is
    // what turns a stale matrix from invisible into obvious.
    const meta = readReferenceMeta();
    sendJson(res, 200, Object.assign({}, data, {
      uploadedAt: (meta && meta.uploadedAt) || '',
      uploadedBy: (meta && meta.uploadedBy) || '',
      canUpload: UPLOAD.allowed,
    }));
  } catch (err) {
    console.log('  /api/reference -> błąd: ' + err.message);
    sendJson(res, 500, { error: err.message });
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ } }
  }
}

/* ---------------------------------------------------------------------------
   GET /api/valuation  ->  per-year EBITDA and category, from dane/
   ---------------------------------------------------------------------------
   Same refresh cycle as /api/reference: read fresh on every request, through a
   copy so the workbook may stay open in Excel.
   --------------------------------------------------------------------------- */
/* ---- the dane/ folder — shared home for the workbooks the server reads ----
   Sits next to public/, whether this script runs from tools/ or beside it.
   It is NOT served over HTTP. .xlsm is accepted alongside .xlsx: the same
   format inside, and handed-over files come as either.
   Keep in step with tools/serve.ps1. */
/* DANE_DIR relocates this folder OUTSIDE the application directory, which is
   what a deployment needs: the app folder is replaced on every release, and a
   dane\ inside it would take the uploaded matrix with it. When the variable is
   set it wins over the three fallbacks and is created if missing. */
const DANE_DIR = (process.env.DANE_DIR || '').trim();

const daneDirs = () => (DANE_DIR ? [path.resolve(DANE_DIR)] : []).concat([
  path.resolve(__dirname, '..', 'dane'),
  path.resolve(__dirname, 'dane'),
  path.resolve(process.cwd(), 'dane'),
]);

function findInDane(base) {
  const b = base.replace(/\.[^.]*$/, '');
  for (const d of daneDirs()) {
    for (const n of [b + '.xlsx', b + '.xlsm']) {
      const f = path.join(d, n);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

/** A message naming WHAT the server can see in the folder. Without it a typo
 *  or a hidden extension costs half an hour of hunting for a bug in code. */
function daneHint(base) {
  const b = base.replace(/\.[^.]*$/, '');
  const dir = daneDirs()[0];
  let msg = `Szukałem ${b}.xlsx i ${b}.xlsm w: ${dir}.`;
  if (DANE_DIR) msg += ' (folder wskazany zmienną DANE_DIR)';
  if (fs.existsSync(dir)) {
    const found = fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isFile());
    msg += found.length ? ` W tym folderze widzę: ${found.join(', ')}.` : ' Folder istnieje, ale jest pusty.';
  } else {
    msg += ' Tego folderu jeszcze nie ma — utwórz go.';
  }
  return msg;
}

function valuationPath() {
  return VALUATION.file || findInDane(VALUATION.name);
}

function proxyValuation(req, res) {
  const file = valuationPath();
  if (!file) {
    return sendJson(res, 503, {
      error: 'Nie znalazłem pliku wartości biznesowej. ' + daneHint(VALUATION.name),
    });
  }
  let tmp = null;
  try {
    tmp = path.join(require('os').tmpdir(), 'val-' + process.pid + '.xlsx');
    fs.copyFileSync(file, tmp);
    const data = readValuation(tmp, { name: path.basename(file) });
    console.log(`  /api/valuation -> ${data.rows.length} poz., arkusze: ${data.sheets.join(', ')}`);
    sendJson(res, 200, data);
  } catch (err) {
    console.log('  /api/valuation -> błąd: ' + err.message);
    sendJson(res, 500, { error: err.message });
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ } }
  }
}

/* ---------------------------------------------------------------------------
   POST /api/reference  ->  replace the strategic matrix with an uploaded file
   ---------------------------------------------------------------------------
   The body is the raw bytes of the workbook — no multipart, because fetch()
   can send a File object as the body directly and multipart would be parsing
   for its own sake.

   The new file is PARSED BEFORE it replaces anything: uploading the wrong
   workbook is the obvious mistake here and it has to fail loudly rather than
   wipe the matrix.
   --------------------------------------------------------------------------- */

function daneWriteDir() {
  // With DANE_DIR set, that folder is the only writable home: an upload must
  // never land in a copy inside the application directory, where the next
  // release would delete it.
  const dir = DANE_DIR
    ? path.resolve(DANE_DIR)
    : (daneDirs().find(d => fs.existsSync(d)) || path.resolve(__dirname, '..', 'dane'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readReferenceMeta() {
  const f = path.join(daneWriteDir(), REFERENCE.name + '.meta.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/** Collect the whole request body, refusing anything over the limit. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too big'), { tooBig: true })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function uploadReference(req, res) {
  if (!UPLOAD.allowed) {
    return sendJson(res, 403, { error: 'Wgrywanie jest wyłączone w serve.js (UPLOAD.allowed).' });
  }
  let bytes;
  try {
    bytes = await readBody(req, UPLOAD.maxBytes);
  } catch (err) {
    return sendJson(res, err.tooBig ? 413 : 400, {
      error: err.tooBig
        ? `Plik jest większy niż limit ${Math.round(UPLOAD.maxBytes / 1048576)} MB.`
        : 'Połączenie urwało się w trakcie wysyłania pliku.',
    });
  }
  if (!bytes.length) return sendJson(res, 400, { error: 'Puste żądanie — nie przyszedł żaden plik.' });

  // Every .xlsx/.xlsm is a ZIP. The signature rejects a .xls, a PDF or a
  // renamed text file before anything is unzipped.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return sendJson(res, 400, {
      error: 'To nie jest plik .xlsx ani .xlsm (brak sygnatury ZIP). Zapisz skoroszyt w nowszym formacie i spróbuj ponownie.',
    });
  }

  // Who is uploading. X-Remote-User is set by IIS from LOGON_USER and is the
  // only trustworthy source, so it wins; X-Uploaded-By comes from the page
  // itself and is only there for the local development server, where nobody
  // has signed in with a Windows account.
  const by = String(req.headers['x-remote-user'] || req.headers['x-uploaded-by'] || '');
  try {
    // Parse first; if this throws, nothing has been replaced.
    const data = readMatrix(bytes, REFERENCE);

    const dir = daneWriteDir();
    const target = path.join(dir, REFERENCE.name + '.xlsm');
    const other = path.join(dir, REFERENCE.name + '.xlsx');
    fs.writeFileSync(target, bytes);
    // One name wins: findInDane prefers .xlsx, so an old one left behind would
    // quietly outrank the file just uploaded.
    if (fs.existsSync(other)) fs.unlinkSync(other);

    const meta = {
      uploadedAt: new Date().toISOString(),
      uploadedBy: by,
      bytes: bytes.length,
      rows: data.rows,
      links: data.links.length,
      sheet: data.sheet,
    };
    fs.writeFileSync(path.join(dir, REFERENCE.name + '.meta.json'), JSON.stringify(meta));

    console.log(`  POST /api/reference -> przyjęto ${bytes.length} B, ${data.rows} poz., ` +
                `${data.links.length} powiązań, od: ${by || '(nieznany)'}`);
    sendJson(res, 200, Object.assign({}, data, {
      uploadedAt: meta.uploadedAt, uploadedBy: meta.uploadedBy, canUpload: UPLOAD.allowed,
    }));
  } catch (err) {
    console.log('  POST /api/reference -> odrzucono: ' + err.message);
    sendJson(res, 400, {
      error: 'Nie mogę odczytać tego skoroszytu, więc go nie podmieniam. ' + err.message,
    });
  }
}

/* ---------------------------------------------------------------------------
   Static files
   --------------------------------------------------------------------------- */
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);

  // Refuse anything that resolves outside public/ — a "../.." in the URL must
  // not expose the rest of the disk.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
         .end('404 — nie znaleziono: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // Always revalidate, so an edited file shows up on the next refresh.
      'Cache-Control': 'no-store',
    }).end(buf);
  });
}

http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/api/issues')    return proxyIssues(req, res);
  if (p === '/api/reference') {
    return req.method === 'POST' ? uploadReference(req, res) : proxyReference(req, res);
  }
  if (p === '/api/valuation') return proxyValuation(req, res);
  serveStatic(req, res);
})
// Loopback only. The proxy carries credentials, so it must not be reachable
// from anywhere else on the network.
.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Dashboard działa:  http://localhost:' + PORT);
  console.log('  Katalog:           ' + ROOT);
  console.log('  Jira:              ' + (HAS_CREDS
    ? JIRA_BASE + ' jako ' + JIRA_EMAIL
    : 'brak danych logowania — ustaw JIRA_EMAIL i JIRA_TOKEN'));
  if (HAS_CREDS && JIRA_BASE.startsWith('http://')) {
    console.log('  UWAGA: JIRA_BASE używa http, więc token poleci niezaszyfrowany.');
    console.log('         Dopuszczalne wyłącznie dla atrapy Jiry w testach.');
  }
  console.log('  Zatrzymanie:       Ctrl+C');
  console.log('');
});
