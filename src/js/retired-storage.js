// ==============================================================
// Retired storage — clearing what a removed workspace left behind
//
// A workspace taken out of the app leaves its saved data in the webview's
// storage, where nothing can open it again. Each name below is that storage,
// and it is cleared at launch. Deleting a store that is already gone does
// nothing, so clearing again on every launch costs nothing and needs no flag
// of its own to remember that it ran.
//
// Only the names listed are touched, and every one belonged to a workspace
// that is no longer in the app. A name that anything still reads must never
// be listed here: scripts/checks/retired-storage.mjs fails if one appears
// anywhere else in src/.
//
// Checked by scripts/checks/retired-storage.mjs.
// ==============================================================
(function () {
  'use strict';

  const RETIRED = Object.freeze({
    // The Virtual OS, removed after 3.0.0: its projects, its wallpaper, and
    // which project was open.
    databases: Object.freeze(['hashui_void_studio_v1', 'hashui_wallpaper_v1']),
    keys: Object.freeze(['hashui_void_studio_meta_v1']),
  });

  /** Clear every retired store. Storage that cannot be reached is skipped. */
  function clear(win = window) {
    for (const key of RETIRED.keys) {
      try { win.localStorage?.removeItem(key); } catch {}
    }
    for (const name of RETIRED.databases) {
      try { win.indexedDB?.deleteDatabase(name); } catch {}
    }
  }

  window.HCRetiredStorage = { RETIRED, clear };
  clear();
})();
