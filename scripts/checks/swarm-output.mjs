// ==============================================================
// Agent-answer fencing checks
//
// Loads the REAL src/js/swarm/output.js into a Node VM.
//
// Agents paste code without fencing it, so raw code is found and fenced. The
// hazard is the opposite mistake: English and code open with the same words,
// and a paragraph wrapped as Python reads as though the agent misunderstood
// the question. Most of this file is ordinary sentences that must come back
// untouched.
//
// Run with: npm run check:swarm-output
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'fences.js'), 'utf8'), sandbox, { filename: 'fences.js' });
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'swarm', 'output.js'), 'utf8'),
  sandbox, { filename: 'output.js' });
const { normaliseAgentOutput, detectLang } = sandbox.window.HCSwarmOutput;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

// Sentences that open with a word code also opens with.
const PROSE = [
  'from the analysis we can see three trends',
  'export the findings to a spreadsheet',
  'class sizes have grown since last year',
  'await confirmation before proceeding',
  'let me summarise the main points',
  'function of the department is unclear',
  'cd ratios remain stable across the sample',
  'echo chambers amplify this effect',
  'import restrictions were lifted in March',
  'const of nature is a fixed idea',
  'let us consider the alternative',
  'make sure everyone is informed',
  'git blame culture is unhelpful',
  'variable costs rose sharply',
  'class participation improved',
];

const CODE = [
  ['from pathlib import Path', 'python'],
  ['import numpy as np', 'python'],
  ['def total(rows):', 'python'],
  ['class Ledger:', 'python'],
  ['if __name__ == "__main__":', 'python'],
  ['const total = rows.length;', 'javascript'],
  ['let count = 0;', 'javascript'],
  ['function total(rows) {', 'javascript'],
  ['export default App;', 'javascript'],
  ['export const NAME = 1;', 'javascript'],
  ['await fetch(url);', 'javascript'],
  ['// a comment', 'javascript'],
  ['const { a, b } = obj;', 'javascript'],
  ['const [a, b] = list;', 'javascript'],
  ['import React from "react";', 'javascript'],
  ['} else {', 'javascript'],
  ['npm install --save-dev vitest', 'bash'],
  ['cd /usr/local/bin', 'bash'],
  ['git commit -m "fix"', 'bash'],
  ['export PATH=/usr/bin', 'bash'],
  ['<div class="card">', 'html'],
];

console.log('An ordinary sentence is never treated as code:');
for (const line of PROSE) ok(`prose: ${line}`, detectLang(line) === null);

console.log('\nReal code is still recognised:');
for (const [line, lang] of CODE) ok(`${lang}: ${line}`, detectLang(line) === lang);

console.log('\nA paragraph of prose comes back exactly as it went in:');
{
  const text = PROSE.join('\n');
  ok('nothing is fenced', !normaliseAgentOutput(text).includes('```'));
  ok('and nothing is changed at all', normaliseAgentOutput(text) === text);

  // Control: matching on the opening word alone is what wrapped prose as code.
  const looseJs = /^\s*(const |let |var |function |class |import |export |\/\/|=>|async |await )/;
  ok('control: matching the opening word alone catches these sentences',
    PROSE.filter((l) => looseJs.test(l)).length >= 4);
}

console.log('\nCode inside an answer is fenced, and the prose around it is not:');
{
  const text = [
    'Here is what I found.',
    '',
    'from the analysis, three trends stand out.',
    '',
    'The parser is straightforward:',
    '',
    'def parse(rows):',
    '    rows = [r.strip() for r in rows]',
    '    return rows',
    '',
    'export the findings to a spreadsheet when done.',
  ].join('\n');
  const out = normaliseAgentOutput(text);
  ok('the code is fenced as python', out.includes('```python'));
  ok('the whole function is inside the fence', /```python\ndef parse[\s\S]*?    return rows\n```/.test(out));
  ok('the sentence before it is left alone', out.includes('\nfrom the analysis, three trends stand out.\n'));
  ok('the sentence after it is left alone', /```\n\nexport the findings/.test(out));
  ok('every original line survives', text.split('\n').every((l) => out.includes(l)));
  ok('exactly one block was opened', (out.match(/```/g) || []).length === 2);
}

