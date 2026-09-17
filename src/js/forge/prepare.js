// ==============================================================
// Preparing a design — the one path from a model's answer to the scene
//
// Every design the Forge builds from a model — a new one from Generate and a
// corrected one from Improve — goes through preparePlan, in this order:
//
//   1. the plan gate, which works out arithmetic and rebuilds every part from
//      a fixed list of fields (js/forge/plan-normalize.js);
//   2. the assembler, which repeats, mirrors, brings the model to the scene's
//      size, joins near parts and closes seams (js/model-plan.js);
//   3. one subject: parts that form a separate cluster away from the main body
//      are removed, unless the prompt asked for several things;
//   4. centring over the origin on X and Z. Height is left to the viewport,
//      which sets the built meshes on the floor from their real geometry.
//
// Why this is one module. Steps 3 and 4 used to live in the mode and ran
// BEFORE the assembler, on the design as written — before its arithmetic was
// worked out and before it was brought to size — with distances fixed in scene
// units. A design written in millimetres was judged with a slack of a fraction
// of a millimetre, and a size still written as a sum measured as not-a-number.
// And the corpus checks fed plans straight to the assembler, skipping the gate,
// so a gate that read every sum as zero passed them. Here the checks run the
// same path the app runs, and every step after the assembler works at the
// scene's size, whatever unit the design was written in.
//
// Pure: takes a plan, returns a plan and a report. No DOM, no log, no clock.
//
// Loaded after js/model-plan.js and js/forge/plan-normalize.js, published as
// window.HCForgePrepare. Checked by scripts/checks/forge-prepare.mjs.
// ==============================================================
(function () {
  "use strict";

  /**
   * Whether the prompt asks for more than one object, so nothing apart from
   * the main body should be taken away.
   */
  function allowsSeveralSubjects(prompt) {
    const q = String(prompt || "").toLowerCase();
    return /\b(two|three|four|five|pair|set of|collection|group|scene|diorama|room|city|street|landscape)\b/.test(q)
      || /\bon (a |the )?(table|desk|workbench|floor|shelf)\b/.test(q);
  }

  /**
   * Parts grouped by whether they reach each other, largest group first.
   *
   * Each part is judged by the sphere around its measured box, turned as it is
   * turned. The slack two parts may be apart and still count as together is a
   * share of the model's own size, so it means the same on any model.
   */
  function clustersOf(parts) {
    const MP = window.HCModelPlan;
    const box = MP.boundsOf(parts);
    const size = MP.sizeOf(box);
    const longest = Math.max(...size, 1e-9);
    const diag = Math.hypot(size[0], size[1], size[2]);
    const slack = Math.max(longest * 0.11, Math.min(longest * 0.375, diag * 0.14));
    const items = parts.map((part) => {
      const b = MP.partBox(part);
      return {
        part,
        centre: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2],
        radius: Math.max(longest * 0.0175, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2),
      };
    });
    const parent = items.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const d = Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1], a.centre[2] - b.centre[2]);
        if (d <= a.radius + b.radius + slack) parent[find(j)] = find(i);
      }
    }
    const groups = new Map();
    items.forEach((item, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(item.part);
    });
    return [...groups.values()].sort((a, b) => b.length - a.length);
  }

  /**
   * Keep the main body, and only when it is clearly the main body.
   *
   * A group is removed only when the largest group holds at least four parts
   * and nearly half the model — otherwise there is no main body to prefer and
   * nothing is taken away. Audit parts are never judged.
   */
  function keepOneSubject(parts, prompt) {
    const unchanged = { parts, removed: [] };
    if (allowsSeveralSubjects(prompt)) return unchanged;
    const body = parts.filter((p) => p.role !== "audit");
    if (body.length < 4) return unchanged;
    const clusters = clustersOf(body);
    if (clusters.length <= 1) return unchanged;
    const largest = clusters[0];
    if (largest.length < Math.max(4, body.length * 0.45)) return unchanged;
    const keep = new Set(largest.map((p) => p.id));
    return {
      parts: parts.filter((p) => p.role === "audit" || keep.has(p.id)),
      removed: body.filter((p) => !keep.has(p.id)).map((p) => p.id),
    };
  }

  /**
   * Move the model so its measured box is centred over the origin on X and Z.
   *
   * Not along an axis the model was mirrored across. Mirroring makes pairs
   * exactly opposite about that plane, which is the design's own centre line;
   * a model whose two sides are not the same size has a box that is off it, and
   * centring the box would pull every pair off the plane they were made about.
   */
  function centreOnAxis(parts) {
    const MP = window.HCModelPlan;
    const body = parts.filter((p) => p.role !== "audit");
    const box = body.length ? MP.boundsOf(body) : null;
    if (!box) return parts;
    const mirrored = new Set(body.map((p) => p.mirroredOn).filter(Boolean));
    const dx = mirrored.has("x") ? 0 : -(box[0] + box[3]) / 2;
    const dz = mirrored.has("z") ? 0 : -(box[2] + box[5]) / 2;
    const tolerance = Math.max(...MP.sizeOf(box)) * 5e-4;
    if (Math.abs(dx) <= tolerance && Math.abs(dz) <= tolerance) return parts;
    return parts.map((p) => ({ ...p, position: [p.position[0] + dx, p.position[1], p.position[2] + dz] }));
  }

  /**
   * A design as a model wrote it, made into the plan the scene builds.
   *
   * Returns `empty: true` with the gate's plan when nothing in the design could
   * be measured, so a caller never replaces a scene with nothing.
   */
  function preparePlan(plan, opts = {}) {
    const NP = window.HCForgePlanNormalize;
    const MP = window.HCModelPlan;
    const gate = NP.normalizePlan(plan);
    const out = MP.assemble(gate, { ground: false, targetSize: opts.targetSize || 0 });
    if (!out.parts.length) {
      return { plan: gate, empty: true, report: { stats: out.stats, issues: out.issues, moves: [], seams: [], removed: [] } };
    }
    const single = keepOneSubject(out.parts, opts.prompt);
    const parts = centreOnAxis(single.parts);
    return {
      // The size may have been written as arithmetic, and the assembler hands
      // back the value it worked out.
      plan: { ...gate, nodes: parts, sizeMm: out.sizeMm ?? gate.sizeMm },
      empty: false,
      report: { stats: out.stats, issues: out.issues, moves: out.moves || [], seams: out.seams || [], removed: single.removed },
    };
  }

  window.HCForgePrepare = { preparePlan, keepOneSubject, centreOnAxis, allowsSeveralSubjects };
})();
