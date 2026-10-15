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
// answers them all. What was attached when a message was sent waits with
// it, shown on its row, and goes with it: sent with it, read with it at
// HashCoder's next step, and back in the box with it when it is taken back
// or the work is stopped; the workspace says how its attachments are taken
// out of the box and put back (`attachments`).
//
// "Send now", or Ctrl+Enter (Cmd+Enter on a Mac) while the work goes on,
// does not wait. What is under way is cut where it does least harm, which
// is the workspace's to say (`interrupt`): HashCoder drops only the step
// the model is still writing, and reads the message at once, its finished
// steps and a command still running left as they are; where a reply is
// written in one go, it stops where it has got to and is kept as written,
// and the queue is sent as soon as it has stopped. Stopped this way, the
// queue is sent, not handed back. 3D Forge has no "Send now": stopping
// there would throw away the part being made.
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
      /** Queue a message, with what was attached to it; '' and spaces alone, with nothing attached, are not one. Returns its id, or 0. */
      add(text, files = []) {
        const t = String(text == null ? '' : text).trim();
        const with_ = Array.isArray(files) ? files.filter(Boolean) : [];
        if (!t && !with_.length) return 0;
        items.push({ id: ++seq, text: t, files: with_ });
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
      get text() { return joined(items); },
    };
  }

  /** Several messages as the one they are sent as. */
  const joined = (list) => (list || []).map((m) => m.text).filter(Boolean).join('\n\n');
  /** What was attached to several messages, in the order they were written. */
  const filesOf = (list) => (list || []).flatMap((m) => m.files || []);
  /** A preview that may be drawn: a picture the app made itself, never an address. */
  const SAFE_THUMB = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;

  const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(String(navigator.platform || navigator.userAgent || ''));
  const REMOVE_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  /**
   * A queue for one composer. `input` is its text box; `before` the element
   * the queue is drawn above, or `host` an element it is drawn at the end of
   * (a one-line prompt in a bar, where it hangs below); `when` what it says
   * about when it is sent;
   * `send()` sends what is in the box; `outcome()` says how the work that
   * just ended went, `{ stopped, failed }`; `interrupt()`, when given, makes
   * the work under way give way for the queue, and shows "Send now".
   */
  function forComposer({ input, before = null, host = null, when = 'Sends when the reply finishes', send = null, outcome = () => ({}), interrupt = null, attachments = null } = {}) {
    // `attachments`: { take() the box's attachments out, give(list) put some in, count() how many it holds }
    const att = attachments && typeof attachments.take === 'function' && typeof attachments.give === 'function' ? attachments : null;
    const takeFiles = () => (att ? att.take() || [] : []);
    const giveFiles = (list) => { if (att && list && list.length) att.give(list); };
    const q = create();
    let urgent = false;   // "Send now" was asked for: the queue goes as soon as the work gives way
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
      if (!doc || !(host || (before && before.parentNode))) return;
      if (!box) {
        box = doc.createElement('div');
        box.className = 'hc-queue';
        box.hidden = true;
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', 'Queued messages');
        const head = doc.createElement('div');
        head.className = 'hc-queue-head';
        head.innerHTML = '<span class="hc-queue-pulse" aria-hidden="true"></span><span class="hc-queue-title">Queued</span><span class="hc-queue-count"></span><span class="hc-queue-when"></span><button type="button" class="hc-queue-now" hidden><span class="hc-queue-now-label">Send now</span><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
        head.querySelector('.hc-queue-when').textContent = when;
        const now = head.querySelector('.hc-queue-now');
        now.hidden = typeof interrupt !== 'function';
        now.title = `Stop waiting and send it now (${MAC ? '\u2318' : 'Ctrl+'}Enter)`;
        now.addEventListener('click', () => sendNow());
        list = doc.createElement('ol');
        list.className = 'hc-queue-list';
        box.append(head, list);
        if (host) host.append(box); else before.parentNode.insertBefore(box, before);
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
        urgent = false;
        if (box.hidden || leaving) return;
        box.classList.add('hc-queue--leaving');
        leaving = setTimeout(() => { leaving = 0; box.classList.remove('hc-queue--leaving'); if (!q.size) { box.hidden = true; host?.classList.remove('hc-queue-host'); } }, 220);
        return;
      }
      if (leaving) { clearTimeout(leaving); leaving = 0; box.classList.remove('hc-queue--leaving'); }
      box.hidden = false;
      box.classList.toggle('hc-queue--now', urgent);
      const now = box.querySelector('.hc-queue-now');
      now.disabled = urgent;
      now.querySelector('.hc-queue-now-label').textContent = urgent ? 'Sending\u2026' : 'Send now';
      host?.classList.add('hc-queue-host');   // a host can rise above what the card hangs over while it shows
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
        text.textContent = m.text || (m.files.length === 1 ? 'Attachment' : 'Attachments');
        text.title = [m.text, ...m.files.map((f) => f.name)].filter(Boolean).join('\n');
        if (!m.text) text.classList.add('hc-queue-text--none');
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
        row.append(n, text);
        if (m.files.length) row.append(filesStrip(m.files));
        else row.classList.add('hc-queue-item--plain');
        row.append(editBtn, drop);
        list.append(row);
      });
      shown = new Set(items.map((m) => m.id));
    }

    /** What a queued message has attached, on its row: a picture's preview, a file's name. */
    function filesStrip(files) {
      const strip = doc.createElement('span');
      strip.className = 'hc-queue-files';
      for (const f of files.slice(0, 4)) {
        const chip = doc.createElement('span');
        chip.className = 'hc-queue-file';
        chip.title = f.name || '';
        const thumb = String(f.thumb || '');
        if (SAFE_THUMB.test(thumb)) {
          const img = doc.createElement('img');
          img.src = thumb;
          img.alt = '';
          img.draggable = false;
          chip.append(img);
          chip.classList.add('hc-queue-file--pic');
        } else chip.textContent = String(f.name || 'file');
        strip.append(chip);
      }
      if (files.length > 4) { const more = doc.createElement('span'); more.className = 'hc-queue-file'; more.textContent = `+${files.length - 4}`; strip.append(more); }
      return strip;
    }

    /** Take a message back into the box to edit, before what is already there, with what was attached to it. */
    function edit(id) {
      const m = q.remove(id);
      if (!m) return;
      const now = input ? input.value.trim() : '';
      setBox([m.text, now].filter(Boolean).join('\n\n'));
      giveFiles(m.files);
      draw();
    }

    /** Stop waiting: the work under way gives way, and the queue goes as soon as it has. */
    function sendNow() {
      if (!q.size || urgent || typeof interrupt !== 'function') return false;
      urgent = true;
      draw();
      try { interrupt(); } catch { /* the work ends its own way; the queue still goes when it does */ }
      return true;
    }

    // The Up arrow in an empty box takes the newest queued message back.
    if (input) {
      // Ctrl+Enter (Cmd+Enter on a Mac) while the work goes on: queued, as Enter does, and sent now.
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || !(MAC ? e.metaKey : e.ctrlKey) || typeof interrupt !== 'function') return;
        const had = q.size, empty = !String(input.value || '').trim();
        setTimeout(() => { if (q.size > had || (empty && q.size)) sendNow(); }, 0);   // after the box's own Enter has queued it
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || input.value || !q.size || (att && att.count && att.count() > 0)) return;
        e.preventDefault();
        edit(q.items[q.size - 1].id);
      });
    }

    return {
      /** Queue what is in the box, with what is attached, and empty it. Returns whether anything was queued. */
      hold() {
        const files = takeFiles();
        const id = q.add(input ? input.value : '', files);
        if (!id) { giveFiles(files); return false; }
        setBox('');
        draw();
        return true;
      },
      /** Queue a message given as text, and what is attached to it. */
      add(text, files = []) { const id = q.add(text, files); if (id) draw(); return id; },
      /** Every queued message, taken out as one: `{ text, count, files }`, or null when none. */
      takeNow() {
        if (!q.size) return null;
        urgent = false;
        const list = q.take();
        draw();
        return { text: joined(list), count: list.length, files: filesOf(list) };
      },
      /**
       * The work ended. When it was stopped or failed, what is queued goes back
       * into the box, before anything being typed there. Otherwise it is sent
       * as one message, once what ended has finished saying so, and anything
       * being typed in the box is kept there: `send()` reads the box and empties
       * it before it waits on anything, so the queued text is put in, sent, and
       * the draft put back. What was attached goes with it, and what is
       * attached to the draft waits out of the box while it is sent. A send
       * that did not take it (no model chosen) leaves it in the box with the
       * draft after it, and everything attached.
       */
      settle() {
        if (!q.size) return;
        setTimeout(() => {
          if (!q.size) return;
          const how = urgent ? {} : (typeof outcome === 'function' ? outcome() : null) || {};   // stopped by "Send now": sent, not handed back
          urgent = false;
          const list = q.take();
          draw();
          const text = joined(list), files = filesOf(list);
          const draft = input ? input.value.trim() : '';
          const both = [text, draft].filter(Boolean).join('\n\n');
          if (how.stopped || how.failed || typeof send !== 'function' || !input) { setBox(both); giveFiles(files); return; }
          const drafted = takeFiles();
          input.value = text;
          giveFiles(files);
          send();
          const taken = input.value !== text || (!!files.length && !!att && typeof att.count === 'function' && att.count() === 0);
          if (!taken) setBox(both);   // not taken: nothing is lost, what was attached still in the box
          else setBox(draft);
          giveFiles(drafted);
        }, 0);
      },
      sendNow,
      get urgent() { return urgent; },
      get size() { return q.size; },
      get items() { return q.items; },
      draw,
    };
  }

  window.HCQueue = { create, joined, filesOf, forComposer };
})();
