// ============================================================
// What HashCoder adds to one request — src/js/code/context.js.
// Run with: npm run check:code-context
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'code', 'context.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'context.js' });
const C = sandbox.window.HCCodeContext;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('What the app adds to one request:');
{
  const all = C.forRequest({ site: 'BUILDING THIS SITE. The bar.', activeFile: '/p/index.html', facts: [{ key: 'stack', value: 'plain HTML' }] });
  ok('says it is from the app, not from the person', all.startsWith(C.FROM_APP) && /not from the person/.test(C.FROM_APP));
  ok('carries the bar a site is held to', /BUILDING THIS SITE/.test(all));
  ok('names the file open', /Active file: \/p\/index\.html/.test(all));
  ok('and remembered facts, marked not to be recited', /Memory \(silent context, do not recite\):\n {2}- stack: plain HTML/.test(all));
  ok('a long fact is cut short', C.forRequest({ facts: [{ key: 'k', value: 'v'.repeat(500) }] }).length < 250);
  ok('nothing to add is nothing at all, not an empty heading', C.forRequest({}) === '' && C.forRequest() === '' && C.forRequest({ facts: [null, {}] }) === '');
  ok('no file open, no line for one', !/Active file/.test(C.forRequest({ site: 'x' })));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/context.js)`);
process.exit(fail ? 1 : 0);
