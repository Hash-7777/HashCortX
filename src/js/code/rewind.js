// ==============================================================
// Rewinding a HashCoder conversation: Edit and Regenerate
//
// Edit used to bring a request back to the box and leave everything after
// it standing, and Regenerate took away the newest answer wherever it was
// clicked. Now both rewind the conversation, as if what came after had not
// happened:
//
//   Edit         the request opens to change in place. Sending it undoes,
//                newest first, every change the replies after it made, cuts
//                the conversation at it, and sends the new words.
//   Regenerate   the same, back to the request before the reply, which is
//                then run again as it was sent, pictures and all.
//
// What will go is said before anything happens: the replies, the changes
// undone by name, the changes you kept (their saved copies are gone) or
// that could never be saved, which stay, changes made before the
// conversation was opened, which cannot be undone from here, and the
// commands that cannot be taken back, judged by the same test Auto uses
// (js/code/permissions.js shellVerdict). Nothing goes until you send. The
// changes are undone one at a time the way Undo all does
// (js/run-view.js undoRows); if one is not undone, nothing more is undone,
// nothing is sent, and it is said which changes before it were undone. A Regenerate with nothing to say
// first runs at once. The changes waiting from an earlier session, listed
// at the end of the panel, stay where they are.
//
// An undone change row offers Redo (offerRedo), which puts the change back.
//
// commandsAfter, changeCallsAfter, plan, lines and quiet are pure; edit,
// regenerate and offerRedo draw. Published as window.HCCodeRewind. Checked by
// scripts/checks/code-rewind.mjs.
// ==============================================================

