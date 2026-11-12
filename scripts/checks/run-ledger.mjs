// ==============================================================
// The run's ledger — checks
//
// Loads the real src/js/run-ledger.js with the real modules it reads
// (asks, plan, verify, facts, the context rules) and holds what the ledger
// keeps of a run: each request with its asks and its limits, the files
// changed, the commands run, the newest plan, what was read, details the
// sources gave, and what the person added while it worked. Then the note
// written from it: what it drops first when it is over its size, and what
// it never drops. Every conversation here is invented.
//
// Run with: npm run check:run-ledger
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const load = (box, ...p) => vm.runInContext(src(...p), box, { filename: p[p.length - 1] });

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const p of [['js', 'fences.js'], ['js', 'code', 'verify.js'], ['js', 'code', 'plan.js'], ['js', 'code', 'facts.js'], ['js', 'code', 'asks.js'], ['js', 'agent-context.js'], ['js', 'run-ledger.js']]) load(sandbox, ...p);
const L = sandbox.HCRunLedger;

// The same module with nothing beside it, to show it stands alone.
const bare = { console };
bare.window = bare;
vm.createContext(bare);
load(bare, 'js', 'run-ledger.js');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

let ids = 0;
const call = (name, args, content) => {
  const id = `call_${++ids}`;
  return [
    { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    { role: 'tool', tool_call_id: id, name, content: typeof content === 'string' ? content : JSON.stringify(content) },
  ];
};
const req = (content, extra = {}) => Object.assign({ role: 'user', content }, extra);
const ans = (content) => ({ role: 'assistant', content });
const done = (path) => ({ ok: true, path, bytes: 120 });
const shell = (code) => ({ code, stdout: code ? '1 failed' : '4 passed', stderr: '' });

const FIRST = 'Fix the menu so it closes on a tap outside it. Also add a footer with the opening hours. ' +
  'And also rename the header class to site-head. Do not change the tests. Keep the colours as they are.';

function run() {
  ids = 0;
  return [
    { role: 'system', content: 'You are a coding agent.' },
    req(FIRST),
    ...call('read_file', { path: 'src/menu.js' }, 'const open = false;\nfunction close() {}\nexport { close };'),
    ...call('read_file', { path: 'src/long.js', start_line: 1, end_line: 200 }, '[src/long.js: lines 1-200 of 900.]\nline one'),
    ...call('update_plan', { steps: [{ step: 'close the menu', status: 'done' }, { step: 'add the footer', status: 'doing' }, { step: 'rename the class', status: 'todo' }] }, '{"ok":true}'),
    ...call('patch_file', { path: 'src/menu.js', search: 'a', replace: 'b' }, done('src/menu.js')),
    ...call('patch_file', { path: 'src/menu.js', search: 'c', replace: 'd' }, done('src/menu.js')),
    ...call('write_file', { path: 'src/footer.css', content: 'footer {}' }, done('src/footer.css')),
    ...call('write_file', { path: 'src/refused.js', content: 'x' }, { error: 'Permission denied: write src/refused.js.' }),
    ...call('fetch_url', { url: 'https://example.org/hours' }, 'The shop is open 9am to 5pm, Monday to Friday. Call 020 7946 0018.'),
    ...call('shell_run', { command: 'npm', args: ['test'] }, shell(0)),
    req('Use a darker grey for the footer text.', { added: true }),
    req('Note from HashCortX, not from the person: run the tests.', { note: true }),
    ans('The menu now closes on a tap outside it, and the footer with the opening hours is added. The header class is not renamed yet.'),
    req('Now move the footer styles into styles/footer.css and delete src/old.js.'),
    ...call('move_file', { from: 'src/footer.css', to: 'styles/footer.css' }, { ok: true, from: 'src/footer.css', to: 'styles/footer.css' }),
    ...call('delete_file', { path: 'src/old.js' }, { ok: true, path: 'src/old.js' }),
    ...call('shell_run', { command: 'mkdir', args: ['-p', 'styles/print'] }, shell(0)),
    ...call('shell_run', { command: 'npm', args: ['test'] }, shell(1)),
    { role: 'user', content: 'Opened a picture.', opened: true, images: ['QUJD'] },
    ...call('update_plan', { steps: [{ step: 'move the styles', status: 'done' }, { step: 'delete the old file', status: 'done' }] }, '{"ok":true}'),
  ];
}

console.log('\nWhat the ledger keeps of a run:');
{
  const messages = run();
  const before = json(messages);
  const led = L.from(messages);
  ok('the same messages give the same ledger, twice', json(L.from(messages)) === json(led));
  ok('...and the messages are not changed', json(messages) === before);
  ok('every request the person made, numbered, and no note, opened picture or added message among them', json(led.requests.map((r) => r.n)) === '[1,2]' && led.requests[1].text.startsWith('Now move the footer'), json(led.requests.map((r) => r.text)));
  ok('a request is kept to its first 300 characters', L.from([req('x'.repeat(500))]).requests[0].text.length <= 301);
  const r1 = led.requests[0];
  ok('the asks of a request of several, numbered', r1.asks.length >= 3 && json(r1.asks.map((a) => a.n)) === json(r1.asks.map((_, i) => i + 1)), json(r1.asks));
  const answered = r1.asks.filter((a) => a.state === 'answered').map((a) => a.text);
  const open = r1.asks.filter((a) => a.state === 'open').map((a) => a.text);
  ok('an ask whose words the answer that request ended with says is answered', answered.some((t) => /menu/i.test(t)), json(r1.asks));
  ok('...and one it does not say is open', open.some((t) => /rename the header/i.test(t)), json(r1.asks));
  ok('what the request says to leave as it is', r1.limits.some((t) => /^Do not change the tests/.test(t)) && r1.limits.some((t) => /^Keep the colours/.test(t)), json(r1.limits));
  ok('a request with no limit has none', json(led.requests[1].limits) === '[]');
  const changed = Object.fromEntries(led.changed.map((c) => [c.path, c]));
  ok('a file changed twice is one entry, counted twice', changed['src/menu.js'] && changed['src/menu.js'].how === 'edited' && changed['src/menu.js'].times === 2, json(led.changed));
  ok('a new file is made', changed['src/footer.css'] && changed['src/footer.css'].how === 'made');
  ok('a refused write is not a change', !changed['src/refused.js']);
  ok('a move, by where the file went', changed['styles/footer.css'] && changed['styles/footer.css'].how === 'moved' && changed['styles/footer.css'].from === 'src/footer.css');
  ok('a deletion', changed['src/old.js'] && changed['src/old.js'].how === 'deleted');
  ok('what a command that worked made', changed['styles/print'] && changed['styles/print'].how === 'made');
  ok('every command run, with its kind and whether it passed', json(led.ran.map((r) => [r.command, r.kind, r.passed])) === json([['npm test', 'test', true], ['mkdir -p styles/print', 'other', true], ['npm test', 'test', false]]), json(led.ran));
  ok('a check run before a later change is not after the last change; the last one is', led.ran[0].afterLastChange === false && led.ran[2].afterLastChange === true, json(led.ran));
  ok('the newest plan only, in its three states', json(led.plan) === json([{ text: 'move the styles', state: 'done' }, { text: 'delete the old file', state: 'done' }]), json(led.plan));
  const first = L.from(messages.slice(0, 12)).plan;
  ok('...a step in work is doing, one not begun is open', json(first.map((s) => s.state)) === '["done","doing","open"]', json(first));
  ok('what was read, the window of a long file and all of a short one', json(led.read) === json([{ path: 'src/menu.js', lines: 'all' }, { path: 'src/long.js', lines: '1-200' }]), json(led.read));
  ok('details the sources gave', led.confirmed.length > 0 && led.confirmed.every((c) => typeof c === 'string'), json(led.confirmed));
  ok('what the person added while it worked', json(led.added) === json([{ text: 'Use a darker grey for the footer text.', kind: 'add' }]), json(led.added));
}

console.log('\nA read is kept once, the newest twenty:');
{
  const many = [req('Look through the project.')];
  for (let i = 1; i <= 25; i++) many.push(...call('read_file', { path: `src/f${i}.js` }, 'one line'));
  many.push(...call('read_file', { path: 'src/f1.js', start_line: 5, end_line: 9 }, '[src/f1.js: lines 5-9 of 40.]\nfive'));
  const read = L.from(many).read;
  ok('twenty at most', read.length === 20, String(read.length));
  ok('a file read again is kept once, as last read', read.filter((r) => r.path === 'src/f1.js').length === 1 && read[read.length - 1].lines === '5-9', json(read.slice(-2)));
  ok('the oldest go first', !read.some((r) => r.path === 'src/f2.js') && read.some((r) => r.path === 'src/f25.js'));
}

console.log('\nAsks added while it worked join the request in work:');
{
  const added = [req('Fix the login form.'), req('Also add a reset link. And make the button wider. Can you check the error text too?', { added: true })];
  const r = L.from(added).requests;
  ok('numbered on, on the request they were added to', r.length === 1 && r[0].asks.length >= 3 && r[0].asks[0].n === 1, json(r));
}

console.log('\nThe note written from it:');
{
  const led = L.from(run());
  const text = L.note(led, { most: 3000 });
  ok('it holds an open ask, a limit and a changed file of a request', /rename the header/i.test(text) && /Do not change the tests/.test(text) && /src\/menu\.js/.test(text), text);
  ok('it is plain text from the record, every request in it', /Now move the footer/.test(text) && typeof text === 'string');
  ok('sizes for each model size', L.MOST.small === 900 && L.MOST.mid === 1600 && L.MOST.full === 3000);
  ok('it is the same for the same ledger', L.note(led, { most: 3000 }) === text);

  // Over its size: what goes first.
  const big = JSON.parse(json(led));
  for (let i = 0; i < 20; i++) big.read.push({ path: `src/extra/reading-${i}.js`, lines: 'all' });
  for (let i = 0; i < 9; i++) big.ran.push({ command: `npm run step-${i}`, kind: 'other', passed: true, afterLastChange: false });
  const full = L.note(big, { most: 100000 });
  ok('under its size, nothing is dropped', /reading-19/.test(full) && /step-0/.test(full) && full.includes(led.confirmed[0]) && /\[answered\]/.test(full) && /\[done\]/.test(full), full);
  // In the order things go: what was read, commands beyond the newest five,
  // details the sources gave, answered asks, finished plan steps, the newest
  // commands. Whatever the size, a later kind is only gone once every earlier one is.
  const present = (t) => [/reading-/.test(t), /step-0/.test(t), t.includes(led.confirmed[0]), /\[answered\]/.test(t), /\[done\]/.test(t), /step-8/.test(t)];
  let inOrder = true;
  const gone = new Set();
  for (let most = full.length; most >= 10; most -= 20) {
    const t = L.note(big, { most });
    const p = present(t);
    p.forEach((here, i) => { if (!here) gone.add(i); });
    for (let i = 1; i < p.length; i++) if (!p[i] && p.slice(0, i).some(Boolean)) inOrder = false;
    if (t.length > most && p.some(Boolean)) inOrder = false;   // something that could go is left while over the size
  }
  ok('over its size, things go in that order, and only while it is over', inOrder && gone.size === 6, `${inOrder} ${[...gone]}`);
  const tight = L.note(big, { most: 10 });
  ok('an open ask, a limit and a changed file are never dropped, even past its size', /rename the header/i.test(tight) && /Do not change the tests/.test(tight) && /src\/menu\.js/.test(tight) && /styles\/footer\.css/.test(tight), tight);
  ok('...nor the requests, nor what the person added', /Now move the footer/.test(tight) && /darker grey/.test(tight), tight);
  const planned = JSON.parse(json(led));
  planned.plan = [{ text: 'write the print styles', state: 'open' }, { text: 'tidy the menu', state: 'done' }];
  const p10 = L.note(planned, { most: 10 });
  ok('...nor an open plan step, while a finished one goes', /write the print styles/.test(p10) && !/tidy the menu/.test(p10), p10);
  ok('a ledger of nothing writes nothing', L.note(L.from([]), { most: 900 }) === '');
}

console.log('\nIt stands alone:');
{
  const B = bare.HCRunLedger;
  const led = B.from(run());
  ok('with none of the modules it reads, the requests, changes and commands are still kept', led.requests.length === 2 && led.changed.length > 0 && led.ran.length === 3, json(led));
  ok('...asks and details from the sources are then left empty, never guessed', led.requests.every((r) => json(r.asks) === '[]') && json(led.confirmed) === '[]');
  ok('nothing given is nothing kept', json(B.from(null)) === json({ requests: [], changed: [], ran: [], plan: [], read: [], confirmed: [], added: [] }));
  const boot = src('boot.js');
  ok('it is loaded before the context rules that will use it', boot.indexOf("'/js/run-ledger.js'") > 0 && boot.indexOf("'/js/run-ledger.js'") < boot.indexOf("'/js/agent-context.js'"));
  ok('it is part of npm run check', /npm run check:run-ledger/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/run-ledger.js)`);
process.exit(fail ? 1 : 0);
