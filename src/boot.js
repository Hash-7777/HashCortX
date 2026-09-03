// ==============================================================
// Shell loader
//
// index.html used to carry two lists by hand: the overlay markup — settings,
// the agent editor, the memory map, templates, preview, the alert dialog —
// and thirty script tags in a precise order. 516 lines of markup for panels
// that are hidden until you open them, parsed on every launch.
//
// The markup now lives beside the code that owns it, and this file puts both
// back in the right order.
//
// WHY THE SCRIPT TAGS HAD TO MOVE TOO. An overlay is not a mode. A mode
// registers itself and is looked up when its tab is clicked, so its panel can
// arrive whenever. The overlays are read at load: app.js resolves 49 ids from
// inside them at module scope, before anyone has clicked anything. Making
// those 49 lookups lazy would be a far larger change to app.js than this. So
// the panels go in first, and the scripts follow — which they cannot do while
// they are static tags in the document.
//
// WHY THAT IS SAFE HERE.
//
//   · #mainApp carries visibility:hidden until main.js reveals it, so nothing
//     can flash while this runs. The app is invisible until the last script
//     in the list has executed.
//   · script.async = false makes dynamically added scripts run in the order
//     they were added, exactly as document order did.
//   · The mode files have already loaded this way since they moved into
//     src/modes/, including the three that check document.readyState — all of
//     them handle having missed DOMContentLoaded, because they already do.
//   · Vendor libraries stay as ordinary tags in <head>. They do not touch the
//     overlays, and keeping them static means the parser can still fetch them
//     while this runs.
//
// If a panel fails to arrive, the scripts are NOT loaded. A half-built shell
// is worse than an obvious failure: app.js would resolve those 49 lookups to
// null, raise nothing, and the app would open with most of it quietly inert.
// ==============================================================
(function () {
  'use strict';

  /** Hidden panels, and the element each is inserted into. */
  const PANELS = [
    { file: '/core/settings/panel.html',   host: '#mainApp' },
    { file: '/core/memory/map-panel.html', host: '#mainApp' },
    { file: '/core/agents/panel.html',     host: '#mainApp' },
    { file: '/core/overlays/panel.html',   host: '#mainApp' },
  ];

  /**
   * Every script, in the order it must run. This is the same order index.html
   * listed, and the order is the contract: the platform layer defines
   * HC.invoke, the libraries publish their window.HC* objects, the split-out
   * core modules publish theirs, app.js reads all of them, the mode loader
   * needs app.js's registry, and main.js reveals the window at the end.
   */
  const SCRIPTS = [
    '/platform/index.js',
    '/platform/tauri/keychain.js',
    '/platform/tauri/guard.js',
    '/platform/tauri/undo.js',
    '/platform/tauri/save.js',
    '/platform/tauri/hashcoder.js',

    '/js/power.js',
    '/js/diff.js',
    '/js/export-format.js',
    '/js/rag-search.js',
    '/js/rag-store.js',
    '/js/url-safety.js',
    '/js/page-text.js',
    '/js/pdf-text.js',
    '/js/providers.js',
    '/js/chat/context.js',
    '/js/chat/failover.js',
    '/js/markdown-safe.js',
    '/js/agent-shape.js',
    '/js/model-names.js',
    '/js/cloud-model-memory.js',
    '/js/cloud-model-fetch.js',
    '/js/memory.js',
    '/js/vector-map.js',
    '/js/forge/expr.js',
    '/js/finance/amounts.js',
    '/js/swarm/graph.js',
    '/js/systems/spec.js',
    '/js/systems/money.js',
    '/js/systems/domain.js',
    '/js/model-plan.js',
    '/js/forge/units.js',
    '/js/forge/subdivide.js',
    '/js/forge/params.js',
    '/js/forge/plan-normalize.js',
    '/js/forge/capability.js',
    '/js/forge/panel-html.js',
    '/js/forge/io/mesh.js',
    '/js/forge/io/scene.js',
    '/js/forge/io/stl.js',
    '/js/forge/io/obj.js',
    '/js/io/zip.js',
    '/js/vos/tree.js',
    '/js/vos/answer.js',
    '/js/vos/shell.js',
    '/js/forge/io/threemf.js',
    '/js/forge/io/step.js',
    '/js/forge/io/import.js',
    '/js/forge/meshfield.js',
    '/js/forge/field.js',
    '/js/forge/surface.js',
    '/js/forge/printable.js',
    '/js/edit-history.js',
    '/js/agent-context.js',
    '/js/agent-policy.js',

    '/data/prompts.js',
    '/data/cloud-models.js',
    '/core/memory/store.js',
    '/core/memory/map.js',
    '/core/settings/local-model.js',
    '/core/settings/memory-pane.js',
    '/core/rag/knowledge-base.js',
    '/core/sandbox/pyodide.js',

    '/js/app.js',
    '/modes/manifest.js',
    '/modes/boot.js',

    '/main.js',
  ];

  async function addPanel({ file, host }) {
    const target = host === 'body' ? document.body : document.querySelector(host);
    if (!target) throw new Error(`host ${host} not found`);
    const res = await fetch(file, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${file} returned ${res.status}`);
    target.insertAdjacentHTML('beforeend', await res.text());
  }

  function addScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`${src} failed to load`));
      document.body.appendChild(el);
    });
  }

  function fail(message, err) {
    console.error(`[HashCortx] ${message}`, err || '');
    const app = document.getElementById('mainApp');
    if (app) { app.style.visibility = 'visible'; app.style.pointerEvents = 'auto'; }
    const intro = document.getElementById('intro-screen');
    if (intro) intro.remove();
    const note = document.createElement('div');
    note.setAttribute('role', 'alert');
    note.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:32px;text-align:center;font:14px/1.6 system-ui,sans-serif;color:#e6edf3;background:#0b0e13;z-index:2147483647';
    note.textContent = `HashCortX could not finish starting: ${message}. Reload to try again.`;
    document.body.appendChild(note);
  }

  (async function boot() {
    try {
      for (const panel of PANELS) await addPanel(panel);
    } catch (err) {
      fail('a part of the window did not load', err);
      return;
    }
    try {
      for (const src of SCRIPTS) await addScript(src);
    } catch (err) {
      fail(err.message, err);
      return;
    }
    document.dispatchEvent(new CustomEvent('hashcortx:shell-ready'));
  })();
})();
