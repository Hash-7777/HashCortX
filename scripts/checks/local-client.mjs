// ==============================================================
// Local model client checks
//
// Loads the REAL src/js/local-client.js and holds that a reply from a model on
// this computer is read whole: its words and its thinking handed on as they
// arrive and kept apart, thinking written between think tags taken out of the
// answer, tool calls kept, and a failure reported part-way through the reply
// raised rather than taken for an answer.
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
  const b = C.body({ model: 'm', messages: [], numCtx: 8192, temperature: 0.2, json: true, tools: [{ type: 'function' }], keepAlive: -1 });
  ok('window, temperature, JSON, tools and lifetime all sent', b.options.num_ctx === 8192 && b.options.temperature === 0.2 && b.format === 'json' && b.tools.length === 1 && b.keep_alive === -1 && b.stream === true);
  const schema = { type: 'object' };
  ok('a JSON schema is sent as the shape the answer must take', C.body({ model: 'm', messages: [], json: schema }).format === schema);
  const bare = C.body({ model: 'm', messages: [] });
  ok('nothing is sent that was not asked for', !('format' in bare) && !('tools' in bare) && !('keep_alive' in bare) && Object.keys(bare.options).length === 0);
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

console.log('\nThe app uses it:');
{
  const app = src('js', 'app.js');
  ok('the chat, the side-by-side view, the modes and the agents all read replies through it', (app.match(/HCLocal\.chat\(/g) || []).length === 4);
  ok('a thinking model\'s thinking is shown in the chat as it arrives', /onThinking: \(t\) => showThinking\(assistant, t\)/.test(app));
  const boot = src('boot.js');
  ok('it loads after the line reader and before the chat', boot.indexOf("'/js/stream/sse.js'") < boot.indexOf("'/js/local-client.js'") && boot.indexOf("'/js/local-client.js'") < boot.indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-client.js)`);
process.exit(fail ? 1 : 0);
