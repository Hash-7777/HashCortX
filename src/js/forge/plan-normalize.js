// ==============================================================
// Plan normalising — the one gate a design passes through
//
// Everything the Forge builds arrives here first: a plan written by a model,
// a plan read out of a saved project, a plan imported from a file. This turns
// whatever arrived into the exact shape the assembler expects.
//
// It rebuilds every node from a fixed list of fields, which is the safe way to
// handle text a model wrote, and also this file's one real hazard: a field
// missing from that list is dropped in silence. That has happened three times
// already. Mirroring was asked for and never appeared, so no generated model
// was ever symmetrical. Repeats went the same way. So did the flag that makes
// a part cut a hole, which turned holes into solid lumps. Each was invisible
// because a dropped field throws nothing — the feature simply stops happening.
//
// The checks in scripts/checks/forge-plan-normalize.mjs guard the list itself,
// so the next field to go missing fails a check instead of shipping.
//
// Pure: takes a plan, returns a plan. No DOM, no storage, no network.
//
// Loaded before the Forge mode and published as window.HCForgePlanNormalize.
// ==============================================================

(function () {
  'use strict';

  /**
   * The most parts one plan may carry. A model asked for a hundred thousand
   * would otherwise be built.
   */
  const MAX_FORGE_NODES = 96;

  /** The shapes the assembler can actually build. */
  const SHAPE_NAMES = ['box', 'cylinder', 'capsule', 'sphere', 'cone', 'torus', 'lathe', 'extrude', 'logo', 'logo_img', 'mesh'];

  function vec3(v, fallback) {
    return Array.isArray(v) && v.length >= 3
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : fallback.slice();
  }

  /**
   * The mirror plane a node names, read through the assembler's own reader so
   * the two cannot drift apart.
   *
   * The standby below is used only if the assembler is not loaded. It used to
   * honour `true` and nothing else, which quietly failed on this function's own
   * output: normalising turns `true` into `"x"`, so normalising a second time
   * read `"x"` as "not mirrored" and switched the symmetry off. Plans are
   * normalised again every time a saved project is opened, so on that path a
   * mirrored part came back single. It now reads what the assembler reads.
   */
  function mirrorAxis(value) {
    const P = window.HCModelPlan;
    if (P && typeof P.mirrorAxisOf === 'function') return P.mirrorAxisOf(value);
    if (value === true) return 'x';
    const name = String(value || '').trim().toLowerCase();
    return name === 'x' || name === 'y' || name === 'z' ? name : null;
  }

  /**
   * One node, rebuilt from the fixed list.
   *
   * Every field here is on the list for the same reason: dropped, it fails
   * silently. Read the file header before removing one.
   */
  function normalizeNode(node, i, substitutions) {
    const MP = window.HCModelPlan;
    const resolved = MP?.resolveType
      ? MP.resolveType(node)
      : {
          type: SHAPE_NAMES.includes(node.type) ? node.type : 'box',
          from: SHAPE_NAMES.includes(node.type) ? null : String(node.type || ''),
        };
    // A shape the app cannot build used to become a one-unit box here, without
    // a word. So a design that had written an egg, a pipe and a ring came back
    // as three identical cubes, and the app looked incapable of a curve it had
    // never been asked for. The nearest real shape is used instead, and every
    // substitution is carried on the plan so the run can say it happened.
    if (resolved.from) {
      substitutions.push(`${String(node.name || node.id || `Node ${i + 1}`)}: "${resolved.from}" → ${resolved.type}`);
    }

    return {
      id: String(node.id || `node_${i + 1}`),
      name: String(node.name || node.id || `Node ${i + 1}`),
      type: resolved.type,
      role: ['structure', 'surface', 'detail', 'audit'].includes(node.role) ? node.role : 'structure',
      position: vec3(node.position, [0, 0, 0]),
      rotation: vec3(node.rotation, [0, 0, 0]),
      scale: vec3(node.scale, [1, 1, 1]),
      params: node.params && typeof node.params === 'object' ? node.params : {},
      color: node.color,
      opacity: Number.isFinite(node.opacity) ? node.opacity : undefined,
      // Symmetry is asked of the model and made by the app: the design prompt
      // tells it to build one side and mark the part mirrored. That flag was
      // once not on this list, so it was dropped on the way to the assembler
      // and no generated model was ever mirrored. What arrived was the half
      // that was asked for: one wing, one fin.
      //
      // The value may name its plane, and `true` still means x, so a plan
      // written before this reads exactly as it did.
      mirror: mirrorAxis(node.mirror) || false,
      // The pairing the assembler writes back, so a saved model reopens as
      // pairs rather than as parts that happen to face each other — and the
      // plane it was made across, without which a repair pass moves a twin
      // along the wrong axis and breaks the symmetry it is protecting.
      mirroredFrom: typeof node.mirroredFrom === 'string' ? node.mirroredFrom : undefined,
      mirroredOn: mirrorAxis(node.mirroredOn) || undefined,
      hasMirror: node.hasMirror === true ? true : undefined,
      // A request to repeat, and the pairing repeating leaves behind.
      repeat: node.repeat && typeof node.repeat === 'object' && !Array.isArray(node.repeat) ? node.repeat : undefined,
      repeatedFrom: typeof node.repeatedFrom === 'string' ? node.repeatedFrom : undefined,
      // What this part does to the material already there: a hole that quietly
      // stops being a hole is a solid lump nobody asked for.
      op: node.op === 'subtract' || node.op === 'intersect' ? node.op : undefined,
      blend: Number.isFinite(Number(node.blend)) && Number(node.blend) > 0 ? Number(node.blend) : undefined,
    };
  }

  /**
   * Turn anything plan-shaped into the plan the assembler expects.
   *
   * Running this on a plan it has already returned gives the same plan back:
   * saved projects are normalised again every time they are opened, and a
   * field that survived the first pass but not the second would mean a model
   * that changed shape on reopening.
   */
  function normalizePlan(plan) {
    const src = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : { name: 'Empty model', nodes: [] };
    const nodes = Array.isArray(src.nodes) ? src.nodes : [];
    // Substitutions already recorded are kept, not started afresh.
    //
    // A plan is often normalised more than once before anything reports on it:
    // the centring pass normalises what it is handed, and building normalises
    // again. The second pass sees types this function already resolved, finds
    // nothing to substitute, and handed back an empty list — so the warning
    // that a shape had been swapped never reached the screen, which is the
    // silence this list was added to break.
    const substitutions = Array.isArray(src.shapeSubstitutions) ? src.shapeSubstitutions.slice() : [];
    const units = window.HCForgeUnits ? window.HCForgeUnits.sizeMmOf(src) : null;

    return {
      shapeSubstitutions: substitutions,
      name: src.name || 'Forged model',
      // The intro mark floats and is framed by hand. Losing that flag here is
      // how it came to be set on the floor, out of the shot built for it.
      _introLogo: src._introLogo === true ? true : undefined,
      glbUrl: typeof src.glbUrl === 'string' ? src.glbUrl : '',
      // How big the object is in life. Carried beside the geometry and never
      // inside it, so changing it re-labels the model rather than distorting it.
      sizeMm: units ? units.mm : undefined,
      // Whether a real-world size was actually asked for, or defaulted.
      //
      // `sizeMm` above is filled with a default when a design states no size,
      // so on a second pass that default is indistinguishable from a size
      // someone chose, and this flag would flip to "stated" on its own. The
      // panel reads it to say "this size is a default until you set it", so
      // the note vanished and a printed part carried a size nobody picked.
      // Plans are normalised again whenever a project is opened, so an
      // explicit "not stated" is carried forward instead of being worked out
      // again from the field this function itself filled in.
      sizeStated: units ? (src.sizeStated === false ? false : units.stated) : false,
      // The named values a design's arithmetic is written in terms of. Dropped
      // here, every expression in the plan would resolve to nothing and the
      // whole model would fall back to defaults without a word.
      vars: src.vars && typeof src.vars === 'object' && !Array.isArray(src.vars) ? src.vars : undefined,
      // How thick a wall to leave when this is fused: one missing here and a
      // person who asked for a hollow part gets a solid one.
      hollowMm: Number(src.hollowMm) > 0 ? Math.min(50, Number(src.hollowMm)) : undefined,
      // What produced this model, without which a saved project would forget
      // where it came from the moment it reopened.
      madeBy: src.madeBy && typeof src.madeBy === 'object' && !Array.isArray(src.madeBy) ? src.madeBy : undefined,
      constraints: Array.isArray(src.constraints) ? src.constraints : [],
      edges: Array.isArray(src.edges) ? src.edges : [],
      nodes: nodes.slice(0, MAX_FORGE_NODES).map((node, i) => normalizeNode(node && typeof node === 'object' ? node : {}, i, substitutions)),
    };
  }

  window.HCForgePlanNormalize = { normalizePlan, mirrorAxis, vec3, SHAPE_NAMES, MAX_FORGE_NODES };
})();
