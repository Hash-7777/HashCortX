// ==============================================================
// What a command changed in the project
//
// HashCoder's own file tools keep a copy of what they change, so each change
// has its row and its Undo. A command does not: a build, a script, a
// formatter or a generator can change any file, and nothing showed which.
// So a quick record of the project's files, each one's place, size and
// last-changed time, is taken before and after a command that is not a plain
// read (src-tauri/src/commands/fs.rs fs_snapshot), and every file changed,
// added or removed between the two is said: to the model in the command's
// result, and to the person in the receipt, as having no Undo.
//
// These are not counted as the run's own changes: a check that writes files
// as it runs would otherwise seem to leave the change it checked unproven.
//
// Pure. Published as window.HCCodeCommandChanges.
// Checked by scripts/checks/code-command-changes.mjs.
// ==============================================================
(function () {
  'use strict';

  /** How many files a note names before it counts the rest. */
  const NAMED = 20;
  /** The most files one record names (as fs.rs SNAPSHOT_MOST). */
  const RECORD_MOST = 2000;

  /** Whether a command is recorded around: anything but a plain read Auto lets through. */
  function watches(call, { root = '', os = '' } = {}) {
    const a = call && typeof call === 'object' ? call : {};
    const P = typeof window !== 'undefined' && window.HCCodePermissions;
    if (!P || !P.shellVerdict) return true;
    const v = P.shellVerdict({ command: a.command, args: Array.isArray(a.args) ? a.args : [], cwd: a.cwd, root, os });
    return !(v && v.auto && v.tier === 'read');
  }

  /** `{ changed, added, removed, paths, cut }` between two records. */
  function diff(before, after) {
    const at = (r) => new Map(((r && Array.isArray(r.files)) ? r.files : []).filter((f) => f && typeof f.path === 'string').map((f) => [f.path, f]));
    const b = at(before), a = at(after);
    const changed = [], added = [], removed = [];
    for (const [p, f] of a) {
      const was = b.get(p);
      if (!was) added.push(p);
      else if (was.size !== f.size || was.modified !== f.modified) changed.push(p);
    }
    for (const p of b.keys()) if (!a.has(p)) removed.push(p);
    const how = new Map([...changed.map((p) => [p, 'changed']), ...added.map((p) => [p, 'new']), ...removed.map((p) => [p, 'removed'])]);
    const paths = [...how.keys()].sort();
    return { changed: changed.sort(), added: added.sort(), removed: removed.sort(), paths, how, cut: !!((before && before.cut) || (after && after.cut)) };
  }

  /** What the model is told of it, or '' when nothing changed. */
  function note(d) {
    if (!d || !d.paths || !d.paths.length) return '';
    const named = d.paths.slice(0, NAMED).map((p) => `${p} (${d.how.get(p)})`).join(', ');
    const more = d.paths.length > NAMED ? `, and ${d.paths.length - NAMED} more` : '';
    const cut = d.cut ? ` The record covers the first ${RECORD_MOST.toLocaleString('en-US')} files of the project.` : '';
    return `[The command changed these files in the project: ${named}${more}. The app kept no copy of them first, so Undo cannot put them back; check them before going on.${cut}]`;
  }

  window.HCCodeCommandChanges = { NAMED, RECORD_MOST, watches, diff, note };
})();
