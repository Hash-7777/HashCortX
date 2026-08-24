// ============================================================
// io/obj.js — writing and reading Wavefront OBJ ourselves
//
// OBJ is the format everything opens. It is plain text, it has been the same
// since the 1980s, and unlike STL it can hold a SHARED vertex — so a box is
// eight corners rather than thirty-six loose ones, and a file is a third the
// size for the same object.
//
// It still carries no units. There is no field for them and no agreement about
// what one means, so the size is written into a comment at the top where a
// person can read it, and the numbers themselves are millimetres — the same
// convention the STL writer uses, for the same reason.
//
// TWO THINGS THE FORMAT DOES THAT CATCH READERS OUT, both handled here:
//
//   Face indices are 1-BASED. Writing them from zero produces a file that
//   opens with every triangle shifted by one vertex — a recognisable object,
//   subtly wrong everywhere, which is worse than one that fails to open.
//
//   A face index may be NEGATIVE, meaning "counted back from the vertices so
//   far". Almost nothing writes that any more and plenty of files still use
//   it, so the reader handles it rather than producing silent nonsense.
//
// A face may also name a texture coordinate and a normal, as `v/vt/vn`. Only
// the vertex is taken; this app has neither to write and neither belongs in a
// printed part.
//
// Pure: text in, plain arrays out.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const M = () => window.HCForgeMeshIO;

  /**
   * The model as OBJ text.
   *
   * Coordinates are written with six decimal places. At millimetre scale that
   * is a nanometre of resolution — far past anything that can be printed or
   * measured — while `toString` on a float would sometimes write seventeen
   * digits and make the file several times larger for no gain at all.
   */
  function write(source, opts = {}) {
    const mesh = M().fromArrays(source);
    const name = M().safeName(opts.name || mesh.name);
    const mm = M().size(mesh).map((v) => Math.round(v * 1000) / 1000);
    const round = (v) => {
      const s = v.toFixed(6);
      // Trailing zeros are noise in a file this size, and "-0" is a coordinate
      // that reads as wrong to anyone looking at the text.
      const trimmed = s.replace(/\.?0+$/, "");
      return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
    };

    const lines = [
      `# HashCortX 3D Forge`,
      `# ${name}`,
      `# units: millimetres`,
      `# size: ${mm[0]} x ${mm[1]} x ${mm[2]} mm`,
      `o ${name}`,
    ];
    for (let i = 0, n = M().vertexCount(mesh); i < n; i++) {
      lines.push(`v ${round(mesh.positions[i * 3])} ${round(mesh.positions[i * 3 + 1])} ${round(mesh.positions[i * 3 + 2])}`);
    }
    for (let i = 0, n = M().triangleCount(mesh); i < n; i++) {
      const at = (k) => (mesh.indices ? mesh.indices[i * 3 + k] : i * 3 + k) + 1;
      lines.push(`f ${at(0)} ${at(1)} ${at(2)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  /**
   * OBJ text back into a mesh.
   *
   * A face with more than three corners is fanned into triangles from its
   * first, which is what every reader does and is correct for the convex,
   * planar faces the format is written with. A face with fewer than three is
   * not a face and is dropped.
   */
  function read(text) {
    const positions = [];
    const indices = [];
    let name = "model";
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/\s+/);
      const kind = parts[0];
      if (kind === "v" && parts.length >= 4) {
        positions.push(Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0);
      } else if (kind === "o" || kind === "g") {
        if (name === "model" && parts.length > 1) name = parts.slice(1).join(" ");
      } else if (kind === "f" && parts.length >= 4) {
        const total = positions.length / 3;
        const corner = [];
        for (let i = 1; i < parts.length; i++) {
          const first = parts[i].split("/")[0];
          const n = Math.trunc(Number(first));
          if (!Number.isFinite(n) || n === 0) { corner.length = 0; break; }
          // 1-based forwards, or counted back from the end when negative.
          const at = n > 0 ? n - 1 : total + n;
          if (at < 0 || at >= total) { corner.length = 0; break; }
          corner.push(at);
        }
        for (let i = 2; i < corner.length; i++) indices.push(corner[0], corner[i - 1], corner[i]);
      }
    }
    return M().fromArrays({ positions, indices, name });
  }

  window.HCForgeOBJ = { write, read };
})();
