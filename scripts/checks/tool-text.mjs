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
ok('two calls written one after another, one per line', T.callsIn('{"name": "web_search", "arguments": {"query": "a"}}\n{"name": "current_datetime", "arguments": {}}', names).map((c) => c.name).join() === 'web_search,current_datetime');
ok('a row cut off partway keeps the calls written whole before the cut', T.callsIn('{"name": "web_search", "arguments": {"query": "a"}}\n{"name": "current_datetime", "arguments": {}}\n{"name": "web_search", "arguments": {"query": "b', names).map((c) => c.name).join() === 'web_search,current_datetime');
ok('a call followed by a fence with nothing in it is read', one(`{"name": "web_search", "arguments": {"query": "x"}}\n${F}\n`));
{
  const loose = T.callsIn('{"name": "web_search", "arguments": {"query": "x.split(/\\s+/)"}}', names);
  ok('a backslash JSON does not allow, in a pattern, is kept as written', loose.length === 1 && loose[0].arguments.query === 'x.split(/\\s+/)');
  const both = T.callsIn('{"name": "web_search", "arguments": {"query": "\\d and \\\\s and \\n"}}', names);
  ok('... and the escapes JSON does allow keep their meaning beside it', both.length === 1 && both[0].arguments.query === '\\d and \\s and \n');
  const quoted = T.callsIn(String.raw`{"name": "web_search", "arguments": {"query": "x.replace(/[^a-z]/g, \'-\').split(/\s+/)"}}`, names);
  ok('a quote written with a backslash before it is the quote, with a pattern\'s backslash beside it kept', quoted.length === 1 && quoted[0].arguments.query === "x.replace(/[^a-z]/g, '-').split(/\\s+/)");
}
ok('calls with a code block between them are left alone', T.callsIn(`{"name": "web_search", "arguments": {}}\n${F}js\nx()\n${F}\n{"name": "web_search", "arguments": {}}`, names).length === 0);
ok('a list of calls ending in a line of words keeps the calls', T.callsIn('{"name": "web_search", "arguments": {"query": "a"}}\n{"name": "current_datetime", "arguments": {}}\n"Done. Tests passed."', names).map((c) => c.name).join() === 'web_search,current_datetime');
ok('a single call cut off is not read', T.callsIn('{"name": "web_search", "arguments": {"query": "a', names).length === 0);
ok('calls in a row inside a json block, with commas between', T.callsIn(`${F}json\n{"name":"web_search","arguments":{"query":"a"}},\n{"name":"web_search","arguments":{"query":"b"}}\n${F}`, names).map((c) => c.arguments.query).join() === 'a,b');

