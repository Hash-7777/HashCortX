// ==============================================================
// Swarm agent-context checks
//
// Loads the REAL src/js/swarm/context.js, with the real project-files.js and
// fences.js under it, into a Node VM.
//
// This decides what an agent is shown of the work that came before it. Two
// failures matter: showing too much, which every provider refuses as too
// large, and showing it in a way that reads as complete when it is not.
//
// Run with: npm run check:swarm-context
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['fences.js', 'swarm/project-files.js', 'swarm/context.js']) {
  vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', ...f.split('/')), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.window.HCSwarmContext;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const B = '`'.repeat(3);
const PAGE = (what) => `${B}html index.html\n<!doctype html><html><body>${what}</body></html>\n${B}`;

console.log('An agent that checks the work is shown the project, not the conversation:');
{
  const out = C.contextFor({
    Planner: 'Here is the plan for the shop, written out at some length.',
    'Frontend Coder': `Here is the page.\n${PAGE('<h1>one</h1>')}`,
    'Cart Logic Coder': `And here is mine.\n${PAGE('<h1>two</h1>')}\n${B}js cart.js\nconst cart = [];\n${B}`,
  }, { whole: true });
  ok('every file is there', /index\.html/.test(out) && /cart\.js/.test(out));
  ok('the same file is not shown twice', (out.match(/```html index\.html/g) || []).length === 1);
  ok('the latest version of it is the one shown', /<h1>two<\/h1>/.test(out) && !/<h1>one<\/h1>/.test(out));
  ok('an answer that produced no files keeps its words', /Here is the plan for the shop/.test(out));
  ok('the prose around the files is not pasted in with them', !/And here is mine/.test(out));
  ok('it says what it is showing', /every file the team has written/.test(out));
}

console.log('\nAn agent that does not need the whole thing gets the transcript, capped:');
{
  const out = C.contextFor({ One: 'x'.repeat(5000), Two: 'y'.repeat(100) }, { perLimit: 1000 });
  ok('each answer is under the limit', out.split('[One]:')[1].split('\n[')[0].replace(/\s/g, '').length <= 1100);
  ok('a cut answer says it was cut', /cut here\. One wrote 5000 characters/.test(out));
  ok('and says not to write the rest from guesswork', /guesswork/.test(out));
  ok('an answer that fits says nothing about cutting', !/cut here\. Two/.test(out));
}

console.log('\nThe whole context has a ceiling, not only each piece of it:');
{
  const many = {};
  for (let i = 0; i < 20; i++) many[`Agent ${i}`] = 'z'.repeat(4000);
  const out = C.contextFor(many, { perLimit: 4000, totalLimit: 10000 });
  ok('the transcript stays under the ceiling', out.length <= 11000);
  ok('what was left out is named', /would not fit/.test(out));
}
{
  const many = {};
  for (let i = 0; i < 20; i++) many[`Agent ${i}`] = `${B}css file${i}.css\n${'z'.repeat(4000)}\n${B}`;
  const out = C.contextFor(many, { whole: true, totalLimit: 10000 });
  ok('the project stays under the ceiling too', out.length <= 11000);
  ok('the files left out are named', /would not fit/.test(out));
  ok('and the agent is told to say so rather than invent them', /rather than writing them from guesswork/.test(out));
}

console.log('\nNothing in, nothing out:');
ok('no inputs give no context', C.contextFor({}) === '' && C.contextFor(null) === '');
ok('an empty answer is not shown', C.contextFor({ One: '' }) === '');

console.log('\nThe project read from a set of answers:');
{
  const r = C.projectFrom([
    { name: 'A', text: `${B}css style.css\n.a{}\n${B}` },
    { name: 'B', text: `${B}css\n.b{}\n${B}` },
    { name: 'C', text: 'Just words about the work, no files at all in here.' },
  ]);
  ok('an unnamed stylesheet does not become a second stylesheet', r.files.size === 1);
  ok('the words are kept apart from the files', r.prose.length === 1 && r.prose[0].name === 'C');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/context.js)`);
process.exit(fail ? 1 : 0);
