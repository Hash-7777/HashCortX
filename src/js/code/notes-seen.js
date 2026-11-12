// ==============================================================
// A project's notes for agents, changed since last time
//
// HashCoder gives the model a project's notes for coding agents (AGENTS.md,
// js/code/context.js) when a conversation begins, and a model follows them
// for how to build, test and write code there. They are a file in the
// project, so they can change without the person changing them: a pull, a
// branch, a copy from somewhere else. When they are not what HashCoder read
// the last time it opened the project, the first reply says so, and opens to
// show them.
//
// What is kept is a fingerprint of the notes, per project folder, in the
// app's own storage: the SHA-256 of the text, so a project cannot write a
// different note that reads as the same, and never the text itself. The first
// time a project is read there is nothing to compare with, and nothing is
// said. Notes that appear where there were none are a change; notes taken
// away are not said, since nothing is then given to the model. Without the
// page's crypto, or storage that can be read and written, nothing is said
// and nothing is held up.
//
// Pure but for the storage and crypto it is handed or finds on the page.
// Loaded before the Coder mode and published as window.HCCodeNotesSeen.
// Checked by scripts/checks/code-notes-seen.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Where the fingerprints are kept, by project folder. */
  const KEY = 'hc_notes_seen';
  /** At most this many projects are remembered, the ones read longest ago going first. */
  const MOST = 200;
  /** The line the reply shows. */
  const LINE = 'This project\'s notes for agents changed since last time';

  /** The line, naming the file. */
  const lineFor = (name) => (name ? `This project's notes for agents (${name}) changed since last time` : LINE);

  /** The SHA-256 of `text` in hex, or null when the page has no crypto to make it. */
  async function fingerprint(text) {
    const subtle = typeof crypto !== 'undefined' && crypto && crypto.subtle;
    if (!subtle || typeof TextEncoder === 'undefined') return null;
    try {
      const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(String(text == null ? '' : text))));
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  function readAll(store) {
    try {
      const v = JSON.parse((store && store.getItem(KEY)) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }

  /**
   * Compare the notes read now for the project at `root` with the last ones,
   * and keep these. `{ name, text }` when they changed and there are notes
   * now; null otherwise, or when nothing can be compared.
   */
  async function check(store, root, name, text) {
    if (!store || !root) return null;
    const now = typeof text === 'string' ? text : '';
    const h = await fingerprint(now);
    if (!h) return null;
    const all = readAll(store);
    const was = all[root];
    delete all[root];
    all[root] = h;   // newest last
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MOST))) delete all[k];
    try { store.setItem(KEY, JSON.stringify(all)); } catch { return null; }   // what cannot be kept cannot be compared next time either
    return typeof was === 'string' && was !== h && now.trim() ? { name: name || '', text: now } : null;
  }

  window.HCCodeNotesSeen = { KEY, MOST, LINE, lineFor, fingerprint, check };
})();
