// ==============================================================
// "What the model thought" checks
//
// Loads the REAL src/js/chat/thought.js and holds that a model's thinking is
// shown while it thinks, kept on the reply and shown above it folded, as
// text, with how long it took; and that the chat wires it in and never sends
// it back to a model.
//
// Run with: npm run check:thought
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

// Just enough of a document to build the elements and read them back.
const make = (tag) => ({ tag, className: '', textContent: '', children: [], append(...c) { this.children.push(...c); } });
const doc = { createElement: make };
const sandbox = { window: {}, String, Number, Math };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'thought.js'), sandbox, { filename: 'thought.js' });
const T = sandbox.window.HCThought;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('While it thinks:');
{
  const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const t = T.tail(long);
  ok('the latest of it is shown, from a word boundary, marked as cut', t.startsWith('…word') && t.endsWith('word299') && t.length <= T.LIVE_CHARS + 1);
  ok('short thinking is shown whole, on one line', T.tail('  first\n\nsecond  ') === 'first second');
  const live = T.liveElement('checking the numbers', doc);
  ok('the live view says Thinking and shows the words as text', live.children[0].textContent === 'Thinking' && live.children[1].textContent === 'checking the numbers');
  ok('text that looks like markup stays text', T.liveElement('<img src=x onerror=alert(1)>', doc).children[1].textContent === '<img src=x onerror=alert(1)>');
}

console.log('\nAfter it answers:');
{
  const el = T.element('First I add, then I check.', 8200, doc);
  ok('kept above the answer, folded, with how long it took', el.tag === 'details' && el.children[0].textContent === 'Thought for 8 s' && el.children[1].textContent === 'First I add, then I check.');
  ok('minutes are said as minutes', T.label(65000) === 'Thought for 1 min 5 s' && T.label(120000) === 'Thought for 2 min');
  ok('an unknown time says only that it thought', T.label(undefined) === 'Thought' && T.label(0) === 'Thought');
  ok('no thinking, nothing shown', T.element('', 5000, doc) === null && T.element('   ', 5000, doc) === null && T.element(undefined, 0, doc) === null);
  ok('a very long thinking is bounded, so a saved chat cannot swell', T.keep('x'.repeat(50000)).length === T.KEEP_CHARS + 2);
}

console.log('\nThe chat uses it:');
{
  const app = src('js', 'app.js');
  ok('shown live for cloud and local models alike', /\(t\) => showThinking\(assistant, t\)/.test(app) && /HCThought\.liveElement\(/.test(app));
  ok('shown folded above a finished reply', /HCThought\.element\(m\.thinking, m\.thoughtMs\)/.test(app));
  ok('kept when the chat is saved', /thinking: m\.thinking \|\| undefined, thoughtMs: m\.thoughtMs \|\| undefined/.test(app));
  const build = app.slice(app.indexOf('function buildOllamaMessages'), app.indexOf('function compactNumber'));
  ok('never sent back to a model: a turn carries its words only', /content: m\._modelContent \|\| m\.content/.test(build) && !/thinking/.test(build));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/chat/thought.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/thought.js)`);
process.exit(fail ? 1 : 0);
