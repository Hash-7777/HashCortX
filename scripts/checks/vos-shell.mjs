// ==============================================================
// Virtual OS terminal — checks
//
// Loads the REAL src/js/vos/shell.js. The terminal executes nothing: there is
// no shell underneath it and no process anywhere, which is exactly what makes
// it safe to hand a model a terminal without handing it a machine.
//
// It still has to behave like the thing it imitates, and the places a shell
// goes wrong are all here — splitting a command when some arguments are
// quoted, resolving a path against where you are standing, and finding a name
// in a tree of folders. None of it could be asked anything before.
//
// Run with: npm run check:vos-shell
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'vos', 'shell.js'), 'utf8'), sandbox, { filename: 'shell.js' });
const S = sandbox.window.HCVosShell;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// A small project: src/app/main.js, src/styles.css, readme.md, and a deleted one.
const files = [
  { id: 'f1', name: 'src', parentId: 'root', type: 'folder', path: 'src' },
  { id: 'f2', name: 'app', parentId: 'f1', type: 'folder', path: 'src/app' },
  { id: 'a', name: 'main.js', parentId: 'f2', type: 'file', path: 'src/app/main.js', content: 'const hello = 1;\nconsole.log(hello);\n' },
  { id: 'b', name: 'styles.css', parentId: 'f1', type: 'file', path: 'src/styles.css', content: 'body { margin: 0 }\n' },
  { id: 'c', name: 'readme.md', parentId: 'root', type: 'file', path: 'readme.md', content: '# Hello\n' },
  { id: 'gone', name: 'old.js', parentId: 'root', type: 'file', path: 'old.js', content: 'x', deletedAt: '2026-01-01' },
];

console.log('\nA command is split the way a shell splits one:');
{
  ok('plain words', S.splitArgs('ls src').join('|') === 'ls|src');
  ok('extra spaces do not make extra arguments', S.splitArgs('  ls    src  ').join('|') === 'ls|src');
  // A shell that splits on spaces alone turns every quoted phrase into
  // separate arguments, and the command quietly does something else.
  ok('a double-quoted phrase is one argument',
    S.splitArgs('grep "hello world" src').join('|') === 'grep|hello world|src');
  ok('and a single-quoted one', S.splitArgs("grep 'a b' .").join('|') === "grep|a b|.");
  ok('the quotes themselves are not part of the argument',
    !S.splitArgs('echo "hi"').join('').includes('"'));
  ok('nothing typed is no arguments', S.splitArgs('').length === 0 && S.splitArgs(null).length === 0);
}

console.log('\nA path is resolved from where you are standing:');
{
  ok('a name is relative to here', S.resolvePath('/src', 'app') === '/src/app');
  ok('a leading slash is absolute', S.resolvePath('/src/app', '/readme.md') === '/readme.md');
  ok('nothing means here', S.resolvePath('/src', '') === '/src' && S.resolvePath('/src', '~') === '/src');
  ok('a lone slash is the root', S.resolvePath('/src/app', '/') === '/');
  // Followed here, unlike in a path written into a file: this is what `cd ..`
  // means, and a terminal without it is not one.
  ok('a step up is followed', S.resolvePath('/src/app', '..') === '/src');
  ok('two steps up too', S.resolvePath('/src/app', '../..') === '/');
  ok('and a step in place is ignored', S.resolvePath('/src', './app') === '/src/app');
  ok('a step up then down again lands where it should',
    S.resolvePath('/src/app', '../styles.css') === '/src/styles.css');
  // Climbing past the root simply stops there, so no amount of it reaches
  // anything above the project.
  ok('climbing past the root stops at the root',
    S.resolvePath('/', '../../..') === '/' && S.resolvePath('/src', '../../../../etc') === '/etc');
}

console.log('\nAn item is found by walking down, not by matching a stored path:');
{
  // Walked, so a file and a folder with the same name in different places
  // cannot be mistaken for one another.
  ok('the root is the root', S.findItem(files, '/').type === 'folder');
  ok('a nested file is found', S.findItem(files, '/src/app/main.js')?.id === 'a');
  ok('a folder is found', S.findItem(files, '/src')?.id === 'f1');
  ok('something that is not there is not found', S.findItem(files, '/src/nope.js') === null);
  ok('a path through a file rather than a folder is not found',
    S.findItem(files, '/readme.md/deeper') === null);
  ok('a deleted file is not found', S.findItem(files, '/old.js') === null);
}

