// ==============================================================
// patch_file — checks
//
// Loads the REAL src/js/code/patch.js, then the REAL hashcoder.js beside it,
// and drives patch_file the way the agent does, reading what would be written
// to the disk.
//
// patch_file is the agent's usual way to change a file, and it writes back
// the whole file. So the property that matters is that everything outside the
// passage it was asked to change comes back exactly as it was.
//
// Run with: npm run check:code-patch
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const sandbox = { console, TextDecoder, TextEncoder, atob, btoa, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'patch.js'), sandbox, { filename: 'patch.js' });
const P = sandbox.HCCodePatch;
const throws = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };

console.log('The passage is replaced, and nothing else:');
{
  ok('one occurrence is replaced', P.applyPatch('a b c', 'b', 'B', 'f') === 'a B c');
  ok('a passage that is not unique is refused, saying how many', /found 2 times/.test(throws(() => P.applyPatch('x x', 'x', 'y', 'f'))));
  ok('a missing passage is refused, with the start of the file', /not found[\s\S]*File begins with:\nabc/.test(throws(() => P.applyPatch('abc', 'zzz', 'y', 'f'))));
  ok('an empty search matches nothing', P.count('abc', '') === 0);
}

console.log('\nA passage copied imperfectly is still found, and only once:');
{
  const file = 'function f() {\n    if (a) {\n        return 1;\n    }\n}\n';
  ok('spaces left at the ends of lines are ignored', P.applyPatch('x = 1;\ny = 2;\n', 'x = 1;  \ny = 2;', 'x = 3;\ny = 2;', 'f') === 'x = 3;\ny = 2;\n');
  const moved = P.applyPatch(file, 'if (a) {\n    return 1;\n}', 'if (a) {\n    return 2;\n}', 'f');
  ok('indentation one level off is found, and the replacement indented as the file is',
    moved === 'function f() {\n    if (a) {\n        return 2;\n    }\n}\n', JSON.stringify(moved));
  const numbered = P.applyPatch('a\nb\nc\n', '2| b\n3| c', '2| B\n3| c', 'f');
  ok('the line numbers of a numbered read are taken off', numbered === 'a\nB\nc\n', JSON.stringify(numbered));
  ok('a replacement written without numbers is used as it is', P.applyPatch('a\nb\nc\n', '  2| b', 'BB', 'f') === 'a\nBB\nc\n');
  ok('a loose match found twice is refused', /found 2 times in "f" with its indentation adjusted/.test(throws(() => P.applyPatch('  foo()\n    foo()\n', 'foo()  ', 'bar()', 'f')) || ''));
  ok('a Windows file matched loosely keeps CRLF', P.applyPatch('a\r\n    b\r\nc\r\n', '  b', '  B', 'f') === 'a\r\n    B\r\nc\r\n');
  const how = P.applyEdits(file, [{ search: 'if (a) {\n    return 1;\n}', replace: 'if (a) {\n    return 2;\n}' }], 'f').notes.join();
  ok('how a loose match was found is said', /indentation adjusted/.test(how), how);
  ok('an exact match says nothing more', P.applyEdits('a b', [{ search: 'b', replace: 'c' }], 'f').notes.length === 0);
}

console.log('\nA passage that is not there:');
{
  const file = Array.from({ length: 40 }, (_, i) => `const v${i} = compute(${i});`).join('\n') + '\n';
  const why = throws(() => P.applyPatch(file, 'const v21 = compute(twenty one);', 'x', 'app.js'));
  ok('the passage most like it is shown, with its line number', /most like it is at lines 22-22/.test(why) && /22\| const v21 = compute\(21\);/.test(why), why);
  ok('and the model is told to copy it without the numbers', /without the line numbers/.test(why));
  ok('text like nothing in the file shows how the file begins instead', /File begins with/.test(throws(() => P.applyPatch(file, 'zebra giraffe', 'x', 'f'))));
}

console.log('\nSeveral edits to one file, all or none:');
{
  const file = 'A = 1\nB = 2\nC = 3\n';
  const out = P.applyEdits(file, [{ search: 'A = 1', replace: 'A = 10' }, { search: 'C = 3', replace: 'C = 30' }], 'f');
  ok('each edit is made', out.text === 'A = 10\nB = 2\nC = 30\n');
  const why = throws(() => P.applyEdits(file, [{ search: 'A = 1', replace: 'A = 10' }, { search: 'D = 4', replace: 'x' }], 'f'));
  ok('one that cannot be made is named, and nothing is changed', /edit 2 of 2/.test(why) && /Nothing was changed/.test(why));
  ok('an edit sees the file as the ones before it left it', P.applyEdits('x', [{ search: 'x', replace: 'y' }, { search: 'y', replace: 'z' }], 'f').text === 'z');
  ok('an edit with no search text is refused', /no search text/.test(throws(() => P.applyEdits('x', [{ search: 'x', replace: 'y' }, { replace: 'z' }], 'f'))));
}

