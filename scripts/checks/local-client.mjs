// ==============================================================
// Local model client checks
//
// Loads the REAL src/js/local-client.js and holds that a reply from a model on
// this computer is read whole: its words and its thinking handed on as they
// arrive and kept apart, thinking written between think tags taken out of the
// answer, tool calls kept, a failure reported part-way through the reply
// raised rather than taken for an answer, and a model loaded ahead of its
// request no more than once a minute.
//
// Run with: npm run check:local-client
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, JSON, Math, Number, String, Array, Object, Map, Promise, Error, Date };
vm.createContext(sandbox);
vm.runInContext(src('js', 'local-client.js'), sandbox, { filename: 'local-client.js' });
const C = sandbox.window.HCLocal;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
async function* events(list) { for (const e of list) yield e; }
const words = (...parts) => parts.map((p) => ({ message: { content: p } }));

console.log('The request:');
{
  const b = C.body({ model: 'm', messages: [], numCtx: 8192, temperature: 0.2, json: true, tools: [{ type: 'function' }], keepAlive: '10m' });
  ok('window, temperature, JSON, tools and a lifetime asked for all sent', b.options.num_ctx === 8192 && b.options.temperature === 0.2 && b.format === 'json' && b.tools.length === 1 && b.keep_alive === '10m' && b.stream === true);
  const schema = { type: 'object' };
  ok('a JSON schema is sent as the shape the answer must take', C.body({ model: 'm', messages: [], json: schema }).format === schema);
  const bare = C.body({ model: 'm', messages: [] });
  ok('nothing is sent that was not asked for', !('format' in bare) && !('tools' in bare) && !('keep_alive' in bare) && !('think' in bare) && Object.keys(bare.options).length === 0);
  ok('thinking can be turned off for one request', C.body({ model: 'm', messages: [], think: false }).think === false);
  ok('an answer\'s length can be bounded', C.body({ model: 'm', messages: [], numPredict: 2048 }).options.num_predict === 2048 && !('num_predict' in C.body({ model: 'm', messages: [] }).options));
  const app = src('js', 'app.js');
  ok('every answer held to a schema is bounded', /numPredict: json \? Math\.max\(1024, need \|\| 4096\) : undefined/.test(app) && /numPredict: json \? 2048 : undefined/.test(app));
}

console.log('\nAn answer ends where its window does:');
{
  // With the window reader loaded, as in the app.
  const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Promise, Error, Date };
  vm.createContext(box);
  vm.runInContext(src('js', 'local-context.js'), box, { filename: 'local-context.js' });
  vm.runInContext(src('js', 'local-client.js'), box, { filename: 'local-client.js' });
  const L = box.window.HCLocal;
  const T = box.window.HCLocalContext.tokensOf;
  const msgs = [{ role: 'system', content: 'x'.repeat(6400) }, { role: 'user', content: 'Write the plan.' }];
  const b = L.body({ model: 'm', messages: msgs, numCtx: 8192 });
  ok('with no length asked for, it may use what the window has left', b.options.num_predict === 8192 - T(msgs));
  const tools = [{ type: 'function', function: { name: 'web_search', description: 'y'.repeat(3200), parameters: {} } }];
  ok('the tools it is given count as part of what is sent', L.body({ model: 'm', messages: msgs, numCtx: 8192, tools }).options.num_predict === 8192 - T([...msgs, { content: JSON.stringify(tools) }]));
  ok('a length asked for is kept', L.body({ model: 'm', messages: msgs, numCtx: 8192, numPredict: 2048 }).options.num_predict === 2048);
  ok('a window already full still leaves a whole answer', L.body({ model: 'm', messages: [{ role: 'user', content: 'z'.repeat(40000) }], numCtx: 8192 }).options.num_predict === 1024);
  ok('loading a model with nothing to answer asks for no length', !('num_predict' in L.body({ model: 'm', messages: [], numCtx: 8192 }).options));
  ok('and nothing sent is kept loaded for good', !/keepAlive: -1/.test(src('js', 'app.js')) && !/keepAlive: -1/.test(src('js', 'local-client.js')));
}

console.log('\nThe reply, read as it arrives:');
{
  const seen = [];
  const thought = [];
  const r = await C.read(events([
    { message: { thinking: 'Let me ' } }, { message: { thinking: 'work it out.' } },
    ...words('The answer ', 'is 42.'),
    { done: true, eval_count: 5, eval_duration: 1e9, prompt_eval_count: 9 },
  ]), { onToken: (t) => seen.push(t), onThinking: (t) => thought.push(t) });
  ok('words handed on one piece at a time, and the whole returned', seen.join('') === 'The answer is 42.' && r.content === 'The answer is 42.');
  ok('thinking handed on apart from the words, never in the answer', thought.join('') === 'Let me work it out.' && r.thinking === 'Let me work it out.' && !/work it out/.test(r.content));
  ok('Ollama\'s own counts kept from its last event', r.last && r.last.eval_count === 5 && r.last.prompt_eval_count === 9);
}
{
  const r = await C.read(events([{ message: { content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'x' } } }] } }, { done: true }]));
  ok('tool calls kept', r.tool_calls.length === 1 && r.tool_calls[0].function.name === 'web_search');
}
{
  let err = null;
  try { await C.read(events([...words('Half an'), { error: 'model runner has unexpectedly stopped' }])); } catch (e) { err = e; }
  ok('a failure reported part-way through is raised, not taken for an answer', err && /unexpectedly stopped/.test(err.message));
}

