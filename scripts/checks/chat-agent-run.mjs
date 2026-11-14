// ==============================================================
// A chat agent's run on the shared loop — checks
//
// Loads the real src/js/chat/agent-run.js with the real shared loop
// (js/agent-loop.js), the chat's finishing checks (js/chat/finish.js) and
// the modules they read, and runs a chat agent with a scripted model, a
// stand-in for the chat's tool runner and a stand-in for the reply's record
// of the run. It holds which agents run on it, that the chat's tools are the
// ones run and recorded as before, that nothing of HashCoder's is read or
// changed, that the conversation is no longer cut to a fixed size, that the
// answer is held to the chat's checks and to Python it says ran, and that a
// model refusing tools, a stop, and a run ending with nothing said behave.
//
// Run with: npm run check:chat-agent-run
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

const sandbox = { console, performance, setTimeout, clearTimeout, DOMException };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['fences.js', 'text-safety.js', 'chat/sources.js', 'run-ledger.js', 'model-limits.js', 'agent-context.js', 'code/host-tools.js', 'code/translate.js', 'code/asks.js', 'code/added.js', 'agent-policy.js', 'agent-shape.js', 'code/verify.js', 'code/plan.js', 'code/calls.js', 'code/paths.js', 'code/live.js', 'code/steps.js', 'code/debug-export.js', 'code/router.js', 'code/facts.js', 'agent-loop.js', 'chat/finish.js']) {
  vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
}
try { vm.runInContext(src('js', 'chat', 'agent-run.js'), sandbox, { filename: 'agent-run.js' }); } catch (e) { ok('agent-run.js loads', false, String(e && e.message)); }
const S = sandbox.HCAgentShape;
sandbox._H = { appendAssistantToolCallTurn: S.appendAssistantToolCallTurn, appendToolResult: S.appendToolResult };
const R = sandbox.HCChatAgentRun || {};

console.log('Which agents run on the shared loop:');
{
  const url = { id: 'builtin_url_reader', tools: ['fetch_url'] };
  ok('URL Reader, on a cloud model', typeof R.onLoop === 'function' && R.onLoop(url, 'cloud:groq:some-model') === true);
  ok('...not on a model on this computer, which keeps its own way of taking steps', R.onLoop?.(url, 'qwen2.5:7b') === false);
  ok('Researcher, on a cloud model, and not on a model on this computer', R.onLoop?.({ id: 'builtin_researcher', tools: ['web_search', 'wikipedia'] }, 'cloud:groq:m') === true && R.onLoop?.({ id: 'builtin_researcher' }, 'qwen2.5:7b') === false);
  ok('Published Papers Researcher, on a cloud model, and not on a model on this computer', R.onLoop?.({ id: 'builtin_papers', tools: ['pubmed', 'fetch_url'] }, 'cloud:groq:m') === true && R.onLoop?.({ id: 'builtin_papers' }, 'qwen2.5:7b') === false);
  ok('...not the agents not moved yet, nor a lite one', R.onLoop?.({ id: 'builtin_deep_research' }, 'cloud:groq:m') === false && R.onLoop?.({ id: 'builtin_hash_ai' }, 'cloud:groq:m') === false && R.onLoop?.({ id: 'builtin_url_reader', lite: true }, 'cloud:groq:m') === false && R.onLoop?.(null, 'cloud:groq:m') === false);
}

let ids = 0;
const callOf = (name, args) => ({ id: `c${++ids}`, name, arguments: args });
const turnOf = (...calls) => ({ content: '', tool_calls: calls });
const words = (content) => ({ content, tool_calls: [] });
const shaped = (names) => names.map((name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }));

