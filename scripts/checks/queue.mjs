// ==============================================================
// Messages sent while a model is working — checks
//
// Loads the REAL src/js/queue.js and src/js/code/verify.js, and holds that a
// message sent while a workspace is busy waits in a queue rather than being
// refused or starting work over the work under way; that the queue is sent
// as one message when the work finishes, and handed back to the box when it
// was stopped or failed; that a draft being typed is kept; that HashCoder
// reads a queued message at its next step and holds the run to it; and that
// each workspace that takes messages is wired to it.
//
// The box is a small stand-in with the properties the queue uses; the queue
// as drawn is driven in the real page by hand and by the probes.
//
// Run with: npm run check:queue
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

// A text box as the queue uses it: a value, events, focus.
function box(value = '') {
  const listeners = {};
  return {
    value, ownerDocument: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent(e) { for (const fn of listeners[e.type] || []) fn(e); return true; },
    focus() {}, blur() {}, setSelectionRange() {},
    key(k) { const e = { type: 'keydown', key: k, prevented: false, preventDefault() { this.prevented = true; } }; this.dispatchEvent(e); return e; },
  };
}

const timers = [];
const sandbox = { console, Event: class { constructor(type) { this.type = type; } }, setTimeout: (fn) => { timers.push(fn); return timers.length; } };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'queue.js'), sandbox, { filename: 'queue.js' });
vm.runInContext(src('js', 'code', 'verify.js'), sandbox, { filename: 'verify.js' });
const Q = sandbox.HCQueue;
const V = sandbox.HCCodeVerify;
const flush = () => { while (timers.length) timers.shift()(); };

console.log('The queue:');
{
  const q = Q.create();
  ok('a message is queued, spaces alone are not', q.add('make the header blue') > 0 && q.add('   ') === 0 && q.size === 1);
  q.add('and the footer too');
  ok('several are one message, in the order written', q.text === 'make the header blue\n\nand the footer too');
  const first = q.items[0].id;
  ok('one can be taken out', q.remove(first).text === 'make the header blue' && q.size === 1);
  ok('taking all of them empties it', q.take().length === 1 && q.size === 0);
}

console.log('\nA message sent while a reply is written:');
{
  const input = box('make the header blue');
  let sent = [];
  const send = () => { sent.push(input.value); input.value = ''; };
  let how = {};
  const c = Q.forComposer({ input, send, outcome: () => how });
  ok('is queued and the box emptied, nothing sent', c.hold() === true && input.value === '' && c.size === 1 && sent.length === 0);
  input.value = 'and the footer';
  c.hold();
  c.settle();
  ok('nothing is sent until what was running has finished saying so', sent.length === 0);
  flush();
  ok('then the queue is sent as one message', sent.length === 1 && sent[0] === 'make the header blue\n\nand the footer' && c.size === 0, JSON.stringify(sent));

  sent = [];
  input.value = 'one more thing';
  c.hold();
  input.value = 'a draft I am typing';
  c.settle(); flush();
  ok('a draft being typed is kept in the box, and not sent with it', sent.length === 1 && sent[0] === 'one more thing' && input.value === 'a draft I am typing', `${JSON.stringify(sent)} / ${input.value}`);

  sent = [];
  input.value = 'after the stop';
  c.hold();
  how = { stopped: true };
  input.value = 'draft';
  c.settle(); flush();
  ok('a reply that was stopped hands the queue back to the box, before the draft, unsent', sent.length === 0 && input.value === 'after the stop\n\ndraft');

  input.value = 'after the error';
  c.hold();
  how = { failed: true };
  c.settle(); flush();
  ok('so does one that failed', sent.length === 0 && input.value === 'after the error');

  how = {};
  const stubborn = box('');
  const d = Q.forComposer({ input: stubborn, send: () => {}, outcome: () => ({}) });
  stubborn.value = 'needs a model';
  d.hold();
  stubborn.value = 'draft';
  d.settle(); flush();
  ok('a send that did not take it leaves it in the box, with the draft after it', stubborn.value === 'needs a model\n\ndraft');
}

