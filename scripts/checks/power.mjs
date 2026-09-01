// ==============================================================
// Idle power checks
//
// Loads the real src/js/power.js behind a fake document, then drives the
// visibility and focus events it listens for and asserts what it does.
//
// Battery bugs never announce themselves. Nothing fails, nothing looks wrong,
// the laptop is just warm — which is why the Forge render loop ran sixty times
// a second on every tab for the life of the app without anyone noticing.
//
// Run with: npm run check:power
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'power.js');

// ── A fake document that records what was asked of it ──
const rootClasses = new Set();
const svgCalls = [];
function fakeSvg(name) {
  return {
    name,
    pauseAnimations() { svgCalls.push(`pause:${name}`); },
    unpauseAnimations() { svgCalls.push(`unpause:${name}`); },
  };
}
const svgs = [fakeSvg('a'), fakeSvg('b')];
// 'a' stands for a drone; 'b' stands for a spinner. Only 'a' may ever be
// paused while the window is on screen.
const ornamentalSvgs = [svgs[0]];
let lastQuery = '';

const docListeners = {};
const winListeners = {};
let reduced = false;

const sandbox = {
  console,
  document: {
    hidden: false,
    hasFocus: () => true,
    documentElement: {
      classList: {
        toggle(cls, on) { on ? rootClasses.add(cls) : rootClasses.delete(cls); },
        contains: (c) => rootClasses.has(c),
      },
    },
    getElementsByTagName: () => svgs,
    querySelectorAll: (sel) => { lastQuery = sel; return ornamentalSvgs; },
    addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); },
  },
};
sandbox.window = {
  addEventListener: (ev, fn) => { (winListeners[ev] ||= []).push(fn); },
  matchMedia: () => ({ matches: reduced }),
  // Set per test. Absent means a machine that can draw, which is the case the
  // third state must never fire on.
  HCHost: undefined,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'power.js' });

const power = sandbox.window.HCPower;
const fire = (map, ev) => (map[ev] || []).forEach((fn) => fn());

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nStarting state:');
check('visible at boot', power.isVisible() === true);
check('no idle class while visible', !rootClasses.has('hc-power-idle'));

console.log('\nWindow hidden — nothing is on screen, so everything stops:');
svgCalls.length = 0;
sandbox.document.hidden = true;
fire(docListeners, 'visibilitychange');
check('reports hidden', power.isVisible() === false);
check('CSS animations are paused via the root class', rootClasses.has('hc-power-idle'));
check('SVG (SMIL) animations are paused too — CSS cannot reach them',
  svgCalls.filter(c => c.startsWith('pause:')).length === 2, svgCalls.join(','));
check('continuous loops are told to stop', power.shouldAnimate() === false);

console.log('\nWindow visible again — everything resumes:');
svgCalls.length = 0;
sandbox.document.hidden = false;
fire(docListeners, 'visibilitychange');
check('reports visible', power.isVisible() === true);
check('the idle class is removed', !rootClasses.has('hc-power-idle'));
check('SVG animations are unpaused',
  svgCalls.filter(c => c.startsWith('unpause:')).length === 2, svgCalls.join(','));
check('loops may run again', power.shouldAnimate() === true);

console.log('\nBlurred but still visible — motion must NOT freeze:');
fire(winListeners, 'blur');
check('reports unfocused', power.isFocused() === false);
check('still counts as visible', power.isVisible() === true);
check('animations keep running — a frozen window you can see looks like a hang',
  power.shouldAnimate() === true);
check('no idle class', !rootClasses.has('hc-power-idle'));
fire(winListeners, 'focus');
check('focus is restored', power.isFocused() === true);

console.log('\nReduced motion is a request, not a suggestion:');
reduced = true;
check('decorative loops stop', power.shouldAnimate() === false);
check('and it is reported', power.prefersReducedMotion() === true);
reduced = false;

console.log('\nSubscribers:');
{
  let seen = 0;
  const off = power.onChange(() => { seen++; });
  check('a new subscriber is called immediately with the current state', seen === 1);
  sandbox.document.hidden = true;
  fire(docListeners, 'visibilitychange');
  check('and again when visibility changes', seen === 2);
  off();
  sandbox.document.hidden = false;
  fire(docListeners, 'visibilitychange');
  check('unsubscribing stops the calls', seen === 2);
}
{
  // One bad listener must not stop the others, or a single typo somewhere
  // silently leaves the whole app running at full power in the background.
  let reached = false;
  const offBad = power.onChange(() => { throw new Error('boom'); });
  const offGood = power.onChange(() => { reached = true; });
  reached = false;
  sandbox.document.hidden = true;
  fire(docListeners, 'visibilitychange');
  check('a listener that throws does not stop the rest', reached === true);
  offBad(); offGood();
  sandbox.document.hidden = false;
  fire(docListeners, 'visibilitychange');
}

