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
//   limit     out of quota. When the WHOLE ACCOUNT is — no credit, a
//             payment refusal, a daily allowance every free model on it
//             shares — other providers only. When it is one model's quota,
//             as Gemini and Groq count most of theirs, other providers first,
//             then this one's other models: one spent model says nothing
//             about the next, which is often answering
//   key       the key is refused: other providers only
//   busy      the provider is overloaded or unreachable: other providers,
//             then this one
//   slow      no answer in time: other providers, then this one
//   size      the request is larger than this model will take on this
//             account: other providers first, then this one's others, each
//             only if it can hold the job — never the same request again. A
//             provider that refused it on one model often has the same
//             per-minute budget on the next
//
// What a run learns is shared for a few minutes with every run: a model out of
// its quota, an account out of credit. Six agents in one team used to find the
// same empty account six times, each spending attempts on it; the second now
// starts where the first left off. Nothing is shut for good by this — when
// leaving the cooling ones out would leave nothing, they are tried anyway.
//   empty     an answer with nothing in it: other providers, then this one
//   other     anything else: this provider's others, then the rest
//
// A local model hands over only to another local model, whatever the kind.
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
  // 402 is here on purpose: an account out of credit is spent in the way that
  // matters — the same model will refuse again, and another provider is the
  // answer — even though nothing about it is a rate limit. It used to be caught
  // only by the word "billing" happening to appear in one provider's answer,
  // which is luck rather than a rule.
  const LIMIT = /rate.?limit|quota|\b429\b|\b402\b|too many requests|free.?tier|insufficient.{0,12}(?:credit|balance|fund)|no credit left|out of credit|billing|exceeded|tokens per (?:minute|day)/i;
  // Checked before a limit, because a request too large for a per-minute budget
  // names the budget. Waiting does not shrink a request, and another model on
  // the same account may take it, so it is not a spent quota either.
  const SIZE = /request too large|payload too large|\b413\b|context.{0,12}(?:length|window).{0,30}(?:exceed|too long|maximum)|maximum context length|prompt is too long|too many (?:input )?tokens/i;
  // An unreachable provider is treated as a busy one: try elsewhere, then it again.
  const BUSY = /capacity|overload|unavailable|\b50[234]\b|\b529\b|server error|try again later|temporar|failed to fetch|load failed|network|econn|socket|unreachable/i;
  const SLOW = /timed?.?out|timeout|aborted|abort|no answer within|took longer/i;
  // Models that answer with pictures, by the names their providers give them.
  const PICTURE_MODEL = /[-/]image(?:[-:]|$)|image-preview|imagen|dall-e|flux|stable-diffusion|nano-banana/i;
  // A limit that covers the whole account, read from the status and from the
  // provider's own words, which the app's message leaves out.
  const ACCOUNT_WIDE = /no credit left|out of credit|insufficient.{0,12}(?:credit|balance|fund)|payment (?:method )?(?:is )?required|free-models-per-day|never purchased credits/i;

  /** Whether a limit covers the whole account rather than one model. */
  function coversAccount(err) {
    if (!err) return false;
    if (Number(err.status) === 402) return true;
    return ACCOUNT_WIDE.test(`${err.message || ''} ${typeof err.body === 'string' ? err.body : ''}`);
  }

  // What recent runs learnt, shared for a while: 'p:provider' for an account,
  // 'm:value' for one model. Kept in memory — a restart asks again.
  const COOL_ACCOUNT_MS = 30 * 60 * 1000;
  const COOL_MODEL_MS = 5 * 60 * 1000;
  const cooling = new Map();
  function coolDown(key, ms, now = Date.now()) { cooling.set(key, Math.max(cooling.get(key) || 0, now + ms)); }
  function coolingNow(prefix, now = Date.now()) {
    const out = [];
    for (const [k, until] of cooling) { if (until <= now) cooling.delete(k); else if (k.startsWith(prefix)) out.push(k.slice(prefix.length)); }
    return out;
  }
  /** Forget what recent runs learnt — for the checks, and for a person who has just added credit. */
  function forgetCooling() { cooling.clear(); }

  /** What kind of failure an error is — see the table at the top. */
  function failureKind(err) {
    if (err && err.name === 'AbortError' && !err.timedOut) return 'stopped';
    const msg = String((err && err.message) || err || '');
    if (RETIRED.test(msg)) return 'retired';
    if (err && err.empty) return 'empty';
    if (SIZE.test(msg)) return 'size';
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

  /** Every model reported gone within the last two weeks. */
  function listRetired(now = Date.now(), store = defaultStore()) {
    return Object.entries(readRetired(store)).filter(([, until]) => typeof until === 'number' && until > now).map(([value]) => value);
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
   * has already found out of quota or refusing the key — or one `fits` says
   * cannot hold the job (js/model-limits.js). `strength` may be passed to rank
   * by a mode's own judgement instead of the shared one.
   */
  function nextRoutes({ failed, kind = 'other', wide = true, options = [], tried = [], avoid = [], strength, fits, now = Date.now(), store = defaultStore() } = {}) {
    const score = strength || ((o) => rankOf(o.value, o.label));
    const skip = new Set([failed, ...tried].filter(Boolean));
    const shut = new Set(avoid);
    const shutsAccount = kind === 'key' || (kind === 'limit' && wide);
    if (shutsAccount) shut.add(providerOf(failed));
    // A model that makes pictures is never the fallback for one that writes.
    const pictures = (v) => PICTURE_MODEL.test(String(v || ''));
    const usable = (options || []).filter((o) => o && o.value && !skip.has(o.value) && !shut.has(providerOf(o.value)) && !isRetired(o.value, now, store) && (!fits || fits(o.value)) && (pictures(failed) || !pictures(o.value)));
    // Models that answer in time first, strongest first within that — a model
    // that ran out of time, or a free giant never yet heard from, goes after
    // the rest however large it is (js/model-speed.js).
    const S = typeof window !== 'undefined' && window.HCModelSpeed;
    const group = (o) => (S ? S.RANK[S.stateOf(o.value, now, store)] : 0);
    const byStrength = (a, b) => group(a) - group(b) || score(b) - score(a);
    const from = providerOf(failed);
    const same = usable.filter((o) => providerOf(o.value) === from).sort(byStrength);
    // Each other provider's best model, the strongest provider first. One per
    // provider: when an account is out of quota, its second model is too.
    const bestOf = new Map();
    for (const o of usable) {
      const p = providerOf(o.value);
      if (p === from) continue;
      if (!bestOf.has(p) || byStrength(o, bestOf.get(p)) < 0) bestOf.set(p, o);
    }
    // A job given to a local model stays local. Choosing one is often the
    // point — the task and its files are not to go to a cloud provider — so
    // only another local model may take it over, and with none left the run
    // ends with the local model's own error.
    const others = from === 'local' ? [] : [...bestOf.values()].sort(byStrength);
    const values = (list) => list.map((o) => o.value);
    if (kind === 'stopped') return [];
    if (shutsAccount) return values(others);  // `same` is empty: the provider is shut
    if (kind === 'busy' || kind === 'slow' || kind === 'empty' || kind === 'limit' || kind === 'size') return values([...others, ...same]);
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
   *   fits(v)    whether a model can hold this job — the question and an answer
   *              long enough — as js/model-limits.js knows it; a model that
   *              cannot is not asked while one that can is left
   *   note(msg)  where to say that a model is gone
   *   label(v)   how a model is named in that message
   */
  function createRun(opts = {}) {
    const options = opts.options || (() => []);
    const shut = opts.shut || (() => []);
    const note = opts.note || (() => {});
    const label = opts.label || ((v) => v);
    const { strength, fits } = opts;
    const store = opts.store || defaultStore();
    const tried = [];
    const avoid = [];
    return {
      tried,
      /** The chosen model, unless its provider has said it is gone. */
      start(value) {
        if (!value) return value;
        const gone = isRetired(value, Date.now(), store);
        // A model that ran out of time on its last job is not asked first again
        // while another can be — js/model-speed.js.
        const S = typeof window !== 'undefined' && window.HCModelSpeed;
        if (!gone && S && S.stateOf(value, Date.now(), store) === 'timed-out') {
          const quicker = nextRoutes({ failed: value, kind: 'slow', options: options(), strength, fits, store })
            .find((v) => S.stateOf(v, Date.now(), store) !== 'timed-out');
          if (quicker) { note(`${label(value)} ran out of time on its last job — using ${label(quicker)}`); return quicker; }
        }
        // An account or a model another run has just found spent is not asked
        // first, while something else can be.
        const cold = !gone && (coolingNow('p:').includes(providerOf(value)) || coolingNow('m:').includes(value));
        if (cold) {
          const warm = nextRoutes({ failed: value, kind: 'limit', wide: coolingNow('p:').includes(providerOf(value)), options: options(), tried: coolingNow('m:'), avoid: coolingNow('p:'), strength, fits, store })[0];
          if (warm) { note(`${label(value)} was just found out of quota — using ${label(warm)}`); return warm; }
        }
        if (!gone && (!fits || fits(value))) return value;
        const next = nextRoutes({ failed: value, kind: gone ? 'retired' : 'other', options: options(), strength, fits, store })[0];
        if (next) note(gone ? `${label(value)} was reported gone — using ${label(next)}` : `${label(value)} cannot hold this job on this account — using ${label(next)}`);
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
        const wide = kind === 'key' || (kind === 'limit' && coversAccount(err));
        if (wide) { avoid.push(providerOf(culprit)); coolDown(`p:${providerOf(culprit)}`, COOL_ACCOUNT_MS); }
        else if (kind === 'limit') coolDown(`m:${culprit}`, COOL_MODEL_MS);
        if (kind === 'slow' && typeof window !== 'undefined' && window.HCModelSpeed) window.HCModelSpeed.recordTimeout(culprit, Date.now(), store);
        for (const m of [failed, culprit]) if (m && !tried.includes(m)) tried.push(m);
        const ask = (extra, fit, cold = []) => nextRoutes({ failed: culprit, kind, wide, options: options(), tried: [...tried, ...cold], avoid: [...avoid, ...extra], strength, fits: fit, store })[0];
        // What is known to answer and can hold the job first; failing that,
        // anything that answers, the cooling ones included.
        const coldP = coolingNow('p:');
        const coldM = coolingNow('m:');
        return ask([...shut(), ...coldP], fits, coldM) || ask(coldP, fits, coldM) || ask(shut(), fits) || ask([], fits) || ask(shut()) || ask([]) || null;
      },
    };
  }

  /**
   * An abort that fires when nothing has arrived for too long, for a model
   * whose answer is streamed: `first` to begin, then `between` pieces — call
   * `tick` on each. A model still writing is never cut off, however long its
   * answer; one that has stalled is not waited on. A fixed limit did both
   * wrong: it cut slow models off mid-answer, and a longer one only waited
   * longer on a model that had stopped.
   */
  // The browser's timers must be called as themselves: taken off `window` and
  // called as a method of another object, they throw "Illegal invocation".
  const REAL_TIMERS = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

  function quietSignal(parentSignal, { first, between }, timers = REAL_TIMERS) {
    const ctrl = new AbortController();
    let timer = null;
    let cleaned = false;
    let heard = false;
    const abort = () => { if (!ctrl.signal.aborted) ctrl.abort(); };
    const arm = (ms) => { timers.clear(timer); timer = timers.set(abort, ms); };
    if (parentSignal && parentSignal.aborted) abort();
    else if (parentSignal && parentSignal.addEventListener) parentSignal.addEventListener('abort', abort, { once: true });
    arm(first);
    return {
      signal: ctrl.signal,
      tick: () => { heard = true; if (!cleaned) arm(between); },
      heard: () => heard,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        timers.clear(timer);
        if (parentSignal && parentSignal.removeEventListener) parentSignal.removeEventListener('abort', abort);
      },
    };
  }

  /**
   * One model call that is cancelled, not abandoned, when it runs out of time.
   *
   * Racing a call against a timer leaves the losing request running: it goes
   * on spending the account's quota and holding one of the app's places for
   * requests while the next model is already being asked, which is how one
   * slow model turns into rate limits for the rest of a run. Here the call is
   * handed a signal that is aborted when time is up, and the failure it gives
   * is a timeout. A stop the person makes still arrives as that stop.
   */
  async function callWithin(ms, parentSignal, message, call, timers = REAL_TIMERS) {
    const attempt = new AbortController();
    const stop = () => { if (!attempt.signal.aborted) attempt.abort(); };
    if (parentSignal && parentSignal.aborted) stop();
    else if (parentSignal && parentSignal.addEventListener) parentSignal.addEventListener('abort', stop, { once: true });
    let timedOut = false;
    const timer = timers.set(() => { timedOut = true; stop(); }, ms);
    try {
      return await call(attempt.signal);
    } catch (err) {
      if (timedOut && !(parentSignal && parentSignal.aborted)) {
        throw Object.assign(new Error(message || `no answer within ${Math.round(ms / 1000)} s`), { timedOut: true });
      }
      throw err;
    } finally {
      timers.clear(timer);
      if (parentSignal && parentSignal.removeEventListener) parentSignal.removeEventListener('abort', stop);
    }
  }

  /**
   * Why a model was given up on, in words.
   *
   * `err` is the failure itself, and it matters for the one kind that has no
   * words of its own. A failure this file cannot name still arrives carrying a
   * perfectly good sentence from the provider, and the fallback used to throw
   * that away and say "it failed" — which is a line somebody read in a trace
   * after two minutes of waiting, and which says less than nothing.
   */
  function reasonText(kind, err) {
    const known = {
      retired: 'the provider says this model is gone',
      limit: 'this account is out of quota',
      key: 'the key was refused',
      busy: 'the provider is overloaded',
      slow: 'no answer in time',
      size: 'the request is too large for this model on this account',
      empty: 'the answer was empty',
    }[kind];
    if (known) return known;
    const said = String((err && err.message) || err || '').replace(/\s+/g, ' ').trim();
    return said ? said.slice(0, 160) : 'it failed, and said nothing about why';
  }

  /**
   * One question, answered by whichever model can: `start` first, then the
   * models this run's routing picks, for the same reasons a run moves on.
   *
   *   call(model, signal)  the question, answered as text
   *   options()            what a person can run, as { value, label }
   *   onSwitch(from, to, why)  said each time it moves on
   *
   * An empty answer counts as no answer. A failure that is the question's own
   * fault, not the model's, is not passed round every model — it is thrown.
   * Resolves { text, model, switched } so the caller can say who answered.
   */
  async function askWithFailover({ start, options, call, signal, timeoutMs = 90000, maxAttempts = 4, strength, onSwitch, store = defaultStore(), timers = REAL_TIMERS } = {}) {
    const run = createRun({ options, strength, store });
    let model = run.start(start);
    const switched = [];
    for (let attempt = 1; ; attempt++) {
      try {
        const text = String((await callWithin(timeoutMs, signal, `no answer within ${Math.round(timeoutMs / 1000)} s`, (s) => call(model, s), timers)) || '');
        if (!text.trim()) throw Object.assign(new Error('the answer was empty'), { empty: true });
        return { text, model, switched };
      } catch (err) {
        const kind = failureKind(err);
        if (kind === 'stopped' || (signal && signal.aborted) || kind === 'other' || kind === 'size' || attempt >= maxAttempts) throw err;
        const next = run.next(model, err);
        if (!next) throw err;
        const why = reasonText(kind, err);
        switched.push({ from: model, to: next, why });
        if (onSwitch) onSwitch(model, next, why);
        model = next;
      }
    }
  }

  window.HCModelRoutes = { coversAccount, forgetCooling, failureKind, providerOf, markRetired, isRetired, listRetired, forgetRetired, nextRoutes, createRun, quietSignal, callWithin, askWithFailover, reasonText, RETIRED_KEY, RETIRED_FOR_MS };
})();
