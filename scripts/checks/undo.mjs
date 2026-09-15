// ==============================================================
// Undo checks
//
// Loads the REAL src/platform/tauri/undo.js into a Node VM with a fake
// HC.invoke that records what it was asked to do, so these can tell apart the
// three outcomes that matter:
//
//   restored by writing   — the file existed, its contents go back
//   restored by deleting  — the file did not exist, so undoing means removing it
//   refused               — nothing usable was saved, and the user is told
//
// The third is the one worth testing hardest. A checkpoint of a binary or
// oversized file keeps no contents; an undo that "restored" it anyway would
// overwrite the user's file with emptiness while reporting success.
//
// Run with: npm run check:undo
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, '..', '..', 'src', 'platform', 'tauri', 'undo.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A fresh module with a scripted backend. `reply` decides what each command returns. */
function load(reply) {
  const calls = [];
  const HC = {
    async invoke(name, args) {
      calls.push({ name, args });
      const r = reply ? reply(name, args) : undefined;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  // In the browser `window.HC = {}` also makes HC a bare global, and the file
  // uses both spellings. The sandbox has to offer the same, or it would fail
  // here for a reason that does not exist in the app.
  const sandbox = { HC, window: { HC } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'undo.js' });
  return { undo: sandbox.window.HC.undo, calls };
}

const RECORD = {
  id: 'abc-1', path: '/p/main.rs', content: 'original\n', existed: true, unrestorable: null,
};

console.log('\nA change to an existing file is put back by writing the old contents:');
{
  const { undo, calls } = load((name) => (name === 'checkpoint_save' ? { ...RECORD } : undefined));
  const rec = await undo.capture('/p/main.rs');
  ok('the record is kept and found again by path', undo.lastFor('/p/main.rs') === rec);
  await undo.restore(rec);
  const write = calls.find(c => c.name === 'fs_write_file');
  ok('it writes', !!write);
  ok('it writes the previous contents, unchanged', write?.args.content === 'original\n');
  ok('it writes to the same path', write?.args.path === '/p/main.rs');
  ok('it does not delete anything', !calls.some(c => c.name === 'fs_delete_file'));
  ok('the saved copy is dropped afterwards', calls.some(c => c.name === 'checkpoint_drop'));
}

console.log('\nA file the agent created is put back by deleting it:');
{
  const created = { id: 'abc-2', path: '/p/new.rs', content: null, existed: false, unrestorable: null };
  const { undo, calls } = load((name) => (name === 'checkpoint_save' ? { ...created } : undefined));
  const rec = await undo.capture('/p/new.rs');
  await undo.restore(rec);
  ok('it deletes', calls.some(c => c.name === 'fs_delete_file' && c.args.path === '/p/new.rs'));
  ok('it does NOT write an empty file in its place', !calls.some(c => c.name === 'fs_write_file'));
}

console.log('\nA change that was never saved is refused, not faked:');
for (const reason of ['the file is not text', 'the file is too large to keep a copy of']) {
  const rec = { id: 'x', path: '/p/a.bin', content: null, existed: true, unrestorable: reason };
  const { undo, calls } = load();
  ok(`canRestore is false — ${reason}`, undo.canRestore(rec) === false);
  let threw = null;
  try { await undo.restore(rec); } catch (e) { threw = e; }
  ok('restore throws rather than reporting success', !!threw);
  ok('the reason reaches the caller', String(threw?.message || '').includes(reason));
  ok('nothing was written or deleted',
    !calls.some(c => c.name === 'fs_write_file' || c.name === 'fs_delete_file'));
}

console.log('\nIf the checkpoint could not be saved, the write still happens and undo is refused:');
{
  const { undo } = load((name) => (name === 'checkpoint_save' ? new Error('disk full') : undefined));
  let rec;
  let threw = null;
  try { rec = await undo.capture('/p/main.rs'); } catch (e) { threw = e; }
  ok('capture never throws — it must not block an approved write', threw === null);
  ok('the record says it cannot be restored', undo.canRestore(rec) === false);
  ok('and carries the reason', /disk full/.test(String(rec?.unrestorable)));
}

console.log('\nKeeping a change forgets the copy:');
{
  const { undo, calls } = load((name) => (name === 'checkpoint_save' ? { ...RECORD } : undefined));
  const rec = await undo.capture('/p/main.rs');
  await undo.drop(rec);
  ok('the record is dropped in Rust', calls.some(c => c.name === 'checkpoint_drop' && c.args.id === 'abc-1'));
  ok('and is no longer offered for that path', undo.lastFor('/p/main.rs') === null);
}

console.log('\nA second change to the same file supersedes the first:');
{
  let n = 0;
  const { undo } = load((name) => (name === 'checkpoint_save' ? { ...RECORD, id: 'id-' + (++n) } : undefined));
  await undo.capture('/p/main.rs');
  const second = await undo.capture('/p/main.rs');
  // Undo means "take back the change just made", so the newest copy is the
  // right one — restoring the older one would discard an edit in between.
  ok('the newest checkpoint is the one offered', undo.lastFor('/p/main.rs') === second);
  ok('and it is the second one', second.id === 'id-2');
}

console.log('\nA missing record is refused:');
{
  const { undo } = load();
  ok('canRestore(null) is false', undo.canRestore(null) === false);
  ok('canRestore(undefined) is false', undo.canRestore(undefined) === false);
  let threw = null;
  try { await undo.restore(null); } catch (e) { threw = e; }
  ok('restoring nothing throws', !!threw);
}

console.log('\nA file changed since the change is asked about before it is put back:');
{
  const scripted = (changed) => (name) => {
    if (name === 'checkpoint_save') return { ...RECORD };
    if (name === 'checkpoint_changed') return changed;
    return undefined;
  };
  const wrote = (calls) => calls.some(c => c.name === 'fs_write_file' || c.name === 'fs_delete_file');

  let { undo, calls } = load(scripted(true));
  let rec = await undo.capture('/p/main.rs');
  let threw = null;
  try { await undo.restore(rec); } catch (e) { threw = e; }
  ok('with no way to ask, it is not undone', threw?.cancelled === true && !wrote(calls));

  ({ undo, calls } = load(scripted(true)));
  rec = await undo.capture('/p/main.rs');
  const asked = [];
  threw = null;
  try { await undo.restore(rec, { ask: async (m) => { asked.push(m); return false; } }); } catch (e) { threw = e; }
  ok('the question names the file and says what is lost', /"main\.rs" has changed since the agent's change[\s\S]*is lost/.test(asked[0] || ''));
  ok('a no leaves the file alone and says so', threw?.cancelled === true && /Not undone/.test(threw.message) && !wrote(calls));
  ok('... and the saved copy is kept for another try', !calls.some(c => c.name === 'checkpoint_drop'));

  ({ undo, calls } = load(scripted(true)));
  rec = await undo.capture('/p/main.rs');
  await undo.restore(rec, { ask: async () => true });
  ok('a yes puts the old contents back', calls.find(c => c.name === 'fs_write_file')?.args.content === 'original\n');

  for (const [label, changed] of [['a file left as the change made it', false], ['a record with nothing to compare', null], ['a check that fails', new Error('gone')]]) {
    ({ undo, calls } = load(scripted(changed)));
    rec = await undo.capture('/p/main.rs');
    let wasAsked = false;
    await undo.restore(rec, { ask: async () => { wasAsked = true; return false; } });
    ok(`${label} is put back without a question`, !wasAsked && wrote(calls));
  }

  ({ undo, calls } = load((name) => (name === 'checkpoint_save' ? { id: 'n1', path: '/p/new.rs', content: null, existed: false, unrestorable: null } : name === 'checkpoint_changed' ? true : undefined)));
  rec = await undo.capture('/p/new.rs');
  await undo.restore(rec, { ask: async () => true });
  ok('a created file changed since is deleted only after a yes', calls.some(c => c.name === 'fs_delete_file'));
}

console.log('\nThe file is recorded as the change left it:');
{
  const { undo, calls } = load((name) => (name === 'checkpoint_seal' ? new Error('disk full') : undefined));
  await undo.seal({ id: 'abc-1', path: '/p/main.rs' });
  ok('seal asks Rust to record the file, by id only', calls.some(c => c.name === 'checkpoint_seal' && c.args.id === 'abc-1' && Object.keys(c.args).length === 1));
  let threw = null;
  try { await undo.seal(null); await undo.seal({ path: '/p/x' }); } catch (e) { threw = e; }
  ok('a record with no id is left alone, and a failure never throws', threw === null && calls.filter(c => c.name === 'checkpoint_seal').length === 1);
}

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/undo.js)`);
process.exit(fail ? 1 : 0);
