// ==============================================================
// Forge file writers — checks
//
// Loads the REAL modules under src/js/forge/io/ into a Node VM, writes files
// with them, and reads the bytes back. Everything asserted here is measured
// from what was produced, never from the arithmetic that produced it.
//
// The point of these checks is one question a person cannot ask of a file
// without opening it somewhere else: does this open as the object that was on
// screen? So each format is written, re-read, and compared on the three things
// that go wrong — how many triangles came back, how big the object is, and
// which way its surface faces. A model written inside out has the right
// triangle count and the right bounding box and prints as a shell of air.
//
// Run with: npm run check:forge-io
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, TextDecoder, TextEncoder, console };
vm.createContext(sandbox);
for (const rel of [
  ['src', 'js', 'forge', 'io', 'mesh.js'],
  ['src', 'js', 'forge', 'io', 'scene.js'],
  ['src', 'js', 'forge', 'io', 'stl.js'],
  ['src', 'js', 'forge', 'io', 'obj.js'],
  ['src', 'js', 'io', 'zip.js'],
  ['src', 'js', 'forge', 'io', 'threemf.js'],
  ['src', 'js', 'forge', 'io', 'step.js'],
  ['src', 'js', 'forge', 'units.js'],
  ['src', 'js', 'forge', 'io', 'import.js'],
]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel.at(-1) });
}
const M = sandbox.window.HCForgeMeshIO;
const S = sandbox.window.HCForgeSceneIO;
const STL = sandbox.window.HCForgeSTL;
const OBJ = sandbox.window.HCForgeOBJ;
const TMF = sandbox.window.HCForge3MF;
const STEP = sandbox.window.HCForgeSTEP;
const IMPORT = sandbox.window.HCForgeImportIO;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

// ── The fixture: a box of stated millimetres, wound outwards ─────────────
//
// Written out here rather than generated, so the expected size and volume are
// arithmetic a person can do in their head and not a second copy of the code
// being checked.
function boxMm(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const corners = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  const faces = [
    [4, 5, 6], [4, 6, 7],   // +z
    [1, 0, 3], [1, 3, 2],   // -z
    [5, 1, 2], [5, 2, 6],   // +x
    [0, 4, 7], [0, 7, 3],   // -x
    [7, 6, 2], [7, 2, 3],   // +y
    [0, 1, 5], [0, 5, 4],   // -y
  ];
  return M.fromArrays({
    positions: corners.flat(),
    indices: faces.flat(),
    name: 'test box',
  });
}

const box = boxMm(40, 20, 10);

