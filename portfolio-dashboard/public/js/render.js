/* ===========================================================================
   render.js — turns the model and the measures into HTML
   ---------------------------------------------------------------------------
   One function per page, each named render<Page>(). They all:
     * read the currently filtered rows through F() from measures.js,
     * write straight into the placeholder elements declared in index.html,
     * re-run from scratch on every change (no incremental updates).

   A full redraw with a few hundred rows is instant and removes a whole class
   of stale-view bugs, so nothing here tries to be clever about updating only
   what changed.

   NO DISPLAY TEXT LIVES IN THIS FILE. Every word the user reads comes from
   t() in i18n.js, which picks the Polish or English wording. Numbers, dates
   and HTML structure are built here; the sentences around them are not.

   Module-level state survives a redraw on purpose: strSel (the row clicked in
   the structure matrix), podsScope and soonScope (the Projects / Initiatives /
   Combined switches) and warMeasure (EBITDA / CAPEX / OPEX). renderAll() runs
   on every change of the reporting-unit filter and must not reset them.

   Depends on: config.js, i18n.js, utils.js, data.js, measures.js, tablefilter.js
   =========================================================================== */

/** Redraw every page. Called on boot and after any filter or language change. */
function renderAll() {
  renderSummary();
  renderStructure();
  renderValue();
  renderHealth();
  renderStrategy();
}

/* ---------------------------------------------------------------------------
   EBITDA horizon
   ---------------------------------------------------------------------------
   The report shows ONE horizon at a time and builds every label from it,
   otherwise two pages would quote different totals and no one would know
   which to use.

   Where it comes from: with the business-value workbook loaded, the figures
   are its three-year totals (CFG.valuation.years); without it they are the
   Jira field EBITDA [K], a five-year forecast (CFG.ebitdaYears). These are
   functions rather than constants because the workbook is fetched after this
   script has already been parsed.

   ebLabel() takes a Polish case ending, which the English dictionary ignores:
     ebLabel('a')  -> "3-letnia"  / "3-year"
     ebLabel('ą')  -> "3-letnią"  / "3-year"
     ebLabel('ej') -> "3-letniej" / "3-year"
   --------------------------------------------------------------------------- */

/** True when the business-value workbook supplied rows. */
const valOn = () => Boolean(STATE.val && STATE.val.count);

/** Length of the EBITDA forecast, in years. */
const EB_N = () => valOn()
  ? ((CFG.valuation && CFG.valuation.years) || (STATE.val.years || []).length || 3)
  : (CFG.ebitdaYears || 3);

/** Horizon label, declined for Polish. */
const ebLabel = form => t('ui.ebHorizon', EB_N(), form);

/** Years covered by the forecast: the workbook's real columns, or a span
 *  counted from the data year when the figures come from Jira. */
const ebSpan = year => {
  const years = valOn() ? (STATE.val.years || []) : [];
  return years.length
    ? `${years[0]}–${years[years.length - 1]}`
    : `${year}–${year + EB_N() - 1}`;
};

/* ---------------------------------------------------------------------------
   Small drawing helpers ($ and esc live in utils.js)
   --------------------------------------------------------------------------- */

/** Coloured RAG label. The value is also the CSS modifier, so it is not
 *  translated: Green / Amber / Red are the same words in both languages and
 *  the same words Jira stores. */
const ragChip = r => `<span class="chip rag-${r}"><i class="dot"></i>${r}</span>`;

/** CSS colour for a RAG value, for inline styling of bars and dots. */
const ragColor = r => r === 'Green' ? 'var(--color-rag-green)'
                    : r === 'Amber' ? 'var(--color-rag-amber)'
                    : r === 'Red'   ? 'var(--color-rag-red)'
                    : 'var(--color-rag-none)';

/** Issue key as a link into Jira, using the base URL of the loaded dataset. */
const jiraLink = k =>
  `<a class="jira" href="${STATE.base}/browse/${k}" target="_blank" rel="noopener">${k}</a>`;

/** The row of big numbers at the top of a page. */
function vitals(el, items) {
  el.innerHTML = items.map(i => `<div class="vital${i.flag ? ' flag' : ''}">
      <div class="v num">${i.v}${i.unit ? ` <small>${i.unit}</small>` : ''}</div>
      <div class="l">${i.l}</div></div>`).join('');
}

/** Wrap generated sentences in a commentary list. */
const commentList = sentences => sentences.map(s => `<li>${s}</li>`).join('');

/* ===========================================================================
   PAGE: SUMMARY
   =========================================================================== */

/* Which kind of work the summary table shows: 'proj', 'init' or 'both'. */
let podsScope = 'proj';

