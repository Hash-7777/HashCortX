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

console.log('\nSend now:');
{
  const input = box('');
  let sent = [], cut = 0;
  const send = () => { sent.push(input.value); input.value = ''; };
  const c = Q.forComposer({ input, send, outcome: () => ({ stopped: true }), interrupt: () => { cut++; } });
  ok('nothing queued, nothing to send now', c.sendNow() === false && cut === 0);
  input.value = 'use the blue logo'; c.hold();
  ok('the work under way is asked to give way, once however often it is pressed', c.sendNow() === true && c.sendNow() === false && cut === 1 && c.urgent);
  c.settle(); flush();
  ok('stopped for it, the queue is sent, not handed back', sent.length === 1 && sent[0] === 'use the blue logo' && input.value === '' && !c.urgent, JSON.stringify(sent));
  input.value = 'after a real stop'; c.hold(); c.settle(); flush();
  ok('a stop the person made still hands it back', sent.length === 1 && input.value === 'after a real stop');
  const d = Q.forComposer({ input: box(''), interrupt: () => {} });
  d.add('also the footer'); d.sendNow();
  ok('a run that reads it at its next step takes it, and the queue is no longer in a hurry', d.takeNow().text === 'also the footer' && !d.urgent);
  ok('a workspace that gives no way to give way has no Send now', Q.forComposer({ input: box('') }).sendNow() === false);
  const k = box('');
  let held = 0;
  const e = Q.forComposer({ input: k, interrupt: () => { held++; } });
  k.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') e.hold(); });   // the box's own Enter, as each workspace has
  k.value = 'right away';
  k.dispatchEvent({ type: 'keydown', key: 'Enter', ctrlKey: true, metaKey: false, shiftKey: false, preventDefault() {} });
  flush();
  ok('Ctrl+Enter while the work goes on queues it and sends it now', e.size === 1 && e.urgent && held === 1);
  const plain = box('');
  const f = Q.forComposer({ input: plain, interrupt: () => { held++; } });
  plain.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') f.hold(); });
  plain.value = 'in its turn';
  plain.dispatchEvent({ type: 'keydown', key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} });
  flush();
  ok('...Enter alone only queues it', f.size === 1 && !f.urgent && held === 1);
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
  const erp = src('js', 'systems', 'agent-chat.js');
  ok('the ERP agent: a message sent while it works waits, and goes when it is no longer busy, or back to the box after Stop', /if \(busy && text\) \{ queue\?\.hold\(\); return; \}/.test(erp) && /else if \(was\) queue\?\.settle\(\);/.test(erp) && /\{ stopped = true; if \(deps\) deps\.stop\(\); \}/.test(erp));
  const fin = src('modes', 'finance', 'mode.js');
  ok('Finance: a request sent while one is under way waits for it, rather than running beside it', /async function submitPrompt\(\) \{ if \(finBusy\) \{ finQueue\?\.hold\(\); return; \} finBusy = true; try \{ await submitNow\(\); \} finally \{ finBusy = false; finQueue\?\.settle\(\); \} \}/.test(fin)
    && /outcome: \(\) => \(\{ stopped: !!abortCtrl\?\.signal\?\.aborted, failed: !!document\.getElementById\("finStatusDot"\)\?\.classList\.contains\("error"\) \}\)/.test(fin));
  const forge = src('modes', 'forge', 'mode.js');
  ok('3D Forge: a prompt sent while a part is made waits and is made next, instead of stopping the part under way', /if \(abortCtrl && !useSample\) \{ frgQueue\?\.hold\(\); return; \}/.test(forge) && /finally \{ if \(abortCtrl === ctrl\) abortCtrl = null; frgQueue\?\.settle\(\); \}/.test(forge)
    && forge.indexOf('frgQueue?.hold()') < forge.indexOf('if (abortCtrl) abortCtrl.abort();'));
  const ws = src('js', 'swarm', 'workspace.js');
  ok('the Agent Swarm: a message sent while an agent answers waits for that answer', /if \(raw && state\.asking && !state\.asking\.team\) \{ queue\?\.hold\(\); return; \}/.test(ws) && /queue\?\.settle\(\);/.test(ws));
  ok('Send now: chat stops the reply, kept as written', /interrupt: \(\) => abort\(\) \}\);/.test(app));
  ok('...HashCoder stops only the model step under way, which the run gives up for the message and goes on', /send: \(\) => startRun\(\), outcome: \(\) => outcome, interrupt: \(\) => stepAbort\?\.abort\(\) \}\);/.test(coder)
    && /const step = new AbortController\(\), give = \(\) => step\.abort\(\); if \(signal\?\.aborted\) step\.abort\(\); else signal\?\.addEventListener\('abort', give\); stepAbort = step;/.test(coder)
    && /signal: step\.signal,/.test(coder) && /\.finally\(\(\) => \{ signal\?\.removeEventListener\('abort', give\); if \(stepAbort === step\) stepAbort = null; \}\);/.test(coder)
    && /\} catch \(e\) \{\n\s*if \(coderQueue\?\.urgent && !signal\?\.aborted\) \{ thinkEl\?\.remove\(\); thinkEl = appendThinking\(contentEl\);[^\n]*continue; \}/.test(coder));
  ok('...Finance, the ERP agent and the Swarm\'s workspace stop what they are writing', /interrupt: \(\) => abortCtrl\?\.abort\(\) \}\)/.test(fin) && /interrupt: \(\) => deps\?\.stop\(\) \}\)/.test(erp) && /interrupt: \(\) => \{ if \(state\.asking && !state\.asking\.team\) state\.asking\.controller\.abort\(\); \} \}\)/.test(ws));
  ok('...and 3D Forge has none, as stopping would throw away the part being made', !/interrupt:/.test(forge));
  const css = src('css', 'composer.css');
  ok('the button shows only where there is one, and quickens the card while it sends', /\.hc-queue-now\[hidden\] \{ display: none; \}/.test(css) && /\.hc-queue--now::before \{ animation-duration: 1\.1s; \}/.test(css) && /\.hc-queue--now \.hc-queue-now svg \{ animation: none; \}/.test(css));
  const frames = [...css.matchAll(/@keyframes (hcq-[\w-]+) \{([^@]*?)\}\s*(?=@keyframes|\n\n|$)/g)];
  ok('the card\'s motion only moves and fades, never a shadow or a filter, so it costs the page next to nothing', frames.length >= 5 && frames.every(([, , body]) => !/(box-shadow|filter|width|height|top|left|background)\s*:/.test(body)), frames.map((f) => f[1]).join());
  ok('...and stops for a person who asks for less motion', /@media \(prefers-reduced-motion: reduce\) \{\s*\.hc-queue, \.hc-queue::before, \.hc-queue-pulse::after, \.hc-queue-item--new, \.hc-queue--leaving \{ animation: none; \}/.test(css));
  ok('...and a hidden card is not drawn at all, so nothing moves while nothing waits', /\.hc-queue\[hidden\] \{ display: none; \}/.test(css));
  ok('it loads before the app and every mode', src('boot.js').indexOf("'/js/queue.js'") > 0 && src('boot.js').indexOf("'/js/queue.js'") < src('boot.js').indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:queue\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/queue.js)`);
process.exit(fail ? 1 : 0);
