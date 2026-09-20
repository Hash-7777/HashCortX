// ==============================================================
// The line that keeps saying what is happening while it happens
//
// Loads the REAL src/js/trace-live.js against a clock and timers this file
// drives, so every word the app shows while it waits can be read off without
// waiting two minutes for it.
//
// The defect it replaces, kept here as a control: a run wrote which model it
// was asking and then awaited it. A big free model sits in a shared queue, and
// one measured run spent two minutes and seven seconds on a single attempt
// with the line saying exactly what it said at the start. There was no way to
// tell a model thinking from one that had died.
//
// EVERY PHRASE HERE MUST BE TIED TO SOMETHING REAL. The point of this file is
// as much to stop that as to check it: a line that says "thinking" while
// nothing is happening is a lie the app tells on every run, and it would be
// worse than the frozen line it replaced.
//
// Run with: npm run check:trace-live
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'trace-live.js'), 'utf8'), sandbox, { filename: 'trace-live.js' });
const L = sandbox.window.HCTraceLive;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const say = (o) => L.phrase({ elapsedMs: 0, chars: 0, deadlineMs: 0, queued: false, ...o });

console.log('Waiting says how long it has been waiting:');
ok('a moment is not worth remarking on', say({ elapsedMs: 900 }) === 'thinking');
ok('a few seconds in, it says how many', say({ elapsedMs: 12000 }) === 'thinking · 12s');
ok('and once it is long enough to wonder about, it says so', /^still thinking/.test(say({ elapsedMs: 40000 })));
ok('the count is the truth, not a guess', say({ elapsedMs: 40000 }) === 'still thinking · 40s');

console.log('\nA model that sits in a free queue is named as queued:');
ok('because that is the actual reason it is slow', say({ elapsedMs: 12000, queued: true }) === 'queued · 12s');
ok('and it still says how long', /45s/.test(say({ elapsedMs: 45000, queued: true })));
ok('a model that is not queued is never called queued', !/queue/.test(say({ elapsedMs: 45000 })));

console.log('\nOnce an answer starts arriving it counts what has arrived:');
ok('the count is characters, really received', say({ elapsedMs: 3000, chars: 340 }) === 'writing · 340 characters');
ok('and once it is large it rounds rather than flickering', /1\.2k characters/.test(say({ elapsedMs: 3000, chars: 1240 })));
ok('a long answer also says how long it has been writing', /· 30s$/.test(say({ elapsedMs: 30000, chars: 5000 })));
ok('writing is never called thinking', !/thinking/.test(say({ elapsedMs: 40000, chars: 10 })));

console.log('\nNear the deadline it says what happens next:');
ok('it says no answer has come', /^no answer yet/.test(say({ elapsedMs: 80000, deadlineMs: 90000 })));
ok('and that another model is next', /trying another model/.test(say({ elapsedMs: 80000, deadlineMs: 90000 })));
ok('and how long until that', /in 10s/.test(say({ elapsedMs: 80000, deadlineMs: 90000 })));
ok('at the deadline it drops the countdown rather than counting to nothing',
  say({ elapsedMs: 90000, deadlineMs: 90000 }) === 'no answer yet · 90s · trying another model');
ok('with no deadline it never promises another model',
  !/another model/.test(say({ elapsedMs: 300000, deadlineMs: 0 })));
ok('and an answer arriving beats the countdown',
  /^writing/.test(say({ elapsedMs: 80000, chars: 50, deadlineMs: 90000 })));

console.log('\nNothing here is a spinner:');
// The whole risk of this file is that it becomes decoration. Every phrase must
// change only because something changed.
const still = say({ elapsedMs: 40000 });
ok('the same moment reads the same twice', say({ elapsedMs: 40000 }) === still);
ok('a different moment reads differently', say({ elapsedMs: 41000 }) !== still);
ok('and a stalled answer shows the count standing still, not moving',
  say({ elapsedMs: 40000, chars: 100 }) === say({ elapsedMs: 40000, chars: 100 }));

console.log('\nThe line runs on a clock it is handed, and stops:');
{
  let t = 0;
  const written = [];
  let timers = 0;
  const live = L.create({
    write: (text) => written.push(text),
    now: () => t,
    setTimer: () => { timers++; return 1; },
    clearTimer: () => { timers--; },
  });
  ok('it writes as soon as it is made', written.length === 1 && written[0] === 'thinking');
  ok('and takes one timer', timers === 1);
  t = 12000;
  live.heard(200);
  ok('bytes arriving rewrite the line', /writing · 200 characters/.test(written[written.length - 1]));
  live.heard(150);
  ok('a smaller total does not walk the count backwards', live.chars() === 200);
  live.done();
  ok('finishing gives the timer back', timers === 0);
  const after = written.length;
  live.heard(999);
  ok('and nothing writes after it has finished', written.length === after);
  live.done();
  ok('finishing twice is harmless', timers === 0);
}

console.log('\nAnd the modes use it where a run actually waits:');
{
  const erp = readFileSync(join(root, 'src', 'modes', 'systems', 'mode.js'), 'utf8');
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  ok('it is loaded', /\/js\/trace-live\.js/.test(boot));
  ok('the ERP has a line it can keep writing to', /function traceLive\(/.test(erp));
  ok('the generation attempt is one', /const waiting = traceLive\(`Direct generation attempt/.test(erp));
  ok('and the repair pass is another', /const repairing = traceLive\("JSON repair pass"/.test(erp));
  ok('every one of them is finished on the way out, not only on success',
    (erp.match(/\.finally\(\(\) => (waiting|repairing)\.done\(\)\)/g) || []).length === 2,
    'a line left live is a timer left running');
  const swarm = readFileSync(join(root, 'src', 'modes', 'agent-maker', 'mode.js'), 'utf8');
  ok('the Swarm has one too', /function traceLive\(agentName/.test(swarm));
  ok('an agent\'s turn is live, with the deadline it really has',
    /const waiting = traceLive\([\s\S]{0,200}deadlineMs: timeoutMs/.test(swarm));
  ok('and it is finished on the way out there as well',
    /\.finally\(\(\) => waiting\.done\(\)\)/.test(swarm));
  // Both modes ask the same question of the same place, rather than each
  // keeping its own idea of which models queue.
  ok('a queued model is named from what already measured it',
    /function queued\(modelValue\)[\s\S]{0,240}likely-slow/.test(readFileSync(join(root, 'src', 'js', 'trace-live.js'), 'utf8')));
  ok('and both modes ask it there', /HCTraceLive\?\.queued\(/.test(erp) && /HCTraceLive\?\.queued\(/.test(swarm));
  ok('neither keeps a second copy of that rule', !/likely-slow/.test(erp) && !/likely-slow/.test(swarm));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/trace-live.js)`);
process.exit(fail ? 1 : 0);
