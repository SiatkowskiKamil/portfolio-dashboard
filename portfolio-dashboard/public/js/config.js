/* ===========================================================================
   config.js — every value an operator may need to change
   ---------------------------------------------------------------------------
   This is the only file you should have to touch when Jira changes: new status
   names, a renamed custom field, a different tolerance. Nothing here depends on
   the rest of the application, and nothing else hard-codes these values.

   Load order: this file must come first.
   =========================================================================== */

const CFG = {

  /* ---- Jira instance ---------------------------------------------------
     Used to build "open in Jira" links and as the default in the sign-in form. */
  jiraBaseUrl: 'https://your-company.atlassian.net',

  /* ---- Default language --------------------------------------------------
     'pl' or 'en'. Only used the first time someone opens the report: after
     that the switch in the top bar remembers their choice in the browser.
     Every string lives in js/i18n.js. */
  defaultLang: 'pl',

  /* ---- Backend proxy ---------------------------------------------------
     Browsers refuse to call the Jira API directly from another origin (CORS),
     so live data must come through our own server.

     null  -> no backend; the app tries Jira directly, which the browser
              blocks, and explains why. Demo data and JSON paste still work.
     '/api'-> the server exposes GET /api/issues and returns a Jira-shaped
              response. tools/serve.js does this, and so will the deployed
              backend in /server.

     Set this back to null when the page is served by anything that does NOT
     provide /api/issues — a plain static host, or the single-file build —
     otherwise the sign-in button hides the credential fields and then has
     nowhere to send the request. */
  apiBase: '/api',

  /* ---- Who the data is read as ------------------------------------------
     'user'   -> each person signs in with their own Jira e-mail and API
                 token. The browser sends them with every request and the
                 server only forwards them. Jira then applies that person's
                 permissions, and nothing is stored anywhere.

                 The catch: two people with different Jira permissions see
                 different totals from the same dashboard, with no warning
                 that anything is missing. Safe only when every intended
                 reader has the same access to the project.

     'server' -> the server uses one account of its own (JIRA_EMAIL and
                 JIRA_TOKEN in its environment) and the browser never sees a
                 token. Everyone gets identical figures, which is what a
                 report usually wants, but then access has to be controlled
                 by who can reach the address at all.

     The server accepts both: it forwards the credentials when the browser
     sends them and falls back to its own when it does not. Switching models
     is this one line. */
  auth: 'user',

  /* ---- Jira field IDs --------------------------------------------------
     Confirmed against the live instance in Sep 2026. If a field is remapped,
     change it here only; data.js and api.js read these names. */
  fields: {
    startDate:     'customfield_10015',  // Start date (current plan)
    startOriginal: 'customfield_10502',  // Start Date (Original) — baseline
    endOriginal:   'customfield_10503',  // End Date (Original)   — baseline
    ebitda:        'customfield_10345',  // EBITDA [K], thousands PLN, a combined
                                         // forecast over ebitdaYears (see below)
    capex:         'customfield_10308',  // CAPEX [K], thousands PLN
    opex:          'customfield_10309',  // OPEX [K],  thousands PLN

    // Business category. Jira stores the MPR classification; categoryMap
    // below turns it into Growth / Compliance / Maintenance.
    // Set to null to switch the whole split off: the category tables and the
    // sentences that depend on them then say so, instead of inventing one.
    category:      'customfield_11279',  // Project classification
    rag:           'customfield_10306',  // RAG — value may carry an emoji prefix
    reportingUnit: 'customfield_15484',  // Reporting Unit — single select

    /* Roadmap — a multi-select field; the Finance & Legal unit is
       recognised by it carrying the value SSC.

       A Jira instance can carry SEVERAL fields with the same display name —
       ours had three called "Roadmap" — and only one of them is on the issue
       screen. Find out which by asking for a known issue and looking at what
       comes back, for example:
           /rest/api/3/issue/PF-1234?fields=customfield_15032
       The values are plain strings, not objects, and there are several at once:
       a project sits on several roadmaps, which is why the rule matches
       "contains SSC" rather than "equals SSC".

       A list of candidate IDs may be given here if the field ever has to be
       hunted for again — the application asks for all of them and the control
       line under the summary table reports which one answered. */
    roadmap: 'customfield_15032',   // multi-select, see the note above
    // 'duedate' is a built-in field and holds the CURRENT planned end date.
  },

  /* ---- Status groups ---------------------------------------------------
     Matched case-insensitively. "In progress" is Delivery + Analysis
     together, which is how the report this one replaces counted it. Check this
     against your own instance before trusting the headline numbers. */
  status: {
    delivery:    ['Delivery'],
    analysis:    ['Analysis'],
    preparation: ['Preparation'],
    done:        ['Done', 'Closed', 'Zakończony'],
    cancelled:   ['Cancelled', 'Canceled', 'Anulowany'],
  },

  /* ---- Business rules --------------------------------------------------- */

  // EBITDA is stored in thousands PLN and displayed in millions.
  ebitdaDivisor: 1000,

  /* EBITDA forecast horizon, in years.
     The Jira field EBITDA [K] turned out to hold a FIVE-year forecast, while
     the report that this one replaces called the very same number three-year.
     The label was wrong; the number was always a plain read of the field, with
     no arithmetic applied to it. Worth verifying in your own instance before
     anybody quotes a figure from here.

     This single value drives every label that mentions the horizon: table
     headers, the sentences in the commentary and the year range in brackets.
     It is overridden by valuation.years wherever the workbook supplies the
     figures, which is the case today. */
  ebitdaYears: 5,

  /* ---- Business-value workbook (dane\wartosc_biznesowa.xlsx) ------------
     A temporary arrangement until the data team publishes its own table. The
     workbook carries two things Jira does not hold:
       * EBITDA split by year, together with its three-year total,
       * the Growth / Compliance / Maintenance classification (Project Type).

     The server reads it from the dane\ folder next to public\ and exposes it
     at /api/valuation. If the file is missing or unreadable, the report falls
     back to the Jira EBITDA and says so on screen — nothing stops working. */
  valuation: {
    /* The workbook we were handed held THOUSANDS of PLN even though its
       headers said "(PLN)". Read literally, the whole portfolio came out worth
       a couple of hundred thousand zloty; read as thousands, the total matched
       the figure the previous report published. Hence this divisor — and hence
       the advice to reconcile one total by hand before trusting any of them. */
    divisor: 1000,

    /* The forecast horizon the workbook covers, in years. Replaces
       ebitdaYears above wherever the workbook supplies the figures. */
    years: 3,

    /* true -> the business category comes from the workbook's Project Type
       column. Jira had no classification field on the issue screen
       (customfield_11279 never comes back), so without the workbook the
       category tables stay empty. */
    useCategory: true,
  },

  // Schedule compliance: how far the current end date may drift from the
  // original one before a project counts as delayed or ahead of schedule.
  // Agreed with PMO as +/- 30 days; a 2-day drift is not a real change.
  scheduleToleranceDays: 30,

  // Window for the "launching soon" list on the structure page.
  launchWindowMonths: 1,

  // Used only if reference.json carries no benchmark for project duration.
  fallbackBenchmarkMonths: 19,

  /* ---- Reporting units ---------------------------------------------------
     Only these units enter the model: they fill the filter in the top bar and
     they are what "All units" adds up to. Anything else Jira returns is
     dropped, which is what keeps the filter list and the tile totals from
     drifting apart.

     Each unit is a rule: a Jira field plus the values that qualify for it. An
     issue joins the unit when the field carries ANY of the values — one is
     enough on a multi-select field. Case and surrounding spaces are ignored.

     'name'   what the report shows: in the filter, headers and commentary.
              It does not have to match anything in Jira.
     'field'  a key from CFG.fields above (reportingUnit, roadmap, ...).
     'values' the qualifying values.

     An issue may match more than one unit, and then it appears under each of
     them. Under "All units" it is counted ONCE, so the portfolio totals never
     double-count — but the units counted separately add up to more than the
     whole. The control line under the summary table says how many issues that
     affects. If membership has to be exclusive, add 'exclusive: true' to a
     rule: an issue matching it then belongs to that unit alone.

     Issues that match no rule at all do not enter the report.

     'People' is deliberately absent — the unit exists in Jira but has no
     portfolio yet. Add a rule when it does; nothing else needs changing. */
  units: [
    { name: 'Northwind Retail',  field: 'reportingUnit', values: ['Northwind Retail'] },
    { name: 'Finance & Legal', field: 'roadmap',       values: ['SSC'] },
  ],

  /* ---- Units without a strategic-initiatives page ------------------------
     For these units the "Strategic initiatives" tab disappears from the menu.
     The link matrix is maintained by the strategy team and does not cover them
     at all, so rather than an empty table — which reads as missing data — the
     page is simply not there.

     The tab disappears only when the WHOLE selection consists of such units.
     Under "All units" the report describes the entire portfolio, and selected
     together with another unit the matrix still says something; the tab stays
     in both cases.

     Names are spelled exactly as 'name' in CFG.units above. */
  hideStrategicFor: ['Finance & Legal'],

  /* ---- Strategic matrix ---------------------------------------------------
     The workbook behind the link matrix is maintained by the strategy team and
     uploaded through the report (the button on the Strategic initiatives page).
     The server keeps it in dane\ together with the date and the name of
     whoever sent it.

     staleAfterDays: how old an upload may get before the report starts warning
     that the matrix may no longer reflect reality. A copy is only as good as
     the last time someone remembered to send it, so the report says out loud
     how long ago that was. 0 switches the warning off. */
  reference: {
    staleAfterDays: 45,
  },

  /* ---- Business categories ---------------------------------------------
     The three categories, in the order they are displayed. */
  categories: ['Growth', 'Compliance', 'Maintenance'],

  /* Jira's "Project classification" (the MPR value) -> category. Matching
     ignores case and surrounding spaces. A value missing from this map counts
     as unclassified and gets a row of its own, never silently folded into one
     of the three — a project in the wrong bucket is worse than one visibly
     outside them.

     This mapping is maintained by PMO; it is the one agreed in Oct 2026. */
  categoryMap: {
    'Profit Improvement':  'Growth',
    'Asset Efficiency':    'Growth',
    'Asset Replacement':   'Maintenance',
    'Quality Improvement': 'Maintenance',
    'Legal Obligation':    'Compliance',
  },

  /* ---- JQL -------------------------------------------------------------
     The portfolio is Delivery + Analysis + Preparation. Done is included so
     that completed work still shows up in the strategic contribution matrix. */
  jql: 'project = PF AND type in (Project, Initiative) ' +
       'AND status in (Delivery, Analysis, Preparation, Done) ORDER BY key ASC',

  // Jira caps page size; api.js follows nextPageToken until the last page.
  pageSize: 100,

  /* ---- Data files ------------------------------------------------------- */
  paths: {
    demoIssues: 'data/demo-issues.json',
    reference:  'data/reference.json',
  },
};
