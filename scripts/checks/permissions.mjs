// ==============================================================
// How much HashCoder may do without asking — checks
//
// Loads the REAL src/js/code/permissions.js and holds, from both sides, what
// Auto may let through and what it may not. The first side is short and is
// there so Auto is of use: reading and searching inside the project, git's
// read-only commands, the project's own checks. The second is long, on purpose,
// and is the point of the file: every kind of thing that must still ask, however
// it is spelled — another program, a flag that runs or writes, a place outside
// the project or one that climbs out of it, a file of secrets, an argument
// that is more than a name, a check whose definition was changed in this run.
//
// A change to the list that lets one of the second kind through fails here.
// A change that makes the first kind ask is a smaller failure: it only costs a
// question.
//
// Run with: npm run check:permissions
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, RegExp, Error };
vm.createContext(box);
vm.runInContext(src('js', 'code', 'permissions.js'), box, { filename: 'permissions.js' });
const P = box.window.HCCodePermissions;

const memory = () => { const d = new Map(); return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k), d }; };

const ROOT = '/work/app';
const CHECKS = { test: 'npm test', lint: 'npm run lint', build: 'npm run build' };
const verdict = (command, args = [], extra = {}) => P.shellVerdict({ command, args, cwd: ROOT, root: ROOT, checks: CHECKS, tainted: {}, ...extra });
const auto = (command, args, extra) => verdict(command, args, extra).auto === true;
const asks = (command, args, extra) => verdict(command, args, extra).auto === false;
const line = (c, a = []) => [c, ...a].join(' ');

console.log('The modes:');
{
  ok('three, in the order a person reads them', P.IDS.join() === 'ask,edits,auto' && P.MODES.every((m) => m.label && m.help));
  const s = memory();
  ok('with nothing chosen it is Accept edits, which is how HashCoder always was', P.readMode(s) === 'edits');
  P.writeMode('ask', s);
  ok('Ask is kept and read back', P.readMode(s) === 'ask');
  P.writeMode('edits', s);
  ok('and so is Accept edits', P.readMode(s) === 'edits');
  P.writeMode('ask', s);
  P.writeMode('auto', s);
  ok('Auto is held for the session and written nowhere, so it is never in force by forgetting', P.readMode(s) === 'edits' && s.d.size === 0, JSON.stringify([...s.d]));
  const planted = memory(); planted.setItem(P.KEY, 'auto');
  ok('a stored Auto, however it got there, is not restored', P.readMode(planted) === 'edits');
  ok('a mode that is not one is refused', P.writeMode('yolo', memory()) === false && P.writeMode('', memory()) === false);
  ok('a store that fails changes nothing', P.readMode({ getItem() { throw new Error('x'); } }) === 'edits' && P.writeMode('ask', { setItem() { throw new Error('x'); } }) === false);
  ok('Ask leaves reading free and nothing else', ['read', 'list', 'search'].every((a) => P.freeInProject('ask', a)) && ['write', 'patch', 'delete', 'move', 'shell', 'fetch'].every((a) => !P.freeInProject('ask', a)));
  ok('Accept edits and Auto make an edit free, and still not a deletion, a command or a page', ['edits', 'auto'].every((m) => P.freeInProject(m, 'write') && P.freeInProject(m, 'patch') && ['delete', 'move', 'shell', 'fetch'].every((a) => !P.freeInProject(m, a))));
  ok('an unknown mode is treated as Accept edits', P.freeInProject('nonsense', 'write') === true && P.freeInProject('nonsense', 'shell') === false);
}