/** One chat run: `script(messages, n, tools)` is the model, `results[name]` what each tool answers. */
async function chatRun({ script, names = ['fetch_url', 'web_search'], results = {}, history = [], signal, fallback, request = 'Read https://site.example/hours and tell me when the bakery opens.' } = {}) {
  const coder = { request: 'HashCoder request', asks: ['x', 'y', 'z'], plan: { steps: [] }, said: 'HashCoder said', TOOL_DEFINITIONS: [] };
  const coderBefore = json(coder);
  sandbox.HC = { code: coder, guard: { noteBlocked: () => {} }, undo: { lastFor: () => null } };
  const events = [], statuses = [], typed = [], tracker = [], ran = [], sent = [];
  const messages = [{ role: 'system', content: 'You read web pages for the person.' }, ...history, { role: 'user', content: request }];
  let n = 0;
  const out = await R.run({
    agent: { id: 'builtin_url_reader' }, assistant: {}, messages, tools: shaped(names), tracker, temperature: 0.3, signal,
    onStatus: (t, k) => statuses.push([t, k]), onFinalToken: () => {}, model: 'cloud:groq:some-model', request,
    call: async (m, t) => { n++; sent.push({ msgs: m.map((x) => ({ ...x })), tools: t.map((x) => x.function.name) }); const r = script(m, n, t); if (r instanceof Error) throw r; return r; },
    runTool: async (name, args, onStatus, tr) => { ran.push(name); const r = results[name] ?? JSON.stringify({ text: `${name} result` }); tr.push({ name, ok: !/"error"/.test(r) }); return r; },
    record: (a, type, label, data) => events.push([type, label, data]),
    typewriter: async (text) => { typed.push(text); },
    fallback: fallback || (async () => 'FALLBACK'), closing: 'No more tools can be used now. Write your final answer.',
  }).catch((e) => e);
  return { out, events, statuses, typed, tracker, ran, sent, coder, coderBefore, calls: () => n, messages };
}

console.log('\nA run:');
await (async () => {
  if (typeof R.run !== 'function') { ok('run() exists', false); return; }
  const r = await chatRun({ script: (m, n) => (n === 1 ? turnOf(callOf('fetch_url', { url: 'https://site.example/hours' })) : words('The bakery opens at seven.')) });
  ok('the agent\'s tool is run by the chat\'s own runner, and its answer typed into the reply', json(r.ran) === '["fetch_url"]' && r.out === 'The bakery opens at seven.' && json(r.typed) === '["The bakery opens at seven."]', json({ ran: r.ran, out: r.out }));
  ok('the reply\'s record of the run holds the call, its result and the answer, as before', json(r.events.map((e) => e[0])) === '["tool_call","tool_result","final"]' && r.events[0][1] === 'fetch_url' && r.events[1][2] && r.events[1][2].text === 'fetch_url result', json(r.events));
  ok('nothing of HashCoder\'s is read or changed', json(r.coder) === r.coderBefore);
  ok('the model is offered only the agent\'s tools', r.sent.every((x) => json(x.tools.sort()) === '["fetch_url","web_search"]' || x.tools.length === 0));
})();

console.log('\nThe conversation is no longer cut to a fixed size:');
await (async () => {
  if (typeof R.run !== 'function') return;
  const history = [];
  for (let i = 0; i < 12; i++) history.push({ role: 'user', content: `Earlier question ${i}: ${'x'.repeat(3000)}` }, { role: 'assistant', content: `Earlier answer ${i}.` });
  const r = await chatRun({ history, script: () => words('Seven.') });
  const first = r.sent[0].msgs;
  const all = first.map((m) => String(m.content)).join('\n');
  ok('nothing is dropped without a word: older requests are folded into the app\'s record of the conversation, the oldest named in it', /Earlier in this conversation, not repeated here: 10 earlier requests/.test(all) && /Earlier question 0:/.test(all) && /Earlier question 11:/.test(all), all.slice(0, 300));
  ok('...and the newest request reaches the model as it was written', first.at(-1).role === 'user' && /tell me when the bakery opens/.test(String(first.at(-1).content)));
  ok('...where the old way dropped the oldest messages to stay under a fixed guess', !/BUDGET = 8000/.test(src('js', 'chat', 'agent-run.js')));
})();

