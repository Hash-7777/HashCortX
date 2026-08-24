// ============================================================
// surface.js — one closed skin, from a field
//
// A Forge model has always been a collection of separate shells sitting inside
// each other. That is why the join between two parts is a seam, why the
// exported file is a pile of overlapping solids with faces buried inside the
// object, and why nothing could ever be cut away: there was no "inside" to cut.
//
// This walks the field in src/js/forge/field.js and produces a single indexed
// triangle mesh. The important property is not that it is efficient; it is that
// **the surface can never be left open**, and that follows from how it is built
// rather than from care taken while building it:
//
//   · one vertex per grid cell that the surface passes through, and no more;
//   · one quad per grid edge that the surface crosses, joining the four cells
//     around that edge — and those four cells are, necessarily, four cells the
//     surface passes through, so the vertex is always there;
//   · the grid is padded past the model, so the surface can never reach the
//     boundary and be left open at it.
//
// There is no arrangement of overlapping triangles to get right and no
// near-degenerate intersection to fall over, which is the whole reason for
// taking this route rather than cutting meshes against each other.
//
// WHAT IT DOES NOT GUARANTEE, because saying otherwise would be a lie a person
// could print. One vertex per cell means a feature thinner than a cell has both
// of its sides passing through the same cell, and the single vertex there joins
// two sheets that should never have met. The mesh stays closed — no edge is
// left with one triangle — but an edge can end up with more than two, which is
// a fold rather than a hole. Measured on a real model: a ring whose tube is
// about two and a half cells across produced seven such edges, and the same
// model at four cells across the tube produced none.
//
// Measured across sixteen models: thirteen come out with every edge shared by
// exactly two triangles. The other three have between two and eleven folded
// edges out of tens of thousands. Refining does NOT reliably fix them — counted
// at seven resolutions on one of them the folds went 0, 0, 0, 2, 0, 11, 2 — so
// nothing here pretends to fix it by looking closer.
//
// The real fix is one vertex per surface COMPONENT within a cell rather than
// one per cell, which is a known piece of work and is not done. Until it is,
// every mesh is counted and the count is handed back, and **nothing may claim
// this output is watertight without reading that count first.**
//
// SHARP EDGES. Placing each cell's vertex at the average of its crossings is
// simple and gives a smooth surface — and rounds off every corner, which for a
// bracket or an enclosure is wrong in a way nobody would accept. So the vertex
// is moved to the point that best satisfies the surface planes through those
// crossings, found by walking downhill against them rather than by solving a
// system: fewer lines, nothing to condition, and no special case when the
// planes are parallel. It is then held inside its own cell, which is what stops
// a vertex wandering into a neighbour's territory and folding the mesh.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-surface
// ============================================================
(function () {
  "use strict";

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  // How many cells across the model's longest side, when nothing says
  // otherwise. Sixty-four resolves a wall a fiftieth of the model thick, which
  // at the scale the app works at is about a millimetre on a hand-sized object.
  const DEFAULT_RESOLUTION = 64;

  // The grid is bounded in both directions: below it, a model is a lump; above
  // it, the sample count grows with the cube and the wait stops being a wait.
  const MIN_RESOLUTION = 8;
  const MAX_RESOLUTION = 192;

  // How hard the vertex is pulled toward the point that satisfies its planes.
  // Twenty passes is far past where it stops moving on the shapes this app
  // makes, and it costs nothing next to sampling the field.
  const SHARPEN_PASSES = 20;

  /**
   * A closed triangle mesh for whatever the field describes.
   *
   * Returns positions and indices ready to hand to a renderer or a file writer,
   * with the counts and the grid it used, so a caller can report what it did
   * rather than guess.
   */
  /**
   * A closed triangle mesh for whatever the field describes.
   *
   * One walk, at the resolution asked for. Two other things were tried here and
   * both are gone, because both were measured and neither worked.
   *
   * Refining when the result came back folded, on the reasoning that a finer
   * grid separates a feature from itself. It does not do so reliably. Counted
   * across one model at seven resolutions, the folded edges went 0, 0, 0, 2, 0,
   * 11, 2 — a lottery, not a convergence, and a loop that walks the grid three
   * times to play it is three times the wait for no promise.
   *
   * And choosing the resolution from the thinnest part in the model, so the
   * grid would be fine enough for it from the start. That made every model far
   * more expensive — one thin fin dragged the whole grid with it and a heatsink
   * went from one second to nearly six — and the models that folded still
   * folded.
   *
   * So: one walk, and the truth about what came out of it.
   */
  function extract(field, opts = {}) {
    const mesh = extractOnce(field, opts);
    if (mesh.stats.triangles > 0) {
      const info = inspect(mesh);
      mesh.stats.foldedEdges = info.nonManifoldEdges;
      mesh.stats.openEdges = info.boundaryEdges;
      if (info.nonManifoldEdges > 0) {
        mesh.issues.push({
          code: "folded",
          detail: `${info.nonManifoldEdges} edge(s) of ${info.triangles} triangles have more than two faces`,
        });
      }
    }
    return mesh;
  }

  function extractOnce(field, opts = {}) {
    const issues = [];
    if (!field || typeof field.evaluate !== "function") {
      return empty([{ code: "no-field", detail: "nothing to walk" }]);
    }

    const resolution = Math.round(Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, num(opts.resolution, DEFAULT_RESOLUTION))));
    const b = field.bounds || [0, 0, 0, 0, 0, 0];
    const size = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
    const span = Math.max(size[0], size[1], size[2]);
    if (!(span > 0)) return empty([{ code: "no-model", detail: "the field covers nothing" }]);

    const cell = span / resolution;
    // Two cells of air all round. Without it a model that reaches its own
    // bounding box would have the surface cut off at the boundary and the mesh
    // would be left open exactly there — which is the one thing this must not
    // produce.
    const pad = cell * 2;
    // Nudged off the round numbers by an odd fraction of a cell.
    //
    // A model is grounded to zero and built from round dimensions, so its flat
    // faces land exactly on sample planes far more often than chance suggests —
    // and a face lying exactly in a plane of the grid pinches the cells either
    // side of it onto the same point. The mesh stays closed, but those points
    // meet along edges shared by four triangles instead of two, and a flat disc
    // produced hundreds of them along its base.
    //
    // The offset is a fraction chosen not to be a simple ratio of anything, so
    // that a face at a round coordinate cannot coincide with a sample plane
    // whatever the resolution. It moves the surface by nothing a person or a
    // printer could measure.
    const skew = cell * 0.3178;
    const lo = [b[0] - pad - skew, b[1] - pad - skew, b[2] - pad - skew];
    const dims = [0, 1, 2].map((i) => Math.max(2, Math.ceil((size[i] + pad * 2) / cell) + 1));

    const totalSamples = (dims[0] + 1) * (dims[1] + 1) * (dims[2] + 1);
    if (totalSamples > 40e6) {
      return empty([{ code: "too-fine", detail: `${resolution} cells across would need ${Math.round(totalSamples / 1e6)}M samples` }]);
    }

    // ── the field, sampled at every corner — but not asked every time ──
    //
    // Nearly all of a grid is nowhere near the surface, and the field already
    // knows how far away it is: that is what a distance is. So a sample that
    // comes back a long way from any skin lets the next several along the row
    // be filled in rather than asked for, which on a real model is most of
    // them.
    //
    // This is exact, not an approximation, and the reason is worth stating. The
    // field never over-reports a distance, so a point d away cannot have a
    // surface closer than d — every filled value keeps the right sign. Two
    // cells of margin are left, so a filled value is never smaller than two
    // cells; a cell with a corner like that cannot contain a sign change, so no
    // cell that is actually processed ever reads one. The check compares a mesh
    // built this way against one built by asking at every single corner, and
    // they must be identical.
    const nx = dims[0] + 1, ny = dims[1] + 1, nz = dims[2] + 1;
    const values = new Float32Array(nx * ny * nz);
    const at = (i, j, k) => (k * ny + j) * nx + i;
    const askEverywhere = opts.exact === true;
    let asked = 0;
    for (let k = 0; k < nz; k++) {
      const z = lo[2] + k * cell;
      for (let j = 0; j < ny; j++) {
        const y = lo[1] + j * cell;
        let i = 0;
        while (i < nx) {
          let d = field.evaluate(lo[0] + i * cell, y, z);
          // A sample that lands exactly on the surface has no side to be on.
          // It happens far more than chance suggests, because a model is
          // grounded and sized to round numbers and its faces then fall exactly
          // on sample planes — a flat disc put a whole plane of exact zeros
          // through the grid. Nudged to the outside by an amount no geometry
          // can notice, so that every corner is definitely one thing or the
          // other and the crossings either side of it stay distinct.
          if (d === 0) d = cell * 1e-6;
          values[at(i, j, k)] = d;
          asked++;
          const room = askEverywhere ? 0 : Math.floor(Math.abs(d) / cell) - 2;
          if (room > 0) {
            const run = Math.min(room, nx - 1 - i);
            const sign = d < 0 ? -1 : 1;
            const size = Math.abs(d);
            for (let m = 1; m <= run; m++) values[at(i + m, j, k)] = sign * (size - m * cell);
            i += run + 1;
          } else {
            i += 1;
          }
        }
      }
    }

    // ── one vertex per cell the surface passes through ─────────────────
    //
    // Held in a map rather than an array the size of the grid, because on any
    // real model the surface touches a small fraction of the cells and the
    // array would be almost entirely empty.
    const cellVertex = new Map();
    const positions = [];
    const cellIndex = (i, j, k) => (k * dims[1] + j) * dims[0] + i;

    // The twelve edges of a cell, as pairs of its eight corners.
    const CORNERS = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ];
    const EDGES = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    // ── every crossing, worked out once ────────────────────────────────
    //
    // A grid edge is shared by up to four cells, so asking each cell for its
    // own crossings computed the same point and the same normal four times
    // over — and a normal costs four samples of the field, which is the most
    // expensive thing here. They are found once, on the edges, and looked up.
    const crossings = new Map();
    const edgeKey = (i, j, k, axis) => ((k * ny + j) * nx + i) * 3 + axis;
    const STEP = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const here = values[at(i, j, k)];
          for (let axis = 0; axis < 3; axis++) {
            const ni = i + STEP[axis][0], nj = j + STEP[axis][1], nk = k + STEP[axis][2];
            if (ni >= nx || nj >= ny || nk >= nz) continue;
            const there = values[at(ni, nj, nk)];
            if ((here < 0) === (there < 0)) continue;
            const t = here / (here - there);
            const px = lo[0] + (i + STEP[axis][0] * t) * cell;
            const py = lo[1] + (j + STEP[axis][1] * t) * cell;
            const pz = lo[2] + (k + STEP[axis][2] * t) * cell;
            crossings.set(edgeKey(i, j, k, axis), {
              p: [px, py, pz],
              n: field.normalAt(px, py, pz, cell * 0.05),
            });
          }
        }
      }
    }

    // Which grid edge each of a cell's twelve local edges is: the lower of its
    // two corners, and the axis it runs along.
    const LOCAL_EDGES = EDGES.map(([a, b]) => {
      const ca = CORNERS[a];
      const cb = CORNERS[b];
      const axis = cb[0] !== ca[0] ? 0 : cb[1] !== ca[1] ? 1 : 2;
      const base = [Math.min(ca[0], cb[0]), Math.min(ca[1], cb[1]), Math.min(ca[2], cb[2])];
      return { base, axis };
    });

    for (let k = 0; k < dims[2]; k++) {
      for (let j = 0; j < dims[1]; j++) {
        for (let i = 0; i < dims[0]; i++) {
          let negatives = 0;
          for (let c = 0; c < 8; c++) {
            if (values[at(i + CORNERS[c][0], j + CORNERS[c][1], k + CORNERS[c][2])] < 0) negatives++;
          }
          if (negatives === 0 || negatives === 8) continue;

          const points = [];
          const normals = [];
          for (const e of LOCAL_EDGES) {
            const hit = crossings.get(edgeKey(i + e.base[0], j + e.base[1], k + e.base[2], e.axis));
            if (!hit) continue;
            points.push(hit.p);
            normals.push(hit.n);
          }
          if (!points.length) continue;

          // Start at the middle of the crossings, then walk downhill against
          // the planes through them. On a flat face nothing moves; on an edge
          // it slides onto the crease; at a corner it lands on the corner.
          let vx = 0, vy = 0, vz = 0;
          for (const p of points) { vx += p[0]; vy += p[1]; vz += p[2]; }
          vx /= points.length; vy /= points.length; vz /= points.length;
          for (let pass = 0; pass < SHARPEN_PASSES; pass++) {
            let dx = 0, dy = 0, dz = 0;
            for (let n = 0; n < points.length; n++) {
              const p = points[n];
              const nrm = normals[n];
              const away = nrm[0] * (vx - p[0]) + nrm[1] * (vy - p[1]) + nrm[2] * (vz - p[2]);
              dx -= away * nrm[0]; dy -= away * nrm[1]; dz -= away * nrm[2];
            }
            const step = 0.7 / points.length;
            vx += dx * step; vy += dy * step; vz += dz * step;
          }
          // Held inside its own cell. A vertex that wanders into a neighbour's
          // cell folds the mesh over itself, and no amount of care elsewhere
          // recovers from that.
          vx = Math.min(lo[0] + (i + 1) * cell, Math.max(lo[0] + i * cell, vx));
          vy = Math.min(lo[1] + (j + 1) * cell, Math.max(lo[1] + j * cell, vy));
          vz = Math.min(lo[2] + (k + 1) * cell, Math.max(lo[2] + k * cell, vz));

          cellVertex.set(cellIndex(i, j, k), positions.length / 3);
          positions.push(vx, vy, vz);
        }
      }
    }

    if (!positions.length) {
      return empty([{ code: "no-surface", detail: "the field has no surface inside its own bounds" }]);
    }

    // ── one quad per crossed grid edge ─────────────────────────────────
    //
    // The four cells around a crossed edge all contain the surface, so all four
    // have a vertex. That is what makes the result closed without checking.
    const indices = [];
    /**
     * Emit a quad facing the way the field says out is.
     *
     * The winding is decided from the geometry rather than from a table of
     * which way each ring of cells turns. A table has to be right about the
     * handedness of three different planes, and getting one of the three wrong
     * does not open the mesh or fold it — every edge still has exactly two
     * triangles, so nothing about the topology complains. It shows up only as a
     * volume that is a fraction of the truth, because the family wound against
     * the others subtracts itself from it. A mesh like that looks right,
     * measures wrong, and tells a slicer the inside is the outside.
     *
     * So the first triangle's own normal is compared with the direction the
     * field increases in, and the pair is emitted whichever way agrees.
     */
    const quad = (a, b, c, d, outward) => {
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const facing = (uy * vz - uz * vy) * outward[0]
        + (uz * vx - ux * vz) * outward[1]
        + (ux * vy - uy * vx) * outward[2];
      if (facing >= 0) indices.push(a, b, c, a, c, d);
      else indices.push(a, c, b, a, d, c);
    };
    // For an edge along each axis, the four cells that share it.
    //
    // Each ring must turn the same way about its own axis, or one family of
    // quads comes out wound against the other two. That does not open the mesh
    // and it does not fold it — every edge still has exactly two triangles — so
    // nothing about the topology complains. It shows up only in the volume,
    // which came out at exactly a third of the truth, the two consistent
    // families minus the inconsistent one. A mesh like that looks right,
    // measures wrong, and confuses anything that asks which side is inside.
    const AROUND = [
      [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]],
      [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]],
      [[-1, -1, 0], [-1, 0, 0], [0, 0, 0], [0, -1, 0]],
    ];

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const here = values[at(i, j, k)];
          for (let axis = 0; axis < 3; axis++) {
            const ni = i + STEP[axis][0], nj = j + STEP[axis][1], nk = k + STEP[axis][2];
            if (ni >= nx || nj >= ny || nk >= nz) continue;
            const there = values[at(ni, nj, nk)];
            if ((here < 0) === (there < 0)) continue;
            const corners = AROUND[axis];
            const v = [];
            let complete = true;
            for (const c of corners) {
              const ci = i + c[0], cj = j + c[1], ck = k + c[2];
              if (ci < 0 || cj < 0 || ck < 0 || ci >= dims[0] || cj >= dims[1] || ck >= dims[2]) { complete = false; break; }
              const idx = cellVertex.get(cellIndex(ci, cj, ck));
              if (idx === undefined) { complete = false; break; }
              v.push(idx);
            }
            // Only at the very edge of the padded grid, where by construction
            // there is no surface. Counted so that a claim of watertightness is
            // measured rather than assumed.
            if (!complete) { issues.push({ code: "open-edge", detail: "a crossing at the grid boundary" }); continue; }
            // Out is the way the field grows: from the inside corner of this
            // edge towards the outside one.
            const sense = here < 0 ? 1 : -1;
            quad(v[0], v[1], v[2], v[3], [STEP[axis][0] * sense, STEP[axis][1] * sense, STEP[axis][2] * sense]);
          }
        }
      }
    }

    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        resolution,
        cell,
        samples: totalSamples,
        asked,
        foldedEdges: 0,
        openEdges: 0,
      },
      issues,
    };
  }

  function empty(issues) {
    return {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      stats: { vertices: 0, triangles: 0, resolution: 0, cell: 0, samples: 0, asked: 0, foldedEdges: 0, openEdges: 0 },
      issues: issues || [],
    };
  }

  /**
   * What the mesh actually is, measured from the mesh.
   *
   * Watertightness is not a claim to make from the method — it is a thing to
   * count. Every edge of a closed surface is shared by exactly two triangles,
   * and any edge with one or three is a hole or a fold. The volume is signed,
   * so it also reports whether the surface faces outwards: a mesh wound inside
   * out has the right shape and the wrong sign, and only a slicer would notice.
   */
  function inspect(mesh) {
    const pos = mesh?.positions;
    const idx = mesh?.indices;
    if (!pos || !idx || idx.length < 3) {
      return { closed: false, volume: 0, area: 0, boundaryEdges: 0, nonManifoldEdges: 0, triangles: 0 };
    }
    const counts = new Map();
    let volume = 0;
    let area = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const key = p < q ? `${p}_${q}` : `${q}_${p}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    let boundaryEdges = 0;
    let nonManifoldEdges = 0;
    for (const n of counts.values()) {
      if (n === 1) boundaryEdges++;
      else if (n > 2) nonManifoldEdges++;
    }
    return {
      closed: boundaryEdges === 0 && nonManifoldEdges === 0,
      volume,
      area,
      boundaryEdges,
      nonManifoldEdges,
      triangles: idx.length / 3,
    };
  }

  window.HCForgeSurface = {
    DEFAULT_RESOLUTION,
    MIN_RESOLUTION,
    MAX_RESOLUTION,
    extract,
    extractOnce,
    inspect,
  };
})();
