// ==============================================================
// Whether this machine draws with a GPU — checks
//
// Loads the REAL src/js/render-profile.js. Two things are worth holding here,
// and the second matters more than the first.
//
// One: the names a software rasterizer goes by are recognised, and an
// unreadable name is NOT treated as one. Answering "unknown" with "assume the
// worst" would quietly take the launch intro's motion away from machines that
// can afford it, and nothing would ever report that it had happened.
//
// Two: this probe may only decide WHEN the cheap mode starts. main.js switches
// it on for everybody at the end of the intro and must keep doing so. If that
// line ever becomes conditional on this probe, every machine with a working
// GPU gets the expensive mode for the whole session — a regression for every
// existing user, made in the name of a machine that has the opposite problem.
// That is the failure this file exists to prevent, so it is pinned in the
// markup and in main.js rather than left to be remembered.
//
// Run with: npm run check:render-profile
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');

// A document just real enough for the module to probe and give up on.
const madeCanvas = { getContext: () => null };
const sandbox = {
  window: {},
  document: {
    createElement: () => madeCanvas,
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
  },
};
vm.createContext(sandbox);
vm.runInContext(src('js', 'render-profile.js'), sandbox, { filename: 'render-profile.js' });
const P = sandbox.window.HCRenderProfile;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nThe module answers:');
{
  ok('published on window', !!P);
  ok('it says whether it managed to look', P.probed === true);
  ok('it exposes the judgement separately from the class', typeof P.software === 'boolean');
}

console.log('\nA software rasterizer is recognised by any of its names:');
{
  // The Windows machine this came from reports the first of these. The rest
  // are the other rasterizers a person can end up on.
  for (const name of [
    'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0)',
    'Google SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'softpipe',
    'Software Rasterizer',
    'Apple Software Renderer',
  ]) {
    ok(name.slice(0, 52), P.isSoftware(name, true) === true);
  }
}

console.log('\nA real GPU is left alone:');
{
  for (const name of [
    'Apple M3 Max',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'AMD Radeon Pro 5500M OpenGL Engine',
  ]) {
    ok(name.slice(0, 52), P.isSoftware(name, true) === false);
  }
}

console.log('\nNot knowing is not the same as knowing it is bad:');
{
  // WEBGL_debug_renderer_info can be withheld. The app then behaves exactly as
  // it did before this probe existed, which is the correct thing to do with a
  // question you could not ask.
  ok('an unreadable name is not called software', P.isSoftware('', true) === false);
  ok('neither is a missing one', P.isSoftware(undefined, true) === false);
  ok('nor an unrelated one', P.isSoftware('Some Renderer 9000', true) === false);
  // No context at all is not a guess. A machine that cannot hand out a WebGL
  // context is not compositing in hardware either.
  ok('no WebGL context at all IS called software', P.isSoftware('', false) === true);
  ok('and that holds whatever the name says', P.isSoftware('Apple M3 Max', false) === true);
}

console.log('\nIt runs before the first frame:');
{
  const html = src('index.html');
  const tag = '<script src="/js/render-profile.js"></script>';
  ok('the page loads it', html.includes(tag));
  // Before the stylesheets, or the first frame is composed without the class
  // and the whole point is lost.
  const firstSheet = html.indexOf('<link rel="stylesheet"');
  ok('before the first stylesheet', html.indexOf(tag) < firstSheet);
  // A classic script with no async/defer, so parsing stops until it has run.
  ok('synchronously, not deferred',
    !/<script[^>]*render-profile\.js[^>]*(defer|async)/.test(html));
}

console.log('\nIt decides WHEN the cheap mode starts, never whether:');
{
  const main = src('main.js');
  // The exact line, unguarded. Wrapping it in anything that consults the probe
  // would give every machine with a GPU the expensive mode for the session.
  const line = /\n\s*document\.body\.classList\.add\('low-gpu'\);/.exec(main);
  ok('main.js still switches the cheap mode on for everyone', !!line,
    'if this moved, check it did not become conditional on the probe');
  if (line) {
    const before = main.slice(Math.max(0, line.index - 400), line.index);
    ok('and does it unconditionally',
      !/if\s*\([^)]*(?:HCRenderProfile|software|low-gpu)[^)]*\)\s*$/.test(before.trimEnd()),
      'this line must not be guarded by the renderer probe');
  }
  ok('the probe itself only ever adds the class, never removes it',
    !/classList\.remove\(\s*['"]low-gpu/.test(src('js', 'render-profile.js')));
  // Both forms exist for every rule, which is what lets the class land on
  // <html> this early and still mean the same thing.
  const styles = src('styles.css');
  const onHtml = (styles.match(/html\.low-gpu/g) || []).length;
  const onBody = (styles.match(/body\.low-gpu/g) || []).length;
  ok('every cheap-mode rule is written for <html> as well as <body>',
    onHtml > 0 && onHtml === onBody, `${onHtml} html, ${onBody} body`);
}

console.log('\nThe 3D viewport asks the flag, not the class:');
{
  const forge = readFileSync(join(root, 'src', 'modes', 'forge', 'mode.js'), 'utf8');
  const setup = forge.slice(forge.indexOf('new THREE.WebGLRenderer') - 1200,
                            forge.indexOf('mount.appendChild(renderer.domElement)'));

  ok('it reads the renderer judgement', /HCRenderProfile\s*&&\s*window\.HCRenderProfile\.software/.test(setup));
  // The trap this replaces. `low-gpu` is on for everyone after the intro, so a
  // viewport keyed to it would drop the shadows on every machine, including
  // the ones that were drawing them for free.
  ok('and NOT the low-gpu class',
    !/classList\.contains\(\s*['"]low-gpu/.test(setup),
    'that class is on for everyone after launch — it cannot answer whether a machine can draw');

  // What is allowed to degrade is how the part is lit. What it IS may not.
  ok('multisampling follows the judgement', /antialias:\s*!soft/.test(setup));
  ok('shadows follow the judgement', /shadowMap\.enabled\s*=\s*!soft/.test(setup));
  ok('the pixel ratio follows it', /setPixelRatio\(\s*soft\s*\?/.test(setup));
  ok('tone mapping follows it', /if\s*\(!soft\)/.test(setup));

  // The claim in the comment above it: only lighting changes. The exporters
  // read geometry and never touch the renderer, so this stays true.
  const io = ['mesh', 'stl', 'obj', 'scene', 'threemf', 'step']
    .map((f) => readFileSync(join(root, 'src', 'js', 'forge', 'io', f + '.js'), 'utf8'));
  ok('no exporter reads the renderer, so a part is the same part either way',
    io.every((f) => !/\brenderer\b/.test(f)));
}

console.log(`\n${pass} passed, ${fail} failed  (is there a GPU here)`);
process.exit(fail ? 1 : 0);
