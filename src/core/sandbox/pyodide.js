// ==============================================================
// The Python sandbox's runtime, run in a worker
//
// Pyodide is CPython compiled to WebAssembly. The agent's execute_python tool
// runs inside it: real pandas, numpy, matplotlib, python-docx, openpyxl and
// reportlab, with a virtual disk whose /output directory becomes files the
// user is offered a save dialog for.
//
// The Python itself runs in src/workers/python.js, a worker that can reach
// nothing of the app's — see that file for what it removes and why. This file
// starts it, hands it code one job at a time, and stops it when a job runs too
// long: the worker is terminated, the job answers with a sentence the model
// can act on, and the next job starts a fresh one.
//
// It is fetched on first use, never at startup — the runtime alone is around
// 10 MB, and most sessions never run Python at all.
//
// WHY EVERY STAGE HAS A TIMEOUT
// -----------------------------
// This loader used to be twenty lines inside app.js with nothing bounding it,
// and it could not finish in any shipped build: the runtime fetch was refused
// by the policy and loadPyodide() then neither resolved nor rejected. The
// agent run stopped where it stood, with no error, and because the promise was
// cached every later call stopped in the same place. A slow link, an offline
// machine or a CDN outage can still leave that fetch outstanding, so starting
// is bounded, and so is every run.
//
// Loaded before app.js and published as window.HCPyodide.
// ==============================================================

(function () {
  'use strict';

  const RUNTIME_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

  /**
   * The packages Pyodide does not bundle, shipped with the app and installed
   * from its own origin. Order does not matter; micropip resolves between
   * them. Anything they depend on that IS bundled — lxml, pillow,
   * typing_extensions — comes from the runtime.
   *
   * Recorded, with licences and why they are vendored, in
   * src/wheels/PROVENANCE.md.
   */
  const WHEELS = [
    'python_docx-1.2.0-py3-none-any.whl',
    'openpyxl-3.1.5-py2.py3-none-any.whl',
    'et_xmlfile-2.0.0-py3-none-any.whl',
    'reportlab-5.0.0-py3-none-any.whl',
    'charset_normalizer-3.4.9-py3-none-any.whl',
  ];

  /**
   * Starting: the runtime, its standard library, micropip and the wheels.
   * Generous, because this is a ~10 MB download on a connection we know
   * nothing about, but bounded, because an unbounded wait is what broke this.
   */
  const START_TIMEOUT_MS = 120000;

  /** One run. Past this the worker is stopped and its variables are gone. */
  const RUN_TIMEOUT_MS = 180000;

  const WORKER_PATH = '/workers/python.js';

  let worker = null;
  let starting = null;     // Promise of a ready worker
  let startFailure = null; // why starting failed, for the rest of the session
  let nextId = 0;
  const pending = new Map();
  let queue = Promise.resolve();

  function spawn() {
    // From a blob, so the worker carries this page's security policy. A
    // worker loaded from a file of the app's gets no policy at all: the
    // policy is sent only with the page.
    const loader = `importScripts(${JSON.stringify(location.origin + WORKER_PATH)});`;
    const url = URL.createObjectURL(new Blob([loader], { type: 'text/javascript' }));
    const w = new Worker(url);
    return { w, url };
  }

  /** Stop the worker and everything waiting on it. */
  function stop(reason) {
    if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
    worker = null;
    starting = null;
    for (const [, job] of pending) {
      clearTimeout(job.timer);
      job.resolve({ stdout: '', stderr: '', error: reason, files: [] });
    }
    pending.clear();
  }

  /** A file name from the sandbox, as a name and never a path. */
  function safeName(name) {
    const clean = String(name).replace(/[\\/:]/g, '_');
    return !clean || clean.split('').every((c) => c === '.') ? 'output' : clean;
  }

  /** What the worker sent back, taken at face value only where it is safe. */
  function onMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.type !== 'result') return;
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    clearTimeout(job.timer);
    const text = (v) => (typeof v === 'string' ? v : '');
    const files = Array.isArray(msg.files) ? msg.files : [];
    job.resolve({
      stdout: text(msg.stdout),
      stderr: text(msg.stderr),
      error: msg.error == null ? null : text(msg.error) || 'Python failed.',
      // A name is a suggestion for a save dialog, never a path: no folders.
      files: files
        .filter((f) => f && typeof f.name === 'string' && f.data instanceof Uint8Array)
        .map((f) => ({ name: safeName(f.name), data: f.data })),
    });
  }

  function ready() {
    if (startFailure) return Promise.reject(new Error(startFailure));
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      let spawned;
      try { spawned = spawn(); } catch (e) { reject(e); return; }
      const { w, url } = spawned;
      worker = w;
      const timer = setTimeout(() => reject(new Error(`starting the Python runtime did not finish within ${START_TIMEOUT_MS / 1000}s`)), START_TIMEOUT_MS);
      w.onmessage = (event) => {
        const msg = event.data;
        if (msg && msg.type === 'ready') { clearTimeout(timer); URL.revokeObjectURL(url); resolve(w); }
        else if (msg && msg.type === 'failed') { clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error(String(msg.message || 'the Python runtime did not start'))); }
        else onMessage(msg);
      };
      w.onerror = (event) => {
        clearTimeout(timer);
        const why = (event && event.message) || 'the Python runtime stopped';
        event && event.preventDefault && event.preventDefault();
        reject(new Error(why));
        stop(`Python stopped: ${why}.`);
      };
      w.postMessage({
        type: 'init',
        runtime: RUNTIME_URL,
        wheels: WHEELS.map((name) => `${location.origin}/wheels/${name}`),
        allowed: [RUNTIME_URL, `${location.origin}/wheels/`],
      });
    }).catch((err) => {
      stop(String(err.message || err));
      startFailure =
        `${err && err.message ? err.message : err}. ` +
        'Python is unavailable for the rest of this session — continue without it, ' +
        'and do not tell the user a file was produced.';
      throw new Error(startFailure);
    });
    return starting;
  }

  /**
   * Run Python and collect what it printed and the files it wrote to /output.
   *
   * Resolves with { stdout, stderr, error, files: [{ name, data }] }. Rejects
   * only when the runtime cannot start, with a sentence worth showing a user;
   * execute_python turns that into the tool's result, so the model reports it
   * and keeps going rather than stopping the run.
   */
  function run(code, options) {
    const timeoutMs = (options && options.timeoutMs) || RUN_TIMEOUT_MS;
    const job = queue.then(async () => {
      const w = await ready();
      return new Promise((resolve) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({
            stdout: '', stderr: '', files: [],
            error: `Python ran for more than ${Math.round(timeoutMs / 1000)}s and was stopped. ` +
              'Its variables are gone; run again from the beginning, doing less at once.',
          });
          stop('Python was stopped.');
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        w.postMessage({ type: 'run', id, code: String(code) });
      });
    });
    // A failed job must not stop the ones queued after it.
    queue = job.catch(() => {});
    return job;
  }

  window.HCPyodide = { run, RUNTIME_URL, WORKER_PATH, START_TIMEOUT_MS, RUN_TIMEOUT_MS };
})();
