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

// Token-usage log — record one measured record per model response to
// ~/.hashcortx/usage.jsonl so HashMeterAi can report HashCortx usage
// accurately. Best-effort and metadata-only (never message content); a
// logging failure must never disturb a chat.
HC.usageLog = {
  append: (record) =>
    HC.isTauri
      ? HC.invoke("usage_log_append", { record }).catch(() => {})
      : Promise.resolve(),
};

// Hash D Island ping — light up the notch "HashCortX finished" when a run
// completes, like the iPhone Dynamic Island (the same feed Claude Code's
// hook writes). Best-effort and metadata-only — a model label at most,
// never message content. No-op in the browser or if Hash D Island isn't there.
HC.notch = {
  finished: (subtitle) => {
    if (!HC.isTauri) return Promise.resolve();
    const record = {
      id: "hashcortx",
      icon: "checkmark.circle.fill",
      title: "HashCortX finished",
      endsAt: new Date(Date.now() + 45000).toISOString().replace(/\.\d+Z$/, "Z"),
    };
    const sub = (subtitle || "").toString().trim();
    if (sub) record.subtitle = sub.slice(0, 120);
    return HC.invoke("notch_activity_post", { record }).catch(() => {});
  },
};
