// ==============================================================
// Where a run goes when a model will not answer
//
// The Agent Swarm, the Systems builder and the Forge each had their own
// failover, and all three made the same two mistakes:
//
//  - A model the provider had RETIRED was treated like a busy provider. The
//    run moved to one model on each OTHER provider and never tried the same
//    provider's other models, so one dead name on a working account took the
//    whole account out of the run. With a rate-limited second provider and a
//    slow third, three failures ended the run while the provider with the
//    dead model had others that would have answered.
//  - Nothing remembered that a model was gone. The next run, and every agent
//    in a team that named it, asked it again and failed the same way.
//
// This module reads what kind of failure an error is and orders what to try
// next by it:
//
//   retired   the model is gone: the same provider's other models first,
//             because the account works — then the other providers
//   limit     the account is out of quota: other providers only
//   key       the key is refused: other providers only
//   busy      the provider is overloaded or unreachable: other providers,
//             then this one
//   slow      no answer in time: other providers, then this one
//   other     anything else: this provider's others, then the rest
//
// A retired model is remembered for two weeks, so the next run skips it
// rather than rediscovering it. Retirement is permanent, but a "not found" can
// also be a key without access to a model, and two weeks lets that recover.
//
// Strength is read from the NAME by js/chat/failover.js, where that guess is
// written down and checked. Storage is passed in, so the checks exercise the
// real logic.
//
// Pure apart from the storage it is handed. Published as window.HCModelRoutes.
// Checked by scripts/checks/model-routes.mjs.
// ==============================================================

