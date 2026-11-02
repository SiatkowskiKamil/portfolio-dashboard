/* ===========================================================================
   app.js — application shell and entry point
   ---------------------------------------------------------------------------
   Everything that is not a number and not a page: the sign-in screen, the
   reporting-unit filter, the language and theme switches, navigation, and the
   boot sequence.

   The data flow is deliberately one-directional, with a single redraw path:

       source (api.js) -> start() -> buildModel() -> STATE -> renderAll()

   Any user action that changes what is shown ends in renderAll(). There is no
   partial update anywhere; with a few hundred rows a full redraw is instant
   and removes a whole class of stale-view bugs.

   Depends on: every other file. Must load last.
   =========================================================================== */

/* ===========================================================================
   File-version guard
   ---------------------------------------------------------------------------
   The files in js/ are one unit: render.js calls F() from measures.js, which
   reads the r.rus field that data.js writes. Replace some of them and not
   others and the page dies on a bare "F is not defined" in the console, with
   nothing on screen to say which file is stale. That happens for real when a
   report is handed over by copying files one at a time.

   Scripts load in the order index.html lists them, so by the time this runs
   every other file has executed and a missing symbol means a missing or
   outdated file. Names declared with const are lexical bindings rather than
   window properties, hence typeof rather than a lookup on window.
   =========================================================================== */

(function checkFiles() {
  var stale = [];
  var need = function (ok, file) { if (!ok && stale.indexOf(file) < 0) stale.push(file); };

  need(typeof CFG !== 'undefined', 'js/config.js');
  need(typeof t === 'function', 'js/i18n.js');
  need(typeof fmt === 'function' && typeof dmy === 'function', 'js/utils.js');
  need(typeof buildModel === 'function', 'js/data.js');
  need(typeof F === 'function' && typeof M !== 'undefined', 'js/measures.js');
  need(typeof Api !== 'undefined', 'js/api.js');
  need(typeof TF !== 'undefined', 'js/tablefilter.js');
  need(typeof renderAll === 'function', 'js/render.js');

  if (!stale.length) return;

  // Written without t(), esc() or $(): i18n.js and utils.js are themselves on
  // the list of things that may be missing. Both languages, because the reader
  // may be either and there is no dictionary to ask.
  var box = document.getElementById('gateMsg');
  var text =
    'Pliki aplikacji są z różnych wersji. Podmień te: ' + stale.join(', ') +
    '. Wszystkie pliki z folderu js/ muszą pochodzić z tej samej wersji raportu.' +
    '\n\nThe application files come from different versions. Replace these: ' +
    stale.join(', ') + '. Every file in js/ has to come from the same build.';
  if (box) {
    box.className = 'msg on err';
    box.textContent = text;
  } else {
    document.body.textContent = text;
  }
  throw new Error('Niespojne wersje plikow: ' + stale.join(', '));
})();

/* Reference data (strategic initiatives, benchmarks). Fetched once at boot and
   reused whichever data source the user picks. */
let REF = { strategic: [], links: [], bench: [], extras: [], noteInfo: null, stale: false,
            uploadedAt: '', uploadedBy: '',
            // Assume uploading is allowed when a server is configured. The
            // opposite default hid the button exactly when the matrix had
            // failed to load - the one moment somebody needs to send a new one.
            canUpload: Boolean(CFG.apiBase) };

/* Business-value workbook: per-year EBITDA and the project category. Fetched
   once at boot, like REF, and applied whatever the data source. */
let VAL = { byKey: new Map(), years: [], sheets: [], file: '', count: 0, noteInfo: null, stale: false };

/* ===========================================================================
   Loading a dataset
   =========================================================================== */

/**
 * Install a dataset and show the application.
 *
 * @param {object} raw    data in the api.js shape
 * @param {string} base   Jira URL, used for "open in Jira" links
 * @param {string} [note] short badge next to "As of", e.g. "Jira · 353 issues"
 */