console.log('\nTaking a queued message back:');
{
  const input = box('');
  const c = Q.forComposer({ input });
  input.value = 'first'; c.hold();
  input.value = 'second'; c.hold();
  const e = input.key('ArrowUp');
  ok('the Up arrow in an empty box takes the newest back to edit', e.prevented && input.value === 'second' && c.size === 1);
  const again = input.key('ArrowUp');
  ok('...but not over what the box holds', !again.prevented && input.value === 'second' && c.size === 1);
}

console.log('\nHashCoder reads it at the next step:');
{
  const c = Q.forComposer({ input: box(''), when: 'Read at the next step' });
  c.add('also make the header blue');
  c.add('and keep the logo');
  const now = c.takeNow();
  ok('every queued message, as one, with how many', now && now.text === 'also make the header blue\n\nand keep the logo' && now.count === 2 && c.size === 0);
  ok('nothing queued, nothing taken', c.takeNow() === null);
  const msgs = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'build a page for the bakery' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', name: 'write_file', arguments: {} }] },
    { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
    { role: 'user', content: 'also make the header blue', added: true },
    { role: 'user', content: `${V.APP_NOTE} check your work against the request.`, note: true },
  ];
  ok('the run is held to the request and what was added to it, in order', V.requestIn(msgs) === 'build a page for the bakery\n\nalso make the header blue');
  const searched = [...msgs.slice(0, 2), { role: 'assistant', content: '', tool_calls: [{ id: 's', name: 'web_search', arguments: {} }] }, { role: 'tool', tool_call_id: 's', content: '{}' }, { role: 'user', content: 'and its hours', added: true }];
  ok('a search before something was added still counts for the run', V.searchedSince(searched));
}

console.log('\nThe workspaces:');
{
  const app = src('js', 'app.js');
  ok('chat: Enter while a reply is written queues the message', /async function send\(\) \{\n\s*if \(state\.streaming\) \{ chatQueue\.hold\(\); return; \}/.test(app));
  ok('...and when a reply ends, the queue is sent or handed back, for one model and two side by side', (app.match(/state\.streaming = false;\n\s*sendBtn\.textContent = "Send"; chatQueue\.settle\(\);/g) || []).length === 2);
  ok('...stopped and failed read from the reply\'s own stop and error', /outcome: \(\) => \(\{ stopped: !!state\.abort\?\.signal\?\.aborted, failed: !!errorSlot\?\.childElementCount \}\)/.test(app));
  const coder = src('modes', 'code', 'mode.js');
  ok('HashCoder: a run started while one works queues instead, and starts no second run', /async function startRun\(\) \{\n\s*if \(running \|\| runAbort\) \{ coderQueue\?\.hold\(\); return; \}\n\s*running = true; outcome = \{\};\n\s*try \{ await beginRun\(\); \} finally \{ running = false; coderQueue\?\.settle\(\); \}/.test(coder));
  ok('...the run reads it at the top of each step, the person\'s message kept in the conversation and the request', /const added = messages === conversationMsgs \? coderQueue\?\.takeNow\(\) : null;/.test(coder)
    && /if \(added\) \{ messages\.push\(\{ role: 'user', content: added\.text, added: true \}\); if \(HC\?\.code\) HC\.code\.request = /.test(coder)
    && coder.indexOf('const added = messages === conversationMsgs') < coder.indexOf("turn = forced || await callWithRouter("));
  ok('...shown where it was read, outside the steps that fold, live and when drawn again', /window\.HCCodeSteps\.added\(contentEl, added\.text\); scrollMessages\(\);/.test(coder) && /if \(m\.role === 'user' && m\.added && reply\) \{ window\.HCCodeSteps\.added\(reply, m\.content\); return; \}/.test(coder));
  ok('...a stop or error hands the queue back, for a run and for Regenerate', /outcome = \{ stopped: e\.name === 'AbortError', failed: e\.name !== 'AbortError' \};/.test(coder) && /setRouterChip\('Auto', ''\); coderQueue\?\.settle\(\);/.test(coder));
  ok('it loads before the app and every mode', src('boot.js').indexOf("'/js/queue.js'") > 0 && src('boot.js').indexOf("'/js/queue.js'") < src('boot.js').indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:queue\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/queue.js)`);
process.exit(fail ? 1 : 0);
