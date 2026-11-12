// ==============================================================
// The line endings a new file takes — checks
//
// Loads the real src/js/code/line-endings.js and holds where the answer comes
// from (the project's .gitattributes, then its .editorconfig, then most of the
// files beside the new one), how each of the two settings files is matched to
// a path, that only text with plain LF endings is ever changed, and that a
// project that says nothing changes nothing.
//
// Run with: npm run check:line-endings
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'code', 'line-endings.js'), 'utf8'), box, { filename: 'line-endings.js' });
const L = box.HCCodeLineEndings;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

console.log('\nA .gitattributes file:');
{
  const G = L.fromGitattributes;
  ok('eol=crlf for every file', G('* text=auto eol=crlf\n', 'src/app.cs') === 'crlf');
  ok('eol=lf', G('* text eol=lf\n', 'a.txt') === 'lf');
  ok('a pattern with no slash matches the name in any folder', G('*.cs eol=crlf\n', 'src/deep/App.cs') === 'crlf' && G('*.cs eol=crlf\n', 'src/app.js') === null);
  ok('a pattern with a slash matches from the project folder', G('docs/*.md eol=crlf\n', 'docs/a.md') === 'crlf' && G('docs/*.md eol=crlf\n', 'src/docs/a.md') === null && G('/build/** eol=crlf\n', 'build/x/y.txt') === 'crlf');
  ok('a single star does not cross a folder', G('src/*.cs eol=crlf\n', 'src/a/b.cs') === null);
  ok('two stars do', G('src/**/*.cs eol=crlf\n', 'src/a/b.cs') === 'crlf' && G('**/*.cs eol=crlf\n', 'b.cs') === 'crlf');
  ok('the last line that says wins', G('* eol=crlf\n*.sh eol=lf\n', 'run.sh') === 'lf' && G('* eol=crlf\n*.sh eol=lf\n', 'run.cmd') === 'crlf');
  ok('a file marked binary or -text is left as it is', G('* eol=crlf\n*.dat binary\n', 'x.dat') === 'none' && G('* eol=crlf\n*.bin -text\n', 'x.bin') === 'none');
  ok('...and text again after that line is text', G('*.dat binary\n*.dat text eol=crlf\n', 'x.dat') === 'crlf');
  ok('comments, blank lines and text with no eol say nothing', G('# * eol=crlf\n\n* text=auto\n', 'a.txt') === null);
  ok('nothing, or no file, says nothing', G('', 'a.txt') === null && G(null, 'a.txt') === null);
}

console.log('\nAn .editorconfig file:');
{
  const E = L.fromEditorconfig;
  ok('end_of_line under [*]', E('root = true\n\n[*]\nend_of_line = crlf\n', 'src/a.js') === 'crlf');
  ok('a later section wins', E('[*]\nend_of_line = crlf\n\n[*.sh]\nend_of_line = lf\n', 'run.sh') === 'lf' && E('[*]\nend_of_line = crlf\n\n[*.sh]\nend_of_line = lf\n', 'a.ps1') === 'crlf');
  ok('a list in braces', E('[*.{cs,csproj}]\nend_of_line = crlf\n', 'x/y.csproj') === 'crlf' && E('[*.{cs,csproj}]\nend_of_line = crlf\n', 'y.js') === null);
  ok('a section with a slash matches from the project folder', E('[src/**.cs]\nend_of_line = crlf\n', 'src/a/b.cs') === 'crlf' && E('[src/*.cs]\nend_of_line = crlf\n', 'lib/src/b.cs') === null);
  ok('names and values in either case, with = or :', E('[*]\nEnd_Of_Line: CRLF\n', 'a') === 'crlf');
  ok('cr, which no tool here writes, says nothing', E('[*]\nend_of_line = cr\n', 'a') === null);
  ok('a comment says nothing', E('[*]\n# end_of_line = crlf\n; end_of_line = crlf\n', 'a') === null);
  ok('nothing, or no file, says nothing', E('', 'a') === null && E(undefined, 'a') === null);
}

console.log('\nThe files beside it:');
{
  const F = L.fromFiles;
  ok('most with CRLF on every line: crlf', F(['a\r\nb\r\n', 'c\r\n', 'd\n']) === 'crlf');
  ok('most with LF: lf', F(['a\nb\n', 'c\n', 'd\r\n']) === 'lf');
  ok('a tie, mixed files or one-line files say nothing', F(['a\r\n', 'b\n']) === null && F(['a\r\nb\n', 'one line']) === null && F([]) === null);
}