console.log('\nBlurred on a machine that draws in software — ornament rests, nothing else:');
{
  // The state only exists where every pixel is charged to the processor.
  sandbox.window.HCHost = { software: true };
  svgCalls.length = 0;
  fire(winListeners, 'blur');

  check('it is reported as quiet', power.isQuiet() === true);
  check('the window is still counted as visible', power.isVisible() === true);
  check('the quiet class is set', rootClasses.has('hc-power-quiet'));
  check('the idle class is NOT — that one is for a window nobody can see',
    !rootClasses.has('hc-power-idle'));
  check('decorative loops are told to rest', power.shouldAnimate() === false);
  check('and listeners are told about it', power.state().quiet === true);

  // The half CSS cannot do. Only the SMIL inside a decoration.
  check('only the ornamental SVG is paused',
    svgCalls.includes('pause:a') && !svgCalls.includes('pause:b'),
    svgCalls.join(','));
  check('the other one is left running', svgCalls.includes('unpause:b'));
  check('and it asked for the decorations by name, not for every svg',
    /drone-bg svg/.test(lastQuery) && /,/.test(lastQuery), lastQuery);

  fire(winListeners, 'focus');
  check('focus ends it', power.isQuiet() === false);
  check('the class comes off', !rootClasses.has('hc-power-quiet'));
  check('decorative loops may run again', power.shouldAnimate() === true);
  sandbox.window.HCHost = undefined;
}

console.log('\nBlurred on a machine that can draw — nothing changes at all:');
{
  // The existing promise, and the one most easily broken by adding a state:
  // a window you can still see must not freeze just because it lost focus.
  sandbox.window.HCHost = { software: false };
  svgCalls.length = 0;
  fire(winListeners, 'blur');
  check('not quiet', power.isQuiet() === false);
  check('no quiet class', !rootClasses.has('hc-power-quiet'));
  check('motion keeps running', power.shouldAnimate() === true);
  check('no SVG is paused', !svgCalls.some((c) => c.startsWith('pause:')), svgCalls.join(','));
  fire(winListeners, 'focus');
  sandbox.window.HCHost = undefined;
}

console.log('\nWhat may be stopped is named, and named in one place:');
{
  const base = readFileSync(join(here, '..', '..', 'src', 'css', 'base.css'), 'utf8');
  const inCss = [...base.matchAll(/html\.hc-power-quiet\s+(\.[\w-]+)\s*(?:,|\{)/g)]
    .map((m) => m[1]);
  const unique = [...new Set(inCss)];
  check('the stylesheet pauses the same list the module does',
    JSON.stringify(unique) === JSON.stringify(power.DECORATIVE),
    `css: ${unique.join(' ')} | js: ${power.DECORATIVE.join(' ')}`);

  // The rule that keeps this safe. If anything that reports progress ever
  // appears in the list, a person watching it would see it freeze.
  const MEANS_SOMETHING = /spin|pulse|progress|load|bar|stream|typing|wait|busy/i;
  const offenders = power.DECORATIVE.filter((sel) => MEANS_SOMETHING.test(sel));
  check('nothing in it reports progress or state', offenders.length === 0, offenders.join(' '));
  check('and it is not a wildcard',
    power.DECORATIVE.every((sel) => /^\.[\w-]+$/.test(sel)),
    'pausing by wildcard is what catches a spinner');
}

console.log('\nThe launch screen is taken out of the document, not just hidden:');
{
  // Hidden is not gone. `visibility: hidden` stops an element being painted
  // and changes nothing else — it keeps its box, its compositor layers, and
  // every animation on it keeps running. The launch screen therefore animated
  // for the life of the app behind the window somebody was using: eight of
  // the nine CSS animations still running after launch, plus sixteen SMIL
  // ones, belonged to a screen nobody could see.
  //
  // It also silently defeated the splash clock, which stops itself on
  // `!el.isConnected || !el.offsetParent`. That reads as "when my element has
  // left the screen" and is false while the element is merely invisible —
  // `offsetParent` is only null for `display: none`. The clock ticked once a
  // second forever. Removing the screen is what makes that guard true, so the
  // two are checked together.
  const main = readFileSync(join(here, '..', '..', 'src', 'main.js'), 'utf8');
  const exit = main.slice(main.indexOf('After the intro fade completes'),
                          main.indexOf("classList.remove('transitioning'"));

  check('the intro screen is removed once it has faded', /screen\.remove\(\)/.test(exit));
  check('and not merely made invisible',
    !/screen\.style\.visibility\s*=\s*['"]hidden/.test(exit),
    'hiding it leaves every animation on it running for the life of the app');
  check('the splash clock still stops itself when its element goes',
    /!el\.isConnected\s*\|\|\s*!el\.offsetParent/.test(main),
    'this is the guard that removing the screen makes true');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/power.js)`);
process.exit(fail ? 1 : 0);
