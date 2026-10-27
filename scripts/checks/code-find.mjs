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
for (const f of [['js', 'code', 'search.js'], ['js', 'code', 'talk.js'], ['js', 'code', 'paths.js'], ['js', 'code', 'patch.js'], ['platform', 'tauri', 'hashcoder.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
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
  ok('a path is one name', plain(F.termsOf('fix server/routes/rooms in the api')).some((x) => x.text === 'server/routes/rooms'));
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
  'web/src/booking.js': "import { rate } from './api';\n",
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

console.log('\nWhere the Coder calls it:');
{
  const mode = src('modes', 'code', 'mode.js');
  const line = mode.split('\n').find((l) => l.includes('window.HCCodeFind.before(conversationMsgs')) || '';
  ok('before the run\'s first step, with the outline only for this project, and the reads that never ask', /await window\.HCCodeFind\.before\(conversationMsgs, \{/.test(line)
    && line.includes("outline: sharedState.codeMap?.root === sharedState.projectRoot ? sharedState.codeMap.outline : ''") && /byName: HC\.code\.namesQuietly, byLine: HC\.code\.linesQuietly, exists: HC\.code\.existsQuietly, run: HC\.code\.readingQuietly/.test(line)
    && mode.indexOf(line) < mode.indexOf('const finalText = await agentLoop(conversationMsgs, tools, contentEl'));
  ok('the finding run is the same model, stopped with the run', /ask: \(m, t\) => callWithRouter\(m, t, HC\.code\.temperatureFor\(sharedState\.size, window\._H\?\.selectedTemperature\?\.\(\)\), signal, coderModel\)/.test(line) && /, signal \}\); \}/.test(line));
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