console.log('\nThe answer is held to the chat\'s checks:');
await (async () => {
  if (typeof R.run !== 'function') return;
  const r = await chatRun({ results: { fetch_url: JSON.stringify({ text: 'Rosewood Bakery. Open daily.' }) },
    script: (m, n) => (n === 1 ? turnOf(callOf('fetch_url', { url: 'https://site.example/' })) : words('Call Rosewood Bakery on 020 7946 0321.')) });
  ok('a phone number nothing read says sends the answer back once', r.calls() === 3 && r.sent[2].msgs.some((m) => m.role === 'user' && /020 7946 0321/.test(String(m.content)) && /nothing the person gave or you read says/.test(String(m.content))), `${r.calls()} calls`);
  ok('...and, still there, is said under the answer in the chat\'s words', /\n\n\*Not confirmed by anything you gave or the agent read: 020 7946 0321\./.test(r.out), r.out);
  ok('...the step it was sent back for is shown as the app checking in', r.statuses.some((s) => s[1] === 'warn' && /details nothing given or read says/.test(s[0])));
  const p = await chatRun({ names: ['execute_python'], request: 'Work out 17 factorial.',
    script: (m, n) => (n === 1 ? words('I ran this code:\n```python\nimport math\nprint(math.factorial(17))\n```\nThe result is 355687428096000.') : n === 2 ? turnOf(callOf('execute_python', { code: 'import math\nprint(math.factorial(17))' })) : words('17! is 355687428096000.')) });
  ok('Python it says ran, when none ran, is sent back once to be run with the tool', json(p.ran) === '["execute_python"]' && p.out === '17! is 355687428096000.' && p.sent[1].msgs.some((m) => /says it ran, and none ran/.test(String(m.content))), json({ ran: p.ran, out: p.out }));
})();

console.log('\nWhen it goes wrong:');
await (async () => {
  if (typeof R.run !== 'function') return;
  const f = await chatRun({ script: () => new Error('This model does not support tools.') });
  ok('a model that refuses tools on its first step falls back as before', f.out === 'FALLBACK');
  const g = await chatRun({ script: (m, n) => (n === 1 ? turnOf(callOf('fetch_url', { url: 'https://site.example/' })) : new Error('function calling failed')) });
  ok('...but not once a tool has run: the failure is passed on', g.out instanceof Error && g.out.message === 'function calling failed');
  const ctl = new AbortController(); ctl.abort();
  const a = await chatRun({ signal: ctl.signal, script: () => words('x') });
  ok('a stopped run is passed on as stopped, never as a fallback', a.out instanceof Error && a.out.name === 'AbortError');
  const e = await chatRun({ results: { fetch_url: JSON.stringify({ error: 'This address is not public.' }) }, script: (m, n) => (n === 1 ? turnOf(callOf('fetch_url', { url: 'http://x' })) : words('I could not read that page.')) });
  const res = e.messages.find((m) => m.role === 'tool');
  ok('a tool that answers { error } is a failed call, its error passed to the model', res && /This address is not public\./.test(res.content) && e.events.some((x) => x[0] === 'tool_result' && x[2] && x[2].error), res && res.content);
  const again = await chatRun({ results: { fetch_url: JSON.stringify({ error: 'This address is not public.' }) }, script: (m, n) => (n <= 2 ? turnOf(callOf('fetch_url', { url: 'http://x' })) : words('I could not read that page.')) });
  const second = again.messages.filter((m) => m.role === 'tool')[1];
  ok('...so the same failing call made again is not run again, and is told it failed the same way', json(again.ran) === '["fetch_url"]' && !!second && /This address is not public\./.test(second.content), second && second.content);
  let k = 0;
  const empty = await chatRun({ script: (m, n, t) => (t.length ? turnOf(callOf('web_search', { query: `q${++k}` })) : words(/Write your final answer\./.test(String(m.at(-1).content)) ? 'Here is what I found.' : '')) });
  ok('a run that ends with nothing said is asked once, with no tools, for its answer', empty.out === 'Here is what I found.' && empty.sent.at(-1).tools.length === 0, String(empty.out));
})();

const app = src('js', 'app.js');
ok('the chat hands an agent on the loop to it before the fixed trim', (() => { const at = app.indexOf('window.HCChatAgentRun?.onLoop(agent, modelEl.value)'), trim = app.indexOf('function trimBaseToContextBudget'); return at > 0 && trim > at; })());
ok('it is part of npm run check', /npm run check:chat-agent-run\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/agent-run.js)`);
process.exit(fail ? 1 : 0);
