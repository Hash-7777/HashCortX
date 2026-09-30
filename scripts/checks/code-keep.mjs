// ============================================================
// What an edit took away that the request did not ask about —
// src/js/code/keep.js, and where HashCoder says it.
// Run with: npm run check:code-keep
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(src('js', 'code', 'codemap.js'), box, { filename: 'codemap.js' });
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'keep.js'), box, { filename: 'keep.js' });
const K = box.window.HCCodeKeep;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('Code:');
{
  const before = 'export function renderHeader() {}\nexport function renderFooter() {}\nfunction total(a, b) {}\nclass Cart {}\n';
  const after = 'export function renderHeader() {}\nfunction total(a, b) {}\n';
  const said = K.note('app.js', before, after, 'make the header bigger');
  ok('a function and a class gone, and not named in the request, are said, with a request to put them back',
    said === 'This change removed renderFooter, class Cart from app.js, which the request does not name. If that was not asked for, put it back now.', said);
  ok('one the request names, even by a word of its name, is not', K.note('app.js', before, after, 'remove the footer and the cart') === '');
  ok('a rename the request asks for is not', K.note('user.js', 'function getUsr(id) {}\n', 'function getUser(id) {}\n', 'rename getUsr to getUser') === '');
  ok('nothing taken away, nothing said', K.note('app.js', before, `${before}function more() {}\n`, 'add more') === '');
  ok('a new file takes nothing away', K.note('app.js', null, after, 'x') === '' && K.removed('app.js', null, after).length === 0);
  ok('a Python function', /removed parse\b/.test(K.note('p.py', 'def parse(text):\n    pass\ndef main():\n    pass\n', 'def main():\n    pass\n', 'tidy main')));
}

console.log('\nA page:');
{
  const before = '<main><section id="hero">A</section><section id="products"><table><tr><td>1</td></tr></table></section><form id="contact"></form><footer id="site-footer"></footer></main>';
  const after = '<main><section id="hero">B</section></main>';
  const said = K.note('index.html', before, after, 'make the hero text bigger');
  ok('ids and the sections, tables and forms gone are said, the rest counted', /#products/.test(said) && /#contact/.test(said) && /#site-footer/.test(said) && /<section>/.test(said) && /<table>/.test(said) && /<form>/.test(said) && /and 1 more from index\.html/.test(said), said);
  ok('one of two sections gone is said once, and the section kept is not', (said.match(/<section>/g) || []).length === 1 && !/#hero/.test(said));
  ok('a footer the request asks to remove is not said', !/footer/.test(K.note('index.html', before, after, 'remove the footer, the contact form and the products table')));
}

console.log('\nA README:');
{
  const said = K.note('README.md', '# App\n## Install\n![Screenshot](docs/shot.png)\n<img src="docs/logo.svg">\n## Usage\n', '# App\n## Usage\n', 'fix the usage section');
  ok('a heading and a picture gone are said, by its address and its words', /the "Install" heading/.test(said) && /the picture docs\/shot\.png \("Screenshot"\)/.test(said) && /the picture docs\/logo\.svg/.test(said), said);
  ok('a picture the request asks to replace is not', !/shot/.test(K.note('README.md', '![Screenshot](docs/shot.png)\n', '![Screenshot](docs/new.png)\n', 'replace the screenshot')));
}

console.log('\nLimits:');
{
  const many = Array.from({ length: 12 }, (_, i) => `function part${i}Thing() {}`).join('\n');
  const said = K.note('a.js', many, '', 'x');
  ok(`no more than ${K.MOST_NAMED} named, the rest counted`, /and 6 more from a\.js/.test(said) && (said.match(/part\d+Thing/g) || []).length === K.MOST_NAMED, said);
  ok('a file of no kind it reads takes nothing away', K.note('notes.txt', 'a\nb\n', '', 'x') === '');
}

console.log('\nHashCoder:');
{
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('every write says what it took away, beside the bracket check, with the request\'s words',
    /const removed = window\.HCCodeKeep\?\.note\(path\.split\(\/\[\\\\\/\]\/\)\.pop\(\) \|\| path, before, ends\.text, HC\.code\.request\) \|\| '';/.test(tools) && /\.\.\.\(removed \? \{ removed \} : \{\}\)/.test(tools));
  const mode = src('modes', 'code', 'mode.js');
  ok('the request\'s words are kept for that request', /HC\.code\.asks = asks; HC\.code\.request = task; \}/.test(mode));
  ok('the second look looks for what was removed without being asked', /above all anything removed or rewritten that it did not ask to change/.test(src('js', 'code', 'review.js')));
  const verify = src('js', 'code', 'verify.js');
  ok('and so do the checks against the request, whole or ask by ask', /Put back anything you removed that it did not ask to remove\./.test(verify) && /put back anything you removed that no ask asked to remove\./.test(verify));
  const boot = src('boot.js');
  ok('it is loaded after the definitions it reads and before the modes', boot.indexOf("'/js/code/codemap.js'") < boot.indexOf("'/js/code/keep.js'") && boot.indexOf("'/js/code/keep.js'") < boot.indexOf("'/modes/boot.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/keep.js)`);
process.exit(fail ? 1 : 0);
