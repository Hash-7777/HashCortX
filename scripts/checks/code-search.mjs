// ============================================================
// What a search inside the project's files tells the model —
// src/js/code/search.js, and where grep_code and the native
// search use it.
// Run with: npm run check:code-search
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'search.js'), sandbox, { filename: 'search.js' });
vm.runInContext(src('js', 'agent-context.js'), sandbox, { filename: 'agent-context.js' });
const S = sandbox.window.HCCodeSearch;
const C = sandbox.window.HCAgentContext;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const root = '/work/lantern-lane';
const hit = (file, n, line) => ({ path: `${root}/${file}`, line_no: n, line, context: `${n - 1} before\n${n} ${line}\n${n + 1} after` });

console.log('\nA few lines: each shown, grouped by file:');
{
  const list = [hit('server/rooms.py', 14, '    def nightly_rate(self, room):'), hit('server/rooms.py', 52, '        total = self.nightly_rate(room) * nights'), hit('web/src/booking.js', 8, "\tconst rate = await fetchRate('nightly_rate');")];
  const out = S.shape(list, { pattern: 'nightly_rate', root, dir: root, limit: { lines: 25, files: 12 } });
  ok('it starts with what was searched and how much was found', out.startsWith('grep_code "nightly_rate": 3 lines in 2 files.'), out);
  ok('each file is named once, from the project folder, never from the top of the disk', /\nserver\/rooms\.py\n/.test(out) && /\nweb\/src\/booking\.js\n/.test(out) && !out.includes(root), out);
  ok('each line is its number and its text, indent and tabs left off', out.includes('  14: def nightly_rate(self, room):') && out.includes("  8: const rate = await fetchRate('nightly_rate');"), out);
  ok('the lines around a match are not repeated', !/before|after/.test(out));
  ok('it says how to see more of a line', /read_file start_line and end_line/.test(out));
  const inSub = S.shape(list.slice(0, 1), { pattern: 'x', root, dir: `${root}/server`, limit: { lines: 25, files: 12 } });
  ok('a search of one folder says which', inSub.startsWith('grep_code "x" under server: 1 line in 1 file.'), inSub);
  const long = S.shape([hit('a.js', 1, 'x'.repeat(400))], { pattern: 'x', root });
  ok('a long line is cut to a readable length', long.split('\n')[2].length < S.LINE_CHARS + 12, long);
  const win = S.shape([{ path: 'C:\\work\\shop\\src\\cart.js', line_no: 3, line: 'total' }], { pattern: 'total', root: 'C:\\work\\shop' });
  ok('a Windows path is written from the project folder too', /\nsrc\/cart\.js\n/.test(win), win);
}

