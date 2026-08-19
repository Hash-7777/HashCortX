// ==============================================================
// Undo and redo for hand edits
//
// Editing a model by hand is a sequence of small experiments — nudge a part,
// turn it, decide it was better before. Without a history the only way back is
// to place it by eye, which is not a way back at all: the number it had is
// gone the moment it is dragged.
//
// This is the record, and nothing else. It holds states the caller gives it
// and hands them back in order; it never touches a scene, a plan or the DOM,
// so a step can be replayed exactly rather than approximately, and the whole
// thing can be driven in a test.
//
// The rules that make a history feel right, rather than merely present:
//
//   · Undo walks all the way back, one step at a time, to the state the model
//     was in when the history began — not just the last thing that happened.
//   · Redo walks forward again, and is discarded the moment a new edit is
//     made, because the future it described no longer exists.
//   · A step that changed nothing is not a step. Otherwise a click that missed
//     costs a press of undo, and undo stops meaning anything.
//   · The record is bounded. An unbounded one grows for as long as the app is
//     open, and every entry is a full copy of the model.
//
// Run the checks with: npm run check:edit-history
// ==============================================================
(function () {
  "use strict";

  const DEFAULT_LIMIT = 100;

  /**
   * A new, empty history.
   *
   * `entries` are whatever the caller wants to replay — this module treats
   * them as opaque, and only ever compares them with the sameness test it is
   * given, so it stays honest about not understanding them.
   */
  function create(opts = {}) {
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_LIMIT;
    const same = typeof opts.same === "function" ? opts.same : ((a, b) => a === b);
    let entries = [];
    // How many entries have been applied. Everything before it can be undone,
    // everything from it onwards can be redone.
    let at = 0;

    return {
      /**
       * Record a step from `before` to `after`.
       *
       * Returns whether it was recorded, so a caller can tell a real edit from
       * a drag that ended where it started.
       */
      push(label, before, after) {
        if (same(before, after)) return false;
        // Anything that had been undone is now a branch nobody can reach.
        entries = entries.slice(0, at);
        entries.push({ label: String(label || "edit"), before, after });
        if (entries.length > limit) entries = entries.slice(entries.length - limit);
        at = entries.length;
        return true;
      },

      /** The step to undo, or null. The caller applies its `before`. */
      undo() {
        if (at <= 0) return null;
        at -= 1;
        return entries[at];
      },

      /** The step to redo, or null. The caller applies its `after`. */
      redo() {
        if (at >= entries.length) return null;
        const entry = entries[at];
        at += 1;
        return entry;
      },

      canUndo() { return at > 0; },
      canRedo() { return at < entries.length; },
      /** How many steps back it is still possible to go. */
      depth() { return at; },
      size() { return entries.length; },
      limit() { return limit; },
      clear() { entries = []; at = 0; },
    };
  }

  window.HCEditHistory = { create, DEFAULT_LIMIT };
})();
