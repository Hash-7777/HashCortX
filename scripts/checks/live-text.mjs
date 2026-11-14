// ==============================================================
// A reply written as it arrives
//
// Loads the REAL src/js/chat/live-text.js into a Node VM, with a frame clock
// it controls, and checks what is shown while a reply arrives: never a mark
// that later turns into formatting, a word never cut, a pace that catches up,
// and a drawing of the bubble in the finished reply's shape.
//
// Run with: npm run check:live-text
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });   // loaded before it, as in the app
vm.runInContext(src('js', 'chat', 'live-text.js'), sandbox, { filename: 'live-text.js' });
const L = sandbox.window.HCLiveText;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nWhat cannot be formatted yet is held back, never shown as a mark:');
{
  const s = L.settled;
  ok('a bold mark not yet closed is held with the words after it', s('Here is **Writing & ed') === 'Here is');
  ok('...and shown once it closes', s('Here is **Writing & editing** and') === 'Here is **Writing & editing** and');
  ok('an inline code mark not yet closed is held', s('Run `npm te') === 'Run');
  ok('half a link is held from its bracket', s('See the [docs](https://exa') === 'See the' && s('See the [do') === 'See the');
  ok('...and a whole one is shown', s('See the [docs](https://example.com) now') === 'See the [docs](https://example.com) now');
  ok('a table before its rule line is held whole', s('Intro.\n\n| Area | Good for |') === 'Intro.' && s('Intro.\n\n| Area | Good for |\n| --- | --- |\n| A | b |').endsWith('| A | b |'));
  ok('a last line that is only the start of a heading, an item or a quote is held', s('Para.\n\n##') === 'Para.' && s('Para.\n- one\n-') === 'Para.\n- one' && s('Para.\n>') === 'Para.' && s('Steps:\n1.') === 'Steps:');
  ok('inside a code block still open, everything is shown as code', s('Code:\n\n```js\nconst a = `x') === 'Code:\n\n```js\nconst a = `x');
  ok('a closed code block holding a blank line and backticks is left whole, and only the words after it are read', s('Try:\n\n```js\nconst a = `x`;\n\nrun(a);\n```\n\nThen **bo') === 'Try:\n\n```js\nconst a = `x`;\n\nrun(a);\n```\n\nThen');
  ok('...also when the last blank line is inside that block', s('Try:\n```js\nconst a = `x`;\n\nrun(`y`);\n```\nThen **bo') === 'Try:\n```js\nconst a = `x`;\n\nrun(`y`);\n```\nThen');
  ok('an earlier paragraph is never held for what the last one opens', s('**Done** here.\n\nNext **bo') === '**Done** here.\n\nNext');
  const long = 'Word **' + 'x '.repeat(80);
  ok('past a long stretch the open mark is dropped and the words shown, not held back for ever', !s(long).includes('**') && s(long).startsWith('Word x x'));
  ok('plain words pass as they are', s('Just words, said plainly.') === 'Just words, said plainly.' && s('') === '' && s(null) === '');
}

console.log('\nIt is shown at a reading pace, a word at a time, and catches up:');
{
  ok('two characters a frame at least, a tenth of what waits when more has arrived', L.stepOf(1) === 2 && L.stepOf(15) === 2 && L.stepOf(200) === 20 && L.stepOf(1000) === 100);
  const t = 'Here is a sentence with words';
  ok('a stop is at the end of a word, never inside one', L.nextStop(t, 0, 2) === 4 && t.slice(0, L.nextStop(t, 5, 1)) === 'Here is');
  ok('...and never past the text', L.nextStop(t, 25, 50) === t.length);

  // A frame clock the check turns by hand.
  const frames = [];
  let time = 0;
  const painted = [];
  const live = L.create({ paint: (x) => painted.push(x), raf: (fn) => { frames.push(fn); return frames.length; }, cancel: () => {}, now: () => time });
  const turn = (n = 1) => { for (let i = 0; i < n; i++) { const fn = frames.shift(); if (!fn) return; time += 16; fn(); } };
  live.push('The answer is written a little at a time so it can be read.');
  turn();
  ok('the first frame shows the start, not all of it', painted.length === 1 && painted[0].length > 0 && painted[0].length < 20, JSON.stringify(painted));
  ok('...cut at a word', /\S$/.test(painted[0]) && 'The answer is written a little at a time so it can be read.'.startsWith(painted[0]) && /^(?:The|The answer)$/.test(painted[0]));
  turn(80);
  ok('in time all of it is shown, and the clock stops asking for frames', painted[painted.length - 1] === 'The answer is written a little at a time so it can be read.' && frames.length === 0);
  ok('every drawing carries on from the one before', painted.every((p, i) => i === 0 || p.startsWith(painted[i - 1].replace(/\s+\S*$/, ''))));
  const before = painted.length;
  live.push('Moving to another model.');
  turn();
  ok('a text that does not carry on from the last, such as a note while another model starts, is drawn at once', painted.length === before + 1 && painted[painted.length - 1] === 'Moving to another model.');
  const other = [];
  const fresh = L.create({ paint: (x) => other.push(x), raf: (fn) => { frames.push(fn); return frames.length; }, cancel: () => {}, now: () => time });
  fresh.push('First words of an answer that stopped');
  turn();
  fresh.push('A note in place of it, longer than what had been shown so far');
  turn();
  ok('...also when it is longer than what had been shown: it is never shown cut', other[other.length - 1] === 'A note in place of it, longer than what had been shown so far', JSON.stringify(other));
  fresh.stop();
  frames.length = 0;
  live.push('Moving to another model.' + ' x'.repeat(3000));
  turn(3);
  const shownAfter = live.shown;
  turn(30);
  ok('far behind, it catches up quickly rather than crawl', live.shown - shownAfter > 1500, `${shownAfter} -> ${live.shown}`);
  live.stop();

  const quick = [];
  const now = L.create({ paint: (x) => quick.push(x), raf: (fn) => { fn(); return 0; }, cancel: () => {}, now: () => 0, reduced: true });
  now.push('All of it at once, for a person who has asked for less motion.');
  ok('with less motion asked for, it is all shown at once', quick[quick.length - 1] === 'All of it at once, for a person who has asked for less motion.' && quick.length === 1);
}

