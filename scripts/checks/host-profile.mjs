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

console.log('\nThe window opens where a person can reach it, and where it was left:');
{
  const main = src('main.js');

  // Regex over source proves the shape, not the arithmetic. So the REAL
  // function is lifted out of main.js and run against real displays — a
  // retyped copy here would only prove that the copy works.
  const fn = /const planWindow = \(\{[^)]*\}\) => \{[\s\S]*?\n    \};/.exec(main);
  ok('the placement function can be read out of main.js', !!fn);

  if (fn) {
    const box = {};
    vm.createContext(box);
    const plan = vm.runInContext(`(() => { ${fn[0]} return planWindow; })()`, box);

    // A small laptop: a 1366x768 panel with a taskbar and no scaling. Windows
    // draws a title bar and a frame around the content, so the window is 16 px
    // wider and 39 px taller than the page inside it.
    const LAPTOP = { areas: [{ x: 0, y: 0, w: 1366, h: 728 }], here: { x: 0, y: 0, w: 1366, h: 728 }, pad: { w: 16, h: 39 }, scale: 1 };
    const outerOf = (r, pad) => ({ x: r.x, y: r.y, w: r.width + pad.w, h: r.height + pad.h });
    const inside = (o, a) => o.x >= a.x && o.y >= a.y && o.x + o.w <= a.x + a.w && o.y + o.h <= a.y + a.h;
    const run = (d, saved, now) => plan({ ...d, saved, now: now || { width: 1380, height: 860 } });

    // The cap is taken on the whole window, frame included: the frame sits
    // outside the page, so a cap on the page alone leaves the window taller
    // than the space there is.
    const first = run(LAPTOP, null);
    const firstOuter = outerOf(first, LAPTOP.pad);
    ok('a first launch on a 1366x768 laptop fits the whole window, frame and all',
      inside(firstOuter, LAPTOP.areas[0]), JSON.stringify(firstOuter));
    ok('and does not fill the screen edge to edge',
      firstOuter.w < 1366 && firstOuter.h < 728, 'it should read as a window, not a maximized one');
    ok('and is centered on it',
      Math.abs(firstOuter.x - (1366 - firstOuter.w) / 2) <= 1 && Math.abs(firstOuter.y - (728 - firstOuter.h) / 2) <= 1);
    ok('and is not asked to start maximized', first.maximized === false);
    ok('and stays above the size the app is designed for',
      first.width >= 960 && first.height >= 640, `${first.width}x${first.height}`);

    // A screen with room to spare gets the configured size, not a smaller one.
    const BIG = { areas: [{ x: 0, y: 0, w: 1920, h: 1040 }], here: { x: 0, y: 0, w: 1920, h: 1040 }, pad: { w: 16, h: 39 }, scale: 1 };
    const big = run(BIG, null);
    ok('a screen with room for it keeps the configured 1380x860', big.width === 1380 && big.height === 860, `${big.width}x${big.height}`);

    // A Retina Mac. The monitor reports its work area in physical pixels, as
    // the window commands do, so nothing is converted and nothing is halved.
    const MAC = { areas: [{ x: 0, y: 50, w: 3024, h: 1838 }], here: { x: 0, y: 50, w: 3024, h: 1838 }, pad: { w: 0, h: 56 }, scale: 2 };
    const mac = run(MAC, null, { width: 2760, height: 1720 });
    ok('a window that already fits a Retina display is untouched', mac.width === 2760 && mac.height === 1720, `${mac.width}x${mac.height}`);

    // What was left is what comes back, when it can be reached.
    const kept = run(LAPTOP, { x: 120, y: 20, width: 984, height: 661, maximized: false });
    ok('a saved position and size that fit are used exactly',
      kept.x === 120 && kept.y === 20 && kept.width === 984 && kept.height === 661, JSON.stringify(kept));
    const remembered = run(LAPTOP, { x: 120, y: 20, width: 984, height: 661, maximized: true });
    ok('maximized is remembered, with the ordinary bounds kept for un-maximizing',
      remembered.maximized === true && remembered.x === 120 && remembered.width === 984);

    // And when it cannot be reached it is brought back, not trusted.
    const MONITORS = {
      areas: [{ x: 0, y: 0, w: 1366, h: 728 }, { x: 1366, y: 0, w: 1920, h: 1040 }],
      here: { x: 0, y: 0, w: 1366, h: 728 }, pad: { w: 16, h: 39 }, scale: 1,
    };
    const away = run(LAPTOP, { x: 4000, y: 300, width: 1000, height: 600, maximized: false });
    ok('a position on a monitor that is gone is brought onto the screen',
      inside(outerOf(away, LAPTOP.pad), LAPTOP.areas[0]), JSON.stringify(away));
    const left = run(LAPTOP, { x: -1800, y: 100, width: 1000, height: 600, maximized: false });
    ok('and so is one far to the left', inside(outerOf(left, LAPTOP.pad), LAPTOP.areas[0]));
    const parked = run(LAPTOP, { x: -32000, y: -32000, width: 1000, height: 600, maximized: false });
    ok('the place Windows parks a minimized window is never used', inside(outerOf(parked, LAPTOP.pad), LAPTOP.areas[0]));
    // A saved state with the title bar above the top edge of the screen.
    const old = run(LAPTOP, { x: -8, y: -19, width: 1366, height: 705, maximized: false });
    ok('a saved position with the title bar above the screen is repaired',
      inside(outerOf(old, LAPTOP.pad), LAPTOP.areas[0]) && old.y >= 0, JSON.stringify(old));
    const huge = run(LAPTOP, { x: 0, y: 0, width: 3000, height: 2000, maximized: false });
    ok('a saved size larger than the screen is held to it', inside(outerOf(huge, LAPTOP.pad), LAPTOP.areas[0]));
    const tiny = run(LAPTOP, { x: 100, y: 100, width: 300, height: 200, maximized: false });
    ok('a saved size below the design minimum is raised to it', tiny.width >= 960 && tiny.height >= 640, `${tiny.width}x${tiny.height}`);

    // A second monitor is somewhere the window may legitimately be.
    const second = run(MONITORS, { x: 2000, y: 100, width: 1200, height: 800, maximized: false });
    ok('a window left on a second monitor stays there', second.x === 2000 && second.y === 100, JSON.stringify(second));
    const wide = run(MONITORS, { x: 1500, y: 100, width: 3000, height: 2000, maximized: false });
    ok('and is held to that monitor, not the first one',
      wide.x >= 1366 && inside(outerOf(wide, MONITORS.pad), MONITORS.areas[1]), JSON.stringify(wide));

    // No measurement is not a reason to guess.
    ok('no screen to measure means no plan', plan({ ...LAPTOP, here: null, saved: null, now: { width: 1380, height: 860 } }) === null);
    ok('and no window size to start from means none either', plan({ ...LAPTOP, saved: null, now: null }) === null);

    // Whatever was saved, the window always ends up reachable on a screen.
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    let strays = 0;
    for (let i = 0; i < 300; i++) {
      const saved = { x: rnd(9000) - 4500, y: rnd(5000) - 2500, width: 200 + rnd(4000), height: 150 + rnd(3000), maximized: false };
      const r = run(LAPTOP, saved);
      if (!inside(outerOf(r, LAPTOP.pad), LAPTOP.areas[0])) strays++;
    }
    ok('300 saved states, scattered across and far beyond the screen, all come back on it', strays === 0, `${strays} ended up outside`);
  }

  // The rest is plumbing, and regex is enough to pin that it is connected.
  const flat = main.replace(/\s+/g, ' ');
  ok('the window is measured against the monitors work areas, not the page',
    /available_monitors/.test(main) && /workArea/.test(main));
  ok('a move or a resize is what triggers a save', /tauri:\/\/move/.test(main) && /tauri:\/\/resize/.test(main));
  ok('a minimized window is never saved', /is_minimized/.test(main) && /-30000/.test(main));
  ok('maximized is read, saved and restored',
    /is_maximized/.test(main) && /plugin:window\|maximize/.test(main) && /maximized: !!now\.maximized/.test(flat));
  ok('what older builds saved is still read, then dropped',
    /hc_win_pos/.test(main) && /hc_win_size/.test(main) && /removeItem\(LEGACY_POS\)/.test(main));
  const caps = readFileSync(join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8');
  ok('the window is allowed to be maximized, which restoring it needs',
    /"core:window:allow-maximize"/.test(caps),
    'without it the call is refused at runtime and a maximized window comes back ordinary');
}