{
  const said = T.callsIn('Found the file.\n\nNow reading it before changing it.\n\n{"name": "web_search", "arguments": {"query": "slugify"}}', names);
  ok('a call written as the last lines, after words saying what it is for', said.length === 1 && said[0].name === 'web_search' && said[0].arguments.query === 'slugify');
  ok('... and calls in a row there', T.callsIn('Two steps.\n{"name": "web_search", "arguments": {}}\n{"name": "current_datetime", "arguments": {}}', names).map((c) => c.name).join() === 'web_search,current_datetime');
  ok('... the last one, when an example came earlier among the words', T.callsIn('A call looks like\n{"name": "web_search", "arguments": {}}\nso here is mine:\n{"name": "current_datetime", "arguments": {}}', names).map((c) => c.name).join() === 'current_datetime');
}
console.log('\nA call whose JSON a file\'s unescaped text broke, on a model on this computer:');
{
  const tools = ['write_file', 'patch_file', 'shell_run', 'web_search'];
  const params = { write_file: ['path', 'content', 'replace_whole', 'reason'], patch_file: ['path', 'search', 'replace', 'all', 'reason'], shell_run: ['command', 'args'] };
  const Q = '"""';
  const read = (t) => T.callsIn(t, tools, params);
  const doc = read(`{"name": "write_file", "arguments": {"path":"/p/stats.py", "content":"${Q}Helpers.${Q}\n\ndef mean(values):\n    return sum(values) / len(values)\n"}}`);
  ok('a file\'s text with its own quotes and new lines, as the file has them', doc.length === 1 && doc[0].arguments.path === '/p/stats.py' && doc[0].arguments.content === `${Q}Helpers.${Q}\n\ndef mean(values):\n    return sum(values) / len(values)\n`, JSON.stringify(doc));
  const bare = read('{"name": "write_file", "arguments": {"path":"/p/t.py", "content":import unittest\n\nunittest.main(), "reason":"Fixed."}}');
  ok('a file\'s text written with no quotes at all, up to the next argument', bare.length === 1 && bare[0].arguments.content === 'import unittest\n\nunittest.main()' && bare[0].arguments.reason === 'Fixed.', JSON.stringify(bare));
  const lines = read('{"name": "write_file", "arguments": {"path":"/p/a.html","content":"<div class=\\"x\\">\n  hi\n</div>\n","reason":"page"}}');
  ok('new lines left bare in text otherwise escaped: read as JSON, the escapes kept as meant', lines.length === 1 && lines[0].arguments.content === '<div class="x">\n  hi\n</div>\n', JSON.stringify(lines));
  const patch = read('{"name": "patch_file", "arguments": {"path":"/p/a.js","search":"const x = "a";","replace":"const x = "b";","all":true}}');
  ok('each argument of an edit, a true or false read as one', patch.length === 1 && patch[0].arguments.search === 'const x = "a";' && patch[0].arguments.replace === 'const x = "b";' && patch[0].arguments.all === true);
  const two = read('{"name": "write_file", "arguments": {"path":"/p/r.js","content":"const a = "x";\n"}}\n{"name": "shell_run", "arguments": {"command":"npm","args":["test"]}}');
  ok('a call written after it is not part of its text', two.length === 1 && two[0].name === 'write_file' && two[0].arguments.content === 'const a = "x";\n', JSON.stringify(two));
  ok('only a call that opens the reply', read('Here: {"name": "write_file", "arguments": {"path":"/p/a","content":"a "b" c"}}').length === 0);
  ok('only to a tool offered, whose argument names are known', read('{"name": "delete_files", "arguments": {"path":"/p/a "b""}}').length === 0
    && T.callsIn('{"name": "write_file", "arguments": {"path":"/p/a","content":"a "b" c"}}', tools).length === 0);
  ok('a call that parses is read as it was', JSON.stringify(read('{"name": "shell_run", "arguments": {"command": "npm", "args": ["test"]}}')) === '[{"name":"shell_run","arguments":{"command":"npm","args":["test"]}}]');
  const shape = src('js', 'agent-shape.js');
  ok('the local model\'s turn is the one given the argument names, from the tools it was offered',
    /toolCallsInText\(msg && msg\.content, \(tools \|\| \[\]\)\.map\(\(t\) => t && t\.function && t\.function\.name\), argumentNames\(tools\), requiredArguments\(tools\)\)/.test(shape));
}

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
{
  const guessed = T.callsIn(`{"name": "web_search", "arguments": {"query": "a"}}\n${F}json\n{"ok": true, "output": "PASS  5 tests passed"}\n${F}`, names);
  ok('a call opening the reply, then the result the model guessed for it: the call is read, the guess dropped', guessed.length === 1 && guessed[0].name === 'web_search' && guessed[0].arguments.query === 'a');
  ok('... and so is one followed by JSON that is not a call, or by words', one('{"name": "web_search", "arguments": {"query": "x"}}\n{"total": 3}') && one('{"name": "web_search", "arguments": {"query": "x"}}\nThe search found three results and the tests pass.'));
  ok('... or opening a json block, with the guess after it', one(`${F}json\n{"name": "web_search", "arguments": {"query": "x"}}\n${F}\nResult: {"ok": true}`));
  ok('... and a guess that holds JSON with a name in it, as a package file does', one('{"name": "web_search", "arguments": {"query": "x"}}\n{"ok": true, "content": {"name": "range-utils", "version": "1.0.0"}}'));
  ok('... but not when another call comes after it, written as one to any tool', T.callsIn('{"name": "web_search", "arguments": {}}\nthen\n{"name": "current_datetime", "arguments": {}}\ndone', names).length === 0
    && T.callsIn('{"name": "web_search", "arguments": {}}\nand {"tool": "delete_files", "tool_input": {}} next', names).length === 0);
  ok('... nor when the opening value is not a call to an offered tool', T.callsIn('{"name": "delete_files", "arguments": {}}\nDone.', names).length === 0 && T.callsIn('{"name": "John", "age": 3}\nThat is him.', names).length === 0);
}
ok('two calls with words between them are left alone', T.callsIn('{"name": "web_search", "arguments": {}}\nand then\n{"name": "current_datetime", "arguments": {}}', names).length === 0);
ok('a call in a row with one to a tool not offered is not read', T.callsIn('{"name": "web_search", "arguments": {}}\n{"name": "delete_files", "arguments": {}}', names).length === 0);
ok('a call after words, followed by more words, is an example', T.callsIn('Like this:\n{"name": "web_search", "arguments": {}}\nThat is the format.', names).length === 0);
ok('... and so are calls in a row with words after them', T.callsIn('Like this:\n{"name": "web_search", "arguments": {}}\n{"name": "current_datetime", "arguments": {}}\nThat is how.', names).length === 0);
ok('a call after words, cut off, is not read', T.callsIn('Reading it now.\n{"name": "web_search", "arguments": {"query": "a', names).length === 0);
ok('JSON after words that is not a call is not read', T.callsIn('The settings are:\n{"port": 8080}', names).length === 0);
ok('Python code that happens to name a tool is not a tool_code block', T.callsIn(`${F}python\nweb_search(query="x")\n${F}`, names).length === 0);
ok('an answer that talks about the tags', T.callsIn('Models often wrap calls in <tool_call> tags.', names).length === 0);
ok('with no tools offered, nothing is a call', T.callsIn('{"name":"web_search","arguments":{}}', []).length === 0);
ok('an empty reply', T.callsIn('', names).length === 0 && T.callsIn(null, names).length === 0);