console.log('\nWhat Auto lets through:');
{
  const yes = [
    ['ls', ['-la', 'src']], ['ls', []], ['pwd', []], ['cat', ['src/app.js']], ['cat', ['-n', 'README.md']], ['head', ['-n', '20', 'src/a.js']], ['tail', ['-20', 'log.txt']],
    ['wc', ['-l', 'a.js', 'b.js']], ['grep', ['-rn', 'TODO', 'src']], ['grep', ['-n', '-e', 'a|b', 'src/x.js']], ['rg', ['-n', 'needle']], ['rg', ['--files']], ['rg', ['-g', '*.js', 'foo', 'src']],
    ['find', ['.', '-name', '*.js', '-type', 'f']], ['find', ['src', '-maxdepth', '2', '-name', '*.css']], ['tree', ['-L', '2']], ['du', ['-sh', '.']], ['stat', ['package.json']], ['file', ['logo.png']],
    ['diff', ['a.txt', 'b.txt']], ['sort', ['-u', 'words.txt']], ['basename', ['src/app.js']], ['which', ['node']], ['date', []],
    ['git', ['status']], ['git', ['status', '--short', '-b']], ['git', ['diff']], ['git', ['diff', '--stat', 'HEAD']], ['git', ['diff', '--', 'src/app.js']], ['git', ['log', '--oneline', '-n', '5']], ['git', ['log', '-5']],
    ['git', ['show', 'HEAD', '--stat']], ['git', ['branch', '-a']], ['git', ['rev-parse', '--show-toplevel']], ['git', ['ls-files']], ['git', ['blame', '-L', '10,20', 'src/a.js']],
    ['npm', ['test']], ['npm', ['run', 'test']], ['npm', ['test', '--', '--runInBand']], ['npm', ['run', 'lint']], ['npm', ['run', 'build']], ['npm', ['test', '--', '-k', 'parses', 'test/a.test.js']],
    ['node', ['--check', 'src/app.js']], ['python3', ['-m', 'py_compile', 'tool.py']],
  ];
  for (const [c, a] of yes) ok(line(c, a), auto(c, a), verdict(c, a).why);
  const py = { test: 'pytest' };
  ok('pytest, when that is the project\'s test, with a filter and a file', auto('pytest', ['-k', 'parse', 'tests/test_a.py'], { checks: py }) && auto('pytest', ['-x', '-q'], { checks: py }));
  ok('cargo test and go test, when they are the project\'s', auto('cargo', ['test'], { checks: { test: 'cargo test' } }) && auto('go', ['test', './...'], { checks: { test: 'go test ./...' } }) === true);
  ok('make test, when that is the project\'s', auto('make', ['test'], { checks: { test: 'make test' } }));
  ok('a pnpm project\'s own check, written either way', auto('pnpm', ['test'], { checks: { test: 'pnpm test' } }) && auto('pnpm', ['run', 'test'], { checks: { test: 'pnpm test' } }));
  const v = verdict('cat', ['src/app.js']);
  ok('it says what it let through, and the full place it names, for the native side to check', /only reads/.test(v.why) && v.places.join() === `${ROOT}/src/app.js`, JSON.stringify(v));
  ok('a folder inside the project is a place the program may run in', auto('ls', [], { cwd: `${ROOT}/src` }) && auto('ls', [], { cwd: 'src' }));
  ok('a file that is only called env, in an example, is not a secret', auto('cat', ['.env.example']) && auto('cat', ['.env.sample']) && auto('cat', ['config/credentials-helper.js']));
}

console.log('\nWhat must still ask — other programs:');
{
  const programs = ['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'telnet', 'ftp', 'rm', 'rmdir', 'mv', 'cp', 'ln', 'chmod', 'chown', 'touch', 'mkdir', 'tee', 'dd', 'kill', 'killall', 'pkill', 'sudo', 'su', 'doas',
    'docker', 'podman', 'kubectl', 'brew', 'apt', 'apt-get', 'yum', 'pip', 'pip3', 'npx', 'pnpx', 'bunx', 'yarn', 'bash', 'sh', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh', 'eval', 'exec', 'env', 'printenv', 'export', 'set', 'xargs', 'awk', 'sed', 'perl', 'ruby', 'php',
    'open', 'osascript', 'launchctl', 'crontab', 'at', 'tar', 'zip', 'unzip', 'gzip', 'ls;rm', 'ls&&rm', 'ls|sh', '$(ls)', '`ls`', 'node', 'python', 'python3', 'deno', 'bun', 'java', 'go', 'cargo', 'make', 'gh', 'gcloud', 'aws', 'az', 'terraform'];
  for (const p of programs) ok(`${p} asks`, asks(p, ['x']) && asks(p, []));
  ok('a program named by a path asks, whichever path', asks('./evil', []) && asks('/bin/ls', []) && asks('../ls', []) && asks('node_modules/.bin/eslint', []) && asks('C:\\Windows\\System32\\whoami.exe', []));
  ok('a name with a space asks: it is not one program', asks('ls -la', []) && asks('npm test', []) && asks(' ', []) && asks('', []));
  ok('no program at all asks', asks(undefined, []) && asks(null, []));
}

