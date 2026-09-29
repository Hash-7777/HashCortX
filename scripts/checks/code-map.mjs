// ============================================================
// What a project's source files define — src/js/code/codemap.js,
// and where the Coder uses it. Run with: npm run check:code-map
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'codemap.js'), box, { filename: 'codemap.js' });
const M = box.window.HCCodeMap;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
/** What a text defines, as its labels, joined: "a(x), class B". */
const found = (text, lang) => M.definitions(text, lang).map(M.label).join(', ');

console.log('Which files are read:');
{
  ok('source files by their ending', ['a.js', 'b.tsx', 'c.py', 'd.rs', 'e.go', 'F.java', 'g.cs', 'h.kt', 'i.swift', 'j.cpp', 'k.h', 'l.rb', 'Tasks.rake', 'm.php', 'n.MJS'].every((n) => M.langOf(n)));
  ok('not minified, bundled or declaration files', ['app.min.js', 'vendor-bundle.js', 'app.bundle.js', 'types.d.ts', 'x.d.mts'].every((n) => M.langOf(n) === ''));
  ok('nor anything that is not source', ['README.md', 'logo.png', 'data.json', 'Makefile', ''].every((n) => M.langOf(n) === ''));
}

console.log('\nJavaScript and TypeScript:');
{
  const js = [
    'import x from "y";',
    'export default async function load(path, { strict = true } = {}, ...rest) {',
    '  const local = 3;',
    '  function helper(a) { return a; }',
    '}',
    'function* walk(tree) {}',
    'export class Store extends Base {',
    '  constructor(a) {',
    '  async save(key: string, value: Map<string, number> = EMPTY) {',
    '  get size() {',
    '  static from(list) {',
    '    if (list) {',
    '    for (const x of list) {',
    '    run(list);',
    '  }',
    '}',
    'const add = (a, b) => a + b;',
    'export const double = x => x * 2;',
    'const handler: Handler = async (req: Request, res) => {};',
    'let old = function (a, b) {};',
    'export const TOKEN = "made-up-value-that-must-never-appear";',
    'const notExported = 5;',
    'export interface Shape { w: number }',
    'export type Id = string;',
    'const enum Color { Red }',
    '// function commented(x) {}',
    ' * function inDoc(x) {}',
    'function load(again) {}',
    'function longOne(first, second,',
  ].join('\n');
  const list = M.definitions(js, 'js');
  const text = list.map(M.label).join(', ');
  ok('functions, with their parameters by name only', list[0].name === 'load' && list[0].params === 'path, {…}, ...rest' && /helper\(a\)/.test(text) && /walk\(tree\)/.test(text), text);
  ok('classes, types, interfaces and enums', /class Store/.test(text) && /interface Shape/.test(text) && /type Id/.test(text) && /enum Color/.test(text), text);
  ok('methods, with types and defaults left out', /save\(key, value\)/.test(text) && /size\(\)/.test(text) && /from\(list\)/.test(text), text);
  ok('functions kept in a name', /add\(a, b\)/.test(text) && /double\(x\)/.test(text) && /handler\(req, res\)/.test(text) && /old\(a, b\)/.test(text), text);
  ok('an exported constant is named, and never what it holds', /\bTOKEN\b/.test(text) && !JSON.stringify(list).includes('made-up-value'), text);
  ok('a local value, a constructor, a statement or a call is not a definition', !/\blocal\b|notExported|constructor|\bif\b|\bfor\b|run\(/.test(text), text);
  ok('a comment is not a definition', !/commented|inDoc/.test(text), text);
  ok('a name defined twice is given once, at its first place', list.filter((d) => d.name === 'load').length === 1 && list.find((d) => d.name === 'load').line === 2);
  ok('each has its line', list.find((d) => d.name === 'Store').line === 7 && list.find((d) => d.name === 'Color').line === 25);
  ok('a parameter list the line does not close ends in "…"', list.find((d) => d.name === 'longOne').params === 'first, second, …');
  ok('no more than four parameters are named', M.paramNames('a, b, c, d, e, f', 'js', false) === 'a, b, c, d, …');
}

console.log('\nPython:');
{
  const py = 'class Parser(Base):\n    def __init__(self, text):\n        pass\n    def parse(self, text: str, strict: bool = False, *args, **kwargs) -> Tree:\n        pass\nasync def fetch(url):\n    pass\n# def fake(x):\ndef main():\n    pass';
  ok('classes and functions, self and types left out, stars kept', found(py, 'py') === 'class Parser, parse(text, strict, *args, **kwargs), fetch(url), main()', found(py, 'py'));
}

console.log('\nRust:');
{
  const rs = '#[derive(Debug)]\npub struct Guard {\n}\nimpl Guard for Thing {\n    pub fn check(&self, path: &str) -> bool {\n    pub(crate) async fn load<T: Into<String>>(&mut self, name: T, mut n: usize) {\n}\nenum Kind { A }\npub trait Walk {}\npub type Result<T> = std::result::Result<T, String>;\nfn main() {}';
  ok('functions, structs, enums, traits and types; self left out, impl not a definition', found(rs, 'rs') === 'struct Guard, check(path), load(name, n), enum Kind, trait Walk, type Result, main()', found(rs, 'rs'));
}

console.log('\nGo:');
{
  const go = 'package main\n\ntype Server struct {\n}\ntype Handler interface {\n}\ntype ID string\nfunc (s *Server) Serve(ctx context.Context, a, b int) error {\n}\nfunc Map[T any](xs []T, f func(T) T) []T {\n}\nfunc main() {\n}';
  ok('functions, methods, structs, interfaces and types; the name before the type', found(go, 'go') === 'struct Server, interface Handler, type ID, Serve(ctx, a, b), Map(xs, f), main()', found(go, 'go'));
}

console.log('\nJava, C#, Kotlin and Swift:');
{
  const java = 'public class Invoice {\n    private final Map<String, Integer> counts = new HashMap<>();\n    public Invoice(int a) {\n    }\n    public static void main(String[] args) {\n    }\n    @Override\n    public Map<String, Integer> totals(final List<Line> lines, int year) {\n    }\n}\ninterface Taxed {}';
  ok('Java: classes and methods, the name after the type; a constructor or field is not a method', found(java, 'java') === 'class Invoice, main(args), totals(lines, year), interface Taxed', found(java, 'java'));
  const cs = 'public sealed class Report\n{\n    public async Task<int> Run(string path, CancellationToken token)\n    {\n    }\n    internal static bool IsEmpty(this string s) => s.Length == 0;\n}';
  ok('C#', found(cs, 'java') === 'class Report, Run(path, token), IsEmpty(s)', found(cs, 'java'));
  const kt = 'data class User(val name: String)\nobject Registry\nsuspend fun load(id: Int, vararg tags: String): User {\n}\nfun String.slug(): String = lowercase()';
  ok('Kotlin', found(kt, 'kt') === 'class User, object Registry, load(id, tags), slug()', found(kt, 'kt'));
  const swift = 'public struct Point {\n    static func distance(from a: Point, to b: Point) -> Double {\n    }\n}\nprotocol Drawable {}\n@MainActor final class Canvas {\n    func draw(_ shape: Shape) {\n    }\n}';
  ok('Swift', found(swift, 'swift') === 'struct Point, distance(a, b), protocol Drawable, class Canvas, draw(shape)', found(swift, 'swift'));
}

console.log('\nC and C++:');
{
  const c = '#include <stdio.h>\n#define MAX(a, b) ((a) > (b) ? (a) : (b))\nstruct point {\n  int x;\n};\nstruct point origin;\nint add(int a, int b);\nstatic const char *name_of(const struct point *p, int flags)\n{\n  if (p) {\n  }\n  return "";\n}\nint main(int argc, char **argv) {\n}';
  ok('C: functions where they are written, not declared; a struct defined, not one used', found(c, 'c') === 'struct point, name_of(p, flags), main(argc, argv)', found(c, 'c'));
  const cpp = 'namespace app {\nclass Widget : public Base {\n};\nenum class Mode { A };\ntemplate <typename T> struct Box {\n};\nvoid Widget::draw(const Canvas& canvas) const {\n}\nstd::vector<int> build_list(std::size_t n, int fill = 0) {\n}\n}';
  ok('C++', found(cpp, 'c') === 'class Widget, enum Mode, struct Box, Widget::draw(canvas), build_list(n, fill)', found(cpp, 'c'));
}

console.log('\nRuby and PHP:');
{
  const rb = 'module Billing\n  class Invoice < Base\n    def self.build(lines, tax = 0)\n    end\n    def paid?\n    end\n    def total(*items, &block)\n    end\n  end\nend';
  ok('Ruby', found(rb, 'rb') === 'module Billing, class Invoice, build(lines, tax), paid?, total(*items, &block)', found(rb, 'rb'));
  const php = '<?php\nfinal class Cart {\n    public static function add(int $id, array $opts = []): void {\n    }\n    private function &items() {\n    }\n}\ninterface Priced {}';
  ok('PHP', found(php, 'php') === 'class Cart, add($id, $opts), items(), interface Priced', found(php, 'php'));
}

console.log('\nWhat is never read:');
{
  ok('a line too long to be written by hand', M.definitions(`${'x'.repeat(500)}\nfunction f() {}`, 'js').length === 1 && M.definitions(`function g() {} ${'x'.repeat(500)}`, 'js').length === 0);
  ok('a language it does not know, or no text', M.definitions('def x(): pass', 'cobol').length === 0 && M.definitions(null, 'js').length === 0);
  ok('Python special methods', !/__init__/.test(found('def __init__(self):\n  pass', 'py')));
}

console.log('\nThis repository\'s own files:');
{
  const names = (rel, lang) => new Set(M.definitions(readFileSync(join(here, '..', '..', rel), 'utf8'), lang).map((d) => d.name));
  const patch = names('src/js/code/patch.js', 'js');
  ok('patch.js: its functions', ['applyEdits', 'linesWindow', 'isLong', 'wholeRewrite'].every((n) => patch.has(n)), [...patch].slice(0, 12).join(' '));
  const fs = names('src-tauri/src/commands/fs.rs', 'rs');
  ok('fs.rs: its commands and types', ['fs_grep', 'guard_agent_path', 'resolve_for_containment', 'GrepMatch', 'DirEntry'].every((n) => fs.has(n)), [...fs].slice(0, 12).join(' '));
  const coder = names('src/platform/tauri/hashcoder.js', 'js');
  ok('hashcoder.js: its tool methods', ['readFile', 'writeFile', 'readQuietly', 'patchFile'].every((n) => coder.has(n)), [...coder].slice(0, 12).join(' '));
  const every = ['src/js/app.js', 'src/modes/code/mode.js', 'src/platform/tauri/guard.js'].map((f) => M.definitions(src(...f.slice(4).split('/')), 'js'));
  ok('no keyword is ever read as a name in the largest files', every.flat().every((d) => !['if', 'for', 'while', 'switch', 'catch', 'return', 'function'].includes(d.name)));
}

console.log('\nHashCoder:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('the Symbols list is read through it, whole and without asking', /window\.HCCodeMap\.definitions\(await HC\.code\.readQuietly\(f\.path\), lang\)/.test(mode) && /window\.HCCodeMap\.langOf\(f\.name\)/.test(mode));
  ok('with no second set of patterns of its own', !/SYMBOL_PATTERNS|SYMBOL_EXT_MAP/.test(mode));
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('a quiet read asks the guard\'s check that never asks, and reads the whole file', /async readQuietly\(path\) \{\n\s+if \(!\(await HC\.guard\.allowedWithoutAsking\('read', path\)\)\) throw new Error/.test(tools) && /readQuietly[\s\S]{0,300}HC\.invoke\('fs_read_file', \{ path \}\)/.test(tools));
  const boot = src('boot.js');
  ok('it is loaded before the modes', boot.indexOf("'/js/code/codemap.js'") > 0 && boot.indexOf("'/js/code/codemap.js'") < boot.indexOf("'/modes/boot.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/codemap.js)`);
process.exit(fail ? 1 : 0);
