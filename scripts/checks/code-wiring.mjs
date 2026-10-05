// ==============================================================
// Files that use each other, joined up — checks
//
// Loads the REAL src/js/code/wiring.js, with the reading of definitions in
// src/js/code/merge.js, and holds that in the files a run changed it finds a
// function called from another file without being loaded, a name taken that
// is not exported, and a loaded file that exports nothing, each with the line
// that joins it up; and that joined-up files, untouched files, ES modules and
// the language's own names are left alone.
//
// Run with: npm run check:code-wiring
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'merge.js'), sandbox, { filename: 'merge.js' });
vm.runInContext(src('js', 'code', 'wiring.js'), sandbox, { filename: 'wiring.js' });
const W = sandbox.window.HCCodeWiring;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const broken = [
  { path: 'src/validate.js', text: 'function isValidEmail(email) {\n  return /@/.test(email);\n}\n' },
  { path: 'src/signup.js', text: 'function signupErrors(form) {\n  return isValidEmail(form.email) ? [] : ["email"];\n}\nmodule.exports = { signupErrors };\n' },
  { path: 'src/invite.js', text: "const { isValidEmail, isAllowed } = require('./validate');\nfunction invitable(list) {\n  return list.filter((e) => isValidEmail(e));\n}\nmodule.exports = { invitable };\n" },
  { path: 'test/signup.test.js', text: "const { signupErrors } = require('../src/signup');\nsignupErrors({ email: 'a@b' });\n" },
];

console.log('What is not joined up:');
{
  const g = W.gaps(broken, ['src/validate.js', 'src/signup.js', 'src/invite.js']);
  const say = g.map((x) => x.say).join('\n');
  ok('a file that calls a function another defines, without loading it, with the line that loads it', /src\/signup\.js calls isValidEmail, which src\/validate\.js defines, without loading it: add const \{ isValidEmail \} = require\('\.\/validate'\);/.test(say), say);
  ok('a file loaded that exports nothing, with what to export', /src\/validate\.js exports nothing, and src\/invite\.js loads it: add module\.exports = \{ isValidEmail \};/.test(say), say);
  const half = W.gaps([{ path: 'src/validate.js', text: 'function isValidEmail() {}\nmodule.exports = { isValidEmail };\n' }, broken[2]], ['src/invite.js']);
  ok('a name taken that the file does not export', half.length === 1 && /takes isAllowed from src\/validate\.js, which does not export it/.test(half[0].say), half.map((x) => x.say).join());
  ok('the note lists each, and says to keep the rest as it is', /^Note from HashCortX, not from the person: the files you changed use each other, and are not joined up:\n- /.test(W.note(g).message) && W.note(g).kind === 'wiring' && W.note([]) === null);
}

{
  const g = W.gaps([{ path: 'src/clamp.js', text: 'function clamp(v) { return v; }\nmodule.exports = { clamp };\n' }, { path: 'test/clamp.test.js', text: "const clamp = require('../src/clamp');\nclamp(1);\n" }], ['test/clamp.test.js']);
  ok('a file loaded whole and called as a function, when it exports an object of names, with the line to write instead', g.length === 1 && /calls clamp\(\.\.\.\), but src\/clamp\.js exports an object holding clamp: write const \{ clamp \} = require\('\.\.\/src\/clamp'\);/.test(g[0].say), g.map((x) => x.say).join());
  ok('...not when the file exports the function itself', W.gaps([{ path: 'a.js', text: 'function go() {}\nmodule.exports = go;\n' }, { path: 'b.js', text: "const go = require('./a');\ngo();\n" }], ['b.js']).length === 0);
}

console.log('\nWhat is left alone:');
{
  const fixed = [
    { path: 'src/validate.js', text: 'function isValidEmail(email) {\n  return /@/.test(email);\n}\nmodule.exports = { isValidEmail };\n' },
    { path: 'src/signup.js', text: "const { isValidEmail } = require('./validate');\nfunction signupErrors(form) {\n  return isValidEmail(form.email) ? [] : ['email'];\n}\nmodule.exports = { signupErrors };\n" },
  ];
  ok('files joined up have no gaps', W.gaps(fixed, ['src/validate.js', 'src/signup.js']).length === 0);
  ok('files the run did not change are not looked at', W.gaps(broken, ['README.md']).length === 0);
  ok('a module loaded whole and called through is joined up', W.gaps([{ path: 'a.js', text: 'function go() {}\nmodule.exports = { go };\n' }, { path: 'b.js', text: "const a = require('./a');\na.go();\n" }], ['b.js']).length === 0);
  ok('ES modules are not read as CommonJS', W.gaps([{ path: 'a.js', text: 'export function go() {}\n' }, { path: 'b.js', text: "import { go } from './a.js';\ngo();\n" }], ['b.js']).length === 0);
  ok('a call in a comment or a string is no call', W.gaps([{ path: 'a.js', text: 'function go() {}\nmodule.exports = { go };\n' }, { path: 'b.js', text: "// go() later\nconst s = 'go()';\n" }], ['b.js']).length === 0);
  ok('a name two files define has no one owner, and is left alone', W.gaps([{ path: 'a.js', text: 'function go() {}\n' }, { path: 'c.js', text: 'function go() {}\n' }, { path: 'b.js', text: 'go();\n' }], ['b.js']).length === 0);
}

console.log('\nPaths as require writes them:');
ok('from the same folder, from a deeper one, and from a sibling', W.relative('src/signup.js', 'src/validate.js') === './validate' && W.relative('test/a.test.js', 'src/a.js') === '../src/a' && W.relative('index.js', 'lib/x.js') === './lib/x');
ok('a require finds the project file it names', W.target('src/invite.js', './validate', ['src/validate.js']) === 'src/validate.js' && W.target('test/t.js', '../src/a', ['src/a.js']) === 'src/a.js' && W.target('a.js', 'express', ['a.js']) === '');

console.log('\nIt is used:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder reads the project before finishing and sends a run back with the gaps in the files it changed', /W\.note\(W\.gaps\(files, proof\.changed\.map\(/.test(mode) && /\(await namedLook\(finalText\)\) \|\| \(await projectLook\(\)\)/.test(mode));
  const boot = src('boot.js');
  ok('it loads after the reading of definitions it uses', boot.indexOf("'/js/code/wiring.js'") > boot.indexOf("'/js/code/merge.js'") && boot.indexOf("'/js/code/wiring.js'") < boot.indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:code-wiring/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/wiring.js)`);
process.exit(fail ? 1 : 0);
