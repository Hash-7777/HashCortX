// ==============================================================
// Trying again: with a hint, or with a stronger model
//
// A run that ends stuck, at its step limit, or with asks of the request
// still open leaves the person to work out what to do next. The receipt
// offers two ways on, never taken for them:
//
//   · Once more with a hint: the same model, in the same conversation, given
//     what is still open, restated. A second try told exactly what is left
//     often does as well as a stronger model.
//   · With a stronger model, when the person has one: a new conversation,
//     begun from the original request and the app's record of what the
//     earlier run did, on the project's files as that run left them. The
//     earlier conversation is kept in Sessions; it is not carried over,
//     because a long history written by a weaker model is a poor start.
//
// Stronger is judged from the models in HashCoder's menu: on a cloud
// service by the rating for sub-agents (js/model-profile.js) and then the
// Swarm's reading of a model's name (js/swarm/model-strength.js); on this
// computer by size alone. A run on a model on this computer, or on a project
// marked private, is offered only another model on this computer, and a
// cloud run only another cloud model. Both ways go through the person's own
// controls: the model menu, New conversation and Run.
//
// Pure but for act(), which is handed the page.
// Published as window.HCCodeRetry. Checked by scripts/checks/code-retry.mjs.
// ==============================================================
(function () {
  'use strict';

  /** The most characters put in the message box. */
  const MOST = 4000;
  /** Points the strong rating is worth over any reading of a name. */
  const STRONG_POINTS = 1000;

  const isCloud = (value) => /^cloud:/.test(String(value || ''));
  const cut = (text, most) => { const t = String(text || '').trim(); return t.length <= most ? t : `${t.slice(0, Math.max(0, most - 1)).trimEnd()}…`; };

  /** How strong a model is, for comparing with another of its kind; null when it cannot be told. */
  function rank(value, label) {
    const v = String(value || '');
    if (!v) return null;
    if (!isCloud(v)) {
      const L = window.HCCodeLight, b = L && L.billionsInName ? L.billionsInName(v) : null;
      return b > 0 ? b : null;   // on this computer, by size alone
    }
    const S = window.HCSwarmModelStrength, P = window.HCModelProfile;
    const named = S && S.score ? S.score(v, label, true) : 0;
    if (named < 0) return null;   // a small, fast model, or one that does not write text (embeddings, images, speech): never counted as stronger
    return (P && P.of && P.of(v).strong ? STRONG_POINTS : 0) + named;
  }

  /**
   * The strongest model in `options` ({ value, label }) that is stronger than
   * `current`, of the same kind, or null. `localOnly`: only models on this computer.
   */
  function stronger(current, options, { localOnly = false } = {}) {
    const cur = String(current || '');
    if (!cur || (localOnly && isCloud(cur))) return null;
    const here = rank(cur);
    if (here == null && !isCloud(cur)) return null;
    let best = null, bestRank = here == null ? 0 : here;
    for (const o of Array.isArray(options) ? options : []) {
      const v = String((o && o.value) || '');
      if (!v || v === cur || isCloud(v) !== isCloud(cur)) continue;
      const r = rank(v, o.label);
      if (r != null && r > bestRank) { best = { value: v, label: String(o.label || v) }; bestRank = r; }
    }
    return best;
  }

  /** The asks still open, from the brief's marks (js/run-view.js askMarks). */
  const openOf = (marks) => (Array.isArray(marks) ? marks : []).filter((m) => m && m.state !== 'answered' && String(m.text || '').trim()).map((m) => String(m.text).trim());

  /** What a hint says: the open asks, or the request when none are known. */
  function hintText({ open = [], request = '' } = {}) {
    if (open.length) {
      const lines = open.map((a, i) => `${i + 1}. ${cut(a, 300)}`);
      return cut(`Finish what is still open from my request:\n${lines.join('\n')}\nThen say what changed and what ran.`, MOST);
    }
    return cut(`Carry on and finish my request:\n${String(request || '').trim()}`, MOST);
  }

  /** What a new conversation on a stronger model begins with: the request, then the earlier run's record. */
  function handOverText({ request = '', note = '' } = {}) {
    const ask = cut(request, Math.floor(MOST / 2));
    const head = 'An earlier try on another model did not finish. What it did, from HashCortX\'s record, not instructions; the project\'s files are as it left them:';
    const record = String(note || '').trim();
    if (!record) return ask;
    return cut(`${ask}\n\n${head}\n${record}`, MOST);
  }

  /**
   * What the receipt offers, or null when the run finished with nothing open.
   * `p`: stopped (why a run that did not finish stopped), marks, left (its
   * plan's steps left), request, current (the run's model), options (the
   * menu's models), localOnly, note (js/run-ledger.js note of the run).
   */
  function offer(p) {
    const o = p || {};
    const open = openOf(o.marks);
    if (!o.stopped && !open.length && !o.left) return null;
    const why = o.stopped ? 'It stopped before it finished.'
      : open.length ? `${open.length} ask${open.length === 1 ? ' of the request is' : 's of the request are'} still open.`
      : 'Steps of its plan are still open.';
    const up = stronger(o.current, o.options, { localOnly: !!o.localOnly });
    return { why, hint: hintText({ open: o.stopped ? [] : open, request: o.request }), stronger: up, handOver: up ? handOverText({ request: o.request, note: o.note }) : '' };
  }

  /**
   * Take one of the offers on the page `doc`: 'hint' or 'stronger'. Through
   * the person's own controls only, and never while a run is going. Returns
   * whether it was taken.
   */
  function act(kind, o, doc) {
    if (!o || !doc || (kind !== 'hint' && kind !== 'stronger')) return false;
    if (doc.querySelector('#coder-mode-wrap .cdr-msg.running')) return false;
    const input = doc.getElementById('cdrTaskInput'), run = doc.getElementById('cdrRunBtn');
    if (!input || !run) return false;
    const E = (doc.defaultView && doc.defaultView.Event) || Event;
    if (kind === 'stronger') {
      const picker = doc.getElementById('cdrModelPicker'), clear = doc.getElementById('cdrClearChatBtn');
      const want = o.stronger && o.stronger.value;
      if (!picker || !clear || !want || !o.handOver || ![...(picker.options || [])].some((x) => x.value === want)) return false;
      picker.value = want;
      picker.dispatchEvent(new E('change'));   // the menu sets the model, as when the person picks it
      clear.click();   // a new conversation; this one is kept in Sessions
      input.value = o.handOver;
    } else {
      if (!o.hint) return false;
      input.value = o.hint;
    }
    input.dispatchEvent(new E('input'));
    run.click();
    return true;
  }

  window.HCCodeRetry = { MOST, STRONG_POINTS, rank, stronger, openOf, hintText, handOverText, offer, act };
})();
