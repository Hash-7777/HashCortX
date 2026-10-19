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
  ok('and stands for the step it was', V.noteStep(back.message) === back.step);

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
  ok('nor one that found no script to run', log.ran('npm', ['test'], { code: 1, stderr: 'npm error Missing script: "test"' }) === null
    && log.ran('pnpm', ['test'], { code: 1, stderr: 'ERR_PNPM_NO_SCRIPT  Missing script: test' }) === null
    && log.ran('yarn', ['test'], { code: 1, stderr: 'error Command "test" not found.' }) === null && log.checks.length === 1);
  ok('nor one whose program is not there', log.ran('pytest', [], { code: 127, stderr: 'zsh: command not found: pytest' }) === null && log.checks.length === 1);
  ok('... in the words of each shell, Windows\' included', log.ran('pytest', [], { code: 1, stderr: 'bash: pytest: command not found' }) === null
    && log.ran('jest', [], { code: 1, stderr: "'jest' is not recognized as an internal or external command,\noperable program or batch file." }) === null
    && log.ran('npm', ['test'], { code: 9009, stderr: '' }) === null && log.checks.length === 1);
  ok('while a test whose own output says so is a test that failed', log.ran('npm', ['test'], { code: 1, stdout: 'not ok 2 - says "command not found" for an unknown flag', stderr: '  expected: command not found' }) !== null && log.checks.length === 2);

  const told = V.stopCheck((() => { const l = V.proofLog(); l.edited('/p/stats.py'); return l; })(), { test: 'python3 -m unittest' }, 'Done.');
  ok('told to run the tests, it is given the call that runs them', /Run `python3 -m unittest` now with shell_run: command "python3", args \["-m","unittest"\]/.test(told?.message || ''), told?.message);
  const refail = (() => { const l = V.proofLog(); l.edited('/p/range.js'); l.ran('npm', ['test'], { code: 1 }); return V.stopCheck(l, { test: 'npm test' }, 'Done.'); })();
  ok('... and after a failure, to make the fix rather than describe it', /run it again with shell_run: command "npm", args \["test"\]; make the fix, do not describe it/.test(refail?.message || ''), refail?.message);
  ok('a command that needs a shell is named, not given as a call', !/shell_run/.test(V.stopCheck((() => { const l = V.proofLog(); l.edited('/p/a.js'); return l; })(), { test: 'npm test -- --grep "a b"' }, 'Done.')?.message || 'shell_run'));

  // A small model told to run the test said it had passed and never ran it: the app runs it.
  ok('the test not yet run comes with the call that runs it, for the app to make', JSON.stringify(told?.run) === JSON.stringify({ command: 'python3', args: ['-m', 'unittest'] }));
  ok('... not after a failure, when the code must change first, nor for a command that needs a shell', refail && !('run' in refail)
    && !('run' in (V.stopCheck((() => { const l = V.proofLog(); l.edited('/p/a.js'); return l; })(), { test: 'npm test -- --grep "a b"' }, 'Done.') || {})));
  ok('a command line as the call\'s arguments, or none when it needs a shell', JSON.stringify(V.runOf('npm test')) === '{"command":"npm","args":["test"]}' && V.runOf('npm test | tee x') === null && V.runOf('') === null);
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder runs it for a small model in place of asking, each command with an id of its own, and does not keep its word that it passed',
    /if \(back\.run && \(sharedState\.size === 'small' \|\| sharedState\.light \|\| back\.kind === 'example' \|\| back\.kind === 'passed' \|\| \(back\.kind === 'prove' && sent\.prove > 1\)\)\) forced = \{ content: '', tool_calls: \(back\.runs \|\| \[back\.run\]\)\.map\(\(run, i\) => \(\{ id: `ran_\$\{Date\.now\(\)\}_\$\{i\}`, name: 'shell_run', arguments: run \}\)\) \};[^\n]*\n\s*else messages\.push\(\{ role: 'assistant', content: finalText \}, \{ role: 'user', content: back\.message, note: true \}\);/.test(mode)
    && /turn = forced \|\| await callWithRouter\(callMessages, tools, temperature, signal, coderModel, thinkEl\); forced = null;/.test(mode));
  ok('...and for any model the second time it is told to run the test and does not, the count taken before', mode.indexOf('sent[back.kind]++;') > 0 && mode.indexOf('sent[back.kind]++;') < mode.indexOf("(back.kind === 'prove' && sent.prove > 1)"));
  ok('... through the same tool, and so the same permission, as any command, and the run says so', /object: forced && back\.kind !== 'passed' \? window\.HCCodeVerify\.RAN_STEP : back\.step/.test(mode) && V.RAN_STEP === 'Ran the tests itself, as the change had not been tested');
}

console.log('\nAn answer saying part of the work is not done, from a model on this computer:');
{
  const ask = [{ role: 'user', content: 'Create index.html and styles.css for a pricing page.' }];
  const note = V.undoneCheck(ask, 'Not done. The styles.css file has not been created yet.');
  ok('sent back once to do it now, or to say why it cannot be', note && note.kind === 'undone' && V.isAppNote(note.message)
    && /your answer says part of the work is not done\. Do it now with the tools: write_file for a file that is not there yet, patch_file for a change to one that is\. Then finish\. If it cannot be done here, say why\./.test(note.message), note?.message);
  ok('as the step it was', V.noteStep(note.message) === 'Sent back to do what it said was not done');
  ok('in the words such a model uses', ['The tests were not fixed.', 'Not yet done: the footer.', 'The menu is not implemented.', 'styles.css has not been written'].every((r) => V.undoneCheck(ask, r) !== null));
  ok('once', V.undoneCheck(ask, 'Not done.', 1) === null);
  ok('not for an answer that says it is done, nor for one that only uses the words', V.undoneCheck(ask, 'Done: both files are created.') === null && V.undoneCheck(ask, 'Created the page; nothing was left out.') === null);
  ok('not for a question, nor a request that says to change nothing', V.undoneCheck([{ role: 'user', content: 'Why is the header not fixed?' }], 'It was not fixed because the build failed.') === null
    && V.undoneCheck([{ role: 'user', content: 'Which migrations were not done? Just answer.' }], 'Two were not done.') === null);
  const log = V.proofLog(); log.edited('/p/index.html');
  const back = (size, prove = true) => V.sendBack(log, ask, 'Not done: styles.css has not been created.', { checks: {}, size, prove, sent: {} });
  ok('on a small or mid-sized model, with proving on, before anything else it would be sent back for', back('small')?.kind === 'undone' && back('mid')?.kind === 'undone');
  ok('not on a larger one, nor with proving off', back('full')?.kind !== 'undone' && back('small', false) === null);
}

