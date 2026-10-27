// ============================================================
// A file is read before it is changed, and so is what uses it —
// src/js/code/seen.js, and where the Coder and its tools use it.
// Run with: npm run check:code-seen
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'code', 'codemap.js'], ['js', 'code', 'search.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'seen.js'), sandbox, { filename: 'seen.js' });
const S = sandbox.window.HCCodeSeen;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const plain = (x) => JSON.parse(JSON.stringify(x));
const root = '/work/lantern-lane';
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const turn = (...calls) => ({ role: 'assistant', content: '', tool_calls: calls });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });

console.log('\nWhat this conversation has read:');
{
  const messages = [
    { role: 'user', content: 'fix the rate' },
    turn(call('a', 'read_file', { path: `${root}/server/rooms.py` }), call('b', 'read_file', { path: `${root}/server/missing.py` }), call('c', 'grep_code', { dir: root, pattern: 'rate' })),
    result('a', '1| def nightly_rate(room):'), result('b', '{"error":"No such file"}'), result('c', 'grep_code "rate": ...'),
    turn(call('d', 'write_file', { path: `${root}/server/new.py`, content: 'x' }), call('e', 'patch_file', { path: `${root}/web/a.js`, search: 'a', replace: 'b' })),
    result('d', '{"ok":true}'),
  ];
  const read = [...S.readIn(messages)].sort();
  ok('a read that worked, and a file the run wrote, count', read.includes(`${root}/server/rooms.py`) && read.includes(`${root}/server/new.py`), read.join());
  ok('a read that failed, a search, and a call with no result yet do not', !read.includes(`${root}/server/missing.py`) && read.length === 2, read.join());
  ok('a new conversation has read nothing', S.readIn([]).size === 0);
}

console.log('\nWhat a project shown whole holds:');
{
  const whole = 'The project is small, so every file in it is shown here...\n\n=== server/rooms.py ===\ndef nightly_rate(room):\n    return 1\n\n=== web/a.js ===\nconst a = 1;\n\n=== not text, not shown: logo.png ===';
  const shown = S.shownWhole(whole);
  ok('each file under its place, with its text', shown.get('server/rooms.py') === 'def nightly_rate(room):\n    return 1' && shown.get('web/a.js') === 'const a = 1;' && shown.size === 2, JSON.stringify([...shown.keys()]));
}

console.log('\nThe names a change alters:');
{
  const js = plain(S.altered('export function nightlyRate(room, nights) {\n  return 1;\n}\nfunction keepMe(a) {}', 'export function nightlyRate(room, nights, season) {\n  return 1;\n}\nfunction keepMe(a) {}', 'web/rates.js'));
  ok('a function that now takes something else', js.length === 1 && js[0].name === 'nightlyRate' && js[0].was === 'nightlyRate(room, nights)' && js[0].now === 'nightlyRate(room, nights, season)', JSON.stringify(js));
  const py = plain(S.altered('def nightly_rate(room):\n    return 1\n', 'def nightly_price(room):\n    return 1\n', 'server/rooms.py'));
  ok('a name renamed or removed', py.length === 1 && py[0].name === 'nightly_rate' && py[0].now === '', JSON.stringify(py));
  ok('a body changed alone alters nothing others use', S.altered('def nightly_rate(room):\n    return 1\n', 'def nightly_rate(room):\n    return 2\n', 'server/rooms.py').length === 0);
  ok('a short name is not followed, nor a file that is not code', S.altered('function go(a) {}', 'function go(a, b) {}', 'a.js').length === 0 && S.altered('function nightlyRate(a) {}', '', 'notes.md').length === 0);
}