function renderSummary() {
  const rows = F();
  const portfolio = M.portfel(rows);
  const running = M.realizowane(portfolio);
  const year = YEAR();

  const projAll = M.proj(portfolio), initAll = M.init(portfolio);
  const projRun = M.proj(running),   initRun = M.init(running);

  // EBITDA covers both kinds of work. The split is kept because the Business
  // value page reports projects separately and the two pages have to reconcile.
  const ebProj = M.ebitda(projRun);
  const ebInit = M.ebitda(initRun);
  const ebAll  = M.ebitda(running);
  const noEbitda = running.filter(r => r.ebitda === null).length;

  const completingThisYear = projRun.filter(r => r.rokKonca === year).length;
  const startingProj = M.proj(portfolio).filter(r => r.startDoKoncaRoku).length;
  const startingInit = M.init(portfolio).filter(r => r.startDoKoncaRoku).length;

  const startedThisYear = M.proj(rows).filter(r =>
    r.rokStartu === year && (r.faza === 'Realizowane' || r.kategoria === 'Zakończone'));

  $('#pods-lede').textContent = t('pods.lede', [...STATE.sel]);

  // Four cards: scale, how much of it is running, what it is worth, what lands
  // this year. Planned launches and overdue starts are deliberately absent —
  // both have their own table on the Structure page, and the RAG breakdown is
  // on Business value and Health, so nothing is lost by leaving them out.
  vitals($('#pods-vitals'), [
    { v: fmt(portfolio.length), l: t('pods.cardPortfolio') },
    { v: fmt(running.length),   l: t('pods.cardRunning') },
    { v: ebAll ? fmt(Math.round(ebAll)) : '0', unit: t('ui.mln'), l: t('pods.cardEbitda') },
    { v: fmt(completingThisYear), l: t('pods.cardEnding', year) },
  ]);

  /* ---- commentary ---- */
  const c = [];
  c.push(t('pods.c1', portfolio.length, projAll.length, initAll.length));
  c.push(t('pods.c2', projRun.length, initRun.length, M.planowane(portfolio).length));
  c.push(t('pods.c3', year, completingThisYear, startingProj, startingInit));

  // One decimal place here, and the total is the sum of the ROUNDED parts
  // rather than the rounded total. Otherwise the sentence visibly fails to
  // add up: 233,5 + 67,3 is 300,8, while the exact total is 300,7.
  const round1 = v => Math.round(v * 10) / 10;
  const withEbProj = projRun.filter(r => r.ebitda !== null).length;
  const withEbInit = initRun.filter(r => r.ebitda !== null).length;
  c.push(t('pods.c4',
    withEbProj + withEbInit, running.length, ebLabel('a'),
    round1(ebProj) + round1(ebInit), ebSpan(year),
    ebProj, withEbProj, ebInit, withEbInit) +
    (noEbitda ? t('pods.c4missing', noEbitda, valOn()) : ''));

  c.push(ragSentence(projRun, 'proj', ebProj));
  c.push(ragSentence(initRun, 'init', ebInit));

  const avgSentence = durationSentence(startedThisYear, year);
  if (avgSentence) c.push(avgSentence);

  $('#pods-comment').innerHTML = commentList(c);

  /* ---- detail list of work in progress ---- */
  const both = podsScope === 'both';
  const scoped = podsScope === 'proj' ? projRun : podsScope === 'init' ? initRun : running;

  // EBITDA descending, with unfilled values last so the column reads top-down;
  // ties and whole groups without EBITDA fall back to the name, which keeps the
  // order stable between redraws.
  const sorted = [...scoped].sort((a, b) =>
       (a.ebitda === null) - (b.ebitda === null)
    || (b.ebitda || 0) - (a.ebitda || 0)
    || a.nazwa.localeCompare(b.nazwa, LANG));

  // The note counts what is on screen: with column filters on it is called
  // again with only the visible rows, so it never describes rows nobody sees.
  const note = list => {
    $('#pods-listnote').textContent = both
      ? t('pods.scopeNote',
          list.filter(r => r.typ === 'Project').length,
          list.filter(r => r.typ === 'Initiative').length)
      : t('ui.items', list.length);
  };
  note(sorted);

  const empty = podsScope === 'proj' ? t('pods.emptyProj')
              : podsScope === 'init' ? t('pods.emptyInit')
              : t('pods.emptyBoth');

  // data-i ties a table row to a model row, so that after column filtering the
  // note can be recomputed on the right set rather than on text scraped from
  // the HTML. Sorting reorders the rows, so the link must be the attribute.
  $('#pods-list').innerHTML =
    `<thead><tr><th>${t('ui.key')}</th>${both ? `<th>${t('ui.kind')}</th>` : ''}` +
    `<th>${t('ui.name')}</th><th>${t('ui.owner')}</th><th>${t('ui.status')}</th>` +
    `<th>${t('ui.end')}</th><th>${t('ui.rag')}</th>` +
    `<th class="n">${t('ui.ebitdaMln')}</th></tr></thead><tbody>` +
    (sorted.length ? sorted.map((r, i) => `<tr data-i="${i}">
      <td>${jiraLink(r.key)}</td>${both ? `<td class="mono-k">${esc(r.rodzaj)}</td>` : ''}
      <td class="nm">${esc(r.nazwa)}</td>
      <td class="mono-k">${esc(r.owner || '—')}</td>
      <td><span class="pill">${esc(r.status)}</span></td>
      <td class="mono-k">${dmy(r.dd)}</td>
      <td>${ragChip(r.rag)}</td>
      <td class="n">${r.ebitda !== null ? fmt1(r.ebitda) : '—'}</td></tr>`).join('')
     : `<tr><td colspan="${both ? 8 : 7}" class="empty">${empty}</td></tr>`) +
    `</tbody>`;

  TF.attach($('#pods-list'), {
    note: $('#pods-listnote'),
    onFilter: vis => note(vis.map(tr => sorted[+tr.dataset.i]).filter(Boolean)),
  });

  renderUnitDiagnostics();

  // The switch is static markup, so the handlers are reassigned on every
  // redraw. `onclick =` replaces rather than stacks, so nothing accumulates.
  // Only this page is redrawn: the choice changes no figure anywhere else.
  document.querySelectorAll('#pods-scope button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === podsScope);
    b.onclick = () => { podsScope = b.dataset.scope; renderSummary(); };
  });
}

/**
 * Unit-membership control line, under the summary table.
 *
 * The rules in CFG.units are not self-evident: Northwind Retail comes from the
 * Reporting Unit field, Finance & Legal from the Roadmap field containing
 * SSC. Without this line the only symptom of a wrong field ID would be an
 * empty unit — something that looks exactly like a real result. The line also
 * names which of the three Jira fields called "Roadmap" actually answered,
 * which is how CFG.fields.roadmap gets narrowed to one ID.
 */
function renderUnitDiagnostics() {
  const el = $('#pods-units');
  if (!el) return;
  const d = STATE.unitDiag;
  if (!d) { el.textContent = ''; return; }

  // Field keys are internal; these are the names people see in Jira.
  const FIELD_NAMES = {
    reportingUnit: 'Reporting Unit',
    roadmap: 'Roadmap',
    category: 'Project classification',
    rag: 'RAG',
  };

  const parts = d.units.map(u => t('diag.unit',
    esc(u.name), esc(FIELD_NAMES[u.field] || u.field), u.values.map(esc), u.n));

  let s = t('diag.units') + parts.join('; ') + '.';
  if (d.overlap) s += t('diag.overlap', d.overlap);
  if (d.dropped) s += t('diag.dropped', d.dropped);

  // Which Roadmap field delivered values. Demo data bypasses the Jira mapping
  // and carries no such information, so we stay silent rather than raise a
  // false alarm about a misconfigured field.
  const fields = Object.keys(d.roadmapFields || {});
  const roadmapUnits = d.units.filter(u => u.field === 'roadmap');
  if (fields.length) {
    s += t('diag.roadmapFrom',
      fields.map(id => `${esc(id)} (${fmt(d.roadmapFields[id])})`).join(', '));
  } else if (roadmapUnits.length && roadmapUnits.every(u => !u.n)) {
    s += t('diag.roadmapNone');
  }

  el.innerHTML = s;
}

