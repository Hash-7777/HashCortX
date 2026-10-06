// ==============================================================
// A reply's diagrams — checks
//
// Loads the REAL src/js/chat/diagrams.js against a small stand-in page and
// holds that Mermaid is not loaded at startup, that it is loaded once, the
// first time a conversation holds a diagram, with the same strict settings
// the chat has always used, that a conversation without one loads nothing,
// and that a library that failed to load is tried again next time.
//
// Run with: npm run check:diagrams
// ==============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

// A page that records the scripts added to it, and a Mermaid that records
// what it was asked to do. `arrive` and `fail` finish the last script added.
// The stand-in Mermaid reads any text but one starting "bad", and draws a
// picture into each node it is given.
function page() {
  const added = [];
  const warned = [];
  const calls = { initialize: [], run: [], parse: [] };
  const mermaid = {
    initialize: (o) => calls.initialize.push(o),
    parse: async (text, o) => { calls.parse.push(text); if (!/^bad/.test(text)) return { diagramType: 'flowchart' }; if (o && o.suppressErrors) return false; throw new Error('Parse error'); },
    run: async ({ nodes }) => {
      calls.run.push(nodes.length);
      for (const n of nodes) { n.processed = true; n.drawn = true; }
    },
  };
  const box = {
    Promise, Error, Array, Object, Map, Set, WeakSet,
    console: { warn: (...a) => warned.push(a.join(' ')) },
  };
  box.window = box;
  box.document = {
    createElement: (tag) => ({ tag }),
    head: { appendChild: (el) => added.push(el) },
  };
  vm.createContext(box);
  vm.runInContext(src('js', 'chat', 'diagrams.js'), box, { filename: 'diagrams.js' });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    D: box.window.HCDiagrams, added, warned, calls,
    arrive: async () => { box.mermaid = mermaid; added.at(-1).onload(); await tick(); },
    fail: async () => { added.at(-1).onerror(); await tick(); },
    tick,
  };
}

// A conversation holding `n` diagrams, drawn or not, each with its text.
function node(text = 'flowchart LR; A-->B') {
  const n = { processed: false, drawn: false, textContent: text, classes: new Set(), before: (el) => { n.note = el; } };
  n.setAttribute = (k, v) => { if (k === 'data-processed') n.processed = v === 'true'; };
  n.querySelector = (sel) => (sel === 'svg' && n.drawn ? {} : null);
  n.classList = { add: (c) => n.classes.add(c), contains: (c) => n.classes.has(c) };
  return n;
}
function conversation(n, texts = []) {
  const nodes = Array.from({ length: n }, (_, i) => node(texts[i]));
  const undrawn = () => nodes.filter((x) => !x.processed);
  return {
    nodes,
    querySelector: () => undrawn()[0] || null,
    querySelectorAll: () => undrawn(),
  };
}

console.log('Mermaid is not part of startup:');
{
  const html = src('index.html');
  ok('index.html does not load it', !/mermaid\.min\.js/.test(html));
  ok('nor does the boot list', !/mermaid\.min\.js/.test(src('boot.js')));
  const boot = src('boot.js');
  const at = boot.indexOf("'/js/chat/diagrams.js'");
  ok('the loader is in the boot list, before app.js', at > -1 && at < boot.indexOf("'/js/app.js'"));
  ok('the library is still shipped where the loader looks', existsSync(join(root, 'src', 'js', 'vendor', 'mermaid.min.js')));
  const app = src('js', 'app.js');
  ok('app.js leaves Mermaid to the loader', !/window\.mermaid/.test(app) && /window\.HCDiagrams\?\.draw\(msgs\)/.test(app));
}

console.log('\nA conversation without a diagram loads nothing:');
{
  const p = page();
  ok('nothing drawn', (await p.D.draw(conversation(0))) === 0);
  ok('no script added', p.added.length === 0);
  ok('and no page at all is no trouble', (await p.D.draw(null)) === 0);
}

