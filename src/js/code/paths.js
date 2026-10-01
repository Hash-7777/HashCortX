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
// A path a model writes from the project's folder ("src/app.js",
// "./src/app.js") is also written out from that folder here before a tool
// runs. Given as it was, it was read from wherever the app was started, and
// refused as outside the project: a small model wrote every path that way
// and read nothing. A full path, one starting at a home folder, and one
// climbing with ".." are left as written.
//
// None of this decides anything. Whether a path is inside the project is
// decided by the permission guard and in the Rust layer, with the operating
// system's own rules, on the path as it is given to them.
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

  /**
   * `path` written out from `root` when it was written from the project's
   * folder: "src/a.js" and "./src/a.js" give "<root>/src/a.js", and "." gives
   * the root. A full path, one starting at a home folder ("~"), one climbing
   * with "..", anything that is not a string, and anything with no project
   * open come back as they were, for the guard to judge as written.
   */
  function fromRoot(path, root) {
    const base = String(root == null ? '' : root).replace(/[\\/]+$/, '');
    if (!base || typeof path !== 'string' || !path.trim()) return path;
    if (/^(?:[\\/~]|[A-Za-z]:)/.test(path) || path.split(SEP).includes('..')) return path;
    const rest = path.replace(/^(?:\.[\\/]+)+/, '').replace(/^\.$/, '');
    if (!rest) return base;
    return `${base}${base.includes('/') || !base.includes('\\') ? '/' : '\\'}${rest}`;
  }

  /** The arguments of a tool call that name a place: a file, a folder, where a command runs. */
  const PLACES = ['path', 'dir', 'from', 'to', 'cwd'];

  /** A tool call's arguments with each place in them written out from `root` (fromRoot). */
  function argsFromRoot(args, root) {
    if (!args || typeof args !== 'object') return args;
    let out = args;
    for (const key of PLACES) {
      const full = fromRoot(args[key], root);
      if (full !== args[key]) out = { ...out, [key]: full };
    }
    return out;
  }

  window.HCCodePaths = { baseName, relativeFromRoot, fromRoot, argsFromRoot };
})();
