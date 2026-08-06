// ==============================================================
// The mode list
//
// This is the one place a mode is named. Everything else about it lives in
// src/modes/<id>/ — its behaviour in mode.js, its look in mode.css.
//
// Adding a mode used to mean four edits to index.html: a <link>, a <script>, a
// tab button, and a couple of hundred lines of markup. Nothing checked that
// you had done all four, and a mode with three of them registered fine and
// then did nothing when clicked.
//
// Two of those four are now this list. The id is the folder name and the id
// the mode registers itself under; the two have to match, and check:modes
// fails if they ever stop matching.
//
// Order is load order, and it is also the order the tabs appear in.
// ==============================================================
(function () {
  'use strict';

  window.HCModes = {
    MANIFEST: [
      'code',
      'forge',
      'finance',
      'sandbox',
      'systems',
      'agent-maker',
      'virtual-os',
    ],

    /** Where a mode's files live. One convention, no per-mode exceptions. */
    path: (id, file) => `/modes/${id}/${file}`,
  };
})();
