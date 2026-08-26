// ============================================================
// io/import.js — a written file back into a part of a model
//
// This app writes four printing and CAD formats and, until now, could open
// only a scene file. Somebody who exported a part and wanted it back had been
// handed a dead end.
//
// The readers already existed — they are what the export checks measure files
// with. What was missing is the step after them: turning a pile of triangles
// in millimetres into a part the scene can hold.
//
// THAT STEP IS NOT A CONVERSION, IT IS A CHANGE OF LENS. The file's numbers are
// millimetres. The scene runs at a working span that has nothing to do with how
// big anything is, precisely so that every tolerance in the pipeline means one
// thing. So the geometry is brought to that span and the real size is carried
// beside it — the same arrangement a designed plan already has, and the reason
// a re-imported part comes back the size it was written at rather than as a
// speck or a wall.
//
// It is also CENTRED on the way in. A file may hold an object anywhere in
// space, and a part that arrives a hundred millimetres from the origin looks
// like the import failing.
//
// Pure: plain bytes and text in, a plain part out. No THREE, no DOM.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const M = () => window.HCForgeMeshIO;

  /** Which of our own formats a filename names, or null for anything else. */
  function formatOf(fileName) {
    const ext = (String(fileName || "").match(/\.([^.]+)$/) || [])[1];
    const kind = String(ext || "").toLowerCase();
    if (kind === "stl" || kind === "obj") return kind;
    if (kind === "3mf") return "3mf";
    if (kind === "step" || kind === "stp") return "step";
    return null;
  }

  /**
   * The triangles in a file, through the reader that understands it.
   *
   * `bytes` is an ArrayBuffer or a byte array; the text formats are decoded
   * here so a caller never has to know which is which.
   */
  function readAs(kind, bytes) {
    const asBytes = () => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const asText = () => new TextDecoder().decode(asBytes());
    if (kind === "stl") return window.HCForgeSTL ? window.HCForgeSTL.read(asBytes()) : null;
    if (kind === "obj") return window.HCForgeOBJ ? window.HCForgeOBJ.read(asText()) : null;
    if (kind === "3mf") return window.HCForge3MF ? window.HCForge3MF.read(asBytes()) : null;
    if (kind === "step") return window.HCForgeSTEP ? window.HCForgeSTEP.read(asText()) : null;
    return null;
  }

  /**
   * A read mesh as a part of a plan, with the size it was written at.
   *
   * Returns null rather than an empty part when there is nothing in the file,
   * so a caller can say the import found nothing instead of adding a part that
   * is not there.
   */
  function nodeFrom(mesh, name, opts = {}) {
    const IO = M();
    if (!IO || !mesh) return null;
    const clean = IO.fromArrays(mesh);
    const triangles = IO.triangleCount(clean);
    if (!triangles) return null;

    const size = IO.size(clean);
    const longest = Math.max(size[0], size[1], size[2]);
    const span = Number(opts.workingSpan) > 0 ? Number(opts.workingSpan) : 2;
    const factor = longest > 0 ? span / longest : 1;
    const box = IO.bounds(clean);
    const centre = box ? [0, 1, 2].map((k) => (box[0][k] + box[1][k]) / 2) : [0, 0, 0];

    const positions = new Array(clean.positions.length);
    for (let i = 0; i < clean.positions.length; i += 3) {
      positions[i] = (clean.positions[i] - centre[0]) * factor;
      positions[i + 1] = (clean.positions[i + 1] - centre[1]) * factor;
      positions[i + 2] = (clean.positions[i + 2] - centre[2]) * factor;
    }

    return {
      node: {
        id: String(opts.id || `asset_${Date.now().toString(36)}`),
        name: IO.safeName(name || clean.name || "Imported part"),
        role: "structure",
        type: "mesh",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        params: {
          positions,
          indices: clean.indices ? clean.indices.slice() : undefined,
          smooth: true,
        },
        color: "#c9a96e",
      },
      // What the file said the object measures, kept beside the geometry
      // rather than inside it.
      sizeMm: longest,
      triangles,
      vertices: IO.vertexCount(clean),
    };
  }

  window.HCForgeImportIO = { formatOf, readAs, nodeFrom };
})();
