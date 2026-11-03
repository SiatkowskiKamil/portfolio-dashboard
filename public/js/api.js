/* ===========================================================================
   api.js — where data comes from
   ---------------------------------------------------------------------------
   Three sources, all producing the same shape so the rest of the app cannot
   tell them apart:

     1. loadDemo()     bundled demo dataset, for presentations and development
     2. parseMulti()   one or more Jira responses pasted by hand
     3. fetchLive()    the Jira REST API

   Output shape:  { asOf: ISO string, issues: [ { k, t, n, s, ru, rm, rag, own,
                                                  sd, dd, sdo, ddo, eb } ] }

   ON CORS — read before debugging a failed live fetch
   ---------------------------------------------------
   A browser will not let this page call atlassian.net directly: Atlassian does
   not return the headers that would permit it, and a page opened from a file
   has the origin "null", which is never permitted. This is browser policy, not
   a network or token problem, so a VPN makes no difference.

   The fix is CFG.apiBase: point it at our own backend, which holds the
   credentials and forwards the request server-side. Until that exists,
   fetchLive() fails with an explanation and the other two sources work.

   Depends on: config.js
   =========================================================================== */

const Api = {

  /* ---- Static files ---------------------------------------------------- */

  /**
   * Fetch and parse a JSON file shipped with the app.
   *
   * The single-file build (tools/build-single-file.js) inlines these files into
   * window.__EMBEDDED__ so that the bundle also works when opened straight from
   * disk, where fetch() of a neighbouring file is refused.
   */
  async loadJson(path) {
    if (window.__EMBEDDED__ && window.__EMBEDDED__[path]) return window.__EMBEDDED__[path];
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(t('msg.loadFailed', path, res.status));
    return res.json();
  },

  /** Demo dataset: already in our shape, no mapping needed. */
  async loadDemo() {
    const d = await Api.loadJson(CFG.paths.demoIssues);
    return { asOf: d.asOf, issues: d.issues };
  },

  /**
   * Reference data: strategic initiatives, their links, and benchmarks.
   * Maintained by people, so it is loaded in every mode including live Jira.
   * Benchmark keys are renamed to the short internal names the render layer
   * expects; keeping the JSON readable is worth this one small adapter.
   */
  async loadReference() {
    const r = await Api.loadJson(CFG.paths.reference);
    const out = {
      strategic: r.strategic || [],
      links: r.links || [],
      bench: (r.benchmarks || []).map(b => ({
        w: b.indicator, o: b.order, lab: b.columnLabel, dt: b.asOf, v: b.value,
      })),
      extras: [],
      // The note is stored as its PARTS, not as finished text: the language can
      // change while the page is open, and a sentence built at load time would
      // stay in whichever language happened to be active then.
      noteInfo: null,
      uploadedAt: '',
      uploadedBy: '',
      canUpload: Boolean(CFG.apiBase),
    };

    // The strategic matrix lives in an Excel workbook that the strategy team
    // edits. When the server can read it, it wins over the copy in
    // reference.json, which then only keeps the app working without a backend.
    // Benchmarks always come from the JSON: they are not in the workbook.
    if (CFG.apiBase) {
      try {
        const res = await fetch(CFG.apiBase + '/reference', { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
        out.strategic = body.strategic || [];
        out.links = body.links || [];
        out.uploadedAt = body.uploadedAt || '';
        out.uploadedBy = body.uploadedBy || '';
        out.canUpload = Boolean(body.canUpload);
        // Rows the sheet lists without a Jira number. They are shown in the
        // matrix from the workbook alone, with no status or RAG to fetch.
        out.extras = body.extras || [];
        out.noteInfo = {
          kind: 'ok',
          rows: body.rows + out.extras.length,
          sheet: body.sheet,
          extras: out.extras.length,
        };
      } catch (err) {
        // Never fail the whole load over this: the dashboard is still usable
        // without the matrix, but the user has to know the figures are stale.
        out.noteInfo = { kind: 'fail', err: err.message };
        out.stale = true;
      }
    }
    return out;
  },

  /**
   * Business-value workbook: per-year EBITDA and the project category.
   *
   * Never throws. A missing or unreadable file is a normal state — the page
   * then falls back to the Jira EBITDA and says so — and a dashboard that
   * refuses to open because a spreadsheet moved is worse than one that opens
   * with a visible gap.
   *
   * @returns {{byKey: Map, years: number[], sheets: string[], file: string,
   *            count: number, noteInfo: object|null, stale: boolean}}
   */
  async loadValuation() {
    const out = { byKey: new Map(), years: [], sheets: [], file: '', count: 0,
                  noteInfo: null, stale: false };
    if (!CFG.apiBase) {
      out.noteInfo = { kind: 'noserver' };
      out.stale = true;
      return out;
    }
    try {
      const res = await fetch(CFG.apiBase + '/valuation', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));

      const div = (CFG.valuation && CFG.valuation.divisor) || 1;
      (body.rows || []).forEach(r => {
        const lata = {};
        Object.keys(r.y || {}).forEach(y => {
          lata[y] = (r.y[y] === null || r.y[y] === undefined) ? null : r.y[y] / div;
        });
        out.byKey.set(String(r.k).trim().toUpperCase(), {
          eb3: (r.eb3 === null || r.eb3 === undefined) ? null : r.eb3 / div,
          lata,
          pt: r.pt || null,
          sheet: r.s || null,
        });
      });

      out.years  = body.years || [];
      out.sheets = body.sheets || [];
      out.file   = body.file || '';
      out.count  = out.byKey.size;
      out.noteInfo = { kind: 'ok', count: out.count, sheets: out.sheets, dups: 0 };
      if (body.dups && body.dups.length) out.noteInfo.dups = body.dups.length;
    } catch (err) {
      out.noteInfo = { kind: 'fail', err: err.message };
      out.stale = true;
    }
    return out;
  },

  /**
   * Send a new strategic-matrix workbook to the server.
   *
   * The file goes as the raw request body rather than as multipart: fetch()
   * sends a File object directly, and multipart would be parsing for its own
   * sake — on the PowerShell side especially.
   *
   * The server parses the workbook BEFORE it replaces anything, so a rejected
   * upload leaves the previous matrix untouched and the error says why.
   *
   * @param {File} file
   * @param {string} by  who is uploading — informational only; on the real
   *                     server the identity comes from Windows Authentication
   * @returns {Promise<object>} the parsed matrix, same shape as loadReference
   */
  async uploadReference(file, by) {
    if (!CFG.apiBase) throw new Error(t('stg.uploadNoServer'));
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (by) headers['X-Uploaded-By'] = by;

    const res = await fetch(CFG.apiBase + '/reference', { method: 'POST', headers, body: file });
    let body = {};
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  },

  /* ---- Pasted export --------------------------------------------------- */

  /**
   * Parse one or more Jira responses pasted one after another.
   *
   * Jira caps a response at CFG.pageSize issues, so a full portfolio arrives in
   * several chunks. Rather than make the user merge them, we accept them
   * concatenated: if the text is not valid JSON on its own, we assume several
   * documents and splice them into an array. Duplicate keys are dropped, so
   * overlapping pastes are harmless.
   *
   * @returns {{issues: Array, more: boolean}}  more = Jira signalled further pages
   */
  parseMulti(txt) {
    // Named `text`, not `t`: t() is the translation lookup from i18n.js and a
    // local of the same name would shadow it inside this function.
    const text = (txt || '').trim();
    if (!text) throw new Error(t('msg.pasteEmpty'));

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // "}{" between two documents becomes "},{" inside an array
      parsed = JSON.parse('[' + text.replace(/\}\s*\{/g, '},{') + ']');
    }

    const docs = Array.isArray(parsed) ? parsed : [parsed];
    const seen = new Set(), issues = [];
    let more = false;

    docs.forEach(d => {
      if (!d) return;
      if (d.nextPageToken) more = true;
      if (d.isLast === false) more = true;
      (d.issues || []).forEach(i => {
        const k = i && i.key;
        if (k && !seen.has(k)) { seen.add(k); issues.push(i); }
      });
    });

    if (!issues.length) throw new Error(t('msg.pasteNoIssues'));
    return { issues, more };
  },

  /* ---- Jira response mapping ------------------------------------------- */

  /**
   * Map a raw Jira REST response onto our shape.
   * Field IDs come from CFG.fields — do not hard-code them here.
   */
  fromJira(j) {
    const FIELDS = CFG.fields;

    // Select and user fields arrive as objects, plain fields as scalars, and a
    // multi-select as an array of objects. The array case is easy to miss:
    // typeof [] is 'object', so without this it would silently yield null.
    const opt = v => {
      if (v === null || v === undefined) return null;
      if (Array.isArray(v)) return v.length ? opt(v[0]) : null;
      if (typeof v === 'object') return v.value || v.name || null;
      return String(v);
    };

    // Multi-select: every value, not just the first. Roadmap is one of these —
    // a project sits on several roadmaps at once and we match on any of them,
    // so collapsing the array to its first element would lose the match.
    const optAll = v => {
      if (v === null || v === undefined) return [];
      if (Array.isArray(v)) return v.reduce((a, x) => a.concat(optAll(x)), []);
      if (typeof v === 'object') { const s = v.value || v.name; return s ? [String(s)] : []; }
      return [String(v)];
    };

    // A field entry in CFG.fields may be one ID or a list of candidate IDs.
    const ids = f => (f ? (Array.isArray(f) ? f : [f]) : []);

    // Jira dates may carry a time component; we only ever use the date part.
    const dt = v => v ? String(v).slice(0, 10) : null;

    return {
      asOf: new Date().toISOString(),
      issues: (j.issues || []).map(it => {
        const f = it.fields || {};

        // Roadmap may be configured as several candidate field IDs, because
        // three Jira fields carry that name. We take the values from whichever
        // ones answer, and record which did: that is how the dashboard tells
        // the operator which ID to keep in config.js.
        const rm = [], rmf = [];
        ids(FIELDS.roadmap).forEach(id => {
          const vs = optAll(f[id]);
          if (!vs.length) return;
          rmf.push(id);
          vs.forEach(v => { if (rm.indexOf(v) < 0) rm.push(v); });
        });

        return {
          k:   it.key,
          t:   (f.issuetype && f.issuetype.name) || null,
          n:   f.summary || null,
          s:   (f.status && f.status.name) || null,
          ru:  opt(f[FIELDS.reportingUnit]) || '(brak)',
          rm:  rm,     // Roadmap — all values
          rmf: rmf,    // which Roadmap field(s) they came from
          rag: opt(f[FIELDS.rag]) || '',
          own: (f.assignee && f.assignee.displayName) || null,
          sd:  dt(f[FIELDS.startDate]),
          dd:  dt(f.duedate),                       // built-in field
          sdo: dt(f[FIELDS.startOriginal]),
          ddo: dt(f[FIELDS.endOriginal]),
          eb:  f[FIELDS.ebitda] == null ? null : Number(f[FIELDS.ebitda]),
          cx:  f[FIELDS.capex]  == null ? null : Number(f[FIELDS.capex]),
          ox:  f[FIELDS.opex]   == null ? null : Number(f[FIELDS.opex]),
          cat: FIELDS.category ? opt(f[FIELDS.category]) : null,
        };
      }),
    };
  },

  /* ---- Live Jira -------------------------------------------------------- */

  /**
   * Comma-separated field list for the REST call.
   * Unconfigured fields are dropped: asking Jira for a field that does not
   * exist makes it reject the whole request with 400.
   */
  fieldList() {
    const f = CFG.fields;
    // Flattened, because a field may be configured as a list of candidate IDs
    // (see fields.roadmap in config.js).
    return [].concat('summary', 'issuetype', 'status', 'assignee', 'duedate',
      f.startDate, f.startOriginal, f.endOriginal,
      f.ebitda, f.capex, f.opex,
      f.rag, f.reportingUnit, f.category, f.roadmap,
    ).filter(Boolean).join(',');
  },

  /**
   * Fetch the whole portfolio, following pagination to the last page.
   *
   * @param {{base: string, email: string, token: string}} creds
   * @returns {Promise<object>} data in our shape
   * @throws {TypeError} when the browser blocks the request (CORS) — the caller
   *         distinguishes this from an HTTP error to show the right message.
   *
   * Whether credentials are sent is decided by CFG.auth, not by CFG.apiBase:
   * with 'server' the email/token arguments are ignored and the backend uses
   * its own account.
   */
  async fetchLive({ base, email, token }) {
    const viaProxy = !!CFG.apiBase;
    const root = viaProxy ? CFG.apiBase : base.replace(/\/+$/, '');
    const headers = { Accept: 'application/json' };

    // With CFG.auth === 'user' the credentials travel with every request: to
    // our proxy, which passes them straight to Jira, or to Jira itself when
    // there is no proxy. With 'server' the browser sends nothing and the
    // server uses its own account. btoa() only accepts Latin-1, so the string
    // is converted to UTF-8 bytes first; an accented name in an e-mail
    // address would otherwise throw.
    if (CFG.auth === 'user') {
      const raw = email + ':' + token;
      const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
      headers.Authorization = 'Basic ' + b64;
    }

    const all = [];
    let pageToken = null;
    // Hard stop: 50 pages is far beyond any realistic portfolio and prevents
    // an endless loop if the API keeps handing back a token.
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({
        jql: CFG.jql,
        maxResults: String(CFG.pageSize),
        fields: Api.fieldList(),
      });
      if (pageToken) q.set('nextPageToken', pageToken);

      const url = viaProxy
        ? `${root}/issues?${q}`
        : `${root}/rest/api/3/search/jql?${q}`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        // Our proxy replies with { error: "..." } written for the person in
        // front of the screen; Jira called directly does not, so fall back to
        // the status code.
        let msg = '';
        try { msg = (await res.json()).error || ''; } catch (e) { /* not JSON */ }
        if (!msg) msg = (res.status === 401 || res.status === 403)
          ? t('msg.authFailed')
          : t('msg.httpError', res.status);
        throw new Error(msg);
      }

      const body = await res.json();
      all.push(...(body.issues || []));
      pageToken = body.nextPageToken || null;
      if (!pageToken || body.isLast === true) break;
    }

    return Api.fromJira({ issues: all });
  },
};
