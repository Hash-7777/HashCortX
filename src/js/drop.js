// ==============================================================
// Files dropped on a workspace
//
// Dropping a picture, a PDF or any file on HashCortx did nothing in the app:
// the window took every drop for itself, so the page never saw one. The
// window now leaves drops to the page (tauri.conf.json, dragDropEnabled),
// and a file dropped on a workspace goes to that workspace, never to one out
// of sight: chat's handler on the window takes only what no workspace took,
// and nothing while another workspace is open.
//
// zone() makes an element a place to drop files on. It is marked while files
// are held over it, and what is dropped is handed to `take(files)`; files
// `accept` turns away are left out. Only a drag carrying files counts, so
// text or a link dragged within the page is left to the page.
//
// Published as window.HCDrop. Checked by scripts/checks/drop.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Whether a drag carries files from outside the page. */
  const hasFiles = (e) => !!(e && e.dataTransfer) && Array.from(e.dataTransfer.types || []).includes('Files');

  /**
   * Make `el` take dropped files: `take(files)` is given every file dropped
   * on it that `accept(file)` keeps. Returns a function that undoes it.
   */
  function zone(el, take, { accept = null, cls = 'hc-dropping' } = {}) {
    if (!el || typeof take !== 'function') return () => {};
    let depth = 0;   // enter and leave fire for each child crossed; the mark goes when the drag has left them all
    const over = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      el.classList.add(cls);
    };
    const enter = (e) => { if (hasFiles(e)) { depth++; over(e); } };
    const leave = (e) => { if (hasFiles(e) && !(depth = Math.max(0, depth - 1))) el.classList.remove(cls); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      el.classList.remove(cls);
      const files = Array.from(e.dataTransfer.files || []);
      const kept = typeof accept === 'function' ? files.filter(accept) : files;
      if (kept.length) take(kept);
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
      el.classList.remove(cls);
    };
  }

  window.HCDrop = { zone, hasFiles };
})();
