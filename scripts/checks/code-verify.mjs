// ==============================================================
// Proof that a change works — checks
//
// Loads the REAL src/js/code/verify.js and holds that commands are sorted by
// the check they are, that a project's own checks are found from its files,
// that the agent is sent back only when it changed code and nothing proved it,
// and that what the person is told comes from the record.
//
// Run with: npm run check:code-verify
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'verify.js'), sandbox, { filename: 'verify.js' });
const V = sandbox.window.HCCodeVerify;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('What a command is:');
{
  const kinds = [
    ['npm', ['test'], 'test'], ['npm', ['run', 'test'], 'test'], ['npm', ['t'], 'test'], ['yarn', ['test:unit'], 'test'],
    ['npm', ['run', 'lint'], 'lint'], ['npm', ['run', 'build'], 'build'], ['pnpm', ['typecheck'], 'typecheck'],
    ['npx', ['jest'], 'test'], ['npx', ['eslint', 'src'], 'lint'], ['npx', ['tsc', '--noEmit'], 'typecheck'],
    ['node', ['--test'], 'test'], ['node', ['test/range.test.js'], 'test'], ['node', ['--check', 'app.js'], 'lint'],
    ['python3', ['-m', 'unittest'], 'test'], ['python', ['-m', 'pytest', '-q'], 'test'], ['pytest', [], 'test'],
    ['python3', ['-m', 'py_compile', 'cart.py'], 'lint'], ['python3', ['tests/test_stats.py'], 'test'], ['mypy', ['.'], 'typecheck'],
    ['cargo', ['test'], 'test'], ['cargo', ['clippy'], 'lint'], ['cargo', ['build'], 'build'], ['go', ['test', './...'], 'test'],
    ['make', ['test'], 'test'], ['/opt/tools/bin/eslint', ['.'], 'lint'],
  ];
  for (const [cmd, args, want] of kinds) {
    ok(`${[cmd, ...args].join(' ')} is ${want}`, V.commandKind(cmd, args) === want, String(V.commandKind(cmd, args)));
  }
  for (const [cmd, args] of [['ls', ['-la']], ['cat', ['package.json']], ['node', ['server.js']], ['npm', ['install']], ['git', ['status']], ['python3', ['app.py']], ['npm', ['start']]]) {
    ok(`${[cmd, ...args].join(' ')} is no check`, V.commandKind(cmd, args) === null, String(V.commandKind(cmd, args)));
  }
  ok('a command written as one line is read the same', V.commandKind('npm test', []) === 'test');
}

console.log('\nThe whole of a check, or part of it:');
{
  ok('npm test covers the whole project', V.commandScope('npm', ['test']) === 'whole');
  ok('python3 -m unittest covers the whole project', V.commandScope('python3', ['-m', 'unittest']) === 'whole');
  ok('cargo test and go test ./... cover it', V.commandScope('cargo', ['test']) === 'whole' && V.commandScope('go', ['test', './...']) === 'whole');
  ok('a named test file is part', V.commandScope('node', ['--test', 'test/one.test.js']) === 'part');
  ok('a name filter is part', V.commandScope('npm', ['test', '--', '-t', 'adds']) === 'part' && V.commandScope('pytest', ['-k', 'median']) === 'part');
  ok('one test module is part', V.commandScope('python3', ['-m', 'unittest', 'tests.test_stats']) === 'part');
}

