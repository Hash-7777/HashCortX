// ==============================================================
// Other local model apps — checks
//
// Loads the REAL src/js/local-apps.js, with the line reader and the local
// client beside it, and holds that a server on this computer is found on the
// usual ports and the ones named, that its models are offered and written as
// "local:<port>/<id>", that a request is sent in the shape such servers read,
// and that a streamed reply is read into the shape an Ollama reply is: words,
// thinking sent apart or between think tags, tool calls gathered from their
// pieces, counts, and a failure raised. Also that the app routes every local
// request for such a model to it, and that the app itself reaches it only on
// this computer.
//
// Run with: npm run check:local-apps
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const root = (...p) => readFileSync(join(here, '..', '..', ...p), 'utf8');
const sandbox = { window: {}, TextDecoder, TextEncoder, JSON, Promise, Error, Number, String, Array, Object, Set, Map, setTimeout, clearTimeout, AbortController };
vm.createContext(sandbox);
for (const f of [['js', 'stream', 'sse.js'], ['js', 'local-client.js'], ['js', 'local-apps.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
const A = sandbox.window.HCLocalApps;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
/** A reply body that streams the given text in the given pieces. */
const bodyOf = (pieces) => new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
const reply = (status, pieces) => ({ ok: status < 400, status, body: bodyOf(pieces), text: async () => pieces.join(''), json: async () => JSON.parse(pieces.join('')) });
const sse = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).concat('data: [DONE]\n\n');

console.log('A model on another local app:');
ok('written with its port and read back', A.valueOf(1234, 'qwen2.5-7b-instruct') === 'local:1234/qwen2.5-7b-instruct' && A.parse('local:1234/qwen2.5-7b-instruct').port === 1234 && A.parse('local:1234/org/model:q4').model === 'org/model:q4');
ok('told apart from Ollama and cloud models', A.isLocalApp('local:8080/m') && !A.isLocalApp('qwen2.5-coder:3b') && !A.isLocalApp('cloud:groq:x') && !A.isLocalApp('local:/m'));
ok('a port outside what an app listens on is not one', A.parse('local:80/m') === null && A.parse('local:99999/m') === null);
ok('a port as a person types it', A.portOf(' 1235 ') === 1235 && A.portOf('localhost:9090') === 9090 && A.portOf('80') === null && A.portOf('abc') === null);
ok('labelled with its port', A.labelOf(1234, 'm') === 'm · port 1234');

console.log('\nFound on the usual ports and the ones named:');
{
  const asked = [];
  const send = async (port, route) => {
    asked.push(`${port} ${route}`);
    if (port === 1234) return reply(200, [JSON.stringify({ data: [{ id: 'chat-model' }, { id: 'text-embedding-nomic' }, { id: 'bge-reranker-v2' }] })]);
    if (port === 9090) return reply(200, [JSON.stringify({ data: [{ id: 'my-model' }] })]);
    if (port === 8080) return reply(200, ['not json']);
    throw new TypeError('connection refused');
  };
  const found = await A.discover(['9090', 'junk', '11434'], { send });
  ok('each usual port is asked, and a named one', A.PORTS.every((p) => asked.includes(`${p} models`)) && asked.includes('9090 models'));
  ok('Ollama\'s own port is not another app', !asked.includes('11434 models'));
  ok('a server\'s chat models are listed; one only for embedding or reranking is not', JSON.stringify(found) === JSON.stringify([{ port: 1234, models: ['chat-model'] }, { port: 9090, models: ['my-model'] }]));
  ok('a port that answers nonsense, or nothing, lists nothing', !found.some((s) => s.port === 8080));
}

console.log('\nThe request, in the shape these servers read:');
{
  const wire = A.toWire([
    { role: 'user', content: 'what is this', images: ['iVBORw0'] },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'web_search', content: 'found' },
  ]);
  ok('a picture as a part of the message', wire[0].content[1].image_url.url === 'data:image/png;base64,iVBORw0' && wire[0].content[0].text === 'what is this');
  ok('a call\'s arguments as text', wire[1].tool_calls[0].function.arguments === '{"query":"x"}' && wire[1].tool_calls[0].type === 'function');
  ok('a result answers its call', wire[2].role === 'tool' && wire[2].tool_call_id === 'c1');
  const b = A.bodyOf({ model: 'm', messages: [], temperature: 0, json: { type: 'object', properties: { a: { type: 'string' } } } });
  ok('streamed, with counts, and an answer held to the schema asked for', b.stream === true && b.stream_options.include_usage && b.response_format.type === 'json_schema' && b.response_format.json_schema.schema.properties.a && b.temperature === 0);
  ok('"answer in JSON" is an object schema', A.bodyOf({ model: 'm', messages: [], json: true }).response_format.json_schema.schema.type === 'object');
}

console.log('\nThe reply, read as an Ollama reply is:');
{
  const words = [];
  const thought = [];
  const pieces = sse(
    { choices: [{ delta: { reasoning_content: 'Count the ' } }] },
    { choices: [{ delta: { reasoning_content: 'letters.' } }] },
    { choices: [{ delta: { content: 'There are ' } }] },
    { choices: [{ delta: { content: 'three.' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
  ).join('');
  // Split mid-event, as the network does.
  const r = await A.chat('local:1234/m', { messages: [{ role: 'user', content: 'q' }] }, { send: async () => reply(200, [pieces.slice(0, 37), pieces.slice(37, 90), pieces.slice(90)]), onToken: (t) => words.push(t), onThinking: (t) => thought.push(t) });
  ok('words handed on as they come, the whole returned', words.join('') === 'There are three.' && r.content === 'There are three.');
  ok('thinking sent apart is kept apart', thought.join('') === 'Count the letters.' && r.thinking === 'Count the letters.');
  ok('the counts, in the names the app reads them by', r.last.prompt_eval_count === 12 && r.last.eval_count === 5 && r.last.done_reason === 'stop');
  const tagged = await A.chat('local:1234/m', { messages: [] }, { send: async () => reply(200, sse({ choices: [{ delta: { content: '<think>plan</think>Hi.' } }] })) });
  ok('thinking written between think tags is taken out of the answer', tagged.content === 'Hi.' && tagged.thinking === 'plan');
  const called = await A.chat('local:1234/m', { messages: [], tools: [{ type: 'function', function: { name: 'web_search' } }] }, { send: async () => reply(200, sse(
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'web_search', arguments: '{"qu' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ery":"x"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  )) });
  ok('a tool call sent in pieces is put together, arguments as an object', called.tool_calls.length === 1 && called.tool_calls[0].function.name === 'web_search' && called.tool_calls[0].function.arguments.query === 'x');
  const cut = await A.chat('local:1234/m', { messages: [] }, { send: async () => reply(200, sse({ choices: [{ delta: { content: 'half' }, finish_reason: 'length' }] })) });
  ok('an answer cut off by its length says so', cut.last.done_reason === 'length');
  let err = null;
  try { await A.chat('local:1234/m', { messages: [] }, { send: async () => reply(200, sse({ error: { message: 'model not loaded' } })) }); } catch (e) { err = e; }
  ok('a failure inside the reply is raised, naming the port', err && /port 1234/.test(err.message) && /model not loaded/.test(err.message));
  err = null;
  try { await A.chat('local:1234/m', { messages: [] }, { send: async () => reply(404, ['no such model']) }); } catch (e) { err = e; }
  ok('a refusal names its status and the server\'s words', err && /404/.test(err.message) && /no such model/.test(err.message));
}

console.log('\nOffered in the model menu:');
{
  const make = (tag) => ({ tag, dataset: {}, children: [], label: '', value: '', textContent: '', appendChild(c) { this.children.push(c); } });
  const g = A.menuGroup([{ port: 1234, models: ['a', 'b'] }, { port: 9090, models: ['c'] }], { createElement: make });
  ok('in a group of their own, each with its port', g.label === 'Other local apps' && g.dataset.localApps === '1' && g.children.map((o) => `${o.value}=${o.textContent}`).join('|') === 'local:1234/a=a · port 1234|local:1234/b=b · port 1234|local:9090/c=c · port 9090');
  ok('none found, no group', A.menuGroup([], { createElement: make }) === null);
  ok('Settings says what was found', A.foundText([{ port: 1234, models: ['a', 'b'] }]) === 'Found: 2 models on port 1234' && A.foundText([]) === 'None found on the usual ports.');
}

console.log('\nThe app sends every local request for such a model to it:');
{
  const client = src('js', 'local-client.js');
  ok('the one local client hands it on', /apps\.isLocalApp\(request\.model\)\) return apps\.chat\(request\.model, request/.test(client));
  ok('it is never loaded ahead through Ollama', /\^\(\?:cloud\|local\):/.test(client));
  ok('Ollama is not asked what it is', /if \(\/\^local:\/\.test\(String\(model\)\)\) return info;/.test(src('js', 'local-context.js')));
  const app = src('js', 'app.js');
  ok('its tools are told in words, which every server reads', /!HCLocalApps\.isLocalApp\(model\)/.test(app));
  ok('its models are offered in their own group, before the cloud models', /HCLocalApps\.menuGroup\(servers\)/.test(app) && /modelEl\.insertBefore\(group, modelEl\.querySelector\('option\[data-separator="1"\], optgroup\[data-cloud\]'\)\)/.test(app));
  ok('the ports named in Settings are asked and kept', /localAppPorts: \$\("localAppPorts"\)\?\.value/.test(app) && /id="localAppPorts"/.test(src('core', 'settings', 'panel.html')));
  ok('Ollama is never asked to unload one', /!\/\^\(\?:cloud\|local\):\/\.test\(String\(name\)\)/.test(app));
  const boot = src('boot.js');
  ok('it loads after the client and before the chat', boot.indexOf("'/js/local-client.js'") < boot.indexOf("'/js/local-apps.js'") && boot.indexOf("'/js/local-apps.js'") < boot.indexOf("'/js/app.js'"));
}

console.log('\nThe desktop app reaches it only on this computer:');
{
  const bridge = src('platform', 'tauri', 'provider-bridge.js');
  ok('the page names a port, a number, and nothing else of the address', /port: Number\.isInteger\(port\) \? port : null/.test(bridge));
  const rust = root('src-tauri', 'src', 'commands', 'provider.rs');
  ok('the address is this computer at that port, on the two paths written there', /format!\("http:\/\/127\.0\.0\.1:\{port\}\/\{path\}"\)/.test(rust) && /"chat" => "v1\/chat\/completions"/.test(rust) && /"models" => "v1\/models"/.test(rust) && /if port < 1024/.test(rust));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-apps.js)`);
process.exit(fail ? 1 : 0);
