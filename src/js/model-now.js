// ==============================================================
// Which model is answering, in every workspace
//
// The model a person picks is not always the model that answers. A run
// moves to another model when one is out of quota, refuses the key, is too
// slow to start or cannot take the request's size, and the Agent Swarm and
// other workspaces choose models of their own. The picker still shows the
// first choice, so nothing said which model was working at that moment.
//
// Every request to a model is counted here while it is in flight, at the
// few places every request passes through: the one request to a model on
// this computer (js/local-client.js), and, in app.js, the stream of a cloud
// answer, the one place a model turn is dispatched, and a picture being
// made. A move to another model is a new request, so the line in the title
// bar changes the moment it happens. It names the model answering now, and
// how many others are answering beside it; with nothing in flight it names
// the last model that answered, dimmed.
//
// Nothing here leaves the app: the line is drawn from the request's model
// name, and the name is never sent anywhere.
//
// `start`, `stop`, `around` and `lineOf` work without a page and are
// checked by scripts/checks/model-now.mjs; `mount` puts it in the title bar.
// Loaded before app.js and published as window.HCModelNow.
// ==============================================================

(function () {
  'use strict';

  const active = new Map();   // request id -> { model, at }
  let seq = 0;
  let last = '';
  let namer = null;
  const subs = new Set();

  const emit = () => { for (const fn of subs) { try { fn(); } catch { /* a view that fails never stops a request */ } } };

  /** A request to `model` has started. Returns its id, for stop(). */
  function start(model) {
    const name = String(model || '').trim();
    if (!name) return 0;
    const id = ++seq;
    active.set(id, { model: name, at: id });
    last = name;
    emit();
    return id;
  }

  /** The request `id` has ended, however it ended. */
  function stop(id) {
    if (active.delete(id)) emit();
  }

  /** `fn()` counted as a request to `model` while it runs, whether it resolves or throws. */
  async function around(model, fn) {
    const id = start(model);
    try { return await fn(); } finally { stop(id); }
  }

  /** What is answering: the newest request's model, the other models in flight, and whether any is. */
  function state() {
    const list = [...active.values()];
    const now = list.length ? list[list.length - 1].model : '';
    const models = [...new Set(list.map((x) => x.model))];
    return { working: !!now, model: now || last, others: models.filter((m) => m !== now) };
  }

  /** How a model is named: a cloud model by its catalogue name, one on this computer as itself. */
  function nameOf(model) {
    const m = String(model || '');
    if (!m) return '';
    if (m.startsWith('cloud:')) {
      const named = namer ? namer(m) : '';
      if (named) return named;
      const [, provider = '', id = ''] = /^cloud:([^:]+):(.*)$/.exec(m) || [];
      return id ? `${id} · ${provider}` : m;
    }
    return `${m} · this computer`;
  }

  /**
   * The line for the title bar, `{ shown, text, title, working }`, from a
   * state. Hidden until a model has answered.
   */
  function lineOf(s = state(), name = nameOf) {
    if (!s.model) return { shown: false, text: '', title: '', working: false };
    const main = name(s.model);
    const more = s.others.length ? ` +${s.others.length}` : '';
    const title = s.working
      ? `Answering now: ${[main, ...s.others.map(name)].join(', ')}`
      : `Last to answer: ${main}`;
    return { shown: true, text: main + more, title, working: s.working };
  }

  /** Name cloud models the way the model picker does (app.js passes its own namer). */
  function setNamer(fn) { namer = typeof fn === 'function' ? fn : null; emit(); }

  /** Be told when what is answering changes. Returns a function that stops it. */
  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  /**
   * Put the line into the title bar `bar` and keep it drawn, at most once a
   * frame. Every part of it is a drag region, as everything in the bar must
   * be, since WebKit does not inherit that; it sits left of the buttons, so
   * the centred name never moves.
   */
  function mount(bar) {
    if (!bar || !bar.ownerDocument) return;
    const doc = bar.ownerDocument;
    const part = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; e.setAttribute('data-tauri-drag-region', ''); return e; };
    const el = part('div', 'hc-model-now');
    el.id = 'hcModelNow';
    el.setAttribute('role', 'status');
    el.hidden = true;
    const dot = part('span', 'hc-model-now-dot');
    dot.setAttribute('aria-hidden', 'true');
    const nameEl = part('span', 'hc-model-now-name');
    el.append(dot, nameEl);
    bar.append(el);
    let frame = 0;
    const draw = () => {
      frame = 0;
      const line = lineOf();
      el.hidden = !line.shown;
      el.classList.toggle('working', line.working);
      el.title = line.title;
      el.setAttribute('aria-label', line.title);
      if (nameEl && nameEl.textContent !== line.text) nameEl.textContent = line.text;
    };
    subscribe(() => { if (!frame) frame = requestAnimationFrame(draw); });
    draw();
  }

  window.HCModelNow = { start, stop, around, state, nameOf, lineOf, setNamer, subscribe, mount };
})();