console.log('\nAn empty answer:');
{
  const ask = [{ role: 'user', content: 'Rename getUsr to getUser everywhere.' }];
  const log = V.proofLog(); log.edited('/p/src/users.js');
  const empty = (size) => V.sendBack(log, ask, '', { checks: { test: 'npm test' }, size, sent: {} });
  ok('from a model on this computer, after a change nothing proved: checked like any other, the test given to run', empty('small')?.kind === 'prove' && JSON.stringify(empty('small').run) === '{"command":"npm","args":["test"]}' && empty('mid')?.kind === 'prove');
  ok('from a larger model: nothing, as before', empty('full') === null);
}

console.log('\nFiles an answer names that the project does not have:');
{
  const root = '/p/app';
  const named = (t, touched) => JSON.stringify(V.namedPaths(t, root, touched));
  ok('a file named by its place in the project, written out from it', named('The tax is worked out in `src/calculateTax.js`, at 10%.') === '["/p/app/src/calculateTax.js"]');
  ok('each once, a full path inside the project too', named('See src/a.js and src/a.js and /p/app/lib/b.py.') === '["/p/app/src/a.js","/p/app/lib/b.py"]');
  ok('not a bare name, which could be anywhere in the project', named('It is in tax.js and package.json.') === '[]');
  ok('not an address, a path outside the project, or one starting "./" or "../"', named('See https://example.org/docs/a.js, /usr/lib/x.so, ./lib/u.js and ../other/x.js.') === '[]');
  ok('not inside a code block, where a path is read from its own file', named('Done.\n```js\nimport a from "lib/util.js";\n```') === '[]');
  ok('not a file the run changed, deleted or moved', named('Moved src/old.js to src/new.js.', ['/p/app/src/old.js', '/p/app/src/new.js']) === '[]');
  ok('not a number, a unit or a fraction', named('It runs at 1/2.5 speed, 40 km/h.') === '[]');
  ok('nothing with no project open', JSON.stringify(V.namedPaths('src/a.js', '')) === '[]');
  ok(`no more than ${5} looked for`, V.namedPaths(Array.from({ length: 9 }, (_, i) => `src/f${i}.js`).join(' '), root).length === 5);
  const note = V.namedNote(['/p/app/src/calculateTax.js'], root);
  ok('sent back once to find it, told nothing may be made up', note && note.kind === 'named' && V.isAppNote(note.message)
    && /your answer names src\/calculateTax\.js, which the project does not have\. Nothing in an answer may be made up/.test(note.message) && /If it cannot be found, say so\./.test(note.message), note?.message);
  ok('and a saved conversation shows the step it was', V.noteStep(note.message) === 'Sent back to find the files its answer names');
  ok('nothing missing, nothing said', V.namedNote([], root) === null && V.namedNote(null, root) === null);
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder looks for them first when it would finish, once, with proving switched on, and quietly',
    /const namedLook = async \(reply\) => \(cdrPrefs\(\)\.prove === false \|\| sent\.named \? null : window\.HCCodeVerify\.namedNote\(await HC\.code\.notThereOf\(window\.HCCodeVerify\.namedPaths\(reply, sharedState\.projectRoot, proof\?\.changed\)\), sharedState\.projectRoot\)\);/.test(mode)
    && /\(await namedLook\(finalText\)\) \|\| \(cdrPrefs\(\)\.prove === false \? null : window\.HCCodeVerify\.claimNote\(finalText, messages, sent\.claim\) \|\| window\.HCCodeVerify\.saidNote\(finalText, proof, sent\.said\) \|\| window\.HCCodeVerify\.passedNote\(finalText, proof, sharedState\.projectChecks\?\.checks, sent\.passed\)\) \|\| \(await projectLook\(\)\) \|\| [^\n]*?\(await siteLook\(\)\)/.test(mode));
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('each folder is listed without asking, and a path that cannot be is left out, not called missing',
    /const list = await HC\.code\.listQuietly\(path\.slice\(0, cut\)\);/.test(tools) && /if \(\/without asking\/\.test\(String\(e\?\.message \|\| e\)\)\) continue;/.test(tools));
}

