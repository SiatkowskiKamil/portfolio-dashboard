/* ===========================================================================
   tablefilter.js — per-column filtering and sorting for the detail tables
   ---------------------------------------------------------------------------
   The equivalent of Excel's header filters or a Power BI slicer, but working
   on the finished HTML of a table: this module knows nothing about the data
   model. It reads the text of the cells, hides the rows that fail a filter,
   and reorders them when a column name is clicked.

   Consequences of that design, each of them deliberate:

     * Filters are attached to DETAIL tables only (one row = one issue). In the
       aggregate tables — by category, by completion year, by RAG status — a
       row is already a summary, with shares and a Total row beside it; hiding
       one would leave totals that no longer match what is on screen. There the
       reporting-unit filter in the top bar is the right tool.

     * Filter state lives outside the DOM (the maps below), because the
       renderers rebuild every table from scratch on each change. We remember
       the HIDDEN values rather than the selected ones, so a value that appears
       for the first time after a data refresh is visible by default.

     * A column is keyed by its HEADER TEXT, not its position. The set of
       columns changes: the summary table gains a Type column in the combined
       view, and the value table renames its money column with the measure.
       Keyed by position, a filter on Status would jump to the End column after
       a switch; keyed by name it stays where it was put, and a filter set on
       EBITDA does not carry over to CAPEX.

     * The filter value is the cell's visible text, with "—" treated as empty.
       The table therefore filters by exactly what it displays, so the value
       list and the column contents can never disagree.

     * Sorting works on the same text and recognises three column types: a
       number (in either the Polish or the English convention), a date
       (dd.mm.yyyy or mm.yyyy) and text (compared with the active language's
       collation, so Polish Ł sorts between L and M). Clicking a column name
       cycles ascending -> descending -> the renderer's own order, because each
       table has a sensible default (EBITDA descending, dates ascending) that
       must be reachable again. Empty values sort last in both directions:
       otherwise sorting by amount ascending would push the projects with no
       amount to the top, which is exactly where they are least useful.

   Usage (in render.js, right after the table's HTML is written):

       TF.attach($('#pods-list'), {
         note: $('#pods-listnote'),          // where to append "N hidden"
         skip: ['Share'],                    // columns with no filter, by header
         skipClass: 'init',                  // ...or by a class on the <th>
         onFilter: vis => recount(vis),      // vis = the visible <tr> elements
       });

   onFilter receives <tr> elements. To get back to model rows, the renderer
   numbers them with data-i and maps them itself. Note that after sorting the
   rows are in a different order from the model array, so that mapping must
   always go through data-i and never through the row's position.

   Columns excluded by skip / skipClass get neither a filter nor sorting: both
   live in the same header cell.

   Depends on: i18n.js (t), utils.js (esc, fmt).
   =========================================================================== */