console.log('\nWhat must still ask — git beyond reading:');
{
  const git = [['push'], ['pull'], ['fetch'], ['clone', 'https://x/y'], ['commit', '-m', 'x'], ['add', '.'], ['checkout', '.'], ['checkout', '--', 'a'], ['reset', '--hard'], ['clean', '-fd'], ['restore', '.'], ['stash'], ['stash', 'pop'],
    ['merge', 'x'], ['rebase', 'x'], ['cherry-pick', 'x'], ['remote', 'add', 'o', 'u'], ['remote', '-v'], ['config', 'user.name', 'x'], ['config', '--list'], ['submodule', 'update'], ['worktree', 'add', 'x'], ['apply', 'p.diff'], ['am', 'p'], ['gc'], ['prune'], ['filter-branch'], ['reflog', 'expire'],
    ['-c', 'core.pager=sh', 'status'], ['-C', '/', 'status'], ['--git-dir=/x', 'status'], ['--exec-path=/x', 'status'], ['status', '--exec=x'], ['log', '--output=out.txt'], ['diff', '--output=out.txt'], ['diff', '--ext-diff'], ['log', '--exec-path'], ['branch', '-D', 'x'], ['branch', '-m', 'a', 'b'], ['tag', '-d', 'x'], ['blame', '--contents', '/etc/passwd', 'a']];
  for (const a of git) ok(`git ${a.join(' ')} asks`, asks('git', a));
  ok('git asks outright once something git reads its settings from was changed in this run', asks('git', ['status'], { tainted: { git: true } }) && asks('git', ['log'], { tainted: { git: true } }));
  ok('but still reads, when only a check was changed', auto('git', ['status'], { tainted: { checks: true } }));
  ok('a file outside the project, named to git, asks', asks('git', ['diff', '--', '/etc/hosts']) && asks('git', ['diff', '--', '../x']) && asks('git', ['show', '../../x']) && asks('git', ['log', '--', '~/x']));
}

console.log('\nWhat must still ask — a flag that runs a program or writes a file:');
{
  const flags = [
    ['find', ['.', '-exec', 'rm', '{}', ';']], ['find', ['.', '-execdir', 'sh', '-c', 'x', ';']], ['find', ['.', '-delete']], ['find', ['.', '-ok', 'rm', '{}', ';']], ['find', ['.', '-fprint', 'out']], ['find', ['.', '-fprintf', 'out', 'x']], ['find', ['.', '-fls', 'out']],
    ['find', ['/', '-name', 'x']], ['find', ['..', '-name', 'x']], ['find', ['.', '-name']], ['find', ['.', '-newer', '/etc/passwd']], ['find', ['.', '-regex', '.*']], ['find', ['.', '-printf', 'x']],
    ['rg', ['--pre', 'sh', 'x']], ['rg', ['--pre=sh', 'x']], ['rg', ['--pre-glob=*', 'x']], ['rg', ['--no-config']], ['rg', ['--ignore-file=/etc/x', 'a']], ['rg', ['-z', 'x']], ['rg', ['--search-zip', 'x']],
    ['sort', ['-o', 'out', 'in']], ['sort', ['--output=out', 'in']], ['sort', ['--compress-program=sh', 'in']], ['sort', ['-T', '/tmp', 'in']], ['tree', ['-o', 'out']], ['tree', ['--help']],
    ['grep', ['-f', '/etc/passwd', 'x']], ['grep', ['--exclude-from=/etc/x', 'p', 'a']], ['grep', ['--file=/etc/x', 'p']], ['grep', ['-P', 'x']], ['grep', ['--no-such', 'x']],
    ['ls', ['--hyperlink']], ['ls', ['-X']], ['cat', ['-']], ['cat', ['--help']], ['head', ['-n']], ['head', ['-n', 'x', 'a']], ['head', ['-n', '5;rm']], ['tail', ['-f', 'log']], ['tail', ['-F', 'log']], ['tail', ['--follow', 'log']],
    ['diff', ['--to-file=/etc/x', 'a']], ['du', ['--files0-from=/x']], ['file', ['-m', '/x', 'a']], ['stat', ['--printf=%n', 'a']], ['date', ['-s', 'x']], ['date', ['--set=x']], ['realpath', ['--relative-to=/', 'a']],
    ['node', ['--check']], ['node', ['--check', 'a.js', 'b.js']], ['node', ['-e', 'x']], ['node', ['--eval', 'x']], ['node', ['script.js']], ['node', ['--check', '../x.js']], ['python3', ['-c', 'x']], ['python3', ['-m', 'py_compile']], ['python3', ['-m', 'http.server']], ['python3', ['-m', 'pip', 'install', 'x']],
  ];
  for (const [c, a] of flags) ok(`${line(c, a)} asks`, asks(c, a));
}

