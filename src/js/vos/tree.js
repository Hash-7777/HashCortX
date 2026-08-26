// ============================================================
// vos/tree.js — the rules of a filesystem that is not one
//
// The Virtual OS looks like a filesystem and is not one: its files live in the
// browser's own storage and nothing here can touch a real disk. That is what
// makes it safe to let a model write into it, and it is also why the rules
// below are the whole of its safety — there is no operating system underneath
// to refuse anything.
//
// Three questions, all of them asked constantly and none of them previously
// answerable outside the mode:
//
//   What is this file called? A name a model chose can contain a slash, a
//   colon, or six hundred characters. It has to become something that can be
//   shown, stored and put in a downloaded archive.
//
//   Where does it sit? A path is built by walking up through parents, and a
//   parent can be missing, or — if something has gone wrong — can eventually
//   be the file itself. Walking that would not return.
//
//   May it be moved there? Dropping a folder inside its own contents makes a
//   loop that nothing afterwards can draw or save.
//
// Pure: a list of items in, answers out. Nothing is mutated, nothing is read
// from around it.
//
// Run the checks with: npm run check:vos-tree
// ============================================================
(function () {
  "use strict";

  /**
   * A name that can be shown, stored and archived.
   *
   * The characters taken out are the ones no common filesystem accepts, so a
   * project downloaded as an archive unpacks on any of them. The length cap is
   * generous and exists because a model asked for a file name occasionally
   * answers with a sentence.
   */
  function safeName(name) {
    return String(name || "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "untitled";
  }

  /**
   * A path with nothing in it that could point outside the project.
   *
   * Every segment goes through `safeName`, and `.` and `..` are dropped
   * entirely rather than resolved. Resolving them would be answering a
   * question nobody should be asking: there is no "up" from a project root,
   * and a model that writes one is guessing at a layout it cannot see.
   *
   * Never empty. A file with no path cannot be shown or downloaded, so
   * something unusable becomes the one name every project can hold.
   */
  function normalizePath(path) {
    const clean = String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .split("/")
      // Thrown away BEFORE each part is made safe, not after. Making an empty
      // segment safe turns it into the fallback name, and a fallback name is
      // not empty any more — so "src//main.js" grew a folder called
      // "untitled" between the two, and "///" became a file called that.
      .filter((part) => part && part !== "." && part !== "..")
      .map((part) => safeName(part))
      .join("/");
    return clean || "index.html";
  }

  /**
   * Where every item sits, walked up through its parents.
   *
   * Returns a map rather than writing onto the items, so a caller can ask
   * without changing anything.
   *
   * The guard against a loop is the important part. A folder that has somehow
   * become its own ancestor makes a walk that never ends, and this is called
   * on every save and every redraw — so it would not be a wrong answer, it
   * would be a frozen window. A path that runs into itself stops at the name.
   */
  function pathsFor(files, rootId = "root") {
    const list = Array.isArray(files) ? files : [];
    const byId = new Map(list.map((f) => [f.id, f]));
    const walk = (item, seen) => {
      if (!item || seen.has(item.id)) return item ? item.name : "";
      if (item.parentId === rootId || !byId.has(item.parentId)) return item.name;
      seen.add(item.id);
      return `${walk(byId.get(item.parentId), seen)}/${item.name}`;
    };
    const out = new Map();
    for (const item of list) out.set(item.id, normalizePath(walk(item, new Set())));
    return out;
  }

  /**
   * An item and everything under it, however deep.
   *
   * Used by deleting, restoring and downloading, all of which have to take a
   * folder's contents with it. Swept repeatedly rather than walked, so the
   * order the items happen to be stored in cannot leave a grandchild behind.
   */
  function descendantIds(files, rootId) {
    const ids = new Set([rootId]);
    const list = Array.isArray(files) ? files : [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of list) {
        if (ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  /**
   * Whether an item may be dropped into a folder.
   *
   * The rule that matters is the last one: a folder may not go inside its own
   * contents. That makes a loop, and a loop is not a wrong answer — it is a
   * project that cannot be drawn, cannot be saved and cannot be recovered
   * without editing storage by hand.
   *
   * Bounded as well as guarded, so a list that is already looped cannot hang
   * the check meant to prevent looping.
   */
  function canMoveToParent(files, item, parentId, rootId = "root") {
    if (!item || item.deletedAt) return false;
    if (!parentId || parentId === rootId) return true;
    const list = Array.isArray(files) ? files : [];
    const byId = new Map(list.map((f) => [f.id, f]));
    const target = byId.get(parentId);
    if (!target || target.deletedAt || target.type !== "folder" || target.id === item.id) return false;
    let parent = target;
    let steps = 0;
    while (parent && steps++ <= list.length) {
      if (parent.id === item.id) return false;
      if (parent.parentId === rootId) return true;
      parent = byId.get(parent.parentId);
    }
    return !!parent;
  }

  window.HCVosTree = { safeName, normalizePath, pathsFor, descendantIds, canMoveToParent };
})();
