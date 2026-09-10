// ==============================================================
// Agent Swarm project-file checks
//
// Loads the REAL src/js/swarm/project-files.js, with the fence reader it uses.
//
// This reads a swarm's answer for the files a site is made of, for the preview
// and the one-page download. When it finds nothing, a site written correctly
// ends in "No HTML file found", so the checks are the ways a model writes a
// file that used to be missed, and the rules that must survive.
//
// Run with: npm run check:swarm-project-files
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });
vm.runInContext(src('js', 'swarm', 'project-files.js'), sandbox, { filename: 'project-files.js' });
const P = sandbox.window.HCSwarmProjectFiles;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const B = '`'.repeat(3);
const T = '~'.repeat(3);
const files = (text) => [...P.extractProjectFiles(text)].map(([k, v]) => `${k}=${v.content}`);

console.log('A file is found however its fence is written:');
ok('named on its fence', files(`${B}html index.html\n<p>x</p>\n${B}`).join() === 'index.html=<p>x</p>');
ok('with Windows line endings', files(`${B}html index.html\r\n<p>x</p>\r\n${B}\r\n`).join() === 'index.html=<p>x</p>');
ok('with a space after the name', files(`${B}html index.html \n<p>x</p>\n${B}`).join() === 'index.html=<p>x</p>');
ok('in a tilde fence', files(`${T}html index.html\n<p>x</p>\n${T}`).join() === 'index.html=<p>x</p>');
ok('in C++', files(`${B}c++ main.cpp\nint main(){}\n${B}`).join() === 'main.cpp=int main(){}');
ok('in C#', files(`${B}c# Program.cs\nclass P{}\n${B}`).join() === 'program.cs=class P{}');
ok('with a space where the language would be', files(`${B} index.html\n<p>x</p>\n${B}`).join() === 'index.html=<p>x</p>');
ok('the language:name form', files(`${B}js:app.js\nlet a;\n${B}`).join() === 'app.js=let a;');
ok('a "file:" comment names the file and is not left in it', files(`${B}js\n// file: app.js\nlet a;\n${B}`).join() === 'app.js=let a;');

console.log('\nThe rules the preview depends on still hold:');
ok('a plain html block becomes the page', files(`${B}html\n<p>x</p>\n${B}`).join() === 'index.html=<p>x</p>');
ok('a plain css block becomes the stylesheet', files(`${B}css\nh1{}\n${B}`).join() === 'styles.css=h1{}');
ok('a plain js block becomes the script', files(`${B}js\nlet a;\n${B}`).join() === 'app.js=let a;');
ok('a named page is not replaced by a plain html block',
  files(`${B}html index.html\n<p>named</p>\n${B}\n${B}html\n<p>plain</p>\n${B}`).join() === 'index.html=<p>named</p>');
ok('a later block with the same name wins, so a correction replaces the original',
  files(`${B}css styles.css\nold{}\n${B}\n\n${B}css styles.css\nnew{}\n${B}`).join() === 'styles.css=new{}');
ok('names are kept in lower case, which is how the preview looks them up',
  files(`${B}html Index.HTML\n<p>x</p>\n${B}`).join() === 'index.html=<p>x</p>');
ok('a file with no language takes one from its extension', P.extractProjectFiles(`${B} page.html\n<p>x</p>\n${B}`).get('page.html').lang === 'html');
ok('prose with no code gives no files', P.extractProjectFiles('Nothing to build.').size === 0);
ok('nothing gives no files', P.extractProjectFiles('').size === 0 && P.extractProjectFiles(null).size === 0);
console.log('\nA reply to a change request changes only the files it names:');
const named = (text) => [...P.extractProjectFiles(text, { guess: false })].map(([k, v]) => `${k}=${v.content}`);
ok('a named file is found', named(`${B}css styles.css\nh1{}\n${B}`).join() === 'styles.css=h1{}');
ok('a plain css example is not taken for the stylesheet', named(`${B}css\nh1{}\n${B}`).length === 0);
ok('nor a plain js example for the script', named(`${B}js\nlet a;\n${B}`).length === 0);
ok('nor a fragment of html for the page', named(`${B}html\n<p>x</p>\n${B}`).length === 0);
ok('a complete page is taken for the page', named(`${B}html\n<!doctype html>\n<html></html>\n${B}`).join() === 'index.html=<!doctype html>\n<html></html>');
ok('but never over a page it names', named(`${B}html index.html\n<p>named</p>\n${B}\n${B}html\n<html></html>\n${B}`).join() === 'index.html=<p>named</p>');

ok('the module has no fence pattern of its own', !/`{3}\(/.test(src('js', 'swarm', 'project-files.js')));

// Control: the primary pattern that stood in the mode before.
const old = /```([\w-]*)[ \t]+([^\s`'"`]+\.[\w]{1,8})\n([\s\S]*?)```/g;
ok('control: the old pattern finds no file in a Windows-line-ending answer',
  old.exec(`${B}html index.html\r\n<p>x</p>\r\n${B}`) === null);

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/project-files.js)`);
process.exit(fail ? 1 : 0);
