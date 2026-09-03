// ==============================================================
// The two facts about this machine that the first frame depends on — checks
//
// Loads the REAL src/js/host-profile.js. Two things are worth holding here,
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
// Run with: npm run check:host-profile
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
  navigator: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' },
  document: {
    createElement: () => madeCanvas,
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
  },
};
vm.createContext(sandbox);
vm.runInContext(src('js', 'host-profile.js'), sandbox, { filename: 'host-profile.js' });
const P = sandbox.window.HCHost;

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
  const tag = '<script src="/js/host-profile.js"></script>';
  ok('the page loads it', html.includes(tag));
  // Before the stylesheets, or the first frame is composed without the class
  // and the whole point is lost.
  const firstSheet = html.indexOf('<link rel="stylesheet"');
  ok('before the first stylesheet', html.indexOf(tag) < firstSheet);
  // A classic script with no async/defer, so parsing stops until it has run.
  ok('synchronously, not deferred',
    !/<script[^>]*host-profile\.js[^>]*(defer|async)/.test(html));
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
      !/if\s*\([^)]*(?:HCHost|software|low-gpu)[^)]*\)\s*$/.test(before.trimEnd()),
      'this line must not be guarded by the renderer probe');
  }
  ok('the probe itself only ever adds the class, never removes it',
    !/classList\.remove\(\s*['"]low-gpu/.test(src('js', 'host-profile.js')));
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

  ok('it reads the renderer judgement', /HCHost\s*&&\s*window\.HCHost\.software/.test(setup));
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

console.log('\nWhich desktop this is:');
{
  const ua = (platform, userAgent, uaData) => P.osFrom({ platform, userAgent, userAgentData: uaData });
  ok('macOS by platform', ua('MacIntel', '') === 'mac');
  ok('macOS by user agent', ua('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)') === 'mac');
  ok('Windows by platform', ua('Win32', '') === 'windows');
  ok('Windows by user agent', ua('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)') === 'windows');
  ok('Linux', ua('Linux x86_64', '') === 'linux');
  // userAgentData is the one that is not deprecated, so it is consulted first.
  ok('the modern field wins when it is there',
    ua('MacIntel', 'Macintosh', { platform: 'Windows' }) === 'windows');
  // Same rule as the renderer: a question you could not ask is not answered.
  ok('nothing recognisable is not guessed at', ua('', '') === '');
  ok('and an absent navigator does not throw', P.osFrom(undefined) === '');
}

console.log('\nThe toolbar reserves space only where something is drawn in it:');
{
  const styles = src('styles.css');
  ok('the strip is still 72px by default',
    /\.hc-toolbar-left\s*\{[^}]*width:\s*72px/.test(styles),
    'that space is needed where the traffic lights ARE drawn');
  ok('and collapses where they are not',
    /html\.is-windows\s+\.hc-toolbar-left[^{]*\{[^}]*width:\s*0/.test(styles));
  // If the class never reaches the page the rule above is decoration.
  ok('the platform class is stamped on the root element',
    /classList\.add\('is-'\s*\+\s*profile\.os\)/.test(src('js', 'host-profile.js')));
  ok('and only when the platform was actually recognised',
    /if\s*\(profile\.os\)\s*document\.documentElement\.classList\.add/.test(src('js', 'host-profile.js')),
    'an empty answer must not produce an `is-` class');
}

console.log('\nThe window is not opened larger than the screen:');
{
  const main = src('main.js');
  const block = main.slice(main.indexOf('The largest the window may be'),
                           main.indexOf('Restore saved position'));

  ok('there is a cap taken from the display work area',
    /screen\?\.availWidth/.test(block) && /screen\?\.availHeight/.test(block),
    'without it the configured size opens off the edge of a 1366x768 panel');
  ok('the window size is held to it', /Math\.min\(wanted\.width/.test(block));

  // THE TRAP. inner_size and set_size are physical pixels; screen.avail* is
  // CSS pixels. On a device pixel ratio of two they differ by a factor of two,
  // so comparing them raw would halve the window on every Retina display —
  // a regression for every existing user, to fix a machine none of them have.
  ok('the screen is converted to the units set_size speaks',
    /devicePixelRatio/.test(block),
    'comparing physical window pixels to CSS screen pixels halves the window on a Retina display');
  ok('and converted UP, so the comparison stays in device pixels',
    /availWidth\s*\|\|\s*0\)\s*\*\s*ratio/.test(block),
    'dividing the window down instead would round away real pixels');

  // A size saved on an external display and reopened on the laptop alone is
  // the case that reaches people who are not on their first launch.
  ok('a restored size is capped too, not only the opening one',
    /savedSize && finite\(savedSize\.width\)/.test(block) && /Math\.min\(wanted\.width/.test(block));

  // No screen to measure is not a reason to guess at one.
  ok('an unmeasurable screen leaves the window alone',
    /return null;/.test(block) && /cap\s*\?/.test(block));
  ok('and a size that already fits is not re-set',
    /if \(differs\)/.test(block),
    'a set_size matching the current size is a needless frame');

  // Regex over source proves the shape, not the arithmetic. So the REAL
  // function is lifted out of main.js and run against real displays — a
  // retyped copy here would only prove that the copy works.
  const fn = /const workAreaCap = \(\) => \{[\s\S]*?\n    \};/.exec(main);
  ok('the cap function can be read out of main.js', !!fn);
  if (fn) {
    const capOn = (availWidth, availHeight, devicePixelRatio) => {
      const box = { window: { screen: { availWidth, availHeight }, devicePixelRatio } };
      vm.createContext(box);
      return vm.runInContext(`(() => { ${fn[0]} return workAreaCap(); })()`, box);
    };
    // The machine the report came from: 1366x768 panel, a taskbar, no scaling.
    const dell = capOn(1366, 728, 1);
    ok('a 1366x768 laptop caps at its own panel', dell.w === 1366 && dell.h === 728,
      JSON.stringify(dell));
    ok('and the configured 1380x860 window is cut down to fit it',
      Math.min(1380, dell.w) === 1366 && Math.min(860, dell.h) === 728);

    // A Retina Mac. The window is already smaller than the cap, so this must
    // change nothing — which is only true if the ratio was applied.
    const mac = capOn(1512, 944, 2);
    ok('a Retina display caps in device pixels, not CSS pixels',
      mac.w === 3024 && mac.h === 1888, JSON.stringify(mac));
    ok('so a window that already fits a Mac is untouched',
      Math.min(2760, mac.w) === 2760 && Math.min(1720, mac.h) === 1720,
      'if the ratio were missing this would clamp to 1512 and halve the window');

    ok('a screen that reports nothing produces no cap', capOn(0, 0, 1) === null);
    ok('and a missing screen does not throw', capOn(undefined, undefined, undefined) === null);
  }
}

console.log(`\n${pass} passed, ${fail} failed  (what this machine is)`);
process.exit(fail ? 1 : 0);