console.log('\nA JSON file an edit would break is not written:');
{
  ok('valid before and broken after is refused, saying where', /does not parse/.test(P.breaks('/p/config.json', '{"a": 1}', '{"a": 1,}')));
  ok('valid after is allowed', P.breaks('/p/config.json', '{"a": 1}', '{"a": 2}') === '');
  ok('a new JSON file must parse', /does not parse/.test(P.breaks('/p/new.json', null, '{oops')));
  ok('a file that did not parse before is not judged', P.breaks('/p/tsconfig.json', '{ // comment\n}', '{ // comment\n "a": 1 }') === '');
  ok('other files are not judged', P.breaks('/p/app.js', 'a', '{oops') === '');
  ok('a new tsconfig.json with comments and a trailing comma is written',
    P.breaks('/p/tsconfig.json', null, '{\n  // strict\n  "compilerOptions": { "strict": true, /* for now */ },\n}\n') === '');
  ok('a comment added to a tsconfig.json that parsed is allowed',
    P.breaks('/p/tsconfig.build.json', '{"a": 1}', '{\n  // why\n  "a": 1\n}') === '');
  ok('an editor settings file reads its comments', P.breaks('/p/.vscode/settings.json', null, '{ // x\n "a": 1 }') === '');
  ok('a tsconfig.json left with an open bracket is refused', /does not parse/.test(P.breaks('/p/tsconfig.json', '{"a": 1}', '{"a": 1')));
  ok('a tsconfig.json left with a comment open is refused', /comment is left open/.test(P.breaks('/p/tsconfig.json', '{"a": 1}', '{"a": 1 /* }')));
  ok('slashes inside a string are not a comment', P.breaks('/p/tsconfig.json', null, '{"u": "http://x", "p": "a/*b"}') === '' &&
    /does not parse/.test(P.breaks('/p/tsconfig.json', null, '{"u": "//"')));
  ok('package.json still refuses a comment: its readers take none',
    /does not parse/.test(P.breaks('/p/package.json', '{"a": 1}', '{\n  // why\n  "a": 1\n}')));
  ok('a file named like one is not taken for it', /does not parse/.test(P.breaks('/p/mytsconfig.json.bak.json', null, '{ // x\n}')));
  ok('a byte-order mark at the start is allowed', P.breaks('/p/config.json', null, '\uFEFF{"a": 1}') === '');
}

