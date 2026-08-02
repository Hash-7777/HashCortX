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

const { DEFAULTS, budgetToolResults, compressHistory } = sandbox.window.HCAgentContext;

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
  check('the summary is appended to it', /Earlier context compressed/.test(out[0].content));
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

console.log('\nDegenerate inputs:');
check('a non-array is not fatal', budgetToolResults(null).length === 0 && compressHistory(null).length === 0);
check('an empty array is not fatal', budgetToolResults([]).length === 0);
check('a null message is not fatal', budgetToolResults([null, tool('x')]).length === 2);

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-context.js)`);
process.exit(fail ? 1 : 0);
