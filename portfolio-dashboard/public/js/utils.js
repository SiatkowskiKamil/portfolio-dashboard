/* ===========================================================================
   utils.js — small helpers shared by every other file
   ---------------------------------------------------------------------------
   Deliberately dependency-free apart from the current language. Covers three
   jobs:
     * DOM access and HTML escaping,
     * Polish grammar (noun and verb forms depend on the number),
     * number and date formatting in the convention of the active language.

   Load order: after config.js and i18n.js, before everything else.
   =========================================================================== */

/* ---- DOM ---------------------------------------------------------------- */

/** Shorthand for document.querySelector. */
const $ = s => document.querySelector(s);

/**
 * Escape text before putting it into innerHTML.
 * Every value that originates from Jira passes through this: project names are
 * free text and may legitimately contain < or &.
 */
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- Polish grammar ------------------------------------------------------ */

/**
 * Pick the correct Polish form for a count.
 *
 * Polish has three: 1 "projekt", 2-4 "projekty", 5+ "projektów" — except that
 * the teens (12, 13, 14) take the "many" form despite ending in 2-4.
 * Used throughout the Polish commentary in i18n.js so the generated sentences
 * read like a person wrote them. English uses en1() from i18n.js instead.
 *
 *   pl(1,  'projekt', 'projekty', 'projektów')  ->  'projekt'
 *   pl(22, 'projekt', 'projekty', 'projektów')  ->  'projekty'
 *   pl(13, 'projekt', 'projekty', 'projektów')  ->  'projektów'
 */
function pl(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n === 1) return one;
  if (n10 >= 2 && n10 <= 4 && !(n100 >= 12 && n100 <= 14)) return few;
  return many;
}

/* ---- Formatting ----------------------------------------------------------
   Numbers follow the active language: Polish writes 1 234,5 (space for
   thousands, comma for decimals), English 1,234.5. The difference matters —
   a board member reading "233,5" as two hundred thousand instead of two
   hundred million is exactly the kind of mistake a report must not invite.

   Dates stay dd.mm.yyyy in BOTH languages on purpose. Switching English to
   dd/mm/yyyy would make 03/04/2026 ambiguous for anyone used to month-first
   dates, and a financial report cannot afford a date that reads two ways.
   The column filter in tablefilter.js parses this format when it sorts, so
   changing it means changing the regex there too.
   -------------------------------------------------------------------------- */

/** Whole number in the active language's convention. */
const fmt = n => Number(n).toLocaleString(LOCALE());

/** One decimal place. Used for EBITDA and month counts. */
const fmt1 = n => Number(n).toLocaleString(LOCALE(),
  { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Share of a total, rounded to whole percent. Guards against division by zero. */
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '0%';

/** Date as dd.mm.yyyy, or an em dash when absent. */
const dmy = d => d
  ? String(d.getDate()).padStart(2, '0') + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
  : '—';

/** Date as mm.yyyy. Used where only the month matters, as in a list of
 *  planned completions, where a day-exact date reads as false precision. */
const mmyyyy = d => d
  ? String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
  : '—';