/* ---------------------------------------------------------------------------
   Shared pieces: the RAG table, the RAG sentence, the duration benchmark
   --------------------------------------------------------------------------- */

/** RAG groups with their counts and EBITDA, in fixed severity order. */
function ragSummary(rows) {
  return ['Green', 'Amber', 'Red', 'Brak']
    .map(r => ({ rag: r, rows: rows.filter(x => x.rag === r) }))
    .filter(g => g.rows.length)
    .map(g => ({ rag: g.rag, n: g.rows.length, eb: M.ebitda(g.rows) }));
}

function ragTable(groups, total) {
  const n = groups.reduce((s, g) => s + g.n, 0);
  return `<thead><tr><th>${t('ui.rag')}</th><th class="n">${t('ui.projects')}</th>` +
    `<th class="n">${t('ui.ebHorizonTable', EB_N())}</th>` +
    `<th class="n">${t('ui.share')}</th></tr></thead><tbody>` +
    (groups.length ? groups.map(g => `<tr>
      <td>${ragChip(g.rag)}</td>
      <td class="n">${fmt(g.n)}</td>
      <td class="n">${fmt1(g.eb)}</td>
      <td class="n">${pct(g.eb, total)}</td></tr>`).join('')
     : `<tr><td colspan="4" class="empty">${t('ui.noData')}</td></tr>`) +
    (groups.length ? `<tr class="total"><td>${t('ui.total')}</td><td class="n">${fmt(n)}</td>
      <td class="n">${fmt1(total)}</td><td class="n">100%</td></tr>` : '') +
    `</tbody>`;
}

/**
 * "Of N projects in progress, X are Green…" plus the EBITDA behind each status.
 * @param {string} kind 'proj' or 'init' — the two read differently in Polish.
 */
function ragSentence(rows, kind, eb) {
  const n = rows.length;
  if (!n) return t(kind === 'proj' ? 'rag.noneProj' : 'rag.noneInit');

  const green = rows.filter(r => r.rag === 'Green').length;
  const amber = rows.filter(r => r.rag === 'Amber').length;
  const red   = rows.filter(r => r.rag === 'Red').length;
  let s = t('rag.sentence', kind, n, green, amber, red, n - green - amber - red);

  if (eb) {
    const parts = [];
    [['Green', green], ['Amber', amber], ['Red', red]].forEach(([name, count]) => {
      if (!count) return;
      const v = M.ebitda(rows.filter(r => r.rag === name));
      parts.push(t('rag.ebitdaPart', name, v, pct(v, eb)));
    });
    if (parts.length) s += t('rag.ebitdaParts', parts);
  }
  return s;
}

/**
 * Average planned duration of this year's projects against the stored
 * benchmark. Returns '' when there is nothing to compare.
 */
function durationSentence(startedThisYear, year) {
  if (!startedThisYear.length) return '';
  const months = Math.round(M.srednia(startedThisYear, r => r.czasPlan) || 0);
  const bench = benchValue();
  const withPlan = startedThisYear.filter(r => r.czasPlan !== null).length;

  let diffText = '';
  if (bench.v !== null) {
    const diff = Math.abs(bench.v - months);
    diffText = months < bench.v ? t('kon.diffShorter', diff)
             : months > bench.v ? t('kon.diffLonger', diff)
             : t('kon.diffSame');
  }
  return t('kon.avgDuration', year, months, bench.v, bench.label, diffText, withPlan);
}

/**
 * The duration benchmark from reference.json, with the month name declined
 * for Polish. Falls back to the figure in config.js when the reference data
 * carries no benchmark for this indicator.
 */
function benchValue() {
  const rows = STATE.bench.filter(x => x.w === 'Średnia projektu (mies.)');
  if (!rows.length) {
    return { v: CFG.fallbackBenchmarkMonths, label: t('kon.benchFallback') };
  }
  const last = rows.slice().sort((a, b) => a.dt < b.dt ? 1 : -1)[0];

  // "Analiza grudzień 2025" -> "grudnia 2025 roku". Polish needs the genitive;
  // English keeps the nominative month name, so the map is only applied when
  // the report is in Polish.
  const GENITIVE = {
    styczeń: 'stycznia', luty: 'lutego', marzec: 'marca', kwiecień: 'kwietnia',
    maj: 'maja', czerwiec: 'czerwca', lipiec: 'lipca', sierpień: 'sierpnia',
    wrzesień: 'września', październik: 'października', listopad: 'listopada',
    grudzień: 'grudnia',
  };
  const ENGLISH = {
    styczeń: 'January', luty: 'February', marzec: 'March', kwiecień: 'April',
    maj: 'May', czerwiec: 'June', lipiec: 'July', sierpień: 'August',
    wrzesień: 'September', październik: 'October', listopad: 'November',
    grudzień: 'December',
  };

  let label = last.lab.replace(/^Analiza\s+/i, '').trim();
  const m = label.match(/^(\S+)\s+(\d{4})$/);
  if (m) {
    const month = m[1].toLowerCase();
    label = LANG === 'en'
      ? (ENGLISH[month] || m[1]) + ' ' + m[2]
      : (GENITIVE[month] || month) + ' ' + m[2] + ' roku';
  }
  return { v: last.v, label };
}

/* ===========================================================================
   PAGE: PORTFOLIO STRUCTURE
   =========================================================================== */

/** Row clicked in the structure matrix, or null. Stores the group's stable
 *  key, not its label, so the selection survives a language change. */
let strSel = null;

/** Which kind of work the "Upcoming starts" table shows. */
let soonScope = 'both';