console.log('\nA closing bracket written once too often:');
ok('a bare call with one brace too many is read', one('{"name": "web_search", "arguments": {"query": "x"}}}'));
ok('... and in a json block ending the reply', one(`Looking now.\n${F}json\n{"name": "web_search", "arguments": {"query": "x"}}}\n${F}`));
ok('words before it and after the extra brace still make it an example', T.callsIn('It looks like {"name": "web_search", "arguments": {"query": "x"}}} and that is all.', names).length === 0);

console.log('\nA plan whose steps are json blocks of calls:');
{
  const coder = ['write_file', 'read_file', 'grep_code'];
  const must = { write_file: ['path', 'content'], read_file: ['path'], grep_code: ['dir', 'pattern'] };
  const block = (v) => `${F}json\n${v}\n${F}`;
  const plan = ['I will build the page step by step.', '### Step 1: the page', block('{"name": "write_file", "arguments": {"path": "index.html", "content": "<h1>Hello</h1>"}}}'),
    '### Step 2: the styles', block('{"name": "write_file", "arguments": {"path": "style.css", "content": "h1 { color: teal; }"}}}'), '### Summary', 'The page is ready.'].join('\n');
  const got = T.callsIn(plan, coder, null, must);
  ok('each step read in order, the extra braces taken off', got.map((c) => `${c.name}:${c.arguments.path}`).join() === 'write_file:index.html,write_file:style.css');
  ok('... with the arguments as written', got[0] && got[0].arguments.content === '<h1>Hello</h1>');
  ok('... only when the caller says which arguments each tool must have', T.callsIn(plan, coder).length === 0);
  const blank = ['First find it.', block('{"name": "grep_code", "arguments": {"dir": "src", "pattern": "Hello"}}'), 'Then read it.', block('{"name": "read_file", "arguments": {"path": "index.html", "start_line": <line>}}')].join('\n');
  ok('the reading stops at a step left with a blank to fill in', T.callsIn(blank, coder, null, must).map((c) => c.name).join() === 'grep_code');
  ok('a first step with a blank reads nothing', T.callsIn(['Read it.', block('{"name": "read_file", "arguments": {"path": <path>}}')].join('\n'), coder, null, must).length === 0);
  ok('a step missing an argument it must have reads nothing', T.callsIn(['Like this:', block('{"name": "write_file", "arguments": {"path": "a.txt"}}'), 'That is all.'].join('\n'), coder, null, must).length === 0);
  ok('an example with its arguments empty stays an example', T.callsIn(`Like this:\n${block('{"name":"grep_code","arguments":{}}')}\nThat is the format.`, coder, null, must).length === 0);
  ok('a step naming a tool not offered reads nothing', T.callsIn(['Do it.', block('{"name": "delete_files", "arguments": {"path": "a"}}'), 'Done.'].join('\n'), coder, null, { delete_files: ['path'] }).length === 0);
  ok('a code block of the page itself is passed over, not read as a step', T.callsIn(['Here is the page:', `${F}html\n<h1>x</h1>\n${F}`, 'Now save it.', block('{"name": "write_file", "arguments": {"path": "a.html", "content": "<h1>x</h1>"}}'), 'Done.'].join('\n'), coder, null, must).length === 1);
}

console.log('\nThe pieces:');
ok('the first whole JSON value inside text', T.parseJson('Here: {"a": {"b": "}"}} done').a.b === '}');
ok('keyword arguments with every kind of value', (() => { const k = T.kwargs('a="x, y", b=2.5, c=True, d=None, e=[1, 2]'); return k.a === 'x, y' && k.b === 2.5 && k.c === true && k.d === null && k.e.length === 2; })());
ok('thinking at the start taken off, and only there', T.withoutThinking('<think>a</think> b') === 'b' && T.withoutThinking('b <think>a</think>') === 'b <think>a</think>');

console.log('\nThe agents read calls through it:');
{
  const shape = src('js', 'agent-shape.js');
  ok('the agent turn reads text calls here, with each tool\'s argument names for a broken call', /window\.HCToolText\.callsIn\(text, names, params, required\)/.test(shape));
  ok('the Ollama reply gives it the arguments each tool must have', /toolCallsInText\([^;]*argumentNames\(tools\), requiredArguments\(tools\)\)/.test(shape));
  const boot = src('boot.js');
  ok('it loads after the fences it reads blocks with and before the agents', boot.indexOf("'/js/fences.js'") < boot.indexOf("'/js/tool-text.js'") && boot.indexOf("'/js/tool-text.js'") < boot.indexOf("'/js/agent-shape.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/tool-text.js)`);
process.exit(fail ? 1 : 0);