console.log('\nThinking written between think tags:');
{
  const feed = (parts) => { const f = C.thinkTags(); const out = { answer: '', thinking: '' }; for (const p of parts) { const o = f(p); out.answer += o.answer; out.thinking += o.thinking; } return out; };
  const a = feed(['<th', 'ink>plan the ', 'reply</th', 'ink>\n\nHello there.']);
  ok('taken out of the answer, even with the tags split across pieces', a.thinking === 'plan the reply' && a.answer === 'Hello there.');
  const b = feed(['Use the ', '<think> tag like this.']);
  ok('a reply that only mentions the tag is left alone', b.answer === 'Use the <think> tag like this.' && b.thinking === '');
  const c = feed(['  \n', '<think>', 'still going']);
  ok('a reply still thinking at the end shows nothing as the answer', c.answer === '' && c.thinking === 'still going');
  const d = feed(['<', 'b>bold</b>']);
  ok('something that only starts like the tag is the answer', d.answer === '<b>bold</b>');
  const r = await C.read(events(words('<think>hmm', '</think>', 'Yes.')));
  ok('and the reading does the same', r.content === 'Yes.' && r.thinking === 'hmm');
}

console.log('\nOne request, read by the shared line reader:');
{
  let sent = null;
  const fetchFn = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, body: 'BODY' }; };
  const lineReader = (b) => events(b === 'BODY' ? words('ok') : []);
  const r = await C.chat('http://h', { model: 'm', messages: [{ role: 'user', content: 'hi' }], numCtx: 16384 }, { fetchFn, lineReader });
  ok('to the chat address, streamed, and read', sent.url === 'http://h/api/chat' && sent.body.stream === true && sent.body.options.num_ctx === 16384 && r.content === 'ok');
  let err = null;
  try { await C.chat('http://h', { model: 'm', messages: [] }, { fetchFn: async () => ({ ok: false, status: 400, text: async () => 'does not support tools' }), lineReader }); } catch (e) { err = e; }
  ok('a refusal names its status and Ollama\'s words', err && /400/.test(err.message) && /does not support tools/.test(err.message));
}

console.log('\nLoaded ahead of the request:');
{
  const calls = [];
  const fetchFn = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; };
  const first = await C.warm('http://w', 'm', 8192, { fetchFn, now: 1000 });
  await C.warm('http://w', 'm', 8192, { fetchFn, now: 30000 });
  ok('at the window the request will use, with nothing to answer', first === true && calls.length === 1 && calls[0].options.num_ctx === 8192 && calls[0].messages.length === 0);
  ok('and kept only as long as Ollama keeps any model after a request, never held for good', !('keep_alive' in calls[0]));
  ok('not asked again within the minute', calls.length === 1);
  await C.warm('http://w', 'm', 8192, { fetchFn, now: 62000 });
  await C.warm('http://w', 'm', 16384, { fetchFn, now: 62001 });
  ok('asked again after it, or for another window', calls.length === 3);
  ok('never for a cloud model', (await C.warm('http://w', 'cloud:groq:x', 8192, { fetchFn, now: 1 })) === false && calls.length === 3);
  ok('a server that is not there is not an error', (await C.warm('http://w', 'gone', 8192, { fetchFn: async () => { throw new Error('refused'); }, now: 1 })) === false);
}

console.log('\nThe app uses it:');
{
  const app = src('js', 'app.js');
  ok('the chat, the side-by-side view, the modes, the agents and a local agent\'s steps all read replies through it', (app.match(/HCLocal\.chat\(/g) || []).length === 5);
  ok('a thinking model\'s thinking is shown in the chat as it arrives', /onThinking: \(t\) => showThinking\(assistant, t\)/.test(app));
  ok('the model is loaded while the message is written', /HCLocal\.warm\(/.test(app) && /warmLocalModel\(\);/.test(app));
  const boot = src('boot.js');
  ok('it loads after the line reader and before the chat', boot.indexOf("'/js/stream/sse.js'") < boot.indexOf("'/js/local-client.js'") && boot.indexOf("'/js/local-client.js'") < boot.indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-client.js)`);
process.exit(fail ? 1 : 0);