function renderStructure() {
  const portfolio = M.portfel(F());
  const year = YEAR();

  // Each group carries a language-independent key for the click state and a
  // test against the model. The labels come from the dictionary at draw time.
  const groups = [
    {
      key: 'running', label: t('str.running'), phase: 'Realizowane',
      children: [
        { key: 'delivery', label: 'Delivery', test: r => r.status === 'Delivery' },
        { key: 'analysis', label: 'Analysis', test: r => r.status === 'Analysis' },
      ],
    },
    {
      key: 'planned', label: t('str.planned'), phase: 'Planowane',
      children: [
        { key: 'startBy',   label: t('str.startBy', year),
          test: r => r.podgrupa === 'Start do końca ' + year },
        // The label was shortened at the report owner's request; the grouping
        // is unchanged, so the test still matches the full subgroup value
        // written by data.js, which covers year+1 and everything after it.
        { key: 'startFrom', label: t('str.startFrom', year + 1),
          test: r => r.podgrupa === 'Start ' + (year + 1) + ' i później' },
        { key: 'noStart',   label: t('str.noStart'),
          test: r => r.podgrupa === 'Brak daty startu' },
      ],
    },
  ];

  const countOf = (rows, type) => rows.filter(r => r.typ === type).length;

  let html = `<thead><tr><th>${t('ui.phase')}</th><th class="n">${t('ui.projects')}</th>` +
    `<th class="n">${t('ui.initiatives')}</th><th class="n">${t('ui.total')}</th></tr></thead><tbody>`;

  groups.forEach(g => {
    const rows = portfolio.filter(r => r.faza === g.phase);
    html += `<tr class="sub pick" data-sel="${esc(g.key)}"><td>${esc(g.label)}</td>
      <td class="n">${fmt(countOf(rows, 'Project'))}</td>
      <td class="n">${fmt(countOf(rows, 'Initiative'))}</td>
      <td class="n">${fmt(rows.length)}</td></tr>`;
    g.children.forEach(c => {
      const sub = rows.filter(c.test);
      if (!sub.length) return;
      html += `<tr class="pick" data-sel="${esc(c.key)}"><td class="indent">${esc(c.label)}</td>
        <td class="n">${fmt(countOf(sub, 'Project'))}</td>
        <td class="n">${fmt(countOf(sub, 'Initiative'))}</td>
        <td class="n">${fmt(sub.length)}</td></tr>`;
    });
  });
  html += `<tr class="total"><td>${t('ui.sum')}</td>
    <td class="n">${fmt(countOf(portfolio, 'Project'))}</td>
    <td class="n">${fmt(countOf(portfolio, 'Initiative'))}</td>
    <td class="n">${fmt(portfolio.length)}</td></tr></tbody>`;

  const matrix = $('#str-matrix');
  matrix.innerHTML = html;
  matrix.querySelectorAll('tr.pick').forEach(tr => {
    tr.style.cursor = 'pointer';
    if (tr.dataset.sel === strSel) tr.style.outline = '2px solid var(--color-ring)';
    tr.onclick = () => {
      strSel = strSel === tr.dataset.sel ? null : tr.dataset.sel;
      renderStructure();
    };
  });

  /* ---- detail list, narrowed by the row clicked in the matrix ---- */
  let detail = portfolio;
  let selLabel = '';
  if (strSel) {
    const g = groups.find(x => x.key === strSel);
    if (g) {
      detail = portfolio.filter(r => r.faza === g.phase);
      selLabel = g.label;
    } else {
      for (const group of groups) {
        const child = group.children.find(x => x.key === strSel);
        if (child) {
          detail = portfolio.filter(r => r.faza === group.phase).filter(child.test);
          selLabel = child.label;
          break;
        }
      }
    }
  }

  const detailSorted = [...detail].sort((a, b) => (a.sd ? a.sd : 0) - (b.sd ? b.sd : 0));
  const detailNote = n =>
    $('#str-detnote').textContent = (selLabel ? selLabel + ' · ' : '') + t('ui.items', n);
  detailNote(detail.length);

  $('#str-detail').innerHTML =
    `<thead><tr><th>${t('ui.key')}</th><th>${t('ui.name')}</th><th>${t('ui.type')}</th>` +
    `<th>${t('ui.start')}</th><th>${t('ui.end')}</th><th>${t('ui.rag')}</th></tr></thead><tbody>` +
    (detailSorted.length ? detailSorted.map(r => `<tr>
      <td>${jiraLink(r.key)}</td><td class="nm">${esc(r.nazwa)}</td>
      <td class="mono-k">${esc(r.rodzaj)}</td>
      <td class="mono-k">${dmy(r.sd)}</td><td class="mono-k">${dmy(r.dd)}</td>
      <td>${ragChip(r.rag)}</td></tr>`).join('')
     : `<tr><td colspan="6" class="empty">${t('str.emptyDetail')}</td></tr>`) + `</tbody>`;
  TF.attach($('#str-detail'), { note: $('#str-detnote'), onFilter: vis => detailNote(vis.length) });

  /* ---- commentary ---- */
  const running = M.realizowane(portfolio), planned = M.planowane(portfolio);
  const startProj = M.proj(portfolio).filter(r => r.startDoKoncaRoku).length;
  const startInit = M.init(portfolio).filter(r => r.startDoKoncaRoku).length;
  const starting = startProj + startInit;

  $('#str-comment').innerHTML = commentList([
    t('str.c1', portfolio.length, M.proj(portfolio).length, M.init(portfolio).length),
    t('str.c2', running.length, planned.length),
    starting ? t('str.c3', starting, startProj, startInit, year) : t('str.c3none', year),
  ]);

  /* ---- launches planned within the next window ---- */
  const today = TODAY();
  const until = new Date(today);
  until.setMonth(until.getMonth() + CFG.launchWindowMonths);
  const soonAll = portfolio
    .filter(r => r.wPrzygotowaniu && r.sd && r.sd >= today && r.sd <= until)
    .sort((a, b) => a.sd - b.sd);

  // Same rule for the Type column as on the summary table: shown only in the
  // combined view. Narrowed to one kind it would repeat the same word down
  // the whole page.
  const soonBoth = soonScope === 'both';
  const soon = soonScope === 'proj' ? M.proj(soonAll)
             : soonScope === 'init' ? M.init(soonAll)
             : soonAll;

  const soonNote = n =>
    $('#str-soonnote').textContent = t('str.soonNote', dmy(today), dmy(until), n);
  soonNote(soon.length);

  const soonEmpty = soonScope === 'proj' ? t('str.soonEmptyProj')
                  : soonScope === 'init' ? t('str.soonEmptyInit')
                  : t('str.soonEmptyBoth');

  $('#str-soon').innerHTML =
    `<thead><tr><th>${t('ui.key')}</th><th>${t('ui.name')}</th>` +
    (soonBoth ? `<th>${t('ui.type')}</th>` : '') +
    `<th>${t('ui.start')}</th></tr></thead><tbody>` +
    (soon.length ? soon.map(r => `<tr><td>${jiraLink(r.key)}</td><td class="nm">${esc(r.nazwa)}</td>
      ${soonBoth ? `<td class="mono-k">${esc(r.rodzaj)}</td>` : ''}
      <td class="mono-k">${dmy(r.sd)}</td></tr>`).join('')
     : `<tr><td colspan="${soonBoth ? 4 : 3}" class="empty">${soonEmpty}</td></tr>`) + `</tbody>`;
  TF.attach($('#str-soon'), { note: $('#str-soonnote'), onFilter: vis => soonNote(vis.length) });

  document.querySelectorAll('#str-soonscope button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === soonScope);
    b.onclick = () => { soonScope = b.dataset.scope; renderStructure(); };
  });
}

