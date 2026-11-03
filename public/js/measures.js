/* ===========================================================================
   measures.js — the measure layer
   ---------------------------------------------------------------------------
   Equivalent of the DAX measures in the Power BI version. Every function takes
   an array of model rows and returns either a filtered array or a number, so
   they compose:

       M.ebitda(M.proj(M.realizowane(M.portfel(F()))))

   The entry point is F(): it applies the reporting-unit filter, so a page that
   starts from F() automatically responds to the filter in the top bar.

   Depends on: data.js
   =========================================================================== */

/**
 * Rows currently in scope.
 * An empty selection means "all units" rather than "no units" — the filter is
 * a narrowing device, and the default view is the whole portfolio.
 */
/* An issue can belong to several reporting units (see CFG.units), so it
   matches when ANY of its units is selected. Each row enters the result once
   however many of its units are ticked, so selecting two units never doubles
   a total. */
const F = () => STATE.sel.size
  ? STATE.rows.filter(r => r.rus.some(u => STATE.sel.has(u)))
  : STATE.rows;

/** "Today" as of the loaded dataset, not the wall clock. See buildModel(). */
const TODAY = () => STATE.rows.length ? STATE.rows[0].today : new Date();

/** Calendar year of the loaded dataset. */
const YEAR = () => STATE.rows.length ? STATE.rows[0].year : new Date().getFullYear();

const M = {

  /* ---- Row sets ---------------------------------------------------------
     Each takes rows and returns a subset, so they can be chained.          */

  /** The portfolio: Delivery + Analysis + Preparation. Excludes done/cancelled. */
  portfel: d => d.filter(r => r.wPortfelu),

  /** In progress: Delivery + Analysis. */
  realizowane: d => d.filter(r => r.faza === 'Realizowane'),

  /** Planned: Preparation. */
  planowane: d => d.filter(r => r.faza === 'Planowane'),

  /** Finished work. Not part of the portfolio (that is Delivery / Analysis /
   *  Preparation), but needed to show value already delivered. */
  zakonczone: d => d.filter(r => r.kategoria === 'Zakończone'),

  proj: d => d.filter(r => r.typ === 'Project'),
  init: d => d.filter(r => r.typ === 'Initiative'),

  /* ---- Aggregates -------------------------------------------------------- */

  /** Total EBITDA in millions. Rows with no EBITDA count as zero, not as a gap. */
  ebitda: d => d.reduce((s, r) => s + (r.ebitda || 0), 0),

  /**
   * Total of any money column in millions — 'ebitda', 'capex' or 'opex'.
   * Same rule as above: an empty field counts as zero. Use M.braki() to say
   * how many rows that silence covers.
   */
  suma: (d, key) => d.reduce((s, r) => s + (r[key] || 0), 0),

  /** How many rows have no value in that column. */
  braki: (d, key) => d.filter(r => r[key] === null || r[key] === undefined).length,

  /** Rows grouped by business category, in CFG.categories order.
   *  Anything unmapped is grouped by the raw Jira value and named on screen,
   *  never folded into one of the three. An empty field and an unrecognised
   *  value are different problems with different fixes, so they get separate
   *  rows: one says the data is missing, the other names what to add to
   *  CFG.categoryMap. */
  wgKategorii: d => {
    const groups = CFG.categories.map(c => ({ k: c, rows: d.filter(r => r.kategoriaBiz === c) }));
    const byRaw = new Map();
    d.filter(r => !r.kategoriaBiz).forEach(r => {
      const k = r.kategoriaSrc ? 'Bez mapowania: ' + r.kategoriaSrc : 'Brak wartości w Jirze';
      if (!byRaw.has(k)) byRaw.set(k, []);
      byRaw.get(k).push(r);
    });
    [...byRaw.keys()].sort().forEach(k => groups.push({ k, rows: byRaw.get(k) }));
    return groups;
  },

  /**
   * Average of a numeric property, ignoring rows where it is absent.
   * Returns null rather than 0 for an empty set, so callers can tell
   * "no data" from "genuinely zero".
   */
  srednia: (d, f) => {
    const v = d.map(f).filter(x => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  },
};
