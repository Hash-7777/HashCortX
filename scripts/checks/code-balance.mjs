// ============================================================
// Whether an edit left a file's brackets and quotes unbalanced —
// src/js/code/balance.js. Run with: npm run check:code-balance
// ============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(readFileSync(process.argv[2] || join(root, 'src', 'js', 'code', 'balance.js'), 'utf8'), box, { filename: 'balance.js' });
const B = box.window.HCCodeBalance;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const fault = (name, text) => B.firstFault(text, B.familyOf(name));

console.log('It finds what breaks a file:');
{
  const good = "export const slugify = (t) => t\n  .toLowerCase()\n  .replace(/[^a-z0-9]/g, '-')\n  .replace(/-+/g, '-');\n";
  const typo = good.replace("/g, '-')\n  .replace(/-+", "/g, '-)\n  .replace(/-+");
  const f = fault('text.js', typo);
  ok('a quote typed wrong, on the line it happened', f && f.line === 3 && /string opened with ' here is not closed on its line/.test(f.what), JSON.stringify(f));
  ok('a closing brace taken away', /"\{" opened here is never closed/.test((fault('a.js', 'function f() {\n  if (x) {\n    y();\n}\n') || {}).what || ''));
  ok('one bracket too many, where it is', (fault('a.js', 'f(a));\n') || {}).line === 1);
  ok('a bracket closing the wrong kind', /closes a "\[" opened on line 1/.test((fault('a.js', 'const a = [1, 2);\n') || {}).what || ''));
  ok('a Python call left open', /"\(" opened here/.test((fault('stats.py', 'def median(xs):\n    return sorted(xs[len(xs) // 2]\n') || {}).what || ''));
  ok('a Python triple-quoted string left open', /triple-quoted/.test((fault('a.py', 'x = """start\nmore\n') || {}).what || ''));
  ok('a CSS rule left open', !!fault('site.css', '.a { color: red;\n.b { color: blue; }\n'));
  ok('a comment left open', /comment/.test((fault('a.js', 'x();\n/* note\n') || {}).what || ''));
}

console.log('\nIt reads what is valid as valid:');
{
  ok('patterns with quotes and brackets in them, after a keyword too', !fault('a.js', "const q = /[\"'(]/g;\nfunction f(t) { return /\\bx\\s*\\(/.test(t) && /[\",\\n]/.test(t); }\n"));
  ok('division is not a pattern', !fault('a.js', 'const r = (a / b) / (c / d);\n'));
  ok('template strings, with code and strings inside', !fault('a.js', 'const s = `a ${b ? `c ${d("}")}` : \'{\'} e`;\n'));
  ok('strings and comments holding brackets', !fault('a.js', "// ( [ {\nconst s = '(' + \"]\" + '{'; /* } ) */\n"));
  ok('Python strings, comments and triple quotes', !fault('a.py', "# (\ns = '(' + \"[\"\nd = \"\"\"{\n}\"\"\"\nf(x)\n"));
  ok('Rust lifetimes, characters and raw strings', !fault('a.rs', "fn f<'a>(x: &'a str) -> char { let c = '('; let r = r#\"{\"a\": \"(\"}\"#; let e = '\\''; c }\n"));
  ok('a Rust string over several lines, and a Go raw string holding quotes', !fault('a.rs', 'let s = "a (\nb";\nfn f() {}\n') && !fault('a.go', 'var s = `{"a": "(" }`\nfunc f() {}\n'));
  ok('a file it does not read gives no answer', B.familyOf('notes.md') === null && B.familyOf('data.json') === null && B.introduced('notes.md', 'a', 'a (') === '');
  // Every source file this repository ships, which all parse, reads as
  // balanced: the reading is simple, and this is what keeps it honest.
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'vendor' || e.name === 'target' || e.name === 'gen' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (B.familyOf(e.name)) files.push(p);
    }
  };
  for (const d of ['src', 'scripts', join('src-tauri', 'src')]) walk(join(root, d));
  const wrong = files.filter((f) => fault(f, readFileSync(f, 'utf8')));
  ok(`every source file in this repository reads as balanced (${files.length > 300 ? 'several hundred' : files.length})`, files.length > 300 && wrong.length === 0, wrong.slice(0, 3).map((f) => f.slice(root.length + 1)).join(', '));
}

console.log('\nWhat the model is told:');
{
  const before = "export const f = (t) => t.replace(/a/g, '-');\n";
  const after = "export const f = (t) => t.replace(/a/g, '-);\n";
  const note = B.introduced('text.js', before, after);
  ok('an edit that breaks a balanced file is said, with the line and what', /text\.js may not parse: on line 1/.test(note) && /It balanced before the change/.test(note) && /fix it now/.test(note));
  ok('an edit that leaves it balanced says nothing', B.introduced('text.js', before, before.replace('-', '_')) === '');
  ok('a file that did not balance before is left to the model', B.introduced('text.js', after, after + '\n') === '');
  ok('a new file is read on its own', /may not parse/.test(B.introduced('new.py', null, 'print((1)\n')) && !/balanced before/.test(B.introduced('new.py', null, 'print((1)\n')));
  const tools = readFileSync(join(root, 'src', 'platform', 'tauri', 'hashcoder.js'), 'utf8');
  ok('write_file and patch_file answer with it, beside the result', /const check = window\.HCCodeBalance\?\.introduced\(path\.split\(\/\[\\\\\/\]\/\)\.pop\(\) \|\| path, before, ends\.text\) \|\| '';/.test(tools) && /\.\.\.\(check \? \{ check \} : \{\}\)/.test(tools));
  ok('it is loaded before the mode', readFileSync(join(root, 'src', 'boot.js'), 'utf8').includes("'/js/code/balance.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/balance.js)`);
process.exit(fail ? 1 : 0);
