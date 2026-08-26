// ==============================================================
// Virtual OS answer parsing — checks
//
// Loads the REAL src/js/vos/answer.js. This decides whether anything usable
// comes out of a generation: a model is asked for a project and returns an
// explanation with some code in it, and these four attempts are what turn that
// into files.
//
// The cases below are what models actually send, not what they are asked to
// send. Each tier exists because a real answer arrived in that shape, and
// refusing one is throwing away a project that was written correctly and
// labelled carelessly.
//
// Run with: npm run check:vos-answer
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [['src', 'js', 'vos', 'tree.js'], ['src', 'js', 'vos', 'answer.js']]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel.at(-1) });
}
const A = sandbox.window.HCVosAnswer;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const F = '```';
const paths = (files) => files.map((f) => f.path).join(', ');

console.log('\nThe way it asks for files is the way it reads them:');
{
  const answer = `Here is your site.

${F}html index.html
<h1>Hi</h1>
${F}

${F}css styles.css
body { margin: 0 }
${F}
`;
  const files = A.extractFiles(answer);
  ok('both files are found', files.length === 2, paths(files));
  ok('with their paths', paths(files) === 'index.html, styles.css');
  ok('and their contents', files[0].content === '<h1>Hi</h1>');
  ok('the prose around them is not a file', !paths(files).includes('site'));
  ok('a nested path is kept whole',
    A.extractFiles(`${F}js src/app/main.js\nconsole.log(1);\n${F}`)[0].path === 'src/app/main.js');
}

console.log('\nA path in a comment on the first line is read too:');
{
  // What a model does when it forgets the requested format but still labels
  // its work — throwing this away is throwing away a correct project.
  const slashes = `${F}html\n// shop/index.html\n<h1>Shop</h1>\n${F}`;
  ok('a slash comment', A.extractFiles(slashes)[0]?.path === 'shop/index.html');
  const markup = `${F}html\n<!-- pages/about.html -->\n<p>About</p>\n${F}`;
  ok('a markup comment', A.extractFiles(markup)[0]?.path === 'pages/about.html');
  const hash = `${F}python\n# tools/run.py\nprint(1)\n${F}`;
  ok('a hash comment', A.extractFiles(hash)[0]?.path === 'tools/run.py');
  ok('and the comment line is not left in the file',
    !A.extractFiles(slashes)[0].content.includes('shop/index.html'));
}

console.log('\nAnd a name written above the fence:');
{
  ok('in bold', A.extractFiles(`**app/main.js**\n${F}js\nlet a = 1;\n${F}`)[0]?.path === 'app/main.js');
  ok('as a heading', A.extractFiles(`### index.html\n${F}html\n<p>x</p>\n${F}`)[0]?.path === 'index.html');
  ok('in backticks', A.extractFiles('`notes.md`\n' + F + '\nhello\n' + F)[0]?.path === 'notes.md');
}

console.log('\nCode with no name at all is still recovered:');
{
  // The model ignored the format completely. Naming by language is a guess,
  // and it is the difference between somebody getting their code in the wrong
  // filenames and getting nothing.
  const answer = `Sure:\n\n${F}html\n<h1>A</h1>\n${F}\n\n${F}css\nbody{}\n${F}\n\n${F}js\nlet x;\n${F}`;
  const files = A.extractFiles(answer);
  ok('every fence becomes a file', files.length === 3, paths(files));
  ok('named by what language it is', paths(files) === 'index.html, styles.css, app.js');

  // Two blocks of one language must not overwrite each other.
  const two = `${F}css\na{}\n${F}\n${F}css\nb{}\n${F}`;
  const numbered = A.extractFiles(two);
  ok('a second block of the same language gets its own name',
    numbered.length === 2 && numbered[0].path !== numbered[1].path, paths(numbered));
  ok('and the extension survives the numbering',
    numbered.every((f) => f.path.endsWith('.css')), paths(numbered));

  ok('a language nobody mapped still becomes a file',
    A.extractFiles(`${F}rust\nfn main(){}\n${F}`)[0]?.path === 'file.rust');
  ok('and no language at all still does',
    A.extractFiles(`${F}\nplain text\n${F}`)[0]?.path === 'file.txt');
  ok('an empty fence is not a file', A.extractFiles(`${F}js\n\n${F}`).length === 0);
}

console.log('\nThe better answer wins over the worse one:');
{
  // A properly labelled answer must not also be read by the looser attempts,
  // or one file would arrive twice under two names.
  const answer = `${F}html index.html\n<h1>Hi</h1>\n${F}`;
  const files = A.extractFiles(answer);
  ok('a labelled fence is read once, not once per attempt', files.length === 1, paths(files));
  ok('and by its real name rather than by its language', files[0].path === 'index.html');
}

console.log('\nWhat is not a file is not treated as one:');
{
  ok('prose with no code in it gives nothing', A.extractFiles('I cannot build that.').length === 0);
  ok('nothing at all gives nothing', A.extractFiles('').length === 0 && A.extractFiles(null).length === 0);
  // A name with no extension is a sentence, not a path.
  ok('a fence labelled with a sentence is not named after it',
    A.extractFiles(`${F}\nsome text\n${F}`)[0]?.path === 'file.txt');
  // The same file twice in one answer is one file.
  const twice = `${F}html index.html\n<p>first</p>\n${F}\n${F}html index.html\n<p>second</p>\n${F}`;
  const once = A.extractFiles(twice);
  ok('the same path twice is kept once', once.length === 1);
  ok('and it is the first one, not the last', once[0].content === '<p>first</p>');
  // A path that tries to climb out is flattened by the same rule the rest of
  // the mode uses.
  ok('a path climbing out of the project is brought back in',
    A.extractFiles(`${F}js ../../etc/evil.js\nx\n${F}`)[0]?.path === 'etc/evil.js');
}

console.log('\nA project is named from what was asked for:');
{
  ok('an action verb is dropped', A.inferProjectName('build a todo app') === 'todo');
  ok('and filler words', A.inferProjectName('create a simple modern portfolio website') === 'portfolio');
  ok('the generic ending is dropped', A.inferProjectName('a recipe website') === 'recipe');
  ok('at most three words are kept',
    A.inferProjectName('an online bookshop for rare first editions').split('-').length <= 3);
  ok('only the first sentence is read',
    !A.inferProjectName('build a calculator. It should have a dark theme.').includes('dark'));
  ok('the result is usable as a name', /^[a-z0-9-]+$/.test(A.inferProjectName('Build A Shop!')));
  ok('nothing usable still gets a name',
    A.inferProjectName('') === 'project' && A.inferProjectName('a website') === 'project');
}

console.log('\nA file says what kind of thing it is:');
{
  ok('a folder is a folder', A.kindLabel({ type: 'folder', name: 'src' }) === 'Folder');
  ok('a stylesheet is named as one', A.kindLabel({ type: 'file', name: 'a.css' }) === 'CSS stylesheet');
  ok('the case of the extension makes no difference',
    A.kindLabel({ type: 'file', name: 'A.CSS' }) === 'CSS stylesheet');
  ok('something unknown is still described', A.kindLabel({ type: 'file', name: 'a.xyz' }) === 'Document');
  ok('a file with no extension is too', A.kindLabel({ type: 'file', name: 'LICENSE' }) === 'Document');
  ok('and nothing is nothing', A.kindLabel(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/vos/answer.js)\n`);
process.exit(fail === 0 ? 0 : 1);
