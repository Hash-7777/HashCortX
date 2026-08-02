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
    addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); },
  },
};
sandbox.window = {
  addEventListener: (ev, fn) => { (winListeners[ev] ||= []).push(fn); },
  matchMedia: () => ({ matches: reduced }),
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

console.log(`\n${pass} passed, ${fail} failed  (src/js/power.js)`);
process.exit(fail ? 1 : 0);
