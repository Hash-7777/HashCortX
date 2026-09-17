// ==============================================================
// Improve — what a correcting model is shown, and what its answer changes
//
// Improve sends the model on screen back to a model with what measures wrong,
// and applies the parts it answers with. Two things made that answer land
// badly, and both are arithmetic, so both are here where they can be checked:
//
//   UNITS. A built model is stored at the scene's working span, so its numbers
//   are neither the unit it was designed in nor anything real: a part carries
//   sizes from the design and a scale that shrank them to fit the scene. That
//   was sent as it was, and a model answering in millimetres — which is what a
//   design is asked for — had its replacement parts merged in beside those,
//   hundreds of times too large. Now the plan is shown in millimetres, the
//   answer is read as millimetres, and both are converted through the same
//   factor the screen measures with.
//
//   PAIRS. Mirroring makes a second part, and a correction to one side of a
//   pair used to change that side only, so a fixed wing no longer matched its
//   partner. Now a change to either side becomes a change to the original,
//   the copy is dropped, and the original is marked to be mirrored again, so
//   the assembler makes the pair exact once more. Removing either side
//   removes both.
//
// Pure: no DOM, no network, no log. Published as window.HCForgeImprove and
// checked by scripts/checks/forge-improve.mjs.
// ==============================================================
(function () {
  "use strict";

  const AXIS = { x: 0, y: 1, z: 2 };
  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const mul = (v, k) => (Array.isArray(v) ? v.map((x) => num(x) * k) : v);

  /**
   * A part as the model is shown it: positions, scale and blend in millimetres.
   * Its params are left as they are, so its real size is params times scale.
   */
  function toMillimetres(node, mmPerUnit) {
    const k = mmPerUnit > 0 ? mmPerUnit : 1;
    const out = { ...node, position: mul(node.position, k), scale: mul(node.scale, k) };
    if (node.blend !== undefined) out.blend = num(node.blend) * k;
    return out;
  }

  /**
   * A part the model answered with, read as millimetres, in scene units.
   *
   * A NEW part given without a scale has its sizes read as millimetres. A
   * replacement without a scale keeps the scale the part had: it was shown as
   * sizes times that scale, and a model that changed only a size meant only
   * that. Reading it as millimetres instead would shrink or swell any part
   * whose sizes were written in another unit.
   */
  function fromMillimetres(node, mmPerUnit, { isNew = false } = {}) {
    const k = mmPerUnit > 0 ? mmPerUnit : 1;
    const out = { ...node };
    if (Array.isArray(node.position)) out.position = mul(node.position, 1 / k);
    if (Array.isArray(node.scale)) out.scale = mul(node.scale, 1 / k);
    else if (isNew) out.scale = [1 / k, 1 / k, 1 / k];
    else delete out.scale;
    if (node.blend !== undefined) out.blend = num(node.blend) / k;
    return out;
  }

  /** The inverse of mirroring a part across `axis`, which is mirroring it again. */
  function reflect(node, axis) {
    const k = AXIS[axis] ?? 0;
    const out = { ...node };
    if (Array.isArray(node.position)) out.position = node.position.map((v, i) => (i === k ? -num(v) : num(v)));
    if (Array.isArray(node.scale)) out.scale = node.scale.map((v, i) => (i === k ? -num(v) : num(v)));
    if (Array.isArray(node.rotation)) out.rotation = node.rotation.map((v, i) => (i === k ? num(v) : -num(v)));
    return out;
  }

  /**
   * Arithmetic the answer wrote is worked out first. The plan's own names are
   * not in the answer's scope — they were written in the design's unit, and the
   * answer is in millimetres — so only plain sums resolve.
   */
  function resolved(nodes) {
    const expr = typeof window !== "undefined" ? window.HCForgeExpr : null;
    return expr ? expr.resolvePlan({ nodes }).plan.nodes : nodes;
  }

  /**
   * Apply a correction to the parts on screen.
   *
   * `patch` is `{ remove, replace, add }` as the model answered it. Returns the
   * new parts and what happened, in counts a run can report.
   */
  function applyPatch(nodes, patch, mmPerUnit) {
    const list = Array.isArray(nodes) ? nodes : [];
    const byId = new Map(list.map((n) => [String(n.id), n]));
    const twinsOf = (id) => list.filter((n) => n.mirroredFrom === id).map((n) => String(n.id));

    const removed = new Set();
    for (const id of (Array.isArray(patch?.remove) ? patch.remove : []).map(String)) {
      if (!byId.has(id)) continue;
      const node = byId.get(id);
      const source = node.mirroredFrom && byId.has(node.mirroredFrom) ? node.mirroredFrom : id;
      removed.add(source);
      twinsOf(source).forEach((t) => removed.add(t));
    }

    const replacements = new Map();
    const remirror = new Map();   // original id → axis to mirror again
    const answered = resolved((Array.isArray(patch?.replace) ? patch.replace : []).filter((n) => n && n.id !== undefined));
    for (const raw of answered) {
      const id = String(raw.id);
      const node = byId.get(id);
      if (!node || removed.has(id)) continue;
      let change = fromMillimetres(raw, mmPerUnit);
      let target = id;
      if (node.mirroredFrom && byId.has(node.mirroredFrom)) {
        // A change to the copy is a change to the original, seen in a mirror.
        target = node.mirroredFrom;
        if (replacements.has(target)) continue;          // the original was answered too; it wins
        change = { ...reflect(change, node.mirroredOn || "x"), id: target, name: byId.get(target).name };
      }
      // An original answered after its copy replaces what the copy said.
      replacements.set(target, change);
      const axis = byId.get(target).mirroredOn;
      if (twinsOf(target).length && axis) remirror.set(target, axis);
    }

    const dropped = new Set(removed);
    for (const id of remirror.keys()) twinsOf(id).forEach((t) => dropped.add(t));
    const kept = list
      .filter((n) => !dropped.has(String(n.id)))
      .map((n) => {
        const id = String(n.id);
        if (!replacements.has(id)) return n;
        const merged = { ...n, ...replacements.get(id), id };
        if (remirror.has(id)) {
          merged.mirror = remirror.get(id);
          merged.hasMirror = undefined;
        }
        return merged;
      });

    const added = resolved((Array.isArray(patch?.add) ? patch.add : []).filter((n) => n && typeof n === "object"))
      .map((n) => fromMillimetres(n, mmPerUnit, { isNew: true }));

    return {
      nodes: kept.concat(added),
      counts: { changed: replacements.size, added: added.length, removed: [...removed].filter((id) => !byId.get(id)?.mirroredFrom).length },
    };
  }

  window.HCForgeImprove = { toMillimetres, fromMillimetres, reflect, applyPatch };
})();
