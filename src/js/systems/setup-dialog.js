// ==============================================================
// The setup form, and the questions after it
//
// Two steps before a system is built. First a form, filled in from whatever
// was typed and correctable in every field: the business's name, what it
// does, where it is, what it counts in, and which parts it keeps track of.
// Then a model reads that and asks only what it cannot work out itself; what
// is left blank is marked for the owner to fill in, never invented.
//
// The reading and the composing are js/systems/setup.js, where they are
// checked. This is the part that draws and talks.
//
// Everything a model wrote is put on the page as text. The example under a
// question is offered the way the Swarm offers one — real text that can be
// selected, pressed to use it, or taken with the right arrow — because a
// placeholder is none of those things.
//
// Nothing here can stop a system being built. A model that does not answer,
// answers late or answers something unreadable costs the questions and
// nothing else: the build goes ahead with the form.
//
// Loaded after js/systems/setup.js, before the Systems mode, and published as
// window.HCSystemsSetupDialog. Checked by scripts/checks/systems-setup.mjs.
// ==============================================================

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const S = () => window.HCSystemsSetup;
  const D = () => window.HCSystemsDomain;
  /** How long the model is given to decide what to ask. */
  const ASK_MS = 45000;

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) node.append(kid);
    return node;
  }

  /** A labelled field of the form. */
  const field = (label, control, hint) => el('label', { class: 'sys-setup-field' },
    el('span', { class: 'sys-setup-label', text: label }), control,
    hint ? el('span', { class: 'sys-setup-hint', text: hint }) : null);

  /** The parts on offer, as ticks, redrawn when the kind of business changes. */
  function drawParts(host, setup) {
    host.textContent = '';
    setup.parts.forEach((part, i) => {
      const box = el('input', { type: 'checkbox', id: `sysSetupPart_${i}`, checked: !!part.on });
      box.addEventListener('change', () => { part.on = box.checked; refresh(setup); });
      host.append(el('label', { class: `sys-setup-part${part.own ? '' : ' is-extra'}`, htmlFor: box.id },
        box, el('span', { text: part.name })));
    });
  }

  /** Step 1: the form. */
  function drawForm(host, setup) {
    host.textContent = '';
    const name = el('input', { type: 'text', id: 'sysSetupName', value: setup.name, placeholder: 'The name customers know it by', autocomplete: 'off' });
    name.addEventListener('input', () => { setup.name = name.value; });
    const place = el('input', { type: 'text', id: 'sysSetupPlace', value: setup.place, placeholder: 'City or country', autocomplete: 'off' });
    const does = el('textarea', { id: 'sysSetupDoes', rows: 3, value: setup.does, placeholder: 'What it sells or does, and for whom' });
    does.addEventListener('input', () => { setup.does = does.value; refresh(setup); });

    const trade = el('select', { id: 'sysSetupTrade' });
    for (const t of S().tradesOf(D())) trade.append(el('option', { value: t.id, text: t.label, selected: t.id === setup.trade }));
    const currency = el('select', { id: 'sysSetupCurrency' });
    const codes = S().CURRENCIES.map(([code]) => code);
    if (setup.currency && !codes.includes(setup.currency)) currency.append(el('option', { value: setup.currency, text: setup.currency }));
    for (const [code, label] of S().CURRENCIES) currency.append(el('option', { value: code, text: `${code} — ${label}`, selected: code === setup.currency }));
    currency.addEventListener('change', () => { setup.currency = currency.value; });

    // A place that names its currency sets it — until the owner picks one.
    let pickedCurrency = false;
    currency.addEventListener('change', () => { pickedCurrency = true; });
    place.addEventListener('input', () => {
      setup.place = place.value;
      const found = S().currencyForPlace(place.value);
      if (found && !pickedCurrency) {
        if (![...currency.options].some((o) => o.value === found)) currency.prepend(el('option', { value: found, text: found }));
        currency.value = found;
        setup.currency = found;
      }
    });

    const parts = el('div', { class: 'sys-setup-parts', id: 'sysSetupParts', role: 'group', 'aria-label': 'What to keep track of' });
    trade.addEventListener('change', () => {
      setup.trade = trade.value;
      // A new kind of business brings its own parts; extras already ticked stay ticked.
      const kept = new Set(setup.parts.filter((p) => !p.own && p.on).map((p) => p.entity));
      setup.parts = S().partsFor(setup.trade, D()).map((p) => (kept.has(p.entity) ? { ...p, on: true } : p));
      drawParts(parts, setup);
      refresh(setup);
    });
    drawParts(parts, setup);

    host.append(
      el('div', { class: 'sys-setup-row' }, field('Business name', name), field('Where', place)),
      field('What it does', does),
      el('div', { class: 'sys-setup-row' }, field('Kind of business', trade), field('Money is counted in', currency)),
      el('div', { class: 'sys-setup-field' },
        el('span', { class: 'sys-setup-label', text: 'What to keep track of' }),
        parts,
        el('span', { class: 'sys-setup-hint', text: `Tick at least ${S().MIN_PARTS}. The dashed ones are not usual for this kind of business, and are there if you need them.` })),
      el('div', { class: 'sys-setup-problems', id: 'sysSetupProblems', role: 'status', 'aria-live': 'polite' }),
    );
    refresh(setup);
  }

  /** Say what is stopping the build, and hold the buttons that would start it. */
  function refresh(setup) {
    const problems = S().problemsOf(setup);
    const box = $('sysSetupProblems');
    if (box) box.textContent = problems.join(' ');
    for (const id of ['sysSetupNext', 'sysSetupSkip']) {
      const b = $(id);
      if (b && $('sysSetupForm') && !$('sysSetupForm').hidden) b.disabled = problems.length > 0;
    }
  }

  /** Step 2: the model's questions, each with an example that can be used. */
  function drawQuestions(host, questions) {
    host.textContent = '';
    const C = window.HCSwarmClarify;
    return questions.map((q, i) => {
      const input = el('textarea', { id: `sysSetupQ_${i}`, rows: 2, class: 'sys-setup-answer' });
      const row = el('div', { class: 'sys-setup-field' }, el('label', { class: 'sys-setup-label', htmlFor: input.id, text: q.question }), input);
      const example = C && C.exampleOf ? C.exampleOf(q.hint) : String(q.hint || '').trim();
      if (example) {
        input.placeholder = `e.g. ${example}`;
        const take = () => {
          if (input.value.trim()) return false;
          input.value = example;
          input.focus();
          input.setSelectionRange(example.length, example.length);
          return true;
        };
        const use = el('button', { type: 'button', class: 'sys-setup-example', text: example, title: 'Use this example' });
        use.addEventListener('click', take);
        row.append(el('div', { class: 'sys-setup-example-row' }, el('span', { class: 'sys-setup-hint', text: 'Example' }), use));
        input.addEventListener('keydown', (e) => {
          if ((e.key !== 'ArrowRight' && e.key !== 'Tab') || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || input.value.length) return;
          if (take()) e.preventDefault();
        });
      }
      host.append(row);
      return { question: q.question, input };
    });
  }

  /** What a model wants to ask; [] when it wants nothing or nothing answered. */
  async function askModel(setup, deps, signal) {
    const ROUTES = window.HCModelRoutes;
    const C = window.HCSwarmClarify;
    if (!ROUTES || !C || !window._H || !window._H.runModelTurn) return [];
    const note = (m, kind = 'warn') => { try { deps.trace && deps.trace(m, kind); } catch { /* the trace is not the work */ } };
    const routes = ROUTES.createRun({ options: deps.models, label: deps.label, note });
    const first = typeof deps.models === 'function' ? (deps.models()[0] || {}).value : '';
    let model = routes.start((deps.chosen && deps.chosen()) || first || '');
    for (let i = 0; model && i < 3; i++) {
      try {
        const reply = await ROUTES.callWithin(ASK_MS, signal, `no answer within ${ASK_MS / 1000} s`, (s) => window._H.runModelTurn({
          modelValue: model, messages: S().questionMessages(setup), tools: [], temperature: 0.2, signal: s, untilFinished: true, need: 800,
        }));
        const questions = C.parseQuestions(reply && reply.content);
        if (questions === null) throw new Error('its answer could not be read');
        return questions.slice(0, S().MAX_QUESTIONS);
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        note(`Could not ask ${deps.label ? deps.label(model) : model} what else it needs · ${String((err && err.message) || err).slice(0, 90)}`);
        model = routes.next(model, err);
      }
    }
    return [];
  }

  /**
   * Ask. Resolves with { setup, answers } to build from, or null when the
   * owner cancels. Without the markup it needs, it resolves with the form as
   * it was read, so the build still goes ahead.
   */
  function ask(typed, deps = {}) {
    const setup = S().suggest(typed, D());
    const overlay = $('sysSetup');
    const form = $('sysSetupForm');
    const qs = $('sysSetupAsk');
    const list = $('sysSetupQuestions');
    const waiting = $('sysSetupWaiting');
    const next = $('sysSetupNext');
    const skip = $('sysSetupSkip');
    const cancel = $('sysSetupCancel');
    if (!overlay || !form || !qs || !list || !next || !skip || !cancel) return Promise.resolve({ setup, answers: [] });

    return new Promise((resolve) => {
      let step = 1;
      let asking = null;
      let fields = [];
      const setStep = (n) => {
        step = n;
        form.hidden = n !== 1;
        qs.hidden = n === 1;
        $('sysSetupStep').textContent = `Step ${n} of 2`;
        $('sysSetupTitle').textContent = n === 1 ? 'About the business' : 'A few more details';
        $('sysSetupNote').textContent = n === 1
          ? 'Filled in from what you typed. Change anything that is wrong — every answer here changes what is built.'
          : 'Only what could not be worked out from the form. Anything you leave blank is marked in the system for you to fill in — nothing is made up.';
        next.textContent = n === 1 ? 'Continue' : 'Build the system';
        skip.textContent = n === 1 ? 'Build without questions' : 'Skip — leave them marked';
        next.disabled = false;
        skip.disabled = false;
        if (n === 1) refresh(setup);
      };
      const finish = (value) => {
        if (asking) asking.abort();
        overlay.classList.remove('open');
        next.removeEventListener('click', onNext);
        skip.removeEventListener('click', onSkip);
        cancel.removeEventListener('click', onCancel);
        overlay.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const answers = (blank) => fields.map((f) => ({ question: f.question, answer: blank ? '' : f.input.value }));
      const toQuestions = async () => {
        setStep(2);
        list.textContent = '';
        waiting.hidden = false;
        next.disabled = true;
        asking = new AbortController();
        let questions = [];
        try { questions = await askModel(setup, deps, asking.signal); }
        catch { return; }   // cancelled while waiting; finish() has already run
        finally { asking = null; }
        waiting.hidden = true;
        if (!questions.length) { finish({ setup, answers: [] }); return; }
        fields = drawQuestions(list, questions);
        next.disabled = false;
        setTimeout(() => fields[0] && fields[0].input.focus(), 40);
      };
      const onNext = () => {
        if (step === 1) { if (!S().problemsOf(setup).length) toQuestions(); return; }
        finish({ setup, answers: answers(false) });
      };
      const onSkip = () => {
        if (step === 1) { if (!S().problemsOf(setup).length) finish({ setup, answers: [] }); return; }
        finish({ setup, answers: answers(true) });
      };
      const onCancel = () => finish(null);
      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onNext();
      };
      next.addEventListener('click', onNext);
      skip.addEventListener('click', onSkip);
      cancel.addEventListener('click', onCancel);
      overlay.addEventListener('keydown', onKey);

      drawForm(form, setup);
      waiting.hidden = true;
      setStep(1);
      overlay.classList.add('open');
      setTimeout(() => $(setup.name ? 'sysSetupDoes' : 'sysSetupName')?.focus(), 60);
    });
  }

  window.HCSystemsSetupDialog = { ask, ASK_MS };
})();
