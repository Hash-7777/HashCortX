// ==============================================================
// Tool calls written in a model's words — checks
//
// Loads the REAL src/js/tool-text.js and holds that a tool call is read in
// each of the ways local models write one, with the keys each spells it with,
// only for tools that were offered, and that an answer merely showing a call
// among its words is left alone.
//
// Run with: npm run check:tool-text
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });
vm.runInContext(src('js', 'tool-text.js'), sandbox, { filename: 'tool-text.js' });
const T = sandbox.window.HCToolText;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const names = ['web_search', 'execute_python', 'current_datetime'];
const F = '`'.repeat(3);
const one = (text, name = 'web_search', arg = 'query', value = 'x') => {
  const c = T.callsIn(text, names);
  return c.length === 1 && c[0].name === name && (arg === null || c[0].arguments[arg] === value);
};

console.log('Each way a call is written:');
ok('tags around JSON, after a sentence saying what it will do', one('I will look it up.\n<tool_call>\n{"name": "web_search", "arguments": {"query": "x"}}\n</tool_call>'));
ok('several tagged calls in one reply', T.callsIn('<tool_call>{"name":"web_search","arguments":{"query":"a"}}</tool_call>\n<tool_call>{"name":"current_datetime","arguments":{}}</tool_call>', names).map((c) => c.name).join() === 'web_search,current_datetime');
ok('pipe tags with a closing tag', one('<|tool_call|>[{"name":"web_search","arguments":{"query":"x"}}]<|/tool_call|>'));
ok('pipe tag with a list and no closing tag', one('<|tool_call|>[{"name": "web_search", "arguments": {"query": "x"}}]'));
ok('a function tag naming the tool', one('<function=web_search>{"query": "x"}</function>'));
ok('a function tag with one parameter tag per argument, inside call tags', (() => { const c = T.callsIn('<tool_call>\n<function=web_search>\n<parameter=query>\nsolar panels\n</parameter>\n<parameter=limit>\n3\n</parameter>\n</function>\n</tool_call>', names); return c.length === 1 && c[0].arguments.query === 'solar panels' && c[0].arguments.limit === 3; })());
ok('a function tag the model never closed, with no arguments', one('<tool_call>\n<function=current_datetime>', 'current_datetime', null));
ok('two function tags, the first unclosed', T.callsIn('<function=current_datetime>\n<function=web_search>\n<parameter=query>x</parameter>\n</function>', names).map((c) => c.name).join() === 'current_datetime,web_search');
ok('a call list after its marker', one('[TOOL_CALLS] [{"name": "web_search", "arguments": {"query": "x"}}]'));
ok('the marker with the name and its arguments apart', one('[TOOL_CALLS]web_search[ARGS]{"query": "x"}'));
ok('JSON after the python tag, with parameters', one('<|python_tag|>{"name": "web_search", "parameters": {"query": "x"}}<|eom_id|>'));
ok('a Python call after the python tag', one('<|python_tag|>web_search.call(query="x")'));
ok('a list after functools', one('functools[{"name": "web_search", "arguments": {"query": "x"}}]'));
ok('call tokens, name then a json block', one('<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>web_search\n```json\n{"query": "x"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>'));
ok('call tokens, name and arguments on either side of the separator', one('<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>web_search<｜tool▁sep｜>{"query": "x"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>'));
ok('a tool_code block holding a printed call', one(`${F}tool_code\nprint(functions.web_search(query="x"))\n${F}`));
ok('a tool_code block with single quotes and a number', (() => { const c = T.callsIn(`${F}tool_code\nweb_search(query='x', limit=3)\n${F}`, names); return c.length === 1 && c[0].arguments.query === 'x' && c[0].arguments.limit === 3; })());
ok('bare JSON', one('{"name": "web_search", "arguments": {"query": "x"}}'));
ok('a json block ending the reply', one(`Searching now.\n${F}json\n{"name":"web_search","arguments":{"query":"x"}}\n${F}`));

console.log('\nEach way a call is spelled:');
ok('action and action_input', one('{"action": "web_search", "action_input": {"query": "x"}}'));
ok('tool and tool_input as a string', one('{"tool": "web_search", "tool_input": "{\\"query\\": \\"x\\"}"}'));
ok('arguments written beside the name', one('{"name": "web_search", "query": "x"}'));
ok('a list under tool_calls, with arguments as a string', one('{"tool_calls": [{"type": "function", "function": {"name": "web_search", "arguments": "{\\"query\\": \\"x\\"}"}}]}'));
ok('args', one('{"name": "web_search", "args": {"query": "x"}}'));
ok('thinking written before the call is not part of it', one('<think>I should search.</think>\n{"name": "web_search", "arguments": {"query": "x"}}'));

console.log('\nWhat is not a call:');
ok('a tool that was not offered, in tags', T.callsIn('<tool_call>{"name":"delete_files","arguments":{}}</tool_call>', names).length === 0);
ok('a tool that was not offered, bare', T.callsIn('{"name":"delete_files","arguments":{}}', names).length === 0);
ok('an answer showing an example among its words', T.callsIn('Call it like this: {"name":"web_search","arguments":{}} and you are done.', names).length === 0);
ok('a json example with words before and after it', T.callsIn(`Like this:\n${F}json\n{"name":"web_search","arguments":{}}\n${F}\nThat is the format.`, names).length === 0);
ok('ordinary JSON with a name in it', T.callsIn('{"name": "John", "age": 3}', names).length === 0);
ok('Python code that happens to name a tool is not a tool_code block', T.callsIn(`${F}python\nweb_search(query="x")\n${F}`, names).length === 0);
ok('an answer that talks about the tags', T.callsIn('Models often wrap calls in <tool_call> tags.', names).length === 0);
ok('with no tools offered, nothing is a call', T.callsIn('{"name":"web_search","arguments":{}}', []).length === 0);
ok('an empty reply', T.callsIn('', names).length === 0 && T.callsIn(null, names).length === 0);

console.log('\nThe pieces:');
ok('the first whole JSON value inside text', T.parseJson('Here: {"a": {"b": "}"}} done').a.b === '}');
ok('keyword arguments with every kind of value', (() => { const k = T.kwargs('a="x, y", b=2.5, c=True, d=None, e=[1, 2]'); return k.a === 'x, y' && k.b === 2.5 && k.c === true && k.d === null && k.e.length === 2; })());
ok('thinking at the start taken off, and only there', T.withoutThinking('<think>a</think> b') === 'b' && T.withoutThinking('b <think>a</think>') === 'b <think>a</think>');

console.log('\nThe agents read calls through it:');
{
  const shape = src('js', 'agent-shape.js');
  ok('the agent turn reads text calls here', /window\.HCToolText\.callsIn\(text, names\)/.test(shape));
  const boot = src('boot.js');
  ok('it loads after the fences it reads blocks with and before the agents', boot.indexOf("'/js/fences.js'") < boot.indexOf("'/js/tool-text.js'") && boot.indexOf("'/js/tool-text.js'") < boot.indexOf("'/js/agent-shape.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/tool-text.js)`);
process.exit(fail ? 1 : 0);