console.log('\nThe bubble is drawn in the finished reply\'s shape:');
{
  // A small stand-in for the page, enough for the drawing.
  const make = (tag) => {
    const el = { tagName: tag.toUpperCase(), children: [], className: '', attrs: {}, parent: null,
      classList: { remove() {}, add() {} },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      get lastElementChild() { return this.children[this.children.length - 1] || null; },
      querySelector(sel) { return sel === ':scope > .msg-body.live' ? this.children.find((c) => c.className === 'msg-body live') || null : null; },
      set textContent(v) { this.children = []; }, };
    el.ownerDocument = doc;
    Object.defineProperty(el, 'innerHTML', { set(v) { this.children = []; this.html = v; const p = make('p'); this.appendChild(make('div')).appendChild(p); } });
    return el;
  };
  const doc = { createElement: make };
  const bubble = make('div');
  let made = 0;
  const thought = () => { made++; const d = make('details'); d.className = 'thought'; return d; };
  const body = L.into(bubble, '<div class="markdown-body"><p>Hello</p></div>', thought);
  ok('the folded thinking comes first, then the body', bubble.children[0].className === 'thought' && bubble.children[1] === body && body.className === 'msg-body live');
  L.into(bubble, '<div class="markdown-body"><p>Hello there</p></div>', thought);
  ok('the thinking is made once, so opening it while the reply is written keeps it open', made === 1 && bubble.children.length === 2);
  const p = body.children[0].children[0];
  ok('the mark that says it is being written sits at the end of the last words', p.children.length === 1 && p.children[0].className === 'live-caret' && p.children[0].attrs['aria-hidden'] === 'true');
  ok('with no thinking there is only the body', (() => { const b = make('div'); L.into(b, '<p>x</p>', () => null); return b.children.length === 1; })());
}

console.log('\nThe chat uses it, and the finished reply matches it:');
{
  const app = src('js', 'app.js');
  ok('every change to the reply while it arrives goes through it', /function updateLastBubble\(text\) \{\n\s*\(_live \|\| \(_live = window\.HCLiveText\.create\(\{ paint: writeLastBubbleText, reduced: !!window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches \}\)\)\)\.push\(text\);/.test(app));
  ok('it is formatted by the formatter the finished reply uses, drawn in its shape, with its thinking', /html = formatContent\(text\);/.test(app) && /window\.HCLiveText\.into\(msgs\.querySelector\("\.msg\.assistant:last-of-type \.bubble"\), html, \(\) => m && m\.role === "assistant" \? HCThought\.element\(m\.thinking,/.test(app));
  ok('no raw text is written into a reply any more', !/last\.textContent = _pendingBubbleText/.test(app));
  ok('when the reply is done the pacing stops and the reply is drawn whole', /function flushPendingBubbleUpdate\(\) \{ if \(_live\) _live\.stop\(\); _live = null; \}/.test(app));
  ok('a code block with no language waits for the end to be coloured, as guessing is slow', /if \(window\.hljs && \(!_liveFormat \|\| \(label && window\.hljs\.getLanguage\(label\)\)\)\)/.test(app));
  const boot = src('boot.js');
  ok('it loads after the code-block reader and before app.js', boot.indexOf("'/js/fences.js'") > -1 && boot.indexOf("'/js/fences.js'") < boot.indexOf("'/js/chat/live-text.js'") && boot.indexOf("'/js/chat/live-text.js'") < boot.indexOf("'/js/app.js'"));
  const css = src('css', 'main.css');
  ok('its mark breathes, and is still with less motion asked for or the light drawing mode on', /\.live-caret \{[^}]*animation: hcLiveCaret/.test(css) && /prefers-reduced-motion: reduce\) \{ \.live-caret \{ animation: none; \} \}/.test(css) && /body\.low-gpu \.live-caret \{ animation: none; \}/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/live-text.js)`);
process.exit(fail ? 1 : 0);