console.log('\nWhat must still ask — a place outside the project, or one that climbs out:');
{
  const places = [
    ['cat', ['/etc/passwd']], ['cat', ['~/.ssh/id_rsa']], ['cat', ['~']], ['cat', ['../outside.txt']], ['cat', ['src/../../outside.txt']], ['cat', ['src/..']], ['cat', ['..']], ['ls', ['..']], ['ls', ['/']], ['ls', ['~/Documents']],
    ['ls', ['/work']], ['ls', ['/work/app2']], ['cat', ['/work/app2/secret.txt']], ['cat', ['/work/application/x']], ['cat', ['/work/app/../x']], ['cat', ['/work/app/../../etc/passwd']],
    ['cat', ['C:\\Windows\\win.ini']], ['cat', ['..\\x']], ['cat', ['src\\..\\..\\x']], ['grep', ['-r', 'x', '/']], ['grep', ['-r', 'x', '..']], ['grep', ['-rn', 'x', '/Users']], ['rg', ['x', '/etc']], ['head', ['-n', '1', '/etc/hosts']],
    ['wc', ['-l', '/etc/passwd']], ['diff', ['a', '/etc/passwd']], ['stat', ['/']], ['du', ['-sh', '/']], ['tree', ['/']], ['file', ['/bin/sh']], ['realpath', ['/']], ['sort', ['/etc/passwd']],
  ];
  for (const [c, a] of places) ok(`${line(c, a)} asks`, asks(c, a));
  ok('a place inside the project that merely has a longer name than the project\'s does not count as inside', asks('cat', ['/work/app-backup/x']) && asks('cat', ['/work/app.old/x']));
  ok('a command run from outside the project asks, however harmless', asks('ls', [], { cwd: '/etc' }) && asks('ls', [], { cwd: '..' }) && asks('ls', [], { cwd: '/work' }) && asks('ls', [], { cwd: '~' }) && asks('ls', [], { cwd: `${ROOT}/../x` }));
  ok('no project open, nothing runs without asking', asks('ls', [], { root: '' }) && asks('ls', [], { root: null }));
}

console.log('\nWhat must still ask — a file that holds secrets:');
{
  const files = ['.env', '.env.local', '.env.production', 'config/.env', 'server.pem', 'keys/private.key', 'id_rsa', 'id_ed25519', 'id_rsa.pub.bak', 'cert.p12', 'store.keystore', '.netrc', '.pgpass', '.git-credentials', 'credentials', 'credentials.json', 'config/secrets.json', 'secrets.yml', 'secret.toml', 'vault.kdbx'];
  for (const f of files) ok(`cat ${f} asks`, asks('cat', [f]) && asks('grep', ['x', f]) && asks('head', ['-n', '5', f]));
  ok('but an example of one does not', ['.env.example', '.env.sample', '.env.template', '.env.dist'].every((f) => auto('cat', [f])));
}

