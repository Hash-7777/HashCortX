// ==============================================================
// The model lists, as the providers give them
//
// What the model menu offers is what each provider says it has. This keeps
// those lists: it asks a provider when there is a key to ask with, keeps the
// answer for that key, waits a little after a failure before asking again,
// and records for each provider what happened the last time — how many
// models came back, or why none did — so Settings can say so instead of the
// menu quietly falling back to a list written by hand.
//
// A provider that refuses every request made from inside the app is offered
// no models at all. Its hand-written list used to fill the menu with models
// that failed the moment they were chosen.
//
// Each model a provider lists carries its limits — how much it reads, how
// much it can write — and they are handed to js/model-limits.js as the list
// arrives, so every request to that model is sized by them.
//
// The fetchers, storage and helpers are passed in, so the checks run the real
// logic against recorded answers. Published as window.HCCloudCatalogue.
// Checked by scripts/checks/cloud-catalogue.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * deps:
   *   fetchers   provider → async (key) => models
   *   memory     js/cloud-model-memory.js — what each provider said last time
   *   fallback   provider → the hand-written list, for a first run
   *   visible    models → the ones the app offers
   *   isBlocked  provider → whether it refuses requests from the app
   *   limits     js/model-limits.js, told each listed model's limits
   *   now        () => the time, in milliseconds
   */
  function create(deps) {
    const now = deps.now || (() => Date.now());
    const cache = {};
    const keyAt = {};
    const inflight = {};
    const reports = {};

    const record = (provider, entry) => { reports[provider] = { provider, at: now(), ...entry }; };
    const register = (models) => {
      if (!deps.limits) return;
      for (const m of models || []) deps.limits.remember(m.value, m);
    };

    /** What a provider's list starts as: what it last said, else the hand-written one — or nothing, if it is blocked. */
    function seed(provider) {
      if (deps.isBlocked(provider)) return [];
      const models = deps.memory.seed(provider, (deps.fallback && deps.fallback[provider]) || []);
      register(models);
      return models;
    }

    /**
     * A provider's list for this key. `force` asks again even when there is
     * an answer for this key, or a failure moments ago — Update model lists.
     */
    async function load(provider, apiKey, options = {}) {
      const key = String(apiKey || '').trim();
      if (deps.isBlocked(provider)) {
        record(provider, { state: 'blocked', count: 0 });
        return [];
      }
      // OpenRouter lists its models without a key; everyone else needs one.
      if (!key && provider !== 'openrouter') {
        record(provider, { state: 'no-key', count: 0 });
        return seed(provider);
      }
      if (!options.force && cache[provider] && keyAt[provider] === key) return cache[provider];
      if (inflight[provider]) return inflight[provider];
      if (!options.force && deps.memory.failedRecently(provider, key)) return seed(provider);
      const fetcher = deps.fetchers[provider];
      if (!fetcher) return seed(provider);
      const pending = (async () => {
        try {
          const raw = await fetcher(key);
          const models = deps.visible(raw || []);
          const note = raw && raw.note;
          if (models.length) {
            cache[provider] = models;
            keyAt[provider] = key;
            deps.memory.remember(provider, models);
            register(models);
            record(provider, { state: 'ok', count: models.length, note });
            return models;
          }
          deps.memory.noteFailure(provider, key);
          record(provider, { state: 'empty', count: 0, note });
          return seed(provider);
        } catch (err) {
          deps.memory.noteFailure(provider, key);
          record(provider, { state: 'error', count: 0, error: String((err && err.message) || err) });
          return seed(provider);
        } finally {
          inflight[provider] = null;
        }
      })();
      inflight[provider] = pending;
      return pending;
    }

    /** What happened the last time each provider was asked. */
    const report = () => Object.values(reports).map((r) => ({ ...r }));

    return { load, seed, report };
  }

  window.HCCloudCatalogue = { create };
})();
