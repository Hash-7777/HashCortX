// ============================================================
// io/stl.js — writing and reading binary STL ourselves
//
// STL is what a slicer wants and it carries almost nothing: no units, no
// names, no colours, no shared vertices. Every triangle is written out with
// its three corners in full, and the file says nothing about how big a unit
// is. The universal convention for printing is that a unit is a millimetre,
// so that is what is written — which is the whole reason the model's real size
// had to be settled before this step could be honest.
//
// WHY OUR OWN WRITER. The generic mesh exporter walks a scene graph and knows
// nothing about the part being made. Writing it here means the bytes can be
// read back and measured in a check, which is the only way to know a file
// opens as the object that was on screen rather than at a thousand times the
// size or inside out.
//
// THE HEADER TRAP, ON READING. A binary STL starts with 80 free-form bytes,
// and plenty of writers fill them with the word "solid" — which is also how an
// ASCII STL starts. A reader that decides by that prefix misreads those files
// completely. The format is decided here by ARITHMETIC instead: a binary file
// is exactly 84 + 50 × triangles bytes long, and nothing else is.
//
// Our own header therefore does NOT begin with "solid", so no other reader
// making that mistake can trip over a file this app wrote.
//
// Pure: plain arrays and bytes in, plain arrays and bytes out.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const M = () => window.HCForgeMeshIO;

  const HEADER_BYTES = 80;
  const TRIANGLE_BYTES = 50;

  /**
   * The model as binary STL bytes.
   *
   * The header records what the file itself cannot: the app that wrote it and
   * the size the part is meant to be, so anyone opening the file at the wrong
   * scale has somewhere to look. It is truncated to fit rather than allowed to
   * push the triangle count out of place.
   */
  function write(source, opts = {}) {
    const mesh = M().fromArrays(source);
    const count = M().triangleCount(mesh);
    const bytes = new Uint8Array(HEADER_BYTES + 4 + count * TRIANGLE_BYTES);
    const view = new DataView(bytes.buffer);

    const mm = M().size(mesh).map((v) => Math.round(v * 10) / 10);
    const header = `HashCortX 3D Forge · ${M().safeName(opts.name || mesh.name, 24)} · ${mm.join(" x ")} mm`;
    for (let i = 0; i < HEADER_BYTES; i++) {
      const code = header.charCodeAt(i);
      // ASCII only. A prompt can be written in any language, and a multi-byte
      // character truncated in the middle of itself is a header that some
      // readers refuse outright.
      bytes[i] = Number.isFinite(code) && code >= 32 && code < 127 ? code : 32;
    }

    view.setUint32(HEADER_BYTES, count, true);
    let at = HEADER_BYTES + 4;
    for (let i = 0; i < count; i++) {
      const n = M().normal(mesh, i);
      const [a, b, c] = M().triangle(mesh, i);
      view.setFloat32(at, n[0], true);
      view.setFloat32(at + 4, n[1], true);
      view.setFloat32(at + 8, n[2], true);
      let o = at + 12;
      for (const p of [a, b, c]) {
        view.setFloat32(o, p[0], true);
        view.setFloat32(o + 4, p[1], true);
        view.setFloat32(o + 8, p[2], true);
        o += 12;
      }
      // The attribute word. Zero, because the two things it is used for —
      // per-triangle colour in two incompatible conventions — would be a
      // colour claim this app cannot make truthfully.
      view.setUint16(at + 48, 0, true);
      at += TRIANGLE_BYTES;
    }
    return bytes;
  }

  /** Is this binary STL? Decided by length, never by the leading word. */
  function isBinary(bytes) {
    if (!bytes || bytes.length < HEADER_BYTES + 4) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(HEADER_BYTES, true);
    return bytes.length === HEADER_BYTES + 4 + count * TRIANGLE_BYTES;
  }

  /**
   * A file back into a mesh, so what was written can be measured.
   *
   * The triangles come back exactly as the format holds them — loose, three
   * corners each, no index — because that is what STL is. A reader that welded
   * them here would be reporting a vertex count the file does not contain.
   */
  function read(bytes) {
    if (isBinary(bytes)) return readBinary(bytes);
    return readAscii(new TextDecoder().decode(bytes));
  }

  function readBinary(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(HEADER_BYTES, true);
    const positions = new Array(count * 9);
    let at = HEADER_BYTES + 4;
    for (let i = 0; i < count; i++) {
      let o = at + 12;
      for (let c = 0; c < 3; c++) {
        positions[i * 9 + c * 3] = view.getFloat32(o, true);
        positions[i * 9 + c * 3 + 1] = view.getFloat32(o + 4, true);
        positions[i * 9 + c * 3 + 2] = view.getFloat32(o + 8, true);
        o += 12;
      }
      at += TRIANGLE_BYTES;
    }
    let header = "";
    for (let i = 0; i < HEADER_BYTES; i++) header += String.fromCharCode(bytes[i]);
    return { ...M().fromArrays({ positions, name: header.trim() }), format: "binary" };
  }

  function readAscii(text) {
    const positions = [];
    const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
    let m;
    while ((m = re.exec(text))) positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
    // A whole triangle or none: a file cut off part way through one would
    // otherwise come back with a corner belonging to nothing.
    positions.length = Math.floor(positions.length / 9) * 9;
    const named = /^\s*solid\s+([^\r\n]*)/.exec(text);
    return { ...M().fromArrays({ positions, name: (named && named[1].trim()) || "model" }), format: "ascii" };
  }

  window.HCForgeSTL = { write, read, isBinary, HEADER_BYTES, TRIANGLE_BYTES };
})();
