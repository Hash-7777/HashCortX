// ==============================================================
// A local agent decides, the app acts, the model answers — checks
//
// Loads the REAL src/js/chat/decide.js, with js/agent-shape.js, js/tool-text.js
// and js/chat/intent.js beside it, and runs its loop against stand-in models
// and tools. Holds that a decision is held to the tools the agent has and to
// each tool's own arguments, that the app takes the first step itself when a
// request is plain, that a repeated call ends the loop, that the answer is
// asked for once the decisions end and carries the results, that what
// changes between requests goes just before the request, and that an answer
// which is itself a call is run and answered again.
//
// Run with: npm run check:decide
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'fences.js'], ['js', 'tool-text.js'], ['js', 'agent-shape.js'], ['js', 'chat', 'intent.js'], ['js', 'chat', 'decide.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
const D = sandbox.window.HCDecide;
const shape = sandbox.window.HCAgentShape;
const I = sandbox.window.HCIntent;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const fn = (name, props = {}, required = []) => ({ type: 'function', function: { name, description: `${name} does its job.\nMore.`, parameters: { type: 'object', properties: props, required } } });
const tools = [fn('web_search', { query: { type: 'string' } }, ['query']), fn('calculate', { expression: { type: 'string' } }, ['expression']), fn('current_datetime')];
const names = tools.map((t) => t.function.name);

/** Runs the loop with scripted decisions and answers; records what each call was sent. */
async function play({ decisions = [], answers = ['The answer.'], request = 'hi', context, route = (t) => I.route(t, names), results = {}, needsTool = false }) {
  const asked = [];
  const answered = [];
  const answeredAfter = [];
  const ran = [];
  const out = await D.run({
    messages: [{ role: 'system', content: 'Agent rules.' }, { role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier answer' }, { role: 'user', content: request }],
    tools, shape, context, route, needsTool,
    ask: async (msgs, schema) => { asked.push({ msgs, schema }); return decisions.shift() ?? '{"tool":"none","arguments":{}}'; },
    answer: async (msgs, toolsRun) => { answered.push(msgs); answeredAfter.push(toolsRun); return answers.shift() ?? 'The answer.'; },
    runTool: async (call) => { ran.push(call); return results[call.name] ?? '{"ok":true}'; },
  });
  return { out, asked, answered, answeredAfter, ran };
}

console.log('What a decision may be:');
{
  const s = D.schema(tools);
  ok('one of the agent\'s tools with that tool\'s own arguments, or none', s.anyOf.length === 4 && s.anyOf[0].properties.tool.enum[0] === 'web_search' && s.anyOf[0].properties.arguments.required[0] === 'query' && s.anyOf[3].properties.tool.enum[0] === 'none');
  const only = D.schema(tools, 'calculate');
  ok('narrowed to the one tool the app chose, only its arguments are left to write', !only.anyOf && only.properties.tool.enum.join() === 'calculate' && only.properties.arguments.properties.expression);
  const must = D.schema(tools, undefined, { none: false });
  ok('when the app knows a tool is needed, none is not among the choices', must.anyOf.length === 3 && !must.anyOf.some((x) => x.properties.tool.enum[0] === 'none'));
  ok('read: a tool it has, with its arguments', D.read('{"tool":"calculate","arguments":{"expression":"2+2"}}', tools).arguments.expression === '2+2');
  ok('read: none', D.read('{"tool":"none","arguments":{}}', tools).tool === 'none');
  ok('read: a tool it does not have, or not a decision at all, is nothing', D.read('{"tool":"delete_all","arguments":{}}', tools) === null && D.read('sure!', tools) === null && D.read('{"arguments":{}}', tools) === null);
  const g = D.guide(tools);
  ok('the tools are told with their arguments and when each is the one', /^- calculate\(expression\): calculate does its job\. Choose it for any arithmetic/m.test(g) && /current_datetime\(\)/.test(g));
}

console.log('\nThe loop:');
{
  const r = await play({ request: 'Is Pluto a planet?', decisions: ['{"tool":"web_search","arguments":{"query":"Pluto planet status"}}', '{"tool":"none","arguments":{}}'], results: { web_search: '{"results":["dwarf planet"]}' } });
  ok('it decides, the app runs the tool, it decides again with the result', r.asked.length === 2 && r.ran.length === 1 && r.ran[0].arguments.query === 'Pluto planet status' && /dwarf planet/.test(JSON.stringify(r.asked[1].msgs)));
  const last = r.answered[0];
  ok('then it answers, told to say only what answers it, as the tools gave it', r.answered.length === 1 && /Say only what answers it/.test(last.at(-1).content) && /exactly as the tools gave them/.test(last.at(-1).content) && last.some((m) => /Result of web_search/.test(m.content)));
  ok('every step is sent the same instructions, so they are read once', r.asked[0].msgs[0].content === r.answered[0][0].content && r.asked[1].msgs[0].content === r.asked[0].msgs[0].content);
  ok('every tool turn is written in words, which every model\'s template reads', !JSON.stringify(r.answered[0]).includes('"role":"tool"'));
  ok('the result of the loop is the answer and the calls made', r.out.text === 'The answer.' && r.out.calls.length === 1);
  ok('the answer is told how many tools ran, so reading back a result can be asked for plainly', r.answeredAfter[0] === 1);
}
{
  const r = await play({ request: 'Is Pluto a planet?', decisions: ['{"tool":"web_search","arguments":{"query":"x"}}', '{"tool":"web_search","arguments":{"query":"x"}}', '{"tool":"web_search","arguments":{"query":"x"}}'] });
  ok('the same call again ends the loop: its result is already there', r.ran.length === 1 && r.asked.length === 2 && r.answered.length === 1);
}
{
  const r = await play({ request: 'Is Pluto a planet?', decisions: ['not json'] });
  ok('a decision it could not write means no tool, and it answers', r.ran.length === 0 && r.answered.length === 1 && !/Say only what answers it/.test(JSON.stringify(r.answered[0].at(-1))));
}
{
  const r = await play({ request: 'Is Pluto a planet?', decisions: Array(10).fill(0).map((_, i) => `{"tool":"web_search","arguments":{"query":"q${i}"}}`) });
  ok('it stops deciding after its limit of steps and answers', r.ran.length === 6 && r.answered.length === 1);
}

console.log('\nWhen the app knows the request needs a tool:');
{
  const r = await play({ request: 'the records', route: null, needsTool: true, decisions: ['{"tool":"web_search","arguments":{"query":"records"}}', '{"tool":"none","arguments":{}}'] });
  const first = r.asked[0], second = r.asked[1];
  ok('the first decision must name one, and is asked for one', !first.schema.anyOf.some((x) => x.properties.tool.enum[0] === 'none') && first.msgs.at(-1).content === D.MUST);
  ok('after it has read, the model may decide it has enough', second.schema.anyOf.some((x) => x.properties.tool.enum[0] === 'none') && second.msgs.at(-1).content === D.DECIDE && r.ran.length === 1);
  ok('without it, the first decision may be none, as before', (await play({ request: 'the records', route: null })).asked[0].schema.anyOf.some((x) => x.properties.tool.enum[0] === 'none'));
}

console.log('\nThe app takes the first step when the request is plain:');
{
  const r = await play({ request: 'Write a haiku about autumn.' });
  ok('a request to write: no decision is asked for at all, it goes straight to the answer', r.asked.length === 0 && r.ran.length === 0 && r.answered.length === 1);
  const t = await play({ request: 'What day of the week is it today?' });
  ok('the date: run straight away, nothing for the model to decide or write', t.ran[0].name === 'current_datetime' && t.asked.length === 1 && !t.asked[0].schema.properties);
  const c = await play({ request: 'What is 1234 * 5678?', decisions: ['{"tool":"calculate","arguments":{"expression":"1234*5678"}}'] });
  ok('arithmetic: the model is held to the calculator and writes only the sum', c.asked[0].schema.properties.tool.enum.join() === 'calculate' && c.ran[0].arguments.expression === '1234*5678');
  ok('after the first step the model decides again with every tool', c.asked.length === 2 && c.asked[1].schema.anyOf.length === 4);
  const n = await play({ request: 'Is Pluto a planet?', decisions: ['{"tool":"none","arguments":{}}'] });
  ok('a request that is not plain is the model\'s to decide, among every tool', n.asked[0].schema.anyOf.length === 4);
}

console.log('\nWhat changes between requests goes just before the request:');
{
  const r = await play({ request: 'Is Pluto a planet?', context: '[INTERNAL MEMORY] - colour: teal' });
  const msgs = r.asked[0].msgs;
  const at = msgs.findIndex((m) => m.content === 'Is Pluto a planet?');
  ok('right before it, and not in the instructions, so the instructions stay the same', msgs[at - 1].role === 'system' && /colour: teal/.test(msgs[at - 1].content) && !/teal/.test(msgs[0].content));
  ok('... and the earlier conversation stays before it too', msgs.findIndex((m) => m.content === 'earlier') < at - 1);
}

console.log('\nAn answer that is itself a call:');
{
  const r = await play({ request: 'Is Pluto a planet?', answers: ['<tool_call>{"name":"web_search","arguments":{"query":"pluto"}}</tool_call>', 'It is a dwarf planet.'] });
  ok('is run, and the model answers again from its result', r.ran.length === 1 && r.ran[0].arguments.query === 'pluto' && r.answered.length === 2 && r.out.text === 'It is a dwarf planet.');
}

console.log('\nWhat the person sees:');
{
  const seen = [];
  const v = D.shower((t) => seen.push(t));
  let full = '';
  for (const d of ['The ', 'answer ', 'is 4.']) { full += d; v.onToken(d, full); }
  v.finish(full, false);
  ok('an answer is shown as it streams, and only once', seen.join('') === 'The answer is 4.');
  const held = [];
  const h = D.shower((t) => held.push(t));
  full = '';
  for (const d of ['<tool_call>{"name":', '"web_search","arguments":{}}</tool_call>']) { full += d; h.onToken(d, full); }
  h.finish(full, true);
  ok('one that opens like a call is held back, and never shown when it is one', held.length === 0);
  const json = [];
  const j = D.shower((t) => json.push(t));
  j.onToken('{"a": 1}', '{"a": 1}');
  j.finish('{"a": 1}', false);
  ok('... and shown whole when it turns out not to be', json.join('') === '{"a": 1}');
  ok('each step says what it is doing', D.statusOf('deciding', 1) === 'Deciding what the request needs…' && /next step \(2\)/.test(D.statusOf('deciding', 2)) && D.statusOf('answering', 1) === 'Writing the answer from the results…');
  ok('the reply that stands: the answer, or, when it is a call or nothing, the tools named', D.replyOf('Four.', names, 1, shape) === 'Four.' && /used 2 tools but did not write an answer/.test(D.replyOf('<tool_call>{"name":"web_search","arguments":{}}</tool_call>', names, 2, shape)) && D.replyOf('', names, 0, shape) === '');
}

console.log('\nThe chat uses it for local agents:');
{
  const app = src('js', 'app.js');
  ok('a local agent with tools takes its turn in steps', /const localSteps = !modelEl\.value\.startsWith\("cloud:"\) && tools\.length > 0;/.test(app) && /if \(localSteps\) return runLocalAgentSteps\(/.test(app));
  ok('with the app\'s first step and what is remembered passed apart', /route: \(text\) => \(window\.HCMcp\?\.speaksOf\(text\) \? null : HCIntent\.route\(text, names\)\)/.test(app) && /context: memBlock/.test(app) && /if \(memBlock && !localSteps\)/.test(app));
  ok('decisions are held to their schema at no randomness; answers stream', /json: schema/.test(app) && /temperature: json \? 0 : temperature/.test(app) && /HCDecide\.shower\(onFinalToken\)/.test(app));
  ok('a model that thinks is not asked to for a decision or to read back a result, only when Ollama says it thinks', /caps\?\.includes\("thinking"\)/.test(app) && /think: \(json \|\| plain\) && thinks \? false : undefined/.test(app) && /plain: toolsRun > 0/.test(app));
  const boot = src('boot.js');
  ok('it loads after what it reads calls with, and before the chat', boot.indexOf("'/js/agent-shape.js'") > 0 && boot.indexOf("'/js/chat/intent.js'") < boot.indexOf("'/js/chat/decide.js'") && boot.indexOf("'/js/chat/decide.js'") < boot.indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/decide.js)`);
process.exit(fail ? 1 : 0);
