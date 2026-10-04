// ==============================================================
// Where a HashCoder run goes when its model will not answer
//
// The Coder had a router of its own: a list of every provider the person had a
// key for, tried one after another, and at the end the LAST failure thrown. So
// a person who chose Gemini and was out of its quota was told what Cerebras
// said about its own empty account, or OpenRouter's limit for a model they had
// never picked; a retired model was asked again at every run; and a model
// that cannot read pictures was tried with a picture attached.
//
// It now uses the routing the chat's agents use (js/model-routes.js, which
// knows a retired model from a spent quota, one model's quota from a whole
// account's, and what other runs have just found), with four things of its
// own:
//
//   • The model the person chose is asked first, and the run stays on
//     whichever one takes over, as the chat's does.
//   • Every move is said: which model failed, why, and which took over.
//   • A model that cannot read pictures is not offered while a picture is
//     being sent.
//   • When no model can answer, the message leads with the one the person
//     chose, in its own words, and then lists what was tried after it.
//
// A job stays on its side, as everywhere else: one on a model on this computer
// stays on this computer, and one on a cloud model never moves to a local one.
//
// The pieces it uses are passed in, so the checks run the real rules against
// scripted models. Published as window.HCCodeRouter. Checked by
// scripts/checks/code-router.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Whether any message in the conversation carries a picture. */
  function hasPictures(messages) {
    return (Array.isArray(messages) ? messages : []).some((m) => m && Array.isArray(m.images) && m.images.length > 0);
  }

  /**
   * The models a run may move to: those that make words, and while a picture
   * is being sent, those that read one. `readsImages(value)` says which.
   */
  function optionsFor(models, { pictures = false, readsImages = () => true } = {}) {
    return (Array.isArray(models) ? models : []).filter((m) => m && m.value && !m.imageGen && (!pictures || readsImages(m.value)));
  }

  const tidy = (text, max) => String(text == null ? '' : text).replace(/^Error:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, max);

  /** Names as a sentence lists them: "A", "A and B", "A, B and C"; past four, the first three and how many more. */
  function listed(names) {
    const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
    return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] || '');
  }

  /**
   * What to tell the person when no model could answer. `hops` are the
   * failures in the order they happened, `{ model, error }`, the model the
   * person chose first. The first is quoted as it said it; the rest are
   * gathered by the reason each gave, in a few words. What to do next
   * follows from the first: a passing trouble at the provider (overloaded,
   * a server error, no answer in time) is worth trying again in a moment.
   * Nothing here leads with the last.
   */
  function explain({ hops, label, kindOf, reasonOf }) {
    if (!Array.isArray(hops) || hops.length < 2) return null;
    const first = hops[0];
    const passing = ['busy', 'slow'].includes(kindOf(first.error));
    let said = tidy(first.error && first.error.message, 320);
    if (passing) said = said.replace(/[.\s]*\btry again\b[^.]*\.?$/i, '');
    const why = new Map();
    for (const h of hops.slice(1)) {
      const reason = tidy(reasonOf(kindOf(h.error), h.error), 90);
      if (!why.has(reason)) why.set(reason, []);
      why.get(reason).push(label(h.model));
    }
    const rest = [...why].map(([reason, names]) => `${listed(names)} (${reason})`);
    return `${label(first.model)} did not answer${said ? `: ${said.replace(/[.!?]+$/, '')}.` : '.'} ` +
      `No other model you have set up could take over: ${rest.join('; ')}. ` +
      (passing ? 'That is usually brief at the provider: try again in a moment, or pick another model.' : 'Pick another model, or put right the account named first.');
  }

  /**
   * Said under an error that ended a run after it had changed files: what it
   * made is still there, and the run can be carried on. '' when it changed
   * nothing. `names` are the files, by name.
   */
  function keptNote(names) {
    const files = [...new Set((Array.isArray(names) ? names : []).filter(Boolean))];
    return files.length ? `What it changed before this is kept: ${listed(files)}. Send a message to carry on from there.` : '';
  }

  /**
   * One run's routing.
   *
   *   selected      the model the person chose
   *   send(request) one model turn (the app's runModelTurn); a request that
   *                 carries `reset` has it called before each try
   *   adapterOf(v)  the client a model needs
   *   available()   the models a person can run, `{ value, label, imageGen }`
   *   readsImages(value)
   *   failover      js/chat/failover.js     routes   js/model-routes.js
   *   say(text)     where a move, or a model found gone, is said
   *   wait(ms)      for the one retry of a failure that is only a hiccup
   *
   * Returns { turn(request), model }.
   */
  function create({ selected, send, adapterOf, available, readsImages, failover, routes, say = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    const label = (value) => {
      const hit = (available() || []).find((o) => o && o.value === value);
      return (hit && hit.label) || String(value || '').replace(/^cloud:[^:]*:/, '');
    };
    const hops = [];
    const now = { pictures: false };
    const cloud = String(selected || '').startsWith('cloud:');
    const run = cloud
      ? routes.createRun({
        options: () => optionsFor(available(), { pictures: now.pictures, readsImages }),
        label, note: (text) => say(text),
        strength: (o) => failover.strengthOf(o.value, o.label),
      })
      : null;
    const stopped = (request, err) => (request.signal && request.signal.aborted) || (err && err.name === 'AbortError');

    const guarded = async (request) => {
      if (typeof request.reset === 'function') request.reset();
      try {
        return await send(request);
      } catch (first) {
        let err = first;
        // A hiccup (a dropped connection, a server error) is asked again once
        // on the same model before anything else is tried.
        if (!stopped(request, err) && failover.classifyError(err) === 'transient') {
          await wait(900);
          if (typeof request.reset === 'function') request.reset();
          try { return await send(request); } catch (again) { err = again; }
        }
        if (!stopped(request, err)) hops.push({ model: request.modelValue, error: err });
        throw err;
      }
    };

    const turns = failover.agentTurns({
      start: run ? run.start(selected) : selected,
      send: guarded, adapterOf, routes: run,
      failureKind: routes.failureKind, reasonText: routes.reasonText,
      onSwitch: (from, to, why) => say(`${label(from)}: ${why}. Carrying on with ${label(to)}`, { from, to, why }),
    });

    return {
      get model() { return turns.model; },
      label,
      async turn(request) {
        now.pictures = hasPictures(request && request.messages);
        try {
          return await turns.turn(request);
        } catch (err) {
          if (stopped(request || {}, err)) throw err;
          const text = explain({ hops, label, kindOf: routes.failureKind, reasonOf: routes.reasonText });
          if (!text) throw err;
          const out = new Error(text);
          out.cause = err;
          if (err && err.status) out.status = err.status;
          throw out;
        }
      },
    };
  }

  window.HCCodeRouter = { hasPictures, optionsFor, listed, explain, keptNote, create };
})();
