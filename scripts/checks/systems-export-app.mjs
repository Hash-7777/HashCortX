// ==============================================================
// Systems app-export checks
//
// A generated system written out as one HTML file that runs in any browser.
// It must carry every script the mode needs, in order; nothing in a record
// may break out of the file's script; and it must keep its own storage.
//
// Run with: npm run check:systems-export-app
// ==============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'src');
const src = (...p) => readFileSync(join(root, ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'export-app.js'), sandbox, { filename: 'export-app.js' });
const X = sandbox.window.HCSystemsExportApp;
const mode = src('modes', 'systems', 'mode.js');
const boot = src('boot.js');
const css = src('modes', 'systems', 'mode.css');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('The file carries everything the mode needs:');
{
  ok('every script it lists exists', X.SCRIPTS.every((p) => existsSync(join(root, p))));
  ok('and every style', [...X.STYLES, X.BORROWED.file].every((p) => existsSync(join(root, p))));
  const bootSystems = [...boot.matchAll(/'(\/js\/systems\/[\w-]+\.js)'/g)].map((m) => m[1]);
  ok('every Systems module the app loads is in it, so adding one cannot leave the file broken', bootSystems.every((p) => X.SCRIPTS.includes(p)));
  ok('in the order the app loads them', (() => {
    const at = (p) => boot.indexOf(`'${p}'`);
    const listed = X.SCRIPTS.filter((p) => at(p) !== -1);
    return listed.every((p, i) => i === 0 || at(listed[i - 1]) < at(p));
  })());
  ok('with the mode itself last', X.SCRIPTS[X.SCRIPTS.length - 1] === '/modes/systems/mode.js');
  ok('and what the mode reaches for beyond them: code fences, the CSV writer and the arithmetic', ['/js/fences.js', '/js/export-format.js', '/js/forge/expr.js'].every((p) => X.SCRIPTS.includes(p)));
}

console.log('\nNothing in a record can break out of the file:');
{
  const nasty = { name: '</script><script>alert(1)</script>', note: '<!-- x', sep: ' ' };
  const html = X.appHtml({ spec: { name: 'Café <b>' }, data: { rows: [nasty] }, exportedAt: 1, css: 'a{}', scripts: ['var x = "</script>";', '/* <!-- */'], panel: '<template data-mode-tab><button>tab</button></template><div id="system-maker-wrap"></div>' });
  const json = /<script type="application\/json" id="hc-system">([\s\S]*?)<\/script>/.exec(html)[1];
  ok('the records sit in one script element, closed only by its own tag', !/<\/script/i.test(json) && !/<!--/.test(json));
  ok('and read back exactly as they went in', JSON.parse(json).data.rows[0].name === nasty.name && JSON.parse(json).data.rows[0].sep === ' ');
  ok('code with "</script>" in it cannot close its element', !/var x = "<\/script>"/.test(html) && /var x = "<\\\/script>"/.test(html));
  ok('the title is escaped', /<title>Café &lt;b&gt;<\/title>/.test(html));
  ok('nor an image of the app\'s own, which the file could not reach', !/<img/.test(X.panelBody('<div><img src="/assets/logo-mark.png" alt="x"/><p>kept</p></div>')) && /<p>kept<\/p>/.test(X.panelBody('<div><img src="/assets/a.png"><p>kept</p></div>')));
  ok('the tab button the app lifts out is not in the file', !/<template data-mode-tab>/.test(html) && /<div id="system-maker-wrap"><\/div>/.test(html));
  ok('the mode is started once everything is loaded', html.trim().endsWith('<script>window.SystemMaker.mount();</script>\n</body>\n</html>'));
}

console.log('\nOnly the dialogs are borrowed from another sheet:');
{
  const sheet = '.amk-btn{color:red}\n/* .amk-dialog in a comment */\n.other{x:1}\n@media (max-width:1px){.amk-btn{y:2}}\n.amk-dialog-inner, .amk-dialog{z:3}';
  const got = X.rulesMatching(sheet, X.BORROWED.selector);
  ok('the rules it uses, whole', got.includes('.amk-btn{color:red}') && got.includes('.amk-dialog-inner, .amk-dialog{z:3}'));
  ok('and nothing else', !got.includes('.other') && !got.includes('@media'));
}

console.log('\nBuilt from the app\'s own files:');
{
  const asked = [];
  const read = async (p) => { asked.push(p); return p.endsWith('.css') ? `/* ${p} */ .amk-dialog{a:1} .x{b:2}` : p.endsWith('.html') ? '<template data-mode-tab>t</template><div id="system-maker-wrap"></div>' : `/* ${p} */`; };
  const html = await X.build(read, { spec: { name: 'S', revisionHistory: [1, 2] }, data: { a: [] }, exportedAt: 7 });
  ok('it reads every script and style, the borrowed sheet and the panel', X.SCRIPTS.every((p) => asked.includes(p)) && X.STYLES.every((p) => asked.includes(p)) && asked.includes(X.BORROWED.file) && asked.includes('/modes/systems/panel.html'));
  ok('the scripts go in in order', X.SCRIPTS.every((p, i) => i === 0 || html.indexOf(`/* ${X.SCRIPTS[i - 1]} */`) < html.indexOf(`/* ${p} */`)));
  ok('the system goes in without its history', JSON.parse(/id="hc-system">([\s\S]*?)<\/script>/.exec(html)[1]).spec.revisionHistory.length === 0);
  ok('with when it was exported', JSON.parse(/id="hc-system">([\s\S]*?)<\/script>/.exec(html)[1]).exportedAt === 7);
  ok('only the dialog rules of the borrowed sheet', html.includes('.amk-dialog{a:1}') && (html.match(/\.x\{b:2\}/g) || []).length === STYLESCOUNT());
  function STYLESCOUNT() { return X.STYLES.length; }
  ok('the mode builds the file through it', /window\.HCSystemsExportApp\.build\(read, \{ spec, data: getRuntimeData\(spec\), exportedAt: Date\.now\(\) \}\)/.test(mode));
}

console.log('\nIn a browser, the file keeps its own system:');
ok('under a key of its own, since every local file shares the browser\'s storage', /const STORE_KEY = STANDALONE \? `hcx_app_\$\{STANDALONE\.spec\.id\}` : "hashui_system_specs_v1";/.test(mode));
ok('and a newer export of it replaces an older one\'s', /localStorage\.getItem\(`\$\{STORE_KEY\}_exported`\) !== String\(STANDALONE\.exportedAt\)/.test(mode));
ok('a file is saved by download, having no app to ask', /download = name/.test(src('js', 'systems', 'export-app.js')));
ok('the app\'s chrome is hidden, and the file cannot try to export itself', /\.sys-standalone :is\(\.sys-header, \.sys-library/.test(css) && /\[data-preview-export="app"\]/.test(css));
ok('the app offers it from the Export menu', /data-preview-export="app"/.test(src('modes', 'systems', 'panel.html')) && /previewExport === "app"\) exportApp\(spec\)/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/export-app.js)`);
process.exit(fail ? 1 : 0);