console.log('\nThe shared vocabulary measures the triangles it was given:');
{
  ok('a box of stated millimetres measures those millimetres',
    M.size(box).every((v, i) => near(v, [40, 20, 10][i])));
  ok('twelve triangles make a box', M.triangleCount(box) === 12);
  ok('eight corners, because the index is used', M.vertexCount(box) === 8);
  // 40 x 20 x 10 = 8,000 cubic millimetres, and positive means wound outwards.
  ok('and it encloses the volume it looks like', near(M.volume(box), 8000, 1e-6));
  ok('a mesh with no index is read as loose triangles',
    M.triangleCount(M.fromArrays({ positions: new Array(9).fill(0) })) === 1);
  ok('an index naming a vertex that is not there is refused whole',
    M.fromArrays({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 9] }).indices === null);
  ok('scaling multiplies every coordinate', near(M.size(M.scaled(box, 2))[0], 80));
  ok('a name that would end an XML attribute is cleaned',
    !/["'<>&]/.test(M.safeName('a "quoted" <name> & more')));
}

// ── Placing and joining, and the mirrored part that comes out inside out ──
console.log('\nParts are placed and joined into one object:');
{
  // Column-major, the order the scene library keeps them: translation at 12.
  const shifted = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
  const one = S.merge([{ ...box, matrix: shifted(-30) }], 'pair');
  ok('a placement moves the part', near(M.bounds(one)[0][0], -50));
  ok('and does not change its size', M.size(one).every((v, i) => near(v, [40, 20, 10][i])));
  ok('or its volume', near(M.volume(one), 8000, 1e-6));

  const both = S.merge([{ ...box, matrix: shifted(-30) }, { ...box, matrix: shifted(30) }], 'pair');
  ok('two parts join into one list', M.triangleCount(both) === 24);
  ok('and the pair measures across both', near(M.size(both)[0], 100));
  ok('and holds both volumes', near(M.volume(both), 16000, 1e-6));
}

console.log('\nA mirrored part is not written inside out:');
{
  // Mirroring is a negated scale, and a negated scale reverses every triangle
  // this part has. Nothing about the count or the box would show it — only the
  // volume, which is why it is measured here.
  const mirrored = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  ok('a negated scale is recognised as a flip', S.reversesWinding(mirrored));
  ok('an ordinary placement is not', !S.reversesWinding([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1]));
  // Two negated axes cancel: that is a rotation, not a reflection.
  ok('two negated axes are a turn, not a flip',
    !S.reversesWinding([-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  ok('a part flattened to nothing is not called a flip',
    !S.reversesWinding([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));

  const one = S.merge([{ ...box, matrix: mirrored }], 'mirrored');
  ok('the mirrored copy still encloses its volume the right way round',
    near(M.volume(one), 8000, 1e-6), `${M.volume(one)}`);

  const pair = S.merge([{ ...box }, { ...box, matrix: mirrored }], 'pair');
  ok('a pair holds both volumes rather than cancelling out',
    near(M.volume(pair), 16000, 1e-6), `${M.volume(pair)}`);

  // What it would have been without the correction — the exact defect.
  const uncorrected = M.fromArrays({
    positions: S.merge([{ ...box, matrix: mirrored }], 'x').positions,
    indices: (() => {
      const src = M.fromArrays(box);
      return src.indices.slice();
    })(),
  });
  ok('and leaving the winding alone would have shown as a negative volume',
    M.volume(uncorrected) < 0);

  // It survives the writer too, which is what a person actually gets.
  const back = STL.read(STL.write(pair));
  ok('the written file carries both the right way out', near(M.volume(back), 16000, 1));
}

console.log('\nAn STL is written, and reading it back gives the same object:');
{
  const bytes = STL.write(box);
  ok('the file is exactly the length the format says',
    bytes.length === 84 + 12 * 50, `${bytes.length} bytes`);
  // A binary file whose header begins with "solid" is what breaks readers that
  // decide the format by the leading word. Ours must never do that.
  ok('the header does not pretend to be a text file',
    !new TextDecoder().decode(bytes.slice(0, 5)).startsWith('solid'));
  ok('the header says what the part measures',
    /40 x 20 x 10 mm/.test(new TextDecoder().decode(bytes.slice(0, 80))));

  const back = STL.read(bytes);
  ok('it reads back as binary', back.format === 'binary');
  ok('with the same triangles', M.triangleCount(back) === 12);
  // STL has no shared vertices, so this is what the file really holds — and
  // saying otherwise would be reporting a number the file does not contain.
  ok('as loose corners, which is what the format holds', back.indices === null && M.vertexCount(back) === 36);
  ok('the object is the same size', M.size(back).every((v, i) => near(v, [40, 20, 10][i])));
  ok('and the same way out', near(M.volume(back), 8000, 1e-3) && M.volume(back) > 0);
}

console.log('\nA mesh handed over as loose triangles writes the same file:');
{
  // The two ways a mesh can arrive must not produce different objects.
  const loose = { positions: [], name: 'test box' };
  for (let i = 0; i < M.triangleCount(box); i++) for (const p of M.triangle(box, i)) loose.positions.push(...p);
  const fromLoose = STL.read(STL.write(loose));
  const fromIndexed = STL.read(STL.write(box));
  ok('the same triangle count', M.triangleCount(fromLoose) === M.triangleCount(fromIndexed));
  ok('the same size', M.size(fromLoose).every((v, i) => near(v, M.size(fromIndexed)[i])));
  ok('the same volume', near(M.volume(fromLoose), M.volume(fromIndexed), 1e-6));
}

console.log('\nThe format is decided by arithmetic, not by the leading word:');
{
  // A binary file written by something that fills the header with "solid".
  const bytes = STL.write(box);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('solid a file that is not text at all       '.slice(0, 80)), 0);
  ok('it is still recognised as binary', STL.isBinary(bytes));
  const back = STL.read(bytes);
  ok('and still reads as the same object',
    M.triangleCount(back) === 12 && near(M.volume(back), 8000, 1e-3));

  // A genuine text STL, which is shorter than any binary file of its triangles.
  const ascii = [
    'solid test box',
    ' facet normal 0 0 1',
    '  outer loop',
    '   vertex 0 0 0',
    '   vertex 10 0 0',
    '   vertex 0 10 0',
    '  endloop',
    ' endfacet',
    'endsolid test box',
  ].join('\n');
  const text = STL.read(encoder.encode(ascii));
  ok('a text file is read as text', text.format === 'ascii');
  ok('with its triangle', M.triangleCount(text) === 1);
  ok('and its name', text.name === 'test box');
  ok('a text file cut off mid-triangle drops the part-triangle rather than keeping a stray corner',
    M.triangleCount(STL.read(encoder.encode(ascii.replace('   vertex 0 10 0\n', '')))) === 0);
}

console.log('\nAn OBJ is written, and reading it back gives the same object:');
{
  const text = OBJ.write(box);
  const back = OBJ.read(text);
  ok('the same triangles', M.triangleCount(back) === 12);
  // The reason OBJ is worth having beside STL: a corner is written once.
  ok('and the shared corners survive, unlike in STL',
    M.vertexCount(back) === 8, `${M.vertexCount(back)} vertices`);
  ok('the object is the same size', M.size(back).every((v, i) => near(v, [40, 20, 10][i], 1e-6)));
  ok('and the same way out', near(M.volume(back), 8000, 1e-6));
  ok('the size is written where a person can read it', /# size: 40 x 20 x 10 mm/.test(text));
  ok('and the units are stated, since the format has no field for them',
    /# units: millimetres/.test(text));
  ok('the object is named', /^o test box$/m.test(text));
  // Writing these from zero gives a file that opens with every triangle
  // shifted by one corner — recognisable, and wrong everywhere.
  ok('face indices are one-based', /^f 5 6 7$/m.test(text), 'the first face of the fixture');
  ok('no coordinate is written as minus zero', !/ -0(\s|$)/m.test(text));
}

console.log('\nThe reader handles what other writers really produce:');
{
  // Corners named as vertex/texture/normal, which most modelling programs write.
  const withSlashes = [
    'v 0 0 0', 'v 10 0 0', 'v 0 10 0',
    'f 1/1/1 2/2/2 3/3/3',
  ].join('\n');
  ok('a face naming texture and normal is read by its vertex',
    M.triangleCount(OBJ.read(withSlashes)) === 1);

  // Counted back from the end. Rare now, still out there, and silently wrong
  // if a reader treats it as a forward index.
  const negative = ['v 0 0 0', 'v 10 0 0', 'v 0 10 0', 'f -3 -2 -1'].join('\n');
  const backwards = OBJ.read(negative);
  ok('a negative index counts back from the end',
    M.triangleCount(backwards) === 1 && backwards.indices.join() === '0,1,2');

  // A square, which every reader fans from its first corner.
  const quad = ['v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'f 1 2 3 4'].join('\n');
  ok('a four-cornered face becomes two triangles', M.triangleCount(OBJ.read(quad)) === 2);

  ok('a face naming a vertex that is not there is dropped, not guessed',
    M.triangleCount(OBJ.read(['v 0 0 0', 'f 1 2 3'].join('\n'))) === 0);
  ok('a line that is not geometry is ignored',
    M.triangleCount(OBJ.read(['# a comment', 'mtllib none.mtl', 'usemtl none', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'))) === 1);
  ok('an empty file reads as an empty model', M.triangleCount(OBJ.read('')) === 0);
}

console.log('\nA 3MF says what its numbers mean, which the other formats cannot:');
{
  const bytes = TMF.write(box);
  const back = TMF.read(bytes);
  ok('the three members a 3MF needs are there',
    back.members.includes('[Content_Types].xml')
    && back.members.includes('_rels/.rels')
    && back.members.includes('3D/3dmodel.model'));
  // The entire reason this format is worth a zip container underneath it.
  ok('the unit is stated in the file', back.unit === 'millimeter');
  ok('and the model is named', back.name === 'test box');
  ok('the same triangles', M.triangleCount(back) === 12);
  ok('the same size', M.size(back).every((v, i) => near(v, [40, 20, 10][i], 1e-6)));
  ok('and the same way out', near(M.volume(back), 8000, 1e-6));
}

console.log('\nA 3MF is welded, because it describes a solid and not a picture:');
{
  // The scene hands over a corner per face so hard edges can be shaded. That
  // is a screen concern; in a file about material it is a seam, and a reader
  // checking for a closed surface calls the mesh open.
  const loose = { positions: [], name: 'loose' };
  for (let i = 0; i < M.triangleCount(box); i++) for (const p of M.triangle(box, i)) loose.positions.push(...p);
  ok('the fixture really does arrive with a corner per face',
    M.vertexCount(M.fromArrays(loose)) === 36);

  const welded = TMF.weldByPosition(M.fromArrays(loose));
  ok('and comes out with one corner per point', M.vertexCount(welded) === 8);
  ok('with the triangles unchanged', M.triangleCount(welded) === 12);
  ok('the same size', M.size(welded).every((v, i) => near(v, [40, 20, 10][i], 1e-9)));
  ok('and the same volume, so nothing was pulled together that should not be',
    near(M.volume(welded), 8000, 1e-9));

  const back = TMF.read(TMF.write(loose));
  ok('a loose mesh written as 3MF arrives welded', M.vertexCount(back) === 8);
  ok('still the same object', near(M.volume(back), 8000, 1e-6));
}

console.log('\nA STEP file is a solid, not a bag of faces:');
{
  const out = STEP.write(box);
  const body = out.text;

  ok('every triangle became a face', out.triangles === 12 && out.skipped === 0);
  ok('the file opens and closes the way the standard says',
    /^ISO-10303-21;/.test(body) && /END-ISO-10303-21;\n$/.test(body));
  ok('it has a header and a data section',
    /\nHEADER;\n/.test(body) && /\nDATA;\n/.test(body) && (body.match(/\nENDSEC;\n/g) || []).length === 2);
  ok('the unit is declared as the millimetre', /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(body));
  ok('it says which schema it is written to', /AUTOMOTIVE_DESIGN/.test(body));
  ok('and there is a product, so a reader reports a part rather than nothing',
    /PRODUCT_RELATED_PRODUCT_CATEGORY\('part'/.test(body) && /SHAPE_DEFINITION_REPRESENTATION/.test(body));
  ok('nothing depends on a clock, so the same model writes the same file',
    STEP.write(box).text === body);

  // ── Reference integrity ────────────────────────────────────────────────
  //
  // The commonest way a written STEP file is broken: an entity points at a
  // number nothing defines. No reader recovers from it, and nothing about the
  // text looks wrong.
  const defined = new Set();
  let duplicates = 0;
  for (const m of body.matchAll(/^#(\d+)=/gm)) {
    const id = Number(m[1]);
    if (defined.has(id)) duplicates++;
    defined.add(id);
  }
  const dangling = [];
  for (const m of body.matchAll(/#(\d+)/g)) {
    const id = Number(m[1]);
    if (!defined.has(id)) dangling.push(id);
  }
  ok('every entity is defined exactly once', duplicates === 0);
  ok('and every reference points at one that exists', dangling.length === 0, `${dangling.length} dangling`);
  // Coordinates, directions and lengths are REALs in the schema and must carry
  // a decimal point; `1` is not a real in this format and a strict reader
  // refuses it. The counts and the schema year elsewhere in the file are
  // genuinely integers, so this looks only where a real is required.
  {
    const wrong = [];
    for (const m of body.matchAll(/^#\d+=(CARTESIAN_POINT|DIRECTION|VECTOR)\(([\s\S]*?)\);$/gm)) {
      for (const n of m[2].matchAll(/(?<![#\w.])-?\d+(?![.\d])/g)) wrong.push(`${m[1]}: ${n[0]}`);
    }
    ok('every coordinate, direction and length carries a decimal point',
      wrong.length === 0, wrong.slice(0, 3).join(', '));
  }

  // ── The property that makes it a body ─────────────────────────────────
  //
  // A closed solid's faces meet along shared edges: each edge belongs to
  // exactly two faces, traversed one way by one and the other way by the
  // other. Give every face its own edges and the file still reads, still
  // draws, and is a pile of triangles a kernel will not thicken, fillet or
  // cut. Nothing but this counts it.
  const uses = new Map();
  const directions = new Map();
  for (const m of body.matchAll(/^#\d+=ORIENTED_EDGE\('',\*,\*,#(\d+),\.([TF])\.\);$/gm)) {
    const edge = Number(m[1]);
    uses.set(edge, (uses.get(edge) || 0) + 1);
    directions.set(edge, (directions.get(edge) || []).concat(m[2]));
  }
  const edgeCount = (body.match(/^#\d+=EDGE_CURVE\(/gm) || []).length;
  // A closed triangle mesh has three edges for every two faces.
  ok('the edges are shared, not one per face', edgeCount === 18, `${edgeCount} edges for 12 faces`);
  ok('every edge is used by exactly two faces',
    uses.size === edgeCount && [...uses.values()].every((n) => n === 2));
  ok('and traversed once each way, which is what closes the surface',
    [...directions.values()].every((d) => d.length === 2 && d[0] !== d[1]));

  // ── The geometry, read back out ────────────────────────────────────────
  const back = STEP.read(body);
  ok('reading it back gives the same triangles', M.triangleCount(back) === 12);
  ok('with corners shared, as a solid has', M.vertexCount(back) === 8);
  ok('the same size', M.size(back).every((v, i) => near(v, [40, 20, 10][i], 1e-6)));
  ok('and the same way out', near(M.volume(back), 8000, 1e-6));
  ok('the unit survives the trip', back.unit === 'millimetre');
  ok('and so does the name', back.name === 'test box');
  ok('and it says plainly that the body is faceted', back.faceted === true);
}

console.log('\nWhat STEP refuses, it refuses rather than writing a broken file:');
{
  ok('nothing to write is nothing written', STEP.write({ positions: [] }) === null);

  // A triangle with no area has no direction for its plane, and a plane
  // without one is a file a kernel rejects outright.
  const withFlat = M.fromArrays({
    positions: box.positions.concat([0, 0, 0, 1, 0, 0, 2, 0, 0]),
    indices: box.indices.concat([8, 9, 10]),
  });
  const out = STEP.write(withFlat);
  ok('a triangle with no area is dropped', out.triangles === 12);
  ok('and counted rather than passed over in silence', out.skipped === 1);

  const huge = { positions: new Array((STEP.MAX_TRIANGLES + 1) * 9).fill(0) };
  ok('a model past the ceiling is refused instead of writing tens of megabytes',
    STEP.write(huge) === null);
}

console.log('\nThe two text and binary formats agree with each other:');
{
  // Written from the same mesh, they must describe the same object. A
  // disagreement here is one of the two writers being wrong.
  const fromObj = OBJ.read(OBJ.write(box));
  const fromStl = STL.read(STL.write(box));
  const from3mf = TMF.read(TMF.write(box));
  const fromStep = STEP.read(STEP.write(box).text);
  const all = [fromObj, fromStl, from3mf, fromStep];
  ok('the same triangle count', all.every((m) => M.triangleCount(m) === 12));
  ok('the same size', all.every((m) => M.size(m).every((v, i) => near(v, [40, 20, 10][i], 1e-3))));
  ok('the same volume', all.every((m) => near(M.volume(m), 8000, 1e-2)));
  ok('and all four the same way out', all.every((m) => M.volume(m) > 0));
}

console.log('\nA reader handed nothing answers with nothing, never an exception:');
{
  // A caller with one file that comes back empty and another that throws has
  // two paths to write for one situation.
  ok('STL reads nothing as no triangles', M.triangleCount(STL.read(null)) === 0);
  ok('and undefined the same way', M.triangleCount(STL.read(undefined)) === 0);
  ok('OBJ too', M.triangleCount(OBJ.read(null)) === 0);
  ok('3MF too', M.triangleCount(TMF.read(null)) === 0);
  ok('and STEP too', M.triangleCount(STEP.read(null)) === 0);
}

console.log('\nAn empty model writes a valid empty file rather than nothing:');
{
  const bytes = STL.write({ positions: [] });
  ok('the file is a header and a count of zero', bytes.length === 84);
  ok('and reads back as no triangles', M.triangleCount(STL.read(bytes)) === 0);
  const text = OBJ.write({ positions: [] });
  ok('the text file is a header and a name', /^o model$/m.test(text) && !/^f /m.test(text));
  ok('and reads back as no triangles too', M.triangleCount(OBJ.read(text)) === 0);
}

// ── Out and back again ───────────────────────────────────────────────────
console.log('\nA file this app wrote can be opened by it again:');
{
  ok('a name says which format it is',
    IMPORT.formatOf('part.stl') === 'stl' && IMPORT.formatOf('part.OBJ') === 'obj'
    && IMPORT.formatOf('part.3mf') === '3mf'
    && IMPORT.formatOf('part.step') === 'step' && IMPORT.formatOf('part.stp') === 'step');
  ok('and anything else is left to the scene loader',
    IMPORT.formatOf('part.glb') === null && IMPORT.formatOf('part') === null);

  // The round trip that makes the whole export story real: a part written out
  // and opened again has to be the same object, at the same size.
  const written = {
    stl: STL.write(box),
    obj: new TextEncoder().encode(OBJ.write(box)),
    '3mf': TMF.write(box),
    step: new TextEncoder().encode(STEP.write(box).text),
  };
  for (const [kind, bytes] of Object.entries(written)) {
    const mesh = IMPORT.readAs(kind, bytes);
    ok(`${kind} comes back as the same object`,
      M.triangleCount(mesh) === 12 && near(M.volume(mesh), 8000, 1e-2),
      `${M.triangleCount(mesh)} triangles, volume ${M.volume(mesh)}`);

    const built = IMPORT.nodeFrom(mesh, `${kind} part`, { workingSpan: 2 });
    ok(`and becomes a part that remembers it is 40 mm across`, near(built.sizeMm, 40, 1e-3));
    // The scene runs at one span whatever the object is, so the geometry has
    // to arrive at that span rather than at its size in millimetres.
    const span = M.size(M.fromArrays(built.node.params));
    ok(`with its geometry brought to the working span`, near(Math.max(...span), 2, 1e-6), `${span}`);
    ok(`in proportion, not squashed to fit`,
      near(span[1] / span[0], 20 / 40, 1e-6) && near(span[2] / span[0], 10 / 40, 1e-6));
    // A file may hold an object anywhere; a part arriving far from the origin
    // reads as the import having failed.
    const box2 = M.bounds(M.fromArrays(built.node.params));
    ok(`and centred where the scene expects it`,
      [0, 1, 2].every((k) => near(box2[0][k] + box2[1][k], 0, 1e-9)));
    ok(`and it is a mesh part the fuse can measure`, built.node.type === 'mesh');
  }

  // An object written far from the origin still arrives centred.
  const moved = M.fromArrays({
    positions: box.positions.map((v, i) => (i % 3 === 0 ? v + 500 : v)),
    indices: box.indices,
  });
  const back = IMPORT.nodeFrom(STL.read(STL.write(moved)), 'moved', { workingSpan: 2 });
  const movedBox = M.bounds(M.fromArrays(back.node.params));
  ok('an object written far from the origin arrives centred',
    [0, 1, 2].every((k) => Math.abs(movedBox[0][k] + movedBox[1][k]) < 1e-4));
  ok('and still measures what it did', near(back.sizeMm, 40, 1e-2));

  ok('a file with nothing in it makes no part rather than an empty one',
    IMPORT.nodeFrom(STL.read(STL.write({ positions: [] })), 'empty', {}) === null);
  ok('and a name that would break a file is cleaned on the way in',
    !/[<>"']/.test(IMPORT.nodeFrom(STL.read(STL.write(box)), '<script>x</script>', {}).node.name));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/io/)\n`);
process.exit(fail === 0 ? 0 : 1);
