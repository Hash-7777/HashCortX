// ============================================================
// A command's output as the model is given it — src/js/code/digest.js.
// Run with: npm run check:code-digest
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'digest.js'), sandbox, { filename: 'digest.js' });
const D = sandbox.window.HCCodeDigest;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

// A test run: 600 passing lines, one failure in the middle with where it
// happened, and the summary at the end.
const passing = (n, from = 0) => Array.from({ length: n }, (_, i) => `ok ${from + i + 1} - adds item ${from + i + 1}`);
const run = [
  'TAP version 13', ...passing(300),
  'not ok 301 - totals the order', '  ---', '  error: Expected values to be strictly equal: 41 !== 42', '    at Object.<anonymous> (test/order.test.js:18:10)', '  ...',
  ...passing(300, 301), '# tests 601', '# pass 600', '# fail 1',
].join('\n');

console.log('Output that fits is given whole:');
ok('whole, character for character', D.digestText('short run\nall passed', 1000) === 'short run\nall passed');
ok('a record that fits is the same record', (() => { const r = { stdout: 'a', stderr: 'b', code: 0 }; return D.shellResult(r, 100) === r; })());

console.log('\nLong output keeps what matters:');
{
  const d = D.digestText(run, 4000);
  ok('it fits the limit', d.length <= 4000, `${d.length}`);
  ok('the failure is kept, with where it happened', /not ok 301 - totals the order/.test(d) && /41 !== 42/.test(d) && /order\.test\.js:18:10/.test(d));
  ok('so is the summary at the end', /# fail 1/.test(d) && /# pass 600/.test(d));
  ok('and how it started', d.includes('TAP version 13'));
  ok('passing lines are left out, and says how many where they were', /… \[\d+ lines left out\] …/.test(d) && !d.includes('ok 150 - adds item 150'));
  ok('it says it was shortened, and how to see more', new RegExp(`^\\[Shortened for the model: \\d+ of ${run.split('\n').length} lines`).test(d) && /narrower command/.test(d));
  ok('the same output always comes out the same way', D.digestText(run, 4000) === d);
}
{
  const missing = ['zsh: command not found: pytest', ...passing(400)].join('\n');
  ok('a missing program is kept, where the app looks for it', D.digestText(missing, 2000).split('\n')[1] === 'zsh: command not found: pytest');
  const py = [...passing(400), 'Traceback (most recent call last):', '  File "/p/stats.py", line 12, in median', '    return xs[len(xs) // 2]', 'IndexError: list index out of range', ...passing(100, 400)].join('\n');
  const d = D.digestText(py, 3000);
  ok("a Python failure is kept whole with its lines", /Traceback/.test(d) && /stats\.py", line 12/.test(d) && /IndexError/.test(d));
  const noisy = Array.from({ length: 3000 }, (_, i) => `error ${i}: something failed at x.js:${i}`).join('\n');
  ok('a run where every line is a failure still fits', D.digestText(noisy, 5000).length <= 5000);
}

console.log('\nWhat shell_run hands the model:');
{
  const r = D.shellResult({ stdout: run, stderr: 'npm ERR! Test failed.', code: 1, timedOut: false }, 3000);
  ok('its exit code and the rest of the record are kept', r.code === 1 && r.timedOut === false);
  ok('the error stream, short, is whole', r.stderr === 'npm ERR! Test failed.');
  ok('the output stream is shortened to fit beside it', r.stdout.length + r.stderr.length <= 3000 && /# fail 1/.test(r.stdout));
  ok('nothing that is not a record is touched', D.shellResult(null) === null && D.shellResult('text') === 'text');
}

console.log('\nHashCoder gives it for the model in use:');
{
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('shell_run is shortened through it, by the limit set for the model', /HC\.code\.shellRun\(p\.command, p\.args \|\| \[\], p\.cwd \|\| null, p\.reason\)\.then\(\(r\) => \(window\.HCCodeDigest \? window\.HCCodeDigest\.shellResult\(r, HC\.code\.outputLimit\) : r\)\)/.test(tools));
  const mode = src('modes', 'code', 'mode.js');
  ok('the limit follows the size of the model', /HC\.code\.outputLimit = window\.HCAgentContext\.optionsFor\(size, sharedState\.local\)\.shellOutput/.test(mode));
  ok('it is loaded before the mode', src('boot.js').indexOf("'/js/code/digest.js'") > 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/digest.js)`);
process.exit(fail ? 1 : 0);
