/* ===========================================================================
   data.js — the model layer
   ---------------------------------------------------------------------------
   Turns raw issue records into the rows every measure and every page reads.
   This is the direct equivalent of the Power Query "Portfel" query that the
   earlier Power BI version used, and the derived columns carry the same names
   and the same rules, so figures match that report line for line.

   One raw issue in, one model row out. Nothing here filters or aggregates;
   that is measures.js. Nothing here touches the DOM.

   Depends on: config.js
   =========================================================================== */

/* ---- Application state --------------------------------------------------
   A single mutable object rather than a store: the app is small, every change
   triggers a full redraw, and keeping it in one place makes the data flow
   obvious to the next person.                                              */
const STATE = {
  rows: [],          // model rows, output of buildModel()
  strategic: [],     // names of strategic initiatives, in display order
  links: [],         // [{ k: issueKey, i: initiativeName }] chosen by the strategy team
  bench: [],         // historical benchmark figures
  refExtras: [],     // matrix rows the workbook lists without a Jira number
  refNote: '',       // where the strategic matrix came from, shown on that page
  refStale: false,   // true when the Excel could not be read and JSON was used
  units: [],         // distinct reporting units, for the filter
  sel: new Set(),    // selected reporting units; empty means "all"
  base: CFG.jiraBaseUrl,
};

/* ---- Small conversions --------------------------------------------------- */

/** Case-insensitive membership test against one of the CFG.status lists. */
const inList = (list, v) => !!v && list.some(x => x.toLowerCase() === String(v).toLowerCase());

/** 'YYYY-MM-DD' to a local Date at midnight. Avoids UTC off-by-one shifts. */
const toDate = s => s ? new Date(s + 'T00:00:00') : null;

/** Whole days between two dates. */
const dayDiff = (a, b) => Math.round((a - b) / 864e5);

/** Days to months, one decimal. 365.25/12 keeps leap years from skewing it. */
const toMonths = d => d === null ? null : Math.round(d / (365.25 / 12) * 10) / 10;

/**
 * Strip everything but letters from a RAG value.
 *
 * Jira stores this field with a coloured square in the value itself, e.g.
 * "🟩 Green". Comparing against that literal is fragile: the emoji breaks on
 * copy-paste and PMO can change it in the field configuration at any time.
 * We keep the clean word for logic and the original string for display.
 */
const cleanRag = v => {
  // Named `word`, not `t`: t() is the translation lookup from i18n.js.
  const word = (v || '').replace(/[^A-Za-z ]/g, '').trim();
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : 'Brak';
};

/**
 * Translate the raw Jira value into one of CFG.categories.
 *
 * Returns null when no category field is configured, when the issue has no
 * value, or when the value is not in CFG.categoryMap. The three cases are
 * deliberately not distinguished here: for every one of them the honest answer
 * on screen is "unknown", and render.js counts them together. Matching ignores
 * case and surrounding spaces, because select values drift over time.
 */
function mapCategory(v) {
  if (!CFG.fields.category || v === null || v === undefined) return null;
  const key = String(v).trim().toLowerCase();
  if (!key) return null;
  const hit = Object.keys(CFG.categoryMap).find(k => k.trim().toLowerCase() === key);
  return hit ? CFG.categoryMap[hit] : null;
}

/* ---- Model build --------------------------------------------------------- */

/**
 * Build model rows from a raw dataset.
 *
 * @param {{asOf: string, issues: Array}} raw  as produced by api.js
 * @returns {Array} model rows
 *
 * "Today" comes from raw.asOf rather than the clock, so that a dataset loaded
 * from a file is interpreted as of the moment it was captured. Every row
 * carries today/year so measures can reach them without a second source.
 *
 * Issues matching none of the CFG.units rules are dropped here rather than
 * hidden in the filter, so that the unit list and the "all units" totals
 * always agree. If they were only hidden, the dropdown would offer two units
 * while every headline figure silently counted nine.
 */