(function () {
  'use strict';

  const CHANGES = new Set(['write_file', 'patch_file', 'delete_file', 'move_file']);
  const COMMANDS = new Set(['shell_run', 'execute_python']);

  const argsOf = (c) => {
    const a = (c && c.function ? c.function.arguments : c && c.arguments);
    if (a && typeof a === 'object') return a;
    try { return JSON.parse(a || '{}') || {}; } catch { return {}; }
  };
  const nameOf = (c) => (c && ((c.function && c.function.name) || c.name)) || '';
  /** Whether a tool's result says it did what it was asked. */
  const ran = (text) => {
    const t = String(text == null ? '' : text).trim();
    if (!t || /^(?:error\b|refused\b|permission denied|denied\b|blocked\b)/i.test(t)) return false;
    try { const v = JSON.parse(t); return !(v && typeof v === 'object' && v.error); } catch { return true; }
  };

  /** The calls made after `index` that did what they were asked: [{ name, args }]. */
  function callsAfter(messages, index) {
    const list = Array.isArray(messages) ? messages : [];
    const calls = new Map(), out = [];
    for (let i = index + 1; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) for (const c of m.tool_calls) if (c && c.id) calls.set(c.id, { name: nameOf(c), args: argsOf(c) });
      if (m.role === 'tool' && calls.has(m.tool_call_id) && ran(m.content)) out.push(calls.get(m.tool_call_id));
    }
    return out;
  }

  /** The commands run after `index` that cannot be taken back: all but those `reads(command, args)` says only read or run the project's own checks. */
  function commandsAfter(messages, index, reads) {
    const out = [];
    for (const c of callsAfter(messages, index)) {
      if (!COMMANDS.has(c.name)) continue;
      if (c.name === 'execute_python') { out.push('Python code it ran'); continue; }
      const args = Array.isArray(c.args.args) ? c.args.args.map(String) : [];
      if (typeof reads === 'function' && reads(String(c.args.command || ''), args)) continue;
      out.push([String(c.args.command || ''), ...args].join(' ').trim());
    }
    return [...new Set(out)];
  }

  /** How many changes to files the calls after `index` made. */
  const changeCallsAfter = (messages, index) => callsAfter(messages, index).filter((c) => CHANGES.has(c.name)).length;

  /**
   * What a rewind does, from the change rows after the place [{ name, state
   * pending|accepted|rejected, canUndo }]: { replies, added, undo (newest
   * first), kept, cannot, unseen, commands, pictures }.
   */
  function plan({ replies = 0, added = 0, rows = [], commands = [], changeCalls = 0, pictures = false } = {}) {
    const r = Array.isArray(rows) ? rows : [];
    return {
      replies, added, pictures: !!pictures,
      undo: r.filter((x) => x.state === 'pending' && x.canUndo).map((x) => x.name).reverse(),
      kept: r.filter((x) => x.state === 'accepted').map((x) => x.name),
      cannot: r.filter((x) => x.state === 'pending' && !x.canUndo).map((x) => x.name),
      unseen: Math.max(0, (Number(changeCalls) || 0) - r.length),
      commands: Array.isArray(commands) ? commands : [],
    };
  }

  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;

  /** The plan in plain words: [{ kind, text, attention }]. `how` is 'edit' or 'regen'. */
  function lines(p, how) {
    const out = [], they = p.replies === 1 ? 'it' : 'they';
    if (p.replies) out.push({ kind: 'reply', text: `${p.replies === 1 ? '1 reply goes, with all its steps' : `${p.replies} replies go, with all their steps`}${p.added ? ` and ${p.added === 1 ? 'the message' : `the ${p.added} messages`} you added while ${they} worked` : ''}.` });
    if (p.undo.length) out.push({ kind: 'undo', text: `${many(p.undo.length, 'change', 'changes')} ${they} made ${p.undo.length === 1 ? 'is' : 'are'} undone${p.undo.length > 1 ? ', newest first' : ''}: ${p.undo.join(', ')}.` });
    if (p.kept.length) out.push({ kind: 'kept', attention: true, text: `${many(p.kept.length, 'change', 'changes')} you kept ${p.kept.length === 1 ? 'stays: its saved copy is' : 'stay: their saved copies are'} gone, so undo cannot put ${p.kept.length === 1 ? 'it' : 'them'} back: ${p.kept.join(', ')}.` });
    if (p.cannot.length) out.push({ kind: 'cannot', attention: true, text: `${many(p.cannot.length, 'change', 'changes')} cannot be undone, ${p.cannot.length === 1 ? 'its' : 'their'} earlier contents could not be saved: ${p.cannot.join(', ')}.` });
    if (p.unseen) out.push({ kind: 'unseen', attention: true, text: `${many(p.unseen, 'change', 'changes')} made before this conversation was opened ${p.unseen === 1 ? 'is' : 'are'} not undone from here; any still waiting are listed at the end.` });
    if (p.commands.length) out.push({ kind: 'commands', attention: true, text: `${many(p.commands.length, 'command', 'commands')} cannot be taken back: ${p.commands.join('; ')}. Undo puts back files, not what a command did.` });
    if (how === 'edit' && p.pictures) out.push({ kind: 'pictures', text: 'What was attached to it is not sent again: attach it again if you want it.' });
    if (!out.length) out.push({ kind: 'nothing', text: 'Nothing after this message changed a file or ran a command.' });
    return out;
  }

  /** A rewind with nothing to say first: one reply that changed nothing and ran nothing. */
  const quiet = (p) => p.replies <= 1 && !p.undo.length && !p.kept.length && !p.cannot.length && !p.unseen && !p.commands.length;

  // ── Drawing ────────────────────────────────────────────────────────────

  const ICON = {
    rewind: '<path d="M2.5 3v10"/><path d="M13.5 4.2 6.4 8l7.1 3.8z"/>',
    redo: '<path d="m10.5 3.2 2.7 2.7-2.7 2.7"/><path d="M12.8 5.9H6.5a3.6 3.6 0 0 0 0 7.2H9"/>',
    reply: '<path d="M6.2 4 2.6 7.6l3.6 3.6"/><path d="M2.6 7.6h6.6c2.3 0 4.2 1.9 4.2 4.2v.7"/>',
    undo: '<path d="M5.5 3.2 2.8 5.9l2.7 2.7"/><path d="M3.2 5.9h6.3a3.6 3.6 0 0 1 0 7.2H7"/>',
    alert: '<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3.1M8 11.3v.1"/>',
    note: '<circle cx="8" cy="8" r="5.6"/><path d="M8 7.4v3.4M8 5.3v.1"/>',
  };
  const MARK = { reply: 'reply', undo: 'undo', kept: 'alert', cannot: 'alert', unseen: 'alert', commands: 'alert', pictures: 'note', nothing: 'note' };
  const svg = (k) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[k] || ''}</svg>`;

  /** What follows `userEl` in the conversation, the changes and commands in it, and the plan. */
  function gather(userEl, ctx, index, pictures) {
    const after = [];
    for (let n = userEl.nextElementSibling; n; n = n.nextElementSibling) if (n.matches(':not(.cdr-change-group)')) after.push(n);
    const rowEls = after.flatMap((n) => [...n.querySelectorAll('.cdr-step--change')]);
    const rows = rowEls.map((el) => {
      const undo = el.querySelector('.cdr-step-btn.undo');
      return { el, name: (el.querySelector('.cdr-step-object') || {}).textContent || 'a file', state: el.classList.contains('cdr-step--accepted') ? 'accepted' : el.classList.contains('cdr-step--rejected') ? 'rejected' : 'pending', canUndo: !!undo && !undo.disabled };
    });
    const list = ctx.messages();
    const p = plan({ replies: after.filter((n) => n.matches('.cdr-msg.assistant')).length, added: after.reduce((k, n) => k + n.querySelectorAll('.cdr-added').length, 0), rows, commands: commandsAfter(list, index, ctx.verdict), changeCalls: changeCallsAfter(list, index), pictures });
    return { after, rows, p };
  }

  /** The panel that says what will go, with its two buttons. */
  function panel(p, how, title, go) {
    const box = document.createElement('div');
    box.className = 'cdr-rewind';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'What rewinding does');
    box.innerHTML = `<div class="cdr-rewind-h">${svg('rewind')}<span></span></div><p class="cdr-rewind-p">As if nothing after it had happened. Before anything is sent:</p><ul class="cdr-rewind-goes"></ul>` +
      `<div class="cdr-rewind-row"><button type="button" class="cdr-rewind-go">${svg('rewind')}<span></span></button><button type="button" class="cdr-rewind-cancel">Cancel</button></div><p class="cdr-rewind-said" role="status" hidden></p>`;
    box.querySelector('.cdr-rewind-h span').textContent = title;
    box.querySelector('.cdr-rewind-go span').textContent = go;
    const ul = box.querySelector('.cdr-rewind-goes');
    for (const l of lines(p, how)) {
      const li = document.createElement('li');
      if (l.attention) li.className = 'is-attention';
      li.innerHTML = `<span class="cdr-rewind-mark">${svg(MARK[l.kind])}</span><span></span>`;
      li.lastChild.textContent = l.text;
      ul.appendChild(li);
    }
    return box;
  }

  /** Undo the changes, newest first; cut the conversation; take what followed off the screen. False, with the reason said, when a change was not undone. */
  async function rewind(g, box, cut) {
    const said = box.querySelector('.cdr-rewind-said');
    const pending = g.rows.filter((r) => r.state === 'pending' && r.canUndo).map((r) => r.el).reverse();
    const undone = await window.HCRunView.undoRows(pending);
    if (!undone.done) {
      const name = (undone.stopped && (undone.stopped.querySelector('.cdr-step-object') || {}).textContent) || 'a change';
      said.textContent = `${name} was not undone, so nothing more was undone and nothing was sent${undone.undone ? `; ${many(undone.undone, 'change before it was', 'changes before it were')} undone and ${undone.undone === 1 ? 'stays' : 'stay'} undone` : ''}.`;
      said.hidden = false;
      return false;
    }
    cut();
    for (const n of g.after) n.remove();
    return true;
  }

  function busyButtons(box, on) { box.querySelectorAll('button').forEach((b) => { b.disabled = on; }); }

  /** Edit a request in place; sending it rewinds the conversation to it. */
  function edit(userEl, ctx) {
    if (!userEl || ctx.busy() || userEl.classList.contains('is-editing') || !window.HCRunView) return;
    const msg = userEl.hcMsg, index = ctx.messages().indexOf(msg);
    if (index < 0) return;
    const shown = (userEl.querySelector('.cdr-user-bubble') || {}).textContent || '';
    const g = gather(userEl, ctx, index, !!(msg.images && msg.images.length) || /\n\nAttached: [^\n]*$/.test(String(msg.content || '')));
    userEl.classList.add('is-editing');
    const area = document.createElement('textarea');
    area.className = 'cdr-rewind-text';
    area.setAttribute('aria-label', 'Your request, to change and send again');
    area.value = shown.trim();
    const box = panel(g.p, 'edit', 'Sending this rewinds the conversation to here', 'Rewind and send');
    const cutLine = document.createElement('div');
    cutLine.className = 'cdr-rewind-cut';
    cutLine.textContent = 'Everything below goes';
    userEl.append(area, box);
    userEl.after(cutLine);
    g.after.forEach((n) => n.classList.add('cdr-going'));
    const close = () => { area.remove(); box.remove(); cutLine.remove(); userEl.classList.remove('is-editing'); g.after.forEach((n) => n.classList.remove('cdr-going')); };
    box.querySelector('.cdr-rewind-cancel').addEventListener('click', close);
    const send = async () => {
      const text = area.value.trim();
      if (!text || ctx.busy()) return;
      busyButtons(box, true);
      g.after.push(cutLine);
      if (!(await rewind(g, box, () => ctx.cut(index)))) { g.after.pop(); busyButtons(box, false); return; }
      userEl.remove();
      ctx.send(text);
    };
    box.querySelector('.cdr-rewind-go').addEventListener('click', send);
    area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } else if (e.key === 'Escape') close(); });
    area.focus();
  }

  /** Regenerate a reply: rewind to the request before it, and run that request again as it was sent. */
  function regenerate(replyEl, ctx) {
    let userEl = replyEl && replyEl.previousElementSibling;
    while (userEl && !(userEl.matches('.cdr-msg.user') && userEl.hcMsg)) userEl = userEl.previousElementSibling;
    if (!userEl || ctx.busy() || userEl.classList.contains('is-editing') || !window.HCRunView) return;
    const msg = userEl.hcMsg, index = ctx.messages().indexOf(msg);
    if (index < 0) return;
    const g = gather(userEl, ctx, index, false);
    const box = panel(g.p, 'regen', 'Running it again rewinds the conversation to your request', 'Rewind and run again');
    const run = async () => {
      if (ctx.busy()) return;
      busyButtons(box, true);
      if (!(await rewind(g, box, () => ctx.cut(index + 1)))) { busyButtons(box, false); return; }
      box.remove();
      ctx.rerun(msg);
    };
    if (quiet(g.p)) { g.after.forEach((n) => n.remove()); ctx.cut(index + 1); ctx.rerun(msg); return; }   // one reply that changed and ran nothing: nothing to say first
    userEl.after(box);
    box.querySelector('.cdr-rewind-cancel').addEventListener('click', () => box.remove());
    box.querySelector('.cdr-rewind-go').addEventListener('click', run);
  }

  /**
   * An undone change row offers Redo beside "Undone": `redo()` puts the change
   * back (platform/tauri/undo.js redo), and the row waits for Keep or Undo
   * again. A no to its question leaves it as it was; a failure says so on the
   * button.
   */
  function offerRedo(el, redo) {
    if (!el || typeof redo !== 'function' || el.querySelector('.cdr-step-redo')) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cdr-step-redo';
    b.setAttribute('aria-label', 'Redo: put this change back');
    b.innerHTML = `${svg('redo')}<span>Redo</span>`;
    b.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();   // inside a row that opens on a click: redoing is not looking
      if (b.disabled) return;
      b.disabled = true;
      try {
        await redo(); el.classList.remove('cdr-step--rejected'); el.classList.add('cdr-step--pending');
        b.remove();
      } catch (err) {
        b.disabled = false;
        if (!err || !err.cancelled) { b.title = String((err && err.message) || err); b.querySelector('span').textContent = 'Redo failed'; }
      }
    });
    const actions = el.querySelector('.cdr-step-actions');
    if (actions) actions.after(b); else el.appendChild(b);
    return b;
  }

  window.HCCodeRewind = { commandsAfter, changeCallsAfter, plan, lines, quiet, edit, regenerate, offerRedo };
})();
