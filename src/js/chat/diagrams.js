// ============================================================
// chat/diagrams.js — draws a reply's diagrams, loading Mermaid only for them
//
// A reply can carry a diagram as a ```mermaid block, and Mermaid draws it.
// Mermaid is the largest library the app ships, and most sessions never show
// a diagram, so it is not loaded at startup: the first time a conversation
// on screen holds a diagram not yet drawn, the library is added to the page,
// set up once, and kept for every diagram after it.
//
// Nothing is loaded for a conversation without a diagram. A library that
// failed to load is tried again the next time one is shown, and a diagram
// that cannot be drawn is left as its text, with a warning in the console.
//
// Published as window.HCDiagrams. Checked by scripts/checks/diagrams.mjs.
// ============================================================
(function () {
  'use strict';

  const SRC = '/js/vendor/mermaid.min.js';
  const SETTINGS = { startOnLoad: false, securityLevel: 'strict', theme: 'dark' };
  const UNDRAWN = ".mermaid:not([data-processed='true'])";

  let loading = null;

  /** Mermaid, added to the page and set up the first time it is asked for. */
  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      if (window.mermaid) { resolve(window.mermaid); return; }
      const el = document.createElement('script');
      el.src = SRC;
      el.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error(`${SRC} loaded without Mermaid`)));
      el.onerror = () => reject(new Error(`${SRC} failed to load`));
      document.head.appendChild(el);
    }).then((mermaid) => {
      mermaid.initialize(SETTINGS);
      return mermaid;
    });
    loading.catch(() => { loading = null; });
    return loading;
  }

  /**
   * Draw every diagram inside `root` not drawn yet. The library is loaded only
   * when there is one, and the diagrams are looked up again once it has
   * arrived, since the conversation may have been drawn again meanwhile.
   * Resolves to how many were handed to Mermaid.
   */
  async function draw(root) {
    if (!root || !root.querySelector(UNDRAWN)) return 0;
    try {
      const mermaid = await load();
      const nodes = root.querySelectorAll(UNDRAWN);
      if (!nodes.length) return 0;
      await mermaid.run({ nodes });
      return nodes.length;
    } catch (err) {
      console.warn('[mermaid] render failed:', err);
      return 0;
    }
  }

  window.HCDiagrams = { draw, load, SRC, SETTINGS };
})();
