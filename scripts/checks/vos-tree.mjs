// ==============================================================
// Virtual OS file tree — checks
//
// Loads the REAL src/js/vos/tree.js. The Virtual OS looks like a filesystem
// and is not one — its files live in the browser's own storage — which is what
// makes it safe to let a model write into it, and also why these rules are the
// whole of its safety: there is no operating system underneath to refuse
// anything.
//
// The cases worth pinning are the ones that do not produce a wrong answer but
// a stuck window: a folder that has become its own ancestor, a path that walks
// into itself. Both are called on every save and every redraw.
//
// Run with: npm run check:vos-tree
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'vos', 'tree.js'), 'utf8'), sandbox, { filename: 'tree.js' });
const T = sandbox.window.HCVosTree;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const file = (id, name, parentId = 'root', extra = {}) => ({ id, name, parentId, type: 'file', ...extra });
const folder = (id, name, parentId = 'root', extra = {}) => ({ id, name, parentId, type: 'folder', ...extra });

console.log('\nA name becomes something that can be stored anywhere:');
{
  ok('an ordinary name is left alone', T.safeName('main.js') === 'main.js');
  ok('characters no filesystem accepts are replaced',
    T.safeName('a/b:c*d?e"f<g>h|i') === 'a-b-c-d-e-f-g-h-i');
  ok('runs of spaces become one', T.safeName('my    file.txt') === 'my file.txt');
  ok('and the ends are trimmed', T.safeName('  spaced.txt  ') === 'spaced.txt');
  // A model asked for a file name occasionally answers with a sentence.
  ok('a name of six hundred characters is cut down', T.safeName('x'.repeat(600)).length === 120);
  ok('nothing usable still gets a name',
    T.safeName('') === 'untitled' && T.safeName('///') === '-' && T.safeName(null) === 'untitled');
}

console.log('\nA path cannot point out of the project:');
{
  ok('an ordinary path is kept', T.normalizePath('src/app/main.js') === 'src/app/main.js');
  ok('a leading slash is dropped', T.normalizePath('/src/main.js') === 'src/main.js');
  ok('backslashes are read as separators', T.normalizePath('src\\app\\main.js') === 'src/app/main.js');
  // Dropped rather than resolved: there is no "up" from a project root, and a
  // model writing one is guessing at a layout it cannot see.
  ok('a step upwards is dropped, not followed',
    T.normalizePath('../../etc/passwd') === 'etc/passwd');
  ok('and so is one in the middle', T.normalizePath('src/../../../secret') === 'src/secret');
  ok('a step in place is dropped too', T.normalizePath('./src/./main.js') === 'src/main.js');
  ok('empty segments collapse', T.normalizePath('src//app///main.js') === 'src/app/main.js');
  // A file with no path cannot be shown or downloaded.
  ok('nothing usable still becomes a path',
    T.normalizePath('') === 'index.html' && T.normalizePath('../..') === 'index.html'
    && T.normalizePath(null) === 'index.html');
  ok('every segment is made safe, not only the whole',
    T.normalizePath('src/a:b/c*d.js') === 'src/a-b/c-d.js');
}

console.log('\nWhere each item sits, walked up through its parents:');
{
  const files = [
    folder('f1', 'src'),
    folder('f2', 'app', 'f1'),
    file('a', 'main.js', 'f2'),
    file('b', 'readme.md'),
  ];
  const paths = T.pathsFor(files);
  ok('a nested file knows its whole path', paths.get('a') === 'src/app/main.js');
  ok('a file at the top is just its name', paths.get('b') === 'readme.md');
  ok('a folder has a path too', paths.get('f2') === 'src/app');
  ok('nothing is written onto the items themselves', files.every((f) => f.path === undefined));

  const orphan = [file('x', 'lost.txt', 'nowhere')];
  ok('an item whose parent is missing keeps its own name',
    T.pathsFor(orphan).get('x') === 'lost.txt');
}

