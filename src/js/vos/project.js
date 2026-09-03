// ==============================================================
// The saved workspace, checked over before it is used
//
// This runs on the project read back out of the browser's database, and again
// on every save. It is the only thing standing between a stored record and the
// files a person sees, so what it decides to drop, they lose.
//
// It repairs rather than discards. A file with something wrong in its record
// is still a file somebody made, and there is no undo behind this: the result
// is written straight back over the stored copy. Anything repaired is
// reported, so a workspace does not quietly change shape on the way in.
//
// Pure: takes a project and its surroundings, returns what it repaired. No
// DOM, no storage, no network.
//
// Loaded before the Virtual OS mode and published as window.HCVosProject.
// Checked by scripts/checks/vos-project.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Put a stored project into the shape the mode expects.
   *
   * `project` is changed in place, the way the mode has always done it, and
   * the list of repairs is returned so the mode can say what it found.
   *
   * Needs from its caller: the id that means the root, the system icons whose
   * positions are remembered, and the mode's own name cleaner, clock and id
   * maker — so this file decides nothing about naming or identity on its own.
   */
  function normalizeProject(project, opts) {
    const o = opts || {};
    const rootId = o.rootId;
    const systemIconIds = Array.isArray(o.systemIconIds) ? o.systemIconIds : [];
    const safeName = typeof o.safeName === 'function' ? o.safeName : (n) => String(n || '');
    const nowIso = typeof o.nowIso === 'function' ? o.nowIso : () => new Date().toISOString();
    const newId = typeof o.newId === 'function' ? o.newId : () => `item_${Math.random().toString(36).slice(2, 10)}`;
    const repairs = [];

    if (!project || typeof project !== 'object') return { repairs };

    project.files = Array.isArray(project.files) ? project.files.filter(Boolean) : [];

    project.systemIconPositions = project.systemIconPositions && typeof project.systemIconPositions === 'object'
      ? project.systemIconPositions
      : {};
    for (const id of systemIconIds) {
      const pos = project.systemIconPositions[id];
      if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) {
        delete project.systemIconPositions[id];
      } else {
        project.systemIconPositions[id] = { x: Number(pos.x), y: Number(pos.y) };
      }
    }

    // An id that is missing or already taken used to mean the file was dropped
    // here, without a word, on the way to being saved over the stored copy. An
    // id is bookkeeping and the file is a person's work, so the bookkeeping is
    // the thing that gets fixed.
    const seen = new Set();
    for (const item of project.files) {
      if (!item.id) {
        item.id = newId(item.type === 'folder' ? 'folder' : 'file');
        repairs.push(`${String(item.name || 'an item')} had no id and was given one`);
      } else if (seen.has(item.id)) {
        const was = item.id;
        item.id = newId(item.type === 'folder' ? 'folder' : 'file');
        repairs.push(`${String(item.name || 'an item')} shared an id with another item (${was}) and was given a new one`);
      }
      seen.add(item.id);
    }

    for (const item of project.files) {
      item.type = item.type === 'folder' ? 'folder' : 'file';
      item.parentId = item.parentId || rootId;
      item.name = safeName(item.name || (item.type === 'folder' ? 'folder' : 'file.txt'));
      item.updatedAt = item.updatedAt || nowIso();
      if (item.deletedAt) {
        item.deletedAt = String(item.deletedAt);
        item.trashParentId = item.trashParentId || item.parentId || rootId;
        item.trashPath = item.trashPath || item.path || item.name;
        item.trashRoot = !!item.trashRoot;
      } else {
        delete item.deletedAt;
        delete item.trashParentId;
        delete item.trashPath;
        delete item.trashRoot;
      }
      if (item.type === 'folder') item.content = '';
      else item.content = String(item.content ?? '');
    }

    // A file whose folder is not there at all is put back at the root, which
    // is what restoring from the Trash already does with one.
    //
    // Left alone it is not lost but it cannot be found: the desktop and `ls`
    // both list a folder's contents by asking which items name it as their
    // parent, so an item naming a folder that does not exist appears in no
    // listing anywhere — while still being saved, still being searchable, and
    // still holding its name against a real file at the root.
    for (const item of project.files) {
      if (item.parentId === rootId || seen.has(item.parentId)) continue;
      item.parentId = rootId;
      repairs.push(`${item.name} was in a folder that no longer exists and was put back at the top level`);
    }

    return { repairs };
  }

  window.HCVosProject = { normalizeProject };
})();
