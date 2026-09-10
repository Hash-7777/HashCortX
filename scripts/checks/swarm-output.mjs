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

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/output.js)`);
process.exit(fail ? 1 : 0);
