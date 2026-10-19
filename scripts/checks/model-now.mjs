// ==============================================================
// Which model is answering, in every workspace — checks
//
// Loads the REAL src/js/model-now.js and holds that a request is counted
// while it runs and forgotten however it ends, that the line names the
// model answering now and how many others answer beside it, and the last
// to answer when nothing is in flight; then that every place a request to
// a model passes through counts it, and that the title bar holds the line.
//
// Run with: npm run check:model-now
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const load = () => {
  const sandbox = { window: {}, requestAnimationFrame: (fn) => { fn(); return 1; } };
  vm.createContext(sandbox);
  vm.runInContext(src('js', 'model-now.js'), sandbox, { filename: 'model-now.js' });
  return sandbox.window.HCModelNow;
};

console.log('What is answering:');
{
  const N = load();
  ok('nothing yet: the line is hidden', N.lineOf().shown === false);
  const a = N.start('cloud:openrouter:nvidia/nemotron-3-super-120b-a12b:free');
  let line = N.lineOf();
  ok('a request in flight is named, lit', line.shown && line.working && /nemotron-3-super/.test(line.text) && /openrouter/.test(line.text), line.text);
  N.stop(a);
  const b = N.start('cloud:nvidia:nvidia/nemotron-3-super-120b-a12b');
  line = N.lineOf();
  ok('a move to another model names the new one at once', line.working && / · nvidia$/.test(line.text) && !/openrouter/.test(line.text), line.text);
  const c = N.start('qwen2.5-coder:7b');
  line = N.lineOf();
  ok('two at once: the newest is named, and one more is counted', line.text === 'qwen2.5-coder:7b · this computer +1' && /Answering now: qwen2\.5-coder:7b · this computer, nvidia/.test(line.title), `${line.text} | ${line.title}`);
  N.stop(c); N.stop(b);
  line = N.lineOf();
  ok('nothing in flight: the last to answer, not lit', line.shown && !line.working && /Last to answer: qwen2\.5-coder:7b/.test(line.title));
  ok('stopping twice, or an id never given, changes nothing', (() => { N.stop(b); N.stop(999); return !N.state().working; })());
  ok('a request with no model is not counted', N.start('') === 0 && !N.state().working);
}
{
  const N = load();
  let seen = null;
  const p = N.around('cloud:groq:llama', async () => { seen = N.state(); throw new Error('refused'); });
  p.catch(() => {}).then(() => {
    ok('around counts a request while it runs', seen && seen.working && seen.model === 'cloud:groq:llama');
    ok('...and forgets it when it fails', !N.state().working);
  });
  await p.catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
}
{
  const N = load();
  N.setNamer((v) => (v === 'cloud:google:gemini-3.1-pro' ? 'Gemini 3.1 Pro Preview · Google' : ''));
  N.start('cloud:google:gemini-3.1-pro');
  ok('a cloud model is named as the picker names it', N.lineOf().text === 'Gemini 3.1 Pro Preview · Google');
  ok('one the picker has no name for is named by its id and provider', N.nameOf('cloud:mistral:mistral-large') === 'mistral-large · mistral');
  let calls = 0;
  const off = N.subscribe(() => calls++);
  const id = N.start('x'); N.stop(id); off(); N.start('y');
  ok('a listener hears each change until it stops listening', calls === 2);
}

