// ==============================================================
// The run signal: one line for a HashCoder run
//
// The phases on the rail (js/run-view.js) say what a run did, one phase at a
// time; nothing said the run's shape at a glance. This is one line across
// the top of the reply, drawn from the same record:
//
//   · each phase a wave of its own shape: search pings for Finding, two
//     sines summed for Reading, sharper odd harmonics for Changing, a steady
//     beat for Checking, slow and calm for Reviewing;
//   · each as wide as the time it took (by the square root, so a long one
//     cannot swallow the rest, and none narrower than its name), and as tall
//     as how much it did; the stretches blend into one another;
//   · a mark where the app checked in, where you added a message, and where
//     a step failed;
//   · while the run goes on, a "now" cursor, and after it the newest
//     stretch sliding by transform alone; a finished run settles flat, with
//     a dot at its end.
//
// Pointing at it, a hairline follows, a tip says what was happening there,
// and that phase lights up on the rail. It is drawn again at most once a
// frame when the record changes, never frame by frame, and only in a reply
// whose run is going on, from two phases on.
//
// SHAPES, widths, ampOf, line and whatAt are pure; draw draws.
// Published as window.HCRunSignal. Checked by scripts/checks/run-signal.mjs.
// ==============================================================

(function () {
  'use strict';

  const TAU = Math.PI * 2;
  /** Each phase's wave over one period; every value within ±1.25. */
  const SHAPES = {
    finding: { period: 80, f: (th) => Math.exp(-Math.pow(((((th / TAU) % 1) + 1) % 1) - 0.5, 2) / 0.006) * 1.6 - 0.35 },   // search pings
    reading: { period: 80, f: (th) => (Math.sin(th) + 0.5 * Math.sin(2 * th + 1)) / 1.3 },                               // two sines summed
    changing: { period: 50, f: (th) => (Math.sin(th) + Math.sin(3 * th) / 3 + Math.sin(5 * th) / 5) * 1.05 },            // odd harmonics: sharper
    checking: { period: 40, f: (th) => (Math.sin(th) + Math.sin(3 * th) / 3 + Math.sin(5 * th) / 5 + Math.sin(7 * th) / 7) * 1.2 },   // a steady beat
    reviewing: { period: 200, f: (th) => Math.sin(th) * 0.7 },                                                           // slow and calm
  };
  const shapeOf = (p) => SHAPES[p] || SHAPES.reading;
  /** The band's drawing units: its middle, its half height, the room for the newest stretch, the least width of a stretch. */
  const MID = 20, HGT = 15, HEAD = 72, MIN = 64, BLEND = 18, STEP = 1.25;
  const smooth = (u) => u * u * (3 - 2 * u);

  /** Each stretch's width in `total`: by the square root of its time, none under `min`. */
  function widths(ms, total, min = MIN) {
    const n = ms.length;
    if (!n) return [];
    if (n * min >= total) return ms.map(() => total / n);
    const raw = ms.map((m) => Math.sqrt(Math.max(0, Number(m) || 0)));
    const sum = raw.reduce((a, b) => a + b, 0);
    if (!sum) return ms.map(() => total / n);
    let short = raw.map((r) => r / sum * total < min);
    for (let k = 0; k < n; k++) {   // giving the short their least can make others short in turn
      const room = total - short.filter(Boolean).length * min;
      const rest = raw.filter((r, i) => !short[i]).reduce((a, b) => a + b, 0);
      const next = raw.map((r, i) => short[i] || !rest || r / rest * room < min);
      if (next.every((s, i) => s === short[i])) break;
      short = next;
    }
    const room = total - short.filter(Boolean).length * min;
    const rest = raw.filter((r, i) => !short[i]).reduce((a, b) => a + b, 0);
    return raw.map((r, i) => (short[i] ? min : r / rest * room));
  }

  /** How tall a phase is drawn for how many steps it took: from a little to the whole band. */
  const ampOf = (steps) => 0.35 + 0.65 * (1 - Math.exp(-Math.max(0, Number(steps) || 0) / 5));

  /**
   * The line for `segs` [{ phase, ms, steps, marks [{ kind, at, what }] }] in
   * `W` units: { d, H, starts, widths, marks [{ kind, x, what, seg }], head
   * { d, w } or null }. With `live`, room is left after "now" for the newest
   * stretch; without, the line settles at its end.
   */
  function line(segs, W, { live = false } = {}) {
    const list = Array.isArray(segs) ? segs.filter(Boolean) : [];
    if (!list.length || !(W > 0)) return { d: '', H: 0, starts: [], widths: [], marks: [], head: null };
    const H = live ? Math.max(MIN, W - HEAD) : W;
    const wide = widths(list.map((s) => s.ms), H);
    const starts = wide.reduce((a, w) => (a.push(a[a.length - 1] + w), a), [0]);
    const amps = list.map((s) => ampOf(s.steps));
    const valueAt = (i, x) => amps[i] * shapeOf(list[i].phase).f(TAU * x / shapeOf(list[i].phase).period);
    const pts = [];
    for (let x = 0; x <= H + 0.001; x += STEP) {
      let i = starts.findIndex((st, k) => k < list.length && x < starts[k + 1]);
      if (i < 0) i = list.length - 1;
      let v = valueAt(i, x);
      const toNext = starts[i + 1] - x, fromPrev = x - starts[i];
      if (i < list.length - 1 && toNext < BLEND) v += (valueAt(i + 1, x) - v) * smooth(1 - toNext / BLEND) * 0.5;
      if (i > 0 && fromPrev < BLEND) v = valueAt(i - 1, x) + (v - valueAt(i - 1, x)) * smooth(0.5 + fromPrev / BLEND / 2);
      if (!live && H - x < 40) v *= smooth(Math.max(0, H - x) / 40);   // a finished run settles
      if (live && H - x < 10) v *= Math.max(0, H - x) / 10;            // and meets the cursor at rest
      pts.push(`${x.toFixed(1)} ${(MID - HGT * v).toFixed(2)}`);
    }
    const marks = [];
    list.forEach((s, i) => (Array.isArray(s.marks) ? s.marks : []).forEach((m) => marks.push({ kind: m.kind, what: String(m.what || ''), seg: i, x: starts[i] + Math.min(1, Math.max(0, (Number(m.at) || 0) / Math.max(1, Number(s.steps) || 0))) * wide[i] })));
    let head = null;
    if (live) {
      const last = list[list.length - 1], S = shapeOf(last.phase), amp = amps[amps.length - 1];
      const w = Math.max(1, Math.round(HEAD / S.period)) * S.period, hp = [];
      for (let x = 0; x <= 2 * w + 0.001; x += STEP) hp.push(`${x.toFixed(1)} ${(MID - HGT * amp * S.f(TAU * x / S.period)).toFixed(2)}`);
      head = { d: `M${hp.join(' L')}`, w: 2 * w };
    }
    return { d: `M${pts.join(' L')}`, H, starts, widths: wide, marks, head };
  }

  /** What pointing at `x` says: a mark's words when near one, else its stretch's; and which stretch. */
  function whatAt(L, info, x) {
    if (!L || !L.widths || !L.widths.length) return { text: '', index: -1 };
    const mark = (L.marks || []).find((m) => Math.abs(m.x - x) < 10);
    let i = x >= L.H ? L.widths.length - 1 : L.starts.findIndex((st, k) => k < L.widths.length && x < L.starts[k + 1]);
    if (i < 0) i = L.widths.length - 1;
    return { text: mark ? mark.what : String((info && info[i] && info[i].what) || ''), index: mark ? mark.seg : i };
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  const NS = 'http://www.w3.org/2000/svg';
  const MARKS = {
    checkin: '<path d="M8 1.9 13 3.8v3.6c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6V3.8z"/><path d="m5.8 7.9 1.6 1.6 2.9-3.1"/>',
    added: '<path d="M3.3 3h9.4c.7 0 1.3.6 1.3 1.3v5.6c0 .7-.6 1.3-1.3 1.3H8.2L5 13.6v-2.4H3.3c-.7 0-1.3-.6-1.3-1.3V4.3C2 3.6 2.6 3 3.3 3z"/>',
    failed: '<circle cx="8" cy="8" r="5.6"/><path d="m6 6 4 4M10 6l-4 4"/>',
  };
  const secs = (ms) => (ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
  const svg = (cls, w, d) => { const s = document.createElementNS(NS, 'svg'); if (cls) s.setAttribute('class', cls); s.setAttribute('viewBox', `0 0 ${w.toFixed(1)} 40`); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); return s; };
  const span = (cls, left) => { const e = document.createElement('span'); e.className = cls; if (left != null) e.style.left = `${left.toFixed(1)}px`; return e; };   // placed through the style object: a style attribute is dropped by the app's page rules

  function paint(band) {
    const list = band.hcList || [], live = !!band.hcLive;
    const area = band.querySelector('.cdr-signal-band');
    const W = area.clientWidth || 600;
    const L = line(list, W, { live });
    band.hcLine = L;
    const total = list.reduce((n, s) => n + (Number(s.ms) || 0), 0);
    band.querySelector('.cdr-signal-sum').textContent = `${list.length} phases · ${secs(total)}${live ? ' so far' : ''}`;
    area.setAttribute('aria-label', `The run as one line: ${list.map((s) => `${s.what}, ${secs(s.ms)}`).join('; ')}${live ? '; going on' : '; finished'}`);
    area.replaceChildren();
    area.appendChild(svg('cdr-signal-line', W, L.d));
    if (live && L.head) {
      const head = span('cdr-signal-head', L.H + 2);
      head.style.width = `${Math.max(0, W - L.H - 2).toFixed(1)}px`;
      head.appendChild(svg('', L.head.w, L.head.d));
      area.appendChild(head);
      area.appendChild(span('cdr-signal-now', L.H));
    } else area.appendChild(span('cdr-signal-end', L.H - 3));
    list.forEach((s, i) => { const t = span(`cdr-signal-tag${live && i === list.length - 1 ? ' is-now' : ''}`, L.starts[i]); t.textContent = s.name || s.phase; area.appendChild(t); });
    for (const m of L.marks) {
      const e = span(`cdr-signal-mark is-${m.kind}`, m.x);
      e.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${MARKS[m.kind] || ''}</svg>`;
      area.appendChild(e);
    }
    area.appendChild(span('cdr-signal-hair', 0));
    area.appendChild(span('cdr-signal-tip', 0));
  }

  /** Light the phase at stretch `index` on the rail, or none. */
  function light(band, index) {
    (band.hcList || []).forEach((s, i) => s.head && s.head.classList.toggle('cdr-phase--lit', i === index));
  }

  /**
   * Draw the signal for a reply: `list` its phases as they are now [{ phase,
   * name, what, ms, steps, marks, head }], `live` while its run goes on.
   */
  function draw(contentEl, list, live) {
    if (!contentEl || !Array.isArray(list)) return null;
    if (list.length < 2) return null;
    let band = contentEl.querySelector(':scope > .cdr-signal');
    if (!band) {
      band = document.createElement('section');
      band.className = 'cdr-signal';
      band.innerHTML = '<div class="cdr-signal-h"><span class="cdr-signal-name">Run signal</span><span class="cdr-signal-sum"></span></div><div class="cdr-signal-band" role="img"></div>';
      const after = contentEl.querySelector(':scope > .cdr-brief') || contentEl.querySelector(':scope > .cdr-preview');
      contentEl.insertBefore(band, after ? after.nextSibling : contentEl.firstChild);
      const area = band.querySelector('.cdr-signal-band');
      area.addEventListener('mousemove', (e) => {
        const L = band.hcLine;
        if (!L) return;
        const W = area.clientWidth || 600, x = Math.max(0, Math.min(W, e.clientX - area.getBoundingClientRect().left));
        const at = whatAt(L, band.hcList, x);
        const hair = area.querySelector('.cdr-signal-hair'), tip = area.querySelector('.cdr-signal-tip');
        if (hair) hair.style.transform = `translateX(${x.toFixed(1)}px)`;
        if (tip) { tip.style.left = `${Math.max(90, Math.min(W - 90, x)).toFixed(1)}px`; tip.textContent = at.text; }
        light(band, at.index);
      });
      area.addEventListener('mouseleave', () => light(band, -1));
    }
    band.hcList = list;
    band.hcLive = !!live;
    if (!band.hcQueued) {   // drawn again at most once a frame, and only when the record changed
      band.hcQueued = true;
      const go = () => { band.hcQueued = false; if (band.isConnected) paint(band); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go();
    }
    return band;
  }

  window.HCRunSignal = { SHAPES, MID, HGT, HEAD, MIN, widths, ampOf, line, whatAt, draw };
})();
