// ==============================================================
// What a chat agent's thinking view shows, from its own steps
//
// A chat agent's reply is drawn with a view of its work while it runs and
// a presentation once it is done (js/chat/view.js). Everything that view
// shows is kept here, as plain data on the reply, written by the app from
// the steps the agent took, never from the model's account of itself:
//
//   · the sentence for the step in work ("Searching the web for ...",
//     "Reading <site>"), with the part it names set apart;
//   · the journey's stations, in the order they were reached;
//   · the parts of a question of several asks (js/code/asks.js), each
//     served once something it read gives its words (by: which sources),
//     and answered once
//     the answer does (js/chat/finish.js covers);
//   · the sources: each search and each page read, with a short preview;
//   · once the answer is in: which of its sentences each source backs,
//     numbered in the order first cited, a sentence holding a detail
//     nothing read gives marked instead; each part at a glance with the
//     sentence that answers it; how many sentences came from what was
//     read; what is not confirmed. What the sources were matched on is
//     dropped then, so the reply keeps only what it shows.
//
// Pure. Published as window.HCChatViewModel. Checked by
// scripts/checks/chat-view-model.mjs.
// ==============================================================
(function () {
  'use strict';

  const SEARCHES = { web_search: 'Web search', wikipedia: 'Wikipedia', pubmed_search: 'PubMed' };
  const STATION = { web_search: 'search', wikipedia: 'search', pubmed_search: 'search', fetch_url: 'read', execute_python: 'work', calculate: 'work', current_datetime: 'work', remember_fact: 'memory', recall_facts: 'memory' };
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const EXCERPT = 240;
  const MATCH = 6000;

  const cut = (t, most) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s; };
  /** A page's site from its address: read by pattern, so it holds where no URL object is (a check's sandbox). */
  const hostOf = (url) => ((/^[a-z][a-z0-9+.-]*:\/\/(?:www\.)?([^/?#:\s]+)/i.exec(String(url || '')) || [])[1] || '').toLowerCase();
  const reach = (m, station) => { if (!m.stations.includes(station)) m.stations.push(station); m.now = station; };
  const covers = (text, ask) => { const F = window.HCChatFinish; return !!(F && F.covers && F.covers(text, ask)); };

  /** The view's record at the start of a reply to `request`, begun at `now`. */
  function start(request, now = Date.now()) {
    const A = window.HCCodeAsks;
    const asks = A && A.split ? A.split(String(request || '')) : [];
    const parts = (Array.isArray(asks) ? asks : []).map((a) => ({ text: String(a).trim().replace(/[?.!]+$/, ''), served: false, found: false, by: [] }));
    return {
      v: 1, startedAt: now, done: false, took: null,
      now: 'understand', stations: ['understand'],
      say: parts.length ? ['Reading your question: ', { b: `${WORDS[parts.length] || parts.length} things` }, ' to find out'] : ['Reading your question'],
      parts, sources: [], checks: [], chips: [], glance: [], grounding: null, caution: [],
      pending: null,
    };
  }

  /** A tool the agent called: the sentence for it, and the station it reaches. */
  function toolCall(m, name, args) {
    const a = args || {};
    const q = cut(a.query || a.q || '', 80);
    const say = name === 'web_search' ? ['Searching the web for ', { b: q }]
      : name === 'wikipedia' ? ['Looking up ', { b: q }, ' on Wikipedia']
      : name === 'pubmed_search' ? ['Searching PubMed for ', { b: q }]
      : name === 'fetch_url' ? ['Reading ', { b: hostOf(a.url) || 'a page' }]
      : name === 'execute_python' ? ['Working it out in Python']
      : name === 'calculate' ? ['Calculating']
      : name === 'current_datetime' ? ['Checking the date and time']
      : name === 'remember_fact' ? ['Saving to memory']
      : name === 'recall_facts' ? ['Recalling what you told it before']
      : ['Using ', { b: String(name || 'a tool') }];
    m.say = say;
    m.pending = { name: String(name || ''), query: q, url: String(a.url || '') };
    reach(m, STATION[name] || 'work');
    return m;
  }

  /** What a tool returned. A search or a page read is a source, with a preview; the parts whose words it gives are served. */
  function toolResult(m, name, data) {
    const p = m.pending && m.pending.name === name ? m.pending : { name, query: '', url: '' };
    m.pending = null;
    if (!data || typeof data !== 'object' || typeof data.error === 'string') return m;
    let source = null;
    if (SEARCHES[name]) {
      const list = Array.isArray(data.results) ? data.results : Array.isArray(data.papers) ? data.papers : [];
      const top = list[0] || {};
      const text = list.map((r) => [r.title, r.snippet || r.abstract].filter(Boolean).join('. ')).join('\n');
      if (!text.trim()) return m;
      source = { kind: 'search', label: `${SEARCHES[name]}${p.query ? ` · ${p.query}` : ''}`, site: hostOf(top.url), title: cut(top.title, 90), excerpt: cut(top.snippet || top.abstract, EXCERPT), text: text.slice(0, MATCH) };
    } else if (name === 'fetch_url' && typeof data.text === 'string' && data.text.trim()) {
      const site = hostOf(data.url || p.url);
      source = { kind: 'page', label: site, site, title: cut(data.text.split(/(?<=[.!?])\s|\s-\s/)[0], 90), excerpt: cut(data.text, EXCERPT), text: data.text.slice(0, MATCH) };
    }
    if (source) {
      m.sources.push(source);
      const at = m.sources.length - 1;
      for (const part of m.parts) if (covers(source.text, part.text)) { part.served = true; part.by = [...(part.by || []), at]; }
    }
    return m;
  }

  /** The app checking in on the answer before it is shown (js/chat/finish.js). */
  function check(m, text) {
    m.checks.push(String(text || ''));
    m.say = ['Checking the answer: ', String(text || '').replace(/^Sent back:\s*/i, '')];
    reach(m, 'check');
    return m;
  }

  /** The answer being written. */
  function writing(m) {
    m.say = ['Writing the answer'];
    reach(m, 'write');
    return m;
  }

  /** The words of a line a reader sees: no bold, italic or code marks, no list or quote marker. */
  const plainOf = (line) => String(line || '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:[>#*+-]+|\d+[.)])\s+/, '').trim();
  /** Whether a line says anything once its links and paper numbers are taken out. */
  const saysSomething = (line) => line.replace(/https?:\/\/\S+/g, '').replace(/\b(?:PMID|PMC|doi|arXiv)\s*:?\s*\S+/gi, '').split(/\s+/).filter((w) => /[\p{L}]{2,}/u.test(w)).length >= 3;

  /**
   * An answer's sentences, outside its code blocks: a table row is its first
   * cell, the claim; a header, a divider (no words) and a line of only links
   * or paper numbers are not sentences.
   */
  function sentencesOf(answer) {
    const H = window.HCFences;
    const prose = H && H.splitFences ? H.splitFences(String(answer || '')).filter((x) => x.type !== 'code').map((x) => x.text).join('\n') : String(answer || '');
    const out = [];
    let inTable = false;   // the first row of a table is its header
    for (const raw of prose.split(/\n+/)) {
      if (/^\s*\|/.test(raw)) {
        const first = plainOf(raw.split('|').map((c) => c.trim()).filter(Boolean)[0] || '');
        if (inTable && first.split(/\s+/).length >= 3) out.push(first);
        inTable = true;
        continue;
      }
      inTable = false;
      for (const s of plainOf(raw).split(/(?<=[.!?])\s+/)) if (s.trim() && s.trim().split(/\s+/).length >= 3 && saysSomething(s)) out.push(s.trim());
    }
    return out;
  }

  // A figure: an amount, a measurement, a share, a date's number, a time.
  // A count under this is not one: "3 floors" reads the same as "three".
  const SMALL = 13;
  const MOST_FIGURES = 6;
  const NUMBER = /(?<![\p{L}\p{N}.,:/_])(?<!\p{L}-)([$£€¥₹])?(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(\.\d+)?(:\d{2})?(?![\p{N}]|[.,]\d)(\s?%|\s?°\s?[CF]\b|\s?[\p{L}/]+)?/gu;
  /** A run that may be a phone number: one starting +, ( or 0, or of three groups or more, is (js/code/facts.js holds it whole). */
  const PHONE = /[+(]?\d[\d().\s-]{5,}\d/g;
  const UNITS = new Set(['m', 'metre', 'metres', 'meter', 'meters', 'km', 'kilometres', 'kilometers', 'cm', 'mm', 'ft', 'feet', 'foot', 'in', 'inches', 'mi', 'miles', 'mile', 'kg', 'g', 'mg', 'lb', 'lbs', 'pounds', 'tonnes', 'tons', 'l', 'litres', 'liters', 'ml', 'percent', 'per', 'mph', 'km/h', 'kmh', 'hz', 'mhz', 'ghz', 'kb', 'mb', 'gb', 'tb', 'kw', 'mw', 'gw', 'kwh', 'w', 'v', 'mmhg', 'bpm', 'kcal', 'calories', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years', 'storeys', 'stories', 'people', 'million', 'billion', 'trillion', 'thousand']);
  /** Each figure in a text: its value, whatever its thousands are written with, and how it is shown, with its currency and unit. */
  function figuresIn(text) {
    const out = [];
    for (const f of String(text || '').matchAll(NUMBER)) {
      const [, cur, whole, dec, time, tail] = f;
      const n = whole.replace(/,/g, '');
      const frac = dec ? dec.replace(/0+$/, '').replace(/^\.$/, '') : '';
      const unit = tail && (/%|°/.test(tail) || UNITS.has(tail.trim().toLowerCase())) ? tail : '';
      const plain = !cur && !dec && !time && !/%/.test(unit);
      if (plain && Number(n) < SMALL) continue;
      out.push({ value: `${Number(n)}${frac}${time || ''}`, shown: `${cur || ''}${whole}${dec || ''}${time || ''}${unit}`.trim() });
    }
    return out;
  }
  /**
   * The figures of an answer that nothing in `evidence` (what the person gave
   * and the agent read) holds, as shown: outside code, links and paper
   * numbers, each once, the first few.
   */
  function figuresUnread(answer, evidence) {
    const H = window.HCFences;
    const all = String(answer || '');
    const prose = (H && H.splitFences ? H.splitFences(all).filter((x) => x.type !== 'code').map((x) => x.text).join('\n') : all)
      .replace(/`[^`\n]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(PHONE, (p) => (/^[+(0]/.test(p) || (p.match(/\d[\s.-]+(?=\d)/g) || []).length >= 2 ? ' ' : p)).replace(/\b(?:PMID|PMC|doi|arXiv)\s*:?\s*\S+/gi, ' ')
      .split('\n').map((line) => line.replace(/^\s*(?:[>#*+-]+\s+)?\d+[.)]\s+/, '')).join('\n');
    const have = new Set(figuresIn(evidence).map((f) => f.value));
    const out = [];
    for (const f of figuresIn(prose)) {
      if (have.has(f.value) || out.some((x) => x.value === f.value)) continue;
      out.push(f);
      if (out.length >= MOST_FIGURES) break;
    }
    return out.map((f) => f.shown);
  }

  /**
   * The part of a sentence that answers an ask: of its clauses (split at a
   * comma, a semicolon, "and", "but"), the one holding most of the ask's
   * words, when it is a few words long; else the sentence.
   */
  function glanceOf(sentence, ask) {
    const F = window.HCChatFinish, s = String(sentence || '').trim();
    const keys = String(ask || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
    const clauses = s.split(/,\s+|;\s+|\s+and\s+|\s+but\s+/i).map((c) => c.trim().replace(/[.!?]+$/, '')).filter(Boolean);
    if (clauses.length < 2 || !keys.length) return s;
    const hits = (c) => { const w = c.toLowerCase().split(/[^\p{L}\p{N}]+/u); return keys.filter((k) => w.some((x) => x.startsWith(k))).length; };
    const best = clauses.reduce((a, c) => (hits(c) > hits(a) ? c : a), clauses[0]);
    return hits(best) && best.split(/\s+/).length >= 3 && !(F && F.covers && !F.covers(best, ask)) ? best : s;
  }

  /**
   * The answer is in. `o`: unsourced (the details nothing read gives, as
   * js/code/facts.js lists them), ended (when), checked (the answer went
   * through the finishing checks).
   */
  function finish(m, answer, o = {}) {
    const unsourced = (Array.isArray(o.unsourced) ? o.unsourced : []).map((u) => String((u && u.shown) || u || '')).filter(Boolean);
    let next = 1;
    m.chips = [];
    const chipOf = new Map();
    const sentences = sentencesOf(answer);
    for (const s of sentences) {
      const words = s.split(/\s+/);
      const tail = words.slice(-4).join(' ');
      if (unsourced.some((d) => s.includes(d))) { m.chips.push({ tail, n: '?', warn: true }); continue; }
      const source = m.sources.find((src) => src.text && covers(src.text, s));
      if (!source) continue;
      if (!source.n) source.n = next++;
      m.chips.push({ tail, n: source.n, warn: false });
      chipOf.set(s, source.n);
    }
    for (const part of m.parts) part.found = covers(String(answer || ''), part.text);
    m.glance = m.parts.map((part) => {
      const s = sentences.find((x) => covers(x, part.text));
      return { part: part.text, answer: s ? cut(glanceOf(s, part.text), 120) : '', n: s && chipOf.has(s) ? chipOf.get(s) : null };
    }).filter((g) => g.answer);
    m.grounding = m.sources.length && sentences.length ? { sourced: m.chips.filter((c) => !c.warn).length, total: sentences.length } : null;
    m.caution = unsourced;
    for (const s of m.sources) delete s.text;
    m.pending = null;
    m.done = true;
    m.took = Number.isFinite(o.ended) ? Math.max(0, o.ended - m.startedAt) : m.took;
    m.now = 'done';
    m.say = m.sources.length && o.checked ? ['Answered · checked against what it read'] : ['Answered'];
    return m;
  }

  window.HCChatViewModel = { start, toolCall, toolResult, check, writing, finish, sentencesOf, glanceOf, figuresUnread };
})();