console.log('\nA change written into the reply instead of made:');
{
  const fence = (lang, n) => '```' + lang + '\n' + Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n```';
  const asked = (text) => [{ role: 'system', content: 's' }, { role: 'user', content: text }];
  const reply = `Here is the fix:\n\n${fence('js', 4)}\n\nThis includes the end.`;
  let log = V.proofLog();
  const back = V.unmadeChange(log, asked('Fix the off-by-one in range.js'), reply);
  ok('a change asked for, code in the reply, no file changed: sent back to make it', back && back.kind === 'make' && /no file in the project was changed/.test(back.message) && V.isAppNote(back.message));
  ok('it says what it was sent back for', back && /make the change/.test(back.step) && V.noteStep(back.message) === back.step);
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
  ok('a picture the agent opened is not the request', V.requestIn([...notes, { role: 'user', content: 'This is shot.png, the image you opened.', images: ['x'], opened: true }]) === 'Add a --lines flag');
  ok('a request the person sent with a picture is', V.requestIn([...notes, { role: 'user', content: 'Match this screenshot', images: ['x'] }]) === 'Match this screenshot');
}

console.log('\nThe work checked against the request:');
{
  const request = 'In src/limits.js raise MAX_USERS to 100, MAX_UPLOAD_MB to 25 and TIMEOUT_SECONDS to 60.';
  const log = V.proofLog();
  ok('nothing changed: not sent back', V.reviewCheck(log, request, 'Done.') === null);
  log.edited('/p/src/limits.js');
  const back = V.reviewCheck(log, request, 'I raised MAX_USERS to 100.');
  ok('a file changed: sent back once to check each thing the request asks for', back && back.kind === 'review' && V.isAppNote(back.message) && /each thing it asks for/.test(back.message));
  ok('with the request quoted, since it may be far back', back && back.message.includes(request));
  ok('and told to change nothing more when everything is done', back && /If everything is done, change nothing more/.test(back.message));
  ok('it stands for its own step', back && V.noteStep(back.message) === back.step && /check the work against the request/.test(back.step));
  ok('once at most', V.reviewCheck(log, request, 'Done.', 1) === null);
  ok('not when the reply asks the person something', V.reviewCheck(log, request, 'Should the timeout be 60 or 90?') === null);
  ok('not without a request to quote', V.reviewCheck(log, '  ', 'Done.') === null);
  const long = V.reviewCheck(log, 'x'.repeat(5000), 'Done.');
  ok('a long request is quoted in part', long && long.message.length < 1800 && long.message.includes('x'.repeat(1200) + '…'));
  ok('the other notes keep their own steps', V.noteStep(`${V.APP_NOTE} you changed a.js and no test has run since.`) === 'Sent back to run the tests before finishing'
    && V.noteStep(`${V.APP_NOTE} your reply shows code, but no file in the project was changed.`) === 'Sent back to make the change in the files');
}

console.log('\nWhat sends it back, in order:');
{
  const request = [{ role: 'system', content: 's' }, { role: 'user', content: 'Raise MAX_USERS to 100 and add a TIMEOUT of 60.\n\n[Attached by the person: notes.md.]\n\nlong notes' }];
  const checks = { test: 'npm test' };
  const code = '```js\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```';
  let log = V.proofLog();
  ok('a change written into the reply comes first', V.sendBack(log, request, code, { checks, size: 'mid' })?.kind === 'make');
  ok('an empty reply, or no record, sends nothing back', V.sendBack(log, request, '  ', { checks }) === null && V.sendBack(null, request, 'Done.', { checks }) === null);
  log.edited('/p/src/limits.js');
  ok('then a change nothing proved', V.sendBack(log, request, 'Done.', { checks, size: 'mid' })?.kind === 'prove');
  log.ran('npm', ['test'], { code: 0 });
  const review = V.sendBack(log, request, 'Done.', { checks, size: 'mid', shown: (t) => t.split('\n\n[Attached')[0] });
  ok('then, on a mid-sized model, the work checked against the request as the person sees it', review?.kind === 'review' && review.message.includes('add a TIMEOUT of 60') && !review.message.includes('long notes'));
  ok('on a small one too', V.sendBack(log, request, 'Done.', { checks, size: 'small' })?.kind === 'review');
  ok('not on a larger model or a cloud one', V.sendBack(log, request, 'Done.', { checks, size: 'full' }) === null && V.sendBack(log, request, 'Done.', { checks }) === null);
  ok('each only as often as it allows', V.sendBack(log, request, 'Done.', { checks, size: 'mid', sent: { review: 1 } }) === null);
  log.edited('/p/src/limits.js');
  ok('with proving switched off, only a change not made sends it back', V.sendBack(log, request, 'Done.', { checks, size: 'mid', prove: false }) === null
    && V.sendBack(V.proofLog(), request, code, { checks, size: 'mid', prove: false })?.kind === 'make');
}

console.log('\nA change asked for and not begun, on a model on this computer under 15B:');
{
  const asked = (text) => [{ role: 'system', content: 's' }, { role: 'user', content: text }];
  const words = 'The loop stops one short of the end. To fix it, the condition should include the end.';
  const log = V.proofLog();
  const back = V.sendBack(log, asked('npm test fails in this project. Fix the code so the tests pass. Do not change the tests.'), words, { size: 'mid' });
  ok('a reply of words alone, nothing changed: sent back once to make it with the tools', back?.kind === 'make' && /request asks for a change/.test(back.message) && /grep_code/.test(back.message)
    && V.noteStep(back.message) === back.step);
  ok('... and told to ask the person only for what the files and tests cannot tell', back && /Ask the person only for what the files and the tests cannot tell you/.test(back.message));
  ok('on a small model too', V.sendBack(log, asked('Rename getUsr to getUser everywhere.'), 'Please double-check the name.', { size: 'small' })?.kind === 'make');
  ok('not on a larger or cloud model, where a reply of words is left as it is', V.sendBack(log, asked('Fix the loop.'), words, { size: 'full' }) === null && V.sendBack(log, asked('Fix the loop.'), words) === null);
  ok('not when the request says to leave the files alone', V.sendBack(log, asked('Which file works out the tax? Just answer; do not change any files.'), 'tax.js, at 14%.', { size: 'mid' }) === null
    && V.sendBack(log, asked('Explain how to fix the loop without changing anything.'), words, { size: 'mid' }) === null);
  ok('not for a question with no change in it', V.sendBack(log, asked('Where is the tax worked out?'), 'In tax.js.', { size: 'mid' }) === null);
  const early = V.sendBack(log, asked('npm test fails. Fix the code so the tests pass.'), 'Could you provide the error message you see when you run npm test?', { size: 'mid' });
  ok('a question to the person is sent back too, once: the files and the tests can tell it most things', early?.kind === 'make' && /Ask the person only/.test(early.message));
  ok('... on a larger model a question is left as it is', V.sendBack(log, asked('npm test fails. Fix the code.'), 'Could you provide the error message?', { size: 'full' }) === null);
  ok('once, shared with a change written into the reply', V.sendBack(log, asked('Fix the loop.'), words, { size: 'mid', sent: { make: 1 } }) === null);
  const edited = V.proofLog();
  edited.edited('/p/src/range.js');
  ok('not once a file has changed', V.sendBack(edited, asked('Fix the loop.'), words, { size: 'mid', prove: false }) === null);
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
  {
    const site = V.proofLog();
    site.edited('/p/index.html'); site.edited('/p/style.css');
    ok('a site changed and never read says nothing, as before', V.proofLine(site) === '');
    site.siteRead(0);
    ok('a site read after the last change says so, and that it was not seen on screen', V.proofLine(site) === 'Read as a browser would: nothing found to fix. Not seen on screen.', V.proofLine(site));
    site.siteRead(2);
    ok('...and what is still found, from the last reading', V.proofLine(site) === 'Read as a browser would: 2 things still found to fix. Not seen on screen.');
    site.edited('/p/style.css');
    ok('a reading before the last change is not said', V.proofLine(site) === '');
    site.edited('/p/app.js'); site.siteRead(0);
    ok('with a script changed and no test run, the reading takes the place of "no test ran"', V.proofLine(site) === 'Read as a browser would: nothing found to fix. Not seen on screen.');
    site.ran('npm', ['test'], { code: 0 }); site.siteRead(1);
    ok('...and follows a test that passed', /^Checked after the last change: `npm test` passed\. Read as a browser would: 1 thing still found to fix\. Not seen on screen\.$/.test(V.proofLine(site)), V.proofLine(site));
  }
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
  ok('the loop asks it before finishing, with the project\'s checks, the switch in Settings, the model\'s size and the request as the person sees it',
    /window\.HCCodeVerify\.sendBack\(proof, messages, finalText,\s*\{ checks: sharedState\.projectChecks\?\.checks, prove: cdrPrefs\(\)\.prove !== false, size: sharedState\.size, sent, shown: window\.HCCodeAttach\?\.shownRequest, plan: HC\?\.code\?\.plan, asks: HC\?\.code\?\.asks, light: !!sharedState\.light \}\)/.test(mode)
    && /sent\[back\.kind\]\+\+;/.test(mode) && /const sent = \{ make: 0, plan: 0, prove: 0, review: 0, asks: 0, fresh: 0, site: 0, named: 0, undone: 0, facts: 0, light: 0, rename: 0, wiring: 0, example: 0, stall: 0, gone: 0, claim: 0, said: 0, passed: 0, cut: 0, ahead: 0 \};/.test(mode));
  ok('the switch is on unless turned off', /proveEl\.checked = prefs\.prove !== false/.test(mode));
  const settings = src('core', 'settings', 'panel.html');
  ok('and the switch it reads is in Settings', /id="cdrSetProve"/.test(settings));
  ok('a note from the app is not shown as the person\'s message', /isAppNote\(/.test(mode));
  const render = mode.slice(mode.indexOf('function renderConversation()'), mode.indexOf('// ── Terminal'));
  ok('a saved conversation is drawn with its steps, and each note as the step it stands for',
    /appendToolBlock\(reply, fn\.name/.test(render) && /V\.noteStep\(m\.content\)/.test(render));
  ok('... and a reply the agent was sent back from is not drawn as an answer', /!V\?\.isAppNote\(conversationMsgs\[i \+ 1\]\?\.content\)/.test(render));
  ok('what was proven is kept with the answer and said again when the conversation is opened, as Settings promises',
    /sharedState\.proven = proven \|\| '';/.test(mode) && /content: finalText, \.\.\.\(sharedState\.proven \? \{ proven: sharedState\.proven \} : \{\}\)/.test(mode)
    && /if \(m\.proven\) appendTextToBubble\(reply, `\*\$\{m\.proven\}\*`\);/.test(render) && /What was checked is said under each answer either way/.test(settings));
}

console.log('\nA name the request changes, still there:');
{
  const r = V.renameOf('Rename the function getUsr to getUser everywhere in this project, including where it is called and tested.');
  ok('a rename is read, everywhere', r && r.from === 'getUsr' && r.to === 'getUser' && r.file === '');
  const w = V.renameOf('In src/greet.js change the greeting word from "Hello" to "Hi" in both functions.');
  ok('a quoted word changed to another is read, in the file the request names', w && w.from === 'Hello' && w.to === 'Hi' && w.file === 'src/greet.js');
  ok('a request that changes nothing by name reads as none', V.renameOf('Fix the bug in the basket total.') === null && V.renameOf('Rename it to something better.') === null);
  const files = V.filesOfWhole('Intro\n\n=== src/users.js ===\nfunction getUser(id) {}\n\n=== src/report.js ===\nconst u = users.getUsr(1);\n// getUsrs is another name\n\n=== src/greet.js ===\nreturn `Hello, ${name}`;\n\n=== not text, not shown: a.png ===');
  ok('the project is read back into its files', files.map((f) => f.path).join() === 'src/users.js,src/report.js,src/greet.js');
  const left = V.leftovers(r, files);
  ok('every place the old name is still written, by file and line, as a word on its own', left.length === 1 && left[0].path === 'src/report.js' && left[0].lines.join() === '1');
  ok('only in the named file, when the request names one', V.leftovers(w, files).map((f) => f.path).join() === 'src/greet.js' && V.leftovers({ ...w, file: 'src/other.js' }, files).length === 0);
  const note = V.renameNote(r, left);
  ok('the note names each place, and is a step of its own', note.kind === 'rename' && /"getUsr" is still written here:\n- src\/report\.js: line 1/.test(note.message) && V.isAppNote(note.message) && V.noteStep(note.message) === V.RENAME_STEP);
  ok('nothing left, no note', V.renameNote(r, []) === null);
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  ok('HashCoder looks before it finishes, each twice at most, with Prove changes on', /const projectLook = async \(\) => \{ const V = window\.HCCodeVerify, W = window\.HCCodeWiring, root = sharedState\.projectRoot, r = sent\.rename < 2 && V\.renameOf\(V\.requestIn\(messages\)\), wire = sent\.wiring < 2 && W && proof\?\.changed\.length; if \(!root \|\| cdrPrefs\(\)\.prove === false/.test(mode) && /rename: 0, wiring: 0, example: 0, stall: 0, gone: 0, claim: 0, said: 0, passed: 0, cut: 0, ahead: 0 \};/.test(mode));
}

console.log('\nThe example the request gives, run:');
{
  const req = 'bin/count.js prints how many words a file has: node bin/count.js notes.txt. Add a --lines option, used as node bin/count.js --lines notes.txt, that prints how many lines.';
  ok('the first example running a file the run changed, as a command and its arguments', JSON.stringify(V.exampleOf(req, ['bin/count.js'])) === JSON.stringify({ command: 'node', args: ['bin/count.js', 'notes.txt'] }));
  ok('nothing when the run did not change that file', V.exampleOf(req, ['src/other.js']) === null && V.exampleOf('Fix the tests.', ['bin/count.js']) === null);
  ok('python, and a path written from the folder', JSON.stringify(V.exampleOf('Try `python3 ./tool.py --dry-run in.csv` after.', ['tool.py'])) === JSON.stringify({ command: 'python3', args: ['tool.py', '--dry-run', 'in.csv'] }));
  ok('every example running a file the run changed, each once: the old use and the new one', JSON.stringify(V.examplesOf(req, ['bin/count.js'])) === JSON.stringify([{ command: 'node', args: ['bin/count.js', 'notes.txt'] }, { command: 'node', args: ['bin/count.js', '--lines', 'notes.txt'] }]));
  ok('...the same command twice is run once, three at most, and none is none', V.examplesOf('Run node a.js x.txt, then node a.js x.txt again, node a.js -v, node a.js -q, node a.js -z.', ['a.js']).length === 3 && V.examplesOf('Run node a.js x.txt and node a.js x.txt.', ['a.js']).length === 1 && V.examplesOf('Fix it.', ['a.js']).length === 0);
  const both = V.exampleNote(V.examplesOf(req, ['bin/count.js']));
  ok('a note for several runs them all, in order, and names each', both.runs.length === 2 && both.run === both.runs[0] && /`node bin\/count\.js notes\.txt`[^`]*, and `node bin\/count\.js --lines notes\.txt`/.test(both.message) && /what each prints/.test(both.message) && V.exampleNote([]) === null);
  const n = V.exampleNote({ command: 'node', args: ['bin/count.js', '--lines', 'notes.txt'] });
  ok('the note carries the command to run, says what to look for, and is a step of its own', n.kind === 'example' && n.run.command === 'node' && /`node bin\/count\.js --lines notes\.txt`/.test(n.message) && V.noteStep(n.message) === V.EXAMPLE_STEP && V.exampleNote(null) === null);
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  ok('HashCoder runs it once, and once more after a later change, with Prove changes on, for any model', /\(\(!sent\.example \|\| \(sent\.example < 2 && proof\?\.examplesStale\)\) && proof && cdrPrefs\(\)\.prove !== false && window\.HCCodeVerify\.exampleNote\(window\.HCCodeVerify\.examplesOf\(/.test(mode) && /back\.kind === 'example' \|\| back\.kind === 'passed' \|\| \(back\.kind === 'prove' && sent\.prove > 1\)\)\) forced/.test(mode) && /sent\[back\.kind\]\+\+; if \(back\.kind === 'example'\) proof\?\.exampled\(\);/.test(mode) && /example: 0, stall: 0, gone: 0, claim: 0, said: 0, passed: 0, cut: 0, ahead: 0 \};/.test(mode));
  ok('a run that stalls after changing code has its test run, or its failure said, once before it stops',
    /if \(!verdict\.continue\) \{ const untested = verdict\.reason === 'stalled' && !sent\.stall\+\+ && cdrPrefs\(\)\.prove !== false && window\.HCCodeVerify\.stopCheck\(proof, sharedState\.projectChecks\?\.checks, '', 0, 1\); if \(!untested\) \{ lastStop = verdict; break; \} stalledIterations = 0; if \(untested\.run\) forced = \{ content: '', tool_calls: \[\{ id: `ran_\$\{Date\.now\(\)\}_0`, name: 'shell_run', arguments: untested\.run \}\] \}; else messages\.push\(\{ role: 'user', content: untested\.message, note: true \}\); \}/.test(mode));
  // What that one check gives, from the real stopCheck: a change never tested is run, a failed test is said, a passed one or no change stops.
  const stallLog = (records) => ({ codeChanged: true, changed: ['src/a.js'], since: () => records });
  const never = V.stopCheck(stallLog([]), { test: 'npm test' }, '', 0, 1);
  const failedLast = V.stopCheck(stallLog([{ kind: 'test', pass: false, command: 'npm test' }]), { test: 'npm test' }, '', 0, 1);
  ok('...a change never tested has its test run, a failing one is said, and a passing one, or no change, stops as before',
    never && never.run && never.run.command === 'npm' && failedLast && !failedLast.run && /failed after your last change/.test(failedLast.message)
    && V.stopCheck(stallLog([{ kind: 'test', pass: true, command: 'npm test' }]), { test: 'npm test' }, '', 0, 1) === null
    && V.stopCheck({ codeChanged: false, changed: [], since: () => [] }, { test: 'npm test' }, '', 0, 1) === null && V.stopCheck(null, { test: 'npm test' }, '', 0, 1) === null);
}

