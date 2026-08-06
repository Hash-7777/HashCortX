// ==============================================================
// The Python sandbox's runtime loader
//
// Pyodide is CPython compiled to WebAssembly. The agent's execute_python tool
// runs inside it: real pandas, numpy, matplotlib, python-docx, openpyxl and
// reportlab, with a virtual disk whose /output directory becomes files the
// user is offered a save dialog for.
//
// It is fetched on first use, never at startup — the runtime alone is around
// 10 MB, and most sessions never run Python at all.
//
// WHY THIS HAS A TIMEOUT
// ----------------------
// This loader used to be twenty lines inside app.js with nothing bounding it,
// and it could not finish in any shipped build. `cdn.jsdelivr.net` was listed
// in the policy's script-src but not its connect-src, so the <script> tag
// loaded and the runtime fetch behind it was refused. loadPyodide() then
// neither resolved nor rejected: it waited for a response that the webview
// had already thrown away.
//
// The result was the worst shape a failure can take. execute_python awaited a
// promise that never settled, so the agent run stopped where it stood — no
// error, no message, nothing to retry — and because the promise was cached,
// every later call in that session stopped in the same place. Eight built-in
// agents are told they have this tool.
//
// The policy is fixed (see the connect-src note in tauri.conf.json), but a
// slow link, an offline machine or a CDN outage can all still leave that fetch
// outstanding. So every stage is bounded: if the runtime does not arrive, the
// tool reports why and the agent carries on without it.
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

  /** The <script> tag only. A CDN that is not answering should be quick to spot. */
  const SCRIPT_TIMEOUT_MS = 15000;

  /**
   * The runtime, its standard library and the three bundled wheels. Generous,
   * because this is a ~10 MB download on a connection we know nothing about,
   * but bounded, because an unbounded wait is what broke this before.
   */
  const LOAD_TIMEOUT_MS = 60000;

  /** Rejects rather than waiting for ever. */
  function withTimeout(promise, ms, what) {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)}s`)),
        ms
      );
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }

  let _promise = null;
  /**
   * Why the last attempt failed. Kept so a second call answers at once instead
   * of making the user wait out the same timeout again — a failed load is
   * almost always the network or the policy, and neither changes mid-session.
   */
  let _failed = null;

  function loadScript() {
    return withTimeout(
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${RUNTIME_URL}pyodide.js`;
        s.onload = resolve;
        s.onerror = () => reject(new Error('the Python runtime could not be downloaded'));
        document.head.appendChild(s);
      }),
      SCRIPT_TIMEOUT_MS,
      'downloading the Python runtime'
    );
  }

  async function start() {
    if (!window.loadPyodide) await loadScript();

    const py = await withTimeout(
      window.loadPyodide({ indexURL: RUNTIME_URL }),
      LOAD_TIMEOUT_MS,
      'starting the Python runtime'
    );

    await withTimeout(py.loadPackage(['micropip']), LOAD_TIMEOUT_MS, 'loading micropip');

    // python-docx, openpyxl and reportlab cover Word, Excel and PDF. pandas,
    // numpy and matplotlib are in Pyodide's own distribution and arrive when
    // the code imports them; these five are not, and micropip fetches whatever
    // is missing from PyPI — a host the policy does not permit, so all three
    // installs were refused and the sandbox came up without them.
    //
    // They ship with the app instead, and are installed by path from its own
    // origin. See src/wheels/PROVENANCE.md.
    //
    // A wheel that will not install is not fatal: the sandbox still runs, and
    // the import error names the package that is missing.
    try {
      const micropip = py.pyimport('micropip');
      await withTimeout(
        micropip.install(WHEELS.map((w) => `${location.origin}/wheels/${w}`)),
        LOAD_TIMEOUT_MS,
        'installing the document packages'
      );
    } catch (e) {
      console.warn('[HashCortx] Python document packages did not install:', e);
    }

    try { py.FS.mkdirTree('/output'); } catch {}
    return py;
  }

  /**
   * The running Python sandbox.
   *
   * Rejects with a sentence worth showing a user. execute_python turns that
   * into the tool's result, so the model reports it and keeps going rather
   * than stopping the run.
   */
  function getRuntime() {
    if (_failed) return Promise.reject(new Error(_failed));
    if (_promise) return _promise;
    _promise = start().catch((err) => {
      _failed =
        `${err && err.message ? err.message : err}. ` +
        'Python is unavailable for the rest of this session — continue without it, ' +
        'and do not tell the user a file was produced.';
      _promise = null;
      throw new Error(_failed);
    });
    return _promise;
  }

  window.HCPyodide = { getRuntime, RUNTIME_URL, SCRIPT_TIMEOUT_MS, LOAD_TIMEOUT_MS };
})();
