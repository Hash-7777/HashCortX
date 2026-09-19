// ==============================================================
// How long a model actually takes to answer
//
// Every choice of model in the app was made from its name. The name says how
// big a model is, and bigger read as better, so a free 550-billion-parameter
// model outranked everything and was handed the most important roles — and
// then sat in a free queue for the whole time limit, twice, while the rest of
// the team waited. Nothing had ever measured whether a model answers in time.
//
// This remembers what each model has done on this machine: how long its
// answers took for how much text, and when it last ran out of time. Choosing a
// model then happens in groups, strongest first within each:
//
//   ready        answered, and not slowly — or never tried
//   likely slow  never tried, and a free model with 200B+ parameters: those
//                sit in shared queues, so it goes after the rest until it has
//                answered once
//   slow         its answers have been taking long enough to risk the limit
//   timed out    ran out of time on its last job; not asked first again until
//                it has answered something since, or a week has passed
//
// Strength still decides within a group, so a strong model that answers stays
// first. A model that answered after a timeout is back to ready at once.
//
// Pure apart from the storage it is handed. Loaded before js/model-routes.js
// and published as window.HCModelSpeed. Checked by scripts/checks/model-speed.mjs.
// ==============================================================

(function () {
  'use strict';

  const KEY = 'hc_model_speed_v1';
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_MODELS = 300;
  // How long a typical long answer — a whole file or a report — may take before
  // a model counts as slow. Agents are given 90 to 240 seconds.
  const TYPICAL_CHARS = 8000;
  const SLOW_SECONDS = 120;
  const RANK = { ready: 0, 'likely-slow': 1, slow: 2, 'timed-out': 3 };

  const defaultStore = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  };

  function readAll(store) {
    try {
      const parsed = JSON.parse((store && store.getItem(KEY)) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function writeAll(all, store) {
    if (!store) return false;
    const names = Object.keys(all);
    if (names.length > MAX_MODELS) {
      const last = (m) => Math.max(all[m].at || 0, ...(all[m].timeouts || []));
      names.sort((a, b) => last(a) - last(b)).slice(0, names.length - MAX_MODELS).forEach((m) => delete all[m]);
    }
    try { store.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
  }

  /** An answer arrived: `ms` from asking, `chars` of text. */
  function record(model, { ms, chars } = {}, now = Date.now(), store = defaultStore()) {
    const secs = Number(ms) / 1000;
    const size = Math.max(0, Number(chars) || 0);
    if (!model || !(secs > 0) || !store) return false;
    const all = readAll(store);
    const was = all[model] || { n: 0 };
    // Seconds per thousand characters, averaged with the weight shifting to the
    // newest answers, so a provider that has got faster is believed quickly.
    const rate = secs / Math.max(1, size / 1000);
    const w = was.n ? 0.35 : 1;
    all[model] = {
      n: Math.min(1000, (was.n || 0) + 1),
      rate: was.n ? was.rate * (1 - w) + rate * w : rate,
      at: now,
      timeouts: (was.timeouts || []).filter((t) => now - t < WEEK_MS),
    };
    return writeAll(all, store);
  }

  /** The model ran out of time. */
  function recordTimeout(model, now = Date.now(), store = defaultStore()) {
    if (!model || !store) return false;
    const all = readAll(store);
    const was = all[model] || { n: 0, rate: 0, at: 0 };
    all[model] = { ...was, timeouts: [...(was.timeouts || []).filter((t) => now - t < WEEK_MS), now].slice(-5) };
    return writeAll(all, store);
  }

  /** The largest parameter count a model's name gives, in billions. */
  function billions(model) {
    const found = [...String(model || '').matchAll(/(\d+(?:\.\d+)?)\s*b\b/gi)].map((m) => Number(m[1]));
    return found.length ? Math.max(...found) : 0;
  }

  const isFree = (model) => /:free\b|\bfree\b/i.test(String(model || ''));

  /** Which group a model is in — see the table at the top. */
  function stateOf(model, now = Date.now(), store = defaultStore()) {
    const seen = readAll(store)[model];
    if (seen) {
      const lastTimeout = Math.max(0, ...(seen.timeouts || []).filter((t) => now - t < WEEK_MS));
      if (lastTimeout && !(seen.at > lastTimeout)) return 'timed-out';
      if (seen.n && seen.rate * (TYPICAL_CHARS / 1000) > SLOW_SECONDS) return 'slow';
      if (seen.n) return 'ready';
    }
    return isFree(model) && billions(model) >= 200 ? 'likely-slow' : 'ready';
  }

  /** What a trace should say about a model that was passed over. */
  function reasonOf(state) {
    return {
      'timed-out': 'it ran out of time on its last job',
      slow: 'its answers have been taking too long',
      'likely-slow': 'free models this large usually wait in a queue',
    }[state] || '';
  }

  /** A list ordered by group, then by `scoreOf` highest first. Stable within ties. */
  function order(list, valueOf, scoreOf, now, store) {
    const at = now || Date.now();
    const all = readAll(store || defaultStore());
    // Read once and answered from, so ordering a long list does not parse
    // storage for every model in it.
    const kept = { getItem: () => JSON.stringify(all) };
    const memo = { get: (v) => stateOf(v, at, kept) };
    return (Array.isArray(list) ? list : [])
      .map((item, i) => ({ item, i, g: RANK[memo.get(valueOf(item))], s: Number(scoreOf(item)) || 0 }))
      .sort((a, b) => a.g - b.g || b.s - a.s || a.i - b.i)
      .map((x) => x.item);
  }

  /** Forget everything measured. */
  function forget(store = defaultStore()) {
    try { store && store.removeItem(KEY); } catch { /* nothing to undo */ }
  }

  window.HCModelSpeed = { KEY, record, recordTimeout, stateOf, reasonOf, order, billions, forget, RANK, SLOW_SECONDS, TYPICAL_CHARS };
})();