console.log('\nA search the answer says it made, when none ran:');
{
  const said = [
    "I've searched for the bakery and found its page.",
    'I looked it up: the shop opens at nine.',
    'According to their website, the phone number is 020 7946 0999.',
    'According to its social media profiles, it has two branches.',
    'A quick search shows the bakery was founded in 1990.',
    'We checked their website for the colours.',
  ];
  for (const t of said) ok(`"${t.slice(0, 44)}" says it searched`, V.claimsSearch(t));
  const not = ['I updated index.html with the new name.', 'Add a search box that looks up products.', 'The page searches the list as you type.', '```js\n// I searched the array for the id\n```', 'I could not search the web here, so the hours are left out.'];
  for (const t of not) ok(`"${t.slice(0, 44).replace(/\n/g, ' ')}" does not`, !V.claimsSearch(t));
  const asked = [{ role: 'system', content: 's' }, { role: 'user', content: 'look up the bakery' }];
  const searched = [...asked, { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'web_search', arguments: '{"query":"x"}' } }] }, { role: 'tool', tool_call_id: 'a', content: '{}' }];
  const before = [{ role: 'user', content: 'first' }, { role: 'assistant', content: '', tool_calls: [{ id: 'b', name: 'fetch_url', arguments: {} }] }, { role: 'user', content: 'now look it up again' }];
  ok('a search or page read since the request counts, in either shape of call', V.searchedSince(searched) && V.searchedSince([...asked, { role: 'assistant', content: '', tool_calls: [{ name: 'fetch_url', arguments: {} }] }]));
  ok('one before the person\'s latest request does not, nor an app note', !V.searchedSince(before) && !V.searchedSince([...before, { role: 'user', content: 'note', note: true }]));
  const n = V.claimNote(said[0], asked, 0);
  ok('the answer is sent back once, by the app, with what to take out and what to say instead', n && n.kind === 'claim' && V.isAppNote(n.message) && /Take out what you said a search or a site gave/.test(n.message) && /say plainly that you could not look it up/.test(n.message) && V.claimNote(said[0], asked, 1) === null);
  ok('not when a search did run, or the answer claims none', V.claimNote(said[0], searched, 0) === null && V.claimNote('I updated the page.', asked, 0) === null);
  ok('a saved conversation shows the note as its step', V.noteStep(n.message) === 'Sent back: it said it searched, and nothing was searched');
  ok('an answer that still says so is told under it', /^No web search or page read ran in this run/.test(V.claimLine(said[2], asked)) && V.claimLine(said[2], searched) === '' && V.claimLine('Done.', asked) === '');
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder asks it after the files its answer names, with Prove changes on, once, and says what is left under the answer',
    /\(await namedLook\(finalText\)\) \|\| \(cdrPrefs\(\)\.prove === false \? null : window\.HCCodeVerify\.claimNote\(finalText, messages, sent\.claim\) \|\| window\.HCCodeVerify\.saidNote\(finalText, proof, sent\.said\) \|\| window\.HCCodeVerify\.passedNote\(finalText, proof, sharedState\.projectChecks\?\.checks, sent\.passed\)\) \|\| \(await projectLook\(\)\)/.test(mode) && /window\.HCCodeVerify\.claimLine\(finalText, messages\)/.test(mode) && /gone: 0, claim: 0, said: 0, passed: 0, cut: 0, ahead: 0 \};/.test(mode));
}

