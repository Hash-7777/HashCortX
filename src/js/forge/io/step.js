// ============================================================
// io/step.js — STEP AP214, as a closed faceted solid
//
// The three formats beside this one describe a surface. A CAD program will
// open a surface, and then tell you it is a mesh: you cannot put a fillet on
// it, you cannot cut it, you cannot dimension it. STEP describes a SOLID —
// a body with faces, edges and vertices that a modelling kernel will accept as
// a part.
//
// WHAT THIS IS AND IS NOT. The body written here is FACETED: every face is a
// flat triangle. A cylinder arrives as a many-sided prism, not as a cylinder,
// because this app's geometry is a mesh and writing an analytic surface it
// never had would be inventing a shape nobody designed. That is a real
// limitation and the interface says so plainly rather than implying a smooth
// body — an honest faceted solid is useful, and a claim of analytic surfaces
// that is not true wastes somebody's afternoon.
//
// WHY THE LONG FORM. The compact way to write triangles into STEP is to give
// each face its own three-point loop and leave the edges out. Several
// converters do it and many programs accept it. But a kernel is entitled to
// read a solid as a topology — faces meeting along shared edges, edges meeting
// at shared vertices — and a file without that is a pile of triangles wearing
// a solid's clothes. So the edges are real and they are SHARED: one edge
// entity between the two faces that meet along it, used forwards by one and
// backwards by the other. It is about ten entities per triangle instead of
// four, and it is the difference between a body and a bag of faces.
//
// NO CLOCK. The timestamp in the header is fixed, so the same model written
// twice produces the same file and two exports can be compared.
//
// Pure: plain arrays in, text out.
//
// Run the checks with: npm run check:forge-io
// ============================================================
(function () {
  "use strict";

  const M = () => window.HCForgeMeshIO;

  // A model far past anything worth handing to a CAD program as facets. Ten
  // entities a triangle means this is already a file of some tens of megabytes,
  // and a kernel reading it will be slower than the person waiting.
  const MAX_TRIANGLES = 40000;

  const num = (v) => {
    // STEP reals must carry a decimal point. `1` is not a real in this format
    // and a file written with bare integers is refused by strict readers.
    const n = Number(v);
    if (!Number.isFinite(n)) return "0.";
    const s = n.toFixed(6).replace(/0+$/, "");
    return s.endsWith(".") ? s : s;
  };

  const text = (s) => `'${String(s).replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;

  /**
   * The model as STEP text, or null when there is nothing to write.
   *
   * Vertices are welded by position first, for the same reason 3MF welds them:
   * a solid's faces meet along shared edges, and two corners at one point that
   * are not the same corner leave the body open along every seam.
   */
  function write(source, opts = {}) {
    const welded = window.HCForge3MF.weldByPosition(M().fromArrays(source));
    const name = M().safeName(opts.name || welded.name);
    const total = M().triangleCount(welded);
    if (!total) return null;
    if (total > MAX_TRIANGLES) return null;

    const lines = [];
    let next = 1;
    const add = (body) => { const id = next++; lines.push(`#${id}=${body};`); return id; };

    // ── The points, and a vertex on each ──────────────────────────────────
    const pointId = [];
    const vertexId = [];
    for (let i = 0, n = M().vertexCount(welded); i < n; i++) {
      const p = add(`CARTESIAN_POINT('',(${num(welded.positions[i * 3])},${num(welded.positions[i * 3 + 1])},${num(welded.positions[i * 3 + 2])}))`);
      pointId.push(p);
      vertexId.push(add(`VERTEX_POINT('',#${p})`));
    }

    const at = (t, c) => (welded.indices ? welded.indices[t * 3 + c] : t * 3 + c);
    const position = (v) => [welded.positions[v * 3], welded.positions[v * 3 + 1], welded.positions[v * 3 + 2]];

    // ── One edge between each pair of vertices that meet ──────────────────
    //
    // Keyed on the pair with the lower vertex first, so the two faces either
    // side of an edge find the same entity. The edge is built in that same
    // order, and the face that traverses it the other way says so with an
    // orientation of .F. rather than making a second edge.
    const edges = new Map();
    const edgeFor = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const known = edges.get(key);
      if (known !== undefined) return known;
      const from = a < b ? a : b;
      const to = a < b ? b : a;
      const p = position(from);
      const q = position(to);
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const length = Math.hypot(d[0], d[1], d[2]) || 1;
      const dir = add(`DIRECTION('',(${num(d[0] / length)},${num(d[1] / length)},${num(d[2] / length)}))`);
      const vec = add(`VECTOR('',#${dir},${num(length)})`);
      const line = add(`LINE('',#${pointId[from]},#${vec})`);
      const edge = add(`EDGE_CURVE('',#${vertexId[from]},#${vertexId[to]},#${line},.T.)`);
      edges.set(key, edge);
      return edge;
    };

    // ── A face per triangle ───────────────────────────────────────────────
    const faces = [];
    let skipped = 0;
    for (let t = 0; t < total; t++) {
      const n = M().normal(welded, t);
      // A triangle with no area has no direction to give its plane, and a
      // plane without one is a file a kernel refuses outright. Dropped and
      // counted, never written with a made-up normal.
      if (!n[0] && !n[1] && !n[2]) { skipped++; continue; }
      const corner = [at(t, 0), at(t, 1), at(t, 2)];
      const oriented = [];
      for (let c = 0; c < 3; c++) {
        const a = corner[c];
        const b = corner[(c + 1) % 3];
        const edge = edgeFor(a, b);
        // The edge was built from the lower vertex to the higher one. This
        // face walks it in that direction, or against it.
        oriented.push(add(`ORIENTED_EDGE('',*,*,#${edge},${a < b ? ".T." : ".F."})`));
      }
      const loop = add(`EDGE_LOOP('',(${oriented.map((id) => `#${id}`).join(",")}))`);
      const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);

      // The plane the triangle lies in: its first corner, its normal, and a
      // reference direction along its first edge so the placement is complete.
      const p = position(corner[0]);
      const q = position(corner[1]);
      const ref = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const refLength = Math.hypot(ref[0], ref[1], ref[2]) || 1;
      const origin = add(`CARTESIAN_POINT('',(${num(p[0])},${num(p[1])},${num(p[2])}))`);
      const axis = add(`DIRECTION('',(${num(n[0])},${num(n[1])},${num(n[2])}))`);
      const refDir = add(`DIRECTION('',(${num(ref[0] / refLength)},${num(ref[1] / refLength)},${num(ref[2] / refLength)}))`);
      const placement = add(`AXIS2_PLACEMENT_3D('',#${origin},#${axis},#${refDir})`);
      const plane = add(`PLANE('',#${placement})`);
      faces.push(add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
    }
    if (!faces.length) return null;

    const shell = add(`CLOSED_SHELL('',(${faces.map((id) => `#${id}`).join(",")}))`);
    const solid = add(`MANIFOLD_SOLID_BREP(${text(name)},#${shell})`);

    // ── Units, and the context the body is measured in ────────────────────
    const millimetre = add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
    const radian = add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
    const steradian = add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
    // How far apart two points may be and still be the same point, in the
    // units above. Written because a reader that is not told picks its own,
    // and a kernel's default tolerance is not always kinder than ours.
    const tolerance = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${millimetre},'distance_accuracy_value','confusion accuracy')`);
    const context = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${tolerance}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${millimetre},#${radian},#${steradian}))REPRESENTATION_CONTEXT('',''))`);

    const worldOrigin = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
    const worldAxis = add(`DIRECTION('',(0.,0.,1.))`);
    const worldRef = add(`DIRECTION('',(1.,0.,0.))`);
    const worldPlacement = add(`AXIS2_PLACEMENT_3D('',#${worldOrigin},#${worldAxis},#${worldRef})`);
    const shape = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${worldPlacement},#${solid}),#${context})`);

    // ── The product this shape belongs to ─────────────────────────────────
    const appContext = add(`APPLICATION_CONTEXT('automotive design')`);
    add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appContext})`);
    const productContext = add(`PRODUCT_CONTEXT('',#${appContext},'mechanical')`);
    const product = add(`PRODUCT(${text(name)},${text(name)},'',(#${productContext}))`);
    const formation = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
    const definitionContext = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appContext},'design')`);
    const definition = add(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`);
    const shapeOf = add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
    add(`SHAPE_DEFINITION_REPRESENTATION(#${shapeOf},#${shape})`);
    // Referenced by nothing else on purpose: it is what tells a reader the
    // product is a part rather than an assembly, and without it some report
    // the file as holding nothing.
    add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#${product}))`);

    const header = [
      `ISO-10303-21;`,
      `HEADER;`,
      `FILE_DESCRIPTION(('faceted brep solid written by HashCortX 3D Forge'),'2;1');`,
      `FILE_NAME(${text(`${name}.step`)},'1980-01-01T00:00:00',(''),(''),'HashCortX 3D Forge','HashCortX','');`,
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
      `ENDSEC;`,
      `DATA;`,
    ];
    return {
      text: `${header.join("\n")}\n${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`,
      triangles: faces.length,
      skipped,
    };
  }

  /**
   * A STEP file back into points and triangles, so what was written can be
   * measured.
   *
   * This reads what THIS writer produces and nothing more — it follows faces
   * to their loops to their edges to their vertices, which is enough to
   * recover the geometry and check it against the model that went in. It is
   * not a general STEP reader and does not pretend to be one; reading other
   * people's CAD files is deliberately out of scope.
   */
  function read(source) {
    const body = typeof source === "string" ? source : String(source && source.text || "");
    const entity = new Map();
    const re = /#(\d+)\s*=\s*([A-Z_0-9]*)\s*\(([\s\S]*?)\);/g;
    let m;
    while ((m = re.exec(body))) entity.set(Number(m[1]), { kind: m[2], args: m[3] });

    const refs = (s) => [...String(s).matchAll(/#(\d+)/g)].map((r) => Number(r[1]));
    const of = (id, kind) => {
      const e = entity.get(id);
      return e && e.kind === kind ? e : null;
    };
    const pointAt = (id) => {
      const e = of(id, "CARTESIAN_POINT");
      if (!e) return null;
      const nums = [...e.args.matchAll(/-?\d+\.\d*(?:E[+-]?\d+)?/gi)].map((r) => Number(r[0]));
      return nums.length >= 3 ? nums.slice(-3) : null;
    };
    const vertexPoint = (id) => {
      const e = of(id, "VERTEX_POINT");
      return e ? pointAt(refs(e.args)[0]) : null;
    };

    const positions = [];
    const indices = [];
    const seen = new Map();
    const indexOf = (p) => {
      const key = p.map((v) => Math.round(v / 1e-9)).join(",");
      let at = seen.get(key);
      if (at === undefined) {
        at = positions.length / 3;
        seen.set(key, at);
        positions.push(p[0], p[1], p[2]);
      }
      return at;
    };

    for (const [, e] of entity) {
      if (e.kind !== "ADVANCED_FACE") continue;
      const [boundId] = refs(e.args);
      const bound = of(boundId, "FACE_OUTER_BOUND");
      if (!bound) continue;
      const loop = of(refs(bound.args)[0], "EDGE_LOOP");
      if (!loop) continue;
      const corner = [];
      for (const orientedId of refs(loop.args)) {
        const oriented = of(orientedId, "ORIENTED_EDGE");
        if (!oriented) { corner.length = 0; break; }
        const forwards = /\.T\.\s*$/.test(oriented.args.trim());
        const edge = of(refs(oriented.args)[0], "EDGE_CURVE");
        if (!edge) { corner.length = 0; break; }
        const ends = refs(edge.args);
        const start = vertexPoint(forwards ? ends[0] : ends[1]);
        if (!start) { corner.length = 0; break; }
        corner.push(start);
      }
      if (corner.length !== 3) continue;
      indices.push(indexOf(corner[0]), indexOf(corner[1]), indexOf(corner[2]));
    }

    const unit = /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(body) ? "millimetre" : null;
    const named = /MANIFOLD_SOLID_BREP\('([^']*)'/.exec(body);
    return {
      ...M().fromArrays({ positions, indices, name: named ? named[1] : "model" }),
      unit,
      faceted: true,
    };
  }

  window.HCForgeSTEP = { write, read, MAX_TRIANGLES };
})();