console.log('\nWhat must still ask — an argument that is more than a name:');
{
  ok('a newline, a carriage return or a null in an argument', asks('ls', ['a\nrm -rf /']) && asks('ls', ['a\rb']) && asks('cat', ['a\u0000b']));
  ok('an argument that is not text', asks('ls', [{ x: 1 }]) && asks('ls', [null]) && asks('ls', [5]) && asks('ls', 'not an array'));
  ok('a check\'s argument that is an assignment, a separator or an option that loads code', asks('make', ['test', 'CC=evil'], { checks: { test: 'make test' } }) && asks('make', ['test', 'SHELL=/bin/sh'], { checks: { test: 'make test' } })
    && asks('npm', ['test', ';', 'rm']) && asks('npm', ['test', '&&', 'x']) && asks('npm', ['test', '|', 'x']) && asks('npm', ['test', '$(x)']) && asks('npm', ['test', '`x`']) && asks('npm', ['test', 'a b']));
  ok('a check run with an option that loads code or reads another configuration', asks('npm', ['test', '--', '--require', './x.js']) && asks('npm', ['test', '--', '--config=other.json']) && asks('npm', ['test', '--', '-r', 'x']) && asks('npm', ['test', '--', '--import', 'x']) && asks('npm', ['test', '--', '--setupFiles', 'x'])
    && asks('pytest', ['-p', 'evil'], { checks: { test: 'pytest' } }) && asks('pytest', ['-c', 'x.ini'], { checks: { test: 'pytest' } }) && asks('pytest', ['--rootdir', '/'], { checks: { test: 'pytest' } }) && asks('npm', ['test', '--prefix', '/x']) && asks('npm', ['test', '-C', '/x']));
  ok('a filter that is really a flag', asks('pytest', ['-k', '-x'], { checks: { test: 'pytest' } }) && asks('pytest', ['-k'], { checks: { test: 'pytest' } }));
}

console.log('\nWhat must still ask — a check that is not the project\'s, or was changed:');
{
  ok('a script the project does not name for a check', asks('npm', ['run', 'deploy']) && asks('npm', ['run', 'publish']) && asks('npm', ['publish']) && asks('npm', ['run', 'postinstall']) && asks('npm', ['run', 'dev']) && asks('npm', ['run', 'start']) && asks('npm', ['start']) && asks('yarn', ['deploy']));
  ok('an install, of any kind', asks('npm', ['install']) && asks('npm', ['i', 'x']) && asks('npm', ['ci']) && asks('npm', ['add', 'x']) && asks('pnpm', ['install']) && asks('yarn', ['add', 'x']) && asks('pip', ['install', 'x']) && asks('cargo', ['add', 'x']) && asks('go', ['get', 'x']) && asks('bundle', ['install']));
  ok('a project that names no checks has none run without asking', asks('npm', ['test'], { checks: {} }) && asks('npm', ['test'], { checks: null }) && asks('pytest', [], { checks: {} }));
  ok('the check is exactly what the project names: another test runner is not it', asks('pytest', [], { checks: { test: 'npm test' } }) && asks('npm', ['run', 'test:e2e'], { checks: { test: 'npm test' } }) && asks('npm', ['testy'], { checks: { test: 'npm test' } }));
  ok('a check whose definition was changed in this run asks', ['npm', 'make', 'pytest', 'cargo'].every((c) => asks(c, c === 'make' ? ['test'] : ['test'], { checks: { test: `${c} test` }, tainted: { checks: true } })) && asks('npm', ['run', 'lint'], { tainted: { checks: true } }));
  ok('and reading still does not, when only a check was changed', auto('cat', ['a.js'], { tainted: { checks: true } }) && auto('grep', ['-rn', 'x', '.'], { tainted: { checks: true } }));
  ok('a check run from outside the project asks', asks('npm', ['test'], { cwd: '/etc' }) && asks('npm', ['test'], { cwd: '..' }));
}

console.log('\nWhat the run has done decides when Auto stops:');
{
  const r = P.createRun();
  ok('a new run has changed nothing and is not paused', r.paused() === '' && r.tainted.checks === false && r.tainted.git === false);
  for (const f of ['package.json', 'sub/package.json', 'Makefile', 'src/Makefile', 'pyproject.toml', 'setup.py', 'tox.ini', 'conftest.py', 'Cargo.toml', 'build.rs', '.npmrc', '.cargo/config.toml', 'justfile', 'jest.config.js', 'C:\\work\\app\\package.json']) {
    const x = P.createRun(); x.wrote(f);
    ok(`writing ${f} changes how checks run`, x.tainted.checks === true && x.tainted.git === false);
  }
  for (const f of ['.git/config', '.git/hooks/pre-commit', 'sub/.git/config', '.gitattributes', 'a/.gitattributes', '.gitmodules', '.gitconfig', 'C:\\work\\app\\.git\\config']) {
    const x = P.createRun(); x.wrote(f);
    ok(`writing ${f} changes what git reads`, x.tainted.git === true);
  }
  const plain = P.createRun(); for (const f of ['src/app.js', 'README.md', 'package-lock.json', 'docs/package.json.md', 'mypackage.json.bak', 'lib/gitattributes.js', 'src/legit/Makefile.txt']) plain.wrote(f);
  ok('an ordinary file changes neither', plain.tainted.checks === false && plain.tainted.git === false, JSON.stringify(plain.tainted));
  const blocked = P.createRun(); blocked.blocked();
  ok('one protected place asked for is not yet a reason', blocked.paused() === '');
  blocked.blocked();
  ok('two are: the rest of the run asks about everything, and says why', /tried a protected place more than once/.test(blocked.paused()));
  const streak = P.createRun();
  for (let i = 0; i < P.STREAK_BEFORE_ASKING - 1; i++) streak.ran();
  ok('a long streak is let run', streak.paused() === '');
  streak.ran();
  ok('and one more asks, and says how many ran without a question', new RegExp(`${P.STREAK_BEFORE_ASKING} commands have run without asking`).test(streak.paused()));
  streak.answered();
  ok('an answer from the person starts it again', streak.paused() === '' && streak.state.streak === 0);
  ok('a protected place stays remembered when the person answers', blocked.answered() === undefined && /protected place/.test(blocked.paused()));
  const fresh = P.createRun();
  ok('each run starts clean', fresh.paused() === '' && fresh.state.blocks === 0 && fresh.tainted.checks === false);
}

