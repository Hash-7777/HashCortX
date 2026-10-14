// ==============================================================
// Messages sent while a model is working
//
// A message typed while a reply was being written was refused in chat, sent
// on top of the running request in Finance, and in HashCoder it started a
// new run, which stopped the one at work and threw its answer away.
//
// Now a message sent while a workspace is busy waits in a queue shown just
// above its composer, each message with a way to take it back to edit (or
// the Up arrow in an empty box) and to remove it. What happens to it then is
// the workspace's to say:
//
//   · where a reply is written in one go (chat, the ERP agent, Finance, 3D
//     Forge), the queue is sent as one message when the reply finishes;
//   · where a run takes several steps (HashCoder), the queue is handed to the
//     model at the next step, after the results it is waiting for, so the
//     run takes it into account without starting again (takeNow), and what
//     is still queued when the run finishes is sent as the next request.
//
// A reply that was stopped, or ended in an error, does not send what is
// queued: it goes back into the box, to be sent or changed. Several queued
// messages are sent as one, in the order they were written, so one reply
// answers them all. Attachments stay with the box, as they were.
//
// The queue itself (create) is pure and checked by scripts/checks/queue.mjs;
// forComposer draws it and wires a box to it. Loaded before the app and every
// mode, and published as window.HCQueue.
// ==============================================================