function buildModel(raw) {
  const today = raw.asOf ? new Date(raw.asOf.slice(0, 10) + 'T00:00:00') : new Date();
  const year  = today.getFullYear();

  /* ---- reporting-unit membership ----------------------------------------
     The unit does not always follow from the Reporting Unit field. Northwind
     Poland does, but Finance & Legal is recognised by the Roadmap field
     containing SSC, because those projects carry something else in Reporting
     Unit. The rules live in CFG.units, so another unit with its own criterion
     is one configuration entry rather than a code change.

     An issue can match several rules at once and then belongs to several
     units. Everything downstream reads r.rus (an array), never r.ru.      */

  // A rule names its field as it is named in CFG.fields; here we translate
  // that into the key used by the issue shape api.js produces.
  const RULE_FIELD = { reportingUnit: 'ru', roadmap: 'rm', category: 'cat', rag: 'rag' };

  const RULES = (CFG.units || []).map(u => ({
    name: u.name,
    field: u.field,
    exclusive: Boolean(u.exclusive),
    values: u.values || [],
    vals: (u.values || []).map(v => String(v).trim().toLowerCase()),
  }));

  /** An issue field's values as an array — a field may be single or multi. */
  const valsOf = (r, field) => {
    const v = r[RULE_FIELD[field] || field];
    const arr = v === null || v === undefined ? [] : (Array.isArray(v) ? v : [v]);
    return arr.map(x => String(x).trim().toLowerCase()).filter(Boolean);
  };

  /** The units an issue belongs to. An empty array means out of scope. */
  const unitsOf = r => {
    const hit = RULES.filter(u => {
      const vs = valsOf(r, u.field);
      return u.vals.some(w => vs.indexOf(w) > -1);
    });
    // exclusive: the first such rule claims the issue for itself alone.
    const ex = hit.filter(u => u.exclusive)[0];
    return (ex ? [ex] : hit).map(u => u.name);
  };

  // Diagnostics for whoever runs the report: how many issues each rule
  // caught, how many landed in two units at once, how many were dropped, and
  // which Roadmap field supplied the values. Shown under the summary table —
  // without it, a wrong field ID shows up only as an empty unit.
  const diag = {
    units: RULES.map(u => ({ name: u.name, field: u.field, values: u.values || [], n: 0 })),
    overlap: 0, dropped: 0, total: 0, roadmapFields: {},
  };

  const scoped = [];
  raw.issues.forEach(r => {
    (r.rmf || []).forEach(id => { diag.roadmapFields[id] = (diag.roadmapFields[id] || 0) + 1; });
    const rus = unitsOf(r);
    if (!rus.length) { diag.dropped++; return; }
    rus.forEach(n => { const d = diag.units.filter(x => x.name === n)[0]; if (d) d.n++; });
    if (rus.length > 1) diag.overlap++;
    scoped.push({ raw: r, rus });
  });
  diag.total = scoped.length;
  STATE.unitDiag = diag;

  /* ---- business-value workbook ------------------------------------------
     Loaded in app.js before the model is built. Joined on the issue key;
     anything absent from the workbook is left untouched.                  */
  const VAL = (STATE.val && STATE.val.byKey) || new Map();
  const useCat = !(CFG.valuation && CFG.valuation.useCategory === false);
  const CATS = (CFG.categories || []).map(c => c.toLowerCase());

  /** One workbook field for a given issue key, or null. */
  const val = (key, what) => {
    const v = VAL.get(String(key || '').trim().toUpperCase());
    if (!v) return null;
    if (what === 'jest')  return true;
    if (what === 'eb3')   return v.eb3;
    if (what === 'lata')  return v.lata;
    if (what === 'sheet') return v.sheet;
    if (what === 'ptRaw') return v.pt;
    // 'kat': the workbook's Project Type is already the final category, not
    // an MPR value, so it is taken as it stands — but only when it matches
    // CFG.categories. A typo in the workbook must land in its own "unmapped"
    // row rather than pass itself off as one of the three categories.
    if (what === 'kat' && useCat && v.pt) {
      const i = CATS.indexOf(String(v.pt).trim().toLowerCase());
      return i < 0 ? null : CFG.categories[i];
    }
    return null;
  };

  return scoped.map(({ raw: r, rus }) => {
    const sd  = toDate(r.sd);   // current planned start
    const dd  = toDate(r.dd);   // current planned end (Jira "duedate")
    const sdo = toDate(r.sdo);  // original planned start  (baseline)
    const ddo = toDate(r.ddo);  // original planned end    (baseline)

    const isDel  = inList(CFG.status.delivery, r.s);
    const isAna  = inList(CFG.status.analysis, r.s);
    const isPrep = inList(CFG.status.preparation, r.s);

    // Two EBITDA sources and the decision between them. The workbook wins
    // outright: one source for the whole report, and absent from it means no
    // value at all.
    const ebJira = (r.eb === null || r.eb === undefined) ? null : r.eb / CFG.ebitdaDivisor;
    const ebFile = val(r.k, 'eb3');
    const ebUse  = (STATE.val && STATE.val.count) ? ebFile : ebJira;

    // Phase. Delivery and Analysis together count as "in progress" — see the
    // note in config.js about how this was confirmed against the PMO report.
    const faza = (isDel || isAna) ? 'Realizowane'
               : isPrep           ? 'Planowane'
               : 'Poza portfelem';

    // Planned-start grouping, only meaningful for Preparation.
    // A start date already in the past still falls into the current year's
    // bucket; overdue starts are reported separately rather than split out
    // here, so the matrix totals stay equal to the portfolio size.
    let grp = null, grpOrd = 99;
    if (isPrep) {
      if (!sd)                           { grp = 'Brak daty startu';            grpOrd = 14; }
      else if (sd.getFullYear() <= year) { grp = 'Start do końca ' + year;      grpOrd = 12; }
      else                               { grp = 'Start ' + (year + 1) + ' i później'; grpOrd = 13; }
    }
    const podgrupa = isPrep ? grp : r.s;
    const podOrd   = isDel ? 1 : isAna ? 2 : isPrep ? grpOrd : 99;

    // Schedule compliance: current end date against the baseline end date.
    // Positive drift means later than planned.
    const shiftD = (dd && ddo) ? dayDiff(dd, ddo) : null;
    let sched, schedOrd;
    if (!ddo)                                    { sched = 'Brak planu pierwotnego'; schedOrd = 8; }
    else if (!dd)                                { sched = 'Brak daty zakończenia';  schedOrd = 9; }
    else if (shiftD >  CFG.scheduleToleranceDays){ sched = 'Opóźnione';              schedOrd = 2; }
    else if (shiftD < -CFG.scheduleToleranceDays){ sched = 'Przyspieszone';          schedOrd = 3; }
    else                                         { sched = 'Zgodne z harmonogramem'; schedOrd = 1; }

    const cancelled = inList(CFG.status.cancelled, r.s);
    const done      = inList(CFG.status.done, r.s);
    const rag       = cleanRag(r.rag);

    return {
      // identity
      key: r.k,
      typ: r.t,                                                   // raw Jira issue type
      typPl:  r.t === 'Project' ? 'Projekty'  : r.t === 'Initiative' ? 'Inicjatywy'  : r.t,
      rodzaj: r.t === 'Project' ? 'Projekt'   : r.t === 'Initiative' ? 'Inicjatywa'  : r.t,
      nazwa: r.n,
      status: r.s,
      // The issue's reporting units. rus is what the filter reads; ru is a
      // display string kept in case a table ever needs to print them, with
      // a comma between two units.
      rus,
      ru: rus.join(', '),
      roadmap: r.rm || [],
      owner: r.own || null,

      // classification
      kategoria: cancelled ? 'Anulowane' : done ? 'Zakończone' : 'Aktywne',
      wPortfelu: isDel || isAna || isPrep,
      wPrzygotowaniu: isPrep,
      faza, podgrupa, podOrd,

      // true only for a Preparation item whose start is still ahead of us
      // this calendar year — the "launching before year end" measure
      startDoKoncaRoku: isPrep && !!sd && sd >= today && sd.getFullYear() === year,

      // RAG: clean value for logic, ragOrd for sorting Green/Amber/Red/none
      rag,
      ragOrd: { Green: 1, Amber: 2, Red: 3 }[rag] || 9,

      // dates
      sd, dd, sdo, ddo,
      rokStartu: sd ? sd.getFullYear() : null,
      rokKonca:  dd ? dd.getFullYear() : null,

      // schedule
      shiftD,
      shiftM: toMonths(shiftD),
      sched, schedOrd,
      czasPlan:  (sd  && dd  && dd  >= sd)  ? toMonths(dayDiff(dd, sd))   : null,
      czasPierw: (sdo && ddo && ddo >= sdo) ? toMonths(dayDiff(ddo, sdo)) : null,

      // days a Preparation item is past its planned start; null otherwise
      opoznienieStartu: (isPrep && sd && sd < today) ? dayDiff(today, sd) : null,

      // money, converted to millions. All three Jira fields are "[K]", i.e.
      // thousands of PLN, so they share one divisor.
      /* EBITDA for the whole report. With the business-value workbook
         loaded this is its multi-year total and nothing else; where an issue
         is absent from the workbook the value stays null and the report
         prints a dash. Falling back to the Jira figure here would mix two
         forecast horizons in one column — a total no single sentence could
         describe. ebitdaJira is kept so the two sources can be compared. */
      ebitda: ebUse,
      ebitdaJira: ebJira,
      capex:  (r.cx === null || r.cx === undefined) ? null : r.cx / CFG.ebitdaDivisor,
      opex:   (r.ox === null || r.ox === undefined) ? null : r.ox / CFG.ebitdaDivisor,

      // Business category (Growth / Compliance / Maintenance), and the raw Jira
      // value behind it. The raw one is kept so that a value missing from
      // CFG.categoryMap can be named on screen instead of vanishing into a
      // single "no category" bucket — that is the difference between "the
      // field is empty" and "the field says something we do not know about".
      kategoriaBiz: val(r.k, 'kat') || mapCategory(r.cat),
      kategoriaSrc: val(r.k, 'ptRaw') ||
        ((r.cat === null || r.cat === undefined) ? null : (String(r.cat).trim() || null)),

      /* ---- fields taken from the business-value workbook ----------------
         ebW holds the same number as ebitda; the separate name remains
         because the Business value page reads it directly through its
         EBITDA / CAPEX / OPEX switch. */
      ebW:    ebUse,
      ebLata: val(r.k, 'lata') || {},
      wArkuszu: Boolean(val(r.k, 'jest')),
      arkusz: val(r.k, 'sheet') || null,

      // carried on every row so measures need no second source for "now"
      today, year,
    };
  });
}