console.log('\nPaths are read as written, and the answer is the same every time:');
{
  const inside = (t, cwd = ROOT, root = ROOT) => P.insideRoot(t, cwd, root);
  ok('a relative path is read from where the command runs', inside('src/a.js') === `${ROOT}/src/a.js` && inside('a.js', `${ROOT}/src`) === `${ROOT}/src/a.js` && inside('.') === ROOT && inside('./src/./a.js') === `${ROOT}/src/a.js`);
  ok('a full path is judged where it is, and only inside is inside', inside(`${ROOT}/x`) === `${ROOT}/x` && inside(ROOT) === ROOT && inside(`${ROOT}/`) === ROOT && inside('/work/app2') === null && inside('/work') === null && inside('/') === null);
  ok('a path that climbs, or begins at a home folder, is not judged: it is refused', inside('..') === null && inside('a/../b') === null && inside('~') === null && inside('~/x') === null && inside('a/..') === null);
  ok('a root written with a trailing slash is the same root', inside('x', `${ROOT}/`, `${ROOT}/`) === `${ROOT}/x`);
  const win = 'C:\\work\\app';
  ok('a Windows project: either slash, and capitals do not matter', inside('src\\a.js', win, win) === 'C:/work/app/src/a.js' && inside('c:/WORK/app/x', win, win) === 'c:/WORK/app/x' && inside('D:\\other', win, win) === null && inside('C:\\work\\app2', win, win) === null && inside('..\\x', win, win) === null);
  ok('empty and odd input is refused', inside('') === null && inside(undefined) === null && inside(null) === null);
  const args = ['-la', 'src'];
  verdict('ls', args);
  ok('what it is given is not changed', args.join() === '-la,src');
  ok('the same command gives the same answer', JSON.stringify(verdict('cat', ['a.js'])) === JSON.stringify(verdict('cat', ['a.js'])));
}

