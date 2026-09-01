// ==============================================================
// What the providers said last time
//
// The model list a person picks from should be the provider's, not ours. Every
// provider here is asked for its own list at launch, and that has been true for
// a while — but the answer was kept in memory only, so every launch started
// from the hand-written catalogue in src/data/cloud-models.js and swapped to
// the real thing a moment later. If the fetch failed, or there was no network,
// or a provider was having a bad morning, the hand-written list was all anyone
// ever saw for that session.
//
// That list cannot keep up. Providers retire models continuously, and most of
// the OpenRouter entries written into it name models that no longer exist. A
// person choosing one of those gets a failed run and no explanation, because
// nothing in the app knows the name is dead.
//
// So a successful answer is remembered here, and the next launch starts from
// what the provider actually said. The hand-written catalogue falls back to
// what it should always have been: something to show on a first run, before
// anyone has ever reached a provider.
//
// Deliberately NOT keyed by the API key. The key already lives in this same
// storage and there is no reason to write anything derived from it as well. A
// changed key re-fetches on its own change event and overwrites this within a
// moment; the worst case is a single paint of the previous account's list.
//
// Storage is passed in rather than reached for, so the checks exercise the
// real logic instead of a try/catch swallowing a missing global and reporting
// that everything is fine.
//
// Loaded before app.js and published as window.HCCloudModelMemory.
// Checked by scripts/checks/cloud-model-memory.mjs.
// ==============================================================

(function () {
  'use strict';

  const KEY = 'hc_cloud_models_v1';

  // A guard, not a budget. Ten providers of real lists come to a few tens of
  // kilobytes; anything approaching this means a provider has started
  // returning something unbounded, and filling localStorage is not a small
  // failure when the API keys live in it too.
  const MAX_BYTES = 512 * 1024;

  const defaultStore = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  };

  function readAll(store) {
    if (!store) return {};
    try {
      const raw = store.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * A model record, reduced to the fields the dropdown actually uses.
   *
   * Anything without a `cloud:` value cannot become an option, so it is
   * dropped rather than stored — one malformed record must not cost the list.
   */
  function clean(models) {
    if (!Array.isArray(models)) return [];
    return models
      .filter((m) => m && typeof m.value === 'string' && m.value.startsWith('cloud:'))
      .map((m) => ({
        value: m.value,
        label: typeof m.label === 'string' ? m.label : m.value,
        shortLabel: typeof m.shortLabel === 'string' ? m.shortLabel : undefined,
        ...(m.imageGen ? { imageGen: true } : {}),
      }));
  }

  /** The last list this provider actually returned, or null. */
  function recall(provider, store = defaultStore()) {
    const entry = readAll(store)[provider];
    if (!entry) return null;
    const models = clean(entry.models);
    return models.length ? models : null;
  }

  /** Remember what a provider just returned. A empty answer is not an answer. */
  function remember(provider, models, store = defaultStore()) {
    if (!store || !provider) return false;
    const cleaned = clean(models);
    if (!cleaned.length) return false;
    try {
      const all = readAll(store);
      all[provider] = { at: Date.now(), models: cleaned };
      const serialised = JSON.stringify(all);
      if (serialised.length > MAX_BYTES) return false;
      store.setItem(KEY, serialised);
      return true;
    } catch {
      // Storage full or unavailable. The live fetch still filled the list for
      // this session; the next launch simply falls back the way it used to.
      return false;
    }
  }

  /**
   * What a provider's list starts as, best answer first.
   *
   * This is the one place that decides, so there is one answer rather than
   * fourteen scattered `|| FALLBACK` expressions that can drift apart.
   */
  function seed(provider, fallback, store = defaultStore()) {
    return recall(provider, store) || (Array.isArray(fallback) ? fallback.slice() : []);
  }

  /** Drop everything remembered. Used when a person clears their settings. */
  function forget(store = defaultStore()) {
    try { store && store.removeItem(KEY); } catch { /* nothing to undo */ }
  }

  window.HCCloudModelMemory = { KEY, MAX_BYTES, recall, remember, seed, forget };
})();