console.log('\nThe first diagram loads Mermaid, once:');
{
  const p = page();
  const chat = conversation(2);
  const first = p.D.draw(chat);
  const second = p.D.draw(chat);
  await p.tick();
  ok('one script added for two calls', p.added.length === 1);
  ok('it is the shipped library', p.added[0].src === '/js/vendor/mermaid.min.js');
  await p.arrive();
  const drawn = (await first) + (await second);
  ok('both diagrams drawn', chat.nodes.every((n) => n.processed) && drawn === 2);
  ok('set up once', p.calls.initialize.length === 1);
  const s = p.calls.initialize[0] || {};
  ok('with the strict security level', s.securityLevel === 'strict');
  ok('and not drawing on its own at load', s.startOnLoad === false);
  ok('in the dark theme', s.theme === 'dark');
  ok('and drawing no error picture of its own', s.suppressErrorRendering === true);

  const later = conversation(1);
  ok('a later diagram is drawn', (await p.D.draw(later)) === 1);
  ok('without loading again', p.added.length === 1 && p.calls.initialize.length === 1);
  ok('and one already drawn is left alone', (await p.D.draw(chat)) === 0 && p.calls.run.length === 2);
}

console.log('\nA library that failed to load is tried again:');
{
  const p = page();
  const chat = conversation(1);
  const first = p.D.draw(chat);
  await p.tick();
  await p.fail();
  ok('the failed draw draws nothing', (await first) === 0);
  ok('and says why in the console', p.warned.some((w) => /mermaid\.min\.js failed to load/.test(w)));
  const again = p.D.draw(chat);
  await p.tick();
  ok('the next diagram adds the script again', p.added.length === 2);
  await p.arrive();
  ok('and is drawn', (await again) === 1);
}

console.log('\nA diagram Mermaid cannot draw is left as text:');
{
  const p = page();
  const chat = conversation(1);
  const pending = p.D.draw(chat);
  await p.tick();
  await p.arrive();
  await pending;
  const bad = conversation(1);
  p.D.load().then((m) => { m.run = async () => { throw new Error('bad diagram'); }; });
  await p.tick();
  ok('the draw resolves rather than throws', (await p.D.draw(bad)) === 0);
  ok('with a warning', p.warned.some((w) => /bad diagram/.test(w)));
}

console.log('\nA diagram Mermaid cannot read is shown as its text, not drawn:');
{
  const p = page();
  const chat = conversation(2, ['bad flowchart (2-5 minutes)', 'flowchart LR; A-->B']);
  const pending = p.D.draw(chat);
  await p.tick();
  await p.arrive();
  ok('only the one it can read is drawn', (await pending) === 1 && p.calls.run[0] === 1 && chat.nodes[1].drawn && !chat.nodes[0].drawn);
  const bad = chat.nodes[0];
  ok('the other keeps its own text', bad.textContent === 'bad flowchart (2-5 minutes)' && bad.classes.has('mermaid-unread'));
  ok('... is marked done, so it is not tried again', bad.processed === true);
  ok('... under a line that says why', bad.note && bad.note.tag === 'p' && /could not be drawn, so its text is shown/.test(bad.note.textContent));
  ok('... with one line in the console', p.warned.filter((w) => /could not be drawn/.test(w)).length === 1);
  const again = conversation(1, ['bad flowchart (2-5 minutes)']);
  ok('the same text drawn again is not read again', (await p.D.draw(again)) === 0 && p.calls.parse.filter((t) => /^bad/.test(t)).length === 1);
  ok('... nor warned about again', p.warned.filter((w) => /could not be drawn/.test(w)).length === 1 && again.nodes[0].processed === true);
}

console.log('\nOne Mermaid read but could not draw is left as text too:');
{
  const p = page();
  const chat = conversation(1, ['flowchart LR; X-->Y']);
  const pending = p.D.draw(chat);
  await p.tick();
  await p.arrive();
  await pending;
  const later = conversation(1, ['flowchart LR; C-->D']);
  p.D.load().then((m) => { m.run = async ({ nodes }) => { for (const n of nodes) n.processed = true; }; });
  await p.tick();
  await p.D.draw(later);
  ok('a node left with no picture is shown as its text', later.nodes[0].classes.has('mermaid-unread') && later.nodes[0].textContent === 'flowchart LR; C-->D');
}

{
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');
  console.log('');
  ok('this check is part of npm run check', /npm run check:diagrams/.test(pkg));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/diagrams.js)`);
process.exit(fail ? 1 : 0);
