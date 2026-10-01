// ============================================================
// local-speed.js — how fast a model writes on this computer
//
// A model on a computer without a graphics chip, or one too large for its
// memory, may write a few words a second. Every extra question asked of it
// costs what it costs to write the answer, so a step that is cheap on a fast
// machine can double the wait on a slow one.
//
// This remembers, for each model at each address, how many tokens a second
// its last answers were written at, from the counts Ollama sends with the end
// of a reply. The agent's turn uses it to leave out the step in which the
// model is asked whether a request needs a tool, when the request does not
// say, and the model is slow (js/chat/decide.js).
//
//   • A reply of fewer than twenty tokens says too little to count.
//   • Each reply moves the figure half way, so a model that is busy for one
//     answer is not slow for the next, and every answer given while it is
//     skipping the step still measures it.
//   • A model never heard from is not slow. Nothing changes until it has
//     written something here.
//   • What is kept goes in the page's own storage, a few numbers a model,
//     and never leaves it.
//
// Pure apart from the storage it is given. Published as window.HCLocalSpeed.
// Checked by scripts/checks/local-speed.mjs.
// ============================================================
(function () {
  "use strict";

  const KEY = "hc_local_speed_v1";
  /** Below this a model writes slowly enough that an extra question is a real wait. */
  const SLOW_TOKENS_PER_SECOND = 10;
  const MIN_TOKENS = 20;
  const WEIGHT = 0.5;
  const MAX_MODELS = 100;
  const STALE_MS = 30 * 24 * 60 * 60 * 1000;

  const defaultStore = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

  function readAll(store) {
    try {
      const parsed = JSON.parse((store && store.getItem(KEY)) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function writeAll(all, store) {
    if (!store) return false;
    const keys = Object.keys(all);
    if (keys.length > MAX_MODELS) {
      keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - MAX_MODELS).forEach((k) => delete all[k]);
    }
    try { store.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
  }

  /** A model on another local app, or in the cloud, is not one this measures. */
  const measured = (model) => !!model && !/^(?:cloud|local):/.test(String(model));
  const keyOf = (host, model) => `${host}|${model}`;

  /**
   * Take in what Ollama counted for one reply: `stats` is the event that
   * ends it, with `eval_count` tokens written in `eval_duration` nanoseconds.
   * Returns the figure now kept, or null when the reply said too little.
   */
  function record(host, model, stats, { store = defaultStore(), now = Date.now() } = {}) {
    if (!measured(model) || !stats) return null;
    const count = Number(stats.eval_count);
    const nanoseconds = Number(stats.eval_duration);
    if (!Number.isFinite(count) || !Number.isFinite(nanoseconds) || count < MIN_TOKENS || nanoseconds <= 0) return null;
    const tps = count / (nanoseconds / 1e9);
    if (!Number.isFinite(tps) || tps <= 0) return null;
    const all = readAll(store);
    const key = keyOf(host, model);
    const before = all[key] && Number.isFinite(all[key].tps) && now - (all[key].at || 0) < STALE_MS ? all[key].tps : null;
    const next = before == null ? tps : before + (tps - before) * WEIGHT;
    all[key] = { tps: Math.round(next * 10) / 10, at: now };
    writeAll(all, store);
    return all[key].tps;
  }

  /** Tokens a second, as last measured here, or null when there is no recent figure. */
  function tokensPerSecond(host, model, { store = defaultStore(), now = Date.now() } = {}) {
    if (!measured(model)) return null;
    const entry = readAll(store)[keyOf(host, model)];
    return entry && Number.isFinite(entry.tps) && now - (entry.at || 0) < STALE_MS ? entry.tps : null;
  }

  /** Whether this model is known to write slowly here. A model not measured yet is not slow. */
  function isSlow(host, model, opts) {
    const tps = tokensPerSecond(host, model, opts);
    return tps != null && tps < SLOW_TOKENS_PER_SECOND;
  }

  window.HCLocalSpeed = { KEY, SLOW_TOKENS_PER_SECOND, MIN_TOKENS, record, tokensPerSecond, isSlow };
})();
