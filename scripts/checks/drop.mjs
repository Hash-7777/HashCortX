// ==============================================================
// Files dropped on a workspace — checks
//
// Loads the REAL src/js/drop.js and holds that an element made a drop zone
// takes the files dropped on it, only those it accepts, is marked while
// files are held over it however many of its children the drag crosses,
// keeps the drop from reaching chat's handler on the window, and leaves a
// drag of text alone; that the window leaves drops to the page; and that
// each workspace that takes files has its zone, with chat taking only what
// no other workspace open took.
//
// Run with: npm run check:drop
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'drop.js'), sandbox, { filename: 'drop.js' });
const D = sandbox.HCDrop;

// An element as a zone uses it: listeners, a class list.
function element() {
  const on = {}, classes = new Set();
  return {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    addEventListener: (t, fn) => { (on[t] = on[t] || []).push(fn); },
    removeEventListener: (t, fn) => { on[t] = (on[t] || []).filter((f) => f !== fn); },
    fire(type, files = null, types = files ? ['Files'] : ['text/plain']) {
      const e = { type, dataTransfer: { types, files: files || [], dropEffect: 'none' }, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      for (const fn of on[type] || []) fn(e);
      return e;
    },
  };
}
const file = (name) => ({ name, type: '' });

console.log('A drop zone:');
{
  const el = element();
  let got = null;
  D.zone(el, (files) => { got = files.map((f) => f.name); });
  const over = el.fire('dragenter', [file('a.png')]);
  ok('files held over it mark it, and say they would be copied', el.classList.contains('hc-dropping') && over.prevented && over.dataTransfer.dropEffect === 'copy');
  el.fire('dragenter', [file('a.png')]);
  el.fire('dragleave', [file('a.png')]);
  ok('...and it stays marked while the drag crosses its children', el.classList.contains('hc-dropping'));
  el.fire('dragleave', [file('a.png')]);
  ok('...until the drag has left it', !el.classList.contains('hc-dropping'));
  el.fire('dragenter', [file('a.png')]);
  const dropped = el.fire('drop', [file('a.png'), file('spec.pdf')]);
  ok('what is dropped is taken, every file, and the mark goes', JSON.stringify(got) === '["a.png","spec.pdf"]' && !el.classList.contains('hc-dropping'));
  ok('...and the drop goes no further, so chat does not take it too', dropped.prevented && dropped.stopped);
  got = null;
  const text = el.fire('drop', null);
  ok('text dragged within the page is left to the page', got === null && !text.prevented && !text.stopped);
}
{
  const el = element();
  let got = null;
  D.zone(el, (files) => { got = files.map((f) => f.name); }, { accept: (f) => /\.stl$/.test(f.name) });
  el.fire('drop', [file('photo.png'), file('part.stl')]);
  ok('only what it accepts is taken', JSON.stringify(got) === '["part.stl"]');
  got = 'none';
  el.fire('drop', [file('photo.png')]);
  ok('...and nothing, when it accepts none of them', got === 'none');
  const undo = D.zone(element(), () => {});
  ok('it can be undone', typeof undo === 'function');
}

console.log('\nWhere files can be dropped:');
{
  const conf = readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');
  ok('the window leaves drops to the page', /"dragDropEnabled": false,/.test(conf));
  const app = src('js', 'app.js');
  ok('chat takes a drop only while no other workspace is open', /const files = BUILTIN_BODY_MODE_CLASSES\.some\(\(c\) => document\.body\.classList\.contains\(c\)\) \? \[\] : Array\.from\(e\.dataTransfer\.files\);/.test(app));
  ok('Finance takes files dropped on its conversation, as its picker does', /window\.HCDrop\?\.zone\(wrap\.querySelector\("\.fin-chat"\), handleFinanceFiles\);/.test(src('modes', 'finance', 'mode.js')));
  ok('3D Forge imports a model dropped on the studio, and only a model', /window\.HCDrop\?\.zone\(\$\("forge-mode-wrap"\), \(files\) => importForgeAsset\(files\[0\]\), \{ accept: \(f\) => \/\\\.\(\?:stl\|obj\|3mf\|step\|stp\|glb\|gltf\)\$\/i\.test\(f\.name\) \}\);/.test(src('modes', 'forge', 'mode.js')));
  ok('HashCoder takes its own, pictures, PDFs and text', /panel\.addEventListener\('drop'/.test(src('js', 'code', 'attach.js')) && /e\.stopPropagation\(\);\n\s*panel\.classList\.remove\('cdr-dropping'\);/.test(src('js', 'code', 'attach.js')));
  ok('the mark is drawn', /\.hc-dropping \{ outline: 2px dashed var\(--accent\);/.test(src('css', 'composer.css')));
  ok('it loads before the app and every mode', src('boot.js').indexOf("'/js/drop.js'") > 0 && src('boot.js').indexOf("'/js/drop.js'") < src('boot.js').indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:drop\b/.test(readFileSync(join(root, 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/drop.js)`);
process.exit(fail ? 1 : 0);
