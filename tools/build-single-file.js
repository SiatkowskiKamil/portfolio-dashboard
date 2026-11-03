/* ===========================================================================
   build-single-file.js — bundle the whole app into one HTML file
   ---------------------------------------------------------------------------
   Produces dist/portfolio-dashboard.html: stylesheet, scripts and data files all
   inlined, so the result opens by double-clicking with no server at all.

   Run from this folder:   node build-single-file.js

   Use it for:
     * handing the dashboard to someone who cannot run a server,
     * showing it on a machine with no development tools,
     * e-mailing a snapshot.

   Do not edit the output. Edit the files in public/ and run this again.
   =========================================================================== */

const fs   = require('fs');
const path = require('path');

const PUB  = path.resolve(__dirname, '..', 'public');
const DIST = path.resolve(__dirname, '..', 'dist');
const OUT  = path.join(DIST, 'portfolio-dashboard.html');

const read = p => fs.readFileSync(path.join(PUB, p), 'utf8');

let html = read('index.html');

/* ---- 1. stylesheet ------------------------------------------------------ */
html = html.replace(
  /<link rel="stylesheet" href="css\/style\.css">/,
  '<style>\n' + read('css/style.css') + '\n</style>'
);

/* ---- 2. data files ------------------------------------------------------
   Keyed by the same relative path api.js asks for, so loadJson() finds them
   without any other change. */
const embedded = {
  'data/demo-issues.json': JSON.parse(read('data/demo-issues.json')),
  'data/reference.json':   JSON.parse(read('data/reference.json')),
};

/* ---- 3. scripts, in the order index.html declares them ------------------ */
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
if (!scripts.length) throw new Error('No <script src="js/..."> tags found in index.html.');

const bundle =
  '<script>\n' +
  '/* Data files inlined by tools/build-single-file.js — see api.js loadJson(). */\n' +
  'window.__EMBEDDED__ = ' + JSON.stringify(embedded) + ';\n' +
  '</script>\n' +
  scripts.map(src =>
    '<script>\n/* ===== ' + src + ' ===== */\n' + read(src) + '\n</script>'
  ).join('\n');

// Replace the first script tag with the bundle, drop the rest.
html = html.replace(/<script src="js\/[^"]+"><\/script>/, '\u0000BUNDLE\u0000');
html = html.replace(/\s*<script src="js\/[^"]+"><\/script>/g, '');
html = html.replace('\u0000BUNDLE\u0000', bundle);

/* ---- 4. note at the top so nobody edits the output by mistake ----------- */
html = html.replace('<meta charset="utf-8">',
  '<!-- BUILT FILE — do not edit. Generated from public/ by tools/build-single-file.js\n' +
  '     Built: ' + new Date().toISOString() + ' -->\n<meta charset="utf-8">');

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

console.log('');
console.log('  Zbudowano:  ' + OUT);
console.log('  Rozmiar:    ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB');
console.log('  Skrypty:    ' + scripts.join(', '));
console.log('');