(function () {
  'use strict';

  const RETIRED_KEY = 'hc_retired_models_v1';
  const RETIRED_FOR_MS = 14 * 24 * 60 * 60 * 1000;

  const RETIRED = /decommission|deprecated|no longer (?:supported|available|exists|offered)|model\b.{0,40}\b(?:not (?:be )?found|does not exist|doesn'?t exist|not available|is not supported|was retired|renamed or retired|unavailable for your)|no such model|unknown model|model_not_found|model_decommissioned|invalid model|not a valid model|is not found for api version/i;
  const KEY = /api key|api-key|apikey|unauthori[sz]ed|forbidden|invalid.{0,12}key|missing.{0,12}key|rejected the api key|http 40[13]\b|permission denied/i;
  const LIMIT = /rate.?limit|quota|\b429\b|too many requests|free.?tier|insufficient.{0,12}(?:credit|balance|fund)|billing|exceeded|tokens per (?:minute|day)|request too large/i;
  // An unreachable provider is treated as a busy one: try elsewhere, then it again.
  const BUSY = /capacity|overload|unavailable|\b50[234]\b|\b529\b|server error|try again later|temporar|failed to fetch|load failed|network|econn|socket|unreachable/i;
  const SLOW = /timed?.?out|timeout|aborted|abort|no answer within|took longer/i;

  /** What kind of failure an error is — see the table at the top. */
  function failureKind(err) {
    if (err && err.name === 'AbortError' && !err.timedOut) return 'stopped';
    const msg = String((err && err.message) || err || '');
    if (RETIRED.test(msg)) return 'retired';
    // Before the key: a quota message often says whose key ran out.
    if (LIMIT.test(msg)) return 'limit';
    if (KEY.test(msg)) return 'key';
    if (BUSY.test(msg)) return 'busy';
    if (SLOW.test(msg) || (err && err.timedOut)) return 'slow';
    return 'other';
  }

  const providerOf = (value) => {
    const v = String(value || '');
    return v.startsWith('cloud:') ? v.split(':')[1] : 'local';
  };

  const defaultStore = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  };

  function readRetired(store) {
    try {
      const parsed = JSON.parse((store && store.getItem(RETIRED_KEY)) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  /** Remember that a provider said this model is gone. */
  function markRetired(value, now = Date.now(), store = defaultStore()) {
    if (!value || !store) return false;
    const all = readRetired(store);
    for (const [k, until] of Object.entries(all)) if (!(until > now)) delete all[k];
    all[value] = now + RETIRED_FOR_MS;
    try { store.setItem(RETIRED_KEY, JSON.stringify(all)); return true; } catch { return false; }
  }

  /** Whether a model was reported gone within the last two weeks. */
  function isRetired(value, now = Date.now(), store = defaultStore()) {
    const until = readRetired(store)[value];
    return typeof until === 'number' && until > now;
  }

  /** Forget every model marked gone. */
  function forgetRetired(store = defaultStore()) {
    try { store && store.removeItem(RETIRED_KEY); } catch { /* nothing to undo */ }
  }

  const rankOf = (value, label) => {
    const F = typeof window !== 'undefined' && window.HCChatFailover;
    return F ? Math.max(F.rankOf(value), F.rankOf(label)) : 0;
  };

  /**
   * The models to try after `failed` failed in the way `kind` says, best
   * first. `options` is what a person can run — `{ value, label }` — and
   * `tried` what this run has already asked. A retired model is never offered,
   * and neither is any model of a provider in `avoid` — the accounts this run
   * has already found out of quota or refusing the key. `strength` may be
   * passed to rank by a mode's own judgement instead of the shared one.
   */
  function nextRoutes({ failed, kind = 'other', options = [], tried = [], avoid = [], strength, now = Date.now(), store = defaultStore() } = {}) {
    const score = strength || ((o) => rankOf(o.value, o.label));
    const skip = new Set([failed, ...tried].filter(Boolean));
    const shut = new Set(avoid);
    if (kind === 'limit' || kind === 'key') shut.add(providerOf(failed));
    const usable = (options || []).filter((o) => o && o.value && !skip.has(o.value) && !shut.has(providerOf(o.value)) && !isRetired(o.value, now, store));
    const byStrength = (a, b) => score(b) - score(a);
    const from = providerOf(failed);
    const same = usable.filter((o) => providerOf(o.value) === from).sort(byStrength);
    // Each other provider's best model, the strongest provider first. One per
    // provider: when an account is out of quota, its second model is too.
    const bestOf = new Map();
    for (const o of usable) {
      const p = providerOf(o.value);
      if (p === from) continue;
      if (!bestOf.has(p) || score(o) > score(bestOf.get(p))) bestOf.set(p, o);
    }
    const others = [...bestOf.values()].sort(byStrength);
    const values = (list) => list.map((o) => o.value);
    if (kind === 'stopped') return [];
    if (kind === 'limit' || kind === 'key') return values(others);  // `same` is empty: the provider is shut
    if (kind === 'busy' || kind === 'slow') return values([...others, ...same]);
    return values([...same, ...others]);
  }

  /**
   * One run's routing: the models it has asked and the accounts it has found
   * shut, so each mode keeps one of these instead of its own copy of the rules.
   *
   *   options()  what a person can run now, read at every failure
   *   strength   a mode's own ranking, or the shared one
   *   shut()     providers to leave alone for the moment (a cooldown); ignored
   *              when leaving them out would leave nothing to ask
   *   note(msg)  where to say that a model is gone
   *   label(v)   how a model is named in that message
   */
  function createRun(opts = {}) {
    const options = opts.options || (() => []);
    const shut = opts.shut || (() => []);
    const note = opts.note || (() => {});
    const label = opts.label || ((v) => v);
    const { strength } = opts;
    const store = opts.store || defaultStore();
    const tried = [];
    const avoid = [];
    return {
      tried,
      /** The chosen model, unless its provider has said it is gone. */
      start(value) {
        if (!value || !isRetired(value, Date.now(), store)) return value;
        const next = nextRoutes({ failed: value, kind: 'retired', options: options(), strength, store })[0];
        if (next) note(`${label(value)} was reported gone — using ${label(next)}`);
        return next || value;
      },
      /**
       * The model to ask after `failed` failed with `err`, or null. The error
       * may name the model that actually said it (`err.model`) — a repair pass
       * run on another model — and that is the one blamed.
       */
      next(failed, err) {
        const kind = failureKind(err);
        const culprit = (err && err.model) || failed;
        if (kind === 'retired') {
          markRetired(culprit, Date.now(), store);
          note(`${label(culprit)} is gone — it will not be asked again for two weeks`);
        }
        if (kind === 'limit' || kind === 'key') avoid.push(providerOf(culprit));
        for (const m of [failed, culprit]) if (m && !tried.includes(m)) tried.push(m);
        const ask = (extra) => nextRoutes({ failed: culprit, kind, options: options(), tried, avoid: [...avoid, ...extra], strength, store })[0];
        return ask(shut()) || ask([]) || null;
      },
    };
  }

  /** A few words for a trace, saying why the run is moving on. */
  function reasonText(kind) {
    return {
      retired: 'the provider says this model is gone',
      limit: 'this account is out of quota',
      key: 'the key was refused',
      busy: 'the provider is overloaded',
      slow: 'no answer in time',
    }[kind] || 'it failed';
  }

  window.HCModelRoutes = { failureKind, providerOf, markRetired, isRetired, forgetRetired, nextRoutes, createRun, reasonText, RETIRED_KEY, RETIRED_FOR_MS };
})();
