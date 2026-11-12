// ==============================================================
// Who uses a name — checks
//
// Loads the real src/js/code/uses.js, with the map's reading of a line
// (src/js/code/codemap.js) and the search's own place and line shapes
// (src/js/code/search.js), and holds what uses_of answers: where a name is
// defined, with its parameters, and every place that uses it, grouped by
// file and sized to the model, with a word to narrow it past the cap; never
// a longer name that only starts the same way.
//
// Run with: npm run check:code-uses
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { console };
box.window = box;
vm.createContext(box);
for (const f of ['codemap.js', 'search.js']) vm.runInContext(src('js', 'code', f), box, { filename: f });
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'uses.js'), box, { filename: 'uses.js' });
const U = box.HCCodeUses;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const R = '/work/tidewater-inn';
const at = (path, line_no, line) => ({ path: `${R}/${path}`, line_no, line });
const found = [
  at('server/rooms.py', 12, 'def nightly_rate(room, season):'),
  at('server/rooms.py', 40, '    base = nightly_rate(room, "low")'),
  at('server/prices.py', 7, 'from rooms import nightly_rate'),
  at('server/prices.py', 31, '        price = nightly_rate(r, s) * nights'),
  at('server/report.py', 3, 'total = nightly_rate_total(rows)'),
  at('web/booking.js', 9, '  const shown = await pricing.nightly_rate(id);'),
];

console.log('\nWhat uses_of answers:');
{
  const said = U.answer('nightly_rate', found, { root: R, limit: { lines: 60, files: 30 } });
  ok('it says where the name is defined, with its parameters, from the project folder', /^uses_of "nightly_rate": defined in 1 place, used in 4 places in 3 files\./.test(said) && /\nDefined:\n {2}server\/rooms\.py:12 {2}nightly_rate\(room, season\)\n/.test(said), said);
  ok('then every place that uses it, grouped by file, by line', /\nUsed:\nserver\/rooms\.py\n {2}40: base = nightly_rate\(room, "low"\)\nserver\/prices\.py\n {2}7: from rooms import nightly_rate\n {2}31: price = nightly_rate\(r, s\) \* nights\nweb\/booking\.js\n {2}9: const shown = await pricing\.nightly_rate\(id\);/.test(said), said);
  ok('a longer name that only starts the same way is not a use', !said.includes('nightly_rate_total'));
  ok('a method is asked for by its own name too: Rooms.nightly_rate finds the same', U.answer('Rooms.nightly_rate', found, { root: R }).startsWith('uses_of "Rooms.nightly_rate": defined in 1 place'));
  ok('the whole path is never shown', !said.includes(R));
}

console.log('\nPast what the model can use:');
{
  const many = Array.from({ length: 30 }, (_, i) => at(`src/part${i % 6}.js`, i + 1, `  draw(${i});`));
  const said = U.answer('draw', many, { root: R, limit: { lines: 8, files: 3 } });
  ok('no more lines and files than the model is sized for', (said.match(/^ {2}\d+: /gm) || []).length <= 8 && (said.match(/^src\/part\d\.js$/gm) || []).length <= 3, said);
  ok('and the rest counted, with how to narrow it', /\n\[22 more places in 6 files not shown: narrow it with grep_code in one folder or with file_ext, or read the files above\.\]$/.test(said), said.split('\n').at(-1));
  const stopped = Array.from({ length: U.SEARCH_STOPS }, (_, i) => at(`a${i % 4}.js`, i + 1, 'x = draw()'));
  ok(`a search that stopped at ${U.SEARCH_STOPS} matches says the name is too common to list whole`, /The search stopped at 300 matches: this name is common, so not every use is here\./.test(U.answer('draw', stopped, { root: R, limit: { lines: 8, files: 3 } })));
}