console.log('\nWhich answer counts:');
{
  const C = L.choose;
  ok('.gitattributes first', json(C({ gitattributes: 'crlf', editorconfig: 'lf', beside: 'lf' })) === json({ eol: 'crlf', from: '.gitattributes' }));
  ok('.editorconfig next', json(C({ gitattributes: null, editorconfig: 'crlf', beside: 'lf' })) === json({ eol: 'crlf', from: '.editorconfig' }));
  ok('then the files beside it', json(C({ beside: 'crlf' })) === json({ eol: 'crlf', from: 'the files beside it' }));
  ok('a file .gitattributes marks as not text is left alone, whatever else says', json(C({ gitattributes: 'none', editorconfig: 'crlf', beside: 'crlf' })) === json({ eol: null, from: '.gitattributes' }));
  ok('nothing said, nothing chosen', json(C({})) === json({ eol: null, from: '' }));
}

console.log('\nWhat is changed:');
{
  const A = L.apply;
  ok('plain LF text, the project uses CRLF: CRLF', json(A('a\nb\n', 'crlf')) === json({ text: 'a\r\nb\r\n', changed: true }));
  ok('text that carries a CR already is left as written', json(A('a\r\nb\n', 'crlf')) === json({ text: 'a\r\nb\n', changed: false }));
  ok('text with no line ending is left alone', A('one line', 'crlf').changed === false);
  ok('LF is never forced on what was written, and nothing chosen changes nothing', A('a\r\nb\r\n', 'lf').changed === false && A('a\nb\n', null).changed === false);
}

console.log('\nFound for a new file, from the project as it is:');
{
  const disk = new Map();
  const reads = [];
  const io = {
    read: async (p) => { reads.push(p); if (!disk.has(p)) throw new Error('Cannot access'); return disk.get(p); },
    list: async (d) => [...disk.keys()].filter((p) => p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/')).map((p) => ({ name: p.slice(d.length + 1), path: p, is_dir: false, size: disk.get(p).length })),
  };
  const R = '/proj';
  let got = await L.forNewFile('/proj/src/New.cs', R, io);
  ok('a project that says nothing: nothing chosen', got.eol === null, json(got));
  disk.set('/proj/src/A.cs', 'class A\r\n{\r\n}\r\n');
  disk.set('/proj/src/B.cs', 'class B\r\n{\r\n}\r\n');
  disk.set('/proj/src/notes.md', 'a\nb\n');
  got = await L.forNewFile('/proj/src/New.cs', R, io);
  ok('files of its own kind beside it, with CRLF: crlf from them', json(got) === json({ eol: 'crlf', from: 'the files beside it' }), json(got));
  disk.set('/proj/.editorconfig', '[*.cs]\nend_of_line = lf\n');
  got = await L.forNewFile('/proj/src/New.cs', R, io);
  ok('an .editorconfig beats them', json(got) === json({ eol: 'lf', from: '.editorconfig' }), json(got));
  disk.set('/proj/.gitattributes', '*.cs text eol=crlf\n');
  got = await L.forNewFile('/proj/src/New.cs', R, io);
  ok('a .gitattributes beats both', json(got) === json({ eol: 'crlf', from: '.gitattributes' }), json(got));
  got = await L.forNewFile('C:\\proj\\src\\New.cs', 'C:\\proj', { read: async (p) => (p.replace(/\\/g, '/') === 'C:/proj/.gitattributes' ? '*.cs eol=crlf\n' : Promise.reject(new Error('no'))), list: async () => [] });
  ok('Windows paths are matched the same way', json(got) === json({ eol: 'crlf', from: '.gitattributes' }), json(got));
  reads.length = 0;
  got = await L.forNewFile('/elsewhere/New.cs', R, io);
  ok('a file outside the project: nothing read, nothing chosen', got.eol === null && reads.length === 0, json(reads));
  got = await L.forNewFile('/proj/src/New.cs', '', io);
  ok('no project open: nothing chosen', got.eol === null);
  disk.clear();
  for (let i = 0; i < 9; i++) disk.set(`/proj/f${i}.cs`, 'a\r\n');
  reads.length = 0;
  await L.forNewFile('/proj/New.cs', R, io);
  ok(`at most ${L.MOST_BESIDE} files beside it are read, besides the two settings files`, reads.filter((p) => /f\d\.cs$/.test(p)).length === L.MOST_BESIDE, json(reads));
  disk.clear();
  disk.set('/proj/big.cs', 'a\r\n'.repeat(100000));
  disk.set('/proj/small.cs', 'a\n');
  got = await L.forNewFile('/proj/New.cs', R, io);
  ok('a file too large to be worth reading is passed over', json(got) === json({ eol: 'lf', from: 'the files beside it' }), json(got));
  const broken = await L.forNewFile('/proj/New.cs', R, { read: async () => { throw new Error('no'); }, list: async () => { throw new Error('no'); } });
  ok('nothing can be read: nothing chosen, and no error', broken.eol === null);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/line-endings.js)`);
process.exit(fail ? 1 : 0);
