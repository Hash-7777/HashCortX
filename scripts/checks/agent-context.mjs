// ==============================================================
// Agent context-budgeting checks
//
// Loads the real src/js/agent-context.js and asserts what the model ends up
// seeing. The first check is the regression test for the defect that made the
// coding agent weak: a file it had just read arriving as 800 characters.
//
// Run with: npm run check:agent
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'agent-context.js');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'agent-context.js' });

const { DEFAULTS, budgetToolResults, hideOldResults, compressHistory } = sandbox.window.HCAgentContext;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const tool = (content, id = 't') => ({ role: 'tool', tool_call_id: id, content });
const user = (content) => ({ role: 'user', content });
const asst = (content) => ({ role: 'assistant', content });
const sys  = (content) => ({ role: 'system', content });

const bigFile = 'x'.repeat(40000);

console.log('\nThe defect this file exists for:');
{
  const out = budgetToolResults([sys('p'), user('read main.rs'), asst(''), tool(bigFile)]);
  check('a 40,000-char file the agent just read arrives WHOLE',
    out[3].content.length === 40000,
    `got ${out[3].content.length} chars`);
}
{
  // The old behaviour, for contrast: everything over 800 chars was cut, always.
  const out = budgetToolResults([tool('y'.repeat(1200))]);
  check('a 1,200-char result is not trimmed either',
    out[0].content.length === 1200, `got ${out[0].content.length}`);
}

console.log('\nSpending the budget newest-first:');
{
  // Three results of 30k against a 60k budget: the two newest fit, the oldest
  // is the one that gives way.
  const msgs = [tool('a'.repeat(30000), '1'), tool('b'.repeat(30000), '2'), tool('c'.repeat(30000), '3')];
  const out = budgetToolResults(msgs);
  check('the newest result survives intact', out[2].content.length === 30000);
  check('the second-newest survives intact', out[1].content.length === 30000);
  check('the oldest is the one trimmed', out[0].content.length < 30000,
    `oldest is ${out[0].content.length}`);
}
{
  const many = Array.from({ length: 40 }, (_, i) => tool('z'.repeat(5000), String(i)));
  const out = budgetToolResults(many);
  check('nothing is trimmed below the floor',
    out.every(m => m.content.length >= DEFAULTS.minPerResult));
  check('the newest is still whole even in a long run',
    out[out.length - 1].content.length === 5000);
}

console.log('\nTruncation is legible:');
{
  const out = budgetToolResults([tool('a'.repeat(200000)), tool('b'.repeat(60000))]);
  const trimmed = out[0].content;
  check('says how much was dropped', /characters omitted/.test(trimmed));
  check('says how to get it back', /Re-read the file|narrower query/.test(trimmed));
  check('keeps the head', trimmed.startsWith('aaaa'));
  check('keeps some of the tail', trimmed.endsWith('aaaa'));
}

console.log('\nInputs are not mutated:');
{
  const original = tool('q'.repeat(200000));
  const before = original.content.length;
  budgetToolResults([original]);
  check('the caller keeps its untrimmed copy', original.content.length === before);
}

console.log('\nNon-tool messages:');
{
  const msgs = [sys('p'), user('u'.repeat(50000)), asst('a'.repeat(50000))];
  const out = budgetToolResults(msgs);
  check('user and assistant turns are never trimmed',
    out[1].content.length === 50000 && out[2].content.length === 50000);
  check('a tool message with non-string content is left alone',
    budgetToolResults([{ role: 'tool', content: null }])[0].content === null);
}

