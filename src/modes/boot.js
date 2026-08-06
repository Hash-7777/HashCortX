// ==============================================================
// Mode loader
//
// Turns the list in manifest.js into the stylesheet, the tab button, the
// markup and the script that index.html used to carry by hand — fourteen tags,
// seven buttons and 1,125 lines of panel markup, in four places that had to be
// kept in step with each other and with the mode's own registration.
//
// A mode is now a folder and one line. Nothing else in the app names it.
//
// Four details here are load-bearing.
//
// WHERE THE STYLESHEETS GO. src/styles.css is linked last and is the app's
// final say; a fair amount of how the app looks depends on that. A stylesheet
// appended at the end of the document would land after it and quietly win
// every disagreement — for every mode at once. So each mode's sheet is
// inserted immediately BEFORE the styles.css link, which is exactly where it
// sat when index.html listed it. The cascade is unchanged.
//
// WHERE THE TAB BUTTON GOES. The button that opens a mode lives in that mode's
// panel.html, inside a <template data-mode-tab>, and is lifted into the
// sidebar's tab strip as the panel is inserted. Tab order is manifest order.
// The click handler in app.js is delegated on .tabs, so a button that arrives
// after boot works exactly like one that was in the document.
//
// WHERE THE PANELS GO. The seven panels were not all in the same place.
// Finance and Sandbox sat inside #app, four sat inside #mainApp, and Coder was
// a direct child of <body>. Those are different stacking and layout contexts,
// so the host is recorded per mode in the manifest and each panel goes back
// exactly where it was rather than all landing on <body>.
//
// PANELS BEFORE SCRIPTS. Four of the seven mode files look up an element at
// the top level, when the file runs rather than when the mode is opened. If a
// script ran before its markup existed, that lookup would return null, no
// error would be raised, and the feature behind it would simply never happen —
// this codebase's oldest and most expensive class of bug. So every panel is in
// the document before any mode script is added.
//
// WHY THE SCRIPTS ARE NOT ASYNC. A script element created in JavaScript
// defaults to async, which means the seven mode files would execute in
// whatever order they finished downloading. Setting async = false restores the
// behaviour of a plain <script src> in the document: they run in the order
// they were added.
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

  function addStylesheet(id) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = modes.path(id, 'mode.css');
    link.dataset.mode = id;
    if (lastSheet && lastSheet.parentNode) lastSheet.parentNode.insertBefore(link, lastSheet);
    else document.head.appendChild(link);
  }

  async function addPanel({ id, host }) {
    const target = host === 'body' ? document.body : document.querySelector(host);
    if (!target) throw new Error(`host ${host} not found`);
    const res = await fetch(modes.path(id, 'panel.html'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`panel.html returned ${res.status}`);

    // Parse rather than insert as text, because a panel carries two things
    // that belong in different places: the mode's own markup, and — inside a
    // <template data-mode-tab> — the button that opens it. The button belongs
    // in the sidebar's tab strip, so it is lifted out before the rest goes in.
    const holder = document.createElement('template');
    holder.innerHTML = await res.text();

    const tabTemplate = holder.content.querySelector('template[data-mode-tab]');
    if (tabTemplate) {
      const strip = document.querySelector('.tabs');
      if (!strip) throw new Error('no .tabs strip to put the tab button in');
      strip.appendChild(tabTemplate.content.cloneNode(true));
      tabTemplate.remove();
    }

    target.appendChild(holder.content);
  }

  function addScript(id) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = modes.path(id, 'mode.js');
      script.async = false;
      script.dataset.mode = id;
      script.onload = () => resolve(true);
      script.onerror = () => {
        console.error(`[HashCortx] mode "${id}" failed to load`);
        resolve(false);
      };
      document.body.appendChild(script);
    });
  }

  (async function loadModes() {
    for (const mode of modes.MANIFEST) addStylesheet(mode.id);

    // A mode whose markup did not arrive does not get its script. Half a mode
    // is worse than none: it registers, the tab lights up, and every lookup
    // inside it quietly returns null.
    const ready = [];
    for (const mode of modes.MANIFEST) {
      try {
        await addPanel(mode);
        ready.push(mode.id);
      } catch (err) {
        console.error(`[HashCortx] mode "${mode.id}" panel failed to load — the mode is disabled`, err);
      }
    }

    for (const id of ready) await addScript(id);

    document.dispatchEvent(new CustomEvent('hashcortx:modes-ready', { detail: { loaded: ready } }));
  })();
})();
