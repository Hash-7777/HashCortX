// ==============================================================
// The model lists keeping themselves current
//
// Loads the REAL src/js/model-refresh.js against a clock and a set of timers
// this file controls, so the whole schedule is exercised without waiting half
// an hour for it.
//
// The defect it replaces, kept here as a control: every provider was asked
// what models it has exactly once, as the app started. An app opened a moment
// before the network came up spent the whole session offering the models
// written into src/data/cloud-models.js by hand — several of which no longer
// exist — and an app left open for days never heard that one had been retired.
//
// Run with: npm run check:model-refresh
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'model-refresh.js'), 'utf8'), sandbox, { filename: 'model-refresh.js' });
const R = sandbox.window.HCModelRefresh;

const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A refresher wired to a clock and timers this test drives by hand. */
function rig({ failed = () => false, refresh } = {}) {
  let t = 0;
  let nextId = 1;
  const timers = new Map();
  const listeners = {};
  const asked = [];
  const r = R.create({
    refresh: refresh || (async () => { asked.push(t); }),
    failed,
    on: (event, handler) => { listeners[event] = handler; },
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    r, asked, listeners,
    advance(ms) { t += ms; },
    /** Run every timer that has come due, once. */
    async tick() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= t) { timers.delete(id); timer.fn(); await Promise.resolve(); await Promise.resolve(); }
      }
    },
    pending: () => [...timers.values()].map((x) => x.at - t),
    at: () => t,
  };
}

console.log('It asks again on its own, which nothing did before:');
{
  const g = rig();
  g.r.start();
  ok('starting schedules a pass', g.pending().length === 1);
  ok('the first one is the ordinary wait away', g.pending()[0] === R.EVERY_MS);
  g.advance(R.EVERY_MS);
  await g.tick();
  ok('the timer asks', g.asked.length === 1);
  ok('and schedules the next', g.pending().length === 1);
}

console.log('\nA provider that failed is asked again sooner:');
{
  let broken = true;
  const g = rig({ failed: () => broken });
  g.r.start();
  ok('a failure waits minutes, not half an hour', g.pending()[0] === R.RETRY_MS);
  ok('and that is much sooner than the ordinary wait', R.RETRY_MS < R.EVERY_MS);
  g.advance(R.RETRY_MS);
  // The pass decides the next wait as it ends, so the provider has to be
  // answering before it runs, not after.
  broken = false;
  await g.tick();
  ok('once every provider answers it goes back to the ordinary wait', g.pending()[0] === R.EVERY_MS);
}

console.log('\nComing back to the app asks again:');
{
  const g = rig();
  g.r.start();
  ok('it listens for the window coming forward', typeof g.listeners.focus === 'function');
  ok('and for the machine coming back online', typeof g.listeners.online === 'function');
  ok('and for the window being shown again', typeof g.listeners.visibilitychange === 'function');
  g.advance(R.MIN_GAP_MS + 1);
  await g.listeners.focus();
  ok('coming forward asks', g.asked.length === 1);
}

console.log('\nBut it can never become a stream of requests:');
{
  const g = rig();
  g.r.start();
  g.advance(R.MIN_GAP_MS + 1);
  await g.listeners.focus();
  ok('the first one goes', g.asked.length === 1);
  await g.listeners.focus();
  await g.listeners.online();
  await g.listeners.visibilitychange();
  ok('a window dragged about does not ask again', g.asked.length === 1);
  g.advance(R.MIN_GAP_MS + 1);
  await g.listeners.focus();
  ok('once the gap has passed it asks again', g.asked.length === 2);
  ok('and the gap is long enough to matter', R.MIN_GAP_MS >= 10000);
}

console.log('\nOne pass at a time, and a failing one never stops the next:');
{
  let release;
  const held = new Promise((r) => { release = r; });
  let calls = 0;
  const g = rig({ refresh: () => { calls++; return held; } });
  g.r.start();
  g.advance(R.MIN_GAP_MS + 1);
  g.listeners.focus();
  await Promise.resolve();
  g.advance(R.MIN_GAP_MS + 1);
  await g.listeners.focus();
  ok('a second pass does not start while one is in flight', calls === 1);
  release();
  await held;
  await Promise.resolve();
  ok('and the one in flight schedules the next when it ends', g.pending().length === 1);
}
{
  const g = rig({ refresh: async () => { throw new Error('offline'); } });
  g.r.start();
  g.advance(R.MIN_GAP_MS + 1);
  await g.listeners.focus();
  await Promise.resolve();
  ok('a pass that throws is not an error anyone is told about', true);
  ok('and the next pass is still scheduled', g.pending().length === 1);
}

console.log('\nStopping stops it:');
{
  const g = rig();
  g.r.start();
  g.r.stop();
  ok('no timer is left behind', g.pending().length === 0);
  g.advance(R.MIN_GAP_MS + 1);
  await g.listeners.focus();
  ok('and nothing asks after it has stopped', g.asked.length === 0);
}

console.log('\nThe app starts it, and asks in a way that costs nothing when all is well:');
ok('the module is loaded', /\/js\/model-refresh\.js/.test(boot));
ok('and before the app that uses it', boot.indexOf('/js/model-refresh.js') < boot.indexOf('/js/app.js'));
ok('the app starts it', /window\.HCModelRefresh\.create\(\{[\s\S]{0,400}\}\)\.start\(\)/.test(app));
ok('it asks through the one refresh the app already had',
  /refresh: \(\) => refreshCloudModelsFromAPIs\(\)/.test(app));
ok('which does NOT force, so a provider that answered is not asked again',
  !/refresh: \(\) => refreshCloudModelsFromAPIs\(\{ *force/.test(app));
ok('a provider left without a list is what counts as failed',
  /state === "error" \|\| r\.state === "empty"/.test(app));
ok('a hidden window is not treated as the window coming forward',
  /event !== "visibilitychange" \|\| !document\.hidden/.test(app));

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-refresh.js)`);
process.exit(fail ? 1 : 0);
