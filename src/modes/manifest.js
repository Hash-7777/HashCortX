// ==============================================================
// The mode list
//
// This is the one place a mode is named. Everything else about it lives in
// src/modes/<id>/ — its behaviour in mode.js, its look in mode.css, its markup
// in panel.html.
//
// Adding a mode used to mean four edits to index.html: a <link>, a <script>, a
// tab button, and a couple of hundred lines of markup. Nothing checked that
// you had done all four, and a mode with three of them registered fine and
// then did nothing when clicked.
//
// The id is the folder name AND the id the mode registers itself under. The
// two have to match, and check:modes fails if they ever stop matching.
//
// `host` is the element the panel is inserted into, and it is not decoration.
// Finance and Sandbox sit inside #app and the full-screen workspaces inside
// #mainApp. Those are different stacking and layout contexts. HashCoder is
// in #mainApp beside the others, so Settings, which it opens from its bar,
// and the memory map Settings opens, are layered above it as they are above
// every other workspace.
//
// Order is load order, and it is the cascade order of the stylesheets.
// ==============================================================
(function () {
  'use strict';

  window.HCModes = {
    MANIFEST: [
      { id: 'code',        host: '#mainApp' },
      { id: 'forge',       host: '#mainApp' },
      { id: 'finance',     host: '#app' },
      { id: 'sandbox',     host: '#app' },
      { id: 'systems',     host: '#mainApp' },
      { id: 'agent-maker', host: '#mainApp' },
      { id: 'virtual-os',  host: '#mainApp' },
    ],

    /** Where a mode's files live. One convention, no per-mode exceptions. */
    path: (id, file) => `/modes/${id}/${file}`,
  };
})();
