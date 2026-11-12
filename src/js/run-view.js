// ==============================================================
// The run view: a HashCoder run's steps grouped into phases
//
// A run of forty steps read as forty lines of the same weight, and the shape
// of the work, finding its way, reading, changing, checking, was lost in
// them. Here each step is given a phase by the app, from what the step is,
// never from what the model says it is doing:
//
//   Finding    looking for where things are (find, search, list) before the
//              run has changed anything
//   Reading    reading files, pages, search results; and looking for where
//              things are once something has changed
//   Changing   writing, editing, deleting or moving a file, or a command
//              that is not a check
//   Checking   a command that tests, lints, checks types or builds
//   Reviewing  a second look at the changes; the app's own check-ins are
//              rows of their own in the phase they happen in
//
// When the phase changes, a header goes onto the rail before the step: the
// phase's drawn mark, its name, one line of what it did ("6 files", "2 edits,
// 1 command", "1 command, 1 failed") and its time. The phase that has ended
// folds its steps away to that line, and opens again from it; a change
// waiting for Keep or Undo is never folded away. The phase in work carries a
// turning mark, which moves only while the run goes on.
//
// The brief, at the top of the reply while it works, holds a request of
// several asks (js/code/asks.js), each with a drawn mark for its state:
//
//   open       no step has served it yet
//   in work    a step names a word it says, in a path, a name or a command,
//              never words as common as "file" or "change"
//   answered   what the agent said as it finished says it, by the run
//              record's own test (js/run-ledger.js answeredBy)
//
// and a plus for an ask you added while it worked. Pointing at an ask, or
// reaching it by keyboard, lights the steps that served it. The brief stays
// in view while the reply scrolls, and folds to its count. With fewer than
// three asks there is no brief: the request is shown whole just above.
//
// The receipt goes under the answer in place of the line in italics. Each
// row is written from a record, never from the model's own account, and
// is shown only when it has something to say: Asked (from the brief),
// Changed (the files the run changed and the change rows: lines added and
// taken out, what is kept, undone and still to decide, with Keep all and
// Undo all), Proven or Not proven, tested, checked (js/code/verify.js
// proofParts), Page read, and the app's other lines under an answer: Not
// confirmed, Taken out, Other sites, Not from a run, Left. Undo all goes
// newest first, one change at a time, and stops at the first not undone.
// A saved answer keeps its rows without the controls and the count of
// decisions, and draws them again when the conversation is opened.
//
// Phases and the brief are drawn only in a reply whose run is going on,
// never in a saved conversation drawn again. phaseOf, line, servedBy,
// askMarks, briefCount, receipt and saved are pure; place, stepDone, brief,
// end, receiptIn and drawReceipt draw.
// Published as window.HCRunView. Checked by scripts/checks/run-view.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The phases, in the order a run goes through them. */
  const PHASES = ['finding', 'reading', 'changing', 'checking', 'reviewing'];
  const NAMES = { finding: 'Finding', reading: 'Reading', changing: 'Changing', checking: 'Checking', reviewing: 'Reviewing' };
  /** Each phase's mark: a 16-unit grid, drawn on currentColor. */
  const ICONS = {
    finding: '<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>',
    reading: '<path d="M4 2.5h5.2L12 5.3v8.2H4z"/><path d="M9 2.5v3h3M6.2 8.5h3.6M6.2 11h3.6"/>',
    changing: '<path d="M10.6 2.9a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L6 12.5l-3 .7.7-3z"/><path d="m9.4 4.1 2.5 2.5"/>',
    checking: '<path d="M6.2 2.5h3.6M6.8 2.5v3.8L3.3 12.2a.9.9 0 0 0 .8 1.3h7.8a.9.9 0 0 0 .8-1.3L9.2 6.3V2.5"/><path d="M4.9 9.6h6.2"/>',
    reviewing: '<path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/>',
  };
  /** The mark of the phase in work: two thin brackets that turn. */
  const RETICLE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.6A13.4 13.4 0 0 1 28.6 11.4"/><path d="M16 29.4A13.4 13.4 0 0 1 3.4 20.6"/><path d="M29.2 16h-2M2.8 16h2"/></svg>';

  const FINDS = new Set(['FIND', 'GREP', 'LIST']);
  const READS = new Set(['READ', 'FETCH', 'SEARCH', 'KB', 'PHOTOS', 'RECALL']);
  const CHANGES = new Set(['EDIT', 'WROTE', 'DELETE', 'MOVE', 'IMAGES']);
  const REVIEWS = new Set(['REVIEW']);   // the app's check-ins (CHECK) are rows of their own in the phase they happen in
  const CHECKS = new Set(['test', 'lint', 'typecheck', 'build']);

  /** The phase of a step, or null for one that belongs to none (a plan, a lesson) and stays in the phase it is in. */
  function phaseOf(verb, object, changedYet) {
    const v = String(verb || '').toUpperCase();
    if (FINDS.has(v)) return changedYet ? 'reading' : 'finding';
    if (READS.has(v)) return 'reading';
    if (CHANGES.has(v)) return 'changing';
    if (REVIEWS.has(v)) return 'reviewing';
    if (v === 'SHELL') {
      const V = typeof window !== 'undefined' && window.HCCodeVerify;
      const kind = V && typeof V.commandKind === 'function' ? V.commandKind(String(object || ''), []) : null;
      return CHECKS.has(kind) ? 'checking' : 'changing';
    }
    return null;
  }

  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;

  /** What a phase did, in one line: "6 files", "2 edits, 1 command", "1 command, 1 failed"; '' for nothing yet. */
  function line(phase, steps) {
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) return '';
    const failed = list.filter((s) => s && s.failed).length;
    const tail = failed ? `, ${failed} failed` : '';
    if (phase === 'finding') return many(list.length, 'search', 'searches') + tail;
    if (phase === 'reading') {
      const files = new Set(list.filter((s) => s.verb === 'READ').map((s) => String(s.object)));
      const other = list.filter((s) => s.verb !== 'READ').length;
      return [files.size ? many(files.size, 'file', 'files') : '', other ? many(other, 'other read', 'other reads') : ''].filter(Boolean).join(', ') + tail;
    }
    if (phase === 'changing') {
      const edits = list.filter((s) => s.verb !== 'SHELL').length, commands = list.length - edits;
      return [edits ? many(edits, 'edit', 'edits') : '', commands ? many(commands, 'command', 'commands') : ''].filter(Boolean).join(', ') + tail;
    }
    if (phase === 'checking') return many(list.length, 'command', 'commands') + tail;
    return many(list.length, 'check', 'checks') + tail;
  }

  // ── The brief: the request's asks, each with its state ────────────────

  /** Words too common to say a step served an ask. */
  const PLAIN = new Set(['with', 'that', 'this', 'from', 'into', 'have', 'will', 'your', 'what', 'when', 'where', 'which', 'also', 'just', 'please', 'make', 'sure', 'each', 'every', 'some', 'more', 'only', 'very', 'should', 'would', 'could', 'want', 'need', 'like', 'them', 'they', 'there', 'then', 'than', 'does', 'done', 'keep', 'about', 'again', 'still', 'other', 'same', 'file', 'files', 'code', 'page', 'change', 'changes', 'work', 'thing', 'things']);
  /** The app's own rows, which serve no ask. */
  const NOT_WORK = new Set(['CHECK', 'PLAN', 'LESSON']);
  const stem = (w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const wordsIn = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !PLAIN.has(w)).map(stem);
  const flat = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  /** The steps (their indexes in `steps`, from `since` on) that served an ask: each names a word the ask says. */
  function servedBy(ask, steps, since = 0) {
    const want = new Set(wordsIn(ask));
    const out = [];
    (Array.isArray(steps) ? steps : []).forEach((s, i) => {
      if (i >= since && s && !NOT_WORK.has(String(s.verb || '').toUpperCase()) && wordsIn(s.object).some((w) => want.has(w))) out.push(i);
    });
    return out;
  }

  /**
   * Each ask with its state: open, working (a step served it) or answered
   * (what was said as it finished says it); `added` when it is not in the
   * request the run began with; `why` in plain words. `since[i]` is the
   * first step ask i can have been served by: an ask you added counts only
   * the steps after it was read.
   */
  function askMarks(asks, { first = '', said = '', steps = [], since = [] } = {}) {
    const L = typeof window !== 'undefined' && window.HCRunLedger;
    const was = flat(first);
    const all = Array.isArray(steps) ? steps : [];
    return (Array.isArray(asks) ? asks : []).map((text, i) => {
      const served = servedBy(text, all, Number(since[i]) || 0);
      const answered = !!(said && L && typeof L.answeredBy === 'function' && L.answeredBy(text, said));
      const state = answered ? 'answered' : served.length ? 'working' : 'open';
      const added = !!was && !was.includes(flat(text));
      const files = new Set(served.map((j) => all[j]).filter((s) => CHANGES.has(String(s.verb || '').toUpperCase())).map((s) => String(s.object))).size;
      const how = state === 'answered' ? (files ? `answered · ${many(files, 'file', 'files')}` : 'answered') : state === 'working' ? `in work · ${many(served.length, 'step', 'steps')}` : '';
      return { n: i + 1, text: String(text), state, added, served, why: [added ? 'you added' : '', how].filter(Boolean).join(' · ') };
    });
  }

  /** "2 of 4 answered". */
  const briefCount = (marks) => `${(marks || []).filter((m) => m.state === 'answered').length} of ${(marks || []).length} answered`;

  // ── The receipt: what the records show, a row only when it has something ──

  const PROOF_LABELS = { passed: 'Proven', failed: 'Not proven', untested: 'Not tested', none: 'Not checked' };

  /**
   * The receipt's rows: { from, label, tone ''|good|attention, text, soft,
   * plus, minus, controls }. `p`: marks (askMarks), changes [{ added,
   * removed, state pending|accepted|rejected }], files (the paths the run
   * changed), proof (verify.js proofParts), and the app's lines facts, gone,
   * outside, claim, said, passed, left.
   */
  function receipt(p = {}) {
    const rows = [];
    const marks = Array.isArray(p.marks) ? p.marks : [];
    if (marks.length) {
      const open = marks.filter((m) => m.state !== 'answered');
      rows.push({ from: 'asks', label: 'Asked', tone: open.length ? '' : 'good', text: briefCount(marks), soft: open.length ? `${open.length} not confirmed: “${open[0].text.charAt(0).toUpperCase()}${open[0].text.slice(1)}”${open.length > 1 ? ` and ${open.length - 1} more` : ''}` : '' });
    }
    const ch = Array.isArray(p.changes) ? p.changes : [];
    const files = new Set((Array.isArray(p.files) ? p.files : []).map(String)).size;
    if (files || ch.length) {
      const count = (s) => ch.filter((c) => c.state === s).length;
      const kept = count('accepted'), undone = count('rejected'), left = count('pending');
      rows.push({
        from: 'changes', label: 'Changed', tone: '', text: many(files || ch.length, 'file', 'files'),
        plus: ch.reduce((n, c) => n + (Number(c.added) || 0), 0), minus: ch.reduce((n, c) => n + (Number(c.removed) || 0), 0),
        soft: [kept ? `${kept} kept` : '', undone ? `${undone} undone` : '', left ? `${left} to decide` : ''].filter(Boolean).join(' · '),
        controls: left ? 'decide' : '',
      });
    }
    const pr = p.proof && p.proof.proof, seen = p.proof && p.proof.seen;
    if (pr && PROOF_LABELS[pr.kind]) rows.push({ from: 'proof', label: PROOF_LABELS[pr.kind], tone: pr.kind === 'passed' ? 'good' : 'attention', text: String(pr.what || '') });
    if (seen) rows.push({ from: 'site', label: 'Page read', tone: seen.found ? 'attention' : '', text: `${seen.found ? `${many(seen.found, 'thing', 'things')} still found to fix` : 'nothing found to fix'} · not seen on screen` });
    const look = (from, label, text) => { if (text) rows.push({ from, label, tone: 'attention', text: String(text) }); };
    look('facts', 'Not confirmed', p.facts);
    look('keep', 'Taken out', p.gone);
    look('outside', 'Other sites', p.outside);
    look('claims', 'Not from a run', [p.claim, p.said, p.passed].filter(Boolean).join(' '));
    look('plan', 'Left', p.left);
    return rows;
  }

  /** The rows kept with a saved answer: no controls, and no count of decisions, which would go stale. */
  const saved = (rows) => (rows || []).map((r) => Object.assign({}, r, { controls: '' }, r.from === 'changes' ? { soft: '' } : {}));

  /** Each row's mark: a 16-unit grid, drawn on currentColor. */
  const RECEIPT_ICONS = {
    asks: '<path d="m2.4 4.4 1.2 1.2 2-2.2M7.8 4.6h5.8M2.4 10.4l1.2 1.2 2-2.2M7.8 10.6h5.8"/>',
    changes: ICONS.changing,
    proof: '<path d="M8 1.9 13 3.8v3.6c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6V3.8z"/><path d="m5.8 7.9 1.6 1.6 2.9-3.1"/>',
    site: '<path d="M1.8 8s2.3-4.3 6.2-4.3c1.4 0 2.6.5 3.6 1.2M14.2 8s-2.3 4.3-6.2 4.3c-1.4 0-2.6-.5-3.6-1.2"/><path d="m2.5 13.5 11-11"/>',
    facts: '<circle cx="8" cy="8" r="5.6"/><path d="M6.4 6.4a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1v.3M8 11.2v.2"/>',
    keep: '<circle cx="8" cy="8" r="5.6"/><path d="M5.4 8h5.2"/>',
    outside: '<circle cx="8" cy="8" r="5.6"/><path d="M2.4 8h11.2M8 2.4c1.6 1.6 2.3 3.6 2.3 5.6S9.6 12 8 13.6C6.4 12 5.7 10 5.7 8S6.4 4 8 2.4z"/>',
    claims: '<circle cx="8" cy="8" r="5.6"/><path d="M6.4 6.4a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1v.3M8 11.2v.2"/>',
    plan: '<path d="M3.5 14V2.5"/><path d="M3.5 3h8.2l-1.7 2.6 1.7 2.6H3.5"/>',
  };

  /** Words with `code` in backticks, drawn as text: nothing in them is read as markup. */
  function wordsInto(el, text) {
    el.textContent = '';
    String(text || '').split(/(`[^`]+`)/).forEach((piece) => {
      if (!piece) return;
      if (/^`[^`]+`$/.test(piece)) el.appendChild(Object.assign(document.createElement('code'), { textContent: piece.slice(1, -1) }));
      else el.appendChild(document.createTextNode(piece));
    });
  }

  /** One row's value: its words, lines added and taken out, and its quieter part. */
  function fillRow(row, r) {
    const cls = `cdr-receipt-row${r.tone ? ` is-${r.tone}` : ''}`;
    if (row.className !== cls) row.className = cls;
    const v = row.querySelector('.cdr-receipt-text');
    wordsInto(v, r.text);
    if (r.plus || r.minus) v.insertAdjacentHTML('beforeend', ` <span class="cdr-receipt-soft">·</span> <span class="cdr-plus">+${Number(r.plus) || 0}</span> <span class="cdr-minus">\u2212${Number(r.minus) || 0}</span>`);
    if (r.soft) { const s = document.createElement('span'); s.className = 'cdr-receipt-soft'; s.textContent = ` · ${r.soft}`; v.appendChild(s); }
    const ctl = row.querySelector('.cdr-receipt-ctl');
    if (ctl) ctl.hidden = r.controls !== 'decide';
  }

  /** Draw rows under the answer in `contentEl`; with `live`, the Changed row has Keep all and Undo all. Returns the box, or null for no rows. */
  function drawReceipt(contentEl, rows, live = false) {
    if (!contentEl || !Array.isArray(rows) || !rows.length) return null;
    const box = document.createElement('section');
    box.className = 'cdr-receipt';
    box.setAttribute('aria-label', 'What the app\'s record shows');
    for (const r of rows) {
      const row = document.createElement('div');
      row.dataset.from = r.from;
      row.innerHTML = `<span class="cdr-receipt-mark" aria-hidden="true"><svg viewBox="0 0 16 16">${RECEIPT_ICONS[r.from] || ''}</svg></span><span class="cdr-receipt-label"></span><span class="cdr-receipt-text"></span>` +
        (live && r.from === 'changes' ? '<span class="cdr-receipt-ctl"><span class="cdr-step-actions" role="group" aria-label="Every change in this reply"><button type="button" class="cdr-step-btn keep">Keep all</button><button type="button" class="cdr-step-btn undo">Undo all</button></span></span>' : '');
      row.querySelector('.cdr-receipt-label').textContent = r.label;
      fillRow(row, r);
      box.appendChild(row);
    }
    contentEl.appendChild(box);
    return box;
  }

  /** The change rows in a reply, as the receipt counts them. */
  const changesIn = (contentEl) => [...contentEl.querySelectorAll('.cdr-step--change')].map((el) => ({
    added: Number((el.querySelector('.cdr-plus')?.textContent || '').replace(/[^0-9]/g, '')) || 0,
    removed: Number((el.querySelector('.cdr-minus')?.textContent || '').replace(/[^0-9]/g, '')) || 0,
    state: el.classList.contains('cdr-step--accepted') ? 'accepted' : el.classList.contains('cdr-step--rejected') ? 'rejected' : 'pending',
  }));

  /** Keep every change in the reply still waiting. */
  function keepAll(contentEl) {
    for (const el of contentEl.querySelectorAll('.cdr-step--change.cdr-step--pending')) el.querySelector('.cdr-step-btn.keep')?.click();
  }

  /** Undo every change in the reply still waiting, newest first, one at a time; stop at the first not undone (refused, failed, or answered no). */
  async function undoAll(contentEl) {
    for (const el of [...contentEl.querySelectorAll('.cdr-step--change.cdr-step--pending')].reverse()) {
      const b = el.querySelector('.cdr-step-btn.undo');
      if (!b || b.disabled) continue;   // this change cannot be undone; the rest still can
      await new Promise((done) => {
        const over = () => !el.classList.contains('cdr-step--pending') || !b.disabled;
        const watch = new MutationObserver(() => { if (over()) { watch.disconnect(); done(); } });
        watch.observe(el, { attributes: true, subtree: true, attributeFilter: ['class', 'disabled'] });
        b.click();
      });
      if (el.classList.contains('cdr-step--pending')) break;
    }
  }

  /** The receipt for a run that just answered: the parts the loop hands over, with the asks and the change rows of this reply. Returns the rows to keep with the answer, or null. */
  function receiptIn(contentEl, parts) {
    if (!contentEl) return null;
    const st = contentEl.hcPhases, code = window.HC && window.HC.code;
    const most = (window.HCCodeAsks && window.HCCodeAsks.MIN_ASKS) || 3;
    const marks = st && code && Array.isArray(code.asks) && code.asks.length >= most ? askMarks(code.asks, { first: code.firstRequest, said: code.said, steps: st.all, since: st.since || [] }) : [];
    const rows = receipt(Object.assign({}, parts, { marks, changes: changesIn(contentEl) }));
    const box = drawReceipt(contentEl, rows, true);
    if (!box) return null;
    const row = box.querySelector('[data-from="changes"]');
    if (row) {
      const keep = row.querySelector('.cdr-step-btn.keep'), undo = row.querySelector('.cdr-step-btn.undo');
      keep.addEventListener('click', () => keepAll(contentEl));
      undo.addEventListener('click', async () => { undo.disabled = keep.disabled = true; try { await undoAll(contentEl); } finally { undo.disabled = keep.disabled = false; } });
      // A change kept or undone, here or on its own row, is counted again; the changed rows' classes are all that is watched.
      // Only a change row's own class is read: the receipt's own redrawing never wakes it again.
      new MutationObserver((seen) => { if (seen.some((m) => m.target.classList && m.target.classList.contains('cdr-step--change'))) fillRow(row, receipt(Object.assign({}, parts, { changes: changesIn(contentEl) })).find((r) => r.from === 'changes') || rows.find((r) => r.from === 'changes')); })
        .observe(contentEl, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    return saved(rows);
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  let seq = 0;
  const byId = new Map();   // a phase's id -> { phase, head, steps, began }

  const timeOf = (ms) => (window.HCCodeSteps && window.HCCodeSteps.duration ? window.HCCodeSteps.duration(ms) : `${Math.round(ms)} ms`);

  function paint(ph) {
    ph.head.querySelector('.cdr-phase-line').textContent = line(ph.phase, ph.steps.filter((s) => !s.el || s.el.isConnected));   // a tool row replaced by its change row counts once
  }

  /** Fold or open a phase's steps; a change waiting for Keep or Undo, or a step still running, is never folded away. */
  function fold(ph, folded) {
    ph.head.classList.toggle('open', !folded);
    ph.head.querySelector('.cdr-phase-h').setAttribute('aria-expanded', String(!folded));
    for (const step of ph.steps) {
      const s = step.el;
      if (!s || s.classList.contains('cdr-step--running')) continue;
      if (!s.classList.contains('cdr-step--change')) s.classList.toggle('cdr-step--folded', folded);
    }
  }

  function close(ph) {
    if (!ph || ph.closed) return;
    ph.closed = true;
    ph.head.classList.remove('now');
    ph.head.classList.add('closed');
    ph.head.querySelector('.cdr-phase-time').textContent = timeOf(Date.now() - ph.began);
    fold(ph, true);
  }

  function open(list, phase, before) {
    const id = `ph${++seq}`;
    const head = document.createElement('div');
    head.className = `cdr-phase now cdr-phase--${phase}`;
    head.dataset.phaseHead = id;
    head.innerHTML = `<span class="cdr-phase-badge" aria-hidden="true"><svg viewBox="0 0 16 16">${ICONS[phase]}</svg></span>` +
      `<span class="cdr-reticle">${RETICLE}</span>` +
      `<button type="button" class="cdr-phase-h" aria-expanded="true"><span class="cdr-phase-name">${NAMES[phase]}</span><span class="cdr-phase-line"></span><span class="cdr-phase-time">now</span></button>`;
    list.insertBefore(head, before);
    const ph = { id, phase, head, steps: [], began: Date.now(), closed: false };
    head.querySelector('.cdr-phase-h').addEventListener('click', () => fold(ph, head.classList.contains('open')));
    byId.set(id, ph);
    return ph;
  }

  /** Each ask's mark: a ring, a half-filled ring, a filled ring with a tick, and a ring with a plus for one you added. */
  const MARKS = {
    open: '<circle cx="8" cy="8" r="5.25"/>',
    added: '<circle cx="8" cy="8" r="5.25"/><path d="M8 5.6v4.8M5.6 8h4.8"/>',
    working: '<circle cx="8" cy="8" r="5.25"/><path class="cdr-ask-fill" d="M8 2.75a5.25 5.25 0 0 1 0 10.5z"/>',
    answered: '<circle class="cdr-ask-fill" cx="8" cy="8" r="5.25"/><path class="cdr-ask-cut" d="m5.7 8.1 1.6 1.6 3-3.2"/>',
  };
  const SAYS = { open: 'not started', working: 'in work', answered: 'answered' };

  /** Light the steps that served an ask, and the phase heads they are folded under; none for null. */
  function light(st, served) {
    const on = new Set((served || []).map((i) => st.all[i] && st.all[i].el).filter(Boolean));
    const heads = new Set([...on].map((el) => el.dataset && el.dataset.phase).filter(Boolean));
    for (const s of st.all) if (s.el) s.el.classList.toggle('cdr-step--served', on.has(s.el));
    for (const ph of byId.values()) ph.head.classList.toggle('cdr-phase--served', heads.has(ph.id));
  }

  /** Draw the brief at the top of a reply whose run is going on, or bring it up to date. */
  function brief(contentEl) {
    const st = contentEl && contentEl.hcPhases;
    const code = typeof window !== 'undefined' && window.HC && window.HC.code;
    const most = (window.HCCodeAsks && window.HCCodeAsks.MIN_ASKS) || 3;
    if (!st || !code || !Array.isArray(code.asks) || code.asks.length < most) return null;
    st.since = st.since || [];
    const was = flat(code.firstRequest);
    code.asks.forEach((a, i) => { if (st.since[i] == null) st.since[i] = was && !was.includes(flat(a)) ? st.all.length : 0; });   // an ask you added counts the steps after it was read
    const marks = askMarks(code.asks, { first: code.firstRequest, said: code.said, steps: st.all, since: st.since });
    let box = st.brief;
    if (!box || !box.isConnected) {
      box = st.brief = document.createElement('section');
      box.className = 'cdr-brief';
      box.setAttribute('aria-label', 'Your request, ask by ask');
      box.innerHTML = '<button type="button" class="cdr-brief-h" aria-expanded="true"><span class="cdr-brief-name">Your request</span><span class="cdr-brief-count"></span></button><ol class="cdr-asks"></ol>';
      const h = box.querySelector('.cdr-brief-h');
      h.addEventListener('click', () => { const folded = box.classList.toggle('folded'); h.setAttribute('aria-expanded', String(!folded)); });
      const top = contentEl.querySelector(':scope > .cdr-preview');   // under the card shown before it started (js/code/preview.js), or first
      contentEl.insertBefore(box, top ? top.nextSibling : contentEl.firstChild);
    }
    box.querySelector('.cdr-brief-count').textContent = briefCount(marks);
    const list = box.querySelector('.cdr-asks');
    marks.forEach((m, i) => {
      let li = list.children[i];
      if (!li) {
        li = document.createElement('li');
        li.innerHTML = '<button type="button" class="cdr-ask-b"><span class="cdr-ask-mark" aria-hidden="true"><svg viewBox="0 0 16 16"></svg></span><span class="cdr-ask-text"></span><span class="cdr-ask-why"></span></button>';
        const b = li.querySelector('button');
        const on = () => light(st, li.hcServed), off = () => light(st, null);
        b.addEventListener('mouseenter', on); b.addEventListener('focus', on);
        b.addEventListener('mouseleave', off); b.addEventListener('blur', off);
        list.appendChild(li);
      }
      li.hcServed = m.served;
      li.className = `cdr-ask is-${m.state}${m.added ? ' is-added' : ''}`;
      li.querySelector('svg').innerHTML = MARKS[m.added && m.state === 'open' ? 'added' : m.state];
      li.querySelector('.cdr-ask-text').textContent = m.text;
      li.querySelector('.cdr-ask-why').textContent = m.why;
      li.querySelector('button').setAttribute('aria-label', `Ask ${m.n}, ${SAYS[m.state]}${m.added ? ', you added it' : ''}: ${m.text}`);
    });
    return box;
  }

  /** A step just drawn into `list`: it joins the phase in work, or begins the next. */
  function place(contentEl, list, el, verb, object) {
    if (!contentEl || !contentEl.closest('.cdr-msg.running')) return null;
    if (!list || !el) return null;
    const st = contentEl.hcPhases || (contentEl.hcPhases = { cur: null, changed: false, all: [], brief: null });
    st.all.push({ verb: String(verb || '').toUpperCase(), object: String(object || ''), el });
    const phase = phaseOf(verb, object, st.changed) || (st.cur && st.cur.phase) || 'reading';
    if (phase === 'changing') st.changed = true;
    if (!st.cur || st.cur.phase !== phase) {
      close(st.cur);
      st.cur = open(list, phase, el);
    }
    el.dataset.phase = st.cur.id;
    st.cur.steps.push({ verb: String(verb || '').toUpperCase(), object: String(object || ''), failed: false, el });
    paint(st.cur);
    brief(contentEl);
    window.HCCodePreview?.onStep(contentEl, phase);   // the card before it started: its plan up to date, folded at the first change (js/code/preview.js)
    return st.cur.id;
  }

  /** A step has ended: whether it failed goes into its phase's line. */
  function stepDone(el, ok) {
    const ph = el && el.dataset && byId.get(el.dataset.phase);
    if (!ph) return;
    const step = ph.steps.find((s) => s.el === el);
    if (step) step.failed = !ok;
    paint(ph);
  }

  /** The run has ended: the brief takes what was said last, its last phase closes, and nothing turns. */
  function end(contentEl) {
    const st = contentEl && contentEl.hcPhases;
    if (!st) return;
    brief(contentEl);
    window.HCCodePreview?.onStep(contentEl, 'end');
    close(st.cur);
    contentEl.hcPhases = null;
  }

  window.HCRunView = { PHASES, NAMES, ICONS, phaseOf, line, servedBy, askMarks, briefCount, receipt, saved, place, stepDone, brief, end, receiptIn, drawReceipt };
})();