console.log('\nWhat it will not answer:');
{
  ok('a name not found says where it looked', U.answer('missing_one', found, { root: R }) === 'uses_of "missing_one": not found in the project\'s files. Folders of dependencies and build output, and what the project ignores, are not searched.');
  ok('found only as part of longer names is not found', /not found in the project's files/.test(U.answer('nightly', found, { root: R })));
  for (const bad of ['', 'two words', 'a(b)', 'x;rm', '.start', 'end.', null]) {
    ok(`not a name: ${JSON.stringify(bad)}`, U.isName(bad) === false && /^uses_of needs one name as code writes it/.test(U.answer(bad, found, { root: R })));
  }
  ok('names as code writes them are', ['nightly_rate', 'getNightlyRate', '$el', 'Rooms.rate', 'Widget::draw', 'v2'].every((n) => U.isName(n)));
}

console.log('\nThe uses_of tool in HashCoder:');
{
  const sb = { console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, RegExp };
  sb.window = sb;
  const asked = [], searched = [];
  sb.HC = {
    guard: { projectRoot: () => R, request: async (...a) => { asked.push(a); return true; }, allowedWithoutAsking: async (action, target) => String(target).startsWith(R) },
    invoke: async (cmd, a) => { if (cmd === 'fs_grep') { searched.push(a); return found; } return null; },
  };
  vm.createContext(sb);
  for (const f of [['js', 'text-safety.js'], ['js', 'secret-shapes.js'], ['js', 'code', 'search.js'], ['js', 'code', 'paths.js'], ['js', 'code', 'patch.js'], ['js', 'code', 'codemap.js'], ['js', 'code', 'uses.js'], ['platform', 'tauri', 'hashcoder.js']]) vm.runInContext(src(...f), sb, { filename: f.at(-1) });
  const code = sb.HC.code;
  const tool = code.TOOL_DEFINITIONS.find((t) => t.name === 'uses_of');
  ok('it is a tool that takes one name', !!tool && Object.keys(tool.parameters).join() === 'name' && /defined/.test(tool.description) && /every place/.test(tool.description));
  const said = tool ? await tool.fn({ name: 'Rooms.nightly_rate' }) : '';
  ok('it answers from one search of the project for the name\'s own part, with no question to the person', /^uses_of "Rooms\.nightly_rate": defined in 1 place, used in 4 places in 3 files\./.test(said) && searched.length === 1 && searched[0].pattern === 'nightly_rate' && searched[0].dir === R && asked.length === 0, JSON.stringify({ said: said.slice(0, 80), searched, asked: asked.length }));
  sb.HC.guard.projectRoot = () => '';
  const none = tool ? await tool.fn({ name: 'nightly_rate' }) : '';
  ok('with no project open it says so and searches nothing', /needs a project open/.test(none) && searched.length === 1, none);
  sb.HC.guard.projectRoot = () => R;
  const list = code.toolList();
  const names = (size) => code.toolsFor(size, list, false).map((t) => t.function.name);
  ok('offered to mid-sized, large and cloud models, not to small ones', names('mid').includes('uses_of') && names('full').includes('uses_of') && !names('small').includes('uses_of'));
  const mid = code.toolsFor('mid', list, false).find((t) => t.function.name === 'uses_of');
  ok('a mid-sized model is told of it in a few words, its name argument too', mid && mid.function.description === 'Where a name is defined and every place that uses it.' && /such as getNightlyRate/.test(mid.function.parameters.properties.name.description), JSON.stringify(mid && mid.function));
  ok('the run treats it as a read of the project', /uses_of: 'read'/.test(src('js', 'agent-policy.js')) && /LOCAL_READS = new Set\(\[[^\]]*'uses_of'/.test(src('js', 'code', 'calls.js')) && /OWN_TOOLS = new Set\(\[[^\]]*'uses_of'/.test(src('js', 'code', 'facts.js')));
  ok('and shows it as a Finding step naming who is looked for, with words while it reads the answer', /uses_of: 'FIND'/.test(src('js', 'code', 'steps.js')) && /if \(name === 'uses_of'\) return a\.name \? `who uses \$\{a\.name\}` : '';/.test(src('js', 'code', 'steps.js')) && /uses_of: \(\) => 'Going through who uses it'/.test(src('js', 'code', 'live.js')));
  ok('the instructions name it where they say to read the files that use what is changed', /uses_of names them/.test(src('platform', 'tauri', 'hashcoder.js')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/uses.js)`);
process.exit(fail ? 1 : 0);
