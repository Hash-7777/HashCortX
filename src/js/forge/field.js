// ============================================================
// field.js — a model as a distance, so it can have holes
//
// Forge could only ever add material. The plan schema had one operation — put
// another part in — so there was no mug with a bore, no pipe, no vent, no screw
// hole, no enclosure with a port, no vase with a wall. Every object it has ever
// made is solid material that was only added to. That is not a defect; it is a
// missing dimension of what the app can express.
//
// The fix is to stop thinking of a part as a surface and start thinking of it
// as an answer to a question: for any point in space, how far are you from my
// skin, and are you inside me or outside? Once every shape answers that, the
// operations that were missing are arithmetic:
//
//     union      min(a, b)
//     subtract   max(a, -b)          ← the hole
//     intersect  max(a, b)
//     blend      a softened min      ← a rounded fillet where two parts meet
//
// and a whole model is one such answer, folded in order. Nothing here needs
// exact arithmetic, there are no degenerate cases to handle, and the result
// cannot be self-intersecting or open, because it is not a surface at all until
// something asks for one.
//
// The distances are exact where a shape allows it. Every revolved shape —
// cylinder, cone, turned profile — is the same problem: the distance to a
// two-dimensional outline, measured in the half-plane that contains the point.
// So there is one careful polygon routine and the rest follow from it, rather
// than five hand-derived formulas each with its own corner to get wrong.
//
// Pure: no THREE, no DOM, no network, no clock. It uses the geometry helpers in
// model-plan.js, which is loaded first, so that there is exactly one answer in
// this app to where a part is and which way it faces.
//
// Run the checks with: npm run check:forge-field
// ============================================================
(function () {
  "use strict";

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  // What a part does to the material already there. A plan that says nothing is
  // adding to it, which is what every plan written so far meant.
  const OPS = new Set(["union", "subtract", "intersect"]);

  function plan3d() {
    const MP = typeof window !== "undefined" ? window.HCModelPlan : null;
    if (!MP || !MP.rotationMatrix || !MP.partBox) {
      throw new Error("field.js needs model-plan.js loaded first");
    }
    return MP;
  }

  // ── two dimensions, from which most of three follow ──────────────────

  /**
   * Signed distance from a point to a closed polygon, in the plane.
   *
   * Negative inside. The distance is the nearest edge; the sign is a crossing
   * count, which is why the polygon does not have to be convex and its winding
   * does not have to be known. Both matter here: a turned profile is whatever
   * outline a design drew, and it will not be convex.
   */
  function polygonDistance(points, px, py, opts = {}) {
    const n = points.length;
    if (n < 3) return Infinity;
    // The closing edge can be a boundary of the region without being a surface
    // of the solid. That is exactly what happens to a revolved shape: the
    // outline is closed back to the axis so that "inside" means something, but
    // the axis is the middle of the material, not its skin. Counted as a
    // surface, every point on the axis of every cylinder, cone and turned
    // profile came back as sitting exactly on the outside of the object.
    const skipClosing = opts.skipClosingEdge === true;
    let best = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const closing = j === n - 1 && i === 0;
      const ax = points[i][0], ay = points[i][1];
      const bx = points[j][0], by = points[j][1];
      const ex = bx - ax, ey = by - ay;
      const wx = px - ax, wy = py - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / len2)) : 0;
      const dx = wx - ex * t, dy = wy - ey * t;
      const d2 = dx * dx + dy * dy;
      if (d2 < best && !(closing && skipClosing)) best = d2;
      // A ray cast along +x: an edge that straddles the point's height and
      // whose crossing lies to the right flips the answer.
      if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * (bx - ax)) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(best);
  }

  /** The two-dimensional outline a revolved shape is made from. */
  function revolvedProfile(part) {
    const p = part.params || {};
    switch (part.type) {
      case "cylinder": {
        const r = num(p.radius, 0.5);
        const h = num(p.height, 1) / 2;
        return [[0, -h], [r, -h], [r, h], [0, h]];
      }
      case "cone": {
        const r = num(p.radius, 0.5);
        const h = num(p.height, 1) / 2;
        return [[0, -h], [r, -h], [0, h]];
      }
      case "lathe": {
        const pts0 = Array.isArray(p.points) && p.points.length >= 2
          ? p.points.map((pt) => [Math.abs(num(pt[0], 0.1)), num(pt[1], 0)])
          : [[0.18, -0.55], [0.42, -0.2], [0.34, 0.42], [0.08, 0.65]];
        const pts = pts0;
        // Closed back against the axis of revolution. A turned profile is drawn
        // as an open outline — the side of the object — and the solid is what
        // that outline sweeps, which needs the ends brought in to the axis.
        return [[0, pts[0][1]], ...pts, [0, pts[pts.length - 1][1]]];
      }
      default:
        return null;
    }
  }

  // ── one part, in its own space ───────────────────────────────────────

  /**
   * A shape, worked out once, ready to be asked about a point.
   *
   * This used to read the part's parameters and rebuild its outline on every
   * single call — and a field is asked about hundreds of thousands of points,
   * so a model spent most of its time allocating the same array of profile
   * points over and over. Everything that does not depend on the point is done
   * here, once, and what is left is arithmetic.
   */
  function compileShape(part) {
    const p = part.params || {};
    switch (part.type) {
      case "sphere": {
        const r = num(p.radius, 0.5);
        return (x, y, z) => Math.hypot(x, y, z) - r;
      }
      case "capsule": {
        // A segment along Y with a radius: the distance to the segment, less
        // the radius. The straight part is `length`; the caps add to each end.
        const r = num(p.radius, 0.25);
        const half = num(p.length, 0.5) / 2;
        return (x, y, z) => {
          const cy = Math.min(half, Math.max(-half, y));
          return Math.hypot(x, y - cy, z) - r;
        };
      }
      case "torus": {
        // Drawn in the XY plane, so the ring runs round z.
        const r = num(p.radius, 0.5);
        const tube = num(p.tube, 0.1);
        return (x, y, z) => Math.hypot(Math.hypot(x, y) - r, z) - tube;
      }
      case "extrude": {
        const pts = Array.isArray(p.points) && p.points.length >= 3
          ? p.points.map((pt) => [num(pt[0], 0), num(pt[1], 0)])
          : [[-0.35, -0.25], [0.35, -0.25], [0.42, 0.2], [0, 0.45], [-0.42, 0.2]];
        const depth = num(p.depth, num(p.length, 0.2));
        const lo = Math.min(0, depth);
        const hi = Math.max(0, depth);
        // Runs from the profile plane forwards, not half back and half
        // forwards — the same thing the bounding box had wrong.
        return (x, y, z) => combine(polygonDistance(pts, x, y), Math.max(lo - z, z - hi));
      }
      case "box":
      case "mesh":
        return boxShape(part);
      default: {
        const profile = revolvedProfile(part);
        if (!profile) return boxShape(part);
        // The outline is closed back to the axis so that inside means
        // something, and the axis is skipped as a surface because it is not
        // one — a point on the axis of a solid cylinder is a radius INSIDE it.
        return (x, y, z) => polygonDistance(profile, Math.hypot(x, z), y, SKIP_AXIS);
      }
    }
  }

  const SKIP_AXIS = { skipClosingEdge: true };

  /** The box a part occupies, in the part's own space. */
  function boxShape(part) {
    const MP = plan3d();
    const b = MP.localBounds(part);
    const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    const hx = (b[3] - b[0]) / 2, hy = (b[4] - b[1]) / 2, hz = (b[5] - b[2]) / 2;
    return (x, y, z) => {
      const qx = Math.abs(x - cx) - hx;
      const qy = Math.abs(y - cy) - hy;
      const qz = Math.abs(z - cz) - hz;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return Math.min(Math.max(qx, Math.max(qy, qz)), 0) + outside;
    };
  }

  /**
   * How far a point in a part's own space is from that part's surface.
   *
   * Exact for every shape except a supplied mesh, which is answered with the
   * box it occupies — an approximation, reported by whatever built the field,
   * because a mesh is an arbitrary pile of triangles and answering it properly
   * costs more per sample than every other shape put together.
   */
  function localDistance(part, x, y, z) {
    return compileShape(part)(x, y, z);
  }

  /** Two distances that must both be satisfied, joined the way a box is. */
  function combine(a, b) {
    const outside = Math.hypot(Math.max(a, 0), Math.max(b, 0));
    return Math.min(Math.max(a, b), 0) + outside;
  }

  /**
   * A part, ready to be asked about a point in world space.
   *
   * The transform is inverted once rather than per sample: a rotation matrix
   * from an angle is not free, and a field is asked about hundreds of thousands
   * of points. The rotation is orthonormal, so its inverse is its transpose.
   */
  function prepare(part) {
    const MP = plan3d();
    void MP;
    const m = MP.rotationMatrix(part.rotation);
    const s = [num(part.scale?.[0], 1) || 1, num(part.scale?.[1], 1) || 1, num(part.scale?.[2], 1) || 1];
    const pos = [num(part.position?.[0], 0), num(part.position?.[1], 0), num(part.position?.[2], 0)];
    // A non-uniform scale makes a distance no longer a true distance. Dividing
    // by the smallest factor keeps it an underestimate everywhere, which is
    // what a surface walk needs: it may take a shorter step than necessary, but
    // it can never step through the surface.
    const shrink = Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
    const shape = compileShape(part);
    // Where this part is in the world, as a plain box. A point outside that box
    // cannot be closer to the part than it is to the box, which is three
    // subtractions to work out and is what lets most parts be skipped entirely
    // on most samples. On a gear, seventeen of eighteen parts are nowhere near
    // any given point, and asking each of them properly is the whole cost.
    const wb = MP.partBox({ ...part, rotation: part.rotation, scale: part.scale });
    const bcx = (wb[0] + wb[3]) / 2, bcy = (wb[1] + wb[4]) / 2, bcz = (wb[2] + wb[5]) / 2;
    const bhx = (wb[3] - wb[0]) / 2, bhy = (wb[4] - wb[1]) / 2, bhz = (wb[5] - wb[2]) / 2;
    return {
      part,
      op: OPS.has(part.op) ? part.op : "union",
      blend: Math.max(0, num(part.blend, 0)),
      /** A floor on how far this part can possibly be. Never an overestimate. */
      atLeast(x, y, z) {
        const qx = Math.abs(x - bcx) - bhx;
        const qy = Math.abs(y - bcy) - bhy;
        const qz = Math.abs(z - bcz) - bhz;
        if (qx <= 0 && qy <= 0 && qz <= 0) return Math.max(qx, qy, qz);
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      },
      distance(x, y, z) {
        const wx = x - pos[0], wy = y - pos[1], wz = z - pos[2];
        // Transposed rotation, then undo the scale.
        const lx = (m[0][0] * wx + m[1][0] * wy + m[2][0] * wz) / s[0];
        const ly = (m[0][1] * wx + m[1][1] * wy + m[2][1] * wz) / s[1];
        const lz = (m[0][2] * wx + m[1][2] * wy + m[2][2] * wz) / s[2];
        return shape(lx, ly, lz) * shrink;
      },
    };
  }

  // ── the operations that were missing ─────────────────────────────────

  /** A union with a rounded transition, which is a fillet by another name. */
  function softMin(a, b, k) {
    if (!(k > 0)) return Math.min(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  }

  /**
   * A whole model as one distance.
   *
   * Folded in the order the parts are written, because the operations are not
   * commutative: subtracting a bore and then adding a boss is a different
   * object from adding the boss and then subtracting through it. That order is
   * the design's to choose and this must not reorder it.
   */
  function buildField(parts, opts = {}) {
    const MP = plan3d();
    const list = (Array.isArray(parts) ? parts : []).filter((p) => p && p.role !== "audit");
    const issues = [];
    const prepared = [];

    for (const part of list) {
      if (part.type === "mesh") {
        issues.push({ code: "mesh-approximated", partId: part.id, detail: "answered with the box it occupies" });
      }
      if (part.type === "logo" || part.type === "logo_img") continue;
      prepared.push(prepare(part));
    }

    // Material has to exist before anything can be taken out of it. A plan that
    // opens with a subtraction is not an object with a hole; it is a hole.
    const firstAdding = prepared.findIndex((p) => p.op === "union");
    if (prepared.length && firstAdding !== 0) {
      const stray = prepared.slice(0, firstAdding < 0 ? prepared.length : firstAdding);
      for (const p of stray) {
        issues.push({ code: "nothing-to-cut", partId: p.part.id, detail: `${p.op} before anything is there to ${p.op}` });
        p.op = "union";
      }
    }

    // Only what adds material can grow the model, so only that sets the region
    // worth looking at. A bore drilled a metre off to one side must not make
    // the box a metre wider and everything in it coarser.
    const adding = prepared.filter((p) => p.op === "union").map((p) => p.part);
    // An empty plan has no box, and asking for one back gives nothing at all.
    // A field over nothing is still a field: it is empty everywhere, and it
    // must be safe to ask rather than something that throws on the way in.
    const bounds = MP.boundsOf(adding.length ? adding : list) || [0, 0, 0, 0, 0, 0];
    const pad = num(opts.pad, 0);
    const padded = [bounds[0] - pad, bounds[1] - pad, bounds[2] - pad, bounds[3] + pad, bounds[4] + pad, bounds[5] + pad];

    const evaluate = (x, y, z) => {
      let d = Infinity;
      for (let i = 0; i < prepared.length; i++) {
        const p = prepared[i];
        // A part can be skipped when the nearest it could possibly be already
        // cannot change the answer. Adding material: if the part is further
        // away than what is already here, the smaller of the two is unchanged.
        // Taking it away: if the part is at least that far outside, the point
        // is not in the region being removed. Both are exact — the floor is
        // never an overestimate, so this never skips a part that mattered.
        //
        // Keeping only what two shapes share cannot be skipped this way: the
        // answer there needs the LARGER distance, and a floor says nothing
        // about how large a value can be.
        if (i > 0) {
          const floor = p.atLeast(x, y, z);
          if (p.op === "union" && floor > d + p.blend) continue;
          if (p.op === "subtract" && floor >= -d) continue;
        }
        const dp = p.distance(x, y, z);
        if (p.op === "subtract") d = Math.max(d, -dp);
        else if (p.op === "intersect") d = Math.max(d, dp);
        else d = i === 0 ? dp : softMin(d, dp, p.blend);
      }
      return d;
    };

    // The thinnest thing anywhere in this model, which is what decides how
    // closely it has to be looked at. A fin two hundredths thick needs cells
    // smaller than that or both its faces fall in the same cell.
    let minFeature = Infinity;
    for (const p of prepared) {
      const lb = MP.localBounds(p.part);
      const sc = p.part.scale || [1, 1, 1];
      for (let i = 0; i < 3; i++) {
        const t = Math.abs((lb[i + 3] - lb[i]) * num(sc[i], 1));
        if (t > 1e-9 && t < minFeature) minFeature = t;
      }
    }

    return {
      evaluate,
      bounds: padded,
      parts: prepared.length,
      minFeature: Number.isFinite(minFeature) ? minFeature : 0,
      issues,
      /**
       * Which way the surface faces here, from the field either side.
       *
       * Taken by sampling rather than derived, because a folded field has no
       * formula. The step is the caller's: too small and it is floating-point
       * noise, too large and a corner is rounded off.
       */
      normalAt(x, y, z, step) {
        // Four samples at the corners of a tetrahedron rather than six along
        // the axes. The same gradient to the same order, and a third less work
        // in the pass that dominates a large model.
        const h = num(step, 1e-3);
        const a = evaluate(x + h, y - h, z - h);
        const b = evaluate(x - h, y - h, z + h);
        const c = evaluate(x - h, y + h, z - h);
        const e = evaluate(x + h, y + h, z + h);
        const gx = a - b - c + e;
        const gy = -a - b + c + e;
        const gz = -a + b - c + e;
        const len = Math.hypot(gx, gy, gz);
        return len > 1e-12 ? [gx / len, gy / len, gz / len] : [0, 1, 0];
      },
    };
  }

  window.HCForgeField = {
    OPS,
    polygonDistance,
    localDistance,
    buildField,
    softMin,
  };
})();
