// ==============================================================
// The Python sandbox, inside a worker of its own
//
// Python here is written by a model, and a model can be told what to write by
// a web page it read or a file it opened. So it runs somewhere it can reach
// nothing of the app's:
//
//   - A worker has no page: no DOM, no localStorage — where the API keys
//     are — and no Tauri bridge, so none of the app's native commands.
//   - It is started from a blob, so it carries the page's Content Security
//     Policy: script and network limited to the same short list, and no eval.
//   - Before any model code runs, every way out that is left is removed: the
//     network interfaces, storage, other workers and further script loading.
//     fetch stays, narrowed to the two places the runtime loads packages from.
//   - It can be stopped: src/core/sandbox/pyodide.js terminates it when a run
//     goes on too long, and the app carries on.
//
// Messages in:  { type: 'init', runtime, wheels, allowed }
//               { type: 'run', id, code }
// Messages out: { type: 'ready' } | { type: 'failed', message }
//               { type: 'result', id, stdout, stderr, error, files: [{ name, data }] }
//
// Never loaded by the page: removing its ways out there would take the app's
// with them. scripts/checks/python-sandbox.mjs holds that.
// ==============================================================

'use strict';

let py = null;
let allowed = [];

// Kept before anything can replace it, and reachable only through the guard.
const realFetch = self.fetch.bind(self);

/** fetch, for the runtime's own packages and nothing else. */
function guardedFetch(input) {
  // A string, a URL object (which is how the runtime asks for its own
  // files) or a Request, whose address is its url.
  const raw = typeof input === 'string' ? input
    : (input && typeof input.url === 'string') ? input.url
      : (input && typeof input.href === 'string') ? input.href : '';
  let url;
  try { url = new URL(raw).href; } catch { return Promise.reject(new TypeError('That is not an address.')); }
  if (!allowed.some((prefix) => url.startsWith(prefix))) {
    return Promise.reject(new TypeError('Python has no network access here; it can only load its own packages.'));
  }
  // The checked string, never the caller's object: a Request could say one
  // address when checked and another when sent.
  return realFetch(url, { method: 'GET', credentials: 'omit' });
}

/** Everything in a worker that reaches past it, less what the runtime needs. */
const WAYS_OUT = [
  'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport',
  'Worker', 'SharedWorker', 'BroadcastChannel', 'FontFace', 'Notification',
  'importScripts', 'indexedDB', 'caches', 'eval', 'openDatabase',
  'webkitRequestFileSystem', 'requestFileSystem', 'webkitResolveLocalFileSystemURL',
  'loadPyodide',
];

function removeWaysOut() {
  for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of WAYS_OUT.concat('fetch')) {
      if (Object.prototype.hasOwnProperty.call(o, name)) {
        try { delete o[name]; } catch { /* not configurable */ }
        // A script's `var` makes a global that cannot be deleted, only emptied.
        if (Object.prototype.hasOwnProperty.call(o, name)) {
          try { o[name] = undefined; } catch { /* read-only — checked below */ }
        }
      }
    }
  }
  Object.defineProperty(self, 'fetch', { value: guardedFetch, writable: false, configurable: false, enumerable: true });
  // The origin's private file system is storage too.
  try { if (self.StorageManager) delete self.StorageManager.prototype.getDirectory; } catch { /* absent */ }
}

/** Whether any way out survived — reported, so a failure is not silent. */
function survivors() {
  return WAYS_OUT.filter((name) => self[name] != null);
}

async function init(msg) {
  try {
    allowed = (msg.allowed || []).filter((p) => typeof p === 'string' && /^https?:\/\/|^tauri:\/\//.test(p));
    // The runtime loads its own pieces with importScripts, so that goes last.
    Object.defineProperty(self, 'fetch', { value: guardedFetch, writable: true, configurable: true });
    importScripts(`${msg.runtime}pyodide.js`);
    py = await self.loadPyodide({ indexURL: msg.runtime });
    await py.loadPackage(['micropip']);
    try {
      await py.pyimport('micropip').install(msg.wheels);
    } catch (e) {
      // The sandbox still runs; an import names the package that is missing.
      console.warn('[HashCortx] Python document packages did not install:', e);
    }
    try { py.FS.mkdirTree('/output'); } catch { /* already there */ }
    removeWaysOut();
    const left = survivors();
    if (left.length) throw new Error(`the sandbox could not be closed off (${left.join(', ')} still reachable)`);
    self.postMessage({ type: 'ready' });
  } catch (e) {
    self.postMessage({ type: 'failed', message: String((e && e.message) || e) });
  }
}

/** Largest file handed back; the save in Rust refuses anything larger anyway. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

async function run(msg) {
  const out = { type: 'result', id: msg.id, stdout: '', stderr: '', error: null, files: [] };
  try {
    py.runPython('import sys, io as _io\n_stdout = _io.StringIO()\n_stderr = _io.StringIO()\nsys.stdout = _stdout\nsys.stderr = _stderr\n');
    try {
      // pandas, numpy and matplotlib ship with the runtime but load only
      // when imported; without this, importing one raises.
      await py.loadPackagesFromImports(msg.code);
      await py.runPythonAsync(msg.code);
    } catch (e) {
      out.error = String((e && e.message) || e).split('\n').slice(-12).join('\n');
    }
    out.stdout = py.runPython('_stdout.getvalue()') || '';
    out.stderr = py.runPython('_stderr.getvalue()') || '';
    py.runPython('sys.stdout = sys.__stdout__\nsys.stderr = sys.__stderr__');
    for (const name of py.FS.readdir('/output')) {
      if (name === '.' || name === '..') continue;
      const path = `/output/${name}`;
      try {
        if (py.FS.isDir(py.FS.stat(path).mode)) continue;
        const data = py.FS.readFile(path);
        if (data.length <= MAX_FILE_BYTES) out.files.push({ name, data });
        else out.error = `${out.error ? `${out.error}\n` : ''}${name} is larger than a file this app will save.`;
        py.FS.unlink(path);
      } catch { /* a file that vanished while being read */ }
    }
  } catch (e) {
    out.error = out.error || String((e && e.message) || e);
  }
  self.postMessage(out, out.files.map((f) => f.data.buffer));
}

// One job at a time, in the order asked: a second run arriving while the first
// awaits a package would otherwise interleave with it.
let queue = Promise.resolve();
self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'init' && !py) queue = queue.then(() => init(msg));
  else if (msg.type === 'run' && py) queue = queue.then(() => run(msg));
};
