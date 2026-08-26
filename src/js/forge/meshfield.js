// ============================================================
// meshfield.js — how far a point is from a pile of triangles
//
// Every other shape in this app answers "how far am I from your surface" with
// arithmetic: a sphere subtracts a radius, a box takes a few maximums. A mesh
// cannot. It is an arbitrary pile of triangles somebody else produced, and
// until now the fuse answered it with the BOX IT OCCUPIES — so importing a
// model and pressing Solidify turned it into a crate. It said so, which is
// better than lying, but it is not the object anyone wanted.
//
// This answers it properly. Two halves:
//
//   HOW FAR is the distance to the nearest triangle, found through a uniform
//   grid of buckets so that a sample only tests the triangles near it. The
//   whole fuse takes a quarter of a million samples; testing every triangle
//   against every sample would be minutes, not milliseconds.
//
//   WHICH SIDE is decided by the ANGLE-WEIGHTED PSEUDONORMAL of whatever the
//   nearest point sits on — the face, an edge, or a corner. This is the part
//   that is easy to get subtly wrong. Using the nearest face's own normal is
//   the obvious thing and it is WRONG at every edge and corner: at a cube's
//   corner, three faces are equally close, and picking any one of them says
//   "outside" for points that are plainly inside. The fix is old and exact —
//   weight each face's normal by the angle it actually occupies at that corner
//   — and it is what makes the sign correct everywhere rather than merely
//   correct in the middle of a face.
//
// It needs a CLOSED mesh to be meaningful. Inside and outside are not defined
// for a surface with a hole in it, and this says so rather than answering
// confidently: a caller handed `closed: false` should say the shape is an
// approximation, exactly as the box answer used to.
//
// Pure: plain arrays in, a function out. No THREE, no DOM, no network, no
// clock.
//
// Run the checks with: npm run check:forge-meshfield
// ============================================================
(function () {
  "use strict";

  // Above this a mesh is answered by its box again. The grid keeps a sample
  // cheap, but building it is not free, and a model this dense is past what
  // this mode is for.
  const MAX_TRIANGLES = 60000;

  // Roughly how many triangles should land in one bucket. Too few and the grid
  // is mostly empty and large; too many and a sample tests half the mesh.
  const PER_BUCKET = 4;

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const lengthOf = (a) => Math.hypot(a[0], a[1], a[2]);

  /**
   * The same answer as `closestOnTriangle` below, written to avoid allocating.
   *
   * This is the innermost loop in the whole mode: it runs once per triangle per
   * bucket per sample, which for a fuse is a few million times. The readable
   * version allocates half a dozen small arrays each call, and a few million
   * times that is seconds of collecting garbage rather than of arithmetic — an
   * imported mesh took seven seconds to fuse, and almost all of it was this.
   *
   * The result goes into `out`, which the caller reuses, and the distance comes
   * back SQUARED because the caller is only comparing them and a square root
   * per triangle is a square root wasted.
   */
  function closestSquaredInto(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;

    let qx, qy, qz, feature;
    if (d1 <= 0 && d2 <= 0) {
      qx = ax; qy = ay; qz = az; feature = 0;
    } else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) {
        qx = bx; qy = by; qz = bz; feature = 1;
      } else {
        const vc = d1 * d4 - d3 * d2;
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          const v = d1 / (d1 - d3);
          qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; feature = 3;
        } else if (d6 >= 0 && d5 <= d6) {
          qx = cx; qy = cy; qz = cz; feature = 2;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; feature = 5;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w; feature = 4;
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              qx = ax + abx * v + acx * w;
              qy = ay + aby * v + acy * w;
              qz = az + abz * v + acz * w;
              feature = 6;
            }
          }
        }
      }
    }
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    out.x = qx; out.y = qy; out.z = qz; out.feature = feature;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * The point on a triangle nearest to `p`, and which part of the triangle it
   * sits on.
   *
   * The readable statement of what `closestSquaredInto` computes, kept because
   * it is what the checks read and what anyone reasoning about the arithmetic
   * should look at. The two are checked against each other.
   *
   * `feature` is what decides the sign later: 0-2 mean the corner of that
   * index, 3-5 mean the edge starting at that corner, and 6 means the face
   * itself. Getting this wrong does not move the distance by a hair and gets
   * the inside/outside answer wrong at every edge in the mesh.
   */
  function closestOnTriangle(p, a, b, c) {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(p, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return { point: a, feature: 0 };

    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return { point: b, feature: 1 };

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return { point: [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v], feature: 3 };
    }

    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return { point: c, feature: 2 };

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return { point: [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w], feature: 5 };
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return {
        point: [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w],
        feature: 4,
      };
    }

    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return {
      point: [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w],
      feature: 6,
    };
  }

  /**
   * A mesh made ready to be asked distances of, or null when it cannot be.
   *
   * `closed` says whether every edge is shared by exactly two triangles. It is
   * not enforced — an open surface still answers a distance, and the sign is
   * simply not meaningful — but it is reported so the caller can say the shape
   * is being approximated instead of implying it is exact.
   */
  /**
   * Why a mesh could not be answered from its own triangles, or null when it
   * can be. Said separately from `build` so a caller can report the reason
   * rather than "something went wrong".
   */
  function whyNot(source) {
    const positions = source && source.positions ? source.positions.length : 0;
    if (positions < 9) return "it holds no triangles";
    const indices = source && source.indices ? source.indices.length : positions / 3;
    const triangles = Math.floor(indices / 3);
    if (triangles > MAX_TRIANGLES) {
      return `it has ${triangles.toLocaleString()} triangles, past the ${MAX_TRIANGLES.toLocaleString()} this can measure`;
    }
    return null;
  }

  function build(source) {
    const positions = source && source.positions ? Array.from(source.positions, Number) : [];
    const vertexCount = Math.floor(positions.length / 3);
    let indices = source && source.indices ? Array.from(source.indices, Number) : null;
    if (!indices || indices.length < 3 || !indices.every((i) => i >= 0 && i < vertexCount)) {
      indices = vertexCount >= 3 ? Array.from({ length: Math.floor(vertexCount / 3) * 3 }, (_, i) => i) : null;
    }
    if (!indices) return null;
    const at = (v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];

    // ── Corners welded by position ────────────────────────────────────────
    //
    // A corner pseudonormal has to gather every face that MEETS at that point.
    // A mesh with a separate vertex per face — which is most of them, so that
    // hard edges can be shaded — would otherwise have each face believing it
    // stands alone at that corner, and the sign would be wrong at every one.
    const site = new Map();
    const siteOf = new Int32Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      const key = [0, 1, 2].map((k) => Math.round(positions[v * 3 + k] / 1e-7)).join(",");
      let id = site.get(key);
      if (id === undefined) { id = site.size; site.set(key, id); }
      siteOf[v] = id;
    }

    // ── Triangles that are not really triangles are dropped ───────────────
    //
    // Not rare and not harmless. A sphere drawn the usual way — rings of quads
    // from pole to pole — has a whole row of these at each pole, where a
    // quad's two top corners are the same point. Such a triangle has no
    // direction, so it contributes NOTHING to a pseudonormal while still being
    // able to be the nearest thing to a sample: the sign then comes from a
    // zero vector and the point is called outside wherever it is. It also has
    // an edge running from a corner back to itself, which makes a closed mesh
    // look open.
    //
    // Judged on the WELDED corners rather than on raw area. At the far pole of
    // that same sphere the two corners are not bit-identical — they sit a
    // fraction of a billionth apart, which is nothing at all and is still not
    // zero — so an area test keeps them and the topology stays broken. Two
    // corners at the same place are the same corner.
    const live = [];
    let dropped = 0;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const s = [siteOf[indices[i]], siteOf[indices[i + 1]], siteOf[indices[i + 2]]];
      const collapsed = s[0] === s[1] || s[1] === s[2] || s[2] === s[0];
      const area = lengthOf(cross(sub(at(indices[i + 1]), at(indices[i])), sub(at(indices[i + 2]), at(indices[i]))));
      if (!collapsed && area > 0) live.push(indices[i], indices[i + 1], indices[i + 2]);
      else dropped++;
    }
    indices = live;
    const triangleCount = Math.floor(indices.length / 3);
    if (!triangleCount || triangleCount > MAX_TRIANGLES) return null;

    // Every triangle's nine coordinates, laid out flat.
    //
    // The inner loop reads these millions of times, and reaching them through
    // two levels of indirection — an index into a vertex list, then three
    // reads off it — was a measurable part of the cost. A typed array read
    // straight through is the same numbers with none of the chasing.
    const corner = new Float64Array(triangleCount * 9);
    for (let t = 0; t < triangleCount; t++) {
      for (let c = 0; c < 3; c++) {
        const v = indices[t * 3 + c];
        corner[t * 9 + c * 3] = positions[v * 3];
        corner[t * 9 + c * 3 + 1] = positions[v * 3 + 1];
        corner[t * 9 + c * 3 + 2] = positions[v * 3 + 2];
      }
    }

    const normals = new Array(triangleCount);
    const cornerAngles = new Array(triangleCount);
    const siteNormal = new Array(site.size).fill(null).map(() => [0, 0, 0]);
    const edgeNormal = new Map();
    const edgeUses = new Map();

    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];

    for (let t = 0; t < triangleCount; t++) {
      const v = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      const p = v.map(at);
      for (const q of p) for (let k = 0; k < 3; k++) {
        if (q[k] < lo[k]) lo[k] = q[k];
        if (q[k] > hi[k]) hi[k] = q[k];
      }
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const len = lengthOf(n);
      const unit = [n[0] / len, n[1] / len, n[2] / len];
      normals[t] = unit;

      const angles = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const u = sub(p[(i + 1) % 3], p[i]);
        const w = sub(p[(i + 2) % 3], p[i]);
        const lu = lengthOf(u);
        const lw = lengthOf(w);
        angles[i] = lu > 0 && lw > 0
          ? Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw))))
          : 0;
        const s = siteOf[v[i]];
        siteNormal[s][0] += unit[0] * angles[i];
        siteNormal[s][1] += unit[1] * angles[i];
        siteNormal[s][2] += unit[2] * angles[i];
      }
      cornerAngles[t] = angles;

      for (let i = 0; i < 3; i++) {
        const a = siteOf[v[i]];
        const b = siteOf[v[(i + 1) % 3]];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const acc = edgeNormal.get(key) || [0, 0, 0];
        acc[0] += unit[0]; acc[1] += unit[1]; acc[2] += unit[2];
        edgeNormal.set(key, acc);
        edgeUses.set(key, (edgeUses.get(key) || 0) + 1);
      }
    }

    const closed = [...edgeUses.values()].every((n) => n === 2);

    // ── Which way is out ──────────────────────────────────────────────────
    //
    // The sign of a distance comes from the mesh's own winding, so a mesh
    // wound the other way answers everything backwards: the inside of it reads
    // as outside and a fuse would cut where it should add. Nothing about the
    // topology says which way round a mesh is — a closed mesh wound inwards is
    // still perfectly closed — and only the enclosed volume does. A negative
    // volume means the whole thing is inside out, and one number puts it right
    // for every sample afterwards.
    let enclosed = 0;
    for (let t = 0; t < triangleCount; t++) {
      const a = at(indices[t * 3]);
      const b = at(indices[t * 3 + 1]);
      const c = at(indices[t * 3 + 2]);
      enclosed += (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6;
    }
    const inverted = closed && enclosed < 0;
    const facing = inverted ? -1 : 1;

    // ── A uniform grid over the triangles ─────────────────────────────────
    const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const volume = Math.max(1e-12, span[0] * span[1] * span[2]);
    const target = Math.max(1, Math.round(triangleCount / PER_BUCKET));
    const cell = Math.max(1e-6, Math.cbrt(volume / target));
    const dims = span.map((s) => Math.max(1, Math.min(128, Math.ceil(s / cell) || 1)));
    const step = span.map((s, k) => (s > 0 ? s / dims[k] : 1));
    const buckets = new Map();
    const keyOf = (i, j, k) => (i * dims[1] + j) * dims[2] + k;
    const clampIndex = (v, k) => Math.max(0, Math.min(dims[k] - 1, Math.floor((v - lo[k]) / step[k])));

    for (let t = 0; t < triangleCount; t++) {
      const p = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]].map(at);
      const bLo = [0, 1, 2].map((k) => clampIndex(Math.min(p[0][k], p[1][k], p[2][k]), k));
      const bHi = [0, 1, 2].map((k) => clampIndex(Math.max(p[0][k], p[1][k], p[2][k]), k));
      for (let i = bLo[0]; i <= bHi[0]; i++) {
        for (let j = bLo[1]; j <= bHi[1]; j++) {
          for (let k = bLo[2]; k <= bHi[2]; k++) {
            const key = keyOf(i, j, k);
            const list = buckets.get(key);
            if (list) list.push(t); else buckets.set(key, [t]);
          }
        }
      }
    }

    /** The pseudonormal of whatever the nearest point sits on. */
    function normalAt(t, feature) {
      const v = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      if (feature === 6) return normals[t];
      if (feature <= 2) return siteNormal[siteOf[v[feature]]];
      const i = feature - 3;
      const a = siteOf[v[i]];
      const b = siteOf[v[(i + 1) % 3]];
      return edgeNormal.get(a < b ? `${a}_${b}` : `${b}_${a}`) || normals[t];
    }

    /**
     * How far `p` is from the surface, negative inside.
     *
     * Rings of buckets are searched outwards from the point's own, and the
     * search stops as soon as the nearest thing found is closer than the next
     * ring could possibly be. Stopping at the first non-empty ring would be
     * wrong: a triangle one ring further out can be nearer than one that
     * merely shares a bucket.
     */
    const cellLo = (i, k) => lo[k] + i * step[k];
    const cellHi = (i, k) => lo[k] + (i + 1) * step[k];

    // Reused across every sample, so the inner loop allocates nothing at all.
    const hit = { x: 0, y: 0, z: 0, feature: 6 };

    function distance(x, y, z) {
      const home = [clampIndex(x, 0), clampIndex(y, 1), clampIndex(z, 2)];
      let best = Infinity;
      let bestX = 0, bestY = 0, bestZ = 0;
      let found = false;
      let bestTriangle = -1;
      let bestFeature = 6;
      const reach = Math.max(dims[0], dims[1], dims[2]);
      const smallestStep = Math.min(step[0], step[1], step[2]);

      for (let ring = 0; ring <= reach; ring++) {
        // Everything in this ring is at least this far away, so once the best
        // so far beats it, no further ring can help.
        if (found && Math.sqrt(best) <= (ring - 1) * smallestStep) break;
        const iLo = Math.max(0, home[0] - ring), iHi = Math.min(dims[0] - 1, home[0] + ring);
        const jLo = Math.max(0, home[1] - ring), jHi = Math.min(dims[1] - 1, home[1] + ring);
        const kLo = Math.max(0, home[2] - ring), kHi = Math.min(dims[2] - 1, home[2] + ring);
        for (let i = iLo; i <= iHi; i++) {
          for (let j = jLo; j <= jHi; j++) {
            for (let k = kLo; k <= kHi; k++) {
              // Only the shell of the ring; the inside of it was searched
              // by the rings before.
              const onShell = ring === 0
                || i === home[0] - ring || i === home[0] + ring
                || j === home[1] - ring || j === home[1] + ring
                || k === home[2] - ring || k === home[2] + ring;
              if (!onShell) continue;
              const list = buckets.get(keyOf(i, j, k));
              if (!list) continue;
              // How near could anything in THIS cell possibly be? If the
              // nearest thing found already beats that, the whole cell is
              // skipped without touching a triangle in it.
              //
              // This is where nearly all the time was. Without it a sample
              // tested every triangle in every cell the rings reached — eight
              // hundred of them on a mesh of thirty thousand — when a handful
              // of cells could hold anything nearer.
              const gx = x < cellLo(i, 0) ? cellLo(i, 0) - x : (x > cellHi(i, 0) ? x - cellHi(i, 0) : 0);
              const gy = y < cellLo(j, 1) ? cellLo(j, 1) - y : (y > cellHi(j, 1) ? y - cellHi(j, 1) : 0);
              const gz = z < cellLo(k, 2) ? cellLo(k, 2) - z : (z > cellHi(k, 2) ? z - cellHi(k, 2) : 0);
              if (gx * gx + gy * gy + gz * gz >= best) continue;
              for (let n = 0; n < list.length; n++) {
                const t = list[n];
                const squared = closestSquaredInto(
                  x, y, z,
                  corner[t * 9], corner[t * 9 + 1], corner[t * 9 + 2],
                  corner[t * 9 + 3], corner[t * 9 + 4], corner[t * 9 + 5],
                  corner[t * 9 + 6], corner[t * 9 + 7], corner[t * 9 + 8],
                  hit,
                );
                if (squared < best) {
                  best = squared;
                  bestX = hit.x; bestY = hit.y; bestZ = hit.z;
                  bestTriangle = t;
                  bestFeature = hit.feature;
                  found = true;
                }
              }
            }
          }
        }
      }

      if (!found) return Infinity;
      const d = Math.sqrt(best);
      // Exactly on the surface: no direction to judge by, and zero is the
      // right answer either way.
      if (d < 1e-12) return 0;
      const n = normalAt(bestTriangle, bestFeature);
      const side = (x - bestX) * n[0] + (y - bestY) * n[1] + (z - bestZ) * n[2];
      return side * facing < 0 ? -d : d;
    }

    return {
      distance,
      closed,
      inverted,
      volume: Math.abs(enclosed),
      triangles: triangleCount,
      dropped,
      bounds: [lo, hi],
      buckets: buckets.size,
    };
  }

  window.HCForgeMeshField = { build, whyNot, closestOnTriangle, closestSquaredInto, MAX_TRIANGLES };
})();