console.log('\nAn answer that is already fenced is left alone:');
{
  const text = 'Look:\n\n```js\nconst a = 1;\n```\n\nThat is all.';
  ok('it comes back untouched', normaliseAgentOutput(text) === text);
  ok('no second fence is added', (normaliseAgentOutput(text).match(/```/g) || []).length === 2);
}

console.log('\nA whole document of code is wrapped in one block:');
{
  const html = '<!DOCTYPE html>\n<html>\n<body>\n<div>hi</div>\n</body>\n</html>';
  ok('an html page is wrapped as html', normaliseAgentOutput(html).startsWith('```html'));
  const py = ['import os', 'import sys', 'def main():', '    print(os.getcwd())', 'if __name__ == "__main__":', '    main()'].join('\n');
  ok('a python file is wrapped as python', normaliseAgentOutput(py).startsWith('```python'));

  // Indented prose is not Python. The share test used to count any line
  // starting with four spaces, so a nested list read as code by its indent.
  const indentedProse = [
    'The findings are as follows.',
    '    First, the trend is upward.',
    '    Second, the variance is small.',
    '    Third, the sample is representative.',
    '    Fourth, more data would help.',
  ].join('\n');
  ok('an indented list is not wrapped as python', !normaliseAgentOutput(indentedProse).includes('```'));
  ok('control: counting four-space indents as python would wrap it',
    indentedProse.split('\n').filter((l) => /^\s{4}/.test(l)).length / 5 > 0.45);
}

console.log('\nNothing surprising happens to odd input:');
{
  ok('empty text comes back empty', normaliseAgentOutput('') === '');
  ok('null comes back as it was', normaliseAgentOutput(null) === null);
  ok('undefined comes back as it was', normaliseAgentOutput(undefined) === undefined);
  ok('a single word is untouched', normaliseAgentOutput('Done.') === 'Done.');
  ok('a blank line survives', normaliseAgentOutput('a\n\nb') === 'a\n\nb');
  ok('a code block at the very end is closed', (() => {
    const out = normaliseAgentOutput('Result:\n\nconst a = 1;\nconst b = 2;');
    return (out.match(/```/g) || []).length === 2;
  })());
  ok('trailing blank lines are not swallowed into a block',
    normaliseAgentOutput('const a = 1;\n\n').endsWith('\n'));
}

console.log('\nAn answer already fenced is not fenced again, however its fence is written:');
{
  // "Already fenced?" was asked with a pattern of its own that did not see
  // these as fenced, so the whole answer was fenced again around them.
  const B = '`'.repeat(3);
  const cases = {
    'a C# block': ['Here:', '', B + 'c#', 'public class A {', '  public int X = 1;', '}', B, '', 'Done.'].join('\n'),
    'Windows line endings': ['Here:', '', B + 'js', 'const a = 1;', 'let b = 2;', B].join('\r\n'),
    'a titled fence': ['Here:', '', B + 'js title="a.js"', 'const a = 1;', 'const b = 2;', B].join('\n'),
  };
  for (const [name, text] of Object.entries(cases)) ok(`${name} comes back unchanged`, normaliseAgentOutput(text) === text);
  const old = /```[\w]*\n[\s\S]*?```/;
  ok('control: the old test did not see a C# block as fenced', !old.test(cases['a C# block']));
}

console.log('\nAn answer that declines the task is not the work:');
{
  const { isRefusal } = sandbox.window.HCSwarmOutput;
  ok('a short apology that it cannot comply', isRefusal("I'm sorry, but I can't comply with that request."));
  ok('... in its other common wordings', isRefusal('I cannot help with this request.') && isRefusal('Unfortunately, I am unable to complete that.') && isRefusal('Sorry, I won’t be able to assist with that.'));
  ok('a long answer that begins politely is still the work', !isRefusal("I'm sorry to hear the launch slipped. Here is the plan: " + 'x'.repeat(500)));
  ok('an answer that is not declining is the work', !isRefusal('Target customers: eco-conscious commuters.') && !isRefusal('Sorry for the wait — the calendar is below.') && !isRefusal(''));
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'agent-maker', 'mode.js'), 'utf8');
  ok('an agent that declines, or answers with only a call, is handed to another model, like one that said nothing', /if \(!candidateText\.trim\(\) \|\| window\.HCSwarmOutput\.isRefusal\(candidateText\) \|\| window\.HCSwarmOutput\.isOnlyACall\(candidateText\)\) throw Object\.assign\(new Error\(/.test(mode) && /"answered with a tool call instead of the work"/.test(mode) && /\{ empty: true \}\);/.test(mode));
  ok('only a call: a JSON object naming something and its arguments, in a code block or not', sandbox.window.HCSwarmOutput.isOnlyACall('{"name": "product_description.txt", "arguments": {}}') && sandbox.window.HCSwarmOutput.isOnlyACall('```json\n{"name":"x","parameters":{}}\n```') && sandbox.window.HCSwarmOutput.isOnlyACall('[{"name":"x","arguments":{"a":1}}]'));
  ok('... while data that happens to have a name, or any words, is work', !sandbox.window.HCSwarmOutput.isOnlyACall('{"name":"Mug","price":12,"colour":"blue","size":"L"}') && !sandbox.window.HCSwarmOutput.isOnlyACall('This mug is lovely.') && !sandbox.window.HCSwarmOutput.isOnlyACall(''));
  const again = sandbox.window.HCSwarmOutput.askForTheWork('{"name":"search","arguments":{}}');
  ok('a call to a tool it does not have: its answer, then a request for the work itself', again.length === 2 && again[0].role === 'assistant' && again[1].role === 'user' && /Write your part of the work itself now/.test(again[1].content));
  ok('the same model is asked that once, before a larger one is loaded', /askedForWork = false/.test(mode) && /if \(!askedForWork && round < maxToolRounds - 1 && window\.HCSwarmOutput\.notTheWork\(candidateText\)\) \{ const miss = window\.HCSwarmOutput\.notTheWork\(candidateText\); askedForWork = true;[^\n]*askForTheWork\(candidateText, miss\)\); continue; \}/.test(mode));
  const O = sandbox.window.HCSwarmOutput;
  const asking = 'Sure, I can help finalize the launch plan for your handmade mug shop. To proceed, could you please provide the following details?\n\n1. Your name and contact details.\n2. The name of your shop.\n\nOnce I have this information, I can ensure that the plan fits your brand.';
  ok('an answer asking the person for what was left out is not the work', O.notTheWork(asking) === 'asks' && O.notTheWork('{"name":"web_search","arguments":{}}') === 'call');
  ok('... while the work is, even an email that asks its reader something', O.notTheWork('Dear Mr Hale,\n\nThe heater in flat 4 has stopped working. Could you please send someone this week? Please let me know a time that suits.\n\nBest,\n[Your name]') === '' && O.notTheWork('# Launch plan\n\nDay 1: tease the new mugs.') === '');
  ok('... and so is a long piece that ends by offering more', O.notTheWork(`${'Day 1: post the first mug. '.repeat(80)}Once I have this information, I can adjust it.`) === '');
  ok('asked again, it is told the person will not answer and to mark what was not given', /will not answer questions/.test(O.askForTheWork(asking, 'asks')[1].content) && /placeholder in square brackets/.test(O.askForTheWork(asking, 'asks')[1].content));
  ok('an answer that still asks is then taken; only a call is never the work', /\|\| window\.HCSwarmOutput\.isOnlyACall\(candidateText\)\) throw/.test(mode) && !/notTheWork\(candidateText\)\) throw/.test(mode));
  ok('an agent\'s time limit is reported as the one it was given', /`Agent timeout after \$\{timeoutMs \/ 1000\}s`/.test(mode) && /`Timeout \$\{timeoutMs \/ 1000\}s/.test(mode));
  ok('the note after an automatic Python run is a turn every provider reads', /messages\.push\(\{ role: "user", content: "The Python code was executed automatically\./.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/output.js)`);
process.exit(fail ? 1 : 0);
