// ==============================================================
// platform/tauri/undo.js — taking back a change the agent made
//
// The Coder panel shows a row for every file the agent writes or deletes. That
// row offered Accept and Reject, and Reject only relabelled itself: the file
// was written before the row appeared, and nothing put it back. A user who
// clicked it was told the change was rejected while it stayed on disk.
//
// This records what a file held immediately before each change, so Reject can
// mean it. Records are written by the Rust `checkpoint_*` commands into
// `~/.hashcortx/checkpoints/` — a directory the agent's own denylist refuses,
// so an agent cannot reach or erase the history of what it overwrote.
//
// WHY THIS IS NOT IN hashcoder.js
// -------------------------------
// Everything in `HC.code` is a tool a language model can call, and every one of
// them must pass HC.guard.request before it touches the machine —
// `scripts/checks/native-surface.mjs` enforces exactly that by counting. Undo
// is not a tool: nothing here is reachable from a model, every call starts with
// the user clicking a button, and the capture happens on a path the user has
// already approved writing. Keeping it in its own file means the rule over
// hashcoder.js stays as strict as it was rather than being relaxed to fit.
//
// Loaded after guard.js and before hashcoder.js, published as window.HC.undo.
// ==============================================================

(function () {
  'use strict';

  if (!window.HC) { window.HC = {}; }

  // The most recent checkpoint for each path. Keyed by path because that is all
  // a tool result carries; a later write to the same file replaces the entry,
  // which is what "undo this change" should mean.
  const _lastByPath = new Map();

  HC.undo = {
    /**
     * Remember what `path` holds right now.
     *
     * Never throws. Failing to record must not stop a write the user already
     * approved — but the record then carries the reason, and the panel shows no
     * undo rather than a button that would not work.
     */
    async capture(path) {
      let record;
      try {
        record = await HC.invoke('checkpoint_save', { path });
      } catch (e) {
        record = {
          id: null,
          path,
          content: null,
          existed: false,
          unrestorable: String(e?.message || e || 'the previous contents could not be saved'),
        };
      }
      _lastByPath.set(path, record);
      return record;
    },

    lastFor(path) {
      return _lastByPath.get(path) || null;
    },

    /**
     * Every change still waiting to be kept or undone, newest first.
     *
     * The records were always written to disk and never read back: the panel
     * found them through the map above, which starts empty. So closing the app
     * with a change pending lost the button while the copy of the file stayed
     * on disk, and neither the user nor the app could reach it again.
     *
     * Summaries only — no file contents. This runs at startup over everything
     * unanswered, and a record can hold megabytes.
     */
    async pending() {
      if (!HC.isTauri) return [];
      try {
        const list = await HC.invoke('checkpoint_list');
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    },

    /**
     * The full record for an id, contents and all.
     *
     * Fetched when someone asks to see or undo a change, rather than for every
     * row drawn. Kept in the map afterwards so a second look costs nothing.
     */
    async load(id) {
      if (!id || !HC.isTauri) return null;
      try {
        const record = await HC.invoke('checkpoint_read', { id });
        if (record?.path) _lastByPath.set(record.path, record);
        return record;
      } catch {
        return null;
      }
    },

    /**
     * Whether this change can be put back.
     *
     * False for a file that was binary, too large, or unreadable. Restoring one
     * of those would mean writing something that is not what was there, which
     * is worse than saying so.
     */
    canRestore(record) {
      return !!(record && !record.unrestorable);
    },

    /**
     * Put the file back the way it was.
     *
     * The write goes through `fs_write_file`, so a restore passes the same
     * denylist as any other write — a checkpoint cannot be used to place
     * content somewhere the app would otherwise refuse. It raises no permission
     * dialog: the user clicking the button is the permission, and asking them
     * to approve undoing a change they just refused would be absurd.
     */
    async restore(record) {
      if (!HC.undo.canRestore(record)) {
        throw new Error(record?.unrestorable || 'There is nothing recorded for that change.');
      }
      // A row drawn from `pending()` carries a summary, not the file. Fetch the
      // contents before writing anything, or an undo of a file that had text in
      // it would empty the file instead of putting it back.
      if (record.existed && record.content == null && record.id) {
        const full = await HC.undo.load(record.id);
        if (!full || (full.existed && full.content == null)) {
          throw new Error('That change can no longer be undone — its saved copy is gone.');
        }
        record = full;
      }
      if (!record.existed) {
        // The change created this file, so undoing it means removing it again.
        await HC.invoke('fs_delete_file', { path: record.path });
      } else {
        await HC.invoke('fs_write_file', { path: record.path, content: record.content ?? '' });
      }
      await HC.undo.drop(record);
      return true;
    },

    /** Forget a record — the change was kept, so the copy is dead weight. */
    async drop(record) {
      if (record?.id) {
        try { await HC.invoke('checkpoint_drop', { id: record.id }); } catch { /* already gone */ }
      }
      if (record?.path && _lastByPath.get(record.path) === record) {
        _lastByPath.delete(record.path);
      }
    },
  };
})();
