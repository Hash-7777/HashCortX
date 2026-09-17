// ==============================================================
// Trace time checks
//
// Loads the REAL src/js/trace-time.js into a Node VM, and reads every mode's
// trace to make sure each one stamps its lines through it.
//
// Run with: npm run check:trace-time
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'trace-time.js'), 'utf8'), sandbox, { filename: 'trace-time.js' });
const T = sandbox.window.HCTraceTime;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const is = (label, got, want) => ok(`${label}: ${want}`, got === want, `got ${got}`);

console.log('A run reads like a stopwatch:');
is('the start', T.format(0), '0.0s');
is('under a minute', T.format(42.5), '42.5s');
is('a value floating point holds a hair short', T.format(12.3), '12.3s');
is('the last tenth before a minute', T.format(59.99), '59.9s');
is('a minute exactly', T.format(60), '1:00.0');
is('minutes and seconds', T.format(466.8), '7:46.8');
is('a long Swarm run', T.format(1160), '19:20.0');
is('the last tenth before an hour', T.format(3599.95), '59:59.9');
is('an hour exactly', T.format(3600), '1:00:00.0');
is('hours, minutes and seconds', T.format(3723.4), '1:02:03.4');
is('a day-long run keeps counting hours', T.format(90061.2), '25:01:01.2');
is('nothing that is not a number reads as the start', T.format('soon'), '0.0s');
is('a clock that went backwards reads as the start', T.format(-3), '0.0s');
is('since a start time', T.since(1000, 1000 + 61_500), '1:01.5');

console.log('\nEvery trace in the app stamps its lines this way:');
const TRACES = {
  'modes/code/mode.js': 'Coder',
  'modes/agent-maker/mode.js': 'Agent Swarm',
  'modes/finance/mode.js': 'Finance',
  'modes/virtual-os/mode.js': 'Virtual OS',
  'modes/forge/mode.js': '3D Forge',
  'modes/systems/mode.js': 'ERP',
};
for (const [file, name] of Object.entries(TRACES)) {
  const src = readFileSync(join(root, 'src', ...file.split('/')), 'utf8');
  ok(`${name} uses the stopwatch`, /HCTraceTime\.(format|since)\(/.test(src));
  ok(`${name} no longer writes a bare count of seconds into a stamp`, !/\[\$\{[^}]*\}s\]/.test(src), file);
}
const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
ok('it is loaded before the modes', boot.indexOf("'/js/trace-time.js'") > 0 && boot.indexOf("'/js/trace-time.js'") < boot.indexOf("'/modes/boot.js'"));

console.log(`\n${pass} passed, ${fail} failed  (src/js/trace-time.js)`);
process.exit(fail ? 1 : 0);
