// ============================================================
// model-plan.js — turning a model's answer into geometry you can trust
//
// A generated 3D model arrives as a list of parts a language model wrote. Some
// of what makes that list *look right* is judgement, and a model is good at it:
// which parts a fish has, roughly where a fin sits. The rest is arithmetic —
// is it symmetric, does it touch the floor, is it the right size, is any of it
// degenerate — and a model is bad at that, expensive to ask, and cannot be held
// to its answer.
//
// So the arithmetic lives here, in code, and runs on every plan. Symmetry is
// produced by mirroring rather than requested in a prompt; the floor is found
// by measuring; scale is normalised; parts that cannot be rendered are dropped
// with a reason. What used to be an Audit Agent — a model call that reported on
// clearance and balance, and sometimes added geometry of its own — is this file.
//
// Everything is pure: no THREE, no DOM, no network. Which is what lets
// scripts/checks/model-plan.mjs load this exact source and hold it to its rules.
// ============================================================
(function () {
  "use strict";

  // Coordinates outside this are almost always a model losing track of scale —
  // a part at z = 480 puts the camera in the next county and the object becomes
  // an invisible speck. Clamped rather than dropped: the part is usually wanted,
  // its position is what went wrong.
  const COORD_LIMIT = 12;

  // A part thinner than this in every axis renders as nothing at all.
  const MIN_EXTENT = 1e-4;

  // The shapes the viewport can actually build.
  const SHAPES = new Set([
    "box", "cylinder", "capsule", "sphere", "cone", "torus",
    "lathe", "extrude", "mesh", "logo", "logo_img",
  ]);

  // What a model calls a shape when it does not use the name in the schema.
  // Every one of these was previously turned into a one-unit box without a
  // word, which is how a design that had described an egg, a pipe and a ring
  // arrived as three identical cubes — and why the answer looked like the app
  // could not do curves, when the app had never been told to make one.
  const SHAPE_ALIASES = {
    cube: "box", rect: "box", rectangle: "box", block: "box", prism: "box",
    plane: "box", panel: "box", slab: "box", "rounded_box": "box", roundedbox: "box",
    ellipsoid: "sphere", ball: "sphere", oval: "sphere", spheroid: "sphere",
    tube: "cylinder", pipe: "cylinder", rod: "cylinder", disc: "cylinder", disk: "cylinder",
    pill: "capsule", stadium: "capsule",
    ring: "torus", donut: "torus", torus_knot: "torus",
    revolve: "lathe", revolution: "lathe", turned: "lathe", profile: "lathe",
    polygon: "extrude", shape: "extrude", silhouette: "extrude", outline: "extrude",
    custom: "mesh", geometry: "mesh", polymesh: "mesh", surface: "mesh", triangles: "mesh",
    pyramid: "cone", spike: "cone",
  };

  /**
   * Which shape a part is, when the plan does not name one the app knows.
   *
   * Falling back to a box loses the whole part: a silhouette written as a list
   * of points becomes a cube, and nothing anywhere says so. So the name is
   * checked, then the common synonyms, and then the part's own contents —
   * vertex positions mean a mesh, a list of two-number points means a profile
   * to extrude. Only a part that has said nothing usable becomes a box, and
   * that is reported rather than assumed.
   */
  function resolveType(node) {
    // Not "raw": the checks read every `raw.<field>` in this file as a field
    // the mode must pass through, and a local of that name is a false alarm.
    const named = String(node?.type || "").trim().toLowerCase();
    if (SHAPES.has(named)) return { type: named, from: null };
    const alias = SHAPE_ALIASES[named] || SHAPE_ALIASES[named.replace(/[\s-]+/g, "_")];
    if (alias) return { type: alias, from: named };
    const p = node?.params && typeof node.params === "object" ? node.params : {};
    if (Array.isArray(p.positions) && p.positions.length >= 9) return { type: "mesh", from: named };
    if (Array.isArray(p.points) && p.points.length >= 3
        && p.points.every((pt) => Array.isArray(pt) && pt.length >= 2)) {
      return { type: "extrude", from: named };
    }
    return { type: "box", from: named };
  }

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function triple(value, fallback) {
    const src = Array.isArray(value) ? value : [];
    return [0, 1, 2].map((i) => num(src[i], fallback[i]));
  }

  /**
   * Half the size of a part on each axis, from whatever its type uses to
   * describe itself. This is an estimate and says so: an extruded outline is
   * measured from its points, a lathe from its profile, and anything that
   * describes itself in no recognisable way falls back to a small cube so it
   * still takes part in the bounds rather than silently counting as zero.
   */
  function halfExtents(part) {
    const p = part.params || {};
    const s = part.scale;
    const byPoints = (points, axis) => {
      if (!Array.isArray(points) || !points.length) return null;
      let max = 0;
      for (const pt of points) {
        const v = Array.isArray(pt) ? num(pt[axis], 0) : 0;
        max = Math.max(max, Math.abs(v));
      }
      return max || null;
    };

    let hx, hy, hz;
    switch (part.type) {
      case "box":
        hx = num(p.width, 1) / 2; hy = num(p.height, 1) / 2; hz = num(p.depth, 1) / 2; break;
      case "sphere":
        hx = hy = hz = num(p.radius, 0.5); break;
      case "capsule": {
        const r = num(p.radius, 0.25);
        hx = hz = r; hy = num(p.length, 0.5) / 2 + r; break;
      }
      case "cylinder":
      case "cone": {
        const r = num(p.radius, 0.5);
        hx = hz = r; hy = num(p.height, 1) / 2; break;
      }
      case "torus": {
        const r = num(p.radius, 0.5), tube = num(p.tube, 0.1);
        hx = hz = r + tube; hy = tube; break;
      }
      case "extrude": {
        hx = byPoints(p.points, 0) ?? 0.5;
        hy = byPoints(p.points, 1) ?? 0.5;
        hz = num(p.depth, num(p.length, 0.2)) / 2; break;
      }
      case "lathe": {
        const r = byPoints(p.points, 0) ?? 0.5;
        hx = hz = r;
        hy = byPoints(p.points, 1) ?? num(p.height, 0.5); break;
      }
      case "mesh": {
        const pos = Array.isArray(p.positions) ? p.positions : null;
        if (pos && pos.length >= 3) {
          let mx = 0, my = 0, mz = 0;
          for (let i = 0; i + 2 < pos.length; i += 3) {
            mx = Math.max(mx, Math.abs(num(pos[i], 0)));
            my = Math.max(my, Math.abs(num(pos[i + 1], 0)));
            mz = Math.max(mz, Math.abs(num(pos[i + 2], 0)));
          }
          hx = mx; hy = my; hz = mz;
        } else { hx = hy = hz = 0.5; }
        break;
      }
      default:
        hx = hy = hz = 0.5;
    }
    return [Math.abs(hx * s[0]), Math.abs(hy * s[1]), Math.abs(hz * s[2])];
  }

  /**
   * The rotation matrix three.js builds from a part's Euler angles.
   *
   * Written out rather than approximated because this module has to agree with
   * what the viewport draws. The order is three.js's default, XYZ.
   */
  function rotationMatrix(rotation) {
    const [x, y, z] = triple(rotation, [0, 0, 0]);
    const a = Math.cos(x), b = Math.sin(x);
    const c = Math.cos(y), d = Math.sin(y);
    const e = Math.cos(z), f = Math.sin(z);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    return [
      [c * e, -c * f, d],
      [af + be * d, ae - bf * d, -b * c],
      [bf - ae * d, be + af * d, a * c],
    ];
  }

  /**
   * The box a single part occupies, as [minX,minY,minZ,maxX,maxY,maxZ].
   *
   * Rotation is part of the measurement. A fuselage is a cylinder turned on
   * its side, and measured from its parameters alone it comes out as a tall
   * column standing where a long body should lie — so everything downstream
   * that asks where a part is, whether it touches its neighbour, and where the
   * bottom of the model sits, was answering about a shape that is not on
   * screen. Turning the part's half-extents by its own rotation and taking the
   * enclosing box is the standard result, and it is exact for a box.
   */
  function partBox(part) {
    const h = halfExtents(part);
    const m = rotationMatrix(part.rotation);
    const [x, y, z] = part.position;
    const ext = [0, 1, 2].map((i) => (
      Math.abs(m[i][0]) * h[0] + Math.abs(m[i][1]) * h[1] + Math.abs(m[i][2]) * h[2]
    ));
    return [x - ext[0], y - ext[1], z - ext[2], x + ext[0], y + ext[1], z + ext[2]];
  }

  /** The box every part occupies together, or null when there are no parts. */
  function boundsOf(parts) {
    if (!parts.length) return null;
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const part of parts) {
      const pb = partBox(part);
      for (let i = 0; i < 3; i++) b[i] = Math.min(b[i], pb[i]);
      for (let i = 3; i < 6; i++) b[i] = Math.max(b[i], pb[i]);
    }
    return b;
  }

  const sizeOf = (box) => (box ? [box[3] - box[0], box[4] - box[1], box[5] - box[2]] : [0, 0, 0]);

  /**
   * Put a plan's parts into a shape the rest of the pipeline can rely on:
   * every field present, every number finite, ids unique, coordinates inside a
   * sane range, and nothing that renders to nothing.
   *
   * Returns the parts it kept and a note for every one it changed or dropped,
   * because a part disappearing without explanation is how a model ends up
   * missing a leg and nobody knows why.
   */
  function normaliseParts(nodes, opts = {}) {
    const limit = num(opts.coordLimit, COORD_LIMIT);
    const parts = [];
    const issues = [];
    const seen = new Set();

    for (const raw of Array.isArray(nodes) ? nodes : []) {
      if (!raw || typeof raw !== "object") {
        issues.push({ code: "not-a-part", detail: "entry was not an object" });
        continue;
      }
      let id = String(raw.id || raw.name || "part").trim() || "part";
      if (seen.has(id)) {
        let n = 2;
        while (seen.has(`${id}_${n}`)) n++;
        issues.push({ code: "duplicate-id", partId: id, detail: `renamed to ${id}_${n}` });
        id = `${id}_${n}`;
      }
      seen.add(id);

      const position = triple(raw.position, [0, 0, 0]).map((v) => {
        const c = clamp(v, -limit, limit);
        if (c !== v) issues.push({ code: "coordinate-clamped", partId: id, detail: `${v} → ${c}` });
        return c;
      });
      const scale = triple(raw.scale, [1, 1, 1]).map((v) => (v === 0 ? 1 : v));

      const part = {
        id,
        name: String(raw.name || id),
        type: String(raw.type || "box"),
        role: String(raw.role || "structure"),
        position,
        rotation: triple(raw.rotation, [0, 0, 0]),
        scale,
        params: raw.params && typeof raw.params === "object" ? raw.params : {},
        color: typeof raw.color === "string" ? raw.color : undefined,
        // Only an explicit flag. A name test used to sit in this expression —
        // and could never change its result, because both branches ended at
        // raw.mirror. Guessing from a name would be worse than dead anyway: a
        // plan that already contains "leg_fl" and "leg_fr" would have each of
        // them mirrored again, and the chair would arrive with six legs.
        mirror: raw.mirror === true,
      };

      const [hx, hy, hz] = halfExtents(part);
      if (hx < MIN_EXTENT && hy < MIN_EXTENT && hz < MIN_EXTENT) {
        issues.push({ code: "degenerate", partId: id, detail: "no measurable size" });
        continue;
      }
      if (![hx, hy, hz].every(Number.isFinite)) {
        issues.push({ code: "not-a-number", partId: id, detail: "size did not resolve to a number" });
        continue;
      }
      parts.push(part);
    }
    return { parts, issues };
  }

  /**
   * Symmetry, made rather than requested.
   *
   * A part marked `mirror` is duplicated across x = 0 with its x position and
   * x scale negated. Asking a model for "two fins, mirrored" gets two fins in
   * roughly the right places; doing it here gets two fins that are exactly
   * opposite, every time, for no tokens. A part already sitting on the axis is
   * left alone — mirroring it would put a second copy inside the first.
   */
  function expandMirrors(parts, opts = {}) {
    const epsilon = num(opts.epsilon, 1e-3);
    const out = [];
    const issues = [];
    for (const part of parts) {
      if (!part.mirror) { out.push(part); continue; }
      if (Math.abs(part.position[0]) <= epsilon) {
        issues.push({ code: "mirror-on-axis", partId: part.id, detail: "sits on the mirror plane; not duplicated" });
        out.push({ ...part, mirror: false });
        continue;
      }
      // The flag comes off the original as the copy is made. It is a request,
      // and it has now been met — left on, a second pass over the same parts
      // would mirror them again.
      out.push({ ...part, mirror: false, hasMirror: true });
      out.push({
        ...part,
        id: `${part.id}_mirrored`,
        name: `${part.name} (mirrored)`,
        position: [-part.position[0], part.position[1], part.position[2]],
        rotation: [part.rotation[0], -part.rotation[1], -part.rotation[2]],
        scale: [-part.scale[0], part.scale[1], part.scale[2]],
        mirror: false,
        mirroredFrom: part.id,
      });
    }
    return { parts: out, issues };
  }

  /** Move everything so the lowest point rests on y = 0. */
  function snapToFloor(parts) {
    const box = boundsOf(parts);
    if (!box) return { parts, offset: 0 };
    const offset = -box[1];
    if (Math.abs(offset) < 1e-6) return { parts, offset: 0 };
    return {
      parts: parts.map((p) => ({ ...p, position: [p.position[0], p.position[1] + offset, p.position[2]] })),
      offset,
    };
  }

  /**
   * Scale the whole model so its longest axis measures `target`.
   *
   * The viewport's camera, grid and lighting are built for an object about a
   * metre across. A plan that came back 40 units long is not wrong, it is in
   * different units — and it arrives as a speck or as a wall.
   */
  function normaliseScale(parts, target = 1) {
    const box = boundsOf(parts);
    if (!box) return { parts, factor: 1 };
    const longest = Math.max(...sizeOf(box));
    if (!Number.isFinite(longest) || longest <= 0) return { parts, factor: 1 };
    const factor = target / longest;
    if (Math.abs(factor - 1) < 0.01) return { parts, factor: 1 };
    return {
      parts: parts.map((p) => ({
        ...p,
        position: p.position.map((v) => v * factor),
        scale: p.scale.map((v) => v * factor),
      })),
      factor,
    };
  }

  /**
   * Close the gaps that make a model read as a pile of parts.
   *
   * A design call places every part by naming coordinates, and it is placing
   * them blind — it never sees the result. Small errors there are not small on
   * screen: a wing sitting a tenth of a unit off the fuselage is a wing lying
   * beside an aeroplane, and a run can measure that, report every detached
   * part by name, and still hand over a pile.
   *
   * So the parts that do not reach the body are moved until they do. Each one
   * takes the shortest translation that brings it into contact with the part
   * it is already nearest to, which is the smallest change that can fix it:
   * a part touching on two axes and adrift on the third moves only on the
   * third, and nothing that already connects is touched at all.
   *
   * Two limits keep this a correction rather than a rearrangement:
   *
   *   · A part is only moved when the gap is small next to the model itself —
   *     `reach` of its longest axis. A part further away than that is not a
   *     misplaced wing, it is a second object or a mistake with an order of
   *     magnitude in it, and dragging it across the model would replace a
   *     visible defect with an inexplicable one. Those are left where they
   *     are and reported, exactly as before.
   *   · Mirrored pairs move together, and only when both are adrift. Fixing
   *     one wing of a pair and not the other is worse than fixing neither,
   *     and a pair where only one side is detached is not the symmetric case
   *     this is for.
   *
   * One part moves per pass, nearest gap first, so a part can attach to
   * something that only just attached itself — which is how a plan builds up
   * from its body outwards rather than all at once.
   */
  function connectParts(parts, opts = {}) {
    const gap = num(opts.gap, 0.06);
    const reach = num(opts.reach, 0.35);
    const moves = [];
    if (!Array.isArray(parts) || parts.length < 2) return { parts: parts || [], moves };

    const out = parts.map((p) => ({ ...p, position: [...p.position] }));
    const span = Math.max(...sizeOf(boundsOf(out)));
    if (!Number.isFinite(span) || span <= 0) return { parts: out, moves };
    const maxShift = reach * span;

    // Seat a part a hair INTO its neighbour rather than exactly against it.
    // A move that lands precisely on the contact test's boundary is a move
    // that rounding can leave a fraction short, and the pass would then pick
    // the same part again, close a gap of 1e-17, and do it once per pass while
    // every other detached part waited its turn.
    const bite = Math.min(gap * 0.5, span * 0.005);

    /**
     * The shortest move that brings box `a` into contact with box `b`.
     *
     * Contact means touching, not "within the tolerance". `gap` is how far
     * apart two parts may be and still count as connected — a detection
     * allowance, and using it here as the target left every repaired part
     * hanging exactly one tolerance away from the thing it was joined to,
     * which is a seam a person can see.
     */
    const closingMove = (a, b) => {
      const d = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if (a[k] > b[k + 3]) d[k] = -(a[k] - b[k + 3]) - bite;
        else if (b[k] > a[k + 3]) d[k] = b[k] - a[k + 3] + bite;
      }
      return d;
    };
    const lengthOf = (d) => Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const twinOf = (part) => out.findIndex((other) => (
      other !== part && (other.mirroredFrom === part.id || (part.mirroredFrom && other.id === part.mirroredFrom))
    ));

    for (let pass = 0; pass < out.length; pass++) {
      const boxes = out.map(partBox);
      const volume = (b) => Math.max(0, b[3] - b[0]) * Math.max(0, b[4] - b[1]) * Math.max(0, b[5] - b[2]);
      let root = 0;
      for (let i = 1; i < boxes.length; i++) if (volume(boxes[i]) > volume(boxes[root])) root = i;

      const touches = (a, b) => (
        a[0] - gap <= b[3] && b[0] - gap <= a[3] &&
        a[1] - gap <= b[4] && b[1] - gap <= a[4] &&
        a[2] - gap <= b[5] && b[2] - gap <= a[5]
      );
      const reached = new Set([root]);
      const queue = [root];
      while (queue.length) {
        const i = queue.shift();
        for (let j = 0; j < boxes.length; j++) {
          if (reached.has(j) || !touches(boxes[i], boxes[j])) continue;
          reached.add(j); queue.push(j);
        }
      }
      if (reached.size === boxes.length) break;

      // The smallest gap anywhere, so the model grows outwards from its body.
      let best = null;
      for (let i = 0; i < out.length; i++) {
        if (reached.has(i)) continue;
        for (const j of reached) {
          const d = closingMove(boxes[i], boxes[j]);
          const dist = lengthOf(d);
          if (dist <= bite) continue;
          if (!best || dist < best.dist) best = { i, j, d, dist };
        }
      }
      if (!best || best.dist > maxShift) break;

      const part = out[best.i];
      part.position = [part.position[0] + best.d[0], part.position[1] + best.d[1], part.position[2] + best.d[2]];
      moves.push({ partId: part.id, to: out[best.j].id, by: [...best.d] });

      const twin = twinOf(part);
      if (twin >= 0 && !reached.has(twin)) {
        const other = out[twin];
        other.position = [other.position[0] - best.d[0], other.position[1] + best.d[1], other.position[2] + best.d[2]];
        moves.push({ partId: other.id, to: out[best.j].id, by: [-best.d[0], best.d[1], best.d[2]], mirrored: true });
      }
    }
    return { parts: out, moves };
  }

  /**
   * Close the hairline seams, so the model reads as one piece.
   *
   * connectParts only moves a part the body cannot be reached from, and it
   * counts a part as reached when it is within `gap` of another. That is the
   * right test for "is this piece attached", and the wrong one for how the
   * model looks: a fin sitting 0.05 from a body is attached by that test and
   * still shows daylight through the join. On a model a few units across the
   * eye reads that line as the edge of a separate object, which is exactly the
   * pile-of-parts appearance the single material is meant to end.
   *
   * So every part that is near another without meeting it is seated a little
   * way in, the way two pieces of a printed object are fused rather than
   * balanced against each other. The smaller part moves — a fin joins a body,
   * a body does not shuffle over to meet a fin — and a mirrored twin moves with
   * it in the opposite direction across x, or closing one side would break the
   * symmetry the mirror pass just guaranteed.
   *
   * Parts further apart than `gap` are left alone: that is a real separation
   * and connectParts already had its say about it.
   */
  function seatParts(parts, opts = {}) {
    const gap = num(opts.gap, 0.06);
    const seams = [];
    if (!Array.isArray(parts) || parts.length < 2) return { parts: parts || [], seams };

    const out = parts.map((p) => ({ ...p, position: [...p.position] }));
    const span = Math.max(...sizeOf(boundsOf(out)));
    if (!Number.isFinite(span) || span <= 0) return { parts: out, seams };
    const bite = Math.min(gap * 0.5, span * 0.01);

    const boxes = out.map(partBox);
    const volume = (b) => Math.max(0, b[3] - b[0]) * Math.max(0, b[4] - b[1]) * Math.max(0, b[5] - b[2]);
    const overlaps = (a, b) => a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4] && a[2] < b[5] && b[2] < a[5];
    // How far apart two boxes are on each axis; zero where they already share
    // that axis. The move that joins them closes every axis at once.
    const separation = (a, b) => {
      const d = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if (a[k] > b[k + 3]) d[k] = -(a[k] - b[k + 3]) - bite;
        else if (b[k] > a[k + 3]) d[k] = b[k] - a[k + 3] + bite;
      }
      return d;
    };
    const lengthOf = (d) => Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const twinOf = (part) => out.findIndex((other) => (
      other !== part && (other.mirroredFrom === part.id || (part.mirroredFrom && other.id === part.mirroredFrom))
    ));

    // Smallest first, so a detail is seated into the mass it belongs to before
    // that mass is ever considered for moving into the detail.
    const order = out.map((_, i) => i).sort((a, b) => volume(boxes[a]) - volume(boxes[b]));
    const moved = new Set();
    for (const i of order) {
      if (moved.has(i)) continue;
      let best = null;
      for (let j = 0; j < out.length; j++) {
        if (i === j) continue;
        if (overlaps(boxes[i], boxes[j])) { best = null; break; }
        if (volume(boxes[j]) < volume(boxes[i])) continue;
        const d = separation(boxes[i], boxes[j]);
        const dist = lengthOf(d);
        // Already meeting, or far enough away to be a genuinely separate piece.
        if (dist <= bite || dist > gap + bite) continue;
        if (!best || dist < best.dist) best = { j, d, dist };
      }
      if (!best) continue;

      const part = out[i];
      part.position = [part.position[0] + best.d[0], part.position[1] + best.d[1], part.position[2] + best.d[2]];
      boxes[i] = partBox(part);
      moved.add(i);
      seams.push({ partId: part.id, to: out[best.j].id, by: [...best.d] });

      const twin = twinOf(part);
      if (twin >= 0 && !moved.has(twin)) {
        const other = out[twin];
        other.position = [other.position[0] - best.d[0], other.position[1] + best.d[1], other.position[2] + best.d[2]];
        boxes[twin] = partBox(other);
        moved.add(twin);
        seams.push({ partId: other.id, to: out[best.j].id, by: [-best.d[0], best.d[1], best.d[2]], mirrored: true });
      }
    }
    return { parts: out, seams };
  }

  /**
   * What is wrong with this model that a person would notice.
   *
   * Reported, not repaired: a detached part may be a deliberate second element,
   * and deciding that is the caller's job. This is the list the Improve step is
   * given, which is why each issue says what it is rather than just failing.
   */
  function findIssues(parts, opts = {}) {
    const issues = [];
    if (!parts.length) return [{ code: "empty", detail: "the plan produced no parts" }];

    const gap = num(opts.gap, 0.06);
    const boxes = parts.map(partBox);
    const touches = (a, b) => (
      a[0] - gap <= b[3] && b[0] - gap <= a[3] &&
      a[1] - gap <= b[4] && b[1] - gap <= a[4] &&
      a[2] - gap <= b[5] && b[2] - gap <= a[5]
    );

    // Anything not reachable from the largest part is floating beside the model.
    const volume = (b) => Math.max(0, b[3] - b[0]) * Math.max(0, b[4] - b[1]) * Math.max(0, b[5] - b[2]);
    let root = 0;
    for (let i = 1; i < boxes.length; i++) if (volume(boxes[i]) > volume(boxes[root])) root = i;
    const reached = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const i = queue.shift();
      for (let j = 0; j < boxes.length; j++) {
        if (reached.has(j) || !touches(boxes[i], boxes[j])) continue;
        reached.add(j); queue.push(j);
      }
    }
    parts.forEach((part, i) => {
      if (!reached.has(i)) issues.push({ code: "detached", partId: part.id, detail: "does not connect to the main body" });
    });

    const box = boundsOf(parts);
    const [w, h, d] = sizeOf(box);
    if (Math.max(w, h, d) > 0 && Math.min(w, h, d) / Math.max(w, h, d) < 0.02) {
      issues.push({ code: "flat", detail: "the model is essentially flat in one axis" });
    }
    if (Math.abs(box[1]) > 0.02) {
      issues.push({ code: "off-floor", detail: `lowest point sits at y ${box[1].toFixed(3)}` });
    }
    return issues;
  }

  /**
   * The whole deterministic stage, in the order the steps depend on each other:
   * clean up, mirror, then measure — floor and scale have to come after
   * mirroring, because a mirrored part changes where the bottom and the edges
   * are.
   */
  function assemble(plan, opts = {}) {
    const source = plan && typeof plan === "object" ? plan : {};
    const cleaned = normaliseParts(source.nodes || source.parts, opts);
    const mirrored = expandMirrors(cleaned.parts, opts);
    // Resizing is opt-in. A scene's camera, grid and lighting are tuned to the
    // size its models already come out at, so quietly normalising every plan to
    // one metre would be a change of appearance dressed up as a correction.
    // Ask for it with targetSize when the caller knows what the scene expects.
    const target = num(opts.targetSize, 0);
    const scaled = target > 0 ? normaliseScale(mirrored.parts, target) : { parts: mirrored.parts, factor: 1 };
    // Grounding from declared parameters is an estimate: it ignores rotation
    // and cannot know what a mesh's vertices do. A caller that will measure the
    // built geometry itself should say so and skip this, rather than have two
    // answers applied in turn.
    // Connecting comes before the floor, because moving a part changes where
    // the bottom of the model is. Opt out with connect:false to see what a
    // design call actually produced.
    const joined = opts.connect === false ? { parts: scaled.parts, moves: [] } : connectParts(scaled.parts, opts);
    // Then the seams: parts that pass the contact test but still show a line
    // between them are seated into their neighbour, so the model is one body.
    const seated = opts.connect === false ? { parts: joined.parts, seams: [] } : seatParts(joined.parts, opts);
    const floored = opts.ground === false ? { parts: seated.parts, offset: 0 } : snapToFloor(seated.parts);

    const parts = floored.parts;
    return {
      name: String(source.name || "model"),
      parts,
      issues: [...cleaned.issues, ...mirrored.issues, ...findIssues(parts, opts)],
      moves: joined.moves,
      seams: seated.seams,
      stats: {
        received: Array.isArray(source.nodes || source.parts) ? (source.nodes || source.parts).length : 0,
        kept: cleaned.parts.length,
        mirrored: parts.filter((p) => p.mirroredFrom).length,
        connected: joined.moves.length,
        seated: seated.seams.length,
        scaleFactor: scaled.factor,
        floorOffset: floored.offset,
        size: sizeOf(boundsOf(parts)),
      },
    };
  }

  window.HCModelPlan = {
    COORD_LIMIT,
    halfExtents,
    rotationMatrix,
    partBox,
    boundsOf,
    sizeOf,
    normaliseParts,
    expandMirrors,
    snapToFloor,
    normaliseScale,
    findIssues,
    connectParts,
    seatParts,
    resolveType,
    SHAPES,
    assemble,
  };
})();
