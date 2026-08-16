// ==============================================================
// Page-text checks
//
// Loads the REAL src/js/page-text.js into a Node VM and exercises it.
//
// What matters here is not that a slice is taken — it is that a page which
// does not fit says so. The limit this module replaces cut every fetched page
// to 3,000 characters and told the model nothing, so a model handed the top of
// a reference page answered from it as though it had read the whole thing.
// Most of the checks below are about that: the offsets are honest, the
// continuation is reachable, and reading to the end says the end is the end.
//
// Run with: npm run check:page-text
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'page-text.js'), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'page-text.js' });
const P = sandbox.window.HCPageText;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const eq = (label, actual, expected) =>
  check(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);

console.log('\nMarkup comes out and readable text stays:');
{
  eq('tags go', P.stripHtml('<p>Hello <b>there</b></p>'), 'Hello there');
  // Not just the tags — what is inside them. Stripping <script> as a tag pair
  // and keeping its body hands the model source code as if it were prose.
  eq('a script takes its contents with it',
    P.stripHtml('<p>Real</p><script>var secret = 1;</script>'), 'Real');
  eq('so does a style',
    P.stripHtml('<style>body{color:red}</style><p>Real</p>'), 'Real');
  eq('runs of space collapse', P.stripHtml('<p>a</p>\n\n\n   <p>b</p>'), 'a b');
  eq('a non-breaking space is a space', P.stripHtml('a&nbsp;b'), 'a b');
  eq('empty input is safe', P.stripHtml(''), '');
  eq('null is safe', P.stripHtml(null), '');
}

console.log('\nA page that does not fit says so:');
{
  const long = 'x'.repeat(40000);
  const first = P.windowOf(long, 0, 15000);
  eq('the first window starts at the beginning', first.offset, 0);
  eq('it is the size asked for', first.text.length, 15000);
  eq('it reports the whole length, not the window', first.total, 40000);
  check('it says it was cut', first.truncated === true);
  eq('and where to continue from', first.nextOffset, 15000);

  // The continuation has to actually reach the rest. An offset that is off by
  // the size of a window silently loses a section in the middle, and nothing
  // downstream would ever notice.
  const second = P.windowOf(long, first.nextOffset, 15000);
  eq('the next window continues exactly where the first ended', second.offset, 15000);
  eq('no gap and no overlap',
    first.text.length + second.text.length, 30000);

  const last = P.windowOf(long, 30000, 15000);
  eq('the last window holds what is left', last.text.length, 10000);
  check('and says there is no more', last.truncated === false);
  eq('with nothing to continue to', last.nextOffset, null);
}

console.log('\nA page that fits is not made to look cut:');
{
  const w = P.windowOf('short page', 0, 15000);
  eq('all of it comes back', w.text, 'short page');
  check('it is not marked truncated', w.truncated === false);
  eq('there is no next offset', w.nextOffset, null);
  eq('and no note is added', P.continuationNote(w, 'https://x.test'), '');
}

console.log('\nThe offsets come from a model, so none of them are trusted:');
{
  const text = 'abcdefghij'; // 10 characters
  eq('a missing offset starts at the beginning', P.windowOf(text, undefined, 4).offset, 0);
  eq('so does a negative one', P.windowOf(text, -50, 4).offset, 0);
  eq('a fractional one is floored', P.windowOf(text, 2.9, 4).offset, 2);
  eq('nonsense starts at the beginning', P.windowOf(text, 'banana', 4).offset, 0);
  // Past the end must give an empty window that is honestly empty — not a
  // window the model reads as "the page has nothing in it".
  const past = P.windowOf(text, 999, 4);
  eq('an offset past the end clamps to the end', past.offset, 10);
  eq('and returns nothing', past.text, '');
  check('and does not claim there is more', past.truncated === false);
  eq('a zero limit falls back to the default', P.windowOf(text, 0, 0).text.length, 10);
  eq('so does a negative limit', P.windowOf(text, 0, -5).text.length, 10);
  eq('empty text is safe', P.windowOf('', 0, 100).total, 0);
  eq('null text is safe', P.windowOf(null, 0, 100).text, '');
}

console.log('\nThe note tells the model what to do, not just a number:');
{
  const w = P.windowOf('y'.repeat(20000), 0, 15000);
  const note = P.continuationNote(w, 'https://docs.test/guide');
  check('it names the address to call again', note.includes('https://docs.test/guide'));
  check('it gives the offset to continue from', note.includes('15000'));
  check('it says how much there is', note.includes('20000'));
  check('and it says not to answer from part of a page',
    /do not answer as if you had read the whole/i.test(note));
}

console.log('\nThe default window is worth the budget it spends:');
{
  // The prompt's whole tool budget is 60,000 characters, spent newest-first
  // (js/agent-context.js). A page taking all of it would evict everything the
  // agent had already done; one taking 3,000 was the old bug. A quarter is the
  // recorded intent, and it is pinned so changing it is deliberate.
  eq('a page reads 15,000 characters at a time', P.DEFAULT_LIMIT, 15000);
  eq('a page nobody asked for reads less', P.PASSIVE_LIMIT, 6000);
  check('and the passive window is the smaller of the two', P.PASSIVE_LIMIT < P.DEFAULT_LIMIT);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/page-text.js)`);
process.exit(fail ? 1 : 0);