const TF = (function () {

  /* table id -> Map(column name -> Set of hidden values) */
  const state = new Map();

  /* table id -> { key, dir: 'asc'|'desc' }; no entry = the renderer's order */
  const sorts = new Map();

  /* table id -> the options passed to attach() */
  const cfgs = new Map();

  /** Label for the empty value in the value list. Translated at use time,
   *  because the language can change while the page is open. */
  const EMPTY = () => t('tf.empty');

  const cols = id => {
    if (!state.has(id)) state.set(id, new Map());
    return state.get(id);
  };

  /** The value a cell filters by. "—" and empty are treated the same. */
  const val = td => {
    // Named `text`, not `t`: t() is the translation lookup from i18n.js.
    const text = (td.textContent || '').replace(/\s+/g, ' ').trim();
    return text === '' || text === '—' ? '' : text;
  };

  const label = v => (v === '' ? EMPTY() : v);

  /** Data rows only: no Total row, no "nothing here" placeholder. */
  const dataRows = table => [...table.querySelectorAll('tbody tr')].filter(tr =>
    !tr.classList.contains('total') &&
    !tr.classList.contains('tf-none') &&
    !tr.querySelector('td.empty'));

  /**
   * Column keys in header order: the header text, with a number appended when
   * a name repeats, so that two columns sharing a caption do not share one
   * filter.
   */
  function colKeys(table) {
    const seen = new Map();
    return [...table.querySelectorAll('thead th')].map(th => {
      const lab = (th.textContent || '').replace(/\s+/g, ' ').trim();
      const n = (seen.get(lab) || 0) + 1;
      seen.set(lab, n);
      return n > 1 ? lab + '#' + n : lab;
    });
  }

  /* ---- ordering the value list ------------------------------------------
     Numbers descending (in a money column the top of the list is what you
     want), dates chronologically, text by the language's collation. The empty
     value always last.                                                     */

  const DMY = /^(\d{2})\.(\d{2})\.(\d{4})$/;
  const MY  = /^(\d{2})\.(\d{4})$/;
  /* A number as the page prints it. Both conventions have to be recognised,
     because the same column reads "1 234,5" in Polish and "1,234.5" in
     English and the filter must sort either correctly. Dates are tested
     first, so a pattern this loose cannot swallow "01.02.2026". */
  const NUM = /^-?[\d  .,]+%?$/;

  /** Parse a printed number back into a value, in the active language's
   *  convention. Getting this wrong is silent: "1,234.5" read with Polish
   *  rules becomes 1.234, and the column sorts into nonsense. */
  const toNum = v => {
    let s = String(v).replace(/[ \s%]/g, '');
    if (LANG === 'en') s = s.replace(/,/g, '');          // 1,234.5 -> 1234.5
    else s = s.replace(/\./g, '').replace(',', '.');      // 1 234,5 -> 1234.5
    return parseFloat(s);
  };

  /** A date as yyyymmdd, so plain string comparison orders it correctly. */
  const dkey = v => {
    const a = v.match(DMY), b = v.match(MY);
    return a ? a[3] + a[2] + a[1] : b ? b[2] + b[1] + '00' : v;
  };

  /** Column type inferred from its values: 'num', 'date' or 'text'. */
  function colType(vs) {
    const some = vs.filter(v => v !== '');
    if (!some.length) return 'text';
    if (some.every(v => DMY.test(v) || MY.test(v))) return 'date';
    if (some.every(v => NUM.test(v))) return 'num';
    return 'text';
  }

  /** Compare two values from the same column, ascending. */
  const cmpVal = (x, y, type) =>
      type === 'num'  ? toNum(x) - toNum(y)
    : type === 'date' ? dkey(x).localeCompare(dkey(y))
    :                   x.localeCompare(y, 'pl');

  function sortValues(vs) {
    const some = vs.filter(v => v !== '');
    const type = colType(vs);
    const out = some.slice();
    // Numbers descending: in a money column the top of the list is the point.
    out.sort((a, b) => (type === 'num' ? -1 : 1) * cmpVal(a, b, type));
    if (vs.indexOf('') > -1) out.push('');
    return out;
  }

  /* ---- row sorting ------------------------------------------------------- */

  /**
   * Order the rows by the table's remembered sort. With no sort — or when the
   * sorted column has disappeared — fall back to the order the renderer wrote
   * them in (the data-tfo attribute assigned in attach()).
   */
  function sortRows(table) {
    const body = table.querySelector('tbody');
    const rows = dataRows(table);
    if (!body || !rows.length) return;

    const s = sorts.get(table.id);
    const keys = colKeys(table);
    const i = s ? keys.indexOf(s.key) : -1;
    const orig = (a, b) => (+a.dataset.tfo) - (+b.dataset.tfo);
    let list;

    if (i < 0) {
      list = rows.slice().sort(orig);
    } else {
      const type = colType(rows.map(tr => (tr.cells[i] ? val(tr.cells[i]) : '')));
      list = rows.slice().sort((a, b) => {
        const x = a.cells[i] ? val(a.cells[i]) : '';
        const y = b.cells[i] ? val(b.cells[i]) : '';
        // Empty values last, whichever direction we are sorting.
        if (x === '' || y === '') return (x === '') - (y === '');
        const r = cmpVal(x, y, type);
        return (s.dir === 'desc' ? -r : r) || orig(a, b);
      });
    }

    list.forEach(tr => body.appendChild(tr));
    // The Total row and the "all hidden" placeholder always stay at the bottom.
    body.querySelectorAll('tr.total, tr.tf-none').forEach(tr => body.appendChild(tr));

    [...table.querySelectorAll('thead th')].forEach((th, n) => {
      const on = n === i;
      th.setAttribute('aria-sort', on ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none');
      const lab = th.querySelector('.tf-lab');
      if (lab) lab.classList.toggle('sorted', on);
      const arr = th.querySelector('.tf-dir');
      if (arr) arr.innerHTML = on ? (s.dir === 'desc' ? ARROW_DOWN : ARROW_UP) : '';
    });
  }

  /** Successive clicks on a column name: ascending -> descending -> own order. */
  function toggleSort(table, key) {
    const s = sorts.get(table.id);
    if (!s || s.key !== key)      sorts.set(table.id, { key, dir: 'asc' });
    else if (s.dir === 'asc')     sorts.set(table.id, { key, dir: 'desc' });
    else                          sorts.delete(table.id);
    sortRows(table);
  }

  /* ---- applying the filters ---------------------------------------------- */

  /**
   * Hide the rows that fail a filter, then refresh the header state and the
   * note. Called by attach() and after every change in the value popup.
   */
  function apply(table) {
    const cfg  = cfgs.get(table.id) || {};
    const flt  = cols(table.id);
    const rows = dataRows(table);
    const ths  = [...table.querySelectorAll('thead th')];
    const keys = colKeys(table);

    rows.forEach(tr => {
      const hide = keys.some((k, i) => {
        const set = flt.get(k);
        return set && set.size && tr.cells[i] && set.has(val(tr.cells[i]));
      });
      tr.style.display = hide ? 'none' : '';
    });
    const vis = rows.filter(tr => tr.style.display !== 'none');

    // A table emptied by filters looks exactly like a table with no data, so
    // it gets a caption — otherwise people go looking for a bug in Jira.
    const body = table.querySelector('tbody');
    let none = table.querySelector('tr.tf-none');
    if (rows.length && !vis.length) {
      if (!none && body) {
        none = document.createElement('tr');
        none.className = 'tf-none';
        none.innerHTML = `<td class="empty" colspan="${ths.length}">${esc(t('tf.allHidden'))}</td>`;
        body.appendChild(none);
      }
    } else if (none) none.remove();

    ths.forEach((th, i) => {
      const b = th.querySelector('.tf-btn');
      const set = flt.get(keys[i]);
      if (b) b.classList.toggle('on', Boolean(set && set.size));
    });

    // The renderer recalculates its figures first (it may overwrite the note),
    // and only then do we append the filter info — otherwise it would be lost.
    if (cfg.onFilter) cfg.onFilter(vis, rows);
    note(table, rows.length, vis.length);
  }

  /** Append the filter summary and a clear button to the table's note. */
  function note(table, total, visible) {
    const el = (cfgs.get(table.id) || {}).note;
    if (!el) return;
    // Count only filters on columns present in this version of the table: one
    // remembered for a column that is currently absent hides nothing.
    const flt = cols(table.id);
    const n = colKeys(table).filter(k => flt.get(k) && flt.get(k).size).length;
    let own = el.querySelector('.tf-note');
    if (!n) { if (own) own.remove(); return; }
    if (!own) {
      own = document.createElement('span');
      own.className = 'tf-note';
      el.appendChild(own);
    }
    own.innerHTML = esc(t('tf.hidden', total - visible, total)) +
      `<button type="button" class="tf-clear">${esc(t('tf.clearAll', n))}</button>`;
    own.querySelector('.tf-clear').onclick = e => {
      e.stopPropagation();
      cols(table.id).clear();
      apply(table);
    };
  }

  /* ---- the value-picker popup -------------------------------------------- */

  let pop = null;

  const FUNNEL = '<svg viewBox="0 0 12 12" aria-hidden="true">' +
    '<path d="M1 1.8h10L7 6.4V11L5 9.7V6.4z"/></svg>';

  const ARROW_UP   = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 2 8.5 7h-7z"/></svg>';
  const ARROW_DOWN = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8 1.5 3h7z"/></svg>';

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'tf-pop';
    pop.innerHTML =
      `<input type="search" class="tf-q" spellcheck="false">
       <label class="row all"><input type="checkbox" class="tf-all"><span class="tf-alltxt"></span></label>
       <div class="sep"></div>
       <div class="tf-list"></div>
       <div class="sep"></div>
       <div class="tf-foot"><button type="button" class="tf-reset"></button></div>`;
    document.body.appendChild(pop);
    pop.addEventListener('click', e => e.stopPropagation());
    return pop;
  }

  function closePop() { if (pop) pop.classList.remove('on'); }

  function openPop(table, idx, key, th, lab) {
    const p = ensurePop();
    const flt = cols(table.id);
    const hid = () => flt.get(key) || new Set();
    const all = sortValues([...new Set(
      dataRows(table).map(tr => (tr.cells[idx] ? val(tr.cells[idx]) : '')))]);

    const list = p.querySelector('.tf-list');
    const chk  = p.querySelector('.tf-all');
    let shown  = all;

    const sync = () => {
      const on = shown.filter(v => !hid().has(v)).length;
      chk.checked = shown.length > 0 && on === shown.length;
      chk.indeterminate = on > 0 && on < shown.length;
    };

    const draw = () => {
      const q = p.querySelector('.tf-q').value.trim().toLowerCase();
      shown = q ? all.filter(v => label(v).toLowerCase().indexOf(q) > -1) : all;
      list.innerHTML = shown.length
        ? shown.map(v => `<label class="row"><input type="checkbox" data-v="${esc(v)}"` +
            `${hid().has(v) ? '' : ' checked'}><span>${esc(label(v))}</span></label>`).join('')
        : `<div class="tf-no">${esc(t('tf.noMatches'))}</div>`;
      list.querySelectorAll('input[data-v]').forEach(cb => {
        cb.onchange = () => {
          const set = new Set(hid());
          cb.checked ? set.delete(cb.dataset.v) : set.add(cb.dataset.v);
          set.size ? flt.set(key, set) : flt.delete(key);
          sync();
          apply(table);
        };
      });
      sync();
    };

    chk.onchange = () => {
      const set = new Set(hid());
      shown.forEach(v => (chk.checked ? set.delete(v) : set.add(v)));
      set.size ? flt.set(key, set) : flt.delete(key);
      draw();
      apply(table);
    };
    p.querySelector('.tf-q').value = '';
    p.querySelector('.tf-q').oninput = draw;
    p.querySelector('.tf-reset').onclick = () => { flt.delete(key); draw(); apply(table); };
    // Labels are set on every open, so a language change mid-session is
    // picked up without rebuilding the popup.
    p.querySelector('.tf-q').placeholder = t('tf.search');
    p.querySelector('.tf-q').setAttribute('aria-label', t('tf.searchAria', lab));
    p.querySelector('.tf-alltxt').textContent = t('tf.selectAll');
    p.querySelector('.tf-reset').textContent = t('tf.clearColumn');
    draw();

    // Positioned from the header button. position: fixed, because the header
    // often sits inside a scrolling container that would clip the popup.
    p.classList.add('on');
    p.style.visibility = 'hidden';
    const r = th.querySelector('.tf-btn').getBoundingClientRect();
    const w = p.offsetWidth, h = p.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 10);
    let top  = r.bottom + 6;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6);
    p.style.left = Math.max(10, left) + 'px';
    p.style.top  = top + 'px';
    p.style.visibility = '';
    p.querySelector('.tf-q').focus();
  }

  document.addEventListener('click', closePop);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
  window.addEventListener('resize', closePop);
  // Capture phase: scrolling inside .scroll does not bubble up to window.
  window.addEventListener('scroll', e => {
    if (pop && pop.classList.contains('on') && !pop.contains(e.target)) closePop();
  }, true);

  /* ---- API --------------------------------------------------------------- */

  /**
   * Turn on column filters for a table. Call after every HTML rewrite.
   *
   * @param {HTMLTableElement} table  table with an id (the id keys the state)
   * @param {object} [opts]
   * @param {Element} [opts.note]      element to append the filter info to
   * @param {string[]} [opts.skip]     headers of columns to leave unfiltered
   * @param {string} [opts.skipClass]  class on <th> of columns to leave alone
   * @param {Function} [opts.onFilter] (visibleTr, allTr) after every change
   */
  function attach(table, opts) {
    if (!table || !table.id) return;
    cfgs.set(table.id, opts || {});
    const skip = new Set((opts && opts.skip) || []);
    const skipClass = (opts && opts.skipClass) || null;
    const rows = dataRows(table);
    const keys = colKeys(table);

    // The order the renderer wrote the rows in — the point to return to when
    // sorting is switched off. Reassigned on every rebuild.
    rows.forEach((tr, n) => tr.dataset.tfo = n);

    [...table.querySelectorAll('thead th')].forEach((th, i) => {
      const lab = th.textContent.replace(/\s+/g, ' ').trim();
      if (skip.has(lab) || (skipClass && th.classList.contains(skipClass))) return;
      // A column whose cells are all empty has nothing to filter or sort by —
      // that includes graphical columns, since the share bar carries no text.
      if (!rows.some(tr => tr.cells[i] && val(tr.cells[i]) !== '')) return;

      th.innerHTML = `<span class="tf-h">` +
        `<button type="button" class="tf-lab" title="${esc(t('tf.sortCol', lab))}">` +
        `${th.innerHTML}<span class="tf-dir"></span></button>` +
        `<button type="button" class="tf-btn" aria-haspopup="true" ` +
        `aria-label="${esc(t('tf.filterCol', lab))}" title="${esc(t('tf.filterTitle'))}">${FUNNEL}</button></span>`;
      th.querySelector('.tf-lab').onclick = e => {
        e.stopPropagation();
        closePop();
        toggleSort(table, keys[i]);
      };
      th.querySelector('.tf-btn').onclick = e => {
        e.stopPropagation();
        // A second click on the same funnel closes the popup instead of
        // redrawing it in the same place.
        const tag = table.id + ':' + keys[i];
        const again = pop && pop.classList.contains('on') && pop.dataset.for === tag;
        closePop();
        if (again) { pop.dataset.for = ''; return; }
        openPop(table, i, keys[i], th, lab);
        pop.dataset.for = tag;
      };
    });

    sortRows(table);
    apply(table);
  }

  /** Clear filters and sorting for one table, or for all of them. */
  function reset(id) {
    if (id) { state.delete(id); sorts.delete(id); }
    else { state.clear(); sorts.clear(); }
  }

  return { attach, reset, apply, sortRows };
})();
