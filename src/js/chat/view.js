// ==============================================================
// A chat agent's thinking view, drawn
//
// Draws the record js/chat/view-model.js keeps on a reply, in two places
// beside the reply's own bubble, which the chat rewrites while it streams:
//
//   · the head, above it, while the agent works: the journey (the kinds of
//     step it took, lit as reached), the thinking line (one sentence of
//     what it does now, with its mark), the map (the question's parts, its
//     searches and pages, a line where what it read gives a part's words,
//     a tick when the answer covers it), and a preview of each source;
//   · the foot, below it, once it is done: the parts at a glance, how much
//     came from what it read, the sources numbered, what is not confirmed,
//     and "Show how", which opens the head again;
//   · numbered chips placed in the answer after the sentences a source backs.
//
// A live head is updated step by step: what is new is added and fades in,
// what is there stays. Only fades, short slides and lines drawing; the
// station in work breathes, and the clock counts, only while the run goes
// on. Every mark is drawn here, on a 16-unit grid, on currentColor.
//
// stationsOf, sayText, linksOf and footRows are pure; the rest draws.
// Published as window.HCChatView. Checked by scripts/checks/chat-view.mjs.
// ==============================================================
(function () {
  'use strict';

  const ICONS = {
    understand: '<path d="M3 4.6A2.6 2.6 0 0 1 5.6 2h4.8A2.6 2.6 0 0 1 13 4.6v3.8A2.6 2.6 0 0 1 10.4 11H8.2L5 13.6V11A2 2 0 0 1 3 9z"/><path d="M6.8 5.4a1.3 1.3 0 1 1 1.8 1.2c-.4.2-.6.5-.6.9M8 8.7v.1"/>',
    search: '<circle cx="7" cy="7" r="4.4"/><path d="m10.3 10.3 3.4 3.4M5.2 7h3.6"/>',
    read: '<path d="M4 1.8h5.2l3.3 3.3v9.1H4z"/><path d="M9 1.8v3.4h3.5M6 8.2h4.4M6 10.6h3"/>',
    work: '<path d="m5.4 4.6-3 3.4 3 3.4M10.6 4.6l3 3.4-3 3.4M9 3.2 7 12.8"/>',
    memory: '<path d="M4.4 2.2h7.2v11.6L8 11.2l-3.6 2.6z"/>',
    write: '<path d="M10.7 2.3 13.7 5.3 6.1 12.9 2.4 13.6 3.1 9.9z"/><path d="m9.2 3.8 3 3M2.4 13.6h4"/>',
    check: '<path d="M8 1.9 13 3.8v3.6c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6V3.8z"/><path d="m5.8 7.9 1.6 1.6 2.9-3.1"/>',
    done: '<circle cx="8" cy="8" r="5.8"/><path d="m5.6 8.2 1.7 1.7 3.2-3.4"/>',
    clock: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.9v3.3l2.1 1.3"/>',
    globe: '<circle cx="8" cy="8" r="5.6"/><path d="M2.4 8h11.2M8 2.4c1.6 1.6 2.3 3.6 2.3 5.6S9.6 12 8 13.6C6.4 12 5.7 10 5.7 8S6.4 4 8 2.4z"/>',
    unsure: '<circle cx="8" cy="8" r="5.8"/><path d="M6.4 6.4a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1v.3M8 11.2v.2"/>',
    glance: '<path d="M2.4 4.4h2.2M2.4 8h2.2M2.4 11.6h2.2"/><path d="M6.8 4.4h6.8M6.8 8h6.8M6.8 11.6h4.4"/>',
    ground: '<path d="M8 1.9 13 3.8v3.6c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6V3.8z"/><path d="M5.4 8h5.2"/>',
    down: '<path d="m3.5 6 4.5 4.5L12.5 6"/>',
    ring: '<circle cx="8" cy="8" r="5.6"/><path class="cv-tick" d="m5.6 8.2 1.7 1.7 3.2-3.4"/>',
  };
  const NAMES = { understand: 'Understand', search: 'Search', read: 'Read', work: 'Work out', memory: 'Memory', write: 'Write', check: 'Check' };
  const icon = (k, cls = 'cv-i') => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[k] || ''}</svg>`;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const frame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  /** The stations the journey draws: understanding, those reached, then writing, and checking once it happened. */
  function stationsOf(m) {
    const reached = (m && Array.isArray(m.stations) ? m.stations : []).filter((s) => NAMES[s]);
    const middle = reached.filter((s) => s !== 'understand' && s !== 'write' && s !== 'check');
    return ['understand', ...middle, 'write', ...(reached.includes('check') ? ['check'] : [])];
  }

  /** The sentence as HTML: the parts it names in a strong weight, everything escaped. */
  const sayText = (m) => (m && Array.isArray(m.say) ? m.say.map((p) => (typeof p === 'string' ? esc(p) : `<b>${esc(p && p.b)}</b>`)).join('') : '');

  /** The map's lines: each part to each source that served it, as [part, source] pairs. */
  const linksOf = (m) => (m && Array.isArray(m.parts) ? m.parts.flatMap((p, i) => (Array.isArray(p.by) ? p.by.map((s) => [i, s]) : [])) : []);

  /** The foot's rows, for a reply that is done: which there are, in order. */
  function footRows(m) {
    if (!m || !m.done) return [];
    const rows = [];
    if (Array.isArray(m.glance) && m.glance.length >= 2) rows.push('glance');
    if (m.grounding && m.grounding.total) rows.push('grounding');
    if (Array.isArray(m.sources) && m.sources.some((s) => s.n)) rows.push('sources');
    if (Array.isArray(m.caution) && m.caution.length) rows.push('caution');
    if (m.stations && m.stations.length > 1) rows.push('how');
    return rows;
  }

  const took = (ms) => (Number.isFinite(ms) ? (ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`) : '');
  const thumb = '<svg class="cv-thumb" viewBox="0 0 52 64" aria-hidden="true"><rect x="1" y="1" width="50" height="62" rx="6"/><rect class="cv-thumb-bar" x="1.6" y="1.6" width="48.8" height="10" rx="5"/><path d="M7 6.6h2M11.5 6.6h2M16 6.6h2" class="cv-dots"/><path d="M8 20h28M8 26h36M8 32h22"/><path class="cv-hl" d="M8 38h32M8 44h26"/><path d="M8 50h30M8 56h18"/></svg>';

  /** A new, empty head for a reply. */
  function head() {
    const el = document.createElement('div');
    el.className = 'cv-head';
    el.innerHTML = `<ol class="cv-journey" aria-label="Steps"><i class="cv-fill"></i></ol>
      <div class="cv-think" aria-live="polite"><span class="cv-glyph"></span><span class="cv-say"></span><span class="cv-clock"></span></div>
      <div class="cv-work"><div class="cv-map" hidden><div class="cv-map-h"><span>Your question</span><span class="cv-meter"><span class="cv-track"><i></i></span><span class="cv-count"></span></span></div><svg class="cv-links" aria-hidden="true"></svg><div class="cv-cols"><div class="cv-parts"></div><div class="cv-srcs"></div></div></div><div class="cv-reads"></div></div>`;
    return el;
  }

  /** Bring a head up to date with the record: what is new is added, and fades in when `live`. */
  function update(el, m, { live = false } = {}) {
    if (!el || !m) return el;
    const show = (n) => { if (live) frame(() => n.classList.add('on')); else n.classList.add('on'); };
    // The journey.
    const j = el.querySelector('.cv-journey'), stations = stationsOf(m);
    stations.forEach((k) => {
      if (j.querySelector(`[data-k="${k}"]`)) return;
      const li = document.createElement('li');
      li.className = 'cv-st'; li.dataset.k = k;
      li.innerHTML = `<span class="cv-disc">${icon(k)}</span><span class="cv-st-name">${NAMES[k]}</span>`;
      const after = [...j.querySelectorAll('.cv-st')].find((x) => stations.indexOf(x.dataset.k) > stations.indexOf(k));
      j.insertBefore(li, after || null);
      show(li);
    });
    const at = m.done ? stations.length : stations.indexOf(m.now);
    j.querySelectorAll('.cv-st').forEach((li, i) => { li.classList.toggle('past', i < at); li.classList.toggle('now', i === at && !m.done); });
    j.style.setProperty('--cv-done', String(stations.length > 1 ? Math.min(1, Math.max(0, at) / (stations.length - 1)) : 0));
    // The thinking line.
    const glyphKey = m.done ? 'done' : (NAMES[m.now] ? m.now : 'understand');
    const g = el.querySelector('.cv-glyph');
    if (g.dataset.k !== glyphKey) { g.dataset.k = glyphKey; g.innerHTML = icon(glyphKey); }
    const say = el.querySelector('.cv-say'), html = sayText(m);
    if (say.dataset.text !== html) {
      say.dataset.text = html;
      const old = say.lastElementChild, n = document.createElement('span');
      n.innerHTML = html;
      if (live && old) { n.className = 'in'; say.appendChild(n); frame(() => { n.className = ''; old.className = 'out'; }); setTimeout(() => old.remove(), 500); } else { say.innerHTML = ''; say.appendChild(n); }
    }
    // The map, when the question has parts.
    const map = el.querySelector('.cv-map');
    map.hidden = !(m.parts && m.parts.length);
    if (!map.hidden) {
      const parts = map.querySelector('.cv-parts');
      m.parts.forEach((p, i) => {
        let row = parts.querySelector(`[data-i="${i}"]`);
        if (!row) { row = document.createElement('div'); row.className = 'cv-node cv-part'; row.dataset.i = String(i); row.innerHTML = `${icon('ring', 'cv-i cv-ring')}<span class="cv-label">${esc(p.text)}</span>`; parts.appendChild(row); show(row); }
        row.classList.toggle('found', !!p.found);
      });
      const srcs = map.querySelector('.cv-srcs');
      m.sources.forEach((s, i) => {
        if (srcs.querySelector(`[data-i="${i}"]`)) return;
        const row = document.createElement('div');
        row.className = 'cv-node cv-src'; row.dataset.i = String(i);
        row.innerHTML = `<span class="cv-badge">${icon(s.kind === 'page' ? 'read' : 'search')}</span><span class="cv-what">${esc(s.label)}</span>`;
        srcs.appendChild(row); show(row);
      });
      const found = m.parts.filter((p) => p.found).length;
      map.querySelector('.cv-count').textContent = `${found} of ${m.parts.length}`;
      map.querySelector('.cv-track i').style.width = `${(found / m.parts.length) * 100}%`;
      if (map.isConnected) draw(map, m, live);
    }
    // A preview of each source.
    const reads = el.querySelector('.cv-reads');
    m.sources.forEach((s, i) => {
      if (reads.querySelector(`[data-i="${i}"]`) || !(s.excerpt || s.title)) return;
      const card = document.createElement('article');
      card.className = 'cv-card'; card.dataset.i = String(i);
      card.innerHTML = `${thumb}<div class="cv-card-t"><div class="cv-site">${icon('globe')}<span>${esc(s.site || s.label)}</span></div><h4>${esc(s.title || s.label)}</h4><p>${esc(s.excerpt)}</p></div>`;
      reads.appendChild(card); show(card);
    });
    reads.querySelectorAll('.cv-card').forEach((c) => c.classList.toggle('lit', m.parts.some((p) => (p.by || []).includes(Number(c.dataset.i)))));
    // The clock, only while it works.
    const clock = el.querySelector('.cv-clock');
    clearInterval(el._cvTimer); el._cvTimer = null;
    if (live && !m.done) {
      const tickOnce = () => { clock.innerHTML = `${icon('clock')}<span>${took(Date.now() - m.startedAt)}</span>`; };
      tickOnce(); el._cvTimer = setInterval(() => { if (!el.isConnected) { clearInterval(el._cvTimer); return; } tickOnce(); }, 250);
    } else clock.innerHTML = m.done && m.took != null ? `${icon('clock')}<span>${took(m.took)}</span>` : '';
    el.classList.toggle('cv-live', live && !m.done);
    el.classList.toggle('cv-done', !!m.done);
    return el;
  }

  /** The map's lines, drawn where its rows are; a line not drawn before draws itself. */
  function draw(map, m, live) {
    const svg = map.querySelector('.cv-links'), box = map.getBoundingClientRect();
    if (!box.width) return;
    const seen = new Set();
    for (const [pi, si] of linksOf(m)) {
      const key = `${pi}-${si}`, a = map.querySelector(`.cv-part[data-i="${pi}"] .cv-label`), b = map.querySelector(`.cv-src[data-i="${si}"] .cv-badge`);
      if (!a || !b) continue;
      seen.add(key);
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.right - box.left + 12, y1 = ra.top - box.top + ra.height / 2, x2 = rb.left - box.left - 8, y2 = rb.top - box.top + rb.height / 2, mid = (x1 + x2) / 2;
      let p = svg.querySelector(`[data-k="${key}"]`);
      const fresh = !p;
      if (fresh) { p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.dataset.k = key; svg.appendChild(p); }
      p.setAttribute('d', `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
      if (fresh && live) { const len = p.getTotalLength(); p.style.strokeDasharray = String(len); p.style.strokeDashoffset = String(len); frame(() => { p.style.strokeDashoffset = '0'; }); }
    }
    svg.querySelectorAll('path').forEach((p) => { if (!seen.has(p.dataset.k)) p.remove(); });
  }

  /** The foot of a reply that is done, or null. */
  function foot(m) {
    const rows = footRows(m);
    if (!rows.length) return null;
    const el = document.createElement('div');
    el.className = 'cv-foot';
    const chip = (n) => (n == null ? '' : `<button type="button" class="cv-chip${n === '?' ? ' warn' : ''}" data-n="${esc(n)}" aria-label="${n === '?' ? 'Not confirmed' : `Source ${esc(n)}`}">${esc(n)}</button>`);
    const parts = [];
    if (rows.includes('glance')) {
      const found = m.parts.filter((p) => p.found).length;
      parts.push(`<section class="cv-panel" aria-label="At a glance"><div class="cv-panel-h">${icon('glance')}At a glance<span class="cv-meta">${found} of ${m.parts.length} answered</span></div>${m.glance.map((g) => `<div class="cv-g">${icon('done')}<span class="cv-g-part">${esc(g.part)}</span><span class="cv-g-val">${esc(g.answer)}</span>${chip(g.n)}</div>`).join('')}</section>`);
    }
    if (rows.includes('grounding')) {
      const { sourced, total } = m.grounding;
      parts.push(`<div class="cv-ground"><span class="cv-ground-l">${icon('ground')}Grounding</span><span class="cv-segs" aria-hidden="true">${Array.from({ length: Math.min(total, 12) }, (_, i) => `<i class="${i < Math.round((sourced / total) * Math.min(total, 12)) ? '' : 'none'}"></i>`).join('')}</span><span>${sourced} of ${total} ${total === 1 ? 'sentence comes' : 'sentences come'} from what it read</span></div>`);
    }
    if (rows.includes('sources')) {
      parts.push(`<div class="cv-sources">${m.sources.filter((s) => s.n).sort((a, b) => a.n - b.n).map((s) => `<div class="cv-source" data-n="${s.n}" tabindex="0"><span class="cv-num">${s.n}</span><svg class="cv-thumb cv-thumb-s" viewBox="0 0 34 42" aria-hidden="true"><rect x="1" y="1" width="32" height="40" rx="4"/><rect class="cv-thumb-bar" x="1.5" y="1.5" width="31" height="7" rx="3.5"/><path d="M6 15h20M6 20h22M6 25h14M6 30h18"/></svg><span class="cv-source-t"><span class="cv-site">${icon('globe')}<span>${esc(s.site || s.label)}</span></span><span class="cv-title">${esc(s.title || s.label)}</span></span></div>`).join('')}</div>`);
    }
    if (rows.includes('caution')) parts.push(`<div class="cv-caution">${icon('unsure')}<span><b>Check before relying on it</b> · not in anything it read: ${m.caution.map(esc).join(', ')}.</span></div>`);
    if (rows.includes('how')) parts.push(`<div class="cv-actions"><button type="button" class="cv-how" aria-expanded="false">${icon('down')}<span>Show how</span></button></div>`);
    el.innerHTML = parts.join('');
    return el;
  }

  /**
   * Numbered chips after the answer's sentences a source backs, each located
   * by its sentence's last words in the text as read, whatever bold or code
   * marks split it, and searched for after the one before. The chip and the
   * word before it are kept on one line.
   */
  function chips(body, m) {
    if (!body || !m || !Array.isArray(m.chips)) return 0;
    const NF = window.NodeFilter;
    let placed = 0, from = 0;
    for (const c of m.chips) {
      const walker = document.createTreeWalker(body, NF.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('pre, .cv-chip') ? NF.FILTER_REJECT : NF.FILTER_ACCEPT) });
      const nodes = [];
      let text = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, at: text.length }); text += n.nodeValue; }
      const at = text.indexOf(c.tail, from);
      if (at < 0 || !c.tail) continue;
      const stop = at + c.tail.length;
      const last = nodes.filter((x) => x.at < stop).pop();
      if (!last) continue;
      const node = last.n, off = stop - last.at;
      const rest = node.splitText(off);
      const ws = node.nodeValue.search(/\S+$/);
      const word = ws > 0 ? node.splitText(ws) : node;
      const keep = document.createElement('span');
      keep.className = 'cv-keep';
      rest.parentNode.insertBefore(keep, rest);
      keep.appendChild(word);
      const b = document.createElement('button');
      b.type = 'button'; b.className = `cv-chip${c.warn ? ' warn' : ''}`; b.dataset.n = String(c.n); b.textContent = String(c.n);
      b.setAttribute('aria-label', c.warn ? 'Not confirmed' : `Source ${c.n}`);
      keep.appendChild(b);
      from = stop;
      placed++;
    }
    return placed;
  }

  // ── The chat's side: its records in, a reply's view out ─────────────

  /** One event the chat records for a reply (recordAgentEvent), applied to its record: tool calls and results, and the app's check-ins once each. */
  function apply(view, type, label, data) {
    const VM = window.HCChatViewModel;
    if (!view || !VM || view.done) return false;
    if (type === 'tool_call') VM.toolCall(view, label, data);
    else if (type === 'tool_result') VM.toolResult(view, label, data);
    else if ((type === 'thinking' || type === 'warn') && /^Sent back:/.test(String(label || ''))) { if (view.checks[view.checks.length - 1] === label) return false; VM.check(view, label); }
    else return false;
    return true;
  }

  /** The live head of the reply being written, in the last reply on screen. */
  function liveHead(assistant) {
    if (typeof document === 'undefined') return null;
    const wrap = document.querySelector('#messages .msg.assistant:last-of-type');
    if (!wrap) return null;
    if (!assistant._cvHead) assistant._cvHead = head();
    const bubble = wrap.querySelector('.bubble');
    if (assistant._cvHead.parentNode !== wrap && bubble) wrap.insertBefore(assistant._cvHead, bubble);
    return assistant._cvHead;
  }

  /** The chat recorded an event for a reply: its record, and its live head. */
  function note(assistant, type, label, data) {
    if (!assistant || !assistant.view) return;
    if (type !== 'start' && !apply(assistant.view, type, label, data)) return;
    const h = liveHead(assistant);
    if (h) update(h, assistant.view, { live: true });
  }

  /** The answer has begun to arrive. */
  function writing(assistant) {
    const VM = window.HCChatViewModel;
    if (!assistant || !assistant.view || !VM || assistant.view.done) return;
    VM.writing(assistant.view);
    const h = liveHead(assistant);
    if (h) update(h, assistant.view, { live: true });
  }

  /** The run is done: the record finished from the answer and what the checks found (viewFacts). */
  function finish(assistant) {
    const VM = window.HCChatViewModel;
    if (!assistant || !assistant.view || !VM || assistant.view.done) return;
    const f = assistant.viewFacts || {};
    VM.finish(assistant.view, String(assistant.content || ''), { unsourced: f.unsourced || [], checked: !!f.checked, ended: Date.now() });
    if (assistant._cvHead) update(assistant._cvHead, assistant.view, { live: false });
  }

  /** A reply drawn: its head before its bubble (the live one while it is written) and its foot after, once done. */
  function mount(wrap, bubble, m) {
    if (!wrap || !bubble || !m || !m.view) return;
    const h = m._cvHead || update(head(), m.view, { live: false });
    if (!m.view.done) m._cvHead = h;
    wrap.insertBefore(h, bubble);
    const f = foot(m.view);
    if (f) bubble.after(f);
  }

  // A chip lights its sentence's chips and its source, within its reply; "Show how" opens the head again.
  if (typeof document !== 'undefined') {
    const light = (e, on) => {
      const c = e.target.closest && e.target.closest('.cv-chip, .cv-source');
      const msg = c && c.closest('.msg');
      if (!msg) return;
      msg.querySelectorAll(`[data-n="${CSS.escape(c.dataset.n)}"]`).forEach((x) => x.classList.toggle('hot', on));
    };
    document.addEventListener('mouseover', (e) => light(e, true));
    document.addEventListener('mouseout', (e) => light(e, false));
    document.addEventListener('focusin', (e) => light(e, true));
    document.addEventListener('focusout', (e) => light(e, false));
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.cv-how');
      if (!b) return;
      const h = b.closest('.msg') && b.closest('.msg').querySelector('.cv-head');
      if (!h) return;
      const open = h.classList.toggle('open');
      b.setAttribute('aria-expanded', String(open));
      b.querySelector('span').textContent = open ? 'Hide how' : 'Show how';
    });
  }

  window.HCChatView = { ICONS, NAMES, stationsOf, sayText, linksOf, footRows, head, update, foot, chips, apply, note, writing, finish, mount };
})();
