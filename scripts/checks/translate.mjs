// ==============================================================
// Reading commands answered by the app — checks
//
// Loads the real src/js/code/translate.js and holds which commands a model
// writes are answered by the app's own tool in place of a program (listing,
// reading, searching, finding, where it is, which programs are here), that
// one flag it does not know leaves the command to run as it was, that the
// Windows-only names are translated only on Windows, and where it is wired.
// Every path and pattern here is invented.
//
// Run with: npm run check:translate
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');
const box = { console };
box.window = box;
vm.createContext(box);
for (const f of [['js', 'code', 'host-tools.js'], ['js', 'code', 'translate.js']]) vm.runInContext(src(...f), box, { filename: f[f.length - 1] });
const T = box.HCCodeTranslate;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);
const mac = { os: 'macos', here: '/p' }, win = { os: 'windows', here: 'C:\\p' };
const as = (cmd, args, o = mac) => { const r = T.toTool(cmd, args, o); return r ? (r.answer != null ? { answer: r.answer } : { tool: r.tool, arguments: r.arguments }) : null; };
const is = (label, got, want) => ok(label, json(got) === json(want), json(got));

console.log('\nListing a folder:');
is('ls, plain or with its usual flags, is list_dir', as('ls', ['-la', 'src']), { tool: 'list_dir', arguments: { path: 'src' } });
is('...and with no folder, the one it runs in', as('ls', []), { tool: 'list_dir', arguments: { path: '.' } });
is('Get-ChildItem and gci, with -Path or one folder', as('Get-ChildItem', ['-Path', 'src', '-Force']), { tool: 'list_dir', arguments: { path: 'src' } });
is('dir on Windows', as('dir', ['src'], win), { tool: 'list_dir', arguments: { path: 'src' } });
ok('...but not elsewhere, where dir is not that program', as('dir', ['src'], mac) === null);
ok('a listing of every folder below is not a listing of one', as('ls', ['-R']) === null && as('dir', ['/s'], win) === null && as('gci', ['-Recurse']) === null);

console.log('\nReading a file:');
is('cat one file is read_file', as('cat', ['src/a.js']), { tool: 'read_file', arguments: { path: 'src/a.js' } });
is('Get-Content and gc, with -TotalCount, -Head or -First N, read its first N lines', as('Get-Content', ['-Path', 'a.js', '-TotalCount', '20']), { tool: 'read_file', arguments: { path: 'a.js', start_line: 1, end_line: 20 } });
is('head -n N, head -N and plain head (ten lines)', [as('head', ['-n', '5', 'a.js']), as('head', ['-5', 'a.js']), as('head', ['a.js'])], [{ tool: 'read_file', arguments: { path: 'a.js', start_line: 1, end_line: 5 } }, { tool: 'read_file', arguments: { path: 'a.js', start_line: 1, end_line: 5 } }, { tool: 'read_file', arguments: { path: 'a.js', start_line: 1, end_line: 10 } }]);
is('type one file on Windows', as('type', ['src\\a.js'], win), { tool: 'read_file', arguments: { path: 'src\\a.js' } });
ok('...type is left alone elsewhere, where it names a command', as('type', ['ls'], mac) === null);
ok('two files, numbered lines or the end of a file are left to the command', as('cat', ['a.js', 'b.js']) === null && as('cat', ['-n', 'a.js']) === null && as('Get-Content', ['a.js', '-Tail', '5']) === null && as('tail', ['-n', '5', 'a.js']) === null);

console.log('\nSearching inside files:');
is('grep -rn, with its usual flags and --include', as('grep', ['-rni', '--include=*.js', 'priceFor', 'src']), { tool: 'grep_code', arguments: { dir: 'src', pattern: 'priceFor', file_ext: 'js' } });
is('rg, with -t or -g for the kind of file', as('rg', ['-n', '-t', 'py', 'def main']), { tool: 'grep_code', arguments: { dir: '.', pattern: 'def main', file_ext: 'py' } });
is('findstr /s /n on Windows, with the files named by kind', as('findstr', ['/s', '/n', '/i', 'priceFor', 'src\\*.js'], win), { tool: 'grep_code', arguments: { dir: 'src', pattern: 'priceFor', file_ext: 'js' } });
is('Select-String -Path ... -Pattern', as('Select-String', ['-Path', 'src\\*.ts', '-Pattern', 'export'], win), { tool: 'grep_code', arguments: { dir: 'src', pattern: 'export', file_ext: 'ts' } });
ok('a grep of one file, or one asking only for names or counts, is left to the command', as('grep', ['-n', 'x', 'a.js']) === null && as('grep', ['-rl', 'x', '.']) === null && as('grep', ['-rc', 'x', '.']) === null);

