// ==============================================================
// Knowledge-base chunking checks
//
// Loads the REAL src/js/rag-store.js into a Node VM.
//
// The property under test is coverage: every character of a document has to
// end up in at least one chunk. Ingest used to advance 1200 characters and
// store 600 of them, so half of every file was dropped — silently, because a
// knowledge base that is missing passages looks exactly like one that has them
// and did not match. Coverage is checked over random text, not one example.
//
// Run with: npm run check:rag-store
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'rag-store.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'rag-store.js' });
const R = sandbox.window.HCRagStore;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** Rebuild the document from its chunks, allowing for the deliberate overlap. */
function coversEverything(text, chunks) {
  const covered = new Array(text.length).fill(false);
  for (const c of chunks) {
    // The chunk must actually be the slice it claims to be.
    if (text.slice(c.start, c.start + c.text.length) !== c.text) return 'a chunk does not match the text at its own offset';
    for (let i = c.start; i < c.start + c.text.length; i++) covered[i] = true;
  }
  const missing = covered.findIndex(v => !v);
  return missing === -1 ? true : `character ${missing} is in no chunk`;
}

console.log('\nEvery character of a document ends up in a chunk:');
{
  // A deterministic pseudo-random generator, so a failure is reproducible.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];

  for (const len of [1, 39, 41, 599, 600, 601, 1199, 1200, 1201, 5000, 20000]) {
    let text = '';
    while (text.length < len) {
      text += words[Math.floor(rnd() * words.length)];
      const r = rnd();
      text += r < 0.05 ? '\n\n' : r < 0.12 ? '. ' : r < 0.18 ? '\n' : ' ';
    }
    text = text.slice(0, len);
    const chunks = R.chunkText(text);
    if (!text.trim()) { ok(`length ${len} — blank text makes no chunks`, chunks.length === 0); continue; }
    const result = coversEverything(text, chunks);
    ok(`length ${len} — nothing is dropped`, result === true, String(result));
    ok(`length ${len} — no chunk exceeds the limit`,
      chunks.every(c => c.text.length <= R.CHUNK_SIZE),
      `longest ${Math.max(...chunks.map(c => c.text.length))}`);
  }
}

console.log('\nText with no punctuation at all still terminates and is covered:');
{
  const text = 'x'.repeat(10000);
  const t0 = Date.now();
  const chunks = R.chunkText(text);
  ok('it finishes quickly', Date.now() - t0 < 1000);
  ok('nothing is dropped', coversEverything(text, chunks) === true);
  ok('it made more than one chunk', chunks.length > 1);
}

console.log('\nEdge cases:');
ok('empty text makes no chunks', R.chunkText('').length === 0);
ok('whitespace only makes no chunks', R.chunkText('   \n\n  ').length === 0);
ok('null makes no chunks', R.chunkText(null).length === 0);
{
  const short = 'a short note that is well under the limit';
  const c = R.chunkText(short);
  ok('short text is one chunk, unchanged', c.length === 1 && c[0].text === short);
  ok('and starts at zero', c[0].start === 0);
}

console.log('\nChunks are numbered in order, from zero:');
{
  const chunks = R.chunkText('word '.repeat(2000));
  ok('indexes run 0..n-1', chunks.every((c, i) => c.index === i));
  ok('offsets increase', chunks.every((c, i) => i === 0 || c.start > chunks[i - 1].start));
}

console.log('\nChunks overlap, so a sentence across a boundary survives:');
{
  const chunks = R.chunkText('word '.repeat(2000));
  const overlaps = chunks.slice(1).map((c, i) => chunks[i].start + chunks[i].text.length - c.start);
  ok('each chunk repeats some of the one before it', overlaps.every(o => o > 0),
    `overlaps: ${overlaps.slice(0, 5).join(', ')}`);
}

console.log('\nA caller cannot ask for settings that would loop forever:');
for (const [size, overlap] of [[100, 100], [100, 500], [100, 99], [50, -10]]) {
  const text = 'y'.repeat(3000);
  const t0 = Date.now();
  const chunks = R.chunkText(text, { size, overlap });
  const quick = Date.now() - t0 < 1000;
  ok(`size ${size}, overlap ${overlap} — terminates`, quick);
  ok(`size ${size}, overlap ${overlap} — still covers everything`,
    quick && coversEverything(text, chunks) === true);
}

console.log('\nTwo passages of one document are not mistaken for each other:');
{
  const a = R.chunkKey('file:notes.md', 'notes.md', 0);
  const b = R.chunkKey('file:notes.md', 'notes.md', 1);
  ok('different positions give different keys', a !== b);
  ok('the same position gives the same key', a === R.chunkKey('file:notes.md', 'notes.md', 0));
}

console.log('\nFragments too small to retrieve are not stored:');
ok('a very short line is refused', R.isWorthStoring('too short') === false);
ok('an empty string is refused', R.isWorthStoring('') === false);
ok('a real passage is kept', R.isWorthStoring('x'.repeat(R.MIN_CHUNK_CHARS)) === true);

console.log(`\n${pass} passed, ${fail} failed  (src/js/rag-store.js)`);
process.exit(fail ? 1 : 0);
