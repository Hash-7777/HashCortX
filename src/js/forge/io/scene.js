// ============================================================
// io/scene.js — many placed parts into one triangle list
//
// Every writer wants one mesh. The scene holds a dozen, each with its own
// placement, and turning that into one list is where a subtle and expensive
// mistake lives:
//
// A MIRRORED PART IS INSIDE OUT IF ITS WINDING IS NOT PUT BACK. Mirroring is
// done by negating a scale, and a placement whose determinant is negative
// reverses the way every one of that part's triangles winds. Nothing obvious
// breaks. Every corner is in the right place, the bounding box is right, the
// triangle count is right — and half the object's surface faces inwards,
// which a slicer reads as a hole in the solid. It is the same class of defect
// as an inconsistently wound extraction, and the same measurement catches it:
// the volume, which comes out short by exactly the mirrored part.
//
// The arithmetic is done here, on plain numbers, rather than in the mode with
// the scene library's help — because here it can be measured. A check can
// place a part with a negative scale, merge it, and read the volume back.
//
// A placement is sixteen numbers in the same order the scene library keeps
// them: column-major, so the translation is at 12, 13, 14.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const M = () => window.HCForgeMeshIO;

  /** One point through a column-major 4x4, with the perspective divide. */
  function place(m, x, y, z) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  }

  /**
   * Does this placement turn the object inside out?
   *
   * Only the rotation and scale part decides it — the translation cannot flip
   * anything. A determinant of zero means the part has been flattened to
   * nothing, which is not a flip and is left alone: it has no volume to be
   * wrong about.
   */
  function reversesWinding(m) {
    if (!m || m.length < 16) return false;
    const det = m[0] * (m[5] * m[10] - m[6] * m[9])
      - m[4] * (m[1] * m[10] - m[2] * m[9])
      + m[8] * (m[1] * m[6] - m[2] * m[5]);
    return det < 0;
  }

  /**
   * Every part, placed and joined into one indexed mesh.
   *
   * Indexed rather than loose, because three of the four formats can hold a
   * shared vertex and writing them out loose would triple the file for
   * nothing. STL cannot, and its writer expands them itself.
   */
  function merge(parts, name) {
    const positions = [];
    const indices = [];
    for (const part of Array.isArray(parts) ? parts : []) {
      const source = M().fromArrays(part);
      const count = M().vertexCount(source);
      if (!count) continue;
      const m = part && part.matrix && part.matrix.length >= 16 ? Array.from(part.matrix, Number) : null;
      const base = positions.length / 3;
      for (let i = 0; i < count; i++) {
        const x = source.positions[i * 3];
        const y = source.positions[i * 3 + 1];
        const z = source.positions[i * 3 + 2];
        if (m) positions.push(...place(m, x, y, z));
        else positions.push(x, y, z);
      }
      const flip = reversesWinding(m);
      const total = source.indices ? source.indices.length : count;
      const at = (i) => base + (source.indices ? source.indices[i] : i);
      for (let i = 0; i + 2 < total; i += 3) {
        if (flip) indices.push(at(i), at(i + 2), at(i + 1));
        else indices.push(at(i), at(i + 1), at(i + 2));
      }
    }
    return M().fromArrays({ positions, indices, name });
  }

  window.HCForgeSceneIO = { merge, place, reversesWinding };
})();
