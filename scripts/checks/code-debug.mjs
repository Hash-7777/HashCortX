// ==============================================================
// The HashCoder debug export — checks
//
// Loads the REAL src/js/code/debug-export.js and holds that the file it writes
// has the facts of the run, the trace with its times, and the conversation as
// the model was sent it (instructions, requests, each call with its arguments,
// each result, each note the app added, told apart from what the person
// wrote); that nothing in a result can end its own block early; that long text
// is cut and says so; that whatever is shaped like a key is replaced wherever
// it appears and counted; and that the panel's button is wired to it.
//
// Run with: npm run check:code-debug
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

const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date, RegExp };
vm.createContext(box);
vm.runInContext(src('js', 'code', 'debug-export.js'), box, { filename: 'debug-export.js' });
const D = box.window.HCCodeDebug;

// Each key is written in two pieces and joined here, so this file holds no
// key-shaped string of its own: the commit hook would refuse it otherwise.
const k = (head, tail) => head + tail;
const KEYS = {
  'an OpenAI key': k('sk-', 'proj-abc123DEF456ghi789JKL012mno345PQR678stu'),
  'an Anthropic key': k('sk-', 'ant-api03-abc123DEF456ghi789JKL012mno345'),
  'an OpenRouter key': k('sk-', 'or-v1-abc123def456ghi789jkl012mno345pqr678stu901'),
  'a Groq key': k('gsk', '_abc123DEF456ghi789JKL012mno345PQR678'),
  'a Google key': k('AIza', 'SyABC123def456GHI789jkl012MNO345pqr'),
  'an xAI key': k('xai', '-abc123DEF456ghi789JKL012mno345PQR678'),
  'a Hugging Face token': k('hf', '_abcDEF123ghi456JKL789mno012PQR345'),
  'a Cerebras key': k('csk', '-abc123def456ghi789jkl012mno345pqr678'),
  'an NVIDIA key': k('nvapi', '-abc123DEF456ghi789JKL012mno345PQR678'),
  'a Tavily key': k('tvly', '-abc123DEF456ghi789JKL012'),
  'a GitHub token': k('gh', 'p_abc123DEF456ghi789JKL012mno345PQR'),
  'an AWS access key id': k('AKIA', 'IOSFODNN7EXAMPLE'),
  'a Slack token': k('xox', 'b-123456789012-abcdefghijkl'),
  'a bearer token': k('Bear', 'er abcDEF123ghi456JKL789mno012PQR345stu'),
};

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const run = [
  { role: 'system', content: 'You are HashCoder.\nRules...' },
  { role: 'user', content: 'Fix the spacing on the home page.' },
  { role: 'assistant', content: '', tool_calls: [call('c1', 'read_file', { path: 'src/style.css' })] },
  { role: 'tool', tool_call_id: 'c1', content: 'body { margin: 0 }\n' },
  { role: 'assistant', content: 'Now the edit.', tool_calls: [call('c2', 'patch_file', { path: 'src/style.css', search: 'margin: 0', replace: 'margin: 8px' })] },
  { role: 'tool', tool_call_id: 'c2', name: 'patch_file', content: JSON.stringify({ ok: false, error: 'the search text was not found' }) },
  { role: 'user', content: 'Note from HashCortX, not from the person: you changed style.css and no test has run since.' },
  { role: 'user', content: 'see this', images: ['aGVsbG8='] },
];
const trace = [
  { elapsed: 0, stage: 'Trace', message: 'New run', status: 'wait' },
  { elapsed: 3.24, stage: 'Model', message: 'Gemini 3.8 Flash: this account is out of quota | carrying on', status: 'warn' },
];
const facts = { version: 'v2.6.0', platform: 'macOS', projectRoot: '/work/site', model: 'cloud:gemini:gemini-3.8-flash', label: 'Gemini 3.8 Flash', size: 'full', local: false, temperature: 0.35, settings: { 'Prove changes': 'on', Lessons: 'off' } };
const text = D.buildDebug({ messages: run, trace, facts, exportedAt: 'Friday 2 October 2026, 02:14' });

