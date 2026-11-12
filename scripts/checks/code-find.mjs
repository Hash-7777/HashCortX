// ============================================================
// The files a request needs, found before its first step —
// src/js/code/find.js, the reads it is given in
// src/platform/tauri/hashcoder.js, and where the Coder calls it.
// Run with: npm run check:code-find
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set };
sandbox.HC = sandbox.window.HC = {};
vm.createContext(sandbox);
for (const f of [['js', 'text-safety.js'], ['js', 'secret-shapes.js'], ['js', 'code', 'search.js'], ['js', 'code', 'talk.js'], ['js', 'code', 'paths.js'], ['js', 'code', 'patch.js'], ['js', 'code', 'codemap.js'], ['platform', 'tauri', 'hashcoder.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'find.js'), sandbox, { filename: 'find.js' });
const F = sandbox.window.HCCodeFind;
const HC = sandbox.window.HC;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const plain = (x) => JSON.parse(JSON.stringify(x));

console.log('\nWhat a request is searched for:');
{
  const t = plain(F.termsOf('The nightly rate in rooms.py is wrong: getNightlyRate should add "seasonal_markup" for guests booking through BookingForm.'));
  ok('a file name first, then names written the way code writes them, then the longest plain words', t[0].kind === 'file' && t[0].text === 'rooms.py' && t.filter((x) => x.kind === 'code').map((x) => x.text).join() === 'seasonal_markup,getNightlyRate,BookingForm' && t.at(-1).kind === 'word', JSON.stringify(t));
  ok(`at most ${F.MOST_TERMS}, each once`, t.length <= F.MOST_TERMS && new Set(t.map((x) => x.text.toLowerCase())).size === t.length);
  ok('words that say what to do are not searched for', !F.termsOf('Please change and update this so it should work').some((x) => /please|change|update|should/.test(x.text)));
  ok('a quoted phrase is searched as it is written', plain(F.termsOf('Rename the button "Book a room" to "Reserve"')).some((x) => x.text === 'Book a room'));
  ok('a path is one name', plain(F.termsOf('fix server/routes/rooms in the back end')).some((x) => x.text === 'server/routes/rooms'));
  ok('nothing in a request with nothing to search for', F.termsOf('hi').length === 0 && F.termsOf('').length === 0);
}

console.log('\nHow the app\'s search ranks what it found:');
const root = '/work/lantern-lane';
{
  const terms = [{ text: 'rooms.py', kind: 'file' }, { text: 'getNightlyRate', kind: 'code' }, { text: 'nightly', kind: 'word' }];
  const byName = [[{ path: `${root}/server/rooms.py`, score: 0 }, { path: `${root}/server/rooms_test_data.json`, score: 3 }], [], []];
  const byLine = [[], [{ path: `${root}/web/src/booking.js`, line_no: 41 }, { path: `${root}/server/rooms.py`, line_no: 12 }, { path: `${root}/server/rooms.py`, line_no: 80 }],
    [{ path: `${root}/docs/notes.md`, line_no: 3 }, { path: `${root}/server/rooms.py`, line_no: 12 }]];
  const ranked = plain(F.rank(terms, byName, byLine, root, 3));
  ok('a file found by its name and its lines comes first', ranked[0].path === 'server/rooms.py' && ranked[0].terms.join() === 'rooms.py,getNightlyRate,nightly', JSON.stringify(ranked[0]));
  ok('a name written as code counts more than a plain word', ranked[1].path === 'web/src/booking.js' && ranked[2].path === 'docs/notes.md', ranked.map((r) => r.path).join());
  ok('a match by name that is only a loose spelling is not counted', !ranked.some((r) => r.path.includes('rooms_test_data')));
  ok('paths from the project folder, the lines each, at most the number asked', ranked.length === 3 && ranked[0].lines.join() === '12,80' && !JSON.stringify(ranked).includes(root));
  const note = F.searchNote(ranked);
  ok('the note says where it came from, to read before changing, and that it can miss a file', /^Files that may matter for this request, from the app's search of the project/.test(note) && /Read the ones that matter before you change anything; the list is a start and can miss a file\./.test(note));
  ok('each file with what it held and where', note.includes('- server/rooms.py: "rooms.py", "getNightlyRate", "nightly" at lines 12, 80') && note.includes('- web/src/booking.js: "getNightlyRate" at line 41'), note);
  ok('nothing found, no note', F.searchNote([]) === '');
}

console.log('\nRanking by the rare-word formula, in an invented project:');
{
  const R = '/work/harbour-ledger';
  const terms = [{ text: 'invoiceTotal', kind: 'code' }, { text: 'rounding', kind: 'word' }];
  const line = (path, line_no, text) => ({ path: `${R}/${path}`, line_no, line: text });
  // The right file defines the name and says the word once; a long helper file
  // repeats the name; the word is in nearly every file.
  const common = Array.from({ length: 8 }, (_, k) => line(`src/part${k}.js`, 3, '// rounding is done elsewhere'));
  const byLine = [
    [line('src/billing/invoice.js', 10, 'export function invoiceTotal(lines) {'), line('src/billing/invoice.js', 40, '  return invoiceTotal(rest);'),
      ...[5, 6, 7, 8, 9].map((n) => line('src/utils/format.js', n, `  total: invoiceTotal, // ${n}`)), line('docs/notes.md', 2, 'invoiceTotal adds the lines')],
    [line('src/billing/invoice.js', 12, '  // rounding to cents'), ...[20, 21, 22, 23].map((n) => line('src/utils/format.js', n, '  rounding()')), ...common],
  ];
  const sizes = { 'src/billing/invoice.js': 3000, 'src/utils/format.js': 40000, 'docs/notes.md': 800 };
  for (let k = 0; k < 8; k++) sizes[`src/part${k}.js`] = 5000;
  const ranked = plain(F.rank(terms, [[], []], byLine, R, 5, { files: 40, sizes }));
  const order = ranked.map((r) => r.path);
  ok('the file that defines the name comes first, ahead of a long file that repeats it', order[0] === 'src/billing/invoice.js' && order.indexOf('src/utils/format.js') > 0 && order.indexOf('src/utils/format.js') < order.findIndex((p) => /part\d/.test(p)), ranked.map((r) => `${r.path} ${r.score.toFixed(3)}`).join(' | '));
  ok('a word nearly every file holds adds little: a file with only it comes after one with the rare name', ranked.findIndex((r) => r.path === 'docs/notes.md') < ranked.findIndex((r) => /part\d/.test(r.path)), ranked.map((r) => r.path).join());
  const one = (text) => [[line('a.js', 1, text)], []];
  const two = [[line('a.js', 1, 'const x = invoiceTotal(1);'), line('b.js', 4, 'function invoiceTotal(lines) {')], []];
  const byDef = plain(F.rank([terms[0], terms[1]], [[], []], two, R, 2, { files: 10 }));
  ok('a line that defines the name counts three times', byDef[0].path === 'b.js' && byDef[0].score > byDef[1].score, JSON.stringify(byDef));
  const byName = plain(F.rank([{ text: 'invoice', kind: 'code' }], [[{ path: `${R}/src/invoice.js`, score: 1 }]], [[line('src/other.js', 2, 'invoice'), line('src/invoice.js', 9, 'x')]], R, 2, { files: 10 }));
  ok('a file whose name holds the term counts it three times too', byName[0].path === 'src/invoice.js', JSON.stringify(byName));
  const same = [[line('long.js', 1, 'invoiceTotal()'), line('short.js', 1, 'invoiceTotal()')], []];
  const bySize = plain(F.rank(terms, [[], []], same, R, 2, { files: 10, sizes: { 'long.js': 90000, 'short.js': 900 } }));
  ok('the same matches in a shorter file count for more, when the sizes are known', bySize[0].path === 'short.js' && bySize[0].score > bySize[1].score, JSON.stringify(bySize));
  const unsized = plain(F.rank(terms, [[], []], same, R, 2, { files: 10 }));
  ok('...and without them, length says nothing', unsized[0].score === unsized[1].score);
  const capped = Array.from({ length: F.SEARCH_MOST }, (_, k) => line(`f${k % 3}.js`, k + 1, 'rounding'));
  const rare = plain(F.rank([{ text: 'rounding', kind: 'word' }, { text: 'ledgerKey', kind: 'code' }], [[], []], [capped, [line('g.js', 1, 'ledgerKey')]], R, 4, { files: 100 }));
  ok(`a search that reached the native cap of ${F.SEARCH_MOST} matches is a common word, not a rare one`, rare[0].path === 'g.js', JSON.stringify(rare.map((r) => [r.path, r.score])));
}

console.log('\nWhat a finding run answers:');
{
  const said = plain(F.answerOf('<think>where is it</think>Looked around.\nFILES:\nserver/rooms.py:10-60 — defines get_nightly_rate\n- `web/src/booking.js` lines 30-48: calls it\n3. server/tests/test_rooms.py:5 - tests the rate\nserver/rooms.py:1-5 — again\nnot a file at all\n'));
  ok('each file with its lines and why, from several ways of writing it', said.length === 3 && said[0].path === 'server/rooms.py' && said[0].start === 10 && said[0].end === 60 && /defines/.test(said[0].why)
    && said[1].path === 'web/src/booking.js' && said[1].start === 30 && said[1].end === 48 && said[2].start === 5 && said[2].end === 5, JSON.stringify(said));
  ok('each file once, and what is not a file passed over', said.filter((f) => f.path === 'server/rooms.py').length === 1 && !said.some((f) => /not a file/.test(f.path)));
  ok('no more than asked', F.answerOf(Array.from({ length: 20 }, (_, i) => `f${i}.js:1-2 — x`).join('\n'), 4).length === 4);
  const note = F.foundNote(said);
  ok('the note says to read these first, around the lines, and that it can miss a file', /^Files found for this request before any change, by a search of the project\. Read these first, around the lines given/.test(note) && note.includes('- server/rooms.py lines 10-60: defines get_nightly_rate') && note.includes('- server/tests/test_rooms.py line 5: tests the rate') && /can miss a file/.test(note), note);
  ok('the run is told to only read, to look for what uses the code too, and how to answer', /You only read/.test(F.FINDING_PROMPT) && /Do not change anything/.test(F.FINDING_PROMPT) && /callers, imports, routes, tests and settings/.test(F.FINDING_PROMPT) && /FILES:\npath\/from\/the\/project:first-last — why it matters/.test(F.FINDING_PROMPT));
  ok('it is given only tools that read', F.FINDING_TOOLS.join() === 'grep_code,list_dir,fuzzy_find,read_file');
}

console.log('\nBefore a request\'s first step:');
const toolList = HC.code.toolList();
const project = {
  'server/rooms.py': 'def get_nightly_rate(room):\n    return room.rate\n',
  'web/src/booking.js': "import { rate } from './rates';\n",
  'server/tests/test_rooms.py': 'def test_rate(): pass\n',
};
const depsFor = (over = {}) => {
  const asked = [], ran = [];
  const deps = {
    size: 'mid', light: false, root, outline: 'The project\'s folders when this conversation began: ...',
    byName: async (q) => Object.keys(project).filter((p) => p.toLowerCase().includes(q.toLowerCase())).map((p) => ({ path: `${root}/${p}`, score: p.endsWith(q) ? 0 : 2 })),
    byLine: async (q) => Object.entries(project).flatMap(([p, text]) => text.split('\n').map((line, i) => ({ path: `${root}/${p}`, line_no: i + 1, line })).filter((m) => m.line.toLowerCase().includes(q.toLowerCase()))),
    exists: async (p) => p in project,
    run: async (name, args) => { ran.push(name); return name === 'grep_code' ? 'grep_code "rate": 3 lines in 3 files.\nserver/rooms.py\n  1: def get_nightly_rate(room):\nweb/src/booking.js\n  1: import' : 'server/\nweb/'; },
    tools: toolList,
    record: { turn: sandbox.window.HCAgentShape?.appendAssistantToolCallTurn || ((m, content, calls) => m.push({ role: 'assistant', content, tool_calls: calls })), result: (m, call, text) => m.push({ role: 'tool', tool_call_id: call.id, content: text }) },
    fromApp: 'For this request, from HashCortX (not from the person):',
    shown: [], show(by, n) { this.shown.push(`${by}:${n}`); },
    ...over,
  };
  deps.asked = asked; deps.ran = ran;
  return deps;
};
const scripted = (replies, deps) => async (messages, tools) => {
  deps.asked.push({ tools: tools.map((t) => t.function.name), messages: messages.length, last: messages.at(-1).content });
  return replies.shift() || { content: 'FILES:\n' };
};
{
  const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'The nightly rate is wrong in getNightlyRate, fix it' }];
  const deps = depsFor({ size: 'small' });
  deps.ask = scripted([], deps);
  const out = plain(await F.before(messages, deps));
  ok('a small model: the app\'s search only, no model asked', out && out.by === 'search' && deps.asked.length === 0 && out.files.length > 0, JSON.stringify(out));
  ok('what was found joins the request as the app\'s, marked as not from the person', messages[1].context.startsWith('For this request, from HashCortX (not from the person):\nFiles that may matter for this request') && messages[1].content === 'The nightly rate is wrong in getNightlyRate, fix it');
  ok('it is said in the run', deps.shown.join() === `by the app's search:${out.files.length}`);
}
{
  const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'The nightly rate is wrong in getNightlyRate, fix it', context: 'For this request, from HashCortX (not from the person):\nActive file: x' }];
  const deps = depsFor();
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: i ? 'list_dir' : 'grep_code', arguments: i ? { path: 'server' } : { dir: '.', pattern: 'rate' } }));
  deps.ask = scripted([
    { content: '', tool_calls: [...many, { id: 'w', name: 'write_file', arguments: { path: 'x.js', content: 'x' } }] },
    { content: '', tool_calls: [{ id: 'd', name: 'read_file', arguments: { path: 'server/rooms.py' } }] },
    { content: 'FILES:\nserver/rooms.py:1-2 — defines get_nightly_rate\nweb/src/booking.js:1 — imports the rate\nserver/made_up.py:1-9 — not there\nserver/tests/test_rooms.py:1 — tests it' },
  ], deps);
  const before = messages.length;
  const out = plain(await F.before(messages, deps));
  ok('a mid-sized model: a finding run, whose files are what the request carries', out && out.by === 'finding' && /Files found for this request before any change/.test(messages[1].context), JSON.stringify(out));
  ok('it keeps what was there and adds to it', messages[1].context.startsWith('For this request, from HashCortX (not from the person):\nActive file: x\nFiles found'));
  ok('its reads stay in its own conversation: nothing joins the run but the note', messages.length === before && !messages.some((m) => m.role === 'tool'));
  ok(`no more than ${F.CALLS_A_TURN} calls a turn, and never a tool that changes anything`, deps.ran.length === F.CALLS_A_TURN + 1 && !deps.ran.includes('write_file'), deps.ran.join());
  ok('it is offered only the reading tools, then none for its answer, and told to answer', deps.asked[0].tools.slice().sort().join() === 'fuzzy_find,grep_code,list_dir,read_file' && deps.asked.at(-1).tools.length === 0 && deps.asked.at(-1).last === F.LAST_TURN, JSON.stringify(deps.asked.map((a) => a.tools.length)));
  ok('a file it names that is not there is left out; one it saw or that is there is kept', out.files.map((f) => f.path).join() === 'server/rooms.py,web/src/booking.js,server/tests/test_rooms.py', out.files.map((f) => f.path).join());
  ok('its first message carries the request, the outline and the app\'s search', deps.asked[0].messages === 2);
}
{
  ok('how many files the project has is read from its outline', F.filesIn('The project\'s folders:\n./ — 3 files: a, b, c\nserver/ — 12 files: x\nweb/ — 1 file: y') === 16 && F.filesIn('') === 0 && F.filesIn(undefined) === 0);
  const messages = [{ role: 'user', content: 'The getNightlyRate rate is wrong' }];
  const listed = [];
  const deps = depsFor({ size: 'small', outline: 'The project\'s folders:\n./ — 2 files: a, b\nserver/ — 40 files: x',
    byName: async () => [],
    byLine: async (q) => (q === 'getNightlyRate' ? [{ path: `${root}/server/big.py`, line_no: 3, line: 'x = getNightlyRate(r)' }, { path: `${root}/web/small.js`, line_no: 3, line: 'y = getNightlyRate(r)' }] : []),
    list: async (dir) => { listed.push(dir); return dir.endsWith('/server') ? [{ name: 'big.py', path: `${dir}/big.py`, is_dir: false, size: 80000 }] : [{ name: 'small.js', path: `${dir}/small.js`, is_dir: false, size: 600 }]; },
  });
  deps.ask = scripted([], deps);
  const out = plain(await F.before(messages, deps));
  ok('the sizes of the files found come from a quiet listing of their folders, each folder once, and rank the shorter first', out && out.files[0].path === 'web/small.js' && listed.length === 2 && new Set(listed).size === 2, JSON.stringify({ out, listed }));
  const without = depsFor({ size: 'small', byName: deps.byName, byLine: deps.byLine });
  without.ask = scripted([], without);
  const plainOut = plain(await F.before([{ role: 'user', content: 'The getNightlyRate rate is wrong' }], without));
  ok('...and with no way to list, length says nothing', plainOut && plainOut.files[0].score === plainOut.files[1].score, JSON.stringify(plainOut));
}
{
  const messages = [{ role: 'user', content: 'In rooms.py, rename get_nightly_rate to nightly_price' }];
  const deps = depsFor();
  deps.ask = scripted([], deps);
  const out = plain(await F.before(messages, deps));
  ok('a request that names a file that is there: the app\'s search is enough, no finding run', out && out.by === 'search' && deps.asked.length === 0, JSON.stringify(out));
}
{
  const messages = [{ role: 'user', content: 'The nightly rate in getNightlyRate is wrong' }];
  const deps = depsFor();
  deps.ask = async () => { throw new Error('provider said no'); };
  const out = plain(await F.before(messages, deps));
  ok('a finding run that fails leaves the app\'s search to say what it found', out && out.by === 'search' && /from the app's search/.test(messages[0].context));
  const stopped = depsFor();
  stopped.ask = async () => { const e = new Error('stopped'); e.name = 'AbortError'; throw e; };
  let threw = '';
  try { await F.before([{ role: 'user', content: 'The nightly rate in getNightlyRate is wrong' }], stopped); } catch (e) { threw = e.name; }
  ok('a stop is passed on, not swallowed', threw === 'AbortError');
}
{
  const none = async (deps, content = 'The nightly rate in getNightlyRate is wrong') => { const m = [{ role: 'user', content }]; const r = await F.before(m, deps); return r === null && !('context' in m[0]); };
  ok('nothing is looked for in a project shown whole, in light mode, with no project, or for a greeting',
    await none(depsFor({ outline: '' })) && await none(depsFor({ light: true })) && await none(depsFor({ root: '' })) && await none(depsFor(), 'hello there!'));
}

console.log('\nThe reads it is given, which never ask:');
{
  let questions = 0;
  const calls = [];
  HC.guard = { projectRoot: () => root, request: async () => { questions++; return true; }, allowedWithoutAsking: async (action, target) => String(target).startsWith(root) && !String(target).includes('/private') };
  HC.invoke = async (cmd, a) => {
    calls.push(cmd);
    if (cmd === 'fs_read_file') { if (String(a.path).endsWith('.gitignore')) throw new Error('none'); return 'line one\nline two\n'; }
    if (cmd === 'fs_list_dir') return [{ name: 'server', is_dir: true }, { name: '.env', is_dir: false }, { name: 'app.py', is_dir: false }];
    if (cmd === 'fs_grep') return [{ path: `${root}/server/rooms.py`, line_no: 1, line: 'def get_nightly_rate(room):' }];
    if (cmd === 'fs_fuzzy_find') return [{ path: `${root}/server/rooms.py`, name: 'rooms.py', score: 0 }];
    return null;
  };
  const read = await HC.code.readingQuietly('read_file', { path: 'server/rooms.py' });
  const list = await HC.code.readingQuietly('list_dir', { path: '.' });
  const grep = await HC.code.readingQuietly('grep_code', { dir: '.', pattern: 'nightly' });
  const name = await HC.code.readingQuietly('fuzzy_find', { dir: '.', query: 'rooms' });
  const outside = await HC.code.readingQuietly('read_file', { path: '/elsewhere/notes.txt' });
  const changes = await HC.code.readingQuietly('write_file', { path: 'x.js', content: 'x' });
  ok('a read comes back numbered, a window at a time', /^1\| line one$/m.test(read) && /lines 1-2 of 2/.test(read), read);
  ok('a listing names entries, folders marked, hidden ones left out', list === 'server/\napp.py', list);
  ok('a search is shaped as the run\'s are, from the project folder', grep.startsWith('grep_code "nightly"') && grep.includes('\nserver/rooms.py\n  1: def get_nightly_rate(room):'), grep);
  ok('a find by name gives paths from the project folder', JSON.parse(name).files[0].path === 'server/rooms.py', name);
  ok('anything outside the project is refused in words, and no tool that changes anything runs', /Only the open project's files are read here/.test(outside) && /not one of the tools that only read/.test(changes));
  ok('no question was put to the person for any of it', questions === 0);
  ok('the app\'s searches across the project never ask either', Array.isArray(await HC.code.namesQuietly('rooms')) && Array.isArray(await HC.code.linesQuietly('rate')) && questions === 0 && await HC.code.existsQuietly('server/rooms.py') === true);
}

console.log('\nA file holding hidden characters that change what it means:');
{
  // Built from code points (scripts/checks/text-safety.mjs).
  const RLO = String.fromCodePoint(0x202E), PDF = String.fromCodePoint(0x202C), ZWSP = String.fromCodePoint(0x200B);
  const tag = (t) => [...t].map((c) => String.fromCodePoint(0xE0000 + c.codePointAt(0))).join('');
  const file = `const role = 'user';\nif (role === "admin${RLO} ${PDF}") grant();\nconst note = "ok${tag('hi')}";\nconst gap = "a${ZWSP}b";\n`;
  HC.guard = { projectRoot: () => root, request: async () => true, allowedWithoutAsking: async () => true };
  HC.invoke = async (cmd) => {
    if (cmd === 'fs_read_file') return file;
    if (cmd === 'fs_grep') return [{ path: `${root}/server/roles.js`, line_no: 2, line: `if (role === "admin${RLO} ${PDF}") grant();` }];
    if (cmd === 'fs_list_dir') return [];
    return null;
  };
  const tool = (n) => HC.code.TOOL_DEFINITIONS.find((t) => t.name === n).fn;
  const read = await tool('read_file')({ path: `${root}/server/roles.js` });
  ok('a read shows them as codes, and nothing else is changed', read.startsWith(file.replace(RLO, '\\u{202E}').replace(PDF, '\\u{202C}').replace(tag('hi'), '\\u{E0068}\\u{E0069}')) && read.includes(ZWSP), read);
  ok('...with a line saying how many, on which lines, and that a change may copy them', /\[This file holds 4 hidden characters that can change what it says, shown as codes such as \\u\{202E\}, on lines 2, 3\./.test(read) && /a change may copy the codes as shown/.test(read), read.split('\n').pop());
  const found = await tool('grep_code')({ dir: root, pattern: 'admin' });
  ok('a search shows them as codes, and names the lines by their numbers', typeof found === 'string' && found.includes('\\u{202E}') && !found.includes(RLO) && /on line 2\./.test(found), found);
  const quiet = await HC.code.readingQuietly('read_file', { path: 'server/roles.js' });
  const quietFound = await HC.code.readingQuietly('grep_code', { dir: '.', pattern: 'admin' });
  ok('the reading-only finding run shows them as codes too, by the numbers of a numbered read', quiet.includes('\\u{202E}') && !quiet.includes(RLO) && /on lines 2, 3\./.test(quiet) && quietFound.includes('\\u{202E}') && !quietFound.includes(RLO), quiet.split('\n').pop());
  HC.invoke = async (cmd) => (cmd === 'fs_read_file' ? 'plain text\n' : null);
  ok('a file with none of them is given back exactly as it was', await tool('read_file')({ path: `${root}/server/plain.js` }) === 'plain text\n');
}

console.log('\nA search that reaches files that usually hold keys:');
{
  let hits = [];
  HC.guard = { projectRoot: () => root, request: async () => true, allowedWithoutAsking: async () => true };
  HC.invoke = async (cmd) => (cmd === 'fs_grep' ? hits : cmd === 'fs_read_file' ? '' : cmd === 'fs_list_dir' ? [] : null);
  const tool = (n) => HC.code.TOOL_DEFINITIONS.find((t) => t.name === n).fn;
  hits = [{ path: `${root}/config/credentials.json`, line_no: 3, line: '"token": "invented-value"' }, { path: `${root}/src/app.js`, line_no: 9, line: 'const token = read();' }, { path: `${root}/config/credentials.json`, line_no: 4, line: '"token2": 1' }];
  const found = await tool('grep_code')({ dir: root, pattern: 'token' });
  ok('its lines are left out, and the rest shown', typeof found === 'string' && found.includes('src/app.js') && !found.includes('credentials.json') && !found.includes('invented-value'), found);
  ok('...with a line saying how many files, and that reading one asks', /\[1 file that usually holds keys was left out of this search\. read_file asks the person before reading one\.\]/.test(found), found);
  hits = [{ path: `${root}/.config/secrets.yaml`, line_no: 1, line: 'token: x' }];
  const only = await tool('grep_code')({ dir: root, pattern: 'token' });
  const said = typeof only === 'string' ? only : JSON.stringify(only);
  ok('when every line was in one, the search says nothing was found, and why', /No line in these files/.test(said) && /1 file that usually holds keys was left out/.test(said) && !said.includes('token: x'), said);
  hits = [{ path: `${root}/keys/server.pem`, line_no: 2, line: 'x' }, { path: `${root}/src/a.js`, line_no: 1, line: 'x' }];
  const quiet = await HC.code.readingQuietly('grep_code', { dir: '.', pattern: 'x' });
  ok('the reading-only finding run leaves them out the same way', !quiet.includes('server.pem') && /1 file that usually holds keys was left out/.test(quiet), quiet);
  const lines = await HC.code.linesQuietly('x');
  ok('the app\'s own search across the project never hands one on', Array.isArray(lines) && lines.length === 1 && lines[0].path.endsWith('src/a.js'), JSON.stringify(lines));
  hits = [{ path: `${root}/src/a.js`, line_no: 1, line: 'x' }];
  ok('a search with none says nothing of them', !/usually holds? keys/.test(await tool('grep_code')({ dir: root, pattern: 'x' })));
}

console.log('\nWhere the Coder calls it:');
{
  const mode = src('modes', 'code', 'mode.js');
  const line = mode.split('\n').find((l) => l.includes('window.HCCodeFind.before(conversationMsgs')) || '';
  ok('before the run\'s first step, with the outline only for this project, and the reads that never ask', /await window\.HCCodeFind\.before\(conversationMsgs, \{/.test(line)
    && line.includes("outline: sharedState.codeMap?.root === sharedState.projectRoot ? sharedState.codeMap.outline : ''") && /byName: HC\.code\.namesQuietly, byLine: HC\.code\.linesQuietly, list: HC\.code\.listQuietly, exists: HC\.code\.existsQuietly, run: HC\.code\.readingQuietly/.test(line)
    && mode.indexOf(line) < mode.indexOf('const finalText = await agentLoop(conversationMsgs, tools, contentEl'));
  ok('the finding run is the same model, stopped with the run', /ask: \(m, t\) => callWithRouter\(m, t, HC\.code\.temperatureFor\(sharedState\.size, window\._H\?\.selectedTemperature\?\.\(\), coderModel \|\| window\._H\?\.selectedModel\?\.\(\)\), signal, coderModel\)/.test(line) && /, signal \}\); \}/.test(line));
  ok('it is said as a step and in the trace', /verb: 'FIND', object: `files for this request, \$\{by\}`/.test(line) && /cdrTraceAdd\('Find'/.test(line));
  const tools = src('platform', 'tauri', 'hashcoder.js');
  const reads = tools.slice(tools.indexOf('HC.code.namesQuietly = '), tools.indexOf('HC.code.notThere = '));
  ok('each read is checked with the guard\'s test that never asks, and none calls the one that does', (reads.match(/allowedWithoutAsking\(/g) || []).length >= 3 && !/HC\.guard\.request\(/.test(reads));
  const boot = src('boot.js');
  ok('loaded after what it uses', boot.indexOf("'/js/code/find.js'") > boot.indexOf("'/js/code/search.js'") && boot.indexOf("'/js/code/search.js'") > 0);
  ok('pure but for what it is handed', !/\binvoke\(|HC\.invoke|fetch\(|XMLHttpRequest|require\(|import\(|localStorage|document\./.test(src('js', 'code', 'find.js')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/find.js)`);
process.exit(fail ? 1 : 0);
