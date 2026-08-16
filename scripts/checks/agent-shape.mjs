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

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-shape.js)`);
process.exit(fail ? 1 : 0);