console.log('\nThe decision, with where each place really leads:');
{
  const R2 = '/work/app';
  const decide = (over = {}) => P.autoDecision({ command: 'cat', args: ['src/a.js'], cwd: R2, root: R2, checks: CHECKS, run: P.createRun(), inside: async () => true, blocked: () => false, offline: true, ...over });
  ok('a command that reads, in the project, is let through', (await decide()).auto === true);
  ok('what is asked of the native side is each full place, and the folder it runs in', await (async () => {
    const asked = [];
    await decide({ args: ['src/a.js', 'b.txt'], inside: async (p) => { asked.push(p); return true; } });
    return asked.join() === `${R2},${R2}/src/a.js,${R2}/b.txt`;
  })());
  ok('a place the native side says leads out is not let through, and the reason names it', await (async () => {
    const d = await decide({ inside: async (p) => !p.endsWith('a.js') });
    return d.auto === false && /a\.js does not lead inside the project/.test(d.why);
  })());
  ok('nor is a protected one', (await decide({ blocked: (p) => p.endsWith('a.js') })).auto === false);
  ok('an answer that is not a plain yes is a no', (await decide({ inside: async () => 'yes' })).auto === false && (await decide({ inside: async () => undefined })).auto === false);
  ok('a native side that cannot answer is a no, not a crash', (await decide({ inside: async () => { throw new Error('x'); } })).auto === false);
  ok('a verdict that is already no is passed on, with its reason', await (async () => { const d = await decide({ command: 'curl', args: [] }); return d.auto === false && /not on the list/.test(d.why); })());
  ok('a check is let through where the network can be closed, and says it is one', await (async () => { const d = await decide({ command: 'npm', args: ['test'] }); return d.auto === true && d.tier === 'check'; })());
  ok('and asks where it cannot', await (async () => { const d = await decide({ command: 'npm', args: ['test'], offline: false }); return d.auto === false && /network closed/.test(d.why); })());
  ok('a command that only reads is not a check, and needs no closed network', await (async () => { const d = await decide({ offline: false }); return d.auto === true && d.tier === 'read'; })());
  ok('a run that was told to ask about everything is not asked for a verdict', await (async () => {
    const run = P.createRun(); run.blocked(); run.blocked();
    const d = await decide({ run });
    return d.auto === false && d.paused === true && /protected place more than once/.test(d.why);
  })());
  ok('a run with no record is judged on the command alone', (await decide({ run: null })).auto === true);
  ok('a run that changed what defines the checks asks for a check and not for a read', await (async () => {
    const run = P.createRun(); run.wrote('package.json');
    return (await decide({ run, command: 'npm', args: ['test'] })).auto === false && (await decide({ run })).auto === true;
  })());
  ok('no project open is a no', (await decide({ root: '' })).auto === false);
}

console.log('\nThe menu beside the box:');
{
  const made = [];
  const select = { dataset: {}, value: '', title: '', children: [], getAttribute: (k) => (k === 'aria-label' ? 'What HashCoder may do without asking' : ''), appendChild(o) { this.children.push(o); }, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; } };
  const b = { window: {}, document: { createElement: () => { const o = { value: '', textContent: '' }; made.push(o); return o; } }, JSON, Math, Number, String, Array, Object, Map, Set, RegExp, Error };
  vm.createContext(b);
  vm.runInContext(src('js', 'code', 'permissions.js'), b);
  vm.runInContext(src('js', 'code', 'permission-bar.js'), b);
  const Bar = b.window.HCCodePermissionBar;
  const told = [];
  let mode = 'edits';
  const guard = { mode: () => mode, setMode: (m) => { mode = m; return true; }, notify: (text, kind) => told.push([text, kind]) };
  ok('it mounts on a menu', Bar.mount(select, guard) === true);
  ok('with the three modes, in their words', select.children.map((o) => o.textContent).join() === 'Manual,Accept edits,Auto' && select.children.map((o) => o.value).join() === 'ask,edits,auto');
  ok('showing the one in force, and what it means', select.value === 'edits' && /Accept edits\b|What HashCoder may do without asking: Changes files/.test(select.title), select.title);
  select.value = 'auto'; select.listeners.change();
  ok('choosing one tells the guard and says what it means', mode === 'auto' && /What HashCoder may do without asking: Also runs commands/.test(select.title));
  ok('and Auto says so once more in the notice bar', told.length === 1 && /only read the project or run its own tests/.test(told[0][0]) && told[0][1] === 'info');
  select.value = 'ask'; select.listeners.change();
  ok('the others say nothing more', mode === 'ask' && told.length === 1);
  ok('it mounts once', Bar.mount(select, guard) === false && select.children.length === 3);
  ok('with nothing to mount on, or no guard, it does nothing', Bar.mount(null, guard) === false && Bar.mount({ dataset: {} }, null) === false);
}