(function () {
  'use strict';

  /** A queue of messages: `{ add, remove, take, items, size, text }`. */
  function create() {
    let items = [];
    let seq = 0;
    return {
      /** Queue a message; '' and spaces alone are not one. Returns its id, or 0. */
      add(text) {
        const t = String(text == null ? '' : text).trim();
        if (!t) return 0;
        items.push({ id: ++seq, text: t });
        return seq;
      },
      /** Take one message out, returning it, or null. */
      remove(id) {
        const at = items.findIndex((m) => m.id === id);
        return at < 0 ? null : items.splice(at, 1)[0];
      },
      /** Take every message out, oldest first. */
      take() { const out = items; items = []; return out; },
      get items() { return items.slice(); },
      get size() { return items.length; },
      /** Every message as one, in the order written. */
      get text() { return items.map((m) => m.text).join('\n\n'); },
    };
  }

  /** Several messages as the one they are sent as. */
  const joined = (list) => (list || []).map((m) => m.text).join('\n\n');

  const REMOVE_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  /**
   * A queue for one composer. `input` is its text box; `before` the element
   * the queue is drawn above; `when` what it says about when it is sent;
   * `send()` sends what is in the box; `outcome()` says how the work that
   * just ended went, `{ stopped, failed }`.
   */
  function forComposer({ input, before, when = 'Sends when the reply finishes', send = null, outcome = () => ({}) } = {}) {
    const q = create();
    const doc = (input && input.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    let box = null, list = null;

    const setBox = (text) => {
      if (!input) return;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));   // the box sizes itself to what it holds
      try { input.focus(); input.setSelectionRange(text.length, text.length); } catch { /* not focusable here */ }
    };

    let shown = new Set();   // ids already drawn, so only a new message slides in
    let leaving = 0;         // the timer of the card lifting away once the queue is sent

    function draw() {
      if (!doc || !before || !before.parentNode) return;
      if (!box) {
        box = doc.createElement('div');
        box.className = 'hc-queue';
        box.hidden = true;
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', 'Queued messages');
        const head = doc.createElement('div');
        head.className = 'hc-queue-head';
        head.innerHTML = '<span class="hc-queue-pulse" aria-hidden="true"></span><span class="hc-queue-title">Queued</span><span class="hc-queue-count"></span><span class="hc-queue-when"></span>';
        head.querySelector('.hc-queue-when').textContent = when;
        list = doc.createElement('ol');
        list.className = 'hc-queue-list';
        box.append(head, list);
        before.parentNode.insertBefore(box, before);
        list.addEventListener('click', (e) => {
          const row = e.target.closest('.hc-queue-item');
          if (!row) return;
          const id = Number(row.dataset.id);
          if (e.target.closest('.hc-queue-drop')) { q.remove(id); draw(); return; }
          if (e.target.closest('.hc-queue-edit')) edit(id);
        });
      }
      const items = q.items;
      // Sent or taken back whole: the card lifts away, then is hidden.
      if (!items.length) {
        shown = new Set();
        if (box.hidden || leaving) return;
        box.classList.add('hc-queue--leaving');
        leaving = setTimeout(() => { leaving = 0; box.classList.remove('hc-queue--leaving'); if (!q.size) box.hidden = true; }, 220);
        return;
      }
      if (leaving) { clearTimeout(leaving); leaving = 0; box.classList.remove('hc-queue--leaving'); }
      box.hidden = false;
      box.querySelector('.hc-queue-count').textContent = items.length > 1 ? String(items.length) : '';
      list.textContent = '';
      items.forEach((m, i) => {
        const row = doc.createElement('li');
        row.className = 'hc-queue-item' + (shown.has(m.id) ? '' : ' hc-queue-item--new');
        row.dataset.id = String(m.id);
        const n = doc.createElement('span');
        n.className = 'hc-queue-n';
        n.setAttribute('aria-hidden', 'true');
        n.textContent = String(i + 1).padStart(2, '0');
        const text = doc.createElement('span');
        text.className = 'hc-queue-text';
        text.textContent = m.text;
        text.title = m.text;
        const editBtn = doc.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'hc-queue-edit';
        editBtn.textContent = 'Edit';
        editBtn.setAttribute('aria-label', 'Take this message back to edit it');
        const drop = doc.createElement('button');
        drop.type = 'button';
        drop.className = 'hc-queue-drop';
        drop.innerHTML = REMOVE_SVG;
        drop.setAttribute('aria-label', 'Remove this message from the queue');
        drop.title = 'Remove';
        row.append(n, text, editBtn, drop);
        list.append(row);
      });
      shown = new Set(items.map((m) => m.id));
    }

    /** Take a message back into the box to edit, before what is already there. */
    function edit(id) {
      const m = q.remove(id);
      if (!m) return;
      const now = input ? input.value.trim() : '';
      setBox(now ? `${m.text}\n\n${now}` : m.text);
      draw();
    }

    // The Up arrow in an empty box takes the newest queued message back.
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || input.value || !q.size) return;
        e.preventDefault();
        edit(q.items[q.size - 1].id);
      });
    }

    return {
      /** Queue what is in the box and empty it. Returns whether anything was queued. */
      hold() {
        const id = q.add(input ? input.value : '');
        if (!id) return false;
        setBox('');
        draw();
        return true;
      },
      /** Queue a message given as text. */
      add(text) { const id = q.add(text); if (id) draw(); return id; },
      /** Every queued message, taken out as one: `{ text, count }`, or null when none. */
      takeNow() {
        if (!q.size) return null;
        const list = q.take();
        draw();
        return { text: joined(list), count: list.length };
      },
      /**
       * The work ended. When it was stopped or failed, what is queued goes back
       * into the box, before anything being typed there. Otherwise it is sent
       * as one message, once what ended has finished saying so, and anything
       * being typed in the box is kept there: `send()` reads the box and empties
       * it before it waits on anything, so the queued text is put in, sent, and
       * the draft put back. A send that did not take it (no model chosen)
       * leaves it in the box with the draft after it.
       */
      settle() {
        if (!q.size) return;
        setTimeout(() => {
          if (!q.size) return;
          const how = (typeof outcome === 'function' ? outcome() : null) || {};
          const list = q.take();
          draw();
          const text = joined(list);
          const draft = input ? input.value.trim() : '';
          const both = draft ? `${text}\n\n${draft}` : text;
          if (how.stopped || how.failed || typeof send !== 'function' || !input) { setBox(both); return; }
          input.value = text;
          send();
          if (input.value === text) setBox(both);   // not taken: nothing is lost
          else if (draft) setBox(draft);
        }, 0);
      },
      get size() { return q.size; },
      get items() { return q.items; },
      draw,
    };
  }

  window.HCQueue = { create, joined, forComposer };
})();
