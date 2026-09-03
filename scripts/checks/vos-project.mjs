// ==============================================================
// Saved-workspace checks
//
// Loads the REAL src/js/vos/project.js, with the tree and shell beside it, so
// what a repair does can be asked of the same code that lists a folder.
//
// This runs on the workspace read out of the browser's database and again on
// every save, and the result is written straight back over the stored copy.
// There is no undo behind it: a file this drops is gone. So the checks here
// are mostly about what it must NOT throw away.
//
// Run with: npm run check:vos-project
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const f of [['js', 'vos', 'tree.js'], ['js', 'vos', 'shell.js'], ['js', 'vos', 'project.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
}
const { normalizeProject } = sandbox.window.HCVosProject;
const TREE = sandbox.window.HCVosTree;
const SHELL = sandbox.window.HCVosShell;

const ROOT = '__root__';
let idCount = 0;
const opts = {
  rootId: ROOT,
  systemIconIds: ['__system_finder__', '__system_settings__', '__system_trash__'],
  safeName: TREE.safeName,
  nowIso: () => '2026-01-01T00:00:00.000Z',
  newId: (p) => `${p}_made_${++idCount}`,
};
const run = (project) => ({ project, ...normalizeProject(project, opts) });
const withPaths = (files) => {
  const paths = TREE.pathsFor(files, ROOT);
  for (const f of files) f.path = paths.get(f.id);
  return files;
};

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('A file is never dropped for having a bad id:');
{
  // Both of these used to be filtered out on the way to being saved over the
  // stored copy, so the file was gone with nothing said.
  const { project, repairs } = run({
    files: [
      { id: 'a', parentId: ROOT, type: 'file', name: 'kept.txt', content: 'one' },
      { parentId: ROOT, type: 'file', name: 'no-id.txt', content: 'two' },
      { id: 'a', parentId: ROOT, type: 'file', name: 'clash.txt', content: 'three' },
    ],
    systemIconPositions: {},
  });
  ok('all three files are still there', project.files.length === 3);
  ok('the file with no id kept its content',
    project.files.find((f) => f.name === 'no-id.txt')?.content === 'two');
  ok('the file with a clashing id kept its content',
    project.files.find((f) => f.name === 'clash.txt')?.content === 'three');
  ok('every file now has an id', project.files.every((f) => !!f.id));
  ok('and no two share one', new Set(project.files.map((f) => f.id)).size === 3);
  ok('the file that was already fine kept its id', project.files[0].id === 'a');
  ok('both repairs are reported', repairs.length === 2);
  ok('a repair names the file it was about', repairs.some((r) => /no-id\.txt/.test(r)));

  // Control: dropping them is what the filter used to do.
  const dropped = [{ id: 'a' }, {}, { id: 'a' }].filter((item, i, all) =>
    item.id && all.findIndex((x) => x.id === item.id) === i);
  ok('control: filtering on the id loses two of the three', dropped.length === 1);
}

console.log('\nA file whose folder is gone is put back where it can be seen:');
{
  // Not lost, but not findable either: a listing asks which items name this
  // folder as their parent, and nothing names a folder that is not there.
  const orphan = { id: 'f1', parentId: 'folder_that_is_gone', type: 'file', name: 'notes.txt', content: 'secret' };
  const sibling = { id: 'f2', parentId: ROOT, type: 'file', name: 'readme.txt', content: 'hi' };

  const before = withPaths([{ ...orphan }, { ...sibling }]);
  ok('before the repair, listing the top level does not show it',
    !SHELL.listDir(before, '/', ROOT).includes('notes.txt'));
  ok('though its contents can still be read out',
    SHELL.readFile(before, 'notes.txt').includes('secret'));

  const { project, repairs } = run({ files: [{ ...orphan }, { ...sibling }], systemIconPositions: {} });
  ok('the repair puts it at the top level', project.files[0].parentId === ROOT);
  ok('it keeps its contents', project.files[0].content === 'secret');
  ok('and now the listing shows it',
    SHELL.listDir(withPaths(project.files), '/', ROOT).includes('notes.txt'));
  ok('the repair is reported', repairs.some((r) => /notes\.txt/.test(r) && /no longer exists/.test(r)));
  ok('the file that was already fine is not touched', project.files[1].parentId === ROOT);
}

console.log('\nA file in a folder that really is there is left alone:');
{
  const { project, repairs } = run({
    files: [
      { id: 'd1', parentId: ROOT, type: 'folder', name: 'docs' },
      { id: 'f1', parentId: 'd1', type: 'file', name: 'a.txt', content: 'x' },
    ],
    systemIconPositions: {},
  });
  ok('it stays in its folder', project.files[1].parentId === 'd1');
  ok('nothing is reported', repairs.length === 0);
}

console.log('\nItems in the Trash keep what the Trash needs to put them back:');
{
  const { project } = run({
    files: [
      { id: 'd1', parentId: ROOT, type: 'folder', name: 'docs', deletedAt: '2026-01-01', trashRoot: true },
      { id: 'f1', parentId: 'd1', type: 'file', name: 'a.txt', content: 'x', deletedAt: '2026-01-01' },
    ],
    systemIconPositions: {},
  });
  ok('a deleted item keeps when it was deleted', project.files[0].deletedAt === '2026-01-01');
  ok('it remembers the folder to go back to', project.files[0].trashParentId === ROOT);
  ok('it remembers where it came from', !!project.files[0].trashPath);
  ok('the one the person deleted is marked as such', project.files[0].trashRoot === true);
  ok('and the child taken with it is not', project.files[1].trashRoot === false);
  ok('a deleted file inside a deleted folder stays inside it',
    project.files[1].parentId === 'd1');
}

console.log('\nA file that is not deleted carries nothing about the Trash:');
{
  const { project } = run({
    files: [{ id: 'f1', parentId: ROOT, type: 'file', name: 'a.txt', trashParentId: 'x', trashPath: 'y', trashRoot: true }],
    systemIconPositions: {},
  });
  const f = project.files[0];
  ok('the trash parent is cleared', f.trashParentId === undefined);
  ok('the trash path is cleared', f.trashPath === undefined);
  ok('the trash mark is cleared', f.trashRoot === undefined);
}

console.log('\nWhat a record says about itself is not taken on trust:');
{
  const { project } = run({
    files: [
      { id: 'a', parentId: ROOT, type: 'wizard', name: 'odd' },
      { id: 'b', parentId: ROOT, type: 'folder', name: 'f', content: 'folders hold nothing' },
      { id: 'c', parentId: ROOT, type: 'file', name: 'n', content: null },
      { id: 'd', parentId: ROOT, type: 'file' },
      { id: 'e', type: 'file', name: 'noparent.txt' },
    ],
    systemIconPositions: {},
  });
  ok('a type that does not exist becomes a file', project.files[0].type === 'file');
  ok('a folder is not allowed to hold contents', project.files[1].content === '');
  ok('a file with no contents becomes empty, not the word null', project.files[2].content === '');
  ok('a file with no name is given one', !!project.files[3].name);
  ok('a file with no parent goes to the top level', project.files[4].parentId === ROOT);
  ok('every file ends up with a changed-at time', project.files.every((f) => !!f.updatedAt));
}

console.log('\nA project that is not a project does not throw:');
{
  ok('files that are not a list become none', run({ files: 'lots' }).project.files.length === 0);
  ok('holes in the list are removed', run({ files: [null, undefined] }).project.files.length === 0);
  ok('null is survivable', normalizeProject(null, opts).repairs.length === 0);
  ok('so is nothing at all', normalizeProject(undefined, opts).repairs.length === 0);
  ok('icon positions that are not an object become none',
    Object.keys(run({ files: [], systemIconPositions: 'x' }).project.systemIconPositions).length === 0);
}

console.log('\nRemembered icon positions have to be real positions:');
{
  const { project } = run({
    files: [],
    systemIconPositions: {
      __system_finder__: { x: '12', y: '20' },
      __system_settings__: { x: 'left', y: 3 },
      __system_trash__: null,
      __not_a_system_icon__: { x: 1, y: 1 },
    },
  });
  const p = project.systemIconPositions;
  ok('a position written as text is read as a number', p.__system_finder__.x === 12 && p.__system_finder__.y === 20);
  ok('a position that is not a number is forgotten', p.__system_settings__ === undefined);
  ok('a missing position is forgotten', p.__system_trash__ === undefined);
  ok('anything that is not a system icon is left alone', !!p.__not_a_system_icon__);
}

console.log('\nReading a workspace twice does not change it:');
{
  // It runs on the way in and again on the way out, so a workspace that
  // changed shape each time would drift every save.
  const project = {
    files: [
      { id: 'd1', parentId: ROOT, type: 'folder', name: 'docs' },
      { id: 'f1', parentId: 'd1', type: 'file', name: 'a.txt', content: 'x' },
      { id: 'f2', parentId: 'gone', type: 'file', name: 'orphan.txt', content: 'y' },
    ],
    systemIconPositions: { __system_finder__: { x: 1, y: 2 } },
  };
  const first = run(project);
  const snapshot = JSON.stringify(project);
  const second = normalizeProject(project, opts);
  ok('the second reading changes nothing', JSON.stringify(project) === snapshot);
  ok('and finds nothing left to repair', second.repairs.length === 0);
  ok('the first reading did find something', first.repairs.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/vos/project.js)`);
process.exit(fail ? 1 : 0);