console.log('\nA long file is read by lines:');
{
  const text = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const first = P.linesWindow(text, null, null, 'big.js');
  ok('lines 1-200 by default, saying how many there are', /^\[big\.js: lines 1-200 of 450\./.test(first) && /\n  1\| line 1\n/.test(first) && /\n200\| line 200$/.test(first));
  ok('and how to read on', /start_line 201/.test(first));
  const mid = P.linesWindow(text, 440, 460, 'big.js');
  ok('a range past the end stops at the last line', /lines 440-450 of 450/.test(mid) && !/To read on/.test(mid));
  ok('no more than 500 lines at once', /lines 1-500|lines 1-450/.test(P.linesWindow(text, 1, 5000, 'big.js')));
  ok('a file over 400 lines counts as long', P.isLong(text) && !P.isLong('a\nb\n'));
}

console.log('\nThe replacement goes in exactly as written:');
{
  // Each of these is an instruction to String.prototype.replace.
  for (const r of ['$$', '$&', '$`', "$'", 'echo $$ > pid', "s.replace(/a/, '$&$&')"]) {
    ok(`${JSON.stringify(r)} is kept`, P.applyPatch('head MARK tail', 'MARK', r, 'f') === `head ${r} tail`);
  }
  ok('control: the built-in replace would have changed it', 'head MARK tail'.replace('MARK', '$`') !== 'head $` tail');
}

console.log('\nLine endings stay as they were:');
{
  const file = 'one\r\ntwo\r\nthree\r\nfour\r\n';
  const out = P.applyPatch(file, 'two\nthree', 'TWO\nTHREE\nextra', 'f');
  ok('an LF search finds its passage in a CRLF file', out.includes('TWO'));
  ok('the replacement is written with CRLF too', out === 'one\r\nTWO\r\nTHREE\r\nextra\r\nfour\r\n', JSON.stringify(out));
  ok('no line in the file ends with a bare LF', !/[^\r]\n/.test(out));
  ok('a file with LF endings is not given CRLF', P.applyPatch('a\nb\nc\n', 'b', 'B\nb2', 'f') === 'a\nB\nb2\nc\n');
  const mixed = 'a\r\nb\nc\r\n';
  ok('a file that mixes them is still patched', P.applyPatch(mixed, 'a\nb\nc', 'X', 'f') === 'X\n');
}

console.log('\nA whole-file rewrite keeps a Windows file\'s line endings:');
{
  const K = P.keepLineEndings;
  ok('LF text over a CRLF file is written with CRLF', K('a\r\nb\r\n', 'x\ny\nz\n').text === 'x\r\ny\r\nz\r\n' && K('a\r\nb\r\n', 'x\n').kept);
  ok('text over an LF file is left as written', K('a\nb\n', 'x\ny\n').text === 'x\ny\n' && !K('a\nb\n', 'x\n').kept);
  ok('a file that mixed the two is not guessed at', K('a\r\nb\n', 'x\ny\n').text === 'x\ny\n');
  ok('text that already carries a CR is left as written', K('a\r\nb\r\n', 'x\r\ny\n').text === 'x\r\ny\n');
  ok('a new file is left as written', K(null, 'x\ny\n').text === 'x\ny\n');
  ok('text with no line ending is left alone', K('a\r\nb\r\n', 'one line').text === 'one line' && !K('a\r\nb\r\n', 'one line').kept);
  ok('a byte-order mark stays where it was', K('\ufeffa\r\nb\r\n', '\ufeffx\ny\n').text === '\ufeffx\r\ny\r\n');
}

console.log('\nOnly UTF-8 text is patched:');
{
  const enc = (s) => new TextEncoder().encode(s);
  ok('ordinary text reads back as it is', P.textOf(enc('const ü = "✓";\n'), 'f') === 'const ü = "✓";\n');
  ok('a byte-order mark is kept, so it is written back', P.textOf(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), 'f') === '\uFEFFa');
  ok('a file with NUL bytes is refused as not text', /not a text file/.test(throws(() => P.textOf(new Uint8Array([0x25, 0x50, 0x00, 0x01]), 'x.bin'))));
  ok('a file in another encoding is refused', /not UTF-8/.test(throws(() => P.textOf(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'latin1.txt'))));
  const b = 'héllo ✓';
  ok('base64 from the native side turns back into the same bytes',
    P.textOf(P.bytesFromBase64(Buffer.from(b).toString('base64')), 'f') === b);
}

