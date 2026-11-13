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
  ok('git_status, git_diff, git_log and git_commit are tools', ['git_status', 'git_diff', 'git_log', 'git_commit'].every((n) => !!def(n)));
  ok('...each taking exactly the arguments of the table, none required', ['git_status', 'git_diff', 'git_log'].every((n) => def(n) && json(Object.keys(def(n).function.parameters.properties).filter((k) => k !== 'reason')) === json(G.ARGS[n]) && def(n).function.parameters.required.length === 0), ['git_status', 'git_diff', 'git_log'].map((n) => def(n) && json(Object.keys(def(n).function.parameters.properties))).join(' '));
  ok('...each said to be read only, and used rather than shell_run git', ['git_status', 'git_diff'].every((n) => /Read only/.test(def(n)?.function.description || '') && /rather than shell_run git/.test(def(n)?.function.description || '')));
  const names = (size) => code.toolsFor(size, list, '').map((t) => t.function.name).filter((n) => /^git_/.test(n)).sort().join();
  ok('a small model is offered none: the app does it for it', names('small') === '');
  ok('a mid-sized model: status, diff and commit', names('mid') === 'git_commit,git_diff,git_status', names('mid'));
  ok('a larger model: all four', names('full') === 'git_commit,git_diff,git_log,git_status', names('full'));
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

