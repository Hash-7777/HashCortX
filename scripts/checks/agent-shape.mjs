// ==============================================================
// Agent request-shape checks
//
// Loads the REAL src/js/agent-shape.js into a Node VM.
//
// These translations fail quietly. A dropped image is a model saying it cannot
// see the attachment you gave it; a tool list built in the wrong shape is a
// model that never calls a tool and answers more vaguely instead; arguments
// passed as an object where a string was expected are accepted and misread.
// None of it throws, so none of it shows up without a check like this one.
//
// Run with: npm run check:shape
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'agent-shape.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
// Code blocks are found by the shared reader, loaded before it as in the app.
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'fences.js'), 'utf8'), sandbox, { filename: 'fences.js' });
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'tool-text.js'), 'utf8'), sandbox, { filename: 'tool-text.js' });
vm.runInContext(src, sandbox, { filename: 'agent-shape.js' });
const A = sandbox.window.HCAgentShape;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const TOOLS = {
  web_search:      { description: 'search the web', parameters: { type: 'object', properties: {} } },
  remember_fact:   { description: 'store a fact',   parameters: { type: 'object', properties: {} } },
  recall_facts:    { description: 'recall facts',   parameters: { type: 'object', properties: {} } },
  current_datetime:{ description: 'the date',       parameters: { type: 'object', properties: {} } },
  pubmed_search:   { description: 'search pubmed',  parameters: { type: 'object', properties: {} } },
  execute_python:  { description: 'run python',     parameters: { type: 'object', properties: {} } },
};