console.log('\nA change the answer says it made, when none was made:');
{
  const none = { changed: [] };
  const one = { changed: ['/p/index.html'] };
  const says = [
    'Here is the updated HTML, CSS, and JavaScript files:\n```html\n<main>\n<h1>Pharmacy</h1>\n</main>\n```',
    'I have updated the heading in index.html.',
    "I've made the changes you asked for.",
    'The colours have been updated to match the logo.',
    '- Updated the footer with the opening hours.',
    'I have completed all requested fixes and updates to the page.',
  ];
  for (const t of says) ok(`"${t.slice(0, 44).replace(/\n/g, ' ')}", with nothing changed, is a change said and not made`, V.saidChanged(t, none).none, JSON.stringify(V.saidChanged(t, none)));
  const not = [
    'I have not changed anything: the file is already as the request asks.',
    "I didn't update the tests, as the request said not to.",
    'I will update index.html once you confirm the colours.',
    'The page shows the opening hours under the map.',
    '```js\n// I updated the counter here\nlet n = 1;\nn++;\n```',
  ];
  for (const t of not) ok(`"${t.slice(0, 44).replace(/\n/g, ' ')}" is not`, !V.saidChanged(t, none).none, JSON.stringify(V.saidChanged(t, none)));
  ok('a file named as changed that the run did not change is named, each in a list', JSON.stringify(V.saidChanged('I updated `index.html`, `style.css` and `script.js` to add the menu.', { changed: ['/p/index.html', '/p/script.js'] }).files) === '["style.css"]');
  ok('...and as "has been rewritten"', JSON.stringify(V.saidChanged('style.css has been rewritten with the new colours.', one).files) === '["style.css"]');
  ok('a file mentioned, not said to be changed, is not', V.saidChanged('I added a link to style.css in index.html.', one).files.length === 0 && V.saidChanged('index.html links style.css.', none).files.length === 0);
  ok('a site address is not a file', V.saidChanged('Their page at www.orchard.example has been updated by its owner, and I updated index.html.', one).files.length === 0);
  ok('a file changed in a folder is the same file named alone', V.saidChanged('I fixed src/app.js and updated app.js again.', { changed: ['/p/src/app.js'] }).files.length === 0);
  const n = V.saidNote(says[1], none, 0);
  ok('the answer is sent back once, by the app, saying a change is made only by a call that succeeds', n && n.kind === 'said' && V.isAppNote(n.message) && /your answer says files were changed, and this run did not change any file\. /.test(n.message) && /A change is made only by a tool call that succeeds/.test(n.message) && V.saidNote(says[1], none, 1) === null, n && n.message);
  const f = V.saidNote('I updated index.html and style.css.', one, 0);
  ok('...naming the files the run did not change', f && /your answer says style\.css was changed, and this run did not change style\.css\./.test(f.message), f && f.message);
  ok('nothing said, nothing sent', V.saidNote('I updated index.html.', one, 0) === null && V.saidNote('Done.', none, 0) === null && V.saidNote(says[1], null, 0) === null);
  ok('a saved conversation shows the note as its step', V.noteStep(n.message) === V.SAID_STEP);
  const made = V.proofLog(); made.ran('mkdir', ['-p', '/u/Desktop/Plan B'], { code: 0, stdout: '', stderr: '' });
  ok('a folder a command made is a change made: "I created the folder" is not sent back', made.made.length === 1 && V.saidNote('I have created the folder `Plan B` on your Desktop.', made, 0) === null && V.saidLine('I created the folder.', made) === '');
  ok('...and a run asked to make one is not sent back to change a file', V.unmadeChange(made, [{ role: 'user', content: 'create a folder on the desktop called Plan B' }], 'Folder created.', 0, 1, { wordsToo: true }) === null);
  const failedMk = V.proofLog(); failedMk.ran('mkdir', ['/u/x'], { code: 1, stderr: 'File exists' });
  ok('a command that failed made nothing', failedMk.made.length === 0 && V.saidNote('I created the folder.', failedMk, 0) !== null);
  ok('the paths a command makes, moves or removes: flags left out, through cmd and git too',
    JSON.stringify(V.madeBy('mkdir', ['-p', 'site/css'])) === '["site/css"]' && JSON.stringify(V.madeBy('cmd', ['/d', '/c', 'mkdir', 'data'])) === '["data"]'
    && JSON.stringify(V.madeBy('git', ['mv', 'a.js', 'b.js'])) === '["a.js","b.js"]' && V.madeBy('git', ['status']).length === 0
    && V.madeBy('ls', ['-la']).length === 0 && JSON.stringify(V.madeBy('/bin/cp', ['a.txt', '/abs/b.txt'])) === '["a.txt","/abs/b.txt"]');
  ok('a file a command moved, named as changed, is not called unchanged', V.saidChanged('I renamed old.js and moved it: new.js was created.', (() => { const l = V.proofLog(); l.ran('mv', ['old.js', 'new.js'], { code: 0 }); return l; })()).files.length === 0);
  ok('an answer that still says so is told under it, from the record', V.saidLine(says[1], none) === 'No file was changed in this run.' && V.saidLine('I updated index.html and style.css.', one) === 'Not changed in this run: style.css.' && V.saidLine('I updated index.html.', one) === '');
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder asks it after a search said and not made, with Prove changes on, once, and says what is left under the answer',
    /window\.HCCodeVerify\.claimNote\(finalText, messages, sent\.claim\) \|\| window\.HCCodeVerify\.saidNote\(finalText, proof, sent\.said\) \|\|/.test(mode) && /window\.HCCodeVerify\.saidLine\(finalText, proof\)/.test(mode) && /claim: 0, said: 0, passed: 0, cut: 0, ahead: 0 \};/.test(mode));
}

