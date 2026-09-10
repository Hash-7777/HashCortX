// ==============================================================
// File names and paths, as the Coder shows them
//
// The Coder shows a file by its name, and a file inside the project by its
// place in it. Both were worked out by splitting the path on forward slashes,
// in the helper and again by hand in several places. A path from Windows is
// written with backslashes, so none of those splits found anything to split
// on, and wherever a name belonged the whole path appeared instead: the
// project label, the explorer, the list of changes an agent made, the trace.
//
// These are display only. Whether a path is inside the project is decided in
// the Rust layer with the operating system's own rules, and nothing here
// changes that.
//
// Pure: takes strings, returns strings. No DOM, no storage, no network.
//
// Loaded before the Coder mode and published as window.HCCodePaths.
// Checked by scripts/checks/code-paths.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Either separator, as many in a row as there are. */
  const SEP = /[\\/]+/;

  /**
   * The last part of a path: a file's name, or a folder's.
   *
   * A trailing separator is not a name, so "/work/app/" gives "app". A path
   * with no separators at all is already a name and comes back unchanged.
   */
  function baseName(path) {
    const raw = String(path == null ? '' : path);
    const parts = raw.split(SEP).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : raw;
  }

  /**
   * A path inside the project, written from the project's folder.
   *
   * Separators are compared as the same character so either style is found
   * inside a root written in either style; what is returned keeps the path's
   * own separators. A path outside the project, or with no project open, is
   * returned whole — which is what it always did.
   */
  function relativeFromRoot(path, root) {
    const raw = String(path == null ? '' : path);
    const base = String(root == null ? '' : root).replace(/[\\/]+$/, '');
    if (!base) return raw;
    const same = (s) => s.replace(/\\/g, '/');
    return same(raw).startsWith(same(base) + '/') ? raw.slice(base.length + 1) : raw;
  }

  window.HCCodePaths = { baseName, relativeFromRoot };
})();