console.log('\nThe project\'s own checks:');
{
  const pkg = (scripts) => JSON.stringify({ name: 'x', scripts });
  ok('npm test when package.json has a test script', V.projectChecks({ files: ['package.json'], packageJson: pkg({ test: 'node --test' }) }).test === 'npm test');
  ok('not the placeholder npm writes', !V.projectChecks({ files: ['package.json'], packageJson: pkg({ test: 'echo "Error: no test specified" && exit 1' }) }).test);
  ok('lint, type check and build scripts too', (() => {
    const c = V.projectChecks({ files: ['package.json'], packageJson: pkg({ test: 'vitest', lint: 'eslint .', typecheck: 'tsc', build: 'vite build' }) });
    return c.lint === 'npm run lint' && c.typecheck === 'npm run typecheck' && c.build === 'npm run build';
  })());
  ok('the runner the lockfile names', V.projectChecks({ files: ['package.json', 'pnpm-lock.yaml'], packageJson: pkg({ test: 'vitest' }) }).test === 'pnpm test');
  ok('unittest for a Python project with tests', V.projectChecks({ files: ['stats.py', 'tests'] }).test === 'python3 -m unittest');
  ok('pytest when the project uses it', V.projectChecks({ files: ['app.py', 'tests', 'requirements.txt'], requirements: 'pytest==8\n' }).test === 'python3 -m pytest');
  ok('Python with no tests has none', !V.projectChecks({ files: ['timeparse.py'] }).test);
  ok('cargo and go', V.projectChecks({ files: ['Cargo.toml'] }).test === 'cargo test' && V.projectChecks({ files: ['go.mod'] }).test === 'go test ./...');
  ok('a Makefile test target', V.projectChecks({ files: ['Makefile'], makefile: 'build:\n\tcc x.c\ntest: build\n\t./run\n' }).test === 'make test');
  ok('a package.json that does not parse says nothing', Object.keys(V.projectChecks({ files: ['package.json'], packageJson: '{oops' })).length === 0);
  ok('the line for the instructions names them', /test: `npm test`/.test(V.checksLine({ test: 'npm test' })) && V.checksLine({}) === '');
}

console.log('\nWhen the agent is sent back:');
{
  const passed = { code: 0, stdout: 'ok', stderr: '' };
  const failed = { code: 1, stdout: '', stderr: 'AssertionError' };
  const checks = { test: 'npm test' };

  let log = V.proofLog();
  ok('nothing changed: never', V.stopCheck(log, checks, 'Done.') === null);

  log = V.proofLog();
  log.edited('/p/src/range.js');
  const back = V.stopCheck(log, checks, 'Fixed the off-by-one.');
  ok('code changed and nothing run: sent back to run the test', back && /Run `npm test` now/.test(back.message) && /range\.js/.test(back.message));
  ok('the note says it is from the app, not the person', V.isAppNote(back.message));

  log.ran('npm', ['test'], passed);
  ok('a test passed after the change: not sent back', V.stopCheck(log, checks, 'Fixed.') === null);

  log.edited('/p/src/range.js');
  ok('a change after the passing test: sent back again', V.stopCheck(log, checks, 'Fixed.') !== null);

  log = V.proofLog();
  log.edited('/p/src/basket.js');
  log.ran('npm', ['test'], failed);
  const again = V.stopCheck(log, checks, 'Done.');
  ok('a test that failed after the change: sent back to fix it', again && /failed after your last change/.test(again.message));

  log = V.proofLog();
  log.edited('/p/src/basket.js');
  ok('twice at most', V.stopCheck(log, checks, 'Done.', 2) === null && V.stopCheck(log, checks, 'Done.', 1) !== null);
  ok('not when the reply asks the person something', V.stopCheck(log, checks, 'Should I also update the docs?') === null);
  ok('not when the project names no test and none was run', V.stopCheck(log, {}, 'Done.') === null);

  log = V.proofLog();
  log.edited('/p/README.md');
  log.edited('/p/index.html');
  log.edited('/p/config/app.json');
  ok('documents, pages and settings files only: not sent back', V.stopCheck(log, checks, 'Updated.') === null);

  log = V.proofLog();
  log.edited('/p/src/a.js');
  log.ran('npm', ['run', 'lint'], passed);
  ok('a lint that passed is not a test', V.stopCheck(log, checks, 'Done.') !== null);
  log.ran('ls', ['-la'], passed);
  ok('a command that checks nothing is not recorded', log.checks.length === 1);
  ok('a command that never started is not recorded', log.ran('npm', ['test'], null) === null && log.checks.length === 1);
}

