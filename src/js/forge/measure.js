// ============================================================
// measure.js — putting a number on a generated model
//
// Until now nothing in this app could say whether a model was any good. There
// are sixteen hundred checks and every one of them asks whether the code is
// wired up correctly; not one asks whether the object that came out the other
// end reads as the thing that was asked for. So a change to the design prompt,
// the assembler or the geometry could be argued about and never settled, and
// the only way to judge a run was to look at it.
//
// This file is the ruler. It takes a plan and returns a score out of a hundred,
// with the working shown: what it measured, what each measurement was worth,
// and which parts dragged it down. Every number comes from the geometry. There
// is no opinion in here and no randomness — the same plan scores the same on
// every machine, for ever, which is the only property that makes a ratchet
// meaningful.
//
// What it deliberately does NOT do is guess intent. It cannot know whether the
// prompt wanted a crate or a fish, so it never marks an object down for being
// blocky on its own; it marks down a model that is a *pile* — parts that do not
// meet, a silhouette carried by nothing but cubes, one part a thousand times
// another. Those are wrong whatever was asked for.
//
// Pure: no THREE, no DOM, no network, no clock. It needs the geometry helpers
// in model-plan.js, which is loaded before it. That is deliberate rather than
// duplicated — there must be exactly one answer in this app to "where is this
// part", or the scorer and the assembler will drift and the score will start
// describing a model nobody is building.
//
// Run the checks with: npm run check:forge-measure
// ============================================================
(function () {
  "use strict";

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // How far apart two parts may be and still be called touching. The same
  // tolerance the assembler uses, on purpose: a scorer that disagreed with the
  // stage it is grading would report faults that stage had no way to fix.
  const CONTACT_GAP = 0.06;

  // A part that is a plain box or a plain ball carries no shape of its own.
  // Some are honest — a crate is boxes — so this is a proportion, not a fault.
  const PLAIN_TYPES = new Set(["box", "sphere"]);

  // What a sensible model looks like from the outside. Below the floor a
  // "model" is one lump; above the ceiling it is the pile that the whole
  // few-parts-that-read-correctly rule exists to prevent.
  const PART_FLOOR = 4;
  const PART_CEILING = 20;

  // Above this, the largest part against the smallest, and something has gone
  // wrong with units rather than with design — a detail a thousandth the size
  // of the body is not a detail, it is a decimal point in the wrong place.
  const SCALE_SPREAD_LIMIT = 60;

  /**
   * The measurements, each worth what it is worth.
   *
   * Weights are stated here rather than buried in the code so that changing
   * what this app values is a visible edit to one table, and so a reader can
   * disagree with a number without reading the arithmetic.
   *
   * `whenApplicable` marks a measurement that does not apply to every model.
   * Symmetry is the case: a model with no mirrored pair is not symmetric and is
   * not wrong for it. Rather than award free marks — which would quietly rank
   * asymmetric models above symmetric ones that are slightly off — the
   * measurement is dropped and the remaining weights are shared out again.
   */
  const MEASURES = [
    { id: "oneBody",        weight: 22, label: "the parts form one body" },
    { id: "joined",         weight: 14, label: "parts meet rather than approach" },
    { id: "shaped",         weight: 14, label: "the shape is carried by more than blocks" },
    { id: "symmetry",       weight: 14, label: "mirrored pairs are exactly opposite", whenApplicable: true },
    { id: "distinct",       weight: 9,  label: "no part is hidden inside another just like it" },
    { id: "partCount",      weight: 9,  label: "the part count reads as a model" },
    { id: "wellFormed",     weight: 9,  label: "every part has a measurable size" },
    { id: "scaleCoherence", weight: 9,  label: "the parts belong to the same object" },
  ];

  // Two parts count as the same part when their boxes sit on each other this
  // closely: centres within a hundredth of the model's longest side, and sizes
  // within a twentieth of each other.
  const SAME_PLACE = 0.01;
  const SAME_SIZE = 0.05;

  function plan3d() {
    const MP = typeof window !== "undefined" ? window.HCModelPlan : null;
    if (!MP || !MP.partBox || !MP.normaliseParts) {
      throw new Error("measure.js needs model-plan.js loaded first");
    }
    return MP;
  }

  /**
   * The parts a score is computed over, and what was lost getting there.
   *
   * Normalising drops a part that has no measurable size, which is right — it
   * cannot be drawn — but it means the parts handed back are only the ones that
   * survived. Scoring those alone would give a model full marks for being
   * well-formed after quietly losing three parts to it. So what went in is
   * counted as well as what came out.
   *
   * The mirrored pairing is read from the plan as written, not from the
   * normalised parts: normalising carries the request to mirror and not the
   * finished pairing, so a plan whose pairs are already built would look to
   * this file like a model that had never claimed symmetry at all.
   */
  function partsOf(plan) {
    const MP = plan3d();
    const raw = Array.isArray(plan) ? plan : (plan?.nodes || plan?.parts || []);
    const wanted = raw.filter((p) => p && p.role !== "audit");
    const out = MP.normaliseParts(wanted);
    const pairs = new Map();
    for (const node of wanted) {
      const twin = typeof node?.mirroredFrom === "string" ? node.mirroredFrom : null;
      if (twin) pairs.set(String(node.id ?? node.name ?? ""), twin);
    }
    return { parts: out.parts, received: wanted.length, pairs };
  }

  const boxSpan = (b) => Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  const boxVolume = (b) => Math.max(0, b[3] - b[0]) * Math.max(0, b[4] - b[1]) * Math.max(0, b[5] - b[2]);

  /** Touching, or near enough that the assembler would call them joined. */
  const near = (a, b, gap) => (
    a[0] - gap <= b[3] && b[0] - gap <= a[3] &&
    a[1] - gap <= b[4] && b[1] - gap <= a[4] &&
    a[2] - gap <= b[5] && b[2] - gap <= a[5]
  );

  /** Sharing space, with no daylight anywhere. This is what a solid looks like. */
  const overlaps = (a, b) => (
    a[0] < b[3] && b[0] < a[3] &&
    a[1] < b[4] && b[1] < a[4] &&
    a[2] < b[5] && b[2] < a[5]
  );

  /**
   * How much of the model hangs together.
   *
   * Walked from the largest part outwards, because that is the body, and a
   * fin reaching a fin reaching the body is still attached. The score is the
   * share of parts the walk reaches: a model in one piece scores 1, a model
   * where a quarter of the parts float off on their own scores 0.75.
   */
  function connectedShare(boxes, gap) {
    if (boxes.length <= 1) return { share: 1, reached: boxes.length, components: boxes.length ? 1 : 0 };
    let root = 0;
    for (let i = 1; i < boxes.length; i++) if (boxVolume(boxes[i]) > boxVolume(boxes[root])) root = i;
    const seen = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const i = queue.shift();
      for (let j = 0; j < boxes.length; j++) {
        if (seen.has(j) || !near(boxes[i], boxes[j], gap)) continue;
        seen.add(j); queue.push(j);
      }
    }
    // Everything the walk did not reach, grouped, so the report can say how
    // many separate objects are on screen rather than only that one is missing.
    let components = 1;
    const unvisited = new Set();
    for (let i = 0; i < boxes.length; i++) if (!seen.has(i)) unvisited.add(i);
    while (unvisited.size) {
      const start = unvisited.values().next().value;
      const q = [start];
      unvisited.delete(start);
      while (q.length) {
        const i = q.shift();
        for (const j of Array.from(unvisited)) {
          if (!near(boxes[i], boxes[j], gap)) continue;
          unvisited.delete(j); q.push(j);
        }
      }
      components++;
    }
    return { share: seen.size / boxes.length, reached: seen.size, components };
  }

  /**
   * The share of parts that actually share space with a neighbour.
   *
   * Passing the contact test is not the same as being one object. A part
   * sitting a hair clear of the body counts as attached and still shows a line
   * of daylight through the join, which is what makes a model read as a set of
   * pieces standing together. This measures the stricter thing.
   */
  function joinedShare(boxes) {
    if (boxes.length <= 1) return 1;
    let joined = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        if (overlaps(boxes[i], boxes[j])) { joined++; break; }
      }
    }
    return joined / boxes.length;
  }

  /**
   * Parts that are another part, in the same place.
   *
   * Nothing else here can see this. A ring of sixteen teeth whose spacing is
   * divided the wrong way puts the last copy on top of the first, and every
   * other measurement is perfectly happy: it is still one body, the parts still
   * overlap, the shapes are still shapes. On screen it is a gear with a tooth
   * missing, and the score said a hundred.
   *
   * So: geometry that is exactly where other geometry already is, is counted.
   * It is nearly always a pattern that has collapsed or a design that wrote the
   * same part twice, and it is never something anyone wanted.
   */
  function duplicateCount(boxes, span, twins) {
    if (boxes.length < 2) return 0;
    const centre = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const extent = (b) => [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
    const nearBy = Math.max(1e-9, span * SAME_PLACE);
    const centres = boxes.map(centre);
    const extents = boxes.map(extent);
    const duplicated = new Set();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const dc = Math.hypot(
          centres[i][0] - centres[j][0],
          centres[i][1] - centres[j][1],
          centres[i][2] - centres[j][2],
        );
        if (dc > nearBy) continue;
        // A declared pair is two parts on purpose. Their boxes can sit almost
        // on top of each other — a pair of fins whose shapes reach inward past
        // the centre line does exactly that — and calling those a duplicate
        // would report every such model for the one thing it got right.
        if (twins && (twins.get(i) === j || twins.get(j) === i)) continue;
        const sameSize = [0, 1, 2].every((k) => {
          const a = Math.abs(extents[i][k]);
          const b = Math.abs(extents[j][k]);
          const scale = Math.max(a, b, 1e-9);
          return Math.abs(a - b) / scale <= SAME_SIZE;
        });
        if (sameSize) { duplicated.add(i); duplicated.add(j); }
      }
    }
    // One of a coincident pair is the part that was wanted; the rest are waste.
    return Math.max(0, duplicated.size - (duplicated.size ? 1 : 0));
  }

  /**
   * Symmetry, measured against the pairs the plan itself declares.
   *
   * Only pairs are judged. A part sitting on the centre line is not asymmetric,
   * and inferring pairs by looking for parts that face each other would invent
   * relationships the design never claimed and then grade a model against them.
   */
  function symmetryError(parts, boxes, pairing, span) {
    const byId = new Map(parts.map((p, i) => [p.id, i]));
    let worst = 0;
    let pairs = 0;
    for (const [id, twinId] of pairing) {
      const i = byId.get(id);
      const j = byId.get(twinId);
      if (i == null || j == null) continue;
      pairs++;
      const a = boxes[i];
      const b = boxes[j];
      // Reflect one across x = 0 and compare it with the other. A true pair
      // lands exactly on top of its reflection.
      const mirrored = [-a[3], a[1], a[2], -a[0], a[4], a[5]];
      for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(mirrored[k] - b[k]));
    }
    return { pairs, error: worst, relative: span > 0 ? worst / span : 0 };
  }

  /**
   * Score one plan.
   *
   * Returns the score, every measurement behind it, and the plain facts — so a
   * number that moves can always be explained without re-running anything.
   */
  function score(plan, opts = {}) {
    const MP = plan3d();
    const gap = num(opts.gap, CONTACT_GAP);
    const { parts, received, pairs: pairing } = partsOf(plan);
    const facts = {
      parts: parts.length,
      dropped: received - parts.length,
      plain: 0,
      components: 0,
      size: [0, 0, 0],
      lowest: 0,
      scaleSpread: 0,
      symmetricPairs: 0,
    };

    if (!parts.length) {
      return {
        score: 0,
        measures: MEASURES.map((m) => ({ id: m.id, label: m.label, value: 0, weight: m.weight, applicable: true })),
        facts,
        issues: [{ code: "empty", detail: "the plan has no renderable part" }],
      };
    }

    const boxes = parts.map(MP.partBox);

    // Two of the measurements are about the DESIGN and the rest are about the
    // object it produced, and a pattern is where those come apart. A gear
    // written as one tooth repeated sixteen times is one decision about shape
    // and one decision about how many parts an object needs — but it arrives as
    // sixteen boxes, and counting them as sixteen marks the design down once for
    // every copy of a choice it made once. It also pushed a clean twenty-four
    // tooth gear past the count at which a model is called a pile.
    //
    // So shape and part count are judged over the families a design wrote.
    // Everything else — whether it holds together, whether the parts meet,
    // whether pairs match — is judged over the parts that actually exist,
    // because those are properties of the object and not of how it was written.
    const familyOf = (part) => (typeof part.repeatedFrom === "string" ? part.repeatedFrom : part.id);
    const families = new Map();
    parts.forEach((part) => {
      const key = familyOf(part);
      if (!families.has(key)) families.set(key, part);
    });
    const designParts = families.size;
    const plainDesign = Array.from(families.values()).filter((p) => PLAIN_TYPES.has(p.type)).length;
    const bounds = MP.boundsOf(parts);
    const size = MP.sizeOf(bounds);
    const span = Math.max(...size);
    const issues = [];

    facts.size = size;
    facts.lowest = bounds[1];
    facts.plain = parts.filter((p) => PLAIN_TYPES.has(p.type)).length;
    facts.designParts = designParts;

    // ── one body ───────────────────────────────────────────────────────
    const linked = connectedShare(boxes, gap);
    facts.components = linked.components;
    if (linked.components > 1) {
      issues.push({ code: "loose-parts", detail: `${parts.length - linked.reached} part(s) in ${linked.components - 1} separate piece(s)` });
    }

    // ── joined rather than merely near ─────────────────────────────────
    const joined = joinedShare(boxes);
    if (joined < 1) {
      issues.push({ code: "seams", detail: `${Math.round((1 - joined) * parts.length)} part(s) do not share space with a neighbour` });
    }

    // ── carried by more than blocks ────────────────────────────────────
    // Full marks up to a third plain, then falling away. A crate is boxes and
    // should not be punished; a fish that is nine boxes should be.
    const plainShare = plainDesign / designParts;
    const shaped = clamp01((1 - plainShare) / (1 - 1 / 3));
    if (plainShare >= 0.7) {
      issues.push({ code: "placeholders", detail: `${plainDesign} of ${designParts} designed part(s) are plain boxes or balls` });
    }

    // ── symmetry ───────────────────────────────────────────────────────
    const sym = symmetryError(parts, boxes, pairing, span);
    facts.symmetricPairs = sym.pairs;
    // A thousandth of the model's longest side is below anything a person can
    // see; ten times that is a pair that visibly does not match.
    const symmetry = sym.pairs ? clamp01(1 - (sym.relative / 0.01)) : 1;
    if (sym.pairs && sym.relative > 0.01) {
      issues.push({ code: "asymmetric", detail: `a mirrored pair is out by ${sym.error.toFixed(3)}` });
    }

    // ── part count ─────────────────────────────────────────────────────
    // Inside the band, full marks. Outside it, falling off rather than
    // failing — nineteen parts is not a crime and neither is three.
    // The two ends of this measurement ask different questions, so they count
    // different things. Too few PARTS means the object was never articulated —
    // a fish that is one sphere — and a pattern's copies are real articulation.
    // Too many DESIGNED parts means a pile, and a pattern is the opposite of a
    // pile: it is the same decision made once and placed exactly. Counting the
    // copies at the top end would mark a clean twenty-four tooth gear down as
    // a mess, and counting families at the bottom would mark a heatsink down
    // for being written efficiently.
    let partCount = 1;
    if (parts.length < PART_FLOOR) partCount = clamp01(parts.length / PART_FLOOR);
    else if (designParts > PART_CEILING) partCount = clamp01(1 - (designParts - PART_CEILING) / PART_CEILING);

    // ── every part has a size ──────────────────────────────────────────
    // Counted against what the plan asked for, not against what survived. A
    // part dropped for having no size is a part the design meant to be there.
    const degenerate = facts.dropped;
    const wellFormed = received > 0 ? parts.length / received : 0;
    if (degenerate) issues.push({ code: "degenerate", detail: `${degenerate} part(s) had no measurable size and were dropped` });

    // ── the parts belong to the same object ────────────────────────────
    const spans = boxes.map(boxSpan).filter((v) => v > 1e-6);
    const spread = spans.length ? Math.max(...spans) / Math.min(...spans) : 1;
    facts.scaleSpread = spread;
    const scaleCoherence = clamp01(1 - Math.max(0, spread - SCALE_SPREAD_LIMIT) / SCALE_SPREAD_LIMIT);
    if (spread > SCALE_SPREAD_LIMIT) {
      issues.push({ code: "scale-spread", detail: `the largest part is ${Math.round(spread)}× the smallest` });
    }

    // ── nothing hidden inside a copy of itself ─────────────────────────
    const twinIndex = new Map();
    {
      const byId = new Map(parts.map((p, i) => [p.id, i]));
      for (const [id, twinId] of pairing) {
        const a = byId.get(id);
        const b = byId.get(twinId);
        if (a != null && b != null) { twinIndex.set(a, b); twinIndex.set(b, a); }
      }
    }
    const duplicates = duplicateCount(boxes, span, twinIndex);
    facts.duplicates = duplicates;
    const distinct = 1 - duplicates / parts.length;
    if (duplicates) {
      issues.push({ code: "duplicates", detail: `${duplicates} part(s) sit on top of geometry just like them` });
    }

    const values = {
      oneBody: linked.share,
      distinct,
      joined,
      shaped,
      symmetry,
      partCount,
      wellFormed,
      scaleCoherence,
    };

    // Weights are shared out again over the measurements that apply, so a model
    // with nothing mirrored is judged only on what can be judged.
    const applicable = MEASURES.filter((m) => !m.whenApplicable || m.id !== "symmetry" || sym.pairs > 0);
    const totalWeight = applicable.reduce((sum, m) => sum + m.weight, 0) || 1;
    const total = applicable.reduce((sum, m) => sum + m.weight * clamp01(values[m.id]), 0);

    return {
      // Rounded to one place. A score that moves in the fourth decimal because
      // a float landed differently is a ratchet that fails for no reason.
      score: Math.round((total / totalWeight) * 1000) / 10,
      measures: MEASURES.map((m) => ({
        id: m.id,
        label: m.label,
        value: Math.round(clamp01(values[m.id]) * 1000) / 1000,
        weight: m.weight,
        applicable: applicable.includes(m),
      })),
      facts,
      issues,
    };
  }

  /** Score a whole corpus. The mean, and every entry, worst first. */
  function scoreAll(entries, opts = {}) {
    const rows = (entries || []).map((entry) => ({
      id: String(entry.id || entry.name || "unnamed"),
      prompt: String(entry.prompt || ""),
      ...score(entry.plan || entry, opts),
    }));
    rows.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    const mean = rows.length
      ? Math.round((rows.reduce((sum, r) => sum + r.score, 0) / rows.length) * 10) / 10
      : 0;
    return { mean, rows };
  }

  window.HCForgeMeasure = {
    CONTACT_GAP,
    PART_FLOOR,
    PART_CEILING,
    MEASURES,
    score,
    scoreAll,
  };
})();
