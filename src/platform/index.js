// ==============================================================
// platform/index.js — Runtime environment detection
//
// Use this anywhere you need to branch between Tauri (desktop)
// and a plain browser (dev/test). Never import Tauri APIs directly
// in core/ code — always go through platform/*.
// ==============================================================

window.HC = window.HC || {};

HC.isTauri = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
HC.isWeb   = !HC.isTauri;

HC.invoke  = HC.isTauri
  ? (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args)
  : () => Promise.reject(new Error("Tauri not available in browser mode"));
