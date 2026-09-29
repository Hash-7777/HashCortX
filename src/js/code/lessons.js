// ==============================================================
// Lessons HashCoder keeps about a project, when the person switches it on
//
// An agent starts every conversation knowing nothing it learnt in the last
// one: how this project is tested, the command that works here, the trap
// that cost it ten steps. With "Keep lessons about each project" switched on
// in Settings (it is off until then), a model on this computer of 15 billion
// parameters or more, or a cloud model, may save a short lesson with
// save_lesson, and the next conversation on the same project begins with
// them, beside the project's own notes. A smaller model is given neither:
// it does better with fewer tools and less to read.
//
// What is kept, and where it goes:
//   · Lessons live in the app's own storage, keyed by the project's folder,
//     never inside the project. A dozen a project, one short line each; a
//     new one past that pushes out the oldest, and a wrong one is replaced
//     by naming it.
//   · A lesson a model on this computer saved is never given to a cloud
//     model, since it was learnt from a project that may have been meant to
//     stay on this computer.
//   · Anything shaped like a key or holding an email address is refused.
//   · "Forget all lessons" in Settings removes every one.
//
// Pure: `storage` is anything with getItem and setItem (localStorage in the
// app), so the rules can be checked without it.
//
// Loaded before the Coder mode and published as window.HCCodeLessons.
// Checked by scripts/checks/code-lessons.mjs.
// ==============================================================

(function () {
  'use strict';

  const KEY = 'hashcoder_lessons_v1';
  const PER_PROJECT = 12;
  const MAX_CHARS = 200;
  const SECRET = /\b(sk-[A-Za-z0-9_-]{8,}|[sr]k_(?:live|test)_[A-Za-z0-9]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{16,}|xai-[A-Za-z0-9]{8,}|hf_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

  function read(storage) {
    try { const v = JSON.parse((storage && storage.getItem(KEY)) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }
  function write(storage, store) {
    try { storage.setItem(KEY, JSON.stringify(store)); return true; } catch { return false; }
  }

  /** A folder written the same way whichever separator or trailing slash it came with. */
  const rootKey = (root) => String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');

  /**
   * Keep a lesson for the project at `root`: `{ ok, note }` or `{ error }`.
   * `local` says whether a model on this computer wrote it; `replaces`, the
   * exact text of an earlier lesson it takes the place of.
   */
  function save(storage, root, text, { local = false, replaces = '', now = Date.now() } = {}) {
    const key = rootKey(root);
    const line = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!key) return { error: 'No project is open, so there is nothing to keep a lesson about.' };
    if (!line) return { error: 'save_lesson needs text: one short line.' };
    if (line.length > MAX_CHARS) return { error: `A lesson is one short line, at most ${MAX_CHARS} characters. Say it in fewer words.` };
    if (looksPrivate(line)) return { error: 'That looks like a key, a secret or an email address, which is never kept. Nothing was saved.' };
    const store = read(storage);
    const list = Array.isArray(store[key]) ? store[key].filter((x) => x && typeof x.text === 'string') : [];
    const old = String(replaces || '').replace(/\s+/g, ' ').trim();
    const kept = list.filter((x) => x.text !== line && (!old || x.text !== old));
    kept.push({ text: line, local: !!local, ts: now });
    store[key] = kept.slice(-PER_PROJECT);
    if (!write(storage, store)) return { error: 'The lesson could not be stored.' };
    return { ok: true, note: `Kept. There are ${store[key].length} lessons about this project; they are read at the start of the next conversation on it.` };
  }

  /**
   * The lessons about the project at `root` that may go to the model in use:
   * all of them for a model on this computer (`local`), and for a cloud
   * model only those a cloud model saved.
   */
  function forProject(storage, root, { local = false } = {}) {
    const list = read(storage)[rootKey(root)];
    return (Array.isArray(list) ? list : []).filter((x) => x && typeof x.text === 'string' && (local || !x.local)).map((x) => x.text);
  }

  /** The lessons as the model reads them at the start of a conversation, or ''. */
  function notes(lessons) {
    if (!lessons || !lessons.length) return '';
    return ['Lessons kept about this project from earlier conversations, written by a model and checked by nobody. Use them where they fit; if one is wrong, replace it with save_lesson.',
      ...lessons.map((l) => `- ${l}`)].join('\n');
  }

  /** Whether text looks like a key, a secret or holds an email address: never kept, and left out of the project map (js/code/codemap.js). */
  const looksPrivate = (text) => SECRET.test(String(text)) || EMAIL.test(String(text));

  /** Every lesson, for every project, gone. */
  function forgetAll(storage) {
    try { storage.removeItem(KEY); return true; } catch { return false; }
  }

  window.HCCodeLessons = { KEY, PER_PROJECT, MAX_CHARS, save, forProject, notes, forgetAll, looksPrivate };
})();