console.log('\npatch_file writes back the whole file:');
{
  // The real hashcoder.js, with the native side stood in for.
  const disk = new Map();
  const writes = [];
  const sealed = [];
  const HC = {
    isTauri: true,
    guard: { request: async () => true },
    undo: {
      capture: async (path) => ({ id: 'c1', path, existed: disk.has(path), content: disk.get(path) ?? null, unrestorable: null }),
      // Undo's record of the file as the write left it: taken after the write.
      seal: async (record) => { sealed.push({ path: record?.path, content: disk.get(record?.path) }); },
      drop: async () => {},
    },
    invoke: async (cmd, args) => {
      if (cmd === 'fs_read_base64') {
        if (!disk.has(args.path)) throw new Error(`Cannot access "${args.path}"`);
        const bytes = disk.get(args.path);
        return { base64: Buffer.from(bytes).toString('base64'), bytes: bytes.length };
      }
      if (cmd === 'fs_read_file') {
        const text = String(disk.get(args.path));
        return text.length > 100000 ? text.slice(0, 100000) + '\n\n[TRUNCATED — showing first ...]' : text;
      }
      if (cmd === 'fs_write_file') { writes.push(args); disk.set(args.path, args.content); return null; }
      return null;
    },
  };
  sandbox.HC = HC;
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), sandbox, { filename: 'hashcoder.js' });
  const code = sandbox.HC.code;

  // Past the read_file limit. A change near the start was found in the
  // shortened copy and the copy written back; one near the end was not found.
  const big = Array.from({ length: 6000 }, (_, i) => `line ${i} of a long generated file`).join('\n');
  const attempt = async (path, s, r) => { try { await code.patchFile(path, s, r); return ''; } catch (e) { return String(e.message); } };
  disk.set('/p/big.js', big);
  let err = await attempt('/p/big.js', 'line 10 of', 'LINE 10 of');
  let written = disk.get('/p/big.js');
  ok('a change near the start of a long file keeps every line after it',
    !err && written.length === big.length && written.split('\n').length === 6000 && !written.includes('TRUNCATED'),
    err || `${written.length} of ${big.length} characters written`);
  disk.set('/p/big.js', big);
  err = await attempt('/p/big.js', 'line 5990 of', 'LINE 5990 of');
  written = disk.get('/p/big.js');
  ok('a change near its end is found and made', !err && written.includes('LINE 5990 of') && written.length === big.length, err);

  disk.set('/p/win.txt', 'a\r\nb\r\nc\r\n');
  await code.patchFile('/p/win.txt', 'b\n', 'B\n');
  ok('a Windows file keeps its line endings', writes.at(-1).content === 'a\r\nB\r\nc\r\n');

  disk.set('/p/pid.sh', 'echo PID\n');
  await code.patchFile('/p/pid.sh', 'PID', '$$');
  ok('a replacement with $$ is saved as $$', writes.at(-1).content === 'echo $$\n');

  const before = writes.length;
  disk.set('/p/doc.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x0a, 0x00, 0xff, 0x10]));
  let pdfError = '';
  try { await code.patchFile('/p/doc.pdf', 'PDF', 'X'); } catch (e) { pdfError = String(e.message); }
  ok('a PDF is refused, and nothing is written', /not a text file/.test(pdfError) && writes.length === before);

  disk.set('/p/old.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  let latinError = '';
  try { await code.patchFile('/p/old.txt', 'caf', 'CAF'); } catch (e) { latinError = String(e.message); }
  ok('a file in another encoding is refused, and nothing is written', /not UTF-8/.test(latinError) && writes.length === before);

  let missing = '';
  try { await code.patchFile('/p/none.txt', 'a', 'b'); } catch (e) { missing = String(e.message); }
  ok('a file that is not there says to use write_file', /could not be read[\s\S]*write_file/.test(missing));

  disk.set('/p/app.config', 'one\r\ntwo\r\n');
  const res = JSON.parse(await code.writeFile('/p/app.config', 'uno\ndos\ntres\n'));
  ok('write_file over a Windows file saves it with CRLF', writes.at(-1).content === 'uno\r\ndos\r\ntres\r\n');
  ok('... reports the bytes it saved', res.bytes === 'uno\r\ndos\r\ntres\r\n'.length);
  ok('... and tells the model the endings were kept', /kept as CRLF/.test(res.lineEndings || ''));
  disk.set('/p/settings.json', '{\n  "port": 3000\n}\n');
  const beforeJson = writes.length;
  let jsonError = '';
  try { await code.patchFile('/p/settings.json', '"port": 3000', '"port": 8080,'); } catch (e) { jsonError = String(e.message); }
  ok('an edit that would break a JSON file is refused, and nothing is written', /does not parse/.test(jsonError) && writes.length === beforeJson);
  disk.set('/p/multi.js', 'const A = 1;\nconst B = 2;\n');
  const multi = JSON.parse(await code.patchFile('/p/multi.js', 'const A = 1;', 'const A = 5;', '', [{ search: 'const B = 2;', replace: 'const B = 6;' }]));
  ok('patch_file makes several edits in one call', disk.get('/p/multi.js') === 'const A = 5;\nconst B = 6;\n' && multi.edits === 2);
  disk.set('/p/long.js', Array.from({ length: 450 }, (_, i) => `l${i + 1}`).join('\n'));
  const longRead = await code.readFile('/p/long.js');
  ok('read_file gives a long file as its first 200 numbered lines', /lines 1-200 of 450/.test(longRead) && /200\| l200$/.test(longRead));
  const ranged = await code.readFile('/p/long.js', 300, 302);
  ok('and a range when one is asked for', /lines 300-302 of 450/.test(ranged) && /301\| l301/.test(ranged));
  disk.set('/p/short.js', 'x\ny\n');
  ok('a short file is read as it is', /^x\ny\n/.test(await code.readFile('/p/short.js')));
  const plain = JSON.parse(await code.writeFile('/p/new.txt', 'a\nb\n'));
  ok('a new file is saved as written, with no note', writes.at(-1).content === 'a\nb\n' && !('lineEndings' in plain));
  ok('Undo records the file as each write left it, after the write', sealed.at(-1)?.path === '/p/new.txt' && sealed.at(-1)?.content === 'a\nb\n'
    && sealed.some((x) => x.path === '/p/app.config' && x.content === 'uno\r\ndos\r\ntres\r\n'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/patch.js)`);
process.exit(fail ? 1 : 0);