console.log('\nThe files that use a name:');
{
  const found = [
    { path: `${root}/server/rooms.py`, line_no: 1, line: 'def nightly_rate(room):' },
    { path: `${root}/server/bookings.py`, line_no: 8, line: '    total = nightly_rate(room) * nights' },
    { path: `${root}/server/bookings.py`, line_no: 30, line: 'from rooms import nightly_rate' },
    { path: `${root}/server/reports.py`, line_no: 4, line: 'x = nightly_rates_table' },
    { path: `${root}/server/tests/test_rooms.py`, line_no: 2, line: 'assert nightly_rate(r) == 1' },
  ];
  const users = plain(S.usersOf('nightly_rate', found, `${root}/server/rooms.py`, root));
  ok('the other files using it as a whole word, from the project folder, with their lines', users.map((u) => `${u.path}:${u.lines.join('/')}`).join() === 'server/bookings.py:8/30,server/tests/test_rooms.py:2', JSON.stringify(users));
  ok('the file changed, and a longer name holding it, are not users', !users.some((u) => u.path === 'server/rooms.py' || /reports/.test(u.path)));
  const note = S.usersNote('server/rooms.py', [{ name: 'nightly_rate', was: 'nightly_rate(room)', now: '' }], users);
  ok('the note says what changes, which files use it, to read them and change them where they need it', note.startsWith('Not changed yet: this change to server/rooms.py alters nightly_rate(room), which it removes or renames, and other files use it: server/bookings.py (lines 8, 30), server/tests/test_rooms.py (line 2).') && /then make this change again\./.test(note), note);
}

console.log('\nBefore a change is made:');
{
  const files = { [`${root}/server/rooms.py`]: 'def nightly_rate(room):\n    return 1\n', [`${root}/server/bookings.py`]: 'total = nightly_rate(room)\n' };
  const deps = (over = {}) => ({ root, whole: '', current: async (p) => (p in files ? files[p] : null), uses: async (name) => Object.entries(files).flatMap(([p, t]) => t.split('\n').map((line, i) => ({ path: p, line_no: i + 1, line })).filter((m) => m.line.includes(name))), ...over });
  const patch = (args) => ({ name: 'patch_file', arguments: { path: `${root}/server/rooms.py`, ...args } });
  const ask = { role: 'user', content: 'rename nightly_rate' };
  const readRooms = [turn(call('r1', 'read_file', { path: `${root}/server/rooms.py` })), result('r1', '1| def nightly_rate(room):')];
  const err = (r) => (r ? JSON.parse(r.result).error : '');

  ok('a new file is written without having been read', await S.before({ name: 'write_file', arguments: { path: `${root}/server/new.py`, content: 'x' } }, [ask], deps()) === null);
  const blind = await S.before(patch({ search: 'return 1', replace: 'return 2' }), [ask], deps());
  ok('a file not read in the conversation is not changed, and the model is told to read it', blind && blind.ok === false && err(blind).startsWith('Not changed: server/rooms.py has not been read in this conversation') && /Read it with read_file first/.test(err(blind)), err(blind));
  ok('nor deleted, nor replaced whole', !!(await S.before({ name: 'delete_file', arguments: { path: `${root}/server/rooms.py` } }, [ask], deps())) && !!(await S.before({ name: 'write_file', arguments: { path: `${root}/server/rooms.py`, content: 'x' } }, [ask], deps())));
  ok('something added at the end needs no read', await S.before({ name: 'write_file', arguments: { path: `${root}/server/rooms.py`, content: 'x', append: true } }, [ask], deps()) === null);
  ok('once read, a change inside it goes ahead', await S.before(patch({ search: 'return 1', replace: 'return 2' }), [ask, ...readRooms], deps()) === null);

  S.stamp(`${root}/server/rooms.py`, files[`${root}/server/rooms.py`]);
  ok('what it held when read is matched, line endings aside', await S.before(patch({ search: 'return 1', replace: 'return 2' }), [ask, ...readRooms], deps({ current: async () => 'def nightly_rate(room):\r\n    return 1\r\n' })) === null);
  const moved = await S.before(patch({ search: 'return 1', replace: 'return 2' }), [ask, ...readRooms], deps({ current: async () => 'def nightly_rate(room):\n    return 3\n' }));
  ok('a file changed since it was read is read again first', moved && err(moved).startsWith('Not changed: server/rooms.py has changed since you last read it'), err(moved));
  S.stamp(`${root}/server/rooms.py`, files[`${root}/server/rooms.py`]);

  const whole = '=== server/rooms.py ===\ndef nightly_rate(room):\n    return 1\n';
  ok('a project shown whole counts as read', await S.before({ name: 'patch_file', arguments: { path: `${root}/web/x.py`, search: 'a', replace: 'b' } }, [ask], deps({ whole: '=== web/x.py ===\na\n', current: async () => 'a\n' })) === null);
  ok('...unless the file has changed since it was shown', !!(await S.before({ name: 'patch_file', arguments: { path: `${root}/web/x.py`, search: 'a', replace: 'b' } }, [ask], deps({ whole: '=== web/x.py ===\na\n', current: async () => 'b\n' }))));
  void whole;

  const rename = patch({ search: 'def nightly_rate(room):', replace: 'def nightly_price(room):' });
  const request = { role: 'user', content: 'rename nightly_rate to nightly_price' };
  const held = await S.before(rename, [request, ...readRooms], deps());
  ok('a change to a name other files use waits until they are read, and says which', held && /^Not changed yet: this change to server\/rooms\.py alters nightly_rate\(room\), which it removes or renames, and other files use it: server\/bookings\.py \(line 1\)/.test(err(held)), err(held));
  const readBoth = [...readRooms, turn(call('r2', 'read_file', { path: `${root}/server/bookings.py` })), result('r2', '1| total = nightly_rate(room)')];
  ok('once they are read, it goes ahead', await S.before(rename, [request, ...readBoth], deps()) === null);
  const again = { role: 'user', content: 'now rename it' };
  const told = [];
  for (let i = 0; i < S.TOLD_MOST + 1; i++) told.push(await S.before(rename, [again, ...readRooms], deps()));
  ok(`a model that will not read them is told ${S.TOLD_MOST} times, then let through, so a run is never held for good`, told.slice(0, S.TOLD_MOST).every((r) => r && r.ok === false) && told[S.TOLD_MOST] === null, told.map((r) => !!r).join());
  ok('a fresh request is told again', !!(await S.before(rename, [{ role: 'user', content: 'once more' }, ...readRooms], deps())));
  ok('a change that alters no name others use goes ahead', await S.before(patch({ search: 'return 1', replace: 'return 2' }), [request, ...readRooms], deps()) === null);
  ok('a tool that changes nothing is never held', await S.before({ name: 'read_file', arguments: { path: `${root}/server/rooms.py` } }, [ask], deps()) === null);
}

