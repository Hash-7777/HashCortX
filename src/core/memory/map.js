// ==============================================================
// The memory map
//
// What the app remembers, drawn. Two layouts, and the difference between them
// is the point of this file.
//
// BY MEANING is the real one. Every fact is turned into 384 numbers by the
// model compiled into the binary (src-tauri/src/commands/embed.rs), and those
// numbers decide where it sits: facts that mean the same thing land near each
// other whatever their keys are called. Lines join each fact to its nearest
// relatives, groups form from the pairs that chose each other, and a group is
// named after the keys actually in it. The maths is in src/js/vector-map.js,
// pure and checked; this file is the picture and the pointer handling.
//
// BY KEY is the old radial diagram, kept. It groups on the text before the
// first underscore, which is a diagram of the key names rather than of the
// memory — but it is tidy, it needs no model, and it is what the map falls back
// to when the model is not there. Positions in it are arbitrary, so dragging
// them about costs nothing.
//
// WHAT THE MAP MUST NOT DO IS FLATTER ITSELF. Two hundred and forty facts
// placed by meaning and eight facts that all say roughly the same thing produce
// pictures that look equally convincing, and a projection from 384 dimensions
// down to 2 always throws most of the detail away. So the legend states which
// layout is live, what share of the spread the flat picture keeps, and when the
// facts are too alike for their positions to mean anything at all. A map that
// quietly stops being true is worse than no map.
//
// Split out of core/settings/memory-pane.js, which keeps the list of facts.
// Loaded before app.js and published as window.HCMemoryMap.
// ==============================================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => window.HCMarkdown.escapeHtml(s);

  // Injected by memory-pane.js. Everything here either owns its state, reads a
  // window.HC* module, or is in this list — nothing reaches into app.js.
  let deps = {
    DEFAULT_PROJECT_ID: 'project_personal',
    currentProject: () => null,
    state: {},
    themedConfirm: async () => false,
    themedPrompt: async () => null,
    fmtRelative: (ts) => new Date(ts).toLocaleDateString(),
    onFactsChanged: () => {},
  };

  // ── What is remembered between openings ─────────────────────────────────
  // The view and the hand-placed positions, per layout. Positions in the two
  // layouts are not the same kind of thing, so they are not stored together:
  // moving a node in the key layout tidies a diagram, and moving one in the
  // meaning layout overrides where its meaning put it.
  const VIEW_KEY = 'hashui_memmap_view_v1';
  const POS_KEY = 'hashui_memmap_pos_v1';               // the key layout's, unchanged
  const POS_MEANING_KEY = 'hashui_memmap_pos_meaning_v1';
  const LAYOUT_KEY = 'hashui_memmap_layout_v1';

  const readJSON = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function layoutNow() {
    return readJSON(LAYOUT_KEY, 'meaning') === 'keys' ? 'keys' : 'meaning';
  }
  const posKeyFor = (layout) => (layout === 'meaning' ? POS_MEANING_KEY : POS_KEY);

  // ── Vectors ─────────────────────────────────────────────────────────────
  // Kept for the life of the window, keyed by fact id AND by the text that was
  // embedded. Editing a fact changes its meaning, so a cache keyed on the id
  // alone would keep drawing the old one where the old one used to be.
  const _vectors = new Map();
  let _modelReady = null;

  /** The text a fact is embedded as. The key is part of the meaning, so it goes
   *  in — with its underscores opened out, because `cat_name` is one token to a
   *  tokeniser and two words to a reader. */
  function textOf(fact) {
    return `${String(fact.key || '').replace(/[_-]+/g, ' ')}: ${String(fact.value || '')}`;
  }

  /** Whether the built-in model can place facts by meaning. Asked once. */
  async function modelAvailable() {
    if (_modelReady !== null) return _modelReady;
    if (!window.HC?.isTauri) { _modelReady = false; return _modelReady; }
    try {
      _modelReady = (await HC.invoke('embed_available')) === true;
    } catch {
      _modelReady = false;
    }
    return _modelReady;
  }

  /** Vectors for these facts, embedding only the ones not already held. */
  async function vectorsFor(facts) {
    const missing = facts.filter((f) => _vectors.get(f.id)?.text !== textOf(f));
    if (missing.length) {
      const texts = missing.map(textOf);
      const vecs = await HC.invoke('embed_texts', { texts, kind: 'passage' });
      if (!Array.isArray(vecs) || vecs.length !== missing.length) return null;
      missing.forEach((f, i) => _vectors.set(f.id, { text: texts[i], vec: vecs[i] }));
    }
    const out = facts.map((f) => _vectors.get(f.id)?.vec);
    return out.every(Array.isArray) ? out : null;
  }

  // ── The facts this project may see ──────────────────────────────────────
  function visibleFacts() {
    const { memLoad } = window.HCMemoryStore;
    const projectOnly = deps.currentProject()?.memoryMode === 'project';
    return memLoad().filter((f) => {
      const pid = f.projectId || deps.DEFAULT_PROJECT_ID;
      return projectOnly
        ? pid === deps.state.currentProjectId
        : (pid === deps.DEFAULT_PROJECT_ID || pid === deps.state.currentProjectId);
    });
  }

  const VIEW_W = 1200;
  const VIEW_H = 800;

  // Live state for the drawn map. Rebuilt by draw(); read by the toolbar.
  let _map = null;
  // One token per draw. draw() awaits the model, and a second draw started
  // while the first is waiting would otherwise paint over it in whichever order
  // the two happened to finish.
  let _drawToken = 0;

  // ── Node geometry ───────────────────────────────────────────────────────
  const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // Above this many facts, they are drawn as dots and read by hovering.
  //
  // A labelled box is about 166 by 56 once its gap is counted, and the canvas
  // is 1200 by 800 — room for a hundred, and a wall of unreadable text long
  // before that. The store holds up to 500. Drawing all of them as boxes is
  // both illegible and slow: they cannot be separated, so the relaxation pass
  // spends a second failing to do it. Dots separate easily and a dot admits
  // what it is, which a label overlapping four other labels does not.
  const LABEL_LIMIT = 60;

  function factBox(fact, dense) {
    if (dense) return { key: '', val: '', w: 13, h: 13, dot: true };
    const key = trim(String(fact.key || ''), 18);
    const val = trim(String(fact.value || ''), 24);
    return {
      key,
      val,
      w: Math.max(112, Math.min(178, Math.max(key.length, val.length) * 5.8 + 26)),
      h: 40,
    };
  }

  // ── Layout: by meaning ──────────────────────────────────────────────────
  function meaningLayout(facts, vectors) {
    const V = window.HCVectorMap;
    const { points, kept, degenerate } = V.project(vectors);
    const edges = V.neighbourLinks(vectors, { perNode: 2 });
    const groups = V.groupsFromLinks(facts.length, edges);
    const dense = facts.length > LABEL_LIMIT;
    const boxes = facts.map((f) => factBox(f, dense));
    // Labelled boxes need more passes to come apart than dots do — measured, at
    // sixty facts they are still overlapping after 120 and clear after 300. Dots
    // separate almost at once, and there can be five hundred of them, so they
    // are the case that has to stay cheap.
    const placed = V.spread(V.toBox(points, { width: VIEW_W, height: VIEW_H, pad: 110 }), boxes, {
      iterations: dense ? 120 : 300,
      gap: 16,
    });

    const nodes = facts.map((f, i) => ({
      id: 'fact:' + f.id,
      type: 'fact',
      x: placed[i].x,
      y: placed[i].y,
      w: boxes[i].w,
      h: boxes[i].h,
      label: boxes[i].key,
      sub: boxes[i].val,
      dot: boxes[i].dot,
      fact: f,
      group: groups[i],
      index: i,
    }));

    // A caption per group that has more than one fact in it. A caption over a
    // single node would just repeat its key.
    const captions = [];
    const byGroup = new Map();
    facts.forEach((f, i) => {
      if (!byGroup.has(groups[i])) byGroup.set(groups[i], []);
      byGroup.get(groups[i]).push(i);
    });
    // At five hundred facts there are dozens of groups, and a caption over each
    // is a second wall of text on top of the one the dots were meant to avoid.
    // So when the facts are dots, only the substantial groups are named, and
    // only the largest few of those.
    const minMembers = dense ? 4 : 2;
    for (const [group, members] of byGroup) {
      if (members.length < minMembers) continue;
      const label = V.groupLabel(members.map((i) => facts[i].key));
      if (!label) continue;
      const cx = members.reduce((s, i) => s + nodes[i].x, 0) / members.length;
      const top = Math.min(...members.map((i) => nodes[i].y - nodes[i].h / 2));
      captions.push({ group, label: label.toUpperCase(), count: members.length, x: cx, y: top - 22 });
    }
    captions.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (dense) captions.length = Math.min(captions.length, 8);

    return { nodes, links: edges, captions, kept, degenerate, dense };
  }

  // ── Layout: by key ──────────────────────────────────────────────────────
  // The original radial diagram. Categories are the text before the first
  // underscore, with a few single-word keys mapped to a theme by hand.
  function categoryOf(key) {
    const k = String(key || '').toLowerCase();
    const i = k.indexOf('_');
    if (i > 0) return k.slice(0, i);
    if (/^(name|age|birthday|location|origin|languages|allergies)$/.test(k)) return 'identity';
    if (/^(likes|dislikes|preferred|favorite|favourite)$/.test(k)) return 'preferences';
    if (/^(employer|role|job|career)$/.test(k)) return 'work';
    return 'other';
  }

  function keyLayout(facts) {
    const dense = facts.length > LABEL_LIMIT;
    const cats = new Map();
    for (const f of facts) {
      const c = categoryOf(f.key);
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c).push(f);
    }
    const catList = [...cats.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    const innerR = 180, outerR = 330;
    const nodes = [{
      id: '_centre', type: 'centre', x: cx, y: cy, w: 110, h: 110,
      label: 'YOU', sub: `${facts.length} fact${facts.length === 1 ? '' : 's'}`,
    }];
    const links = [];
    catList.forEach(([cat, items], ci) => {
      const angle = (ci / catList.length) * Math.PI * 2 - Math.PI / 2;
      const label = cat.toUpperCase();
      const catIndex = nodes.length;
      nodes.push({
        id: 'cat:' + cat, type: 'cat',
        x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR,
        w: Math.max(96, label.length * 8 + 36), h: 32,
        label, count: items.length, parent: 0,
      });
      links.push({ a: 0, b: catIndex, kind: 'cat' });
      const arcSpan = Math.min((Math.PI * 2) / catList.length * 0.95, 1.3);
      items.forEach((f, fi) => {
        const t = items.length === 1 ? 0 : (fi / (items.length - 1)) - 0.5;
        const fa = angle + t * arcSpan;
        const box = factBox(f, dense);
        links.push({ a: catIndex, b: nodes.length, kind: 'fact' });
        nodes.push({
          id: 'fact:' + f.id, type: 'fact',
          x: cx + Math.cos(fa) * outerR, y: cy + Math.sin(fa) * outerR,
          w: box.w, h: box.h, label: box.key, sub: box.val, dot: box.dot, fact: f, parent: catIndex,
        });
      });
    });
    nodes.forEach((n, i) => { n.index = i; });

    // The ring spreads a category's facts along an arc, which piles them on top
    // of each other as soon as a category holds more than three — five facts
    // under IDENTITY drew as one unreadable stack, and have done since the map
    // was written. The same relaxation the meaning layout uses fixes it. Only
    // the fact boxes take part: the centre and the category pills are the
    // structure of the diagram and stay where they are put.
    const factNodes = nodes.filter((n) => n.type === 'fact');
    const relaxed = window.HCVectorMap.spread(factNodes, factNodes, { iterations: dense ? 120 : 300, gap: 14 });
    factNodes.forEach((n, i) => { n.x = relaxed[i].x; n.y = relaxed[i].y; });

    return { nodes, links, captions: [], kept: 0, degenerate: false, dense };
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function svgFor(nodes, links, captions, recalled) {
    const line = (l) => {
      const a = nodes[l.a], b = nodes[l.b];
      if (!a || !b) return '';
      const cls = ['mm-link'];
      if (l.kind === 'cat') cls.push('mm-link-strong');
      if (l.mutual) cls.push('mm-link-pair');
      const title = Number.isFinite(l.sim)
        ? `<title>${escapeHtml(a.label)} · ${escapeHtml(b.label)} — ${(l.sim * 100).toFixed(0)}% alike</title>`
        : '';
      return `<line class="${cls.join(' ')}" data-a="${l.a}" data-b="${l.b}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}">${title}</line>`;
    };

    const caption = (c) =>
      `<text class="mm-caption" x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}">${escapeHtml(c.label)} <tspan class="mm-caption-count">${c.count}</tspan></text>`;

    const node = (n) => {
      if (n.type === 'centre') {
        return `<g class="mm-node" data-index="${n.index}" data-type="centre" transform="translate(${n.x} ${n.y})">
          <circle class="mm-centre" r="48"/>
          <text class="mm-centre-text" y="-4">${escapeHtml(n.label)}</text>
          <text class="mm-centre-sub" y="13">${escapeHtml(n.sub)}</text>
        </g>`;
      }
      if (n.type === 'cat') {
        return `<g class="mm-node" data-index="${n.index}" data-type="cat" transform="translate(${n.x} ${n.y})">
          <rect class="mm-cat" x="${-n.w / 2}" y="${-n.h / 2}" width="${n.w}" height="${n.h}" rx="${n.h / 2}"/>
          <text class="mm-cat-text" y="0">${escapeHtml(n.label)} <tspan class="mm-cat-count">${n.count}</tspan></text>
        </g>`;
      }
      const cls = ['mm-node'];
      if (n.moved) cls.push('mm-moved');
      if (recalled.has(n.fact?.id)) cls.push('mm-recalled');
      // The title is what makes a dot readable without a click, and it costs
      // nothing on a labelled box either.
      const title = `<title>${escapeHtml(n.fact.key)}: ${escapeHtml(trim(String(n.fact.value || ''), 120))}</title>`;
      if (n.dot) {
        return `<g class="${cls.join(' ')} mm-dot" data-index="${n.index}" data-type="fact" transform="translate(${n.x} ${n.y})">
          <circle class="mm-fact" r="${n.w / 2}"/>${title}
        </g>`;
      }
      return `<g class="${cls.join(' ')}" data-index="${n.index}" data-type="fact" transform="translate(${n.x} ${n.y})">
        <rect class="mm-fact" x="${-n.w / 2}" y="${-n.h / 2}" width="${n.w}" height="${n.h}" rx="8"/>
        <text class="mm-fact-key" y="-7">${escapeHtml(n.label)}</text>
        <text class="mm-fact-val" y="9">${escapeHtml(n.sub)}</text>${title}
      </g>`;
    };

    return links.map(line).join('') + captions.map(caption).join('') + nodes.map(node).join('');
  }

  /** The line above the canvas that says what the picture is. */
  function legendFor(layout, result, facts, movedCount, modelOk, usedCount) {
    const n = facts.length;
    const count = `${n} fact${n === 1 ? '' : 's'}`;
    // A filled node has to be explained where it is seen, or it reads as
    // decoration. Said only when there is one, so the line does not carry a
    // legend for a marker that is not on screen.
    const used = usedCount ? ` · ${usedCount} filled in — used by the last reply` : '';
    const moved = movedCount ? ` · ${movedCount} moved by hand` : '';
    // Said before anything else, because a canvas of unexplained dots is the
    // first thing the reader has to make sense of.
    const dots = result.dense ? ' Too many to label — hover or click a dot to read it.' : '';
    if (layout !== 'meaning') {
      return modelOk === false
        ? `Grouped by key — ${count}. The built-in meaning model did not load, so facts cannot be placed by meaning.${dots}${used}${moved}`
        : `Grouped by key — ${count}. Positions here carry no meaning.${dots}${used}${moved}`;
    }
    if (result.degenerate) {
      return `Placed by meaning — ${count}, but they are too alike to separate, so nothing should be read into where any of them sits.${dots}${used}${moved}`;
    }
    const pct = Math.round(result.kept * 100);
    return `Placed by meaning — ${count}. Near means similar. This flat picture keeps ${pct}% of what separates them.${dots}${used}${moved}`;
  }

  const DEFAULT_DETAIL = 'Click a fact to see it and its closest relatives · drag to move · scroll to zoom · Esc to close';

  function setDetail(html) {
    const el = $('memMapDetail');
    if (el) el.innerHTML = html;
  }

  /** The facts the last reply actually looked up, so the map can show memory
   *  being used rather than only stored. */
  function recalledIds() {
    try {
      const ids = window.HCMemoryStore?.lastRecalledIds?.();
      return new Set(Array.isArray(ids) ? ids : []);
    } catch { return new Set(); }
  }

  // ── The main draw ───────────────────────────────────────────────────────
  async function draw() {
    const svg = $('memMapSvg');
    const world = $('mmWorld');
    const grid = $('mmGridBg');
    if (!svg || !world) return;
    const token = ++_drawToken;

    const facts = visibleFacts();
    const hint = $('memMapHint');
    const toggle = $('memMapLayout');

    if (!facts.length) {
      _map = null;
      world.removeAttribute('transform');
      grid?.removeAttribute('transform');
      world.innerHTML = `<text class="mm-empty" x="${VIEW_W / 2}" y="${VIEW_H / 2}">Nothing remembered yet — the map fills in as you chat.</text>`;
      if (hint) hint.textContent = 'No facts to place.';
      setDetail(`<span class="mm-detail-dim">Nothing to show.</span>`);
      return;
    }

    let layout = layoutNow();
    let result = null;
    let modelOk = null;

    if (layout === 'meaning') {
      modelOk = await modelAvailable();
      if (token !== _drawToken) return;
      if (modelOk) {
        const vectors = await vectorsFor(facts);
        if (token !== _drawToken) return;
        // A failed embedding is not a reason to draw a meaning layout from
        // nothing — it falls back and says so, because a map that looks the
        // same either way is the defect this file's header is about.
        if (vectors) result = meaningLayout(facts, vectors);
        else modelOk = false;
      }
      if (!result) layout = 'keys';
    }
    if (!result) result = keyLayout(facts);

    if (toggle) {
      const meaning = layout === 'meaning';
      toggle.textContent = meaning ? 'By meaning' : 'By key';
      toggle.setAttribute('title', meaning
        ? 'Placed by meaning — switch to the tidy layout grouped by key name'
        : 'Grouped by key name — switch to placing facts by what they mean');
      toggle.classList.toggle('mm-on', meaning);
    }

    // Hand-placed positions win, per layout.
    const saved = readJSON(posKeyFor(layout), {}) || {};
    let movedCount = 0;
    for (const n of result.nodes) {
      const p = saved[n.id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        n.x = p.x; n.y = p.y; n.moved = true; movedCount++;
      }
    }

    const recalled = recalledIds();
    world.innerHTML = svgFor(result.nodes, result.links, result.captions, recalled);
    const usedCount = result.nodes.filter((n) => n.fact && recalled.has(n.fact.id)).length;
    if (hint) hint.textContent = legendFor(layout, result, facts, movedCount, modelOk, usedCount);

    _map = { svg, world, grid, layout, nodes: result.nodes, links: result.links, saved, facts };
    // Their own pan and zoom is honoured; otherwise the facts are fitted to the
    // window, which is what somebody opening the map expects to see.
    if (_viewIsTheirs) applyView();
    else fit();
    applyFilter();
    if (_selectedId) select(result.nodes.findIndex((n) => n.id === _selectedId), { keepDetail: true });
    else setDetail(`<span class="mm-detail-dim">${escapeHtml(DEFAULT_DETAIL)}</span>`);
  }

  // ── Pan and zoom ────────────────────────────────────────────────────────
  const MIN_K = 0.25, MAX_K = 3.5;
  let _view = null;
  // Whether the view on screen is one the user chose. A map opened for the
  // first time used to sit at scale 1 in the middle of an 8000-unit canvas,
  // which is a small clump of facts in a large empty rectangle.
  let _viewIsTheirs = false;

  function view() {
    if (!_view) {
      const s = readJSON(VIEW_KEY, null) || {};
      _viewIsTheirs = Number.isFinite(s.k) || Number.isFinite(s.tx);
      _view = {
        tx: Number.isFinite(s.tx) ? s.tx : 0,
        ty: Number.isFinite(s.ty) ? s.ty : 0,
        k: Number.isFinite(s.k) ? Math.max(MIN_K, Math.min(MAX_K, s.k)) : 1,
      };
    }
    return _view;
  }

  function applyView() {
    if (!_map) return;
    const v = view();
    const t = `translate(${v.tx} ${v.ty}) scale(${v.k})`;
    _map.world.setAttribute('transform', t);
    _map.grid?.setAttribute('transform', t);
  }

  /** A pointer position in the SVG's own coordinates. */
  function atPoint(ev) {
    const svg = _map?.svg || $('memMapSvg');
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: ev.clientX, y: ev.clientY };
  }

  /** Zoom about a fixed point, so what is under it stays under it. */
  function zoomAbout(pt, factor) {
    const v = view();
    const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
    const wx = (pt.x - v.tx) / v.k;
    const wy = (pt.y - v.ty) / v.k;
    v.tx = pt.x - wx * k;
    v.ty = pt.y - wy * k;
    v.k = k;
    applyView();
    writeJSON(VIEW_KEY, v);
  }

  function zoomFromButton(factor) {
    const svg = _map?.svg || $('memMapSvg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    zoomAbout(atPoint({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }), factor);
  }

  function fit() {
    if (!_map || !_map.nodes.length) return;
    const pad = 90;
    const b = _map.nodes.reduce((acc, n) => ({
      minX: Math.min(acc.minX, n.x - n.w / 2), minY: Math.min(acc.minY, n.y - n.h / 2),
      maxX: Math.max(acc.maxX, n.x + n.w / 2), maxY: Math.max(acc.maxY, n.y + n.h / 2),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const v = view();
    // The ceiling is what stops a single fact filling the window. It used to be
    // 1.6, which left a dozen facts as a small clump in a large empty canvas:
    // the drawing is letterboxed inside the viewBox before this scale applies,
    // so 1.6 was closer to 1.1 by the time it reached the screen.
    v.k = Math.max(MIN_K, Math.min(2.4, Math.min((VIEW_W - pad * 2) / bw, (VIEW_H - pad * 2) / bh)));
    v.tx = VIEW_W / 2 - ((b.minX + b.maxX) / 2) * v.k;
    v.ty = VIEW_H / 2 - ((b.minY + b.maxY) / 2) * v.k;
    applyView();
    _viewIsTheirs = true;
    writeJSON(VIEW_KEY, v);
  }

  // ── Selection, hover and the detail strip ───────────────────────────────
  let _selectedId = null;

  function nearestTo(index, limit = 3) {
    if (!_map || _map.layout !== 'meaning') return [];
    const V = window.HCVectorMap;
    const self = _map.nodes[index];
    const mine = _vectors.get(self?.fact?.id)?.vec;
    if (!mine) return [];
    return _map.nodes
      .filter((n) => n.type === 'fact' && n.index !== index && _vectors.get(n.fact.id)?.vec)
      .map((n) => ({ node: n, sim: V.dot(mine, _vectors.get(n.fact.id).vec) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit);
  }

  function highlightNeighbours(index) {
    if (!_map) return;
    const linked = new Set();
    _map.world.querySelectorAll('.mm-link').forEach((l) => {
      const a = Number(l.dataset.a), b = Number(l.dataset.b);
      const on = a === index || b === index;
      l.classList.toggle('mm-link-lit', on);
      l.classList.toggle('mm-link-dim', !on);
      if (on) linked.add(a === index ? b : a);
    });
    _map.world.querySelectorAll('.mm-node').forEach((g) => {
      const i = Number(g.dataset.index);
      g.classList.toggle('mm-near', linked.has(i));
    });
  }

  function clearHighlight() {
    if (!_map) return;
    _map.world.querySelectorAll('.mm-link').forEach((l) => l.classList.remove('mm-link-lit', 'mm-link-dim'));
    _map.world.querySelectorAll('.mm-node').forEach((g) => g.classList.remove('mm-near', 'mm-selected'));
  }

  function select(index, opts) {
    if (!_map) return;
    const node = _map.nodes[index];
    if (!node) { _selectedId = null; return; }
    clearHighlight();
    _selectedId = node.id;
    const g = _map.world.querySelector(`.mm-node[data-index="${index}"]`);
    g?.classList.add('mm-selected');

    if (node.type === 'fact') {
      highlightNeighbours(index);
      const near = nearestTo(index);
      const relatives = near.length
        ? `<div class="mm-detail-near">Closest by meaning: ${near
            .map((n) => `<button type="button" class="mm-jump" data-index="${n.node.index}">${escapeHtml(n.node.label)} <span>${(n.sim * 100).toFixed(0)}%</span></button>`)
            .join('')}</div>`
        : '';
      const moved = node.moved ? ` <span class="mm-detail-dim">· moved by hand</span>` : '';
      setDetail(
        `<div class="mm-detail-head"><span class="mm-detail-key">${escapeHtml(node.fact.key)}</span>` +
        `<span class="mm-detail-dim">${escapeHtml(deps.fmtRelative(node.fact.ts))}</span>${moved}` +
        `<span class="mm-detail-actions">` +
        `<button type="button" class="mm-act" data-act="edit">Edit</button>` +
        `<button type="button" class="mm-act mm-act-danger" data-act="delete">Delete</button>` +
        `</span></div>` +
        `<div class="mm-detail-value">${escapeHtml(node.fact.value)}</div>${relatives}`
      );
    } else if (node.type === 'cat') {
      setDetail(`<span class="mm-detail-key">${escapeHtml(node.label)}</span> <span class="mm-detail-dim">— ${node.count} fact${node.count === 1 ? '' : 's'} whose key starts with it.</span>`);
    } else if (!opts?.keepDetail) {
      setDetail(`<span class="mm-detail-dim">${escapeHtml(DEFAULT_DETAIL)}</span>`);
    }
  }

  function hoverDetail(index) {
    if (!_map || _selectedId) return;
    const node = _map.nodes[index];
    if (!node) return;
    if (node.type === 'fact') {
      setDetail(`<span class="mm-detail-key">${escapeHtml(node.fact.key)}</span> <span class="mm-detail-value-inline">${escapeHtml(trim(node.fact.value, 160))}</span>`);
    } else if (node.type === 'cat') {
      setDetail(`<span class="mm-detail-key">${escapeHtml(node.label)}</span> <span class="mm-detail-dim">— ${node.count} fact${node.count === 1 ? '' : 's'}</span>`);
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────
  function applyFilter() {
    if (!_map) return;
    const q = ($('memMapSearch')?.value || '').trim().toLowerCase();
    const on = !!q;
    _map.world.classList.toggle('mm-filtering', on);
    let hits = 0;
    for (const n of _map.nodes) {
      const g = _map.world.querySelector(`.mm-node[data-index="${n.index}"]`);
      if (!g) continue;
      const text = n.type === 'fact'
        ? `${n.fact.key} ${n.fact.value}`.toLowerCase()
        : String(n.label || '').toLowerCase();
      const hit = on && text.includes(q);
      if (hit) hits++;
      g.classList.toggle('mm-hit', hit);
    }
    if (on) {
      setDetail(`<span class="mm-detail-dim">${hits} fact${hits === 1 ? '' : 's'} match “${escapeHtml(q)}”.</span>`);
    } else if (!_selectedId) {
      setDetail(`<span class="mm-detail-dim">${escapeHtml(DEFAULT_DETAIL)}</span>`);
    }
  }

  // ── Editing from the map ────────────────────────────────────────────────
  // Both of these change the store, so both tell the pane behind the map to
  // redraw. It used to refresh only the map, which left Settings showing the
  // value that had just been replaced.
  async function editFact(fact) {
    const next = await deps.themedPrompt(`Edit “${fact.key}”:`, fact.value, 'Memory');
    if (next == null) return;
    const { memLoad, memSave } = window.HCMemoryStore;
    const arr = memLoad();
    const i = arr.findIndex((x) => x.id === fact.id);
    if (i < 0) return;
    if (!next.trim()) arr.splice(i, 1);
    else { arr[i].value = next.trim().slice(0, 1200); arr[i].ts = Date.now(); }
    memSave(arr);
    if (!next.trim()) _selectedId = null;
    deps.onFactsChanged();
    draw();
  }

  async function deleteFact(fact) {
    const ok = await deps.themedConfirm(`Delete fact “${fact.key}”?`, 'Memory map');
    if (!ok) return;
    const { memLoad, memSave } = window.HCMemoryStore;
    const arr = memLoad();
    const i = arr.findIndex((x) => x.id === fact.id);
    if (i < 0) return;
    arr.splice(i, 1);
    memSave(arr);
    _selectedId = null;
    deps.onFactsChanged();
    draw();
  }

  // ── Pointers ────────────────────────────────────────────────────────────
  // Bound once, on the canvas, rather than per node. The nodes are rewritten on
  // every redraw, and the old map added a listener to each of them each time —
  // which is how a map redrawn on every edit ends up carrying hundreds.
  function wireCanvas() {
    const svg = $('memMapSvg');
    if (!svg) return;
    let drag = null;
    let pan = null;

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !_map) return;
      const g = e.target.closest?.('.mm-node');
      if (g) {
        const index = Number(g.dataset.index);
        const node = _map.nodes[index];
        if (!node) return;
        try { g.setPointerCapture(e.pointerId); } catch {}
        const p = atPoint(e);
        const v = view();
        drag = {
          g, index, node, moved: false,
          wx: (p.x - v.tx) / v.k, wy: (p.y - v.ty) / v.k,
          nx: node.x, ny: node.y,
        };
        return;
      }
      try { svg.setPointerCapture(e.pointerId); } catch {}
      const v = view();
      svg.classList.add('panning');
      pan = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty };
    });

    svg.addEventListener('pointermove', (e) => {
      if (drag) {
        const p = atPoint(e);
        const v = view();
        const dx = (p.x - v.tx) / v.k - drag.wx;
        const dy = (p.y - v.ty) / v.k - drag.wy;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        drag.node.x = drag.nx + dx;
        drag.node.y = drag.ny + dy;
        drag.g.setAttribute('transform', `translate(${drag.node.x} ${drag.node.y})`);
        _map.world.querySelectorAll(`line[data-a="${drag.index}"], line[data-b="${drag.index}"]`).forEach((l) => {
          const a = _map.nodes[Number(l.dataset.a)], b = _map.nodes[Number(l.dataset.b)];
          if (!a || !b) return;
          l.setAttribute('x1', a.x.toFixed(1)); l.setAttribute('y1', a.y.toFixed(1));
          l.setAttribute('x2', b.x.toFixed(1)); l.setAttribute('y2', b.y.toFixed(1));
        });
        return;
      }
      if (!pan) return;
      const ctm = svg.getScreenCTM();
      const v = view();
      v.tx = pan.tx + (e.clientX - pan.x) * (ctm ? 1 / ctm.a : 1);
      v.ty = pan.ty + (e.clientY - pan.y) * (ctm ? 1 / ctm.d : 1);
      applyView();
    });

    const release = (e) => {
      if (drag) {
        try { drag.g.releasePointerCapture(e.pointerId); } catch {}
        if (drag.moved) {
          _map.saved[drag.node.id] = { x: drag.node.x, y: drag.node.y };
          drag.node.moved = true;
          drag.g.classList.add('mm-moved');
          writeJSON(posKeyFor(_map.layout), _map.saved);
          draw();
        } else {
          select(drag.index);
        }
        drag = null;
        return;
      }
      if (!pan) return;
      try { svg.releasePointerCapture(e.pointerId); } catch {}
      svg.classList.remove('panning');
      pan = null;
      writeJSON(VIEW_KEY, view());
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    // The hint used to say "hover or click a node" and only click did anything.
    svg.addEventListener('pointerover', (e) => {
      const g = e.target.closest?.('.mm-node');
      if (g) hoverDetail(Number(g.dataset.index));
    });
    svg.addEventListener('pointerout', (e) => {
      if (e.target.closest?.('.mm-node') && !_selectedId) applyFilter();
    });

    svg.addEventListener('dblclick', (e) => {
      const g = e.target.closest?.('.mm-node');
      if (!g || !_map) return;
      const node = _map.nodes[Number(g.dataset.index)];
      if (node?.type === 'fact') { e.stopPropagation(); editFact(node.fact); }
    });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAbout(atPoint(e), e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  // ── Opening, closing and the toolbar ────────────────────────────────────
  const isOpen = () => !!$('memMapOverlay')?.classList.contains('open');

  function open() {
    const ov = $('memMapOverlay');
    if (!ov) return;
    ov.classList.add('open');
    _selectedId = null;
    const search = $('memMapSearch');
    if (search) search.value = '';
    draw();
  }

  function close() {
    $('memMapOverlay')?.classList.remove('open');
  }

  function init(d) {
    deps = { ...deps, ...d };

    $('memMapBtn')?.addEventListener('click', open);
    $('memMapClose')?.addEventListener('click', close);
    $('memMapOverlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'memMapOverlay') close();
    });
    // Every other overlay in the app closes on Escape. This one did not.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !isOpen()) return;
      // The search box gets the first Escape, to clear itself.
      if (document.activeElement === $('memMapSearch') && $('memMapSearch').value) {
        $('memMapSearch').value = '';
        applyFilter();
        return;
      }
      e.preventDefault();
      close();
    });

    $('memMapZoomIn')?.addEventListener('click', () => zoomFromButton(1.2));
    $('memMapZoomOut')?.addEventListener('click', () => zoomFromButton(1 / 1.2));
    $('memMapFit')?.addEventListener('click', fit);
    $('memMapSearch')?.addEventListener('input', applyFilter);

    $('memMapLayout')?.addEventListener('click', async () => {
      writeJSON(LAYOUT_KEY, layoutNow() === 'meaning' ? 'keys' : 'meaning');
      _selectedId = null;
      await draw();
      fit();
    });

    $('memMapReset')?.addEventListener('click', async () => {
      const layout = layoutNow();
      const ok = await deps.themedConfirm(
        layout === 'meaning'
          ? 'Put every fact back where its meaning places it?'
          : 'Put every node back to the default ring?',
        'Memory map');
      if (!ok) return;
      try { localStorage.removeItem(posKeyFor(layout)); } catch {}
      await draw();
      fit();
    });

    // Zoom from the keyboard, and the detail strip's own buttons.
    document.addEventListener('keydown', (e) => {
      if (!isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement === $('memMapSearch')) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomFromButton(1.2); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomFromButton(1 / 1.2); }
      else if (e.key === '0') { e.preventDefault(); fit(); }
    });

    $('memMapDetail')?.addEventListener('click', (e) => {
      const jump = e.target.closest('.mm-jump');
      if (jump) { select(Number(jump.dataset.index)); return; }
      const act = e.target.closest('.mm-act');
      if (!act || !_map) return;
      const node = _map.nodes.find((n) => n.id === _selectedId);
      if (!node?.fact) return;
      if (act.dataset.act === 'edit') editFact(node.fact);
      else if (act.dataset.act === 'delete') deleteFact(node.fact);
    });

    wireCanvas();
  }

  window.HCMemoryMap = {
    init,
    open,
    close,
    draw,
    // The pane redraws the map after an edit made in the list, so the two
    // views of the same facts cannot disagree.
    refresh: () => { if (isOpen()) draw(); },
  };
})();