console.log('\nA commit, checked from the run\'s own record before anything runs:');
{
  for (const f of [['js', 'diff.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
  const D = sandbox.HCDiff, S = sandbox.HCSecretShapes;
  const repo = { isRepo: true, branch: 'cart', hooks: ['pre-commit'], style: { prefix: 'word-colon', titleMax: 60 } };
  const changes = () => new Map([
    ['src/cart.js', { before: 'const total = 0;\n', after: 'const total = 0;\nconst pence = 100;\n', unreadable: false }],
    ['src/new.js', { before: null, after: 'export const x = 1;\n', unreadable: false }],
    ['src/same.js', { before: 'a\n', after: 'a\n', unreadable: false }],
  ]);
  const deps = (more = {}) => ({ changes: changes(), repo, diff: D.diffLines, isSecret: S.isSecretFile, looksLikeKey: S.looksLikeKey, ...more });
  const plan = G.commitPlan({ title: 'fix(cart): keep the total in pence', body: 'Totals were rounded.' }, deps());
  ok('by default, every file this run changed, and none it left as it was', !plan.error && json(plan.files.map((f) => [f.path, f.state, f.plus, f.minus])) === json([['src/cart.js', 'changed', 1, 0], ['src/new.js', 'new', 1, 0]]), plan.error || json(plan.files));
  ok('the lines git runs: add those files, then commit those files only, title and body as given', json(plan.add) === json(['add', '--', 'src/cart.js', 'src/new.js']) && json(plan.commit) === json(['commit', '-m', 'fix(cart): keep the total in pence', '-m', 'Totals were rounded.', '--', 'src/cart.js', 'src/new.js']));
  ok('...with nothing added to the message: two -m, the title and the body, and nothing else before the files', plan.commit.filter((a) => a === '-m').length === 2 && plan.commit.indexOf('--') === 5);
  ok('the question shows the whole commit: the line, title, body, branch, each file with its counts, the hooks, and that nothing else staged is in it', /^git commit -- src\/cart\.js src\/new\.js\n\nfix\(cart\): keep the total in pence\n\nTotals were rounded\.$/.test(plan.shown) && /on branch cart/.test(plan.reason) && /src\/cart\.js \(\+1 -0\)/.test(plan.reason) && /src\/new\.js \(new, \+1 -0\)/.test(plan.reason) && /own hooks will run: pre-commit/.test(plan.reason) && /Nothing else you have staged is in it/.test(plan.reason), plan.reason);
  const named = G.commitPlan({ title: 'fix: one file', paths: ['src/cart.js', 'README.md'] }, deps());
  ok('a file the run did not change, named in paths, is said by name in the question', json(named.notRun) === '["README.md"]' && /Not changed by this run, committed as they are now: README\.md/.test(named.reason));
  const refusals = [
    [{}, 'title is missing'],
    [{ title: 'fix: a\nb' }, 'more than one line'],
    [{ title: `fix: ${'x'.repeat(70)}` }, 'characters, and this repository'],
    [{ title: 'Keep the total in pence' }, 'start with a word and a colon'],
    [{ title: 'fix: x', paths: ['--amend'] }, 'none starting with "-"'],
    [{ title: 'fix: x', amend: true }, 'does not take amend'],
    [{ title: 'fix: x', paths: ['.env'] }, 'usually holds keys'],
  ];
  for (const [call, why] of refusals) { const r = G.commitPlan(call, deps()); ok(`refused: ${json(call).slice(0, 60)}`, !!r.error && r.error.includes(why) && /^git_commit was not run: /.test(r.error), r.error || 'not refused'); }
  const keyed = deps(); keyed.changes.set('src/pay.js', { before: '', after: `const k = "${'s' + 'k_live_'}${'4eC39HqLyjWDarjtT1zdp7dc'}";\n`, unreadable: false });
  const k = G.commitPlan({ title: 'fix: pay' }, keyed);
  ok('a key-shaped value on a line the run added refuses it, naming the file and line', !!k.error && /src\/pay\.js, line 1, looks like a key/.test(k.error), k.error || json(k));
  const marked = deps(); marked.changes.set('src/m.js', { before: 'a\n', after: '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n', unreadable: false });
  ok('a file still holding where two changes met refuses it', /git leaves where two changes met/.test(G.commitPlan({ title: 'fix: m' }, marked).error || ''));
  ok('nothing changed by the run, and no paths: nothing to commit', /has changed no file yet/.test(G.commitPlan({ title: 'fix: x' }, { ...deps(), changes: new Map() }).error || ''));
  const plainRepo = { isRepo: true, branch: 'main', style: { prefix: 'none', titleMax: 40 } };
  ok('a repository whose titles are sentences takes one', !G.commitPlan({ title: 'Keep the total in pence' }, { ...deps(), repo: plainRepo }).error);
  ok('what git said is read for why a commit was not made: signing, a hook, nothing to commit', G.commitFailure({ code: 1, stderr: 'error: gpg failed to sign the data' }).kind === 'signing' && /never made unsigned/.test(G.commitFailure({ stderr: 'error: gpg failed to sign the data' }).words) && G.commitFailure({ stderr: 'husky - pre-commit hook exited with code 1' }).kind === 'hook' && G.commitFailure({ stdout: 'nothing to commit, working tree clean' }).kind === 'nothing');
  ok('the commit\'s short id is read from what git said', G.commitId('[cart 1a2b3c4] fix: keep the total in pence\n 1 file changed') === '1a2b3c4' && G.commitId('[main (root-commit) 9f8e7d6] first') === '9f8e7d6' && G.commitId('nothing') === null);
}

console.log('\nThe commit tool: asked every time, then only those files, with the network closed:');
{
  const D = sandbox.HCDiff;
  const asked = [], ran = [];
  let answer = true, said = { add: { code: 0, stdout: '' }, commit: { code: 0, stdout: '[cart 1a2b3c4] fix: keep the total in pence\n' } };
  sandbox.HC.guard = { projectRoot: () => ROOT, request: async (action, target, reason, detail) => { asked.push({ action, target, reason, detail }); return answer; } };
  sandbox.HC.invoke = async (cmd, a) => { ran.push({ cmd, ...a }); return a.args[0] === 'add' ? said.add : said.commit; };
  code.whyNo = () => 'The person said no.';
  const changes = new Map([['src/cart.js', { before: 'a\n', after: 'a\nb\n', unreadable: false }]]);
  code.runChanges = () => changes;
  code.runRepo = () => ({ isRepo: true, branch: 'cart', style: { prefix: 'word-colon', titleMax: 60 } });
  const tool = code.TOOL_DEFINITIONS.find((t) => t.name === 'git_commit');
  const out = tool ? JSON.parse(await tool.fn({ title: 'fix: keep b' })) : {};
  ok('the person is asked once, as a commit, with the whole commit shown', asked.length === 1 && asked[0].action === 'shell' && asked[0].detail.commit === true && /^git commit -- src\/cart\.js\n\nfix: keep b\n\(in \/work\/harbour-shop\)$/.test(asked[0].target), json(asked));
  ok('then the file is added and committed, in the project, with the network closed', json(ran.map((r) => [r.cmd, r.args, r.cwd, r.offline])) === json([['shell_run', ['add', '--', 'src/cart.js'], ROOT, true], ['shell_run', ['commit', '-m', 'fix: keep b', '--', 'src/cart.js'], ROOT, true]]), json(ran));
  ok('the answer says the commit, its branch and its files', out.committed === '1a2b3c4' && out.branch === 'cart' && json(out.files) === '["src/cart.js"]', json(out));
  ok('...and a next commit counts from it', changes.get('src/cart.js').before === 'a\nb\n');
  changes.set('src/cart.js', { before: 'a\nb\n', after: 'a\nb\nc\n', unreadable: false });
  answer = false; ran.length = 0; let no = '';
  try { await tool.fn({ title: 'fix: keep c' }); } catch (e) { no = String(e.message); }
  ok('a no runs nothing', ran.length === 0 && /^Permission denied: the commit was not made/.test(no), no);
  answer = true; said = { add: { code: 0 }, commit: { code: 1, stderr: 'error: gpg failed to sign the data\nfatal: failed to write commit object' } };
  let unsigned = '';
  try { await tool.fn({ title: 'fix: keep c' }); } catch (e) { unsigned = String(e.message); }
  ok('a commit that cannot be signed is not made, says so, and is never made unsigned instead', /could not sign it/.test(unsigned) && !ran.some((r) => r.args.includes('--no-gpg-sign')) && changes.get('src/cart.js').before === 'a\nb\n', unsigned);
  const guard = src('platform', 'tauri', 'guard.js');
  ok('the guard asks about a commit every time, never for the session, never in Auto', /const once = !!out \|\| !!\(detail && \(detail\.install \|\| detail\.destroys \|\| detail\.commit\)\);/.test(guard));
  const loop = src('js', 'agent-loop.js');
  ok('the loop hands it the run\'s own record of what changed, and the repository', /HC\.code\.runChanges = \(\) => changes;/.test(loop) && /HC\.code\.runRepo = \(\) =>/.test(loop));
  void D;
}

console.log('\nThe git tools are offered only to a conversation that asks for git work:');
{
  const list = code.toolList();
  const conv = (...texts) => [{ role: 'system', content: 'x' }, ...texts.map((t) => ({ role: 'user', content: t }))];
  const names = (size, c) => code.toolsFor(size, list, '', c).map((t) => t.function.name).filter((n) => /^git_/.test(n)).sort().join();
  ok('a request to make a page is offered none, at any size', ['small', 'mid', 'full'].every((s) => names(s, conv('Make a simple landing page for a bakery on the desktop')) === ''));
  ok('a request about the repository is offered them', names('full', conv('Commit the fix with a good message')) === 'git_commit,git_diff,git_log,git_status' && names('mid', conv('What changed since the last commit?')) === 'git_commit,git_diff,git_status');
  ok('...and once asked in a conversation, they stay offered', names('full', conv('Look at the git log', 'Now make the button blue')) === 'git_commit,git_diff,git_log,git_status');
  ok('a note the app added is not the person asking', names('full', [{ role: 'system', content: 'x' }, { role: 'user', content: 'Make a page' }, { role: 'user', content: 'commit it', note: true }]) === '');
  ok('words that only look like it are not: a pushed button, a branch of a tree in a story', !G.asked(conv('When the button is pushed, show a tree with a branch')) && G.asked(conv('push this to the repo')));
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder hands its conversation to the choice', /const own = HC\.code\.toolsFor\(sharedState\.size, buildTools\(\), conversationMsgs\.some\(\(m\) => m\.site\), conversationMsgs\)/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/git.js)`);
process.exit(fail ? 1 : 0);
