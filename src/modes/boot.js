// ==============================================================
// Mode loader
//
// Turns the list in manifest.js into the stylesheet and script tags that used
// to be written out by hand in index.html, fourteen lines of them, in two
// places that had to be kept in step with each other and with the mode's own
// registration.
//
// Two details here are load-bearing.
//
// WHERE THE STYLESHEETS GO. src/styles.css is linked last and is the app's
// final say; a fair amount of how the app looks depends on that. A stylesheet
// appended at the end of the document would land after it and quietly win
// every disagreement — for every mode at once. So each mode's sheet is
// inserted immediately BEFORE the styles.css link, which is exactly where it
// sat when index.html listed it. The cascade is unchanged.
//
// WHY THE SCRIPTS ARE NOT ASYNC. A script element created in JavaScript
// defaults to async, which means the seven mode files would execute in
// whatever order they finished downloading. Setting async = false restores the
// behaviour of a plain <script src> in the document: they run in the order
// they were added. Modes do not currently depend on each other, and this is
// what keeps that true by accident rather than by luck.
//
// Loaded after app.js, because a mode registers itself into a registry app.js
// defines, and app.js reads that registry lazily when a tab is clicked.
// ==============================================================
(function () {
  'use strict';

  const modes = window.HCModes;
  if (!modes || !Array.isArray(modes.MANIFEST)) {
    console.error('[HashCortx] mode manifest missing — no mode will load');
    return;
  }

  // The anchor that keeps the cascade in the order index.html established.
  const lastSheet = document.querySelector('link[rel="stylesheet"][href="/styles.css"]');

  for (const id of modes.MANIFEST) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = modes.path(id, 'mode.css');
    link.dataset.mode = id;
    if (lastSheet && lastSheet.parentNode) lastSheet.parentNode.insertBefore(link, lastSheet);
    else document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = modes.path(id, 'mode.js');
    script.async = false;
    script.dataset.mode = id;
    script.onerror = () => console.error(`[HashCortx] mode "${id}" failed to load`);
    document.body.appendChild(script);
  }
})();