console.log('\nTests an answer says pass, when none passed:');
{
  const passed = { code: 0, stdout: 'ok', stderr: '' };
  const failed = { code: 1, stdout: '', stderr: 'SyntaxError' };
  ok('"the tests are already passing" is a claim', V.claimsPassed('The tests are already passing. No changes are needed to `stats.py`.'));
  ok('...so is "all checks have passed", and a block of output showing a passing run', V.claimsPassed('All checks have passed.') && V.claimsPassed('Fixed.\n\n```\nℹ tests 3\nℹ pass 3\nℹ fail 0\n```') && V.claimsPassed('Done.\n\n```\nRan 4 tests in 0.001s\n\nOK\n```'));
  ok('...and "the test has been run, and it passed"', V.claimsPassed('The `slugify` function was added.\n\nThe test has been run, and it passed.'));
  ok('"run it to make sure the tests pass" is not, nor "the tests still fail", nor a run with failures', !V.claimsPassed('Run `npm test` to make sure the tests pass.') && !V.claimsPassed('The tests still fail on line 3.') && !V.claimsPassed('```\n2 passed, 1 failed\n```'));
  let log = V.proofLog();
  const none = V.passedNote('The tests are already passing.', log, { test: 'python3 -m unittest' });
  ok('none ran: sent back, with the project\'s test as the call the app makes', none && none.kind === 'passed' && JSON.stringify(none.run) === '{"command":"python3","args":["-m","unittest"]}' && /no test ran/.test(none.message));
  ok('...from the app, and standing for its own step', V.isAppNote(none.message) && V.noteStep(none.message) === V.PASSED_STEP);
  ok('...once', V.passedNote('The tests are already passing.', log, { test: 'npm test' }, 1) === null);
  ok('...and the person is told under an answer that still says so', /No test ran in this run/.test(V.passedLine('The tests pass.', log)));
  log = V.proofLog();
  log.edited('/p/src/basket.js');
  log.ran('npm', ['test'], failed);
  const lied = V.passedNote('The tests now pass:\n\n```\nℹ pass 3\nℹ fail 0\n```', log, { test: 'npm test' });
  ok('the last run failed: sent back with it, told never to write output no command printed, nothing run for it', lied && !lied.run && /`npm test` failed/.test(lied.message) && /no command printed/.test(lied.message));
  ok('...and output it shows that no command printed is said so under the answer', /not printed by any command/.test(V.passedLine('The tests now pass:\n\n```\nℹ pass 3\nℹ fail 0\n```', log)));
  log.ran('npm', ['test'], passed);
  ok('a test that passed after the last change: the claim is true, nothing said', V.passedNote('The tests pass.', log, { test: 'npm test' }) === null && V.passedLine('The tests pass.', log) === '');
  log.edited('/p/src/basket.js');
  ok('a change after it: the claim is not proven again', !!V.passedNote('The tests pass.', log, { test: 'npm test' }));
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder asks it before finishing, after a change it said and did not make, with Prove changes on, and runs the test for any model that ran none',
    /window\.HCCodeVerify\.saidNote\(finalText, proof, sent\.said\) \|\| window\.HCCodeVerify\.passedNote\(finalText, proof, sharedState\.projectChecks\?\.checks, sent\.passed\)\)/.test(mode)
    && /back\.kind === 'passed' \|\| \(back\.kind === 'prove'/.test(mode) && /window\.HCCodeVerify\.passedLine\(finalText, proof\)/.test(mode));
}