console.log('\nWhere it is used:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('every call the run makes is answered by it, after the app\'s own answers and before it is made, for the project\'s own tools only',
    /\|\| \(!window\.HCMcp\?\.systemOf\?\.\(call\.name\) && await window\.HCCodeSeen\?\.before\(call, messages, \{ root: sharedState\.projectRoot, whole: sharedState\.codeMap\?\.root === sharedState\.projectRoot \? sharedState\.codeMap\.whole : '', current: HC\.code\.readWholeQuietly, uses: HC\.code\.linesQuietly \}\)\) \|\| null;/.test(mode)
    && /const raw = early \? early\.result :/.test(mode) && /if \(!early\) asked\.after\(call, resultStr, ok\);/.test(mode));
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('a read and a write keep what the file held, a whole read or a window alike', (tools.match(/window\.HCCodeSeen\?\.stamp\(path, /g) || []).length === 3 && /window\.HCCodeSeen\?\.stamp\(path, ends\.text\)/.test(tools));
  ok('the full and mid-sized instructions say to read what uses a changed name', /read those files too and change them where they need it/.test(tools) && /before you change it, and the files that use what you change/.test(tools));
  const boot = src('boot.js');
  ok('loaded before the Coder mode', boot.indexOf("'/js/code/seen.js'") > boot.indexOf("'/js/code/find.js'") && boot.indexOf("'/js/code/find.js'") > 0);
  ok('it calls no program and touches no file of its own', !/\binvoke\(|HC\.invoke|fetch\(|XMLHttpRequest|require\(|import\(|localStorage|document\./.test(src('js', 'code', 'seen.js')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/seen.js)`);
process.exit(fail ? 1 : 0);