console.log('\nA window that starts hidden is shown even when the page cannot get that far:');
{
  const conf = readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');
  ok('the window starts hidden, and main.js is what shows it', /"visible":\s*false/.test(conf) && /plugin:window\|show/.test(src('main.js')));
  const boot = src('boot.js');
  const fail_ = boot.slice(boot.indexOf('function fail('), boot.indexOf('(async function boot()'));
  ok('a script that fails to load asks the window to show, before it paints its message', /plugin:window\|show/.test(fail_) && fail_.indexOf('plugin:window|show') < fail_.indexOf('createElement'));
  const lib = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  ok('the native side shows it anyway after a while, from its own thread', /\.setup\(\|app\|/.test(lib) && /get_webview_window\("main"\)/.test(lib) && /Duration::from_secs\(10\)/.test(lib) && /is_visible\(\)/.test(lib) && /window\.show\(\)/.test(lib));
  ok('and only a window still hidden', /if !window\.is_visible\(\)\.unwrap_or\(true\)/.test(lib), 'a window the page has shown, or one whose state cannot be read, is left alone');
}

console.log('\nWith no graphics card in use, the intro is still:');
{
  const styles = src('styles.css');
  const rule = styles.slice(styles.indexOf('html.low-gpu #intro-sonar'));
  ok('its sonar dots are left out', /html\.low-gpu #intro-sonar,\s*body\.low-gpu #intro-sonar \{\s*display: none;/.test(styles));
  ok('the drones\' orbit is set in the stylesheet only, where the rest can hold it', !/class="drone-orbit intro-drone-[abc]" style="[^"]*animation/.test(src('index.html')) && /animation-play-state: paused;/.test(rule.slice(0, 1200)));
  ok('its glow, logo, drones and call to click rest in place', ['.logo-glow', '.hc-logo-full', '.drone-orbit', '.cta'].every((c) => rule.includes(`html.low-gpu #intro-screen ${c}`)) && /animation: none;/.test(rule.slice(0, 900)));
}

console.log(`\n${pass} passed, ${fail} failed  (what this machine is)`);
process.exit(fail ? 1 : 0);