console.log('\nAsked or said, instead of done:');
{
  const fix = [{ role: 'user', content: 'python3 -m unittest fails in this project. Fix stats.py so the tests pass.' }];
  const asked = V.aheadCheck(fix, 'The median is wrong for even counts.\n\n1. Read it.\n2. Change it.\n\nDo you want me to proceed with these steps?');
  ok('an answer asking leave to go on is sent back to do it, from the app, as its own step', asked && asked.kind === 'ahead' && V.isAppNote(asked.message) && V.noteStep(asked.message) === V.AHEAD_STEP);
  ok('...and so is one that says what it will do next', !!V.aheadCheck(fix, 'The export is missing. I will fix the export statement and run the test again.') && !!V.aheadCheck(fix, 'Found it on line 4. Let me fix that.'));
  ok('twice at most', V.aheadCheck(fix, 'Shall I fix it?', 1) !== null && V.aheadCheck(fix, 'Shall I fix it?', 2) === null);
  ok('not a question the files cannot answer, nor a finished answer', !V.aheadCheck(fix, 'Which of the two formats do you want?') && !V.aheadCheck(fix, 'I fixed median for even counts, and `python3 -m unittest` passed.'));
  ok('not when the request asks for no change', !V.aheadCheck([{ role: 'user', content: 'What does stats.py do? Do not change any files.' }], 'Do you want me to explain mean too?'));
  ok('asked for a small or mid-sized model on this computer only', !!V.sendBack(V.proofLog(), fix, 'I fixed it. Should I also run the tests?', { size: 'mid', sent: { make: 1 } }) && V.sendBack(V.proofLog(), fix, 'Should I also run the tests?', { size: 'full', sent: { make: 1 } }) === null);
}

