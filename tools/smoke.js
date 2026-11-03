/* ===========================================================================
   smoke.js — does the whole report still render?
   ---------------------------------------------------------------------------
   Optional tooling, not part of the application: the dashboard itself has no
   dependencies and no build step. This script drives a real browser, so it
   needs Playwright, which is the only thing in this repository that does:

       npm install --no-save playwright
       npx playwright install chromium
       node tools/serve.js 8000          # in one terminal
       node tools/smoke.js 8000          # in another

   What it proves, in one pass over the demo dataset: every page draws rows,
   the tiles carry numbers, the unit filter is built from the configured rules,
   the strategic matrix has its columns, both languages render, and nothing
   threw along the way. It is not a unit-test suite; it is the check that
   catches the mistake that actually happens — a change that breaks one page
   while the other four still look fine.

   Exits 1 when a page is empty or the console carried an error, so it can sit
   in a pipeline.
   =========================================================================== */

const { chromium } = require('playwright');

const PORT = process.argv[2] || '8000';
const PAGES = ['podsumowanie', 'struktura', 'wartosc', 'kondycja', 'strategia'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  const errors = [];
  page.on('pageerror', e => errors.push('uncaught: ' + e.message.split('\n')[0]));
  page.on('console', m => {
    // A missing workbook answers 404/503 by design: the report falls back and
    // says so on screen. Anything else is a real error.
    if (m.type() === 'error' && !/40[034]|50[03]/.test(m.text())) errors.push('console: ' + m.text());
  });

  let failed = 0;
  const check = (ok, label, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  };

  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.click('#btnDemo');
  await page.waitForSelector('#pods-list tbody tr');

  for (const p of PAGES) {
    await page.click(`#nav a[data-p="${p}"]`);
    const rows = await page.$$eval(`#p-${p} table tbody tr`, ns => ns.length);
    check(rows > 0, `strona ${p}`, `${rows} wierszy w tabelach`);
  }

  await page.click('#nav a[data-p="podsumowanie"]');
  const tiles = await page.$$eval('#pods-vitals', ns =>
    ns.map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(' '));
  check(/\d/.test(tiles), 'kafle mają liczby', tiles.slice(0, 80));

  const units = await page.$$eval('#ruPop label[class="row"]', ns => ns.length);
  check(units > 0, 'filtr jednostek zbudowany', `${units} jednostek`);

  const diag = await page.$eval('#pods-units', n => n.textContent.trim());
  check(diag.length > 0, 'linia kontrolna jednostek', diag.slice(0, 90));

  await page.click('#nav a[data-p="strategia"]');
  const cols = await page.$$eval('#stg-matrix thead th', ns => ns.length);
  check(cols > 5, 'macierz inicjatyw ma kolumny', `${cols} kolumn`);

  for (const lang of ['en', 'pl']) {
    await page.click(`#langSwitch button[data-lang="${lang}"]`);
    await page.click('#nav a[data-p="podsumowanie"]');
    const head = await page.$$eval('#pods-list thead th', ns => ns.map(x => x.textContent.trim()).join(' | '));
    check(head.length > 0, `język ${lang.toUpperCase()}`, head);
  }

  check(errors.length === 0, 'brak błędów w konsoli', errors.join(' / ') || 'czysto');

  await browser.close();
  console.log(failed ? `\n${failed} sprawdzeń nie przeszło.` : '\nWszystko przeszło.');
  process.exit(failed ? 1 : 0);
})();
