// ==============================================================
// Saving a file — checks
//
// Loads the real src/platform/tauri/save.js into a VM with a fake Tauri
// bridge, so what these assert is the code that ships.
//
// The property that matters is the seam: the bytes JS hands to the IPC must be
// the bytes Rust writes. A test on either side alone proves nothing about
// that, and the failure it would miss is the worst kind — a file that exists,
// opens, and is subtly wrong.
//
// Run with: npm run check:save
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A fresh sandbox with the real save.js loaded and a scripted Tauri bridge. */
function load({ isTauri = true, savePath = '/tmp/chosen.bin' } = {}) {
  const calls = [];
  const sandbox = {
    console, TextEncoder, Blob, URL, setTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    document: { createElement: () => ({ click() {}, remove() {}, style: {} }), body: { appendChild() {} } },
  };
  sandbox.window = sandbox;
  sandbox.HC = {
    isTauri,
    invoke: (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'plugin:dialog|save') return Promise.resolve(savePath);
      if (cmd === 'plugin:dialog|open') return Promise.resolve('/tmp/folder');
      if (cmd === 'export_write_file') {
        return Promise.resolve(Buffer.from(args.base64, 'base64').length);
      }
      return Promise.resolve(null);
    },
  };
  sandbox.HCExport = {
    mimeFor: () => 'application/octet-stream',
    dialogFilter: () => ({ name: 'Binary', extensions: ['bin'] }),
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, 'src', 'platform', 'tauri', 'save.js'), 'utf8'),
    sandbox, { filename: 'save.js' });
  return { HC: sandbox.HC, calls };
}

/** What actually reached export_write_file, decoded back to bytes. */
function writtenBytes(calls) {
  const call = calls.find(c => c.cmd === 'export_write_file');
  return call ? Buffer.from(call.args.base64, 'base64') : null;
}

console.log('\nThe bytes that arrive are the bytes that were sent:');
{
  const { HC, calls } = load();
  await HC.save.file('notes.md', 'hello — naïve café');
  // UTF-8, not latin-1: an accented character that survives the encoder but
  // not the base64 hop produces a file that opens with mojibake.
  check('text is written as UTF-8',
    writtenBytes(calls).equals(Buffer.from('hello — naïve café', 'utf8')));
}
{
  const { HC, calls } = load();
  const payload = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
  await HC.save.file('a.bin', payload);
  check('every byte value survives', writtenBytes(calls).equals(Buffer.from(payload)));
}
{
  // The reason toBase64 is chunked. String.fromCharCode(...bytes) spreads one
  // argument per byte, and a real export is far past the call-stack limit —
  // this would have worked on every small test and failed on the first .docx.
  const { HC, calls } = load();
  const big = new Uint8Array(1_500_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
  await HC.save.file('big.bin', big);
  check('a file past the call-stack limit still encodes',
    writtenBytes(calls).equals(Buffer.from(big)));
}
{
  const { HC, calls } = load();
  await HC.save.file('empty.txt', '');
  check('an empty file is still a file', writtenBytes(calls).length === 0);
}
{
  const { HC, calls } = load();
  await HC.save.file('b.bin', new Uint8Array([1, 2, 3]).buffer);
  check('an ArrayBuffer is accepted', writtenBytes(calls).equals(Buffer.from([1, 2, 3])));
}
{
  const { HC, calls } = load();
  await HC.save.file('c.bin', new Blob([new Uint8Array([9, 8, 7])]));
  check('a Blob is accepted', writtenBytes(calls).equals(Buffer.from([9, 8, 7])));
}
{
  // A view onto part of a larger buffer must write its own slice, not the
  // whole backing store — this is how a 40-byte export becomes a 4 MB one.
  const { HC, calls } = load();
  const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  await HC.save.file('d.bin', backing.subarray(2, 5));
  check('a view writes only its own slice', writtenBytes(calls).equals(Buffer.from([2, 3, 4])));
}

{
  // The encoder here and the decoder in src-tauri/src/commands/export.rs are
  // two separate pieces of code that have to agree exactly. Rust's decoder is
  // pinned against a standard encoder by its own tests, so pinning this one to
  // the same standard is what closes the seam between them — including every
  // remainder, which is where padding decides how many bytes of the last group
  // are real.
  const { HC, calls } = load();
  let identical = true, firstBad = '';
  for (let len = 0; len <= 130; len++) {
    calls.length = 0;
    const payload = new Uint8Array(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff));
    await HC.save.file('x.bin', payload);
    const sent = calls.find(c => c.cmd === 'export_write_file').args.base64;
    const standard = Buffer.from(payload).toString('base64');
    if (sent !== standard) { identical = false; firstBad = `at ${len} bytes`; break; }
  }
  check('what is encoded is standard base64, at every length', identical, firstBad);
}

console.log('\nThe user decides where it goes:');
{
  const { HC, calls } = load();
  await HC.save.file('report.md', 'x');
  const dialog = calls.find(c => c.cmd === 'plugin:dialog|save');
  check('a save asks first', !!dialog);
  check('the dialog is seeded with the filename', dialog.args.options.defaultPath === 'report.md');
  check('the dialog filters to that type', dialog.args.options.filters.length === 1);
  // Order matters: writing and then asking would put a file somewhere before
  // the user had a say.
  check('nothing is written before the answer',
    calls.findIndex(c => c.cmd === 'plugin:dialog|save') <
    calls.findIndex(c => c.cmd === 'export_write_file'));
}
{
  // Cancel is not an error. Raising one would put a failure dialog in front of
  // a user who just said no.
  const { HC, calls } = load({ savePath: null });
  const result = await HC.save.file('report.md', 'x');
  check('cancelling writes nothing', writtenBytes(calls) === null);
  check('cancelling is reported, not thrown', result.saved === false && result.reason === 'cancelled');
}
{
  const { HC, calls } = load();
  await HC.save.fileInto('/tmp/out', 'one.csv', 'a,b');
  const call = calls.find(c => c.cmd === 'export_write_file');
  check('saving into a chosen folder asks no further question',
    !calls.some(c => c.cmd === 'plugin:dialog|save'));
  check('the folder and name are joined', call.args.path === '/tmp/out/one.csv');
}
{
  const { HC, calls } = load();
  await HC.save.fileInto('/tmp/out/', 'one.csv', 'a,b');
  check('a trailing separator does not double up',
    calls.find(c => c.cmd === 'export_write_file').args.path === '/tmp/out/one.csv');
}
{
  const { HC, calls } = load();
  await HC.save.fileInto('C:\\Users\\a\\Docs', 'one.csv', 'a,b');
  check('a Windows folder is joined with a backslash',
    calls.find(c => c.cmd === 'export_write_file').args.path === 'C:\\Users\\a\\Docs\\one.csv');
}

console.log('\nOutside the desktop app it still exports:');
{
  const { HC, calls } = load({ isTauri: false });
  const result = await HC.save.file('x.md', 'hi');
  check('a browser falls back to a download', result.saved === true);
  check('and reaches no native command', calls.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/save.js)`);
process.exit(fail ? 1 : 0);
