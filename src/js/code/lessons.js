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
  function save(storage, root, text, { local = false, replaces = '', now = Date.now(), untrusted = false } = {}) {
    const key = rootKey(root);
    // Characters that draw nothing are taken out (js/text-safety.js): a lesson is read by every later conversation.
    const T = window.HCTextSafety;
    const raw = String(text == null ? '' : text);
    const line = (T ? T.strip(raw).text : raw).replace(/\s+/g, ' ').trim();
    if (!key) return { error: 'No project is open, so there is nothing to keep a lesson about.' };
    // A run that has read from outside could have been told what to write (js/code/outward.js).
    if (untrusted) return { error: 'This run has read material from outside the project, so no lesson is kept from it: what it read could have said what to write. Nothing was saved.' };
    if (!line) return { error: `save_lesson was not run: it needs text, one short line on how the project is built or tested. Call it as ${JSON.stringify({ text: 'the lesson in one short line' })}.` };
    if (line.length > MAX_CHARS) return { error: `A lesson is one short line, at most ${MAX_CHARS} characters. Say it in fewer words.` };
    if (looksPrivate(line)) return { error: 'That looks like a key, a secret or an email address, which is never kept. Nothing was saved.' };
    if (window.HCSources && window.HCSources.speaksToModel(line)) return { error: 'A lesson that speaks to AI systems is never kept: a lesson says how the project is built or tested. Nothing was saved.' };
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
  const looksPrivate = (text) => (window.HCSecretShapes ? window.HCSecretShapes.looksLikeKey(String(text)) : true) || EMAIL.test(String(text));   // js/secret-shapes.js; not known is not kept

  /** One lesson about the project at `root` gone, matched as save writes it. Whether there was one. */
  function forget(storage, root, text) {
    const key = rootKey(root);
    const T = window.HCTextSafety;
    const raw = String(text == null ? '' : text);
    const line = (T ? T.strip(raw).text : raw).replace(/\s+/g, ' ').trim();
    const store = read(storage);
    const list = Array.isArray(store[key]) ? store[key] : [];
    const kept = list.filter((x) => !(x && x.text === line));
    if (!key || !line || kept.length === list.length) return false;
    store[key] = kept;
    return write(storage, store);
  }

  /** Every lesson, for every project, gone. */
  function forgetAll(storage) {
    try { storage.removeItem(KEY); return true; } catch { return false; }
  }

  window.HCCodeLessons = { KEY, PER_PROJECT, MAX_CHARS, save, forProject, notes, forget, forgetAll, looksPrivate };
})();