console.log('\nSummarising older turns:');
{
  const short = [sys('p'), user('a'), asst('b')];
  check('a short conversation is not summarised',
    compressHistory(short).length === 3);

  const long = [sys('prompt')];
  for (let i = 0; i < 30; i++) { long.push(user('u' + i)); long.push(asst('a' + i)); }
  const out = compressHistory(long);
  check('a long conversation is shortened', out.length < long.length,
    `${long.length} -> ${out.length}`);
  check('exactly one system turn survives',
    out.filter(m => m.role === 'system').length === 1);
  check('the original system prompt is still there', out[0].content.startsWith('prompt'));
  check('the note on earlier requests is appended to it', /Earlier in this conversation/.test(out[0].content));
  check('the note keeps what the earlier requests asked', /"u0"/.test(out[0].content) && /"u26"/.test(out[0].content));
  check('the most recent turn is kept verbatim',
    out[out.length - 1].content === 'a29', out[out.length - 1].content);
}
{
  // An orphaned tool result — one with no assistant turn that asked for it —
  // is rejected outright by most provider APIs.
  const msgs = [sys('p')];
  for (let i = 0; i < 30; i++) msgs.push(user('u' + i));
  for (let i = 0; i < 6; i++) { msgs.push(asst('call')); msgs.push(tool('result ' + i)); }
  const out = compressHistory(msgs);
  const firstNonSystem = out.find(m => m.role !== 'system');
  check('the window never opens on an orphaned tool result',
    firstNonSystem.role !== 'tool', `starts with ${firstNonSystem.role}`);
}

console.log('\nA long task keeps its request:');
{
  // One request followed by thirty steps, each a call and its result.
  const call = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const res = (id, name, content) => ({ role: 'tool', tool_call_id: id, name, content });
  const msgs = [sys('prompt'), user('Fix the failing test in src/range.js')];
  for (let i = 0; i < 30; i++) {
    msgs.push(i === 0 ? call('c0', 'write_file', { path: '/p/src/big.js', content: 'w'.repeat(5000) }) : call('c' + i, 'read_file', { path: `/p/src/f${i}.js` }));
    msgs.push(res('c' + i, i === 0 ? 'write_file' : 'read_file', 'r'.repeat(900) + i));
  }
  const out = compressHistory(msgs);
  check('the request is still there, word for word', out.some((m) => m.role === 'user' && m.content === 'Fix the failing test in src/range.js'));
  check('no message is taken out of the request in progress', out.length === msgs.length, `${msgs.length} -> ${out.length}`);
  const results = out.filter((m) => m.role === 'tool');
  check('the newest results arrive whole', results.slice(-DEFAULTS.keepResults).every((m) => m.content.startsWith('rrrr')));
  check('older results are hidden, saying what they were', /Earlier result of read_file \/p\/src\/f19\.js/.test(results[results.length - DEFAULTS.keepResults - 1].content));
  check('and how to see them again', /Call the tool again/.test(results[1].content));
  const written = out[2].tool_calls[0].function.arguments;
  check('a whole file written long ago is not sent again', !/w{400}/.test(written) && /5,000 characters/.test(written));
  check('its call still reads as JSON, with its path', JSON.parse(written).path === '/p/src/big.js');
  check('every result still follows the call it answers', out.every((m, i) => m.role !== 'tool' || (out[i - 1].role === 'assistant' || out[i - 1].role === 'tool')));
  check('what the caller holds is not changed', msgs[3].content.startsWith('rrrr') && /w{5000}/.test(msgs[2].tool_calls[0].function.arguments));
}
{
  const msgs = [sys('p'), user('look at the mockup')];
  for (let i = 0; i < 14; i++) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: 'v' + i, function: { name: 'view_image', arguments: '{}' } }] });
    msgs.push({ role: 'tool', tool_call_id: 'v' + i, content: 'ok' });
    msgs.push({ role: 'user', content: 'This is shot.png, the image you opened.', images: ['QUJD'] });
  }
  const out = compressHistory(msgs);
  const pics = out.filter((m) => m.role === 'user' && m.images);
  check('a picture opened long ago is not sent again', pics.length < 14 && pics.length > 0);
  check('a picture message is not taken for a new request', out.some((m) => m.content === 'look at the mockup') && !/Earlier in this conversation/.test(out[0].content));
}
{
  const few = [sys('p'), user('a'), { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'read_file', arguments: '{"path":"/a"}' } }] }, tool('whole', 'x')];
  check('a short run is sent as it is', JSON.stringify(hideOldResults(few)) === JSON.stringify(few));
}

console.log('\nDegenerate inputs:');
check('a non-array is not fatal', budgetToolResults(null).length === 0 && compressHistory(null).length === 0);
check('an empty array is not fatal', budgetToolResults([]).length === 0);
check('a null message is not fatal', budgetToolResults([null, tool('x')]).length === 2);

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-context.js)`);
process.exit(fail ? 1 : 0);
