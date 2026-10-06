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
// failed to load is tried again the next time one is shown. A diagram
// Mermaid cannot read is read before it is drawn and left as its text, under
// a line saying so, rather than replaced by Mermaid's error picture; the
// console says so once for each such diagram, however often the
// conversation is drawn again.
//
// Published as window.HCDiagrams. Checked by scripts/checks/diagrams.mjs.
// ============================================================
(function () {
  'use strict';

  const SRC = '/js/vendor/mermaid.min.js';
  const SETTINGS = { startOnLoad: false, securityLevel: 'strict', theme: 'dark', suppressErrorRendering: true };
  const UNDRAWN = ".mermaid:not([data-processed='true'])";

  let loading = null;
  const judged = new Map();   // a diagram's text -> whether Mermaid can read it
  const warned = new Set();
  const taken = new WeakSet();   // nodes a draw already has, so two draws at once do not both run them

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

  /** Whether Mermaid can read a diagram's text, asked once for each text. */
  async function readable(mermaid, text) {
    if (!judged.has(text)) judged.set(text, typeof mermaid.parse !== 'function' || (await mermaid.parse(text, { suppressErrors: true }).catch(() => false)) !== false);
    return judged.get(text);
  }

  /** A diagram that cannot be drawn: its own text, marked as done, under a line saying why. */
  function leaveAsText(node, text) {
    node.setAttribute('data-processed', 'true');
    node.textContent = text;
    node.classList?.add('mermaid-unread');
    if (!node.previousElementSibling?.classList?.contains('mermaid-note') && typeof document.createElement === 'function' && node.before) {
      const note = document.createElement('p');
      note.className = 'mermaid-note';
      note.textContent = 'This diagram could not be drawn, so its text is shown.';
      node.before(note);
    }
    if (!warned.has(text)) { warned.add(text); console.warn('[mermaid] a diagram could not be drawn; its text is shown'); }
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
      const nodes = [...root.querySelectorAll(UNDRAWN)].filter((n) => !taken.has(n));
      nodes.forEach((n) => taken.add(n));
      const texts = nodes.map((n) => n.textContent);
      const good = [];
      for (let i = 0; i < nodes.length; i++) {
        if (await readable(mermaid, texts[i])) good.push(nodes[i]); else leaveAsText(nodes[i], texts[i]);
      }
      if (!good.length) return 0;
      try {
        await mermaid.run({ nodes: good });
      } finally {
        // One Mermaid read but could not draw is left as text the same way.
        good.forEach((n) => { if (!n.querySelector('svg')) leaveAsText(n, texts[nodes.indexOf(n)]); });
      }
      return good.length;
    } catch (err) {
      console.warn('[mermaid] render failed:', err);
      return 0;
    }
  }

  window.HCDiagrams = { draw, load, SRC, SETTINGS };
})();
