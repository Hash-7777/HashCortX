// ==============================================================
// Waiting for a model to start
//
// OpenRouter's free models share one queue. Measured on the Nemotron family,
// a request could sit in it for up to three minutes before the first word of
// the model's thinking arrived, and then be answered in seconds. From the chat
// that is a bubble doing nothing for minutes, while another model would have
// answered in the time it took to notice.
//
// So a model held to this rule has FIRST_SIGN_MS to show any sign of work — a
// word of its answer or of its thinking. If it shows none, its request is
// stopped and the failure says why, which the chat's failover reads as "slow"
// and moves on. Once a model has started it is never cut off by this.
//
// Only the free OpenRouter models are held to it. Some paid reasoning models
// think in silence, streaming nothing until the answer; for them silence is
// work, and cutting it short would lose an answer that was coming.
//
// Loaded before app.js and published as window.HCFirstSign.
// Checked by scripts/checks/stream-sse.mjs.
// ==============================================================

(function () {
  'use strict';

  const FIRST_SIGN_MS = 45000;

  /** Whether a model is one that waits in a shared queue before starting. */
  const waitsInQueue = (provider, modelId) => provider === 'openrouter' && /:free$/i.test(String(modelId || ''));

  /**
   * A signal for one request that ends when `outer` ends, or when a model held
   * to the rule shows no sign of work in time. Call `sign()` on every word,
   * `release()` when done, and `stalled()` to ask whether the rule stopped it —
   * never true when the person stopped it themselves.
   */
  function watch(provider, modelId, outer, ms = FIRST_SIGN_MS) {
    const own = new AbortController();
    const onOuter = () => own.abort();
    if (outer && outer.aborted) own.abort();
    else if (outer) outer.addEventListener('abort', onOuter, { once: true });
    let stopped = false;
    let timer = waitsInQueue(provider, modelId) ? setTimeout(() => { stopped = true; own.abort(); }, ms) : null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    return {
      signal: own.signal,
      sign: clear,
      stalled: () => stopped && !(outer && outer.aborted),
      stallError: (label) => Object.assign(new Error(`${label} did not start answering within ${Math.round(ms / 1000)} s`), { timedOut: true }),
      release() { clear(); if (outer) outer.removeEventListener('abort', onOuter); },
    };
  }

  window.HCFirstSign = { FIRST_SIGN_MS, waitsInQueue, watch };
})();