/* ===========================================================================
   PAGE: BUSINESS VALUE
   =========================================================================== */

/** Which money column the bottom table shows. */
let warMeasure = 'ebitda';

/* 'ebitda' reads the ebW field, which is the business-value workbook's total
   when the workbook is loaded and the Jira figure when it is not — see
   data.js. The label is built at draw time because it carries the horizon. */
const MEASURES = {
  ebitda: { label: 'EBITDA', key: 'ebW' },
  capex:  { label: 'CAPEX',  key: 'capex' },
  opex:   { label: 'OPEX',   key: 'opex' },
};

function renderValue() {
  const rows = F();
  const running = M.realizowane(M.portfel(rows));
  const projRun = M.proj(running);
  const year = YEAR();

  const fromFile = valOn();
  const years = (STATE.val && STATE.val.years) || [];

  const eb = M.suma(projRun, 'ebW');
  const capex = M.suma(projRun, 'capex');
  const opex = M.suma(projRun, 'opex');

  // Category comes from the workbook's Project Type column, or from a Jira
  // field when one is configured.
  const hasCategory = fromFile ? true : Boolean(CFG.fields.category);
  const inWorkbook = projRun.filter(r => r.wArkuszu).length;
  const DASH = '—';

  $('#war-lede').textContent = t('war.lede', ebLabel('a'), ebSpan(year));

  /* ---- category split, two tables as in the original report ---- */
  const catGroups = hasCategory
    ? M.wgKategorii(projRun)
    : CFG.categories.map(c => ({ k: c, rows: [] }));

  $('#war-catnote').textContent = hasCategory ? t('war.catShares') : t('war.catWaiting');
  $('#war-cat2note').textContent = t('war.catValues');

  // Shares. Deliberately the same five columns as the Confluence report, so
  // the two can be put side by side during the handover.
  $('#war-cat').innerHTML =
    `<thead><tr><th>${t('ui.category')}</th><th class="n">${t('ui.projects')}</th>` +
    `<th class="n">${t('ui.share')}</th><th class="n">CAPEX</th><th class="n">OPEX</th>` +
    `<th class="n">${ebLabel('a')} EBITDA</th></tr></thead><tbody>` +
    catGroups.map(g => {
      if (!hasCategory) {
        return `<tr><td>${esc(g.k)}</td>` + `<td class="n">${DASH}</td>`.repeat(5) + `</tr>`;
      }
      return `<tr><td>${esc(g.k)}</td>
        <td class="n">${fmt(g.rows.length)}</td>
        <td class="n">${pct(g.rows.length, projRun.length)}</td>
        <td class="n">${pct(M.suma(g.rows, 'capex'), capex)}</td>
        <td class="n">${pct(M.suma(g.rows, 'opex'), opex)}</td>
        <td class="n">${pct(M.suma(g.rows, 'ebW'), eb)}</td></tr>`;
    }).join('') +
    (hasCategory ? `<tr class="total"><td>${t('ui.total')}</td>
      <td class="n">${fmt(projRun.length)}</td>` + `<td class="n">100%</td>`.repeat(4) + `</tr>` : '') +
    `</tbody>`;

  // Amounts, with the per-year EBITDA split the original report wanted and
  // Jira could not provide. Year columns appear only with the workbook loaded.
  const yearTotal = (list, y) => list.reduce((s, r) => s + ((r.ebLata && r.ebLata[y]) || 0), 0);

  $('#war-cat2').innerHTML =
    `<thead><tr><th>${t('ui.category')}</th><th class="n">${t('ui.projects')}</th>` +
    `<th class="n">${t('ui.capexMln')}</th><th class="n">${t('ui.opexMln')}</th>` +
    (fromFile ? years.map(y => `<th class="n">${t('war.ebitdaYear', y)}</th>`).join('') : '') +
    `<th class="n">${t('ui.ebHorizonTable', EB_N())}</th></tr></thead><tbody>` +
    catGroups.map(g => {
      if (!hasCategory) {
        return `<tr><td>${esc(g.k)}</td>` + `<td class="n">${DASH}</td>`.repeat(4) + `</tr>`;
      }
      return `<tr><td>${esc(g.k)}</td>
        <td class="n">${fmt(g.rows.length)}</td>
        <td class="n">${fmt1(M.suma(g.rows, 'capex'))}</td>
        <td class="n">${fmt1(M.suma(g.rows, 'opex'))}</td>` +
        (fromFile ? years.map(y => `<td class="n">${fmt1(yearTotal(g.rows, y))}</td>`).join('') : '') +
        `<td class="n">${fmt1(M.suma(g.rows, 'ebW'))}</td></tr>`;
    }).join('') +
    (hasCategory ? `<tr class="total"><td>${t('ui.total')}</td>
      <td class="n">${fmt(projRun.length)}</td>
      <td class="n">${fmt1(capex)}</td><td class="n">${fmt1(opex)}</td>` +
      (fromFile ? years.map(y => `<td class="n">${fmt1(yearTotal(projRun, y))}</td>`).join('') : '') +
      `<td class="n">${fmt1(eb)}</td></tr>` : '') +
    `</tbody>`;

  // The footnote always states where the figures came from, including the case
  // where the workbook failed to load. A missing workbook used to show up only
  // as an empty category table — the worst kind of failure, the silent one.
  // Built here, not at load time: the note has to follow the language switch,
  // and the language can change long after the workbook was read.
  const valNote = STATE.val && STATE.val.noteInfo
    ? esc(t('msg.valNoteFull', STATE.val.noteInfo)) : '';
  $('#war-catsrc').innerHTML = fromFile
    ? t('war.catSrcFile',
        esc(STATE.val.file || 'wartosc_biznesowa.xlsx'), valNote,
        years, ebLabel('ą'), inWorkbook, projRun.length,
        projRun.length - inWorkbook, inWorkbook === 0)
    : t('war.catSrcNoFile', valNote, EB_N(), hasCategory);

  /* ---- by planned completion year ---- */
  const endYears = [...new Set(projRun.map(r => r.rokKonca).filter(Boolean))].sort();
  const byYear = endYears.map(y => {
    const g = projRun.filter(r => r.rokKonca === y);
    return { y, n: g.length, eb: M.suma(g, 'ebW') };
  });
  const noEndDate = projRun.filter(r => !r.rokKonca);
  if (noEndDate.length) {
    byYear.push({ y: t('war.noEndDate'), n: noEndDate.length, eb: M.suma(noEndDate, 'ebW') });
  }

  $('#war-year').innerHTML =
    `<thead><tr><th>${t('war.yearCol')}</th><th class="n">${t('ui.projects')}</th>` +
    `<th class="n">${t('ui.ebHorizonTable', EB_N())}</th>` +
    `<th class="n">${t('ui.share')}</th></tr></thead><tbody>` +
    (byYear.length ? byYear.map(r => `<tr><td>${esc(String(r.y))}</td>
      <td class="n">${fmt(r.n)}</td>
      <td class="n">${fmt1(r.eb)}</td><td class="n">${pct(r.eb, eb)}</td></tr>`).join('')
     : `<tr><td colspan="4" class="empty">${t('ui.noData')}</td></tr>`) +
    (byYear.length ? `<tr class="total"><td>${t('ui.total')}</td>
      <td class="n">${fmt(projRun.length)}</td>
      <td class="n">${fmt1(eb)}</td><td class="n">100%</td></tr>` : '') + `</tbody>`;

  /* ---- in progress and already delivered ---- */
  // Value already banked next to value still being built. Completed work sits
  // outside the portfolio, so it is taken from the unfiltered set.
  const doneProj = M.proj(M.zakonczone(rows));
  const buckets = [
    { l: t('war.groupRunning'),                      rows: projRun },
    { l: t('war.groupDoneYear', year),               rows: doneProj.filter(r => r.rokKonca === year) },
    { l: t('war.groupDoneRange', year - 2, year - 1), rows: doneProj.filter(r => r.rokKonca === year - 1 || r.rokKonca === year - 2) },
    { l: t('war.groupDoneOlder'),                    rows: doneProj.filter(r => r.rokKonca !== null && r.rokKonca < year - 2) },
  ].filter(b => b.rows.length);

  const doneCount = buckets.reduce((s, b) => s + b.rows.length, 0);
  const doneEbitda = buckets.reduce((s, b) => s + M.suma(b.rows, 'ebW'), 0);

  $('#war-done').innerHTML =
    `<thead><tr><th>${t('war.group')}</th><th class="n">${t('ui.projects')}</th>` +
    `<th class="n">${t('ui.ebHorizonTable', EB_N())}</th></tr></thead><tbody>` +
    (buckets.length ? buckets.map(b => `<tr><td>${esc(b.l)}</td>
      <td class="n">${fmt(b.rows.length)}</td>
      <td class="n">${fmt1(M.suma(b.rows, 'ebW'))}</td></tr>`).join('')
     : `<tr><td colspan="3" class="empty">${t('ui.noData')}</td></tr>`) +
    (buckets.length ? `<tr class="total"><td>${t('ui.total')}</td><td class="n">${fmt(doneCount)}</td>
      <td class="n">${fmt1(doneEbitda)}</td></tr>` : '') + `</tbody>`;
  $('#war-donesrc').textContent = t('war.doneSrc');

  /* ---- commentary ---- */
  const withEbitda = projRun.filter(r => r.ebW !== null && r.ebW !== undefined).length;
  const c = [];
  c.push(t('war.c1', withEbitda, ebLabel('ą'), eb, ebSpan(year)) +
    (withEbitda < projRun.length
      ? t('war.c1missing', projRun.length - withEbitda, projRun.length)
      : '.'));

  if (fromFile && years.length) {
    c.push(t('war.c1years', years.map(y => t('war.c1year', y, yearTotal(projRun, y)))));
  }

  if (hasCategory) {
    const growth = (M.wgKategorii(projRun).find(x => x.k === 'Growth') || { rows: [] }).rows;
    const growthEb = M.suma(growth, 'ebW');
    const growthCapex = M.suma(growth, 'capex');
    c.push(t('war.cGrowthShare', pct(growth.length, projRun.length), growth.length, projRun.length));
    c.push(t('war.cGrowthEbitda', pct(growthEb, eb), ebLabel('ej'), growthEb));
    c.push(t('war.cGrowthCapex', pct(growthCapex, capex)));
  } else {
    c.push(t('war.cNoCat'));
  }

  const missingEbitda = M.braki(projRun, 'ebW');
  const missingCapex = M.braki(projRun, 'capex');
  c.push(t('war.cBudget', capex, opex) +
    (missingCapex ? t('war.cBudgetMissing', missingCapex) : ''));
  if (missingEbitda) c.push(t('war.cEbMissing', missingEbitda, fromFile));
  $('#war-comment').innerHTML = commentList(c);

  /* ---- the two named tables from the original report ---- */
  // Compliance projects that nonetheless earn money. The point of the table is
  // that it is counter-intuitive, so it stays on the page even when empty.
  const compliance = hasCategory
    ? projRun.filter(r => r.kategoriaBiz === 'Compliance' && r.ebW > 0).sort((a, b) => b.ebW - a.ebW)
    : [];
  const compNote = n =>
    $('#war-compnote').textContent = hasCategory ? t('ui.items', n) : t('war.compWaiting');
  compNote(compliance.length);

  $('#war-comp').innerHTML =
    `<thead><tr><th>${t('ui.key')}</th><th>${t('ui.project')}</th>` +
    `<th class="n">${t('ui.ebitdaMln')}</th></tr></thead><tbody>` +
    (compliance.length ? compliance.map(r => `<tr>
      <td>${jiraLink(r.key)}</td><td class="nm">${esc(r.nazwa)}</td>
      <td class="n">${fmt1(r.ebW)}</td></tr>`).join('')
     : `<tr><td colspan="3" class="empty">${hasCategory ? t('war.compEmpty') : t('war.compNoCat')}</td></tr>`) +
    `</tbody>`;
  TF.attach($('#war-comp'), { note: $('#war-compnote'), onFilter: vis => compNote(vis.length) });

  // Completions this year. Month precision only: a day-exact date on a plan
  // twelve months out is false precision, and the original reports a month.
  const ending = projRun.filter(r => r.rokKonca === year && r.dd).sort((a, b) => a.dd - b.dd);
  $('#war-koncehead').textContent = t('war.konceHead', year);
  const endingNote = n => $('#war-koncenote').textContent = t('ui.items', n);
  endingNote(ending.length);

  $('#war-konce').innerHTML =
    `<thead><tr><th>${t('ui.key')}</th><th>${t('ui.project')}</th>` +
    `<th>${t('ui.deadline')}</th><th>${t('ui.rag')}</th></tr></thead><tbody>` +
    (ending.length ? ending.map(r => `<tr>
      <td>${jiraLink(r.key)}</td><td class="nm">${esc(r.nazwa)}</td>
      <td class="mono-k">${mmyyyy(r.dd)}</td>
      <td>${ragChip(r.rag)}</td></tr>`).join('')
     : `<tr><td colspan="4" class="empty">${t('war.konceEmpty')}</td></tr>`) + `</tbody>`;
  TF.attach($('#war-konce'), { note: $('#war-koncenote'), onFilter: vis => endingNote(vis.length) });

  /* ---- detail table, switchable between the three money columns ---- */
  const measureKey = MEASURES[warMeasure] ? warMeasure : 'ebitda';
  const measure = MEASURES[measureKey];
  const field = measure.key;
  const head = measureKey === 'ebitda'
    ? t('ui.ebHorizonTable', EB_N())
    : measure.label + ' (' + t('ui.mln') + ')';
  // Year columns only for EBITDA, and only from a loaded workbook.
  const yearCols = (measureKey === 'ebitda' && fromFile) ? years : [];

  const sorted = [...projRun].sort((a, b) =>
       (a[field] === null) - (b[field] === null)
    || (b[field] || 0) - (a[field] || 0)
    || a.nazwa.localeCompare(b.nazwa, LANG));

  // Bar width uses the absolute value: the workbook contains projects with
  // negative EBITDA, and without this their bar would have negative width.
  const max = Math.max(...sorted.map(r => Math.abs(r[field] || 0)), 1);

  const listNote = list => $('#war-listnote').textContent =
    t('war.listNote', list.length, M.suma(list, field), M.braki(list, field));
  listNote(sorted);

  $('#war-list').innerHTML =
    `<thead><tr><th>${t('ui.key')}</th><th>${t('ui.name')}</th><th>${t('ui.rag')}</th>` +
    `<th>${t('ui.end')}</th>` +
    yearCols.map(y => `<th class="n">${y}</th>`).join('') +
    `<th class="n">${esc(head)}</th>` +
    `<th style="width:150px">${t('ui.share')}</th></tr></thead><tbody>` +
    (sorted.length ? sorted.map((r, i) => {
      const v = r[field];
      // A negative bar is drawn red whatever the RAG status: a green bar on a
      // negative amount reads as exactly the opposite of what it means.
      const colour = (v !== null && v < 0) ? 'var(--color-rag-red)' : ragColor(r.rag);
      return `<tr data-i="${i}">
      <td>${jiraLink(r.key)}</td><td class="nm">${esc(r.nazwa)}</td><td>${ragChip(r.rag)}</td>
      <td class="mono-k">${dmy(r.dd)}</td>` +
      yearCols.map(y => {
        const yv = r.ebLata && r.ebLata[y];
        return `<td class="n mono-k">${yv === null || yv === undefined ? '—' : fmt1(yv)}</td>`;
      }).join('') +
      `<td class="n">${v !== null && v !== undefined ? fmt1(v) : '—'}</td>
      <td><div class="track"><div class="fill" style="width:${(Math.abs(v || 0) / max * 100).toFixed(1)}%;background:${colour}"></div></div></td>
      </tr>`;
    }).join('')
     : `<tr><td colspan="${6 + yearCols.length}" class="empty">${t('war.listEmpty')}</td></tr>`) +
    `</tbody>`;

  TF.attach($('#war-list'), {
    note: $('#war-listnote'),
    onFilter: vis => listNote(vis.map(tr => sorted[+tr.dataset.i]).filter(Boolean)),
  });

  $('#war-src').textContent = fromFile
    ? t('war.srcFile', STATE.val.file || 'wartosc_biznesowa.xlsx', years, ebLabel('a'))
    : t('war.srcJira', EB_N());

  document.querySelectorAll('#war-measure button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.measure === measureKey);
    b.onclick = () => { warMeasure = b.dataset.measure; renderValue(); };
  });
}

