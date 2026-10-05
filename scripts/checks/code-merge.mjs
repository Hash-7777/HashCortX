// ==============================================================
// A part of a file, fitted into the whole — checks
//
// Loads the REAL src/js/code/merge.js and holds that a model's answer holding
// some of a file's definitions is put in place of those definitions and of
// nothing else; that a new definition goes before the exports or the main
// guard; that the modules it loads and the names it exports join the file's
// own; and that a whole file, or a part with no definitions, is left alone.
//
// Run with: npm run check:code-merge
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
const M = sandbox.window.HCCodeMerge;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const basket = [
  "const { discountFor } = require('./codes');",
  '',
  'function createBasket() {',
  '  return { items: [], codes: [] };',
  '}',
  '',
  '// Records a code the customer entered.',
  'function applyCode(basket, code) {',
  '  if (discountFor(code) > 0) basket.codes.push(code);',
  '  return basket;',
  '}',
  '',
  'const total = (b) =>',
  '  b.items.reduce((s, i) => s + i.price, 0);',
  '',
  'class Till {',
  '  ring() { return "}"; }',
  '}',
  '',
  'module.exports = { createBasket, applyCode, total, Till };',
  '',
].join('\n');

console.log('The definitions in a file:');
{
  const d = M.definitions(basket, 'js');
  ok('functions, an arrow over two lines and a class, each to its end', d.map((x) => x.name).join() === 'createBasket,applyCode,total,Till', d.map((x) => x.name).join());
  ok('a bracket inside a string does not end a definition early', /ring\(\) \{ return "\}"; \}\n\}/.test(basket.slice(d[3].start, d[3].end)));
  ok('the arrow that goes on to the next line is one definition', basket.slice(d[2].start, d[2].end).includes('reduce'));
  const py = 'import re\n\n\ndef a(x):\n    return x\n\n\n@cache\ndef b(y):\n    if y:\n        return 1\n    return 2\n\n\nclass C:\n    pass\n';
  ok('in Python, defs and classes to the next line at the margin', M.definitions(py, 'py').map((x) => x.name).join() === 'a,b,C');
  ok('the language is read from the file name', M.langOf('src/a.mjs') === 'js' && M.langOf('a.ts') === 'js' && M.langOf('t.py') === 'py' && M.langOf('a.css') === '');
}

console.log('\nA part, fitted in:');
{
  const part = 'function applyCode(basket, code) {\n  if (discountFor(code) > 0 && !basket.codes.includes(code)) basket.codes.push(code);\n  return basket;\n}\n';
  const out = M.fit(basket, part, 'src/basket.js');
  ok('the definition it gives replaces the one of its name', /!basket\.codes\.includes\(code\)/.test(out) && (out.match(/function applyCode/g) || []).length === 1);
  ok('and everything else stays exactly as it was', out.replace(part.trimEnd(), 'X') === basket.replace(basket.slice(M.definitions(basket, 'js')[1].start, M.definitions(basket, 'js')[1].end).trimEnd(), 'X'));
  ok('the comment above it stays', /\/\/ Records a code the customer entered\.\nfunction applyCode/.test(out));
  const added = M.fit(basket, "const { fee } = require('./fees');\nfunction withFee(b) {\n  return total(b) + fee;\n}\nmodule.exports = { withFee };\n", 'basket.js');
  ok('a new definition goes before the exports', added.indexOf('function withFee') < added.indexOf('module.exports') && added.indexOf('function withFee') > added.indexOf('class Till'));
  ok('...the module it loads joins the others', /require\('\.\/codes'\);\nconst \{ fee \} = require\('\.\/fees'\);/.test(added));
  ok('...and the names it exports join the file\'s own', /module\.exports = \{ createBasket, applyCode, total, Till, withFee \};/.test(added));
  const py = '"""Times."""\n\n\ndef parse_clock(text):\n    return 1\n\n\nif __name__ == "__main__":\n    print(parse_clock("1"))\n';
  const pyOut = M.fit(py, 'def parse_duration(text):\n    return 2\n', 'timeparse.py');
  ok('in Python a new definition goes before the main guard, two lines apart', /return 1\n\n\ndef parse_duration\(text\):\n    return 2\n\n\nif __name__/.test(pyOut), pyOut);
}

console.log('\nWhat is not a part:');
ok('a whole file, holding every definition, is not fitted', M.fit(basket, basket.replace('push(code)', 'push(code.trim())'), 'basket.js') === null && !M.isPart(basket, basket, 'basket.js'));
ok('the file rewritten with one function renamed is the whole file, not a part', M.fit('function getUsr() {}\nfunction allUsers() {}\nmodule.exports = { getUsr, allUsers };\n', 'function getUser() {}\nfunction allUsers() {}\nmodule.exports = { getUser, allUsers };\n', 'users.js') === null);
ok('only new definitions are a part, added', /function parse_clock[\s\S]*def parse_duration|parse_duration/.test(M.fit('def parse_clock(t):\n    return 1\n', 'def parse_duration(t):\n    return 2\n', 't.py') || ''));
ok('a part with no definitions in it is not fitted', M.fit(basket, "test('x', () => {});\n", 'basket.js') === null);
ok('a file in another language is not fitted', M.fit('a { color: red; }', 'b { }', 'style.css') === null);
ok('nor a file that does not exist yet', M.fit(undefined, 'function a() {}', 'a.js') === null);

console.log('\nIt is used:');
{
  const light = src('js', 'code', 'light.js');
  ok('light mode fits a part into the file before writing it, and keeps a guessed name only for code the file has something in common with', /const fitted = M\.fit\(now, content, w\.path\);/.test(light) && /else if \(w\.guessed && !sharesDefinition\(M, now, content, w\.path\)\) \{ unsure\.push\(w\.path\); continue; \}/.test(light));
  const boot = src('boot.js');
  ok('it loads before light mode', boot.indexOf("'/js/code/merge.js'") > 0 && boot.indexOf("'/js/code/merge.js'") < boot.indexOf("'/js/code/light.js'"));
  ok('this check is part of npm run check', /npm run check:code-merge/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/merge.js)`);
process.exit(fail ? 1 : 0);
