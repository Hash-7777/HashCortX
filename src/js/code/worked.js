// ==============================================================
// The commands that worked in a project, remembered by the app
//
// Each new conversation on a project began by working out again how it is
// tested and built here, often by a command that did not run on this
// computer. So the app writes down, by itself and from its own record of a
// run (js/code/verify.js proofLog), the checks that passed, and says them at
// the start of the next conversation. No model writes it, and nothing
// personal is kept: a command that names a place on the disk or a home
// folder is left out, and so is one too long to be a plain command. Each
// project and system keeps a few, newest first, in the app's own storage
// beside the project's lessons.
//
// Pure: reads and writes only the store it is handed.
// Published as window.HCCodeWorked. Checked by scripts/checks/code-worked.mjs.
// ==============================================================
(function () {
  'use strict';

  const KEY = 'hc_project_commands';
  /** The most commands a project keeps on one system. */
  const MOST = 6;
  /** The kinds of check the record knows (js/code/verify.js commandKind). */
  const KINDS = new Set(['test', 'lint', 'typecheck', 'build', 'format']);
  const LONGEST = 120;

  /** A command that is plain enough to keep: no place on the disk, no home folder. */
  const plain = (c) => typeof c === 'string' && c.trim() && c.length <= LONGEST && !/(?:^|\s)(?:\/|~|[A-Za-z]:\\)|\\\\/.test(c) && !/[\u0000-\u001f]/.test(c);

  const slot = (root, os) => `${String(os || '').toLowerCase() || 'any'}|${String(root || '').replace(/[\\/]+$/, '')}`;
  function readAll(store) {
    try { const v = JSON.parse(store.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }

  /** The commands kept for a project on a system, newest first: `[{ kind, command }]`. */
  function forProject(store, root, { os = '' } = {}) {
    if (!store || !root) return [];
    const list = readAll(store)[slot(root, os)];
    return Array.isArray(list) ? list.filter((c) => c && plain(c.command) && KINDS.has(c.kind)).slice(0, MOST) : [];
  }

  /** Write down the checks of a run that passed. Never throws. */
  function record(store, root, checks, { os = '' } = {}) {
    if (!store || !root) return;
    try {
      const passed = (Array.isArray(checks) ? checks : []).filter((c) => c && c.pass === true && KINDS.has(c.kind) && plain(c.command)).map((c) => ({ kind: c.kind, command: c.command.trim() }));
      if (!passed.length) return;
      const all = readAll(store);
      let list = forProject(store, root, { os });
      for (const c of passed) list = [c, ...list.filter((x) => x.command !== c.command)];
      all[slot(root, os)] = list.slice(0, MOST);
      store.setItem(KEY, JSON.stringify(all));
    } catch { /* a store that cannot be written keeps nothing */ }
  }

  /** The line a model is told at the start of a conversation, or ''. */
  function line(store, root, opts = {}) {
    const list = forProject(store, root, opts);
    if (!list.length) return '';
    return `Commands that passed in this project on this computer before, recorded by HashCortX from its own runs: ${list.map((c) => `\`${c.command}\` (${c.kind})`).join(', ')}.`;
  }

  window.HCCodeWorked = { KEY, MOST, KINDS, forProject, record, line };
})();