console.log('\nListing says what is there:');
{
  const rootList = S.listDir(files, '/');
  ok('the root lists what sits in it', rootList.includes('src/') && rootList.includes('readme.md'));
  ok('a deleted file is not listed', !rootList.includes('old.js'));
  ok('folders are marked as folders', /src\//.test(rootList));
  ok('files carry their size', /readme\.md\s+\[\d+ B\]/.test(rootList), rootList);
  ok('a folder lists its own contents',
    S.listDir(files, '/src').includes('styles.css') && S.listDir(files, '/src').includes('app/'));
  ok('an empty root says so rather than nothing', S.listDir([], '/') === '(empty root — no files yet)');
  ok('an empty folder says so',
    S.listDir([{ id: 'e', name: 'empty', parentId: 'root', type: 'folder', path: 'empty' }], '/empty') === '(empty folder)');
  ok('a file listed on its own is described as one', S.listDir(files, '/readme.md').includes('[file'));
  ok('something not there is an error a person can read',
    S.listDir(files, '/nope').startsWith('Error: not found'));
  ok('sizes are readable at every scale',
    S.fmtBytes(500) === '500 B' && S.fmtBytes(2048) === '2.0 KB' && S.fmtBytes(3 * 1048576) === '3.0 MB');
}

console.log('\nFinding a name matches the way a shell matches:');
{
  ok('anything matches everything', S.findByName(files, '/', '*').split('\n').length === 5);
  ok('a star stands for anything', S.findByName(files, '/', '*.js').includes('/src/app/main.js'));
  ok('and only for what it should', !S.findByName(files, '/', '*.css').includes('main.js'));
  ok('a question mark is one character',
    S.findByName(files, '/', 'main.j?').includes('main.js'));
  // A shell pattern is not a regular expression: searching for app.js must not
  // also match appXjs.
  ok('a dot means a dot, not any character',
    S.findByName(files, '/', 'main.js').includes('main.js')
    && !S.findByName([{ id: 'x', name: 'mainXjs', parentId: 'root', type: 'file', path: 'mainXjs' }], '/', 'main.js').includes('mainXjs'));
  ok('a search inside a folder stays there',
    !S.findByName(files, '/src', '*').includes('readme.md'));
  ok('no matches says so', S.findByName(files, '/', '*.rs') === '(no matches)');
}

console.log('\nSearching inside files says where each line came from:');
{
  const hits = S.grep(files, 'hello', '/');
  ok('a match is found', hits.includes('main.js'));
  ok('with the line number', /main\.js:1:/.test(hits), hits);
  ok('and it ignores case', S.grep(files, 'HELLO', '/').includes('main.js'));
  ok('a search inside a folder stays there', !S.grep(files, 'Hello', '/src').includes('readme.md'));
  ok('nothing found says so', S.grep(files, 'zzzz', '/').startsWith('No matches'));
  // A pattern a person typed goes straight into a regular expression. A
  // terminal that raises an exception at a bad search has crashed.
  ok('a malformed pattern is answered, not thrown',
    S.grep(files, '[unclosed', '/').startsWith('Error: invalid regex'));
  // Every line matching would be more than a terminal can usefully show.
  const many = [{ id: 'm', name: 'big.txt', parentId: 'root', type: 'file', path: 'big.txt', content: 'x\n'.repeat(200) }];
  const capped = S.grep(many, 'x', '/');
  ok('a search matching everything is capped', capped.split('\n').length <= 61);
  ok('and says how much it left out', /more matches/.test(capped));
}

console.log('\nReading a file says when it did not read all of it:');
{
  ok('a whole file comes back', S.readFile(files, '/readme.md') === '# Hello\n');
  ok('an empty file says it is empty',
    S.readFile([{ id: 'e', name: 'e.txt', parentId: 'root', type: 'file', path: 'e.txt', content: '' }], '/e.txt') === '(empty file)');
  ok('a file that is not there is an error', S.readFile(files, '/nope.txt').startsWith('Error: file not found'));
  ok('a line range is numbered from one',
    S.readFile(files, '/src/app/main.js', 2, 2) === '2: console.log(hello);');
  // A model handed a truncated file with no notice will confidently reason
  // about code that is not there.
  const big = [{ id: 'g', name: 'g.txt', parentId: 'root', type: 'file', path: 'g.txt', content: 'y'.repeat(9000) }];
  const cut = S.readFile(big, '/g.txt');
  ok('a long file is cut off', cut.length < 9000);
  ok('and says so, with how much is left', /truncated — 1000 more bytes/.test(cut));
  ok('and how to ask for the rest', /start_line/.test(cut));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/vos/shell.js)\n`);
process.exit(fail === 0 ? 0 : 1);