console.log('\nFinding files by name:');
is('find . -name, with -type f', as('find', ['.', '-type', 'f', '-name', '*.test.js']), { tool: 'fuzzy_find', arguments: { dir: '.', query: '.test.js' } });
is('Get-ChildItem -Recurse -Filter', as('Get-ChildItem', ['-Path', 'src', '-Recurse', '-Filter', 'bundle*']), { tool: 'fuzzy_find', arguments: { dir: 'src', query: 'bundle' } });
is('where /r on Windows', as('where', ['/r', 'src', 'bundle.js'], win), { tool: 'fuzzy_find', arguments: { dir: 'src', query: 'bundle.js' } });
ok('a find that does anything else is left to the command', as('find', ['.', '-name', '*.js', '-delete']) === null && as('find', ['.', '-mtime', '-1']) === null && as('find', ['.', '-name', '*']) === null);

console.log('\nWhere it is, and which programs are here:');
is('pwd, Get-Location, and cd alone answer with the folder it runs in', [as('pwd', []), as('Get-Location', []), as('cd', [])], [{ answer: 'The folder commands run in: /p' }, { answer: 'The folder commands run in: /p' }, { answer: 'The folder commands run in: /p' }]);
is('which, where and Get-Command answer from the programs the app found, nothing run', [as('which', ['node'], { ...mac, programs: ['node', 'git'] }), as('Get-Command', ['rg'], { ...win, programs: ['node'] })], [{ answer: 'node is installed here (the app looked where a command would; nothing was run).' }, { answer: 'rg is not installed here (the app looked where a command would; nothing was run).' }]);
ok('...but not for a program the app does not look for, or before it knows', as('which', ['ffmpeg'], { ...mac, programs: ['node'] }) === null && as('which', ['node'], { ...mac, programs: null }) === null);

console.log('\nWritten in one string, and what it is told:');
is('a command written whole in the command, quotes kept together', as('grep -rn "price for" src', []), { tool: 'grep_code', arguments: { dir: 'src', pattern: 'price for' } });
ok('a pipe, a redirect or a second command is never translated', as('ls src | head', []) === null && as('cat a.js > b.js', []) === null && as('ls; rm x', []) === null);
const said = T.said({ tool: 'grep_code', arguments: {} });
ok('the answer says the app gave it, with no program started, and which tool to call next time', /^Answered by the app's own search \(grep_code\), with no program started; call grep_code directly next time\./.test(said) && /case-insensitive/.test(said) && T.isAnswer(said + 'x') && !T.isAnswer('{"code":0}'), said);

console.log('\nWhere it is wired:');
const loop = src('js', 'agent-loop.js');
ok('a shell call the app can answer runs its own tool instead, through the same tool and its guard, with the place read from where the command runs', /const asTool = call\.name === 'shell_run' && !early && window\.HCCodeTranslate \? window\.HCCodeTranslate\.toTool\(/.test(loop) && /find\(t => t\.name === \(asTool\?\.tool \|\| call\.name\)\)/.test(loop) && /window\.HCCodePaths\.argsFromRoot\(asTool\.arguments, /.test(loop));
ok('...and is never recorded as a command that ran', /else if \(call\.name === 'shell_run' && !asTool\)/.test(loop) && /HCCodeTranslate\?\.isAnswer/.test(src('js', 'code', 'rewind.js')) && /if \(!r \|\| typeof r\.code !== 'number'\) continue;/.test(src('js', 'run-ledger.js')));
const boot = src('boot.js');
ok('it is loaded after the programs it answers from, before the loop', boot.indexOf("'/js/code/translate.js'") > boot.indexOf("'/js/code/host-tools.js'") && boot.indexOf("'/js/code/translate.js'") < boot.indexOf("'/modes/boot.js'"));
ok('it is part of npm run check, and of the checks run on Windows', /npm run check:translate\b/.test(readFileSync(join(root, 'package.json'), 'utf8')) && /"check:windows": "[^"]*check:translate/.test(readFileSync(join(root, 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/translate.js)`);
process.exit(fail ? 1 : 0);
