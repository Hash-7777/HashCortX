// ==============================================================
// PDF-text checks
//
// Loads the REAL src/js/pdf-text.js and exercises the parts that do not need
// pdf.js: turning base64 back into bytes, joining a page's fragments, and the
// message for a PDF that has no text in it.
//
// The joining is the part worth pinning. pdf.js hands back positioned
// fragments, not lines — join them with nothing and the words run together,
// which is a page of text the model reads as gibberish and cannot tell is
// damaged.
//
// Run with: npm run check:pdf-text
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'pdf-text.js'), 'utf8');
const sandbox = { console, atob, setTimeout, Uint8Array, Date, Promise, Error, String };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'pdf-text.js' });
const P = sandbox.window.HCPdfText;

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
};
const eq = (label, a, b) => check(label, Object.is(a, b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

console.log('\nBase64 from Rust becomes the bytes pdf.js wants:');
{
  // A PDF begins "%PDF-1.x". If the decode is wrong the header is wrong and
  // pdf.js rejects the file, which reads as "the PDF is corrupt".
  const bytes = P.base64ToBytes('JVBERi0xLjQ=');
  eq('the length is right', bytes.length, 8);
  eq('and it decodes to the PDF header',
    Array.from(bytes).map((b) => String.fromCharCode(b)).join(''), '%PDF-1.4');
  eq('empty input is safe', P.base64ToBytes('').length, 0);
  eq('null is safe', P.base64ToBytes(null).length, 0);

  // Every byte value, so a masking or sign error shows up rather than hiding
  // in the printable range.
  const all = Array.from({ length: 256 }, (_, i) => i);
  const b64 = Buffer.from(Uint8Array.from(all)).toString('base64');
  const back = Array.from(P.base64ToBytes(b64));
  check('all 256 byte values survive the trip', back.length === 256 && back.every((v, i) => v === all[i]));
}

console.log('\nA page reads as prose, not as one run-on word:');
{
  eq('fragments are separated',
    P.pageToText([{ str: 'Hello' }, { str: 'there' }]), 'Hello there');
  // hasEOL is how pdf.js says a fragment ended a line. Ignoring it collapses
  // a table or a code block onto one line.
  eq('a line ending is kept',
    P.pageToText([{ str: 'one', hasEOL: true }, { str: 'two' }]), 'one\ntwo');
  eq('runs of spaces collapse',
    P.pageToText([{ str: 'a   ' }, { str: '   b' }]), 'a b');
  eq('items without text are skipped',
    P.pageToText([{ str: 'a' }, {}, null, { str: 'b' }]), 'a b');
  eq('an empty page is empty', P.pageToText([]), '');
  eq('no items at all is safe', P.pageToText(null), '');
}

console.log('\nA scanned PDF says so instead of looking empty:');
{
  const note = P.noTextNote('scan.pdf', 3);
  check('it names the file', note.includes('scan.pdf'));
  check('it gives the page count', note.includes('3 pages'));
  check('it says why there is no text', /OCR/.test(note));
  // The whole point: a model told "nothing found" will invent the contents.
  check('and it tells the model not to guess', /rather than guessing/i.test(note));
  check('one page is singular', P.noTextNote('a.pdf', 1).includes('1 page ·') === false
    && P.noTextNote('a.pdf', 1).includes('1 page'));
}

console.log('\nThe page cap is recorded, not incidental:');
eq('a document is read up to 120 pages', P.MAX_PAGES, 120);

console.log(`\n${pass} passed, ${fail} failed  (src/js/pdf-text.js)`);
process.exit(fail ? 1 : 0);