console.log('\nA loop does not hang the window, which is what it would do:');
{
  // Called on every save and every redraw. A folder that has somehow become
  // its own ancestor is not a wrong answer here — it is a frozen app.
  const looped = [
    folder('a', 'one', 'b'),
    folder('b', 'two', 'a'),
  ];
  let finished = false;
  let paths = null;
  try { paths = T.pathsFor(looped); finished = true; } catch { finished = true; }
  ok('a folder inside itself still returns an answer', finished);
  ok('and the answer is usable rather than empty',
    !!paths && !!paths.get('a') && !!paths.get('b'), JSON.stringify(paths && [...paths]));

  const long = [];
  for (let i = 0; i < 400; i++) long.push(folder('n' + i, 'd' + i, i ? 'n' + (i - 1) : 'root'));
  ok('and four hundred deep is still answered', T.pathsFor(long).get('n399').split('/').length === 400);
}

console.log('\nEverything under an item goes with it:');
{
  const files = [
    folder('f1', 'src'),
    folder('f2', 'app', 'f1'),
    file('a', 'main.js', 'f2'),
    file('b', 'other.js', 'f1'),
    file('c', 'away.md'),
  ];
  const ids = T.descendantIds(files, 'f1');
  ok('the item itself is included', ids.has('f1'));
  ok('its children are', ids.has('f2') && ids.has('b'));
  // Swept repeatedly rather than walked, so the order items happen to be
  // stored in cannot leave a grandchild behind.
  ok('and its grandchildren, wherever they sit in the list', ids.has('a'));
  ok('but nothing outside it', !ids.has('c'));

  const shuffled = [file('a', 'main.js', 'f2'), folder('f2', 'app', 'f1'), folder('f1', 'src')];
  ok('the order the items are stored in makes no difference',
    T.descendantIds(shuffled, 'f1').has('a'));
  ok('an item with nothing under it is just itself', T.descendantIds(files, 'c').size === 1);
}

console.log('\nA folder may not be dropped inside its own contents:');
{
  const files = [
    folder('f1', 'src'),
    folder('f2', 'app', 'f1'),
    folder('f3', 'deep', 'f2'),
    file('a', 'main.js', 'f2'),
    file('gone', 'bin.txt', 'root', { deletedAt: '2026-01-01' }),
    folder('deleted', 'trash', 'root', { deletedAt: '2026-01-01' }),
  ];
  const at = (id) => files.find((f) => f.id === id);

  ok('a file may go into a folder', T.canMoveToParent(files, at('a'), 'f1'));
  ok('and back to the top', T.canMoveToParent(files, at('a'), 'root'));
  ok('a folder may go into an unrelated folder',
    T.canMoveToParent(files, at('f3'), 'root'));
  // The rule that matters: this makes a loop, and a loop is a project that
  // cannot be drawn, saved or recovered without editing storage by hand.
  ok('a folder may NOT go inside its own child', !T.canMoveToParent(files, at('f1'), 'f2'));
  ok('nor inside its own grandchild', !T.canMoveToParent(files, at('f1'), 'f3'));
  ok('nor inside itself', !T.canMoveToParent(files, at('f1'), 'f1'));
  ok('a deleted item may not be moved', !T.canMoveToParent(files, at('gone'), 'f1'));
  ok('nor may anything move into a deleted folder', !T.canMoveToParent(files, at('a'), 'deleted'));
  ok('a file is not a folder and cannot hold anything', !T.canMoveToParent(files, at('f3'), 'a'));
  ok('a parent that does not exist is refused', !T.canMoveToParent(files, at('a'), 'nowhere'));
  ok('and nothing at all is refused', !T.canMoveToParent(files, null, 'f1'));

  // A list that is ALREADY looped must not hang the check meant to prevent
  // looping — which is the one place this could be reached from.
  const broken = [folder('x', 'one', 'y'), folder('y', 'two', 'x'), file('m', 'f.txt')];
  let answered = false;
  try { T.canMoveToParent(broken, broken[2], 'x'); answered = true; } catch { answered = true; }
  ok('an already-looped project still gets an answer', answered);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/vos/tree.js)\n`);
process.exit(fail === 0 ? 0 : 1);