console.log('\nToo many lines: the files, the most first, and how to narrow it:');
{
  const list = [];
  for (let f = 0; f < 30; f++) for (let n = 1; n <= (f === 7 ? 9 : 2); n++) list.push(hit(`server/handlers/h${String(f).padStart(2, '0')}.py`, n * 10, 'session = get_session()'));
  const out = S.shape(list, { pattern: 'session', root, limit: { lines: 25, files: 12 } });
  const rows = out.split('\n').filter((l) => /^  server\//.test(l));
  ok('it says there are too many to show each line', /: 67 lines in 30 files\. Too many to show each line/.test(out), out.split('\n')[0]);
  ok('the files are listed with how many lines each and the first line, the most first', rows.length === 12 && rows[0] === '  server/handlers/h07.py: 9 lines, first at 10' && /: 2 lines, first at 10$/.test(rows[1]), rows.slice(0, 2).join(' | '));
  ok('the rest are counted, not named', /\n  and 18 more files\./.test(out));
  ok('it says how to narrow the search', /Narrow the search to see the lines: set dir to the one folder that matters, set file_ext, or search a longer, more exact pattern/.test(out));
  ok('no line of code is shown past the limit', !/get_session/.test(out));
  const full = S.shape(Array.from({ length: 300 }, (_, i) => hit(`f${i % 50}.js`, i + 1, 'x')), { pattern: 'x', root });
  ok('a search that stopped at its limit says "at least"', /: at least 300 lines in 50 files\./.test(full), full.split('\n')[0]);
}

console.log('\nWhat is passed on as it was:');
{
  const none = { matches: [], note: 'No line in these files contains "x".' };
  ok('an answer that found nothing keeps its note', S.shape(none, { pattern: 'x' }) === none);
  ok('an empty list, and an error, are passed on', Array.isArray(S.shape([], {})) && S.shape('error', {}) === 'error');
}

console.log('\nSized to the model:');
{
  const at = (size, local) => C.optionsFor(size, local);
  ok('a small model is shown fewest lines, a cloud model most', at('small').searchLines < at('mid').searchLines && at('mid').searchLines < at('full', true).searchLines && at('full', true).searchLines < at('full', false).searchLines);
  ok('every size names fewer files than it shows lines', ['small', 'mid'].every((s) => at(s).searchFiles < at(s).searchLines) && at('full', true).searchFiles < at('full', true).searchLines);
  const mode = src('modes', 'code', 'mode.js');
  ok('the Coder panel sets the limit for the model in use', /HC\.code\.searchLimit = \{ lines: sized\.searchLines, files: sized\.searchFiles \}/.test(mode));
}

console.log('\nWhere it is used:');
{
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('grep_code gives its matches through it, with the project folder and the limit', /HCCodeSearch\.shape\(r, \{ pattern: p\.pattern, root: HC\.guard\?\.projectRoot\?\.\(\) \|\| '', dir: p\.dir, limit: HC\.code\.searchLimit \}\)/.test(tools));
  ok('both searches pass the folders the project ignores', /HC\.invoke\('fs_grep', \{ dir, pattern, fileExt, skip \}\)/.test(tools) && /HC\.invoke\('fs_grep', \{ dir, pattern, fileExt, regex: true, skip \}\)/.test(tools));
  ok('those are read from the top .gitignore, quietly, once a project', /HC\.code\.ignoredFolders = async/.test(tools) && /HCCodeMap\.ignoredBy\(await HC\.code\.readQuietly\(/.test(tools) && /if \(ignoredAt\.root === root\) return ignoredAt\.names;/.test(tools));
  const rust = src('..', 'src-tauri', 'src', 'commands', 'fs.rs');
  const skipRust = (rust.match(/const SKIP_DIRS: &\[&str\] = &\[([\s\S]*?)\];/) || [])[1] || '';
  const rustNames = [...skipRust.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort().join();
  const map = src('js', 'code', 'codemap.js');
  const jsNames = [...((map.match(/const SKIP = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort().join();
  ok('the native search leaves out the same folders as the project map', rustNames && rustNames === jsNames, `${rustNames} / ${jsNames}`);
  ok('the native search takes the names to skip, and leaves out generated and very large files', /skip: Option<Vec<String>>/.test(rust) && /fn generated_file\(name: &str\) -> bool/.test(rust) && /const GREP_FILE_BYTES: u64 = 1_000_000;/.test(rust));
  ok('the search tool says what it leaves out and how it answers', /grouped by file/.test(tools) && /Folders of dependencies and build output, and what the project ignores, are left out unless dir is inside one/.test(tools));
  const boot = src('boot.js');
  ok('loaded before the Coder mode, beside the other helpers for what tools give back', boot.indexOf("'/js/code/search.js'") > boot.indexOf("'/js/code/pipe.js'") && boot.indexOf("'/js/code/pipe.js'") > 0);
  ok('pure: no program, no file, no network', !/\binvoke\(|HC\.invoke|fetch\(|XMLHttpRequest|require\(|import\(|localStorage/.test(src('js', 'code', 'search.js')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/search.js)`);
process.exit(fail ? 1 : 0);
