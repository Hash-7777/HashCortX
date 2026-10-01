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

// A clock and timers that only move when told to, so a minute of nobody
// touching the window can be driven in an instant, and so what is pending at
// any moment can be counted.
let now = 1_000_000;
let nextTimer = 1;
const pending = [];
function advance(ms) {
  const end = now + ms;
  for (;;) {
    pending.sort((a, b) => a.due - b.due);
    const next = pending[0];
    if (!next || next.due > end) break;
    pending.shift();
    now = next.due;
    next.fn();
  }
  now = end;
}

const sandbox = {
  console,
  Date: { now: () => now },
  setTimeout(fn, ms) { const id = nextTimer++; pending.push({ id, due: now + ms, fn }); return id; },
  clearTimeout(id) { const i = pending.findIndex((t) => t.id === id); if (i >= 0) pending.splice(i, 1); },
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

console.log('\nUnattended — the decorations rest after a minute, and wake on any touch:');
{
  const R = power.REST_AFTER_MS;
  const states = [];
  const off = power.onChange((s) => states.push(s.resting));
  check('the wait is a minute', R === 60000);
  check('one timer is waiting for it, no more', pending.length === 1, String(pending.length));

  svgCalls.length = 0;
  advance(R - 1000);
  check('just short of a minute nothing rests',
    !power.isResting() && !rootClasses.has('hc-power-quiet') && power.shouldAnimate() === true);

  advance(1500);
  check('after a minute it rests', power.isResting() === true);
  check('and counts as quiet', power.isQuiet() === true && rootClasses.has('hc-power-quiet'));
  check('the idle class is not set — that is for a window nobody can see', !rootClasses.has('hc-power-idle'));
  check('decorative loops are told to rest', power.shouldAnimate() === false);
  check('the window still counts as visible, so what is drawn for meaning keeps drawing',
    power.isVisible() === true && power.state().visible === true);
  check('only the ornamental SVG is paused',
    svgCalls.includes('pause:a') && !svgCalls.includes('pause:b'), svgCalls.join(','));
  check('while resting no timer is pending, so an unattended window wakes nothing', pending.length === 0, String(pending.length));
  check('listeners are told', states[states.length - 1] === true);

  svgCalls.length = 0;
  fire(winListeners, 'pointermove');
  check('a touch wakes it', power.isResting() === false);
  check('the class comes off', !rootClasses.has('hc-power-quiet'));
  check('the decorations are started again', svgCalls.includes('unpause:a'), svgCalls.join(','));
  check('and loops may run', power.shouldAnimate() === true);
  check('listeners are told that too', states[states.length - 1] === false);
  check('and the wait begins again', pending.length === 1, String(pending.length));

  // Activity moves the minute along; it is not a minute from the first event.
  advance(50000);
  fire(winListeners, 'pointerdown');
  advance(50000);
  check('a touch partway through postpones it', power.isResting() === false);
  advance(11000);
  check('and a minute after the last touch it rests', power.isResting() === true);

  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    fire(winListeners, ev);
    check(`${ev} wakes it`, power.isResting() === false);
    advance(R + 500);
    check(`...and after another minute it rests again`, power.isResting() === true);
  }
  fire(winListeners, 'keydown');

  // A window nobody can see has no use for the timer, and coming back is
  // attention in itself.
  advance(R + 500);
  sandbox.document.hidden = true;
  fire(docListeners, 'visibilitychange');
  check('hiding ends resting and cancels the timer', !power.isResting() && pending.length === 0, String(pending.length));
  sandbox.document.hidden = false;
  fire(docListeners, 'visibilitychange');
  check('coming back does not start resting at once', !power.isResting() && pending.length === 1);
  advance(R + 500);
  check('it rests again a minute later', power.isResting() === true);

  // The unfocused case is for machines that draw in software. This is not.
  sandbox.window.HCHost = { software: false };
  fire(winListeners, 'pointermove');
  advance(R + 500);
  check('on a machine with a graphics chip it rests too', power.isResting() === true);
  fire(winListeners, 'pointermove');
  sandbox.window.HCHost = undefined;

  off();
}

console.log('\nThe launch screen is one of the things that rests:');
{
  const base = readFileSync(join(here, '..', '..', 'src', 'css', 'base.css'), 'utf8');
  const rule = base.match(/html\.hc-power-quiet \.intro-screen,[^{]*\{([^}]*)\}/);
  check('the stylesheet pauses it', !!rule);
  check('and the rule is important, because the launch screen is styled by id',
    !!rule && /animation-play-state:\s*paused\s*!important/.test(rule[1]));
  check('the module names it', power.DECORATIVE.includes('.intro-screen'));
  const html = readFileSync(join(here, '..', '..', 'src', 'index.html'), 'utf8');
  check('and the element carries the class, or the rule reaches nothing',
    /<div id="intro-screen" class="intro-screen">/.test(html));
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
