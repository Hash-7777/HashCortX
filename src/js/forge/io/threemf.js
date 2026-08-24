// ============================================================
// io/threemf.js — 3MF, the one format that says what a unit is
//
// STL and OBJ both hand a slicer a pile of numbers and leave it to guess
// whether they are millimetres or inches. 3MF does not: `unit="millimeter"` is
// a required attribute of the model itself, so a part written here arrives at
// the size it was designed at, in any program that reads the format, without
// anyone typing a scale. That is the whole reason it is worth the zip
// container underneath it.
//
// It also carries a name and the application that wrote it, which STL can only
// hint at in 80 free bytes and OBJ can only put in a comment.
//
// A 3MF is three members in a zip:
//   [Content_Types].xml   what each member is
//   _rels/.rels           which member is the model
//   3D/3dmodel.model      the geometry
//
// VERTICES ARE WELDED BY POSITION BEFORE WRITING. The format describes a
// printable object, and a printable object is a closed solid — two corners at
// the same point belonging to different triangles is a seam, and a reader
// checking for a closed surface will call the mesh open. The scene's meshes
// carry duplicate corners on purpose, so the surface can be shaded with hard
// edges; that is a screen concern and has no meaning in a file about material.
//
// Pure: plain arrays in, bytes out.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const M = () => window.HCForgeMeshIO;
  const Z = () => window.HCForgeZip;

  const NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
  const MODEL_PART = "3D/3dmodel.model";
  const REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";

  const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]
  ));

  // Six decimals at millimetre scale is a nanometre, which is past anything
  // that can be printed. Writing a float's full precision would treble the
  // file for resolution nobody can use.
  const round = (v) => {
    const s = Number(v).toFixed(6).replace(/\.?0+$/, "");
    return s === "-0" || s === "" ? "0" : s;
  };

  /**
   * One vertex per POSITION, with the triangles pointed at the survivors.
   *
   * Quantised only to build the lookup key — the stored coordinate is the one
   * that arrived, never a rounded copy of it.
   */
  function weldByPosition(mesh, quantum = 1e-6) {
    const key = (i) => [0, 1, 2]
      .map((k) => Math.round(mesh.positions[i * 3 + k] / quantum))
      .join(",");
    const seen = new Map();
    const positions = [];
    const indices = [];
    const total = M().triangleCount(mesh);
    for (let t = 0; t < total; t++) {
      for (let c = 0; c < 3; c++) {
        const from = mesh.indices ? mesh.indices[t * 3 + c] : t * 3 + c;
        const k = key(from);
        let at = seen.get(k);
        if (at === undefined) {
          at = positions.length / 3;
          seen.set(k, at);
          positions.push(mesh.positions[from * 3], mesh.positions[from * 3 + 1], mesh.positions[from * 3 + 2]);
        }
        indices.push(at);
      }
    }
    return M().fromArrays({ positions, indices, name: mesh.name });
  }

  function modelXml(mesh, name) {
    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<model unit="millimeter" xml:lang="en-US" xmlns="${NS}">`,
      ` <metadata name="Application">HashCortX 3D Forge</metadata>`,
      ` <metadata name="Title">${escapeXml(name)}</metadata>`,
      ` <resources>`,
      `  <object id="1" type="model" name="${escapeXml(name)}">`,
      `   <mesh>`,
      `    <vertices>`,
    ];
    for (let i = 0, n = M().vertexCount(mesh); i < n; i++) {
      lines.push(`     <vertex x="${round(mesh.positions[i * 3])}" y="${round(mesh.positions[i * 3 + 1])}" z="${round(mesh.positions[i * 3 + 2])}"/>`);
    }
    lines.push(`    </vertices>`, `    <triangles>`);
    for (let i = 0, n = M().triangleCount(mesh); i < n; i++) {
      const at = (k) => (mesh.indices ? mesh.indices[i * 3 + k] : i * 3 + k);
      lines.push(`     <triangle v1="${at(0)}" v2="${at(1)}" v3="${at(2)}"/>`);
    }
    lines.push(`    </triangles>`, `   </mesh>`, `  </object>`, ` </resources>`,
      ` <build>`, `  <item objectid="1"/>`, ` </build>`, `</model>`);
    return lines.join("\n") + "\n";
  }

  function write(source, opts = {}) {
    const mesh = weldByPosition(M().fromArrays(source));
    const name = M().safeName(opts.name || mesh.name);
    const encode = (text) => new TextEncoder().encode(text);
    return Z().store([
      {
        name: "[Content_Types].xml",
        bytes: encode(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`),
      },
      {
        name: "_rels/.rels",
        bytes: encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rel0" Target="/${MODEL_PART}" Type="${REL_TYPE}"/>
</Relationships>
`),
      },
      { name: MODEL_PART, bytes: encode(modelXml(mesh, name)) },
    ]);
  }

  /**
   * A 3MF back into a mesh, so what was written can be measured.
   *
   * Read with regular expressions rather than an XML parser on purpose: this
   * reads a file this app wrote, in a check, and it must not depend on the DOM
   * — every other module here runs in a plain script context and so does this.
   * The stated unit is returned alongside, because a file that says inches and
   * a file that says millimetres are different objects and the difference is
   * the entire reason this format is here.
   */
  function read(bytes) {
    const members = Z().unstore(bytes);
    const part = members.get(MODEL_PART);
    if (!part) return { ...M().fromArrays({ positions: [] }), unit: null, members: [...members.keys()] };
    const xml = new TextDecoder().decode(part);
    const positions = [];
    const indices = [];
    const vertex = /<vertex\s+x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"\s*\/>/g;
    let m;
    while ((m = vertex.exec(xml))) positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
    const triangle = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
    while ((m = triangle.exec(xml))) indices.push(Number(m[1]), Number(m[2]), Number(m[3]));
    const unit = /<model[^>]*\sunit="([^"]*)"/.exec(xml);
    const title = /<metadata name="Title">([^<]*)<\/metadata>/.exec(xml);
    return {
      ...M().fromArrays({ positions, indices, name: title ? title[1] : "model" }),
      unit: unit ? unit[1] : null,
      members: [...members.keys()],
    };
  }

  window.HCForge3MF = { write, read, weldByPosition, MODEL_PART };
})();
