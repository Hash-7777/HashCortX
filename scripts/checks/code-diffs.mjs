// ==============================================================
// A change a model wrote as a diff in its reply — checks
//
// Loads the REAL src/js/code/diffs.js, with src/js/fences.js and
// src/js/code/verify.js, and holds that a diff block becomes the patch_file
// calls it describes, one per file with its hunks made together; that a new
// file becomes write_file; that a hunk with nothing to find it by, or that
// changes nothing, is left out; that a file's header after a hunk starts the
// next file while a removed line starting "-- " does not; and that the loop
// reads a diff only from a smaller model, when the request asks for a change
// and none is made.
//
// Run with: npm run check:code-diffs
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'verify.js'), sandbox, { filename: 'verify.js' });
vm.runInContext(src('js', 'code', 'diffs.js'), sandbox, { filename: 'diffs.js' });
const D = sandbox.HCCodeDiffs;
const V = sandbox.HCCodeVerify;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const F = '```';
const reply = (diff, lang = 'diff') => `I fixed the loop.\n\n${F}${lang}\n${diff}\n${F}\n\nRun the tests to check it.`;

console.log('A diff in a reply becomes the call that makes it:');
{
  const one = D.callsOf(reply('--- a/src/range.js\n+++ b/src/range.js\n@@ -2,4 +2,4 @@\n   const out = [];\n-  for (let n = start; n < end; n++) out.push(n);\n+  for (let n = start; n <= end; n++) out.push(n);\n   return out;'));
  ok('one patch_file, for the file the header names, without its b/ side', one.length === 1 && one[0].name === 'patch_file' && one[0].arguments.path === 'src/range.js', JSON.stringify(one));
  ok('what to find is the unchanged and removed lines, what to put the unchanged and added ones', one[0].arguments.search === '  const out = [];\n  for (let n = start; n < end; n++) out.push(n);\n  return out;'
    && one[0].arguments.replace === '  const out = [];\n  for (let n = start; n <= end; n++) out.push(n);\n  return out;');
  const two = D.callsOf(reply('--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-let a = 1;\n+const a = 1;\n@@ -9 +9 @@\n-let b = 2;\n+const b = 2;'));
  ok('the hunks of one file are made together, the rest as edits', two.length === 1 && two[0].arguments.search === 'let a = 1;' && JSON.stringify(two[0].arguments.edits) === '[{"search":"let b = 2;","replace":"const b = 2;"}]');
  const files = D.callsOf(reply('diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-let a = 1;\n+const a = 1;\n--- a/b.sql\n+++ b/b.sql\n@@ -1 +1 @@\n--- old note\n+-- new note'));
  ok('a file\'s header after a hunk starts the next file; a removed line starting "-- " does not', files.length === 2 && files[1].arguments.path === 'b.sql' && files[1].arguments.search === '-- old note' && files[1].arguments.replace === '-- new note', JSON.stringify(files));
  const made = D.callsOf(reply('--- /dev/null\n+++ b/src/util.js\n@@ -0,0 +1,2 @@\n+export const one = 1;\n+export const two = 2;'));
  ok('a file the diff creates is written whole', made.length === 1 && made[0].name === 'write_file' && made[0].arguments.path === 'src/util.js' && made[0].arguments.content === 'export const one = 1;\nexport const two = 2;\n');
  ok('a block that only looks like a diff, with no language, counts', D.callsOf(reply('--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-x\n+y', '')).length === 1);
  const blank = D.callsOf(reply('--- a/a.js\n+++ b/a.js\n@@ -1,3 +1,3 @@\n function f() {\n\n-  return 1;\n+  return 2;\n }'));
  ok('a blank line whose leading space was dropped is still a line of the passage', blank[0] && blank[0].arguments.search === 'function f() {\n\n  return 1;\n}', JSON.stringify(blank));
}

console.log('\nWhat is left out:');
{
  ok('a hunk that only adds, with nothing to find it by', D.callsOf(reply('--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+const z = 1;')).length === 0);
  ok('a hunk that changes nothing', D.callsOf(reply('--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n x = 1;')).length === 0);
  ok('a diff naming no file', D.callsOf(reply('@@ -1 +1 @@\n-a\n+b')).length === 0);
  ok('code that is not a diff', D.callsOf(`Here:\n\n${F}js\nconst a = 1;\nconst b = 2;\n${F}`).length === 0);
  ok('a reply with no diff gives no turn', D.turnOf('All done.') === null);
}

console.log('\nThe turn it makes:');
{
  const t = D.turnOf(reply('--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-let a = 1;\n+const a = 1;'));
  ok('each call has an id of its own', t && /^diff_\d+_0$/.test(t.calls[0].id));
  ok('the words stay, the diff goes', t && t.said === 'I fixed the loop.\n\nRun the tests to check it.', JSON.stringify(t && t.said));
}

console.log('\nWhen the loop reads one:');
{
  const log = V.proofLog();
  const asked = [{ role: 'user', content: 'npm test fails. Fix the code so the tests pass.' }];
  const diff = reply('--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-let a = 1;\n+const a = 1;');
  ok('a request for a change, nothing changed, a reply with code: it is read', !!V.unmadeChange(log, asked, diff, 0, 1));
  ok('not for a question', !V.unmadeChange(V.proofLog(), [{ role: 'user', content: 'What does a.js do? Do not change any files.' }], diff, 0, 1));
  const changed = V.proofLog(); changed.edited('/p/a.js');
  ok('not once the run has changed a file', !V.unmadeChange(changed, asked, diff, 0, 1));
  const mode = src('modes', 'code', 'mode.js');
  ok('the loop reads it for a smaller model only, when no call was made and light mode read nothing',
    /const dif = !lit && sharedState\.size !== 'full' && !turn\.tool_calls\?\.length && window\.HCCodeVerify\.unmadeChange\(proof, messages, turn\.content \|\| '', 0, 1\) \? window\.HCCodeDiffs\.turnOf\(turn\.content\) : null;/.test(mode));
  ok('its calls take the place of the reply, as light mode\'s do, before they are kept or run', /if \(lit\?\.calls\.length \|\| dif\) turn = \{ \.\.\.turn, content: \(lit \|\| dif\)\.said, tool_calls: \(lit \|\| dif\)\.calls \};/.test(mode)
    && mode.indexOf('const dif = !lit') < mode.indexOf('H.appendAssistantToolCallTurn(messages, turn.content, turn.tool_calls); // always append'));
  ok('it loads before the Coder', src('boot.js').indexOf("'/js/code/diffs.js'") > 0);
  ok('this check is part of npm run check', /npm run check:code-diffs\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/diffs.js)`);
process.exit(fail ? 1 : 0);