function start(raw, base, note) {
  STATE.base = base || CFG.jiraBaseUrl;
  // The business-value workbook has to be in place BEFORE the model is built:
  // buildModel() joins it onto the rows by issue key.
  STATE.val       = VAL;
  STATE.rows      = buildModel(raw);

  // A data.js from before rule-based units returns rows without r.rus, which
  // F() in measures.js then reads as undefined. The guard above cannot see
  // this one: the file is present and the function exists, only its output has
  // the older shape.
  if (STATE.rows.length && !Array.isArray(STATE.rows[0].rus)) {
    msg('err', 'Plik js/data.js jest ze starszej wersji: wiersze nie mają pola rus (jednostki raportowe). ' +
               'Podmień js/data.js i js/measures.js razem.');
    return;
  }
  STATE.strategic = REF.strategic;
  STATE.links     = REF.links;
  STATE.bench     = REF.bench;
  STATE.refExtras = REF.extras || [];
  STATE.refNoteInfo = REF.noteInfo;
  STATE.refStale  = Boolean(REF.stale);
  STATE.refUploadedAt = REF.uploadedAt || '';
  STATE.refUploadedBy = REF.uploadedBy || '';
  STATE.refCanUpload  = Boolean(REF.canUpload);

  // Every configured unit, in CFG.units order — including ones that matched
  // nothing. An empty unit must be visible as empty rather than disappear:
  // disappearing looks like a design decision, but usually means a wrong field
  // ID or a changed value in Jira.
  STATE.units = (CFG.units || []).map(u => u.name);
  STATE.sel.clear();

  const asOf = raw.asOf ? new Date(raw.asOf) : new Date();
  $('#asOf').textContent = dmy(asOf) + ' ' +
    String(asOf.getHours()).padStart(2, '0') + ':' + String(asOf.getMinutes()).padStart(2, '0');

  const srcNote = $('#srcNote');
  srcNote.textContent = note || '';
  srcNote.style.display = note ? 'inline' : 'none';

  buildFilter();
  renderAll();

  $('#gate').style.display = 'none';
  $('#app').classList.add('on');

  // Deep link: #kondycja opens that page directly.
  const hash = location.hash.replace('#', '');
  if (hash) go(hash);
}

/** Show a message on the sign-in screen. kind is 'warn' or 'err'. */
function msg(kind, html) {
  const m = $('#gateMsg');
  m.className = 'msg on ' + kind;
  m.innerHTML = html;
}

/* ===========================================================================
   Reporting-unit filter
   =========================================================================== */

/** Build the checkbox list from the units configured in CFG.units. */
function buildFilter() {
  const pop = $('#ruPop');
  pop.innerHTML =
    `<label class="row all"><input type="checkbox" id="ruAll"> ${esc(t('ui.selectAll'))}</label>` +
    `<div class="sep"></div>` +
    STATE.units.map((u, i) =>
      `<label class="row"><input type="checkbox" data-ru="${esc(u)}" id="ru${i}"> ${esc(u)}</label>`).join('');

  pop.querySelectorAll('input[data-ru]').forEach(cb => {
    cb.checked = STATE.sel.has(cb.dataset.ru);
    cb.onchange = () => {
      cb.checked ? STATE.sel.add(cb.dataset.ru) : STATE.sel.delete(cb.dataset.ru);
      syncFilter();
      renderAll();
    };
  });

  // "Select all" is really "clear the selection": an empty set means no filter.
  $('#ruAll').checked = STATE.sel.size === 0;
  $('#ruAll').onchange = e => {
    STATE.sel.clear();
    pop.querySelectorAll('input[data-ru]').forEach(c => c.checked = false);
    e.target.checked = true;
    syncFilter();
    renderAll();
  };

  syncFilter();
}

/** Update the filter button label to match the selection. */
function syncFilter() {
  const n = STATE.sel.size;
  $('#ruLabel').textContent = n === 0 ? t('ui.allUnits')
                            : n <= 2  ? [...STATE.sel].join(', ')
                            : t('ui.nUnits', n);
  const all = $('#ruAll');
  if (all) all.checked = n === 0;
  syncPages();
}

/**
 * Hide pages that make no sense for the current selection.
 *
 * Only the strategic-initiative matrix is affected: the strategy team does not
 * maintain it for the units in CFG.hideStrategicFor, so the page would show an
 * empty matrix, which reads like missing data rather than like "not in scope".
 * Hiding it is therefore more honest than showing it empty.
 *
 * The page is hidden only when the WHOLE selection consists of those units.
 */
function syncPages() {
  const hideFor = (CFG.hideStrategicFor || []).map(u => u.trim().toLowerCase());
  const sel = [...STATE.sel];
  const hide = Boolean(hideFor.length && sel.length &&
    sel.every(u => hideFor.includes(String(u).trim().toLowerCase())));

  const link = document.querySelector('#nav a[data-p="strategia"]');
  if (link) link.style.display = hide ? 'none' : '';
  // Someone standing on that page when the filter changes has to be moved off
  // it, otherwise they keep looking at a page the menu no longer offers.
  if (hide && $('#p-strategia').classList.contains('on')) go('podsumowanie');
}