/* ===========================================================================
   PAGE: PORTFOLIO HEALTH
   =========================================================================== */

function renderHealth() {
  const running = M.realizowane(M.portfel(F()));
  const projRun = M.proj(running);
  const year = YEAR();

  $('#kon-rag').innerHTML = ragTable(ragSummary(projRun), M.ebitda(projRun));

  // Only projects with both a baseline and a current end date can be judged
  // against the original schedule; schedOrd 1..3 are exactly those.
  const analysed = projRun.filter(r => r.schedOrd <= 3).length;
  const onTime = projRun.filter(r => r.sched === 'Zgodne z harmonogramem').length;
  const delayed = projRun.filter(r => r.sched === 'Opóźnione');
  const ahead = projRun.filter(r => r.sched === 'Przyspieszone').length;
  const noBaseline = projRun.filter(r => r.schedOrd >= 8).length;

  const startedThisYear = M.proj(F()).filter(r =>
    r.rokStartu === year && (r.faza === 'Realizowane' || r.kategoria === 'Zakończone'));

  const c = [];
  c.push(ragSentence(projRun, 'proj', M.ebitda(projRun)));

  c.push(analysed
    ? t('kon.onTime', pct(onTime, analysed), onTime, analysed) +
      (noBaseline ? t('kon.noBaseline', noBaseline) : '')
    : t('kon.noAnalysed'));

  if (delayed.length) {
    const months = Math.round(M.srednia(delayed, r => r.shiftM) || 0);
    const thisYear = delayed.filter(r => r.rokStartu === year).length;
    c.push(t('kon.delayed', pct(delayed.length, analysed), delayed.length, months) +
      (thisYear ? t('kon.delayedThisYear', thisYear, year) : t('kon.delayedNoneThisYear', year)) +
      (ahead ? t('kon.ahead', ahead) : ''));
  } else {
    c.push(t('kon.noDelays'));
  }

  const avgSentence = durationSentence(startedThisYear, year);
  if (avgSentence) c.push(avgSentence);

  $('#kon-comment').innerHTML = commentList(c);
}

