// ==============================================================
// Asking a model what the thing is, before asking it to build the thing
//
// The reading itself — what a brief may contain, what is checked, and what is
// worked out from the words when no model answers — is in js/forge/subject.js,
// which is pure. This file is the call, and it is kept apart for the same
// reason the Agent Swarm keeps js/swarm/ask.js apart from its deliverables:
// one file can be checked by reading it, the other needs a model.
//
// NEVER FATAL. The Forge used to make four calls per run and was cut back to
// one on purpose, because every extra call is another chance to meet a free
// tier's limit and end a run with nothing on screen. This adds a second call,
// so it is built to be given up on: a short deadline, at most three models,
// and on every failure the run carries on with what the request's own words
// settle. A person waiting for a model never waits longer than half a minute
// for this, and never loses a run to it.
//
// Loaded before the Forge mode and published as window.HCForgeAskSubject.
// Checked by scripts/checks/forge-subject.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How long one model is given to say what the object is. */
  const DEADLINE_MS = 30000;
  /** How many models are asked before the run falls back to the words. */
  const TRIES = 3;

  /**
   * The brief a run works from. Always returns one — from a model when one
   * answered, from the request's own words when none did.
   *
   * deps: call(model, messages, signal) -> text, models() -> [{value,label}],
   * chosen() -> model, label(model) -> text, strength(option) -> number,
   * trace(message, kind).
   */
  async function ask(prompt, signal, deps) {
    const S = window.HCForgeSubject;
    const ROUTES = window.HCModelRoutes;
    const options = deps.models;
    if (!S) return null;
    if (!ROUTES || typeof deps.call !== 'function' || !options().length) return S.merge(null, prompt);
    const routes = ROUTES.createRun({
      options,
      strength: deps.strength,
      label: deps.label,
      note: (m) => deps.trace(m, 'warn'),
    });
    let model = routes.start(deps.chosen() || options()[0].value);
    let answered = null;
    let from = '';
    for (let i = 0; model && i < TRIES && answered === null; i++) {
      if (signal && signal.aborted) break;
      try {
        const text = await ROUTES.callWithin(DEADLINE_MS, signal, `no answer within ${DEADLINE_MS / 1000} s`, (s) => deps.call(model, S.messages(prompt), s));
        answered = S.readBrief(text);
        if (answered === null) throw new Error('its answer could not be read');
        from = deps.label(model);
      } catch (err) {
        if (err.name === 'AbortError' || (signal && signal.aborted)) break;
        deps.trace(`${deps.label(model)} could not say what this is · ${String(err.message || err).slice(0, 100)}`, 'warn');
        model = routes.next(model, err);
      }
    }
    const brief = S.merge(answered, prompt);
    deps.trace(
      brief.from === 'model'
        ? `${from} worked out what this is · ${S.summaryOf(brief)}`
        : `Read what this is from the request · ${S.summaryOf(brief)}`,
      brief.from === 'model' ? 'ok' : 'warn',
    );
    return brief;
  }

  window.HCForgeAskSubject = { ask, DEADLINE_MS, TRIES };
})();