$('#ruBtn').onclick = e => {
  e.stopPropagation();
  const on = $('#ruPop').classList.toggle('on');
  $('#ruBtn').setAttribute('aria-expanded', on);
};

// Close the dropdown on any click outside it.
document.addEventListener('click', e => {
  if (!e.target.closest('.filter')) $('#ruPop').classList.remove('on');
});

/* ===========================================================================
   Language
   ---------------------------------------------------------------------------
   setLang() lives in i18n.js, which also refills the static markup and
   triggers the redraw. Here we only wire the buttons and apply the remembered
   choice at boot.
   =========================================================================== */

document.querySelectorAll('#langSwitch button').forEach(b => {
  b.onclick = () => {
    setLang(b.dataset.lang);
    // The unit filter is built once per dataset, so its labels need rebuilding
    // by hand after a language change; everything else goes through renderAll.
    if (STATE.rows && STATE.rows.length) buildFilter();
  };
});

/* ===========================================================================
   Uploading the strategic matrix
   ---------------------------------------------------------------------------
   The file goes straight to the server, which parses it before replacing
   anything. A rejected upload leaves the previous matrix in place and the
   reason is shown next to the button.
   =========================================================================== */

$('#stg-uploadBtn').onclick = () => $('#stg-file').click();

$('#stg-file').onchange = async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  // Clear the input, so picking the same file again still fires a change.
  e.target.value = '';

  const btn = $('#stg-uploadBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('stg.uploading');

  try {
    const body = await Api.uploadReference(file, STATE.me || '');
    REF.strategic = body.strategic || [];
    REF.links = body.links || [];
    REF.extras = body.extras || [];
    REF.uploadedAt = body.uploadedAt || '';
    REF.uploadedBy = body.uploadedBy || '';
    REF.canUpload = Boolean(body.canUpload);
    REF.stale = false;
    REF.noteInfo = { kind: 'ok', rows: (body.rows || 0) + REF.extras.length,
                     sheet: body.sheet, extras: REF.extras.length };

    STATE.strategic = REF.strategic;
    STATE.links = REF.links;
    STATE.refExtras = REF.extras;
    STATE.refNoteInfo = REF.noteInfo;
    STATE.refStale = false;
    STATE.refUploadedAt = REF.uploadedAt;
    STATE.refUploadedBy = REF.uploadedBy;
    STATE.refCanUpload = REF.canUpload;

    renderAll();
    uploadMsg('ok', t('stg.uploadOk', body.rows || 0, (body.links || []).length));
  } catch (err) {
    uploadMsg('err', t('stg.uploadFailed', err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
};

/** A short result line under the matrix header. Errors stay until the next
 *  attempt; a success message clears itself, because it is confirmation of
 *  something the reader can already see in the table. */
function uploadMsg(kind, text) {
  const el = $('#stg-uploadmsg');
  if (!el) return;
  el.className = 'uploadmsg ' + kind;
  el.textContent = text;
  if (kind === 'ok') setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 6000);
}

/* ===========================================================================
   Theme
   ---------------------------------------------------------------------------
   Two palettes, both defined in style.css. The choice is remembered per
   browser; failures are ignored because private windows and locked-down
   policies can make localStorage throw.
   =========================================================================== */

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#thLight').setAttribute('aria-pressed', theme === 'light');
  $('#thDark').setAttribute('aria-pressed', theme === 'dark');
  try { localStorage.setItem('dashTheme', theme); } catch (e) { /* storage blocked */ }
}

$('#thLight').onclick = () => setTheme('light');
$('#thDark').onclick  = () => setTheme('dark');

/* ===========================================================================
   Navigation
   ---------------------------------------------------------------------------
   All pages exist in the DOM at once; switching toggles a class. No routing
   library, and the hash keeps a page shareable and survives a refresh.
   =========================================================================== */

document.querySelectorAll('#nav a').forEach(a => {
  a.onclick = e => { e.preventDefault(); go(a.dataset.p); };
});

function go(page) {
  // A hidden page must not be reachable by hash either — #strategia pasted
  // into the address bar, or left there from before the filter changed.
  const link = document.querySelector('#nav a[data-p="' + page + '"]');
  if (link && link.style.display === 'none') page = 'podsumowanie';

  document.querySelectorAll('.page').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('active', x.dataset.p === page));
  const el = $('#p-' + page);
  if (el) el.classList.add('on');
  location.hash = page;
  window.scrollTo(0, 0);
}

/* ===========================================================================
   Sign-in screen
   =========================================================================== */

/* --- demo data --- */
$('#btnDemo').onclick = async () => {
  try {
    const raw = await Api.loadDemo();
    start(raw, CFG.jiraBaseUrl, t('app.srcDemo'));
  } catch (err) {
    msg('err', esc(err.message));
  }
};

