// ==============================================================
// Chat context — checks
//
// Loads the REAL src/js/chat/context.js. These decide what actually reaches a
// model when somebody attaches files, roughly what that will cost, and what
// the conversation ends up called.
//
// The budget was not a budget. A floor under each file's slice — sensible on
// its own — meant that past about fifteen attachments every one got the floor
// and the total went straight through the allowance. That is checked directly
// below, at the sizes where it happened.
//
// Run with: npm run check:chat-context
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, JSON, Math, String, Number, Array };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'chat', 'context.js'), 'utf8'), sandbox, { filename: 'context.js' });
const C = sandbox.window.HCChatContext;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// Filled with a character that appears nowhere in a filename, a header or the
// framing, so counting it counts file text and nothing else. Measuring with an
// "x" counted the one in ".txt" and made every reading four too high.
const FILLER = 'Q';
const bigFiles = (n, size = 50000) =>
  Array.from({ length: n }, (_, i) => ({ name: `file-${i}.doc`, text: FILLER.repeat(size) }));

/** How much of the output is actual file text, ignoring headers and framing. */
const fileTextIn = (out) => (out.match(/Q+/g) || []).reduce((n, run) => n + run.length, 0);

console.log('\nAttached files reach the model, and say how much of them did:');
{
  const out = C.buildAttachedFileContext([{ name: 'notes.txt', kind: 'text', text: 'hello there' }]);
  ok('the text is there', out.includes('hello there'));
  ok('and the file is named', out.includes('notes.txt'));
  ok('with how much was pulled out of it', /extracted_chars: 11/.test(out));
  ok('inside markers a model can see the bounds of',
    out.includes('[ATTACHED FILES') && out.includes('[END ATTACHED FILES]'));
  ok('nothing attached is nothing said', C.buildAttachedFileContext([]) === ''
    && C.buildAttachedFileContext(null) === '');
  ok('a file with no text still says that plainly',
    /No extracted text available/.test(C.buildAttachedFileContext([{ name: 'scan.pdf' }])));
}

console.log('\nA file too long to send says it was cut, and by how much:');
{
  // A model not told a file was cut short will reason confidently about the
  // part it was given, as though that were the whole thing.
  const out = C.buildAttachedFileContext([{ name: 'book.txt', text: 'y'.repeat(40000) }], 28000);
  ok('the cut is announced', /Attachment truncated for context/.test(out));
  ok('with how much was left out', /12000 chars omitted/.test(out), out.slice(0, 200));
  ok('and how much was sent', /sent_chars: 28000/.test(out));
  ok('a file that fits is not announced as cut',
    !/truncated/.test(C.buildAttachedFileContext([{ name: 'a', text: 'short' }], 28000)));
}

// ── The defect ───────────────────────────────────────────────────────────
console.log('\nThe budget is a budget, however many files there are:');
{
  // Past about fifteen files every one used to get the floor and the total
  // went through the allowance — a hundred attachments sent a hundred and
  // eighty thousand characters against twenty-eight thousand.
  for (const n of [1, 5, 15, 20, 50, 100]) {
    const out = C.buildAttachedFileContext(bigFiles(n), 28000);
    const text = fileTextIn(out);
    ok(`${String(n).padStart(3)} attachments send no more file text than the budget allows`,
      text <= 28000, `${text} characters of file text`);
  }
}

console.log('\nWhat could not be sent is named rather than dropped in silence:');
{
  const out = C.buildAttachedFileContext(bigFiles(40), 28000);
  ok('the ones left out are counted', /further attachments were not included/.test(out));
  ok('and named', /file-39\.doc/.test(out), out.slice(-300));
  ok('with something a model can act on', /Say so if the answer depends on them/.test(out));
  // A model told nothing about a file it was not given answers about the ones
  // it was as though that were all of them.
  ok('and nothing is said when nothing was left out',
    !/were not included/.test(C.buildAttachedFileContext(bigFiles(2), 28000)));
  ok('one left out is said in the singular',
    /1 further attachment was not included/.test(C.buildAttachedFileContext(bigFiles(16), 28000)));
}

console.log('\nA single enormous file is cut down rather than dropped:');
{
  // Dropping the only file somebody attached is never the answer they wanted.
  const out = C.buildAttachedFileContext([{ name: 'huge.txt', text: 'z'.repeat(900000) }], 28000);
  ok('it is still sent', out.includes('huge.txt'));
  ok('cut to the budget', /sent_chars: 28000/.test(out));
  ok('and nothing is reported as left out', !/were not included/.test(out));
  // Even a budget below the floor must send something.
  ok('an absurdly small budget still sends the file',
    C.buildAttachedFileContext([{ name: 'a.txt', text: 'hello' }], 10).includes('hello'));
}

console.log('\nWhat a conversation will cost, roughly:');
{
  ok('an empty conversation costs nothing much', C.estimatePromptTokens([]) < 10);
  const small = C.estimatePromptTokens([{ role: 'user', content: 'hello' }]);
  const large = C.estimatePromptTokens([{ role: 'user', content: 'hello '.repeat(1000) }]);
  ok('more text costs more', large > small * 50, `${small} then ${large}`);
  // What an image costs differs per provider by more than this estimate is
  // worth, so it is counted as its mention.
  ok('an image is counted as a mention rather than its bytes',
    C.estimatePromptTokens([{ role: 'user', content: '', images: ['x'.repeat(100000)] }]) < 50);
  ok('nothing usable is survivable',
    C.estimatePromptTokens(null) >= 0 && C.estimatePromptTokens([null, undefined]) >= 0);
}

console.log('\nA conversation is named after the first thing said in it:');
{
  ok('a short opening is the whole title',
    C.deriveTitle([{ role: 'user', content: 'fix my css' }]) === 'fix my css');
  ok('a long one is cut to three words',
    C.deriveTitle([{ role: 'user', content: 'build me a really large website' }]) === 'build me a…');
  ok('the assistant does not name the conversation',
    C.deriveTitle([{ role: 'assistant', content: 'Certainly!' }, { role: 'user', content: 'hi there' }]) === 'hi there');
  ok('nothing said yet is a new chat',
    C.deriveTitle([]) === 'New chat' && C.deriveTitle(null) === 'New chat');
  ok('and neither is whitespace', C.deriveTitle([{ role: 'user', content: '   ' }]) === 'New chat');
  ok('runs of spaces do not become empty words',
    C.deriveTitle([{ role: 'user', content: 'a    b    c    d' }]) === 'a b c…');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/context.js)\n`);
process.exit(fail === 0 ? 0 : 1);
