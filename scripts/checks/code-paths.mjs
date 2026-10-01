// ==============================================================
// Coder path-display checks
//
// Loads the REAL src/js/code/paths.js into a Node VM.
//
// The Coder shows a file by its name and a project file by its place in the
// project. Both were worked out by splitting on forward slashes, so on Windows
// every one of them showed the whole path. These are display only — the
// question of whether a path is inside the project is settled in Rust.
//
// Run with: npm run check:code-paths
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'code', 'paths.js'), 'utf8'),
  sandbox, { filename: 'paths.js' });
const P = sandbox.window.HCCodePaths;
const modeSrc = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const BS = String.fromCharCode(92);
const win = (...parts) => parts.join(BS);

console.log('A file is shown by its name on every system:');
{
  ok('a Mac or Linux path', P.baseName('/Users/me/work/app/src/main.js') === 'main.js');
  ok('a Windows path', P.baseName(win('C:', 'Users', 'me', 'work', 'app', 'main.js')) === 'main.js');
  ok('a Windows path in the long form Rust can hand back', P.baseName(BS + BS + '?' + BS + win('C:', 'work', 'app.js')) === 'app.js');
  ok('a path mixing both separators', P.baseName('C:/work' + BS + 'src/app.js') === 'app.js');
  ok('a folder with a trailing slash gives the folder', P.baseName('/work/app/') === 'app');
  ok('a folder with a trailing backslash gives the folder', P.baseName(win('C:', 'work', 'app', '')) === 'app');
  ok('a bare name comes back as it is', P.baseName('README.md') === 'README.md');
  ok('nothing gives nothing', P.baseName('') === '' && P.baseName(null) === '' && P.baseName(undefined) === '');

  // Control: splitting on forward slashes alone, as the Coder did.
  const old = (path) => String(path || '').split('/').filter(Boolean).pop() || String(path || '');
  ok('control: forward slashes alone leave the whole Windows path as the name',
    old(win('C:', 'Users', 'me', 'main.js')) === win('C:', 'Users', 'me', 'main.js'));
}

console.log('\nA path written from the project\'s folder is the project\'s:');
{
  const root = '/work/app';
  ok('a path from the folder', P.fromRoot('src/a.js', root) === '/work/app/src/a.js');
  ok('the same with "./" in front, once or twice', P.fromRoot('./src/a.js', root) === '/work/app/src/a.js' && P.fromRoot('././a.js', root) === '/work/app/a.js');
  ok('"." and "./" are the folder itself', P.fromRoot('.', root) === root && P.fromRoot('./', root) === root);
  ok('a root given with a trailing separator', P.fromRoot('a.js', '/work/app/') === '/work/app/a.js');
  ok('a Windows project is written out with its own separator', P.fromRoot('src/a.js', win('C:', 'work', 'app')) === win('C:', 'work', 'app') + BS + 'src/a.js');
  ok('a full path is left as written, inside the project or not', P.fromRoot('/work/app/a.js', root) === '/work/app/a.js' && P.fromRoot('/etc/hosts', root) === '/etc/hosts');
  ok('a Windows full path, and one from the drive\'s top, are left as written', P.fromRoot(win('C:', 'x', 'a.js'), root) === win('C:', 'x', 'a.js') && P.fromRoot(BS + 'x', root) === BS + 'x');
  ok('a path from a home folder is left as written', P.fromRoot('~/.ssh/id_rsa', root) === '~/.ssh/id_rsa');
  ok('a path climbing with ".." is left as written, for the guard to refuse', P.fromRoot('../secret.txt', root) === '../secret.txt' && P.fromRoot('src/../../x', root) === 'src/../../x' && P.fromRoot(win('src', '..', '..', 'x'), root) === win('src', '..', '..', 'x'));
  ok('nothing open, nothing written out', P.fromRoot('src/a.js', '') === 'src/a.js' && P.fromRoot('src/a.js', null) === 'src/a.js');
  ok('an empty path, or one that is not a string, is left alone', P.fromRoot('', root) === '' && P.fromRoot(undefined, root) === undefined && P.fromRoot(7, root) === 7);
  const args = { path: 'src/a.js', search: 'src/b.js', from: './old.js', to: 'new/old.js', dir: '.', cwd: 'sub', content: 'x' };
  const out = P.argsFromRoot(args, root);
  ok('in a tool call, every place is written out: a file, both ends of a move, a folder, where a command runs',
    out.path === '/work/app/src/a.js' && out.from === '/work/app/old.js' && out.to === '/work/app/new/old.js' && out.dir === root && out.cwd === '/work/app/sub');
  ok('and nothing else in it, and the call as given is not changed', out.search === 'src/b.js' && out.content === 'x' && args.path === 'src/a.js');
  ok('a call with nothing to write out comes back as it was', P.argsFromRoot({ path: '/work/app/a.js' }, root).path === '/work/app/a.js' && P.argsFromRoot(null, root) === null);
  const writesOut = /for \(const c of turn\.tool_calls\) if \(!window\.HCMcp\?\.systemOf\?\.\(c\.name\)\) c\.arguments = window\.HCCodePaths\.argsFromRoot\(c\.arguments, sharedState\.projectRoot\);[^\n]*\n\s*H\.appendAssistantToolCallTurn\(messages, turn\.content, turn\.tool_calls\);/g;
  ok('HashCoder writes out its own tools\' places before they are kept or run, in both places tools run, and never a connected system\'s',
    (modeSrc.match(writesOut) || []).length === 2 && (modeSrc.match(/H\.appendAssistantToolCallTurn\(/g) || []).length === 2);
}

console.log('\nA project file is shown by its place in the project:');
{
  ok('inside a Mac project', P.relativeFromRoot('/work/app/src/a.js', '/work/app') === 'src/a.js');
  ok('inside a Windows project', P.relativeFromRoot(win('C:', 'work', 'app', 'src', 'a.js'), win('C:', 'work', 'app')) === win('src', 'a.js'));
  ok('a root given with a trailing separator', P.relativeFromRoot('/work/app/src/a.js', '/work/app/') === 'src/a.js');
  ok('a Windows root with a trailing backslash', P.relativeFromRoot(win('C:', 'work', 'app', 'a.js'), win('C:', 'work', 'app', '')) === 'a.js');
  ok('the path keeps its own separators', P.relativeFromRoot(win('C:', 'w', 'a', 'b.js'), 'C:/w') === win('a', 'b.js'));
  ok('a path outside the project is shown whole', P.relativeFromRoot('/elsewhere/x.js', '/work/app') === '/elsewhere/x.js');
  ok('a folder that only starts with the same letters is outside', P.relativeFromRoot('/work/application/x.js', '/work/app') === '/work/application/x.js');
  ok('with no project open the path is shown whole', P.relativeFromRoot('/work/a.js', '') === '/work/a.js');
  ok('nothing gives nothing', P.relativeFromRoot(null, '/work') === '');
}

console.log('\nThe Coder does not split paths by hand any more:');
{
  // Every name in the Coder goes through the helper, so the next place that
  // shows a name gets both separators without anyone having to remember.
  // The one split left guesses a Unix home folder for the agent's
  // instructions and is Unix-only by design.
  const handSplits = (modeSrc.match(/split\(['"]\/['"]\)/g) || []).length;
  ok('only the Unix home-folder guess still splits on forward slashes', handSplits === 1);
  ok('and that one is the home-folder guess', /parts = root\.split\('\/'\)\.filter\(Boolean\);\s*\n\s*if \(parts\[0\] === 'Users'/.test(modeSrc));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/paths.js)`);
process.exit(fail ? 1 : 0);
