// ==============================================================
// "What the code printed" checks
//
// Loads the REAL src/js/chat/ran-code.js and holds that what an agent's
// Python run printed is kept on the reply and shown under it, as text, so an
// answer that disagrees with it can be seen to.
//
// Run with: npm run check:ran-code
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

// Just enough of a document to build the element and read it back.
const make = (tag) => ({ tag, className: '', textContent: '', children: [], append(...c) { this.children.push(...c); } });
const doc = { createElement: make };
const sandbox = { window: {}, JSON, String, Array };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'ran-code.js'), sandbox, { filename: 'ran-code.js' });
const R = sandbox.window.HCRanCode;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('What a run printed:');
ok('its output, from the tool\'s own result', R.outputOf(JSON.stringify({ stdout: '355687428096000\n', stderr: '', error: null })) === '355687428096000');
ok('an error is said as one, over what it wrote to stderr', R.outputOf({ stdout: '', stderr: 'Traceback…', error: 'NameError: x' }) === 'Error: NameError: x');
ok('stderr alone is shown', R.outputOf({ stdout: 'a', stderr: 'warning' }) === 'a\nwarning');
ok('files it wrote are named, and one not kept says so', R.outputOf({ stdout: '', files: [{ filename: 'chart.png' }, { filename: 'x.csv', saved: false }] }) === 'Files: chart.png, x.csv (not kept)');
ok('a long output is cut, and says so', R.outputOf({ stdout: 'x'.repeat(5000) }).length === R.MAX_CHARS + 2);
ok('nothing printed, or no result, is nothing to show', R.outputOf({ stdout: '' }) === '' && R.outputOf('not json') === '' && R.outputOf(null) === '');

console.log('\nWhat is shown under a reply:');
{
  const el = R.element(['355687428096000'], doc);
  ok('a folded block with a plain title', el.tag === 'details' && el.className === 'ran-code' && el.children[0].textContent === 'What the code printed');
  ok('the output as text, never as markup', el.children[1].tag === 'pre' && el.children[1].textContent === '355687428096000');
  ok('several runs are counted, the most recent kept', R.element(['a', '', 'b', 'c', 'd', 'e'], doc).children.length === 5 && R.keep(['a', 'b', 'c', 'd', 'e'])[0] === 'b');
  ok('no output, no block', R.element([], doc) === null && R.element(['', '  '], doc) === null && R.element(undefined, doc) === null);
}

console.log('\nHow the chat uses it:');
{
  const app = src('js', 'app.js');
  ok('every Python run records what it printed', /name === "execute_python" \? \{ output: HCRanCode\.outputOf\(result\) \}/.test(app));
  ok('the reply keeps it, and a saved chat keeps it too', /assistant\.ranCode = HCRanCode\.keep\(tracker\.map\(t => t\.output\)\);/.test(app) && /ranCode: m\.ranCode \|\| undefined/.test(app));
  ok('it is drawn under an assistant\'s reply', /const ran = m\.role === "assistant" && HCRanCode\.element\(m\.ranCode\);/.test(app));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/chat/ran-code.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/ran-code.js)`);
process.exit(fail ? 1 : 0);