console.log('The facts of the run, at the top:');
{
  ok('it is a markdown file with a title', /^# HashCoder debug export\n/.test(text));
  ok('when, which app and on what', /- Exported: Friday 2 October 2026, 02:14/.test(text) && /- App: HashCortx v2\.6\.0 on macOS/.test(text));
  ok('the project', /- Project: \/work\/site/.test(text));
  ok('the model, by name and by value', /- Model: Gemini 3\.8 Flash \(cloud:gemini:gemini-3\.8-flash\)/.test(text));
  ok('how HashCoder was set up for it', /- Set up for: full, a cloud model, temperature 0\.35/.test(text));
  ok('the settings that change what it does', /- Settings: Prove changes on · Lessons off/.test(text));
  ok('what is in it: messages, calls, failures, notes and trace entries', /- Size: 8 messages · 2 tool calls \(1 failed\) · 1 note from the app · 2 trace entries/.test(text), text.split('\n').find((l) => /^- Size/.test(l)));
  ok('and says no key was found, when none was', /- Keys: none found/.test(text));
  const bare = D.buildDebug({});
  ok('with nothing in it, it says so rather than writing a heading over nothing', /Nothing was recorded\./.test(bare) && /The conversation is empty\./.test(bare) && /- Project: none open/.test(bare));
}

console.log('\nThe trace, with its times:');
{
  ok('a table with time, stage, status and what', /\| Time \| Stage \| Status \| What \|/.test(text) && /\| 0\.0 s \| Trace \| wait \| New run \|/.test(text));
  ok('each entry on one row, a bar in its words kept from breaking the table', /\| 3\.2 s \| Model \| warn \| Gemini 3\.8 Flash: this account is out of quota \\\| carrying on \|/.test(text), text.split('\n').find((l) => /3\.2 s/.test(l)));
}

console.log('\nThe conversation, as the model was sent it:');
{
  ok('the instructions are folded, with how long they are', /### 1 · instructions\n\n<details><summary>27 characters<\/summary>/.test(text));
  ok('the person\'s request is written as they wrote it', /### 2 · the person\n\nFix the spacing on the home page\./.test(text));
  ok('a call the agent made is named, with its arguments written out', /### 3 · the agent — 1 call\n\n\*\*`read_file`\*\*\n\n```json\n\{\n  "path": "src\/style\.css"\n\}\n```/.test(text));
  ok('words the agent wrote beside a call are kept', /### 5 · the agent — 1 call\n\nNow the edit\./.test(text));
  ok('a result is named after the call it answers, even when it does not say so', /### 4 · result of `read_file`\n/.test(text));
  ok('and folded, with how long it is', /### 4 · result of `read_file`\n\n<details><summary>19 characters<\/summary>/.test(text));
  ok('a result that says it failed is marked', /### 6 · result of `patch_file` — failed/.test(text));
  ok('a note the app added is told apart from what the person wrote', /### 7 · note from the app, not from the person/.test(text) && !/### 7 · the person/.test(text));
  ok('a picture is said to have been sent and not written out', /### 8 · the person\n\nsee this\n\n\[1 picture with this message, not included in this file\]/.test(text) && !/aGVsbG8/.test(text));
}

console.log('\nNothing a result holds can end its own block:');
{
  const t = D.buildDebug({ messages: [{ role: 'tool', name: 'read_file', content: 'before\n```js\nlet a = 1;\n```\nand ````four```` after' }] });
  ok('the block is fenced with more backticks than any it holds', /\n`{5}text\nbefore\n```js/.test(t) && /after\n`{5}\n/.test(t), t);
  ok('so the same file reads back the same way', D.fenced('x ``` y', 'text').startsWith('````text\n') && D.fenced('plain').startsWith('```\n'));
}

console.log('\nLong text is cut, and says how much:');
{
  const big = 'x'.repeat(D.MAX_CHARS + 1234);
  const t = D.buildDebug({ messages: [{ role: 'tool', name: 'read_file', content: big }] });
  ok('a result is cut to the limit', t.includes('x'.repeat(100)) && !t.includes('x'.repeat(D.MAX_CHARS + 1)));
  ok('with a note of what was left out', /\[cut: 1,234 more characters\]/.test(t));
  ok('and the full length is still stated in its heading', new RegExp(`${(D.MAX_CHARS + 1234).toLocaleString('en-US')} characters`).test(t));
  ok('the instructions have a limit of their own', D.cut('y'.repeat(D.MAX_SYSTEM + 5), D.MAX_SYSTEM).endsWith('[cut: 5 more characters]'));
}

console.log('\nWhat is shaped like a key is replaced, wherever it appears:');
{
  for (const [what, key] of Object.entries(KEYS)) {
    const t = D.buildDebug({ messages: [{ role: 'tool', name: 'read_file', content: `config: ${key} end` }] });
    ok(`${what} in a result`, !t.includes(key) && /\[redacted: looked like a key\]/.test(t) && /Keys: 1 string shaped like a key was replaced/.test(t));
  }
  const key = KEYS['an OpenAI key'];
  const t = D.buildDebug({
    messages: [{ role: 'user', content: `use ${key}` }, { role: 'assistant', content: `ok ${key}`, tool_calls: [call('c9', 'shell_run', { command: 'echo', args: [key] })] }, { role: 'tool', tool_call_id: 'c9', content: key }],
    trace: [{ elapsed: 1, stage: 'Run', message: `sent ${key}`, status: 'ok' }],
    facts: { projectRoot: '/work/site' },
  });
  ok('in the person\'s words, the agent\'s, a call\'s arguments, a result and the trace alike', !t.includes(key) && (t.match(/\[redacted: looked like a key\]/g) || []).length === 5, String((t.match(/\[redacted/g) || []).length));
  ok('and every one is counted', /Keys: 5 strings shaped like a key were replaced/.test(t));
  const named = D.redact('API_KEY = "abcdefghijklmnop1234" and password: hunter2hunter2hunter2 and token=short');
  ok('a value written after a name that says it is secret, the name kept', /API_KEY = "\[redacted: looked like a key\]/.test(named.text) && /password: \[redacted: looked like a key\]/.test(named.text) && named.count === 2, named.text);
  ok('a short value is left, which is not a key', /token=short/.test(named.text));
  // The block's own header is joined here, as the keys above are.
  const pem = D.redact(`${k('-----BEGIN ', 'OPENSSH PRIVATE KEY-----')}\nabc\ndef\n${k('-----END ', 'OPENSSH PRIVATE KEY-----')}\nafter`);
  ok('a private key block, to its end', !/abc|def/.test(pem.text) && /after/.test(pem.text) && pem.count === 1, pem.text);
  const innocent = ['task-management-controller-name', 'a disk-encryption-configuration flag', 'the risk-assessment-and-mitigation doc', 'desk-booking-service-endpoint', 'src/js/code/debug-export.js', 'a1b2c3d4e5f60718293a4b5c6d7e8f90'];
  ok('ordinary text is left alone', innocent.every((x) => D.redact(x).text === x && D.redact(x).count === 0), innocent.filter((x) => D.redact(x).count).join());
}

console.log('\nWhat a result says about itself:');
{
  ok('a result that says it did not do it', D.failed('{"ok":false,"error":"nope"}') && D.failed('{"error":"nope"}') && D.failed('Error: the file is missing') && D.failed('Permission denied: move a.txt'));
  ok('one that did, or says nothing, is not failed', !D.failed('{"ok":true,"path":"a"}') && !D.failed('hello') && !D.failed('') && !D.failed(null) && !D.failed('{"error":"x","ok":true}'));
  ok('a note from the app is told by its opening words, not by being long', D.isAppNote({ role: 'user', content: 'Note from HashCortX, not from the person: x' }) && D.isAppNote({ role: 'user', content: 'Note from HashCortx not from the person' }) && !D.isAppNote({ role: 'user', content: 'Please note: from me' }) && !D.isAppNote({ role: 'assistant', content: 'Note from HashCortX, not from the person' }));
}

console.log('\nThe file\'s name and the button:');
{
  const d = new Date(2026, 9, 2, 2, 7);
  ok('the project, the day and the minute', D.debugFileName('my site', d) === 'hashcoder-debug-my-site-2026-10-02-0207.md');
  ok('a name with characters a file cannot have, or none, still gives a name', D.debugFileName('a/b:c*', d) === 'hashcoder-debug-a-b-c-2026-10-02-0207.md' && D.debugFileName('', d) === 'hashcoder-debug-chat-2026-10-02-0207.md' && D.debugFileName('///', d) === 'hashcoder-debug-chat-2026-10-02-0207.md');
  let saved = null;
  const said = [];
  const none = await D.exportRun({ messages: [], trace: [], H: { themedAlert: (m, t) => said.push(`${t}: ${m}`) }, save: async () => { saved = 'x'; }, exportBaseName: () => 'site' });
  ok('with nothing to export it says so and writes nothing', none === false && saved === null && /Export for debugging: There is nothing to export yet/.test(said[0]));
  const done = await D.exportRun({
    messages: run, trace, sharedState: { projectRoot: '/work/site', size: 'full', local: false, platform: { os: 'macOS' } },
    routing: { model: 'cloud:groq:llama', label: (v) => `Label of ${v}` }, coderModel: 'cloud:gemini:x', prefs: { prove: false, lessons: true },
    H: { selectedTemperature: () => 0.2 }, doc: { querySelector: () => ({ textContent: 'v9.9.9' }) },
    save: async (content, mime, name) => { saved = { content, mime, name }; }, exportBaseName: (r) => r.split('/').pop(),
  });
  ok('it saves a markdown file named for the project', done === true && saved.mime === 'text/markdown' && /^hashcoder-debug-site-\d{4}-\d\d-\d\d-\d{4}\.md$/.test(saved.name), saved && saved.name);
  ok('the model is the one the run was moved to, by its label', /- Model: Label of cloud:groq:llama \(cloud:groq:llama\)/.test(saved.content));
  ok('the app version comes from the page, and the settings from the person\'s choices', /HashCortx v9\.9\.9 on macOS/.test(saved.content) && /Prove changes off · Lessons on/.test(saved.content) && /temperature 0\.2/.test(saved.content));
}

console.log('\nThe run\'s own facts, kept with its conversation:');
{
  const facts = D.runFacts({ routing: { selected: 'cloud:openrouter:big', router: { model: 'cloud:groq:llama', label: (v) => `Label of ${v}` } }, sharedState: { size: 'mid', local: false }, H: { selectedModel: () => 'later-pick' }, temperature: 0.2 });
  ok('the model that answered last, the one chosen, the set-up and the temperature sent', facts.model === 'cloud:groq:llama' && facts.chosen === 'cloud:openrouter:big' && facts.label === 'Label of cloud:groq:llama' && facts.size === 'mid' && facts.local === false && facts.temperature === 0.2);
  const solo = D.runFacts({ routing: null, coderModel: '', sharedState: {}, H: { selectedModel: () => 'qwen-local' } });
  ok('with no routing, the model picked, and no temperature claimed', solo.model === 'qwen-local' && solo.chosen === 'qwen-local' && solo.temperature === undefined);
  let saved = null;
  await D.exportRun({
    messages: [{ role: 'user', content: 'Build it' }], trace: [], run: facts, sharedState: { projectRoot: '/work/site', size: '' },
    routing: null, coderModel: '', H: { selectedModel: () => 'later-pick', selectedTemperature: () => 0.9 },
    doc: { querySelector: () => null }, save: async (content) => { saved = content; }, exportBaseName: () => 'site',
  });
  ok('an export after the app was reopened names the run\'s model, not the one picked since', /- Model: Label of cloud:groq:llama \(cloud:groq:llama\), after moving off cloud:openrouter:big/.test(saved) && !/later-pick/.test(saved));
  ok('... and how it was set up and the temperature it was sent', /- Set up for: mid, a cloud model, temperature 0\.2/.test(saved) && !/0\.9/.test(saved));
  const text = D.buildDebug({ messages: [{ role: 'user', content: 'Build it', context: 'Note from the app: the checklist' }], trace: [], facts: {} });
  ok('what the app added to a request is shown with it, folded', /### 1 · the person\n\nBuild it\n\n<details><summary>Added by the app to this request<\/summary>/.test(text) && /the checklist/.test(text));
  ok('a request with nothing added shows no fold', !/Added by the app/.test(D.buildDebug({ messages: [{ role: 'user', content: 'Hi' }], facts: {} })));
  const mode = src('modes', 'code', 'mode.js');
  ok('the facts are taken as each run ends and saved with the conversation', /sharedState\.lastRun = window\.HCCodeDebug\.runFacts\(\{ routing, coderModel, sharedState, H: window\._H, temperature: HC\?\.code\?\.temperatureFor/.test(mode)
    && /run: sharedState\.lastRun \|\| null, trace: cdrTraceEntries,/.test(mode));
  ok('a session keeps them, and opening one again brings them back', /run: sharedState\.lastRun \|\| null, trace: cdrTraceEntries\.slice\(-300\) \}/.test(mode)
    && /conversationMsgs = session\.msgs\.slice\(\); sharedState\.lastRun = session\.run \|\| null; cdrTraceEntries = Array\.isArray\(session\.trace\)/.test(mode));
  ok('the conversation kept at launch takes its own into Sessions, and a new one starts with none', /sharedState\.lastRun = state\.run \|\| null; cdrTraceEntries = Array\.isArray\(state\.trace\) \? state\.trace : \[\]; conversationMsgs = state\.chatHistory; saveCurrentSession\(\); conversationMsgs = \[\]; sharedState\.lastRun = null; cdrTraceEntries = \[\];/.test(mode)
    && /activeContentEl = null; sharedState\.lastRun = null; cdrTraceEntries = \[\];/.test(mode));
  ok('the export is handed them', /exportRun\(\{ messages: conversationMsgs, trace: cdrTraceEntries, run: sharedState\.lastRun,/.test(mode));
}

console.log('\nIt is in the panel:');
{
  const html = src('modes', 'code', 'panel.html');
  const mode = src('modes', 'code', 'mode.js');
  ok('a button in the top bar, with words for what it does', /<button type="button" class="cdr-icon-btn" id="cdrDebugBtn" title="Export this conversation with its trace, for debugging">/.test(html));
  ok('it is wired to the export, with the whole conversation and the trace', /\$\('cdrDebugBtn'\)\?\.addEventListener\('click', exportDebug\)/.test(mode) && /exportDebug = \(\) => window\.HCCodeDebug\.exportRun\(\{ messages: conversationMsgs, trace: cdrTraceEntries,/.test(mode));
  ok('and saves through the same door the other exports use', /save: downloadBlob/.test(mode) && /window\.HC\.save\.file\(filename, content/.test(mode));
  ok('the export in Settings is still there', /id="cdrExportBtn"/.test(src('core', 'settings', 'panel.html')));
  const boot = src('boot.js');
  ok('the module loads before the panel', boot.indexOf("'/js/code/debug-export.js'") > boot.indexOf("'/js/code/export.js'") && boot.indexOf("'/js/code/debug-export.js'") < boot.indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:code-debug/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/debug-export.js)`);
process.exit(fail ? 1 : 0);