/* --- pasted Jira export --- */
$('#btnPaste').onclick = () => {
  msg('warn', t('msg.pasteIntro') +
    `<div style="margin-top:10px"><textarea id="pasteBox" rows="6" placeholder='{"issues":[ ... ]}&#10;{"issues":[ ... ]}'></textarea></div>
     <div style="margin-top:8px"><button class="btn btn-ghost" id="btnPasteGo" style="width:100%">${esc(t('msg.pasteGo'))}</button></div>`);

  $('#btnPasteGo').onclick = () => {
    try {
      const merged = Api.parseMulti($('#pasteBox').value);
      // Accept both a raw Jira response and an already-mapped dataset.
      const raw = merged.issues[0] && merged.issues[0].fields
        ? Api.fromJira({ issues: merged.issues })
        : { asOf: new Date().toISOString(), issues: merged.issues };
      start(raw, $('#jiraUrl').value.trim(), t('app.srcImport', raw.issues.length, merged.more));
    } catch (err) {
      msg('err', t('msg.pasteFailed', esc(err.message)));
    }
  };
};

/* --- live Jira --- */
$('#loginForm').onsubmit = async e => {
  e.preventDefault();

  const base = $('#jiraUrl').value.trim().replace(/\/+$/, '');
  const email = $('#email').value.trim();
  const token = $('#token').value.trim();

  if (CFG.auth === 'user' && (!email || !token)) {
    msg('err', t('msg.needCreds'));
    return;
  }

  const btn = $('#btnLogin');
  btn.disabled = true;
  btn.textContent = t('gate.connecting');

  try {
    const raw = await Api.fetchLive({ base, email, token });
    if (!raw.issues.length) throw new Error(t('msg.noIssues'));
    // Remembered only so that an upload can record who sent the workbook.
    // With server-side credentials there is no e-mail here and the server
    // records the Windows identity instead.
    STATE.me = email;
    start(raw, base, t('app.srcJira', raw.issues.length));
  } catch (err) {
    // fetch() rejects with a TypeError when the browser blocks the request,
    // which is what a CORS refusal looks like from here. An HTTP error would
    // have been turned into a normal Error by fetchLive().
    const blocked = err instanceof TypeError;
    msg(blocked ? 'warn' : 'err', blocked ? t('msg.cors') : esc(err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = CFG.auth === 'user' ? t('gate.submit') : t('gate.submitServer');
  }
};

/* ===========================================================================
   Boot
   =========================================================================== */

(async function boot() {
  // Language and theme first: everything drawn afterwards has to come out in
  // the right language, and the theme avoids a flash of the wrong palette.
  setLang(initialLang());
  try {
    // Only the two known names are accepted. A browser that used an earlier
    // build may have something else stored here, which would leave the page
    // with no theme at all.
    const stored = localStorage.getItem('dashTheme');
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  } catch (e) { /* storage blocked */ }

  $('#jiraUrl').value = CFG.jiraBaseUrl;

  // With CFG.auth === 'server' the user hands over no token at all.
  if (CFG.auth !== 'user') {
    $('#credFields').style.display = 'none';
    $('#btnLogin').textContent = t('gate.submitServer');
  } else if (location.protocol === 'http:' &&
             !['localhost', '127.0.0.1', ''].includes(location.hostname)) {
    // An API token is a password, and Basic auth sends it as plain text. Over
    // http it is readable by anything that sees the traffic — a corporate
    // network is not an exception. Say so where the token is typed, not in a
    // document nobody opens. Localhost is excluded: nothing leaves the machine.
    msg('warn', t('msg.insecure'));
  }

  // The business-value workbook never blocks the start — loadValuation()
  // handles a missing file itself and returns an empty set with the reason.
  // The guard catches the case where api.js is from an older version and the
  // function does not exist: without it the whole boot() would stop silently,
  // taking the reference data with it, and nothing would appear on screen.
  try {
    if (typeof Api.loadValuation !== 'function') throw new Error(t('msg.apiOld'));
    VAL = await Api.loadValuation();
  } catch (err) {
    VAL.noteInfo = { kind: 'fail', err: err.message };
    VAL.stale = true;
  }

  try {
    REF = await Api.loadReference();
  } catch (err) {
    // Most likely cause: the page was opened straight from disk, so the
    // browser refuses to read neighbouring files. Say so plainly, because the
    // message a browser gives for this is unhelpful.
    msg('err', t('msg.refFailed', esc(err.message)));
  }
})();