/* ===========================================================================
   PAGE: STRATEGIC CONTRIBUTION
   =========================================================================== */

function renderStrategy() {
  const rows = F();
  const byKey = new Map(rows.map(r => [r.key, r]));

  // Where the matrix came from, and how old it is. A silently stale matrix
  // looks exactly like a correct one, so the header says when it arrived and
  // warns once it is older than CFG.reference.staleAfterDays. The copy is only
  // as good as the last time somebody remembered to send it.
  const src = $('#stg-src');
  let srcText = STATE.refNoteInfo ? esc(t('msg.refNoteFull', STATE.refNoteInfo)) : '';
  let stale = Boolean(STATE.refStale);

  if (STATE.refUploadedAt) {
    const when = new Date(STATE.refUploadedAt);
    if (!isNaN(when)) {
      srcText += t('stg.uploadedAt', dmy(when), esc(STATE.refUploadedBy || ''));
      const days = Math.floor((TODAY() - when) / 86400000);
      const limit = (CFG.reference && CFG.reference.staleAfterDays) || 0;
      if (limit && days > limit) { srcText += t('stg.uploadStale', days); stale = true; }
    }
  }
  src.innerHTML = srcText;
  src.style.color = stale ? 'var(--color-rag-amber)' : '';

  // The button appears only when a server is there to receive the file.
  const up = $('#stg-upload');
  if (up) up.hidden = !(CFG.apiBase && STATE.refCanUpload);

  const links = STATE.links.filter(l => byKey.has(l.k));

  // Rows the workbook lists without a Jira number. They carry their own marks
  // and are shown alongside the rest: the sheet says they contribute, and a
  // report that quietly drops rows is worse than one that admits what it
  // cannot resolve. They have no reporting unit either, so the filter above
  // does not apply and they stay visible whatever is selected.
  const extras = (STATE.refExtras || []).map(e => ({
    key: null, nazwa: e.n, rodzaj: '—', status: '—', rag: 'Brak',
    inits: new Set(e.i || []),
  }));

  const counts = STATE.strategic.map(i => ({
    i,
    n: links.filter(l => l.i === i).length + extras.filter(e => e.inits.has(i)).length,
  }));
  const max = Math.max(...counts.map(c => c.n), 1);

  $('#stg-bars').innerHTML = counts.map(c => `
    <div class="bar-row${c.n ? '' : ' zero'}">
      <div class="lab" title="${esc(c.i)}">${esc(c.i)}</div>
      <div class="track"><div class="fill" style="width:${(c.n / max * 100).toFixed(1)}%"></div></div>
      <div class="val">${fmt(c.n)}</div>
    </div>`).join('');

  const keys = [...new Set(links.map(l => l.k))];
  const jiraRows = keys.map(k => byKey.get(k)).filter(Boolean)
    .sort((a, b) => a.typ === b.typ
      ? a.nazwa.localeCompare(b.nazwa, LANG)
      : (a.typ === 'Project' ? -1 : 1));

  // Keyless rows last: they are the ones still waiting for a Jira issue.
  const all = [...jiraRows, ...extras];
  const proj = all.filter(r => r.typ === 'Project');
  const init = all.filter(r => r.typ === 'Initiative');
  const inProgress = all.filter(r => r.faza === 'Realizowane').length;
  const inPrep = all.filter(r => r.wPrzygotowaniu).length;
  const done = all.filter(r => r.kategoria === 'Zakończone').length;
  const unsupported = counts.filter(c => !c.n);
  const top = [...counts].sort((a, b) => b.n - a.n).filter(c => c.n).slice(0, 3);

  const c = [];
  c.push(t('stg.c1', proj.length, init.length));
  c.push(t('stg.c2', inProgress, inPrep, done));
  if (top.length) c.push(t('stg.c3', top.map(x => `<b>${esc(x.i)}</b> (${x.n})`)));
  c.push(unsupported.length
    ? t('stg.c4', unsupported.length, unsupported.map(u => esc(u.i)))
    : t('stg.c4none'));
  if (extras.length) c.push(t('stg.c5', extras.length));
  $('#stg-comment').innerHTML = commentList(c);

  // A Jira-backed row is matched through the links; a keyless one carries its
  // own marks, because there is no key to match on.
  const has = (r, i) => r.key ? links.some(l => l.k === r.key && l.i === i) : r.inits.has(i);

  let html = `<thead><tr><th>${t('ui.type')}</th><th>${t('ui.key')}</th><th>${t('ui.name')}</th>` +
    `<th>${t('ui.status')}</th><th>${t('ui.rag')}</th>` +
    STATE.strategic.map(i => `<th class="init">${esc(i)}</th>`).join('') + `</tr></thead><tbody>`;

  if (!all.length) {
    html += `<tr><td colspan="${5 + STATE.strategic.length}" class="empty">${t('stg.empty')}</td></tr>`;
  } else {
    all.forEach(r => {
      html += `<tr><td class="mono-k">${esc(r.rodzaj)}</td>
        <td>${r.key ? jiraLink(r.key) : `<span class="mono-k">${t('ui.noNumber')}</span>`}</td>
        <td class="nm">${esc(r.nazwa)}</td>
        <td>${r.key ? `<span class="pill">${esc(r.status)}</span>` : '<span class="mono-k">—</span>'}</td>
        <td>${r.key ? ragChip(r.rag) : '<span class="mono-k">—</span>'}</td>` +
        STATE.strategic.map(i => `<td class="init">${has(r, i) ? '<span class="x">✕</span>' : ''}</td>`).join('') +
        `</tr>`;
    });
    html += `<tr class="total"><td colspan="5">${t('stg.totalRow')}</td>` +
      counts.map(c => `<td class="init">${c.n ? fmt(c.n) : '—'}</td>`).join('') + `</tr>`;
  }
  $('#stg-matrix').innerHTML = html + `</tbody>`;

  // Filters cover the first five columns only; the initiative columns are too
  // narrow for a funnel in the header. The Total row counts the marks in the
  // VISIBLE rows, so after filtering it still describes what is above it.
  TF.attach($('#stg-matrix'), {
    note: $('#stg-src'),
    skipClass: 'init',
    onFilter: vis => {
      const total = $('#stg-matrix').querySelector('tr.total');
      if (!total) return;
      STATE.strategic.forEach((name, n) => {
        const count = vis.filter(tr => tr.cells[5 + n] && tr.cells[5 + n].querySelector('.x')).length;
        if (total.cells[1 + n]) total.cells[1 + n].textContent = count ? fmt(count) : '—';
      });
    },
  });
}
