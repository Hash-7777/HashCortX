// ==============================================================
// HashCoder's git tools — checks
//
// Loads the real src/js/code/git.js, src/js/code/permissions.js and
// src/platform/tauri/hashcoder.js and holds the git tools to their table:
// each call becomes one fixed program and its arguments, anything the table
// does not know is refused with the call written right, every line built is
// one Auto lets through, a diff or log never starts a program a repository
// names for showing changes, each tool runs through the same command path as
// shell_run, and each size of model is offered the tools it can use.
//
// Run with: npm run check:code-git
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

const sandbox = { console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, RegExp };
sandbox.window = sandbox;
sandbox.HC = {};
vm.createContext(sandbox);
for (const f of [['js', 'model-profile.js'], ['js', 'secret-shapes.js'], ['js', 'code', 'permissions.js'], ['js', 'code', 'git.js'], ['platform', 'tauri', 'hashcoder.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
}
const G = sandbox.HCCodeGit || { argv: () => ({}) };
const Perm = sandbox.HCCodePermissions;
const code = sandbox.HC.code;
const ROOT = '/work/harbour-shop';

console.log('Each call becomes one fixed git line:');
{
  ok('git_status: the branch and each file, in the form made for reading', json(G.argv('git_status', {})) === json({ command: 'git', args: ['status', '--porcelain=v1', '-b'] }));
  ok('git_diff: what is not staged', json(G.argv('git_diff', {})) === json({ command: 'git', args: ['diff', '--no-ext-diff', '--no-textconv'] }));
  ok('...what is staged, for one file', json(G.argv('git_diff', { staged: true, path: 'src/cart.js' }).args) === json(['diff', '--no-ext-diff', '--no-textconv', '--staged', '--', 'src/cart.js']));
  ok('...this branch against another', json(G.argv('git_diff', { base: 'origin/main' }).args) === json(['diff', '--no-ext-diff', '--no-textconv', 'origin/main...HEAD']));
  ok('git_log: the latest commits by id and title, a set number unless told', json(G.argv('git_log', {}).args) === json(['log', `-n${G.LOG_FIRST}`, '--format=%h %s', '--no-ext-diff', '--no-textconv']) && G.LOG_FIRST === 15);
  ok('...as many as asked, for one file', json(G.argv('git_log', { n: 5, path: 'src' }).args) === json(['log', '-n5', '--format=%h %s', '--no-ext-diff', '--no-textconv', '--', 'src']));
  ok('a reason given beside the arguments is not an argument', !G.argv('git_status', { reason: 'look first' }).error);
}

console.log('\nAnything else is refused, with the call written right:');
{
  const cases = [
    ['git_status', { args: ['--short'] }, 'it does not take args'],
    ['git_diff', { path: '--output=x' }, 'path must be'],
    ['git_diff', { base: '../../etc' }, 'base must be'],
    ['git_diff', { base: 'main..x' }, 'base must be'],
    ['git_diff', { base: '-c' }, 'base must be'],
    ['git_diff', { staged: 'yes' }, 'staged is true or false'],
    ['git_log', { n: 0 }, 'n is a whole number'],
    ['git_log', { n: 51 }, 'n is a whole number'],
    ['git_log', { n: 'all' }, 'n is a whole number'],
    ['git_log', { path: 'a\nb' }, 'path must be'],
    ['git_push', {}, 'not a git tool here'],
  ];
  for (const [tool, args, why] of cases) {
    const r = G.argv(tool, args);
    ok(`${tool} ${json(args)}`, !!r.error && r.error.includes(why) && (tool === 'git_push' || (/ was not run: /.test(r.error) && /Call it as \{/.test(r.error))) && !r.args, r.error || json(r));
  }
}

console.log('\nEvery line built is one Auto lets through, and none starts a program the repository names:');
{
  const lines = [['git_status', {}], ['git_diff', {}], ['git_diff', { staged: true }], ['git_diff', { base: 'main' }], ['git_diff', { base: 'origin/main', path: 'src/cart.js' }], ['git_log', {}], ['git_log', { n: 3, path: 'src' }]];
  for (const [tool, args] of lines) {
    const r = G.argv(tool, args);
    const v = Perm.shellVerdict({ command: r.command, args: r.args, root: ROOT });
    ok(`${tool} ${json(args)}: free in Auto`, v.auto === true, v.why);
  }
  ok('a diff and a log never show changes through a program the repository names', lines.filter(([t]) => t !== 'git_status').every(([t, a]) => { const x = G.argv(t, a).args; return x.includes('--no-ext-diff') && x.includes('--no-textconv'); }));
}

console.log('\nThe tools, as a model is offered them:');
{
  const list = code.toolList();
  const def = (n) => list.find((t) => t.function.name === n);
  ok('git_status, git_diff and git_log are tools', ['git_status', 'git_diff', 'git_log'].every((n) => !!def(n)));
  ok('...each taking exactly the arguments of the table, none required', ['git_status', 'git_diff', 'git_log'].every((n) => def(n) && json(Object.keys(def(n).function.parameters.properties).filter((k) => k !== 'reason')) === json(G.ARGS[n]) && def(n).function.parameters.required.length === 0), ['git_status', 'git_diff', 'git_log'].map((n) => def(n) && json(Object.keys(def(n).function.parameters.properties))).join(' '));
  ok('...each said to be read only, and used rather than shell_run git', ['git_status', 'git_diff'].every((n) => /Read only/.test(def(n)?.function.description || '') && /rather than shell_run git/.test(def(n)?.function.description || '')));
  const names = (size) => code.toolsFor(size, list, '').map((t) => t.function.name).filter((n) => /^git_/.test(n)).sort().join();
  ok('a small model is offered none: the app does it for it', names('small') === '');
  ok('a mid-sized model: status and diff', names('mid') === 'git_diff,git_status', names('mid'));
  ok('a larger model: all three', names('full') === 'git_diff,git_log,git_status', names('full'));
  ok('the full instructions route to them', /Repository state[^\n]*→ git_status, git_diff, git_log/.test(code.SYSTEM_PROMPT));
}

console.log('\nEach runs as a command, through the guard:');
{
  const ran = [];
  code.shellRun = async (command, args, cwd, reason) => { ran.push({ command, args, cwd, reason }); return { code: 0, stdout: '## cart...origin/cart\n M src/cart.js\n', stderr: '' }; };
  const tool = (n) => code.TOOL_DEFINITIONS.find((t) => t.name === n);
  const out = tool('git_status') ? await tool('git_status').fn({}) : null;
  ok('git_status runs git status through the same command path as shell_run, in the project', json(ran[0] && [ran[0].command, ran[0].args, ran[0].cwd]) === json(['git', ['status', '--porcelain=v1', '-b'], null]) && typeof ran[0].reason === 'string' && ran[0].reason.length > 0, json(ran));
  ok('...and answers with what git said', typeof out === 'string' ? /M src\/cart\.js/.test(out) : /M src\/cart\.js/.test(json(out)), json(out));
  let said = '';
  try { await tool('git_log')?.fn({ n: 999 }); } catch (e) { said = String(e.message); }
  ok('a call the table refuses runs nothing and says why', ran.length === 1 && /git_log was not run: n is a whole number/.test(said), said);
  const boot = src('boot.js');
  ok('git.js is loaded before the Coder', boot.indexOf("'/js/code/git.js'") > 0 && boot.indexOf("'/js/code/git.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('this check is part of npm run check', /npm run check:code-git\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/git.js)`);
process.exit(fail ? 1 : 0);