console.log('\nImages reach the model, and text-only messages stay simple:');
{
  const msgs = [
    { role: 'user', content: 'what is this?', images: ['AAAA'] },
    { role: 'assistant', content: 'a cat' },
  ];
  const out = A.toOpenAIVision(msgs);
  ok('a text-only message keeps a plain string', typeof out[1].content === 'string');
  ok('a message with an image becomes blocks', Array.isArray(out[0].content));
  ok('the text survives', out[0].content[0].text === 'what is this?');
  ok('the image is carried as a data URL', out[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,AAAA'));
  ok('an image with no caption still gets a prompt', A.toOpenAIVision([{ role: 'user', images: ['B'] }])[0].content[0].text.length > 0);
  ok('two images become two blocks', A.toOpenAIVision([{ role: 'user', content: 'x', images: ['A', 'B'] }])[0].content.length === 3);

  const stripped = A.toTextOnly(msgs);
  ok('the text-only form drops images entirely', stripped.every(m => typeof m.content === 'string'));
  ok('and keeps the words', stripped[0].content === 'what is this?');
}

console.log('\nA tool selection expands to the tools it means:');
{
  ok('memory becomes both halves',
    JSON.stringify(A.agentToolNames({ tools: ['memory'] }, TOOLS).sort()) === JSON.stringify(['recall_facts', 'remember_fact']));
  ok('datetime is renamed', A.agentToolNames({ tools: ['datetime'] }, TOOLS)[0] === 'current_datetime');
  ok('pubmed is renamed', A.agentToolNames({ tools: ['pubmed'] }, TOOLS)[0] === 'pubmed_search');
  ok('code_interpreter is renamed', A.agentToolNames({ tools: ['code_interpreter'] }, TOOLS)[0] === 'execute_python');
  ok('python means the same thing', A.agentToolNames({ tools: ['python'] }, TOOLS)[0] === 'execute_python');
  ok('a plain tool passes through', A.agentToolNames({ tools: ['web_search'] }, TOOLS)[0] === 'web_search');

  // Offering the same function twice is an error on several providers.
  ok('duplicates are collapsed',
    A.agentToolNames({ tools: ['python', 'code_interpreter'] }, TOOLS).length === 1);
  ok('an unknown tool is dropped', A.agentToolNames({ tools: ['nonsense'] }, TOOLS).length === 0);
  ok('no agent means no tools', A.agentToolNames(null, TOOLS).length === 0);
  ok('no tool list means no tools', A.agentToolNames({}, TOOLS).length === 0);
  ok('no table means no tools', A.agentToolNames({ tools: ['web_search'] }, null).length === 0);
}

console.log('\nEach provider gets its own tool shape:');
{
  const agent = { tools: ['web_search', 'memory'] };
  const oa = A.buildOpenAITools(agent, TOOLS);
  ok('OpenAI: a list of typed functions', oa.every(t => t.type === 'function' && t.function.name));
  ok('OpenAI: descriptions come from the table', oa[0].function.description === TOOLS[oa[0].function.name].description);
  ok('OpenAI: parameters come from the table', !!oa[0].function.parameters);
  ok('OpenAI: three tools from two selections', oa.length === 3);

  const gm = A.buildGeminiTools(agent, TOOLS);
  ok('Gemini: one wrapper object', gm.length === 1 && Array.isArray(gm[0].functionDeclarations));
  ok('Gemini: same tools inside', gm[0].functionDeclarations.length === 3);
  ok('Gemini: no type/function nesting', gm[0].functionDeclarations[0].name && !gm[0].functionDeclarations[0].function);

  // An empty array is not the same as "no tools" to several providers.
  ok('Gemini: no tools means an empty list, not an empty wrapper',
    A.buildGeminiTools({ tools: [] }, TOOLS).length === 0);
  ok('OpenAI: no tools means an empty list', A.buildOpenAITools({ tools: [] }, TOOLS).length === 0);
}

console.log('\nA tool round trip is recorded the way providers expect to read it back:');
{
  const messages = [];
  A.appendAssistantToolCallTurn(messages, 'let me look', [{ id: 'c1', name: 'web_search', arguments: { q: 'rust' } }]);
  const turn = messages[0];
  ok('the assistant turn is recorded', turn.role === 'assistant');
  ok('arguments are serialised, not passed as an object', typeof turn.tool_calls[0].function.arguments === 'string');
  ok('and they survive the trip', JSON.parse(turn.tool_calls[0].function.arguments).q === 'rust');
  ok('the call keeps its id', turn.tool_calls[0].id === 'c1');
  ok('a call with no arguments becomes an empty object', (() => {
    const m = []; A.appendAssistantToolCallTurn(m, '', [{ id: 'c2', name: 'x' }]);
    return m[0].tool_calls[0].function.arguments === '{}';
  })());

  A.appendToolResult(messages, { id: 'c1', name: 'web_search' }, 'results here');
  ok('the result is its own role', messages[1].role === 'tool');
  ok('it points at the call that asked', messages[1].tool_call_id === 'c1');
  ok('and carries the content', messages[1].content === 'results here');
}

console.log('\nA tool call a local model wrote as text is run as one:');
{
  const names = ['execute_python', 'web_search'];
  const one = A.toolCallsInText('{"name": "execute_python", "arguments": {"code": "print(1)"}}', names);
  ok('bare JSON naming a tool', one.length === 1 && one[0].name === 'execute_python' && one[0].arguments.code === 'print(1)');
  ok('in a json fence', A.toolCallsInText('```json\n{"name":"web_search","arguments":{"query":"x"}}\n```', names)[0].arguments.query === 'x');
  ok('in Qwen\'s tool_call tags, arguments given as a string', A.toolCallsInText('<tool_call>\n{"name":"web_search","arguments":"{\\"query\\":\\"y\\"}"}\n</tool_call>', names)[0].arguments.query === 'y');
  ok('several at once', A.toolCallsInText('[{"name":"web_search","arguments":{}},{"name":"execute_python","parameters":{"code":"1"}}]', names).length === 2);
  ok('a tool the agent does not have is not run', A.toolCallsInText('{"name":"delete_files","arguments":{}}', names).length === 0);
  ok('an answer that shows an example among words is left alone', A.toolCallsInText('Call it like this: {"name":"web_search","arguments":{}}', names).length === 0);
  const F = '`'.repeat(3);
  ok('a reply that says what it will do and ends on the call', A.toolCallsInText(`I will run it.\n${F}python\nprint(1)\n${F}\nRunning it now.\n${F}json\n{"name":"execute_python","arguments":{"code":"print(1)"}}\n${F}`, names)[0].arguments.code === 'print(1)');
  ok('a call shown as an example, with words before and after it, is left alone', A.toolCallsInText(`Like this:\n${F}json\n{"name":"web_search","arguments":{}}\n${F}\nThat is the format.`, names).length === 0);
  ok('a reply that opens on the call and then explains is the call', A.toolCallsInText(`${F}json\n{"name":"execute_python","arguments":{"code":"print(2)"}}\n${F}\n\nAssumptions: none.`, names)[0].arguments.code === 'print(2)');
  ok('ordinary JSON is left alone', A.toolCallsInText('{"total": 3}', names).length === 0);
  ok('with no tools, nothing is read as a call', A.toolCallsInText('{"name":"web_search","arguments":{}}', []).length === 0);
  const tools = [{ type: 'function', function: { name: 'execute_python' } }];
  const read = A.ollamaReply({ content: '{"name":"execute_python","arguments":{"code":"1"}}' }, tools);
  ok('Ollama\'s reply: a call written as text becomes a call, and is not also shown as the answer', read.calls.length === 1 && read.calls[0].arguments.code === '1' && read.content === '' && read.calls[0].id);
  const field = A.ollamaReply({ content: 'ok', tool_calls: [{ function: { name: 'execute_python', arguments: { code: '2' } } }] }, tools);
  ok('... a call in the field for it is read as it is, and the words kept', field.calls.length === 1 && field.calls[0].arguments.code === '2' && field.content === 'ok');
  ok('... a plain answer has no calls', A.ollamaReply({ content: 'The answer is 4.' }, tools).calls.length === 0);
  const sent = [];
  A.appendAssistantToolCallTurn(sent, '', [{ id: 'c1', name: 'execute_python', arguments: { code: '3' }, thoughtSignature: 's' }]);
  const shaped = A.forOllama(sent)[0].tool_calls[0];
  ok('Ollama is sent a call\'s arguments as an object, which is how it reads them, and no signature', shaped.function.arguments.code === '3' && !('thoughtSignature' in shaped));
  const app = readFileSync(join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');
  const ollama = app.slice(app.indexOf('async function agentTurnOllama'), app.indexOf('async function agentTurnOpenAI'));
  ok('the Ollama client uses both', /HCAgentShape\.forOllama\(messages\)/.test(ollama) && /HCAgentShape\.ollamaReply\(msg, tools\)/.test(ollama));
}

console.log('\nA model that cannot take tools is told them in words:');
{
  const tools = [{ type: 'function', function: { name: 'web_search', description: 'Live web search.\nMore detail.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } }];
  const convo = [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Cairo population?' }];
  A.appendAssistantToolCallTurn(convo, 'Searching.', [{ id: 'c1', name: 'web_search', arguments: { query: 'Cairo population' } }]);
  A.appendToolResult(convo, { id: 'c1', name: 'web_search' }, '{"results":["about 22 million"]}');
  const out = A.toolsInWords(convo, tools);
  ok('the tools, their arguments and the one way to call them are in its instructions', out[0].role === 'system' && out[0].content.startsWith('Be brief.') && /web_search\(query: string, limit\?: integer\): Live web search\.$/m.test(out[0].content) && /<tool_call>\{"name": "tool_name"/.test(out[0].content));
  ok('a call it made is written back as the call', out[2].role === 'assistant' && out[2].content === 'Searching.\n<tool_call>{"name":"web_search","arguments":{"query":"Cairo population"}}</tool_call>' && !out[2].tool_calls);
  ok('a result comes back in the person\'s turn, which its template does not drop', out[3].role === 'user' && out[3].content === 'Result of web_search:\n{"results":["about 22 million"]}');
  ok('no tool turn is left for its template to drop', !out.some((m) => m.role === 'tool'));
  ok('what it writes back in the form it was taught is read as a call', A.toolCallsInText('<tool_call>{"name": "web_search", "arguments": {"query": "x"}}</tool_call>', ['web_search']).length === 1);
  ok('with no system message, the instructions become one', A.toolsInWords([{ role: 'user', content: 'hi' }], tools)[0].role === 'system');
  ok('with no tools, the conversation is sent as it is', A.toolsInWords(convo, [])[3].role === 'tool');
  const app = readFileSync(join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');
  const ollama = app.slice(app.indexOf('async function agentTurnOllama'), app.indexOf('async function agentTurnOpenAI'));
  ok('the agent turn does this for a model Ollama says cannot take tools, and sends it no tool list', /HCLocalContext\.can\(info, "tools"\)/.test(ollama) && /HCAgentShape\.toolsInWords\(messages, tools\)/.test(ollama) && /tools: native \? tools : undefined/.test(ollama));
}

console.log('\nEvery system message reaches the providers that take the rules apart:');
{
  const sys = A.systemOf([{ role: 'system', content: 'rules' }, { role: 'user', content: 'q' }, { role: 'system', content: 'later note' }]);
  ok('all of them, in order, as one', sys.role === 'system' && sys.content === 'rules\n\nlater note');
  ok('none is none', A.systemOf([{ role: 'user', content: 'q' }]) === null);
  const app = readFileSync(join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');
  ok('no client reads only the first', !/\.find\(m => m\.role === "system"\)/.test(app) && (app.match(/HCAgentShape\.systemOf\(/g) || []).length === 5);
}

console.log('\nPython a model only showed, but spoke of as run, is run:');
{
  const F = '`'.repeat(3);
  const code = 'import math\nprint(math.factorial(17))';
  ok('a result stated under code that prints it', A.claimsItRan(`${F}python\n${code}\n${F}\n\nResult:\n355687428096000`, code));
  ok('a file it says it saved', A.claimsItRan('I saved it to /output/report.pdf', 'x = 1'));
  ok('code that writes a file', A.claimsItRan('Here it is.', "open('/output/a.txt','w')"));
  ok('code shown as an example is left alone', !A.claimsItRan(`Here is how:\n${F}python\n${code}\n${F}\nRun it yourself.`, code));
  ok('the word result before the code is not a claim about it', !A.claimsItRan(`The result you want comes from this:\n${F}python\n${code}\n${F}`, code));
  ok('code that prints nothing claims no output', !A.claimsItRan(`${F}python\nx = 2\n${F}\nResult: 2`, 'x = 2'));
  const shown = `${F}python\n${code}\n${F}\n\n355687428096000`;
  ok('code that prints, when the person asked for it to be run', A.claimsItRan(shown, code, 'Write the code, run it, and show me the result. What is 17 factorial?'));
  ok('... or asked for it in Python', A.claimsItRan(shown, code, 'Work out 17 factorial in Python'));
  ok('... but not when they asked only to see code', !A.claimsItRan(shown, code, 'Show me how to compute 17 factorial.'));
  const app = readFileSync(join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');
  ok('the agent loop runs such code before answering, once a run', /if \(pyCode && !autoRan && HCAgentShape\.claimsItRan\(candidateText, pyCode, userText\)\) \{\s*autoRan = true;/.test(app));
  ok('... and tells the model what really printed in a turn every provider reads', /messages\.push\(\{ role: "user", content: "The Python code in your previous reply was executed automatically/.test(app));
}

console.log('\nGemini gets back the signature on each tool call it made, and no one else sees it:');
{
  const m = [];
  A.appendAssistantToolCallTurn(m, '', [{ id: 'g1', name: 'web_search', arguments: {}, thoughtSignature: 'sig-abc' }, { id: 'g2', name: 'fetch_url', arguments: {} }]);
  ok('a signed call keeps its signature', m[0].tool_calls[0].thoughtSignature === 'sig-abc');
  ok('an unsigned call gets none written in', !('thoughtSignature' in m[0].tool_calls[1]));
  ok('Gemini is handed back its own signature', A.signatureFor(m[0].tool_calls[0]) === 'sig-abc');
  ok('a call another model made is handed Google\'s documented stand-in', A.signatureFor(m[0].tool_calls[1]) === 'skip_thought_signature_validator');
  const out = A.withoutSignatures([{ role: 'user', content: 'x' }, m[0]]);
  ok('every other provider is sent the calls without it', !JSON.stringify(out).includes('thoughtSignature') && out[1].tool_calls.length === 2 && out[1].tool_calls[0].id === 'g1');
  ok('... and the conversation itself keeps it for a later Gemini turn', m[0].tool_calls[0].thoughtSignature === 'sig-abc');
}

console.log('\nArguments that arrive as text are read, and bad ones cost one call:');
ok('a JSON string is parsed', A.safeJsonParse('{"a":1}').a === 1);
ok('an object is passed through', A.safeJsonParse({ a: 1 }).a === 1);
ok('malformed JSON becomes an empty object rather than throwing',
  JSON.stringify(A.safeJsonParse('{not json')) === '{}');
ok('undefined is passed through', A.safeJsonParse(undefined) === undefined);

console.log('\nPython is recovered from a reply, including the usual mangles:');
{
  ok('a plain fence', A.extractPythonFence('```python\nprint(1)\n```') === 'print(1)');
  ok('an unlabelled fence', A.extractPythonFence('```\nprint(1)\n```') === 'print(1)');
  ok('the py alias', A.extractPythonFence('```py\nprint(1)\n```') === 'print(1)');
  {
    // Both blocks come back, in order, separated by a blank line. The exact
    // number of newlines is not pinned: each fence keeps its own trailing one,
    // so the gap is a line wider than it looks, and that costs Python nothing.
    const joined = A.extractPythonFence('```python\na=1\n```\ntext\n```python\nb=2\n```');
    ok('two fences are both returned', joined.includes('a=1') && joined.includes('b=2'));
    ok('in the order they appeared', joined.indexOf('a=1') < joined.indexOf('b=2'));
    ok('separated, not concatenated into one line', /a=1\n\n+b=2/.test(joined));
    ok('the prose between them is left out', !joined.includes('text'));
  }
  // Markdown auto-linking is the single most common way generated code breaks.
  ok('an auto-linked call is unwrapped',
    A.extractPythonFence('```python\n[wb.save](http://wb.save)("f.xlsx")\n```') === 'wb.save("f.xlsx")');
  ok('smart quotes become straight ones',
    A.extractPythonFence('```python\nx = “hi”\n```') === 'x = "hi"');
  ok('no fence means no code', A.extractPythonFence('just prose') === '');
  ok('empty input is safe', A.extractPythonFence('') === '' && A.extractPythonFence(null) === '');
}

console.log('\nThe adapter follows the provider table rather than its own list:');
{
  const parseCloudModel = (v) => {
    const [, provider, ...rest] = v.split(':');
    return { provider, modelId: rest.join(':') };
  };
  const providers = { get: (p) => (['groq', 'openai', 'mistral', 'newcomer'].includes(p) ? {} : null) };
  const pick = (v) => A.selectAgentAdapter(v, { parseCloudModel, providers });

  ok('a local model uses ollama', pick('llama3').kind === 'ollama');
  ok('gemini has its own adapter', pick('cloud:gemini:pro').kind === 'gemini');
  ok('anthropic has its own adapter', pick('cloud:anthropic:sonnet').kind === 'anthropic');
  ok('an OpenAI-shaped provider is recognised', pick('cloud:groq:llama').kind === 'openai');
  ok('the model id survives a colon in its name', pick('cloud:openai:gpt:4o').model === 'gpt:4o');
  ok('every cloud adapter keeps its provider, so a failure names its model whole', pick('cloud:gemini:pro').provider === 'gemini' && pick('cloud:anthropic:sonnet').provider === 'anthropic' && pick('cloud:groq:llama').provider === 'groq');
  // The point of reading the table: a provider added there works here with no
  // second list to remember to update.
  ok('a provider only in the table still works', pick('cloud:newcomer:x').kind === 'openai');
  let threw = false;
  try { pick('cloud:nowhere:x'); } catch { threw = true; }
  ok('a provider in no table is refused loudly', threw);
}

// ── Which client a turn is sent to ────────────────────────────────────────
//
// This decision was written out in six modes, and three of them sent every
// non-Gemini provider to the OpenAI client — Anthropic included. An OpenAI
// body posted to Anthropic's endpoint fails on every call, and the modes that
// failed over then walked the whole provider list before giving up, which is
// what "it never finishes" looked like from the outside.
//
// The one that matters most is the negative: nothing may reach the OpenAI
// client except providers that genuinely take an OpenAI body.
console.log('\nA turn goes to the client its provider actually needs:');
{
  const parseCloudModel = (v) => {
    const [, provider, ...rest] = v.split(':');
    return { provider, modelId: rest.join(':') };
  };
  const providers = { get: (p) => (['groq', 'openai', 'mistral', 'nvidia'].includes(p) ? {} : null) };

  /** Records which client was called, and with what. */
  function route(modelValue, extra = {}) {
    const seen = [];
    const fns = {};
    for (const kind of ['ollama', 'gemini', 'anthropic', 'openai']) {
      fns[kind] = (args) => { seen.push({ kind, args }); return `sent-to-${kind}`; };
    }
    const returned = A.routeModelTurn(
      { modelValue, messages: [{ role: 'user', content: 'x' }], temperature: 0.3, ...extra },
      fns, { parseCloudModel, providers },
    );
    return { calls: seen, returned, only: seen.length === 1 ? seen[0] : null };
  }

  ok('a local model goes to ollama', route('llama3').only.kind === 'ollama');
  ok('gemini goes to the gemini client', route('cloud:gemini:pro').only.kind === 'gemini');
  // The defect this whole change exists for.
  ok('anthropic goes to the anthropic client',
    route('cloud:anthropic:claude-sonnet-4').only.kind === 'anthropic');
  ok('anthropic never reaches the OpenAI client',
    !route('cloud:anthropic:claude-sonnet-4').calls.some(c => c.kind === 'openai'));
  ok('an OpenAI-shaped provider goes to the OpenAI client',
    route('cloud:groq:llama').only.kind === 'openai');
  ok('exactly one client is called', route('cloud:openai:gpt-4o').calls.length === 1);
  ok('the answer is passed straight back', route('cloud:gemini:pro').returned === 'sent-to-gemini');

  // Only the OpenAI client is told which provider it is talking to; the others
  // each serve one, and a stray provider field there would be silently ignored.
  ok('the OpenAI client is told which provider',
    route('cloud:mistral:large').only.args.provider === 'mistral');
  ok('the model id is passed without its prefix',
    route('cloud:anthropic:claude-3:5').only.args.model === 'claude-3:5');

  // A provider nobody routed must stop, not become OpenAI-shaped by default.
  // That default is precisely how Anthropic got the wrong body.
  {
    let threw = false;
    try { route('cloud:unknown-vendor:x'); } catch { threw = true; }
    ok('an unrouted provider is refused, not defaulted to OpenAI', threw);
  }

  // Each client takes a different tool shape, and Swarm builds them per call.
  ok('tools are passed through unchanged when they are a list',
    route('cloud:groq:llama', { tools: [{ n: 1 }] }).only.args.tools.length === 1);
  ok('tools may be built from the client that was chosen',
    route('cloud:anthropic:sonnet', { tools: (kind) => [kind] }).only.args.tools[0] === 'anthropic');
  ok('no tools means an empty list, never undefined',
    Array.isArray(route('llama3').only.args.tools));

  // Coder picks its own failover chain, so it hands over a ready adapter.
  // It must not be re-derived from a model string it no longer has.
  ok('a ready adapter is used as given',
    A.routeModelTurn({ adapter: { kind: 'anthropic', model: 'opus' }, messages: [] },
      { anthropic: (a) => a.model }, {}) === 'opus');
}

console.log('\nAn image is labelled as what it actually is:');
{
  // Base64 puts a file's magic number in a fixed prefix, so the type can be
  // read without decoding. Every provider was told "image/jpeg" regardless.
  // OpenAI sniffs the bytes and forgives it; Anthropic validates the label
  // against the data and refuses a mismatch — so a screenshot, which is a PNG,
  // was refused and the failure read as a provider problem.
  ok('a PNG is a PNG', A.imageMimeFromBase64('iVBORw0KGgoAAAANSUhEUg') === 'image/png')
  ok('a GIF is a GIF', A.imageMimeFromBase64('R0lGODlhAQABAIAAAA') === 'image/gif')
  ok('a WebP is a WebP', A.imageMimeFromBase64('UklGRiQAAABXRUJQ') === 'image/webp')
  ok('a JPEG is a JPEG', A.imageMimeFromBase64('/9j/4AAQSkZJRgABAQ') === 'image/jpeg')
  ok('an unknown format falls back to what everything used to be sent as', A.imageMimeFromBase64('ZZZZunknown') === 'image/jpeg')
  ok('empty is safe', A.imageMimeFromBase64('') === 'image/jpeg')
  ok('null is safe', A.imageMimeFromBase64(null) === 'image/jpeg')

  // And it must reach the data URL, which is the form OpenAI-shaped providers
  // read the type from.
  const v = A.toOpenAIVision([{ role: 'user', content: 'what is this', images: ['iVBORw0KGgoAAAANSUhEUg'] }]);
  ok('the vision block carries the real type',
    v[0].content[1].image_url.url.startsWith('data:image/png;base64,'));
}

console.log('\nAn opened image is put in front of the model:');
{
  const one = A.visionMessage([{ name: 'shot.png', base64: 'iVBORw0KGgo' }]);
  // A user message, not a tool one: several providers reject a tool result
  // carrying an image, and every provider accepts this form.
  ok('it arrives as a user message', one.role === 'user')
  ok('it names the file so the model knows which is which', one.content.includes('shot.png'));
  ok('and it carries the image', one.images.length === 1);

  const many = A.visionMessage([
    { name: 'a.png', base64: 'x' }, { name: 'b.png', base64: 'y' },
  ]);
  ok('several images are named together', many.content.includes('a.png') && many.content.includes('b.png'));
  ok('and all of them travel', many.images.length === 2);

  // An entry with no data would send an empty image, which some providers
  // reject and others answer about as though it were blank.
  ok('an entry with nothing in it is dropped', A.visionMessage([{ name: 'gone.png' }, { name: 'ok.png', base64: 'z' }]).images.length === 1)
  ok('nothing to show is still a well-formed message', A.visionMessage([]).images.length === 0)
  ok('nonsense does not throw', A.visionMessage(null).role === 'user')
}

console.log('\nGemini gets the tool shape Gemini takes:');
{
  const openAi = [
    { type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
    { type: 'function', function: { name: 'write_file', description: 'Write', parameters: { type: 'object', properties: {} } } },
  ];

  const g = A.toGeminiTools(openAi);
  ok('the OpenAI array becomes one functionDeclarations entry',
    g.length === 1 && Array.isArray(g[0].functionDeclarations));
  ok('every function survives the conversion', g[0].functionDeclarations.length === 2);
  ok('names are kept', g[0].functionDeclarations[0].name === 'read_file');
  ok('descriptions are kept', g[0].functionDeclarations[1].description === 'Write');
  // The whole bug in one assertion: "type" at the top level is what Gemini
  // rejects, and rejecting it looks like a bad key rather than a bad body.
  ok('no "type" key is left at the top level',
    g.every((t) => !('type' in t)) && g[0].functionDeclarations.every((d) => !('type' in d)));

  ok('an already-Gemini list passes through untouched',
    A.toGeminiTools(g) === g);
  ok('no tools stays empty', A.toGeminiTools([]).length === 0);
  ok('nonsense does not throw', Array.isArray(A.toGeminiTools(null)));
  ok('a function with no name is dropped rather than sent nameless',
    A.toGeminiTools([{ type: 'function', function: { description: 'x' } }]).length === 0);

  // And through the router, which is where every mode actually reaches it —
  // a mode handing over the OpenAI array is the normal case, not a mistake.
  const sent = A.routeModelTurn(
    { adapter: { kind: 'gemini', model: 'gemini-2.5-pro' }, messages: [], tools: openAi },
    { gemini: (a) => a.tools }, {},
  );
  ok('the router converts on the way to Gemini',
    sent.length === 1 && sent[0].functionDeclarations.length === 2);

  const untouched = A.routeModelTurn(
    { adapter: { kind: 'openai', model: 'gpt-4o' }, messages: [], tools: openAi },
    { openai: (a) => a.tools }, {},
  );
  ok('and leaves every other provider alone', untouched === openAi);
}

console.log('\nA failed call names the model that failed:');
{
  const failing = (kind) => ({ [kind]: () => Promise.reject(new Error('boom')) });
  const seen = await A.routeModelTurn({ modelValue: 'cloud:groq:llama', messages: [] }, failing('openai'),
    { parseCloudModel: (v) => ({ provider: v.split(':')[1], modelId: v.split(':').slice(2).join(':') }), providers: { get: () => ({}) } })
    .catch((e) => e);
  ok('the error carries the model it came from', seen.message === 'boom' && seen.model === 'cloud:groq:llama');
  const given = await A.routeModelTurn({ adapter: { kind: 'anthropic', provider: 'anthropic', model: 'opus' }, messages: [] }, failing('anthropic'), {}).catch((e) => e);
  ok('... also when a ready adapter was handed over', given.model === 'cloud:anthropic:opus');
  const own = Object.assign(new Error('from a repair'), { model: 'cloud:gemini:x' });
  const kept = await A.routeModelTurn({ adapter: { kind: 'gemini', model: 'y' }, messages: [] }, { gemini: () => Promise.reject(own) }, {}).catch((e) => e);
  ok('... and a model already named is not overwritten', kept.model === 'cloud:gemini:x');
  const picked = A.selectAgentAdapter('cloud:gemini:flash', { parseCloudModel: (v) => ({ provider: v.split(':')[1], modelId: v.split(':').slice(2).join(':') }), providers: { get: () => ({}) } });
  const named = await A.routeModelTurn({ adapter: picked, messages: [] }, failing('gemini'), {}).catch((e) => e);
  ok('a Gemini failure from a chosen adapter names the cloud model, never a bare id read as local', named.model === 'cloud:gemini:flash');
}

console.log('\nAn answer cut off at the length limit is carried on:');
{
  ok('OpenAI and Ollama say "length"', A.wasCutOff({ finish: 'length' }));
  ok('Gemini says MAX_TOKENS', A.wasCutOff({ raw: { candidates: [{ finishReason: 'MAX_TOKENS' }] } }));
  ok('Anthropic says max_tokens', A.wasCutOff({ raw: { stop_reason: 'max_tokens' } }));
  ok('a finished answer is not cut off', !A.wasCutOff({ finish: 'stop' }) && !A.wasCutOff({ raw: { candidates: [{ finishReason: 'STOP' }] } }) && !A.wasCutOff({}));
  const deps = { parseCloudModel: (v) => ({ provider: v.split(':')[1], modelId: v.split(':').slice(2).join(':') }), providers: { get: () => ({}) } };
  const parts = (list) => {
    const seen = [];
    return { seen, fns: { openai: (a) => { seen.push(a.messages); const p = list[Math.min(seen.length - 1, list.length - 1)]; return Promise.resolve({ content: p[0], finish: p[1] }); } } };
  };
  {
    const { seen, fns } = parts([['<html><body>', 'length'], ['<p>hi</p>', 'length'], ['</body></html>', 'stop']]);
    const turn = await A.routeModelTurn({ modelValue: 'cloud:groq:m', messages: [{ role: 'user', content: 'page' }], untilFinished: true }, fns, deps);
    ok('the parts are joined into one answer', turn.content === '<html><body><p>hi</p></body></html>');
    ok('... it says how many more turns it took, and that it is finished', turn.continued === 2 && turn.cutOff === false);
    ok('each follow-up carries what was written so far and asks to continue',
      seen[1].length === 3 && seen[1][1].role === 'assistant' && seen[1][1].content === '<html><body>' && /Continue exactly where it stopped/.test(seen[1][2].content));
  }
  {
    const { fns } = parts([['a', 'length']]);
    const turn = await A.routeModelTurn({ modelValue: 'cloud:groq:m', messages: [], untilFinished: true }, fns, deps);
    ok('it stops asking after three more turns, and says it is still cut off', turn.continued === 3 && turn.cutOff === true && turn.content === 'aaaa');
  }
  {
    const { seen, fns } = parts([['a', 'length']]);
    const turn = await A.routeModelTurn({ modelValue: 'cloud:groq:m', messages: [] }, fns, deps);
    ok('without untilFinished the first part comes back, marked cut off', seen.length === 1 && turn.cutOff === true);
  }
  const swarm = readFileSync(join(here, '..', '..', 'src', 'modes', 'agent-maker', 'mode.js'), 'utf8');
  const systems = readFileSync(join(here, '..', '..', 'src', 'modes', 'systems', 'mode.js'), 'utf8');
  ok('the Agent Swarm asks for finished answers', /runModelTurn\(\{[\s\S]{0,120}untilFinished: true/.test(swarm));
  ok('... and says in the trace when one was cut off', /result\.continued \|\| result\.cutOff/.test(swarm));
  ok('the Systems builder asks for finished answers, unless a caller says a cut-off answer is read as it is', /untilFinished = true \} = \{\}\) \{/.test(systems) && /runModelTurn\(\{[^}]*untilFinished, need, json \}\)/.test(systems));
  ok('no agent answer carries a note about providers', !/switched providers during execution|\[Failover:/.test(swarm));
}

console.log('\nA turn cut off by Stop or an error is closed, not left open:');
{
  // A provider refuses a history where an assistant's tool calls are not all
  // answered, so the message after a stopped run failed.
  const call = (id, name) => ({ id, name, arguments: {} });
  const valid = (msgs) => {
    // Every tool call answered, every tool result for a call made, and the
    // history ending on an assistant reply.
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== 'assistant' || !m.tool_calls) continue;
      const after = new Set(msgs.slice(i + 1).filter((x) => x.role === 'tool').map((x) => x.tool_call_id));
      if (!m.tool_calls.every((c) => after.has(c.id))) return false;
    }
    const last = msgs[msgs.length - 1];
    return last.role === 'assistant' && !last.tool_calls;
  };
  const base = () => [{ role: 'system', content: 's' }, { role: 'user', content: 'fix it' }];

  const mid = base();
  A.appendAssistantToolCallTurn(mid, '', [call('c1', 'read_file'), call('c2', 'shell_run'), call('c3', 'write_file')]);
  A.appendToolResult(mid, call('c1', 'read_file'), 'file text');
  ok('control: stopped mid-batch the history is not one a provider takes', !valid(mid));
  A.closeInterruptedTurn(mid, 'Stopped by the user before this finished.');
  ok('stopped mid-batch, it is closed', valid(mid));
  ok('what ran is kept', mid.some((m) => m.role === 'tool' && m.tool_call_id === 'c1' && m.content === 'file text'));
  ok('each call that did not run says why', ['c2', 'c3'].every((id) => mid.some((m) => m.tool_call_id === id && /Stopped by the user/.test(m.content))));
  ok('and a note ends the turn', /Stopped by the user/.test(mid.at(-1).content));

  const early = base();
  A.closeInterruptedTurn(early, 'The run ended with an error before this finished.');
  ok('stopped before any reply, a note answers the message', valid(early) && early.length === 3);

  const done = base();
  A.appendAssistantToolCallTurn(done, '', [call('c1', 'read_file')]);
  A.appendToolResult(done, call('c1', 'read_file'), 'x');
  A.closeInterruptedTurn(done, 'Stopped.');
  ok('stopped between tool rounds, nothing is invented', valid(done) && done.filter((m) => m.role === 'tool').length === 1);

  const finished = [...base(), { role: 'assistant', content: 'All done.' }];
  A.closeInterruptedTurn(finished, 'Stopped.');
  ok('a finished conversation is left as it is', finished.length === 3 && finished.at(-1).content === 'All done.');

  const coder = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  ok('Coder closes the turn whenever a run stops or fails',
    /\} catch \(e\) \{[\s\S]{0,300}closeInterruptedTurn\(conversationMsgs/.test(coder));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-shape.js)`);
process.exit(fail ? 1 : 0);
