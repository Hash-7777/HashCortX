// ==============================================================
// Swarm module-joining checks
//
// Loads the REAL src/js/swarm/bundle.js into a Node VM.
//
// Agents write modules; a single downloadable page can only run one script.
// These checks are about the two ways that can go wrong: joining files that
// should not be joined, and refusing to join files that should be. A refusal
// is the safe answer, so most of these check that an unusual shape IS refused
// rather than guessed at.
//
// Run with: npm run check:swarm-bundle
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'swarm', 'bundle.js'), 'utf8'), sandbox, { filename: 'bundle.js' });
const B = sandbox.window.HCSwarmBundle;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const set = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, { content: v }]));
const join3 = (obj, entry) => B.bundleFor(entry, set(obj));

console.log('The run that was broken now joins:');
{
  const r = join3({
    'catalogue.js': 'export const products = [1, 2];',
    'cart.js': 'class Cart {}\nexport const cart = new Cart();',
    'script.js': "import { products } from './catalogue.js';\nimport { cart } from './cart.js';\nrender(products, cart);",
  }, 'script.js');
  ok('every file is in the script', r.used.join() === 'catalogue.js,cart.js,script.js');
  ok('what it imports comes before it', r.code.indexOf('const products') < r.code.indexOf('render('));
  ok('no export is left to stop the script', !/^\s*export\b/m.test(r.code));
  ok('no import is left to stop the script', !/^\s*import\b/m.test(r.code));
  ok('what was exported is still declared', /const products = \[1, 2\];/.test(r.code) && /const cart = new Cart\(\)/.test(r.code));
  ok('the class the export depends on is kept', /class Cart \{\}/.test(r.code));
  ok('each file is named in the script', /\/\* catalogue\.js \*\//.test(r.code) && /\/\* script\.js \*\//.test(r.code));
}

console.log('\nA file that is not a module is left exactly alone:');
ok('a plain script is not touched', join3({ 'a.js': 'var a = 1;' }, 'a.js') === null);
ok('the word export inside a string is not a module', join3({ 'a.js': 'var a = "export const x";' }, 'a.js') === null);
ok('a comment about importing is not a module', join3({ 'a.js': '// import it later\nvar a = 1;' }, 'a.js') === null);

console.log('\nWhat it refuses to guess at, and says so:');
const why = (obj, entry) => (join3(obj, entry) || {}).reason || '';
ok('a package import', /cannot be joined/.test(why({ 'a.js': "import x from 'react';" }, 'a.js')));
ok('a default import of a file', /cannot be joined/.test(why({ 'a.js': "import c from './b.js';", 'b.js': 'export default 1;' }, 'a.js')));
ok('a namespace import', /cannot be joined/.test(why({ 'a.js': "import * as b from './b.js';", 'b.js': 'export const x = 1;' }, 'a.js')));
ok('an import that renames', /renames/.test(why({ 'a.js': "import { x as y } from './b.js';", 'b.js': 'export const x = 1;' }, 'a.js')));
ok('a default export', /cannot be joined/.test(why({ 'a.js': 'export default 1;' }, 'a.js')));
ok('a re-export', /cannot be joined/.test(why({ 'a.js': "export { x } from './b.js';", 'b.js': 'export const x = 1;' }, 'a.js')));
ok('a module loaded while it runs', /while it runs/.test(why({ 'a.js': "import('./b.js');\nexport const y = 1;", 'b.js': 'export const x = 1;' }, 'a.js')));
ok('an import of a file the project does not have', /not one of the files/.test(why({ 'a.js': "import { x } from './missing.js';" }, 'a.js')));
ok('files that import each other', /import each other/.test(why({
  'a.js': "import { b } from './b.js';\nexport const a = 1;",
  'b.js': "import { a } from './a.js';\nexport const b = 1;",
}, 'a.js')));
ok('a file that is not there at all', /not one of the files/.test(why({ 'a.js': 'var a = 1;' }, 'b.js')));

console.log('\nThe shapes that do join:');
ok('a bare import for its side effect', /const x = 1/.test(join3({ 'a.js': "import './b.js';\nexport const y = 2;", 'b.js': 'export const x = 1;' }, 'a.js').code));
ok('an export list on its own line is dropped', !/export/.test(join3({ 'a.js': 'const x = 1;\nexport { x };' }, 'a.js').code));
ok('an exported function keeps its body', /function f\(\) \{ return 1; \}/.test(join3({ 'a.js': 'export function f() { return 1; }' }, 'a.js').code));
ok('an exported class keeps its body', /class C \{\}/.test(join3({ 'a.js': 'export class C {}' }, 'a.js').code));
ok('an exported async function', /async function f\(\)/.test(join3({ 'a.js': 'export async function f() {}' }, 'a.js').code));
ok('a specifier written without its extension', join3({ 'a.js': "import { x } from './b';\nexport const y = 1;", 'b.js': 'export const x = 1;' }, 'a.js').used.join() === 'b.js,a.js');
ok('a file imported by two others is only in the script once', (() => {
  const r = join3({
    'base.js': 'export const base = 1;',
    'one.js': "import { base } from './base.js';\nexport const one = base;",
    'two.js': "import { base } from './base.js';\nimport { one } from './one.js';\nexport const two = one;",
  }, 'two.js');
  return r.used.join() === 'base.js,one.js,two.js' && (r.code.match(/\/\* base\.js \*\//g) || []).length === 1;
})());

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/bundle.js)`);
process.exit(fail ? 1 : 0);
