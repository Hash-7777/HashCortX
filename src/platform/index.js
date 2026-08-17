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

// HashNotch ping — light up the notch "HashCortX finished" when a run
// completes, like the iPhone Dynamic Island (the same feed Claude Code's
// hook writes). Best-effort and metadata-only — the title and nothing else,
// never message content. No-op in the browser or if HashNotch isn't there.
HC.notch = {
  finished: () => {
    if (!HC.isTauri) return Promise.resolve();
    // A notice, not a countdown: this has already happened, so the notch shows
    // it briefly and drops it rather than ticking a timer down beside the word
    // "finished". endsAt rides along only so the entry expires from the shared
    // file on its own.
    const seconds = 3;
    const record = {
      id: "hashcortx",
      icon: "checkmark.circle.fill",
      title: "HashCortX finished",
      dismissAfter: seconds,
      endsAt: new Date(Date.now() + seconds * 1000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z"),
    };
    // No subtitle. The notice used to carry the model that answered, which is
    // read at a glance and after the work is already over: nothing to act on,
    // and it crowds out the one word being looked for. It is also a detail
    // about the user's work leaving this app for a file any process can read,
    // for no benefit. The title is the whole message.
    return HC.invoke("notch_activity_post", { record }).catch(() => {});
  },
};