console.log('\nA step that runs on:');
{
  ok('a smaller model\'s step is held to 4,096 tokens', V.STEP_MOST === 4096);
  const note = V.cutNote();
  ok('one stopped there is told so, from the app, and how to go on in parts', V.isAppNote(note) && /4,096 tokens/.test(note) && /append true/.test(note) && V.noteStep(note) === V.CUT_STEP);
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder asks for the limit for a smaller model, not in light mode, where whole files are written', /most: sharedState\.size !== 'full' && !sharedState\.light \? window\.HCCodeVerify\.STEP_MOST : undefined/.test(mode));
  ok('...and a step stopped there is not kept or run: the model is told, twice at most', /\} if \(turn\.cutOff && !turn\.tool_calls\?\.length && sharedState\.size !== 'full' && !sharedState\.light && sent\.cut\+\+ < 2\) \{ thinkEl\?\.finish\(''\); messages\.push\(\{ role: 'user', content: window\.HCCodeVerify\.cutNote\(\), note: true \}\);[^\n]*continue; \}/.test(mode)
    && mode.indexOf('if (turn.cutOff &&') < mode.indexOf('const lit = sharedState.light'));
  const shape = src('js', 'agent-shape.js');
  const app = src('js', 'app.js');
  ok('the limit reaches the model on this computer, with room made for it in its window', /function routeOnce\(\{[^}]*\bmost\b/.test(shape) && /\.\.\.\(most \? \{ most \} : \{\}\)/.test(shape)
    && /async function agentTurnOllama\(\{[^}]*\bmost\b/.test(app) && /\{ need: need \|\| most \}\);/.test(app));
}

console.log('\nThe examples a request gives for a function:');
{
  const ask = 'Add a function slugify(text) to src/text.js and export it next to capitalize. Examples: "  Hello, World!  " gives "hello-world", and "Node.js 24 is out" gives "node-js-24-is-out".';
  const call = V.callsOf(ask, ['src/text.js']);
  ok('the function is called on each, in the file the run changed', call && call.command === 'node' && call.args[0] === '-e' && call.args[2] === 'src/text.js' && call.args[3] === 'slugify'
    && call.args[4] === '[[["  Hello, World!  "],"hello-world"],[["Node.js 24 is out"],"node-js-24-is-out"]]', JSON.stringify(call && call.args.slice(2)));
  ok('...and is one of the examples the request is checked with', V.examplesOf(ask, ['src/text.js']).length === 1 && /slugify on the request's examples/.test(V.exampleNote(V.examplesOf(ask, ['src/text.js'])).message));
  ok('not when the run did not change the file', V.callsOf(ask, ['src/other.js']) === null);
  const py = V.callsOf('Fix median(values) in stats.py: median([3, 1, 2]) returns 2 and median([4, 1, 3, 2]) returns 2.5.', ['stats.py']);
  ok('a Python function, called with its examples written as calls, lists too', py && py.command === 'python3' && py.args[0] === '-c' && py.args[4] === '[[[[3,1,2]],2],[[[4,1,3,2]],2.5]]', JSON.stringify(py && py.args.slice(2)));
  const log = V.proofLog();
  log.edited('/p/src/text.js');
  log.exampled();
  ok('examples run after the last change are not stale', !log.examplesStale);
  log.edited('/p/src/text.js');
  ok('...and a change after them makes them worth running again', log.examplesStale && !V.proofLog().examplesStale);
  const odd = V.callsOf('Add a function wrap(text) to a.js. "x"); process.exit(1); ("" gives "y".', ['a.js']);
  ok('the code that calls it is the same whatever the request says: what it says reaches it only as arguments', !odd || odd.args[1] === call.args[1]);
  ok('a method called in the request is not taken for the function', V.callsOf('Change a.js so name.trim(x) is used. "a" gives "b".', ['a.js']) === null);
  ok('no examples, nothing to call', V.callsOf('Add a function slugify(text) to src/text.js.', ['src/text.js']) === null);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/verify.js)`);
process.exit(fail ? 1 : 0);
