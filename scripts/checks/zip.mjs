// ==============================================================
// The zip container — checks
//
// Loads the REAL src/js/io/zip.js. It was written so 3MF could be written, and
// a second implementation had grown separately inside the Virtual OS for
// downloading a folder — two ways of writing one format, one of them checked.
// There is one now, and this is what holds it honest.
//
// Run with: npm run check:zip
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, TextDecoder, TextEncoder, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'io', 'zip.js'), 'utf8'), sandbox, { filename: 'zip.js' });
const ZIP = sandbox.window.HCZip;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nThe zip container holds what was put in it:');
{
  const encode = (t) => new TextEncoder().encode(t);
  const bytes = ZIP.store([
    { name: 'first.txt', bytes: encode('hello') },
    { name: 'nested/second.txt', bytes: encode('a longer member, with commas, and text') },
  ]);
  const back = ZIP.unstore(bytes);
  ok('every member comes back', back.size === 2);
  ok('by name, including a nested one', back.has('first.txt') && back.has('nested/second.txt'));
  ok('with its bytes unchanged',
    new TextDecoder().decode(back.get('first.txt')) === 'hello');
  ok('and the longer one too',
    new TextDecoder().decode(back.get('nested/second.txt')) === 'a longer member, with commas, and text');
  // The checksum is what a reader uses to decide the file is intact. Written
  // wrong, most readers refuse the archive outright.
  ok('the checksum is the standard one', ZIP.crc32(encode('123456789')) === 0xcbf43926);
  ok('an empty member is allowed', ZIP.unstore(ZIP.store([{ name: 'empty', bytes: [] }])).get('empty').length === 0);
  ok('an empty archive is still a valid archive', ZIP.unstore(ZIP.store([])).size === 0);
  ok('nothing that is not an archive comes back as one', ZIP.unstore(encode('not a zip')).size === 0);
  // No clock anywhere in it, so the same model twice is the same bytes.
  ok('the same input writes the same bytes',
    ZIP.store([{ name: 'a', bytes: encode('x') }]).join() === ZIP.store([{ name: 'a', bytes: encode('x') }]).join());
}


console.log(`\n${pass} passed, ${fail} failed  (src/js/io/zip.js)\n`);
process.exit(fail === 0 ? 0 : 1);
