// ==============================================================
// Placing vectors on a flat picture
//
// The memory map used to arrange facts on a ring, one spoke per category, and
// the category was the text before the first underscore in the key. So a fact
// keyed cat_name sat under a heading called CAT, and two facts that mean nearly
// the same thing sat on opposite sides of the circle if they happened to be
// keyed differently. Nothing about the arrangement carried meaning: it was a
// diagram of the key names.
//
// This file turns the vectors the app already produces into positions. The
// embedding model ships inside the binary (src-tauri/src/commands/embed.rs), so
// every fact can be turned into 384 numbers in about a millisecond, and two
// facts that mean the same thing have vectors that point the same way. Placing
// them by that is the difference between a picture of the memory and a picture
// of its labels.
//
// It is all pure. Nothing here touches the document, the store or the network —
// vectors in, coordinates and links out — which is what lets
// scripts/checks/vector-map.mjs run the real code over synthetic vectors whose
// right answer is known in advance.
//
// TWO RULES THAT ARE NOT PREFERENCES:
//
//   1. Similarity here is a RANK, never a number compared against a cut-off.
//      bge-small sits in a high, compressed band: two unrelated sentences
//      score about 0.41 where a genuinely relevant one scores 0.68. Any
//      absolute threshold either admits everything or nothing, and it moves
//      with the subject matter. So a fact links to its nearest few relatives
//      by position in the ranking, and the score is only ever shown, never
//      thresholded.
//
//   2. The projection is DETERMINISTIC. Power iteration is normally seeded at
//      random, which would redraw the map differently every time it opened and
//      make it impossible to check. The seed here is chosen from the data, so
//      the same facts always land in the same place.
//
// Loaded before app.js and published as window.HCVectorMap.
// ==============================================================
(function () {
  'use strict';

  /**
   * Plain dot product, with the width guard that matters: vectors from a
   * different build of the model belong to a different space, and comparing
   * across spaces produces confident nonsense rather than an error.
   *
   * embed_texts returns L2-normalised vectors, so for two stored facts this IS
   * the cosine similarity. It is spelled as a dot product because the
   * projection below also uses it on centred vectors, where the name "cosine"
   * would be a lie.
   */
  function dot(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  /** Every vector is the same width and holds finite numbers. */
  function usable(vectors) {
    if (!Array.isArray(vectors) || !vectors.length) return false;
    const w = vectors[0]?.length | 0;
    if (!w) return false;
    return vectors.every((v) => Array.isArray(v) && v.length === w && v.every(Number.isFinite));
  }

  /** The mean vector, subtracted before projecting so the spread is centred. */
  function centre(vectors) {
    const w = vectors[0].length;
    const mean = new Array(w).fill(0);
    for (const v of vectors) for (let i = 0; i < w; i++) mean[i] += v[i];
    for (let i = 0; i < w; i++) mean[i] /= vectors.length;
    return vectors.map((v) => v.map((x, i) => x - mean[i]));
  }

  function norm(v) {
    return Math.sqrt(dot(v, v));
  }

  function unit(v) {
    const n = norm(v);
    if (!(n > 1e-12)) return null;
    return v.map((x) => x / n);
  }

  /**
   * The direction along which the facts differ most, by power iteration.
   *
   * The seed is the centred row that is furthest from the middle rather than a
   * random vector. That is what makes the map stable between openings, and it
   * cannot be orthogonal to the leading direction the way an arbitrary seed
   * can: it is one of the rows that direction is computed from.
   */
  function leadingDirection(rows, iterations) {
    let seed = null;
    let best = 0;
    for (const r of rows) {
      const n = norm(r);
      if (n > best) { best = n; seed = r; }
    }
    let v = unit(seed || []);
    if (!v) return null;
    const w = v.length;
    for (let step = 0; step < iterations; step++) {
      const next = new Array(w).fill(0);
      for (const r of rows) {
        const s = dot(r, v);
        if (!s) continue;
        for (let i = 0; i < w; i++) next[i] += r[i] * s;
      }
      const u = unit(next);
      if (!u) return v;
      v = u;
    }
    return v;
  }

  /** Remove everything that lies along `dir`, so the next pass finds something new. */
  function deflate(rows, dir) {
    return rows.map((r) => {
      const s = dot(r, dir);
      return r.map((x, i) => x - s * dir[i]);
    });
  }

  /** Total squared distance from the centre — the spread the picture is a share of. */
  function totalSpread(rows) {
    let sum = 0;
    for (const r of rows) sum += dot(r, r);
    return sum;
  }

  /**
   * Vectors → points on a plane, by their own two strongest directions.
   *
   * Returns coordinates centred on the origin and scaled so the widest axis
   * spans 1, plus `kept`: the share of the spread the two directions account
   * for. That number is the honest answer to "how much of the truth is in this
   * flat picture" — 384 dimensions do not fit in two, and a map that keeps a
   * fifth of the variation should not claim otherwise.
   *
   * `degenerate` says the vectors carry no usable spread — one fact, or several
   * that mean the same thing — in which case the points are laid on a ring so
   * they can still be told apart, and no meaning should be read into where any
   * of them sits.
   */
  function project(vectors, opts) {
    const iterations = Math.max(8, (opts && opts.iterations) || 64);
    if (!usable(vectors)) return { points: [], kept: 0, degenerate: true };
    const n = vectors.length;
    if (n === 1) return { points: [{ x: 0, y: 0 }], kept: 0, degenerate: true };

    const rows = centre(vectors);
    const spread = totalSpread(rows);
    const ring = () => ({
      points: vectors.map((_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 };
      }),
      kept: 0,
      degenerate: true,
    });
    if (!(spread > 1e-9)) return ring();

    const first = leadingDirection(rows, iterations);
    if (!first) return ring();
    const rest = deflate(rows, first);
    // With two facts there is only one direction to find; the second axis is
    // empty and every point sits on a line, which is the truth about two
    // points and not a defect.
    const second = totalSpread(rest) > 1e-9 ? leadingDirection(rest, iterations) : null;

    const xs = rows.map((r) => dot(r, first));
    const ys = second ? rows.map((r) => dot(r, second)) : rows.map(() => 0);
    const kept = (xs.reduce((s, x) => s + x * x, 0) + ys.reduce((s, y) => s + y * y, 0)) / spread;

    // One scale for both axes. Scaling each to fill the box separately would
    // stretch the picture and change which facts look close together, which is
    // the one thing the map is for.
    let widest = 0;
    for (let i = 0; i < n; i++) widest = Math.max(widest, Math.abs(xs[i]), Math.abs(ys[i]));
    if (!(widest > 1e-12)) return ring();

    return {
      points: xs.map((x, i) => ({ x: x / widest, y: ys[i] / widest })),
      kept: Math.max(0, Math.min(1, kept)),
      degenerate: false,
    };
  }

  /**
   * Each fact joined to its nearest few relatives.
   *
   * By rank, for the reason at the top of this file. `perNode` is how many
   * relatives each fact reaches for; an edge appears once, carrying the
   * similarity so it can be shown to the user, and `mutual` when both facts
   * chose each other — which is the honest signal of a real pair, and what the
   * clustering below is built on.
   */
  function neighbourLinks(vectors, opts) {
    const perNode = Math.max(1, (opts && opts.perNode) || 2);
    if (!usable(vectors) || vectors.length < 2) return [];
    const n = vectors.length;
    const chosen = [];
    for (let i = 0; i < n; i++) {
      const scored = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        scored.push({ j, sim: dot(vectors[i], vectors[j]) });
      }
      // Ties broken by index so the same vectors always give the same links.
      scored.sort((a, b) => (b.sim - a.sim) || (a.j - b.j));
      chosen.push(new Set(scored.slice(0, perNode).map((s) => s.j)));
    }
    const edges = [];
    for (let i = 0; i < n; i++) {
      for (const j of chosen[i]) {
        if (j < i && chosen[j].has(i)) continue; // already emitted as (j, i)
        if (j < i) { edges.push({ a: j, b: i, sim: dot(vectors[i], vectors[j]), mutual: false }); continue; }
        edges.push({ a: i, b: j, sim: dot(vectors[i], vectors[j]), mutual: chosen[j].has(i) });
      }
    }
    return edges.sort((e1, e2) => (e1.a - e2.a) || (e1.b - e2.b));
  }

  /**
   * Groups, from the pairs that chose each other.
   *
   * Only mutual links join a group. A one-sided link is what every fact has —
   * something is always the closest thing to it, however unrelated — so
   * grouping on those would put the whole memory in one blob.
   *
   * Returns a group index per fact, numbered by first appearance so the
   * numbering does not shuffle between openings.
   */
  function groupsFromLinks(count, edges) {
    const n = Math.max(0, count | 0);
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj); };
    for (const e of edges || []) {
      if (!e || !e.mutual) continue;
      if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
      join(e.a, e.b);
    }
    const seen = new Map();
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!seen.has(root)) seen.set(root, seen.size);
      out[i] = seen.get(root);
    }
    return out;
  }

  /**
   * A name for a group, taken from the keys in it — or no name at all.
   *
   * The old map named a group from the text before the first underscore and
   * presented it as a category. This names a group after what is actually in
   * it: the stem its keys share. A tie goes to the alphabetically first, so the
   * label does not depend on the order facts were saved in.
   *
   * IT RETURNS NOTHING WHEN NOTHING IS SHARED, and that is the important half.
   * Taking the first stem regardless produces a heading that misrepresents the
   * group — a cluster holding a name, a username and a pet came out labelled
   * after the pet, because c sorts before n and u. An unlabelled group is
   * honest; a mislabelled one is the defect this map was rebuilt to escape.
   */
  function groupLabel(keys) {
    const counts = new Map();
    for (const raw of keys || []) {
      const k = String(raw || '').toLowerCase().trim();
      if (!k) continue;
      const cut = k.search(/[_\s-]/);
      const stem = (cut > 0 ? k.slice(0, cut) : k).replace(/[^a-z0-9]/g, '');
      if (!stem) continue;
      counts.set(stem, (counts.get(stem) || 0) + 1);
    }
    if (!counts.size) return '';
    const [stem, n] = [...counts.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
    return n >= 2 ? stem : '';
  }

  /**
   * Push overlapping labels apart without losing the arrangement.
   *
   * A projection puts related facts close together, which is the point, and
   * boxes with words in them cannot overlap and stay readable. Each pass moves
   * only the pairs that actually collide, and only by half the overlap each,
   * so a crowd loosens while everything that was already clear stays put.
   *
   * Iterating in a fixed order keeps it deterministic. The result is not a
   * force simulation and is not trying to be: nothing is attracted, so no
   * point drifts away from where its meaning put it.
   */
  function spread(points, sizes, opts) {
    const iterations = Math.max(0, (opts && opts.iterations) ?? 60);
    const gap = (opts && opts.gap) || 8;
    const out = (points || []).map((p) => ({ x: p.x, y: p.y }));
    const box = (i) => sizes[i] || { w: 0, h: 0 };

    // Only boxes that are near each other can overlap, so only those are
    // compared. Comparing every box with every other one is 125,000 pairs per
    // pass at the 500 facts the store holds, and the passes do not converge at
    // that size because the boxes cannot all fit apart — measured at 3.2
    // seconds, which is the map freezing the window as it opens.
    //
    // A box can only reach another whose centre is within its own half-width
    // plus the other's plus the gap, so a grid of cells that wide means any
    // collision is within the neighbouring nine, and candidates are visited in
    // index order.
    //
    // The grid is built once per pass, from where the boxes were when the pass
    // began. A box that moves into a new cell mid-pass is therefore judged
    // against its old neighbourhood until the next pass rebuilds it — so this
    // is not identical to comparing every pair, it converges on the same
    // separation over the passes. What it is exactly is deterministic, which is
    // the property the map needs and the checks hold it to.
    let cell = 1;
    for (let i = 0; i < out.length; i++) {
      const b = box(i);
      cell = Math.max(cell, b.w + gap, b.h + gap);
    }
    const key = (cx, cy) => cx + ',' + cy;

    for (let step = 0; step < iterations; step++) {
      let moved = false;
      const grid = new Map();
      for (let i = 0; i < out.length; i++) {
        const k = key(Math.floor(out[i].x / cell), Math.floor(out[i].y / cell));
        const bucket = grid.get(k);
        if (bucket) bucket.push(i); else grid.set(k, [i]);
      }
      for (let i = 0; i < out.length; i++) {
        const cx = Math.floor(out[i].x / cell);
        const cy = Math.floor(out[i].y / cell);
        const candidates = [];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = grid.get(key(cx + dx, cy + dy));
            if (bucket) for (const j of bucket) if (j > i) candidates.push(j);
          }
        }
        candidates.sort((a, b) => a - b);
        for (const j of candidates) {
          const bi = box(i), bj = box(j);
          const minX = (bi.w + bj.w) / 2 + gap;
          const minY = (bi.h + bj.h) / 2 + gap;
          let dx = out[j].x - out[i].x;
          let dy = out[j].y - out[i].y;
          const overlapX = minX - Math.abs(dx);
          const overlapY = minY - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          // Separate along whichever axis needs the smaller shove, so a row of
          // boxes spreads sideways rather than scattering.
          if (overlapX < overlapY) {
            if (dx === 0) dx = i < j ? 1 : -1;
            const push = (overlapX / 2) * Math.sign(dx);
            out[i].x -= push; out[j].x += push;
          } else {
            if (dy === 0) dy = i < j ? 1 : -1;
            const push = (overlapY / 2) * Math.sign(dy);
            out[i].y -= push; out[j].y += push;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return out;
  }

  /**
   * Unit coordinates → a box, keeping the aspect ratio.
   *
   * One scale for both axes again, for the same reason as in project(): a map
   * that stretches to fill its window is no longer reporting distances.
   */
  function toBox(points, box) {
    const width = (box && box.width) || 0;
    const height = (box && box.height) || 0;
    const pad = (box && box.pad) || 0;
    const cx = width / 2, cy = height / 2;
    if (!points || !points.length) return [];
    let widest = 0;
    for (const p of points) widest = Math.max(widest, Math.abs(p.x), Math.abs(p.y));
    const room = Math.max(1, Math.min(width, height) / 2 - pad);
    const k = widest > 1e-12 ? room / widest : 1;
    return points.map((p) => ({ x: cx + p.x * k, y: cy + p.y * k }));
  }

  window.HCVectorMap = {
    project,
    neighbourLinks,
    groupsFromLinks,
    groupLabel,
    spread,
    toBox,
    dot,
  };
})();