console.log('\nA model on this computer answering lets the decorations rest:');
{
  const told = [];
  const sandbox = { window: { HCPower: { localModel: (on) => told.push(on) } }, requestAnimationFrame: (fn) => { fn(); return 1; } };
  vm.createContext(sandbox);
  vm.runInContext(src('js', 'model-now.js'), sandbox, { filename: 'model-now.js' });
  const N = sandbox.window.HCModelNow;
  const cloud = N.start('cloud:openrouter:some-model');
  ok('a cloud model answering is not one on this computer', told.at(-1) === false);
  const local = N.start('qwen2.5-coder:7b');
  ok('a model on this computer answering is said', told.at(-1) === true);
  N.stop(cloud);
  ok('...and still while it answers alone', told.at(-1) === true);
  N.stop(local);
  ok('...and no longer once it stops', told.at(-1) === false);
  const quiet = (() => { const sb = { window: {}, requestAnimationFrame: (fn) => { fn(); return 1; } }; vm.createContext(sb); vm.runInContext(src('js', 'model-now.js'), sb); try { sb.window.HCModelNow.stop(sb.window.HCModelNow.start('m')); return true; } catch { return false; } })();
  ok('without the power module, nothing breaks', quiet);
}

console.log('\nEvery request passes through it:');
{
  const app = src('js', 'app.js');
  const local = src('js', 'local-client.js');
  ok('a request to a model on this computer', /function chat\(host, request, options\) \{[\s\S]{0,200}now\.around\(request && request\.model, \(\) => ask\(host, request, options\)\)/.test(local));
  ok('a cloud answer being streamed, for each try', /const once = \(\) => HCModelNow\.around\(`cloud:\$\{provider\}:\$\{modelId\}`, \(\) => streamCloudModelOnce\(/.test(app));
  ok('the one place a model turn is dispatched, by model or by adapter', /const runModelTurn = \(request\) => HCModelNow\.around\(turnModel\(request\), \(\) =>/.test(app) && /const turnModel = \(r\) => \(r && \(r\.modelValue \|\| \(r\.adapter/.test(app));
  ok('a picture being made', /await HCModelNow\.around\(currentModelValue, \(\) => generateCloudImage\(/.test(app));
  ok('no stream or turn is sent another way', (app.match(/streamCloudModelOnce\(/g) || []).length === 2 && (app.match(/generateCloudImage\(/g) || []).length === 2);
  ok('cloud models are named as the picker names them, and the line is put in the title bar, which every workspace shows', /HCModelNow\.setNamer\(cloudModelLabel\); HCModelNow\.mount\(document\.querySelector\("\.hc-toolbar"\)\);/.test(app));
  // The line as mount() builds it, on a stand-in document.
  const made = [];
  const node = (tag) => { const n = { tag, attrs: {}, children: [], classList: { toggle() {} }, hidden: false, textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); } }; made.push(n); return n; };
  const doc = { createElement: node };
  const bar = { ownerDocument: doc, children: [], append(...c) { this.children.push(...c); } };
  const N = load();
  N.mount(bar);
  const line = bar.children[0];
  ok('mount puts the line in the bar, hidden until a model has answered', line && line.id === 'hcModelNow' && line.className === 'hc-model-now' && line.hidden === true && line.attrs.role === 'status');
  ok('every part of it keeps the bar draggable', made.length === 3 && made.every((n) => 'data-tauri-drag-region' in n.attrs));
  N.start('llama3.2:3b');
  ok('a request shows it, named', line.hidden === false && line.children[1].textContent === 'llama3.2:3b · this computer');
  ok('the shell holds no markup for it', !/hcModelNow|hc-model-now/.test(src('index.html')));
  const css = src('styles.css');
  ok('it is placed by position and cut before it can reach the centred title', /\.hc-model-now \{[^}]*position: absolute;[^}]*max-width: calc\(50% - \d+px\);/.test(css) && /\.hc-model-now-name \{[^}]*text-overflow: ellipsis;/.test(css));
  ok('it does not move: no animation on the line', !/\.hc-model-now[^{]*\{[^}]*animation/.test(css));
  const boot = src('boot.js');
  ok('it loads before the local client and app.js', boot.indexOf("'/js/model-now.js'") > 0 && boot.indexOf("'/js/model-now.js'") < boot.indexOf("'/js/local-client.js'") && boot.indexOf("'/js/model-now.js'") < boot.indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:model-now\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-now.js)`);
process.exit(fail ? 1 : 0);
