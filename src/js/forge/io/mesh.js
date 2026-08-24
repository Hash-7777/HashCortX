// ============================================================
// io/mesh.js — the one shape every file writer and reader speaks
//
// A written file is only as good as the thing handed to it, and until now each
// export handed the scene graph to a different library and hoped. This is the
// single vocabulary instead: a triangle list, in millimetres, with the
// measurements taken from the triangles themselves.
//
//   { positions: number[], indices: number[] | null, name: string }
//
// `indices` may be null, which means the positions are already triangle after
// triangle. Every writer accepts both and every reader says which it produced,
// because the formats genuinely differ: STL has no notion of a shared vertex
// at all, while OBJ, 3MF and STEP all do.
//
// WHY THE MEASUREMENTS LIVE HERE. The round-trip check that makes these
// writers trustworthy — write a file, read it back, and confirm it is the same
// object — is only meaningful if both sides are measured the same way. Four
// copies of "how big is this" in four writers is exactly how one of them ends
// up subtly disagreeing, and a size that disagrees by a factor of ten is a
// print that fails on the bed rather than in a test.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const arr = (v) => (v && typeof v.length === "number" ? Array.from(v, num) : []);

  /**
   * A mesh, with anything unusable dropped rather than carried.
   *
   * An index that names a vertex which is not there is refused as a whole —
   * silently dropping the offending triangle would write a file with a hole in
   * it, and a hole in a printed part is the failure this whole step exists to
   * prevent.
   */
  function fromArrays(source) {
    const positions = arr(source && source.positions);
    const usable = Math.floor(positions.length / 3);
    let indices = arr(source && source.indices).map((v) => Math.floor(v));
    if (indices.length < 3 || !indices.every((i) => i >= 0 && i < usable)) indices = null;
    else indices = indices.slice(0, Math.floor(indices.length / 3) * 3);
    return {
      positions: positions.slice(0, usable * 3),
      indices,
      name: String((source && source.name) || "model"),
    };
  }

  const vertexCount = (mesh) => Math.floor(mesh.positions.length / 3);
  const triangleCount = (mesh) => (mesh.indices ? mesh.indices.length / 3 : Math.floor(vertexCount(mesh) / 3));

  /** The three corners of triangle `i`, each as [x, y, z]. */
  function triangle(mesh, i) {
    const at = (v) => [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    if (mesh.indices) return [at(mesh.indices[i * 3]), at(mesh.indices[i * 3 + 1]), at(mesh.indices[i * 3 + 2])];
    return [at(i * 3), at(i * 3 + 1), at(i * 3 + 2)];
  }

  /** Every position multiplied, for the moment a scene unit becomes a real one. */
  function scaled(mesh, factor) {
    const f = num(factor);
    if (!(f > 0) || f === 1) return { ...mesh, positions: mesh.positions.slice() };
    return { ...mesh, positions: mesh.positions.map((v) => v * f) };
  }

  function bounds(mesh) {
    if (!vertexCount(mesh)) return null;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.positions[i + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    return [lo, hi];
  }

  function size(mesh) {
    const box = bounds(mesh);
    return box ? [box[1][0] - box[0][0], box[1][1] - box[0][1], box[1][2] - box[0][2]] : [0, 0, 0];
  }

  /**
   * The volume the triangles enclose, by the tetrahedron sum.
   *
   * Used by the round-trip checks and not by any writer. It is the one
   * measurement that notices a triangle written the other way round: nothing
   * about a triangle count or a bounding box changes when the winding is
   * reversed, and a slicer reading such a file quietly makes the part inside
   * out. Negative means the whole mesh is wound inwards.
   */
  function volume(mesh) {
    let sum = 0;
    for (let i = 0, n = triangleCount(mesh); i < n; i++) {
      const [a, b, c] = triangle(mesh, i);
      sum += (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6;
    }
    return sum;
  }

  /** The outward normal of triangle `i`, or [0, 0, 0] where it has no area. */
  function normal(mesh, i) {
    const [a, b, c] = triangle(mesh, i);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]);
    return len > 0 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0];
  }

  /**
   * A name a file system will accept, for the model name written inside a file.
   *
   * Not a security measure — nothing here reaches a path — but a plan name
   * comes from a prompt, and a stray quote or angle bracket inside an XML
   * attribute or a STEP string ends the file's own syntax.
   */
  function safeName(name, limit = 64) {
    return String(name || "model")
      .replace(/[\u0000-\u001f<>&"'\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit) || "model";
  }

  window.HCForgeMeshIO = {
    fromArrays,
    vertexCount,
    triangleCount,
    triangle,
    scaled,
    bounds,
    size,
    volume,
    normal,
    safeName,
  };
})();