console.log('\nWhere it is wired:');
{
  const panel = src('modes', 'code', 'panel.html');
  const css = src('modes', 'code', 'mode.css');
  const mode = src('modes', 'code', 'mode.js');
  const boot = src('boot.js');
  ok('the menu is in the row of buttons beside the box, before Attach', /id="cdrPermMode"[^>]*><\/select>\s*<button type="button" class="cdr-icon-btn" id="cdrAttachBtn"/.test(panel) && /aria-label="What HashCoder may do without asking"/.test(panel));
  ok('it is a menu of its own, quiet until hovered, drawn from the theme\'s colours', /\.cdr-perm \{[^}]*background: transparent; color: var\(--cdr-text-dim\)/.test(css) && /\.cdr-perm:hover \{[^}]*var\(--surface-raised\)/.test(css) && /\.cdr-perm:focus-visible/.test(css));
  ok('the Coder mounts it', /window\.HCCodePermissionBar\?\.mount\(\$\('cdrPermMode'\), HC\.guard\);/.test(mode));
  ok('both modules load before the Coder, the menu after what it reads from', boot.indexOf("'/js/code/permissions.js'") > 0 && boot.indexOf("'/js/code/permissions.js'") < boot.indexOf("'/js/code/permission-bar.js'") && boot.indexOf("'/js/code/permission-bar.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('the guard is loaded before the module it asks, and asks it only when it is needed', boot.indexOf("'/platform/tauri/guard.js'") < boot.indexOf("'/js/code/permissions.js'") && /const modes = \(\) => window\.HCCodePermissions;/.test(src('platform', 'tauri', 'guard.js')));
}

console.log('\nEach guard is what stops its attack (remove it and the attack gets through):');
{
  const original = src('js', 'code', 'permissions.js');
  const without = (find, replace) => {
    if (original.split(find).length !== 2) return null;
    const b = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, RegExp, Error };
    vm.createContext(b);
    vm.runInContext(original.replace(find, replace), b, { filename: 'permissions.mutant.js' });
    return b.window.HCCodePermissions;
  };
  const gets = (M, command, args, extra) => !!M && M.shellVerdict({ command, args, cwd: ROOT, root: ROOT, checks: CHECKS, tainted: {}, ...extra }).auto === true;
  const proofs = [
    ['a word that starts with a dash is never taken for a branch name', "/^[A-Za-z0-9._^~][A-Za-z0-9._^~-]{0,79}$/.test(t);", "/^[A-Za-z0-9._^~-]{1,80}$/.test(t);", 'git', ['log', '--exec-path']],
    ['a path that climbs out is refused', "hasDotDot(t)) return null;", "false) return null;", 'cat', ['../outside.txt']],
    ['a home folder is refused', "!t || t.startsWith('~') ||", "!t ||", 'cat', ['~/notes.txt']],
    ['a file of secrets is refused', "if (SECRET_FILE.test(inside)) return no(", "if (false) return no(", 'cat', ['.env']],
    ['a place outside the project is refused', "if (!inside) return no(", "if (false) return no(", 'cat', ['/etc/passwd']],
    ['a program that is not on the list is refused', "return no(`${name} is not on the list of what runs without asking`);", "judged = { ok: true, places: [] };", 'curl', ['https://example.com']],
    ['a check changed in this run is refused', "if (tainted.checks) return no(", "if (false) return no(", 'npm', ['test'], { tainted: { checks: true } }],
    ['git read after its settings were changed is refused', "if (taintedGit) return", "if (false) return", 'git', ['status'], { tainted: { git: true } }],
    ['an argument that is not plain text is refused', "/[\\u0000\\n\\r]/.test(a)", "false", 'ls', ['a\nrm -rf /']],
    ['a check argument that is an assignment is refused', "/^[\\w./@:+-]{1,200}$/.test(t)", "true", 'make', ['test', 'CC=evil'], { checks: { test: 'make test' } }],
    ['a flag that is not known to be safe is refused', "if (!spec.short.test(t)) return", "if (false) return", 'ls', ['-X']],
  ];
  for (const [label, find, replace, command, args, extra] of proofs) {
    const M = without(find, replace);
    ok(label, M !== null, 'the line this proof removes is not in the module any more');
    if (M) ok(`  without it: ${command} ${args.join(' ')} gets through`, gets(M, command, args, extra) === true);
  }
}

console.log('\nIt is wired to nothing it should not reach:');
{
  const text = src('js', 'code', 'permissions.js');
  ok('it does not touch the page, the network or the disk', !/\bdocument\b|fetch\(|XMLHttpRequest|invoke\(|require\(|import\(/.test(text.replace(/\/\/.*$/gm, '')));
  ok('it is loaded before the panel', src('boot.js').indexOf("'/js/code/permissions.js'") > -1 && src('boot.js').indexOf("'/js/code/permissions.js'") < src('boot.js').indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:permissions/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/permissions.js)`);
process.exit(fail ? 1 : 0);