console.log('\nA change written into the reply instead of made:');
{
  const fence = (lang, n) => '```' + lang + '\n' + Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n```';
  const asked = (text) => [{ role: 'system', content: 's' }, { role: 'user', content: text }];
  const reply = `Here is the fix:\n\n${fence('js', 4)}\n\nThis includes the end.`;
  let log = V.proofLog();
  const back = V.unmadeChange(log, asked('Fix the off-by-one in range.js'), reply);
  ok('a change asked for, code in the reply, no file changed: sent back to make it', back && back.kind === 'make' && /no file in the project was changed/.test(back.message) && V.isAppNote(back.message));
  ok('it says what it was sent back for', back && /make the change/.test(back.step));
  ok('once at most', V.unmadeChange(log, asked('Fix it'), reply, 1) === null);
  log.edited('/p/src/range.js');
  ok('not when a file was changed', V.unmadeChange(log, asked('Fix it'), reply) === null);
  log = V.proofLog();
  ok('not for a question', V.unmadeChange(log, asked('Explain how range() works'), reply) === null);
  ok('not when the reply asks the person something', V.unmadeChange(log, asked('Fix it'), reply + '\n\nShall I apply it?') === null);
  ok('not for commands to type in a terminal', V.unmadeChange(log, asked('Fix the build'), `Run:\n\n${fence('bash', 4)}`) === null);
  ok('not for a line or two of code', V.unmadeChange(log, asked('Fix it'), `Change it to:\n\n${fence('js', 2)}`) === null);
  ok('not for code only mentioned in a sentence', V.unmadeChange(log, asked('Fix it'), 'Use `n <= end` in the loop.') === null);
  const notes = [{ role: 'user', content: 'Add a --lines flag' }, { role: 'assistant', content: '' }, { role: 'user', content: `${V.APP_NOTE} run the tests` }];
  ok('the request is the person\'s, not a note from the app', V.requestIn(notes) === 'Add a --lines flag');
  ok('a picture the agent opened is not the request', V.requestIn([...notes, { role: 'user', content: 'See the screenshot', images: ['x'] }]) === 'Add a --lines flag');
}

console.log('\nWhat the person is told:');
{
  const log = V.proofLog();
  ok('no code changed: nothing', V.proofLine(log) === '');
  log.edited('/p/src/range.js');
  ok('nothing run', /^Not checked: no test ran after the last change/.test(V.proofLine(log)));
  log.ran('npm', ['run', 'lint'], { code: 0 });
  ok('only a lint', /^Not tested: `npm run lint` passed/.test(V.proofLine(log)));
  log.ran('npm', ['test'], { code: 1 });
  ok('a failed test', /^Not proven: `npm test` failed/.test(V.proofLine(log)));
  log.ran('node', ['--test', 'test/range.test.js'], { code: 0 });
  ok('a test that passed for part of the project says so', /^Checked after the last change: `node --test test\/range\.test\.js` passed, for part of the project\.$/.test(V.proofLine(log)), V.proofLine(log));
  log.ran('npm', ['test'], { code: 0 });
  ok('the whole test suite passing says so plainly', V.proofLine(log) === 'Checked after the last change: `npm test` passed.');
  log.ran('npm', ['test'], { code: 0, timedOut: true });
  ok('a run that timed out did not pass', /^Not proven/.test(V.proofLine(log)));
}

console.log('\nThe Coder uses it:');
{
  const boot = src('boot.js');
  ok('it loads before the Coder mode', boot.includes("'/js/code/verify.js'") && boot.indexOf("'/js/code/verify.js'") < boot.indexOf("'/js/code/export.js'"));
  const mode = src('modes', 'code', 'mode.js');
  ok('the loop records every change and every command', /proof\.edited\(/.test(mode) && /proof\.ran\(/.test(mode));
  ok('the loop asks it before finishing', /HCCodeVerify\.stopCheck\(/.test(mode));
  ok('and asks first whether a change was written into the reply instead of made', /HCCodeVerify\.unmadeChange\(proof, messages, finalText, madeBack\)/.test(mode));
  ok('only while proving is switched on in Settings, which it is unless turned off',
    /cdrPrefs\(\)\.prove !== false \? window\.HCCodeVerify\.stopCheck\(/.test(mode) && /proveEl\.checked = prefs\.prove !== false/.test(mode));
  const settings = src('core', 'settings', 'panel.html');
  ok('and the switch it reads is in Settings', /id="cdrSetProve"/.test(settings));
  ok('a note from the app is not shown as the person\'s message', /isAppNote\(/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/verify.js)`);
process.exit(fail ? 1 : 0);
