// ============================================================
// subdivide.js — more triangles without losing the surface
//
// A plan may ask for `"subdivisions": 1`. What that used to do was take the
// mesh apart into loose triangles, cut each one into four, and hand back
// nothing but positions. Three things were lost in that trip and all three
// were visible:
//
//   The index. Once every triangle owns its own three corners, no two
//   triangles share a vertex, and the normals computed afterwards can only be
//   per-face. A sphere asked to be smoother came back faceted — the opposite
//   of what was asked for.
//
//   The texture coordinates. A part carrying lettering lost its mapping
//   entirely, so the lettering did not appear at all.
//
//   Four times the triangles, for a shape that had not changed. The split is
//   linear: every new corner sits exactly on the edge it came from, so the
//   silhouette, the bounding box and the measured size are identical before
//   and after. That is deliberate and it must stay that way — this is a
//   millimetre-accurate part generator, and a smoothing subdivision would
//   quietly shrink a part away from the size the person asked for. Denser
//   triangles are the whole product here; a rounder shape is not.
//
// So the split now shares its new corners. An edge between two triangles
// yields ONE midpoint, used by both, which is what makes the result still a
// closed manifold and what lets averaged normals be smooth. Normals and
// texture coordinates are carried through the split rather than dropped.
//
// A mesh that arrives without an index is welded first: corners that match in
// position, normal AND texture coordinate become one vertex. Matching on
// position alone would be wrong — a box's corner is three different vertices
// on purpose, one per face, and merging them would round off an edge that is
// meant to be sharp.
//
// Pure: plain arrays in, plain arrays out. No THREE, no DOM, no network, no
// clock.
//
// Run the checks with: npm run check:forge-subdivide
// ============================================================
(function () {
  "use strict";

  // Two levels is already sixteen times the triangles. Past that the cost is
  // real and the difference is not.
  const MAX_LEVELS = 2;

  // The ceiling on what may be split, in triangles of input.
  //
  // Held at the same place the old cap sat — it was written as 12,000
  // positions, which is 4,000 triangles — so no model that used to be
  // subdivided stops being subdivided by this change.
  const MAX_TRIANGLES_IN = 4000;

  // How close two corners must be to be the same corner.
  //
  // The scene runs at a working span of 2, so this is a millionth of the model
  // and far below anything a person or a printer can resolve. It exists only
  // to absorb the last bit of floating-point noise; it is used to build the
  // lookup key and never to alter a stored coordinate.
  const WELD_QUANTUM = 1e-6;

  const arr = (v) => (v && typeof v.length === "number" ? Array.from(v, Number) : []);
  const q = (v) => Math.round(Number(v) / WELD_QUANTUM);

  /**
   * The mesh as this module expects it, with anything unusable dropped.
   *
   * An attribute is only carried when it has one entry per vertex. A partial
   * normal array is worse than none: it would be interpolated into nonsense at
   * the seam where it runs out, and nothing would complain.
   */
  function normalise(mesh) {
    const positions = arr(mesh && mesh.positions);
    const count = Math.floor(positions.length / 3);
    const normals = arr(mesh && mesh.normals);
    const uvs = arr(mesh && mesh.uvs);
    const indices = arr(mesh && mesh.indices).map((v) => Math.floor(v));
    return {
      positions: positions.slice(0, count * 3),
      normals: normals.length === count * 3 ? normals.slice() : null,
      uvs: uvs.length === count * 2 ? uvs.slice() : null,
      indices: indices.length >= 3 && indices.every((i) => i >= 0 && i < count)
        ? indices.slice(0, Math.floor(indices.length / 3) * 3)
        : null,
    };
  }

  /**
   * Give a loose triangle soup an index, without changing how it looks.
   *
   * Corners are merged only when position, normal and texture coordinate all
   * agree. The rendered result is therefore identical to the input — every
   * shading discontinuity the mesh was built with survives, because the two
   * vertices that carry it differ in their normals and so stay two vertices.
   */
  function weld(mesh) {
    const m = normalise(mesh);
    if (m.indices) return m;
    const count = Math.floor(m.positions.length / 3);
    const seen = new Map();
    const positions = [];
    const normals = m.normals ? [] : null;
    const uvs = m.uvs ? [] : null;
    const indices = [];
    for (let i = 0; i < count; i++) {
      const key = [
        q(m.positions[i * 3]), q(m.positions[i * 3 + 1]), q(m.positions[i * 3 + 2]),
        m.normals ? q(m.normals[i * 3]) : 0,
        m.normals ? q(m.normals[i * 3 + 1]) : 0,
        m.normals ? q(m.normals[i * 3 + 2]) : 0,
        m.uvs ? q(m.uvs[i * 2]) : 0,
        m.uvs ? q(m.uvs[i * 2 + 1]) : 0,
      ].join(",");
      let at = seen.get(key);
      if (at === undefined) {
        at = positions.length / 3;
        seen.set(key, at);
        positions.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
        if (normals) normals.push(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
        if (uvs) uvs.push(m.uvs[i * 2], m.uvs[i * 2 + 1]);
      }
      indices.push(at);
    }
    return {
      positions,
      normals,
      uvs,
      indices: indices.slice(0, Math.floor(indices.length / 3) * 3),
    };
  }

  /**
   * One level: every triangle becomes four, and every edge one new corner.
   *
   * The midpoint of an edge is cached against the pair of vertices that make
   * it, lowest first, so the two triangles either side of that edge are handed
   * the same vertex. That single fact is what keeps the mesh closed — give
   * them a midpoint each and the surface acquires a crack down every original
   * edge, which no topology check would report and which shows up as a model
   * that will not slice.
   */
  function splitOnce(mesh) {
    const m = weld(mesh);
    if (!m.indices) return m;
    const positions = m.positions.slice();
    const normals = m.normals ? m.normals.slice() : null;
    const uvs = m.uvs ? m.uvs.slice() : null;
    const midpoints = new Map();

    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const known = midpoints.get(key);
      if (known !== undefined) return known;
      const at = positions.length / 3;
      positions.push(
        (m.positions[a * 3] + m.positions[b * 3]) / 2,
        (m.positions[a * 3 + 1] + m.positions[b * 3 + 1]) / 2,
        (m.positions[a * 3 + 2] + m.positions[b * 3 + 2]) / 2,
      );
      if (normals) {
        let nx = (m.normals[a * 3] + m.normals[b * 3]) / 2;
        let ny = (m.normals[a * 3 + 1] + m.normals[b * 3 + 1]) / 2;
        let nz = (m.normals[a * 3 + 2] + m.normals[b * 3 + 2]) / 2;
        // Two averaged normals are shorter than either, and opposite ones
        // average to nothing. Rescale when there is something to rescale, and
        // otherwise leave the average alone rather than inventing a direction.
        const len = Math.hypot(nx, ny, nz);
        if (len > 1e-8) { nx /= len; ny /= len; nz /= len; }
        normals.push(nx, ny, nz);
      }
      if (uvs) {
        uvs.push(
          (m.uvs[a * 2] + m.uvs[b * 2]) / 2,
          (m.uvs[a * 2 + 1] + m.uvs[b * 2 + 1]) / 2,
        );
      }
      midpoints.set(key, at);
      return at;
    };

    const indices = [];
    for (let i = 0; i + 2 < m.indices.length; i += 3) {
      const a = m.indices[i];
      const b = m.indices[i + 1];
      const c = m.indices[i + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      // Each of the four keeps the parent's winding, so the surface still
      // faces the way it did. A flipped centre triangle is invisible in
      // shading and turns up later as a volume that is a fraction of the truth.
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    return { positions, normals, uvs, indices };
  }

  /**
   * Split up to `times` levels, or say why it did not.
   *
   * The ceiling is tested before EVERY level, not once at the start. Each
   * level is four times the work of the one before it, so a mesh that is
   * comfortably under the limit going in can be far over it by the second
   * pass — and the point of a ceiling is to stop at the moment it is reached,
   * not to have agreed to the whole journey at the door.
   *
   * Never throws and never returns nothing: a mesh too large to split comes
   * back welded and whole, with a reason, so the caller can say what happened
   * instead of showing a model that silently ignored the request.
   */
  function subdivide(mesh, times) {
    const levels = Math.min(MAX_LEVELS, Math.max(0, Math.floor(Number(times) || 0)));
    let out = weld(mesh);
    let triangles = out.indices ? out.indices.length / 3 : 0;
    if (!triangles) return { ...out, applied: 0, triangles: 0, reason: "no triangles" };
    if (!levels) return { ...out, applied: 0, triangles, reason: "none asked for" };
    let applied = 0;
    let reason = "";
    for (let i = 0; i < levels; i++) {
      if (triangles > MAX_TRIANGLES_IN) {
        reason = `stopped at ${triangles} triangles`;
        break;
      }
      out = splitOnce(out);
      triangles = out.indices.length / 3;
      applied++;
    }
    return { ...out, applied, triangles, reason };
  }

  window.HCForgeSubdivide = {
    MAX_LEVELS,
    MAX_TRIANGLES_IN,
    weld,
    splitOnce,
    subdivide,
  };
})();
