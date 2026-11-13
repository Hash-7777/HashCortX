// ============================================================
// One example call on three of HashCoder's tools: patch_file with more than
// one change, shell_run with the program and its arguments apart, grep_code
// with a pattern of several names. Each must be a call its tool takes and
// the app lets through, written with invented values, at the end of the
// description, for every size of model but the smallest, and short.
//
// Loads the REAL src/platform/tauri/hashcoder.js, src/js/code/calls.js and
// src/js/code/permissions.js. Run with: npm run check:code-tool-examples
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const sandbox = { window: {}, console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, RegExp };
sandbox.window = sandbox;
sandbox.HC = {};
vm.createContext(sandbox);
for (const f of [['js', 'model-profile.js'], ['js', 'secret-shapes.js'], ['js', 'code', 'calls.js'], ['js', 'code', 'permissions.js'], ['platform', 'tauri', 'hashcoder.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
}
const HC = sandbox.HC;
const Calls = sandbox.HCCodeCalls;
const Perm = sandbox.HCCodePermissions;
const THREE = ['patch_file', 'shell_run', 'grep_code'];
const examples = HC.code.TOOL_EXAMPLES || {};
const list = typeof HC.code.toolList === 'function' ? HC.code.toolList() : [];
const byName = (tools, n) => tools.find((t) => t.function.name === n);
const lineOf = (n) => (typeof HC.code.exampleLine === 'function' ? HC.code.exampleLine(n) : null);

console.log('Three tools carry one example call each:');
{
  ok('patch_file, shell_run and grep_code, and no other tool', JSON.stringify(Object.keys(examples).sort()) === JSON.stringify([...THREE].sort()), Object.keys(examples).join());
  ok('each written out as one line', THREE.every((n) => typeof HC.code.exampleLine === 'function' && /^Example[^\n]*: \{.*\}$/.test(lineOf(n))));
  ok('...that holds the call exactly', THREE.every((n) => typeof HC.code.exampleLine === 'function' && lineOf(n).endsWith(JSON.stringify(examples[n]))));
  ok('a tool without one has no line', typeof HC.code.exampleLine === 'function' && HC.code.exampleLine('read_file') === '' && HC.code.exampleLine('no_such_tool') === '');
}

console.log('\nEach is a call its tool takes:');
{
  const typeOk = (spec, v) => {
    if (!spec) return false;
    if (spec.type === 'array') return Array.isArray(v) && v.every((x) => (spec.items && spec.items.type === 'object') ? (x && typeof x === 'object' && (spec.items.required || []).every((k) => x[k] !== undefined) && Object.keys(x).every((k) => k in (spec.items.properties || {})) && Object.entries(x).every(([k, y]) => typeof y === spec.items.properties[k].type)) : typeof x === (spec.items ? spec.items.type : 'string'));
    if (spec.type === 'boolean') return typeof v === 'boolean';
    return typeof v === (spec.type || 'string');
  };
  for (const n of THREE) {
    const tool = byName(list, n);
    const ex = examples[n] || {};
    const props = tool ? tool.function.parameters.properties : {};
    const required = tool ? tool.function.parameters.required : [];
    ok(`${n}: every argument is one it takes, of its type`, !!tool && Object.keys(ex).length > 0 && Object.entries(ex).every(([k, v]) => typeOk(props[k], v)), Object.keys(ex).filter((k) => !typeOk(props[k], ex[k])).join());
    ok(`${n}: every argument it needs is there`, !!tool && required.every((k) => ex[k] !== undefined), required.filter((k) => ex[k] === undefined).join());
    ok(`${n}: the app's own reading of a call leaves it as it is`, !!tool && Calls.normalize(ex, tool).moved.length === 0 && Calls.missing(n, ex, tool) === '');
  }
}

console.log('\nEach shows the shape a call of that tool most needs:');
{
  const p = examples.patch_file || {};
  ok('patch_file: a first change, and more in edits', typeof p.search === 'string' && typeof p.replace === 'string' && Array.isArray(p.edits) && p.edits.length >= 1);
  // Made on an invented file the way the tool makes them: each passage there once.
  const before = 'const TAX = 0.2;\nfunction total(items) {\n  let total = 0;\n  for (const item of items) total += item.price;\n  return total;\n}\n';
  const changes = [p, ...(p.edits || [])].filter((c) => c && typeof c.search === 'string');
  const once = changes.every((c) => before.split(c.search).length === 2);
  const after = changes.reduce((text, c) => text.replace(c.search, c.replace), before);
  ok('...each passage found once in a file it fits, and every change made', once && changes.length >= 2 && changes.every((c) => after.includes(c.replace)), changes.map((c) => before.split(c.search).length - 1).join());
  const s = examples.shell_run || {};
  ok('shell_run: the program as one word, its arguments apart, several of them', typeof s.command === 'string' && /^[a-z]+$/.test(s.command) && Array.isArray(s.args) && s.args.length >= 3 && s.args.every((a) => !/\s/.test(a)));
  const verdict = Perm && s.command ? Perm.shellVerdict({ command: s.command, args: s.args, root: '/work/shop' }) : { auto: false };
  ok('...and one that only reads, so Auto runs it without a question', verdict.auto === true, verdict.why);
  const g = examples.grep_code || {};
  ok('grep_code: a pattern that finds either of two names', typeof g.pattern === 'string' && /\|/.test(g.pattern));
  let re = null; try { re = new RegExp(g.pattern, 'i'); } catch { re = null; }
  ok('...a regular expression the search takes, finding both in invented lines', !!re && re.test('cart.addItem(product)') && re.test('function removeItem(id) {') && !re.test('const total = 0;'));
}

console.log('\nThe values are invented, and safe to show any model:');
{
  const text = THREE.map((n) => JSON.stringify(examples[n] || {})).join('\n');
  ok('no path from the top of a disk', !/"\/|[A-Za-z]:\\\\|~\//.test(text) && !/"\.\.\//.test(text));
  ok('no address', !/:\/\/|www\./i.test(text));
  ok('plain characters only', /^[\x20-\x7e\n]*$/.test(text));
  ok('a path is written from the project folder, which every tool takes', [examples.patch_file?.path, examples.grep_code?.dir].every((v) => typeof v === 'string' && /^[a-z]/.test(v)) && THREE.every((n) => /project folder/.test(HC.code.exampleLine?.(n) || '')));
}

console.log('\nWhich models are sent it, and how:');
{
  const EXAMPLE_MOST = HC.code.EXAMPLE_MOST;
  ok('a limit is set for how long a line may be', Number.isFinite(EXAMPLE_MOST) && EXAMPLE_MOST <= 400);
  const full = HC.code.toolsFor('full', list, '');
  const mid = HC.code.toolsFor('mid', list, 'a site');
  const small = HC.code.toolsFor('small', list, 'a site');
  const ends = (tools, n) => { const t = byName(tools, n); return !!t && t.function.description.endsWith(`\n${lineOf(n)}`); };
  ok('a larger model: each of the three ends with its example, after the description', THREE.every((n) => ends(full, n) && byName(full, n).function.description.startsWith(HC.code.TOOL_DEFINITIONS.find((d) => d.name === n).description)));
  ok('a mid-sized model: each ends with it too, after its one line', THREE.every((n) => ends(mid, n) && byName(mid, n).function.description === `${HC.code.SHORT_TOOL_WORDS[n]}\n${lineOf(n)}`));
  ok('a small model is sent none: its tools stay one line each', small.every((t) => !/\nExample/.test(t.function.description) && t.function.description === HC.code.SHORT_TOOL_WORDS[t.function.name]));
  ok('no other tool gains a line, at any size', [...full, ...mid].filter((t) => !THREE.includes(t.function.name)).every((t) => !/\nExample/.test(t.function.description)));
  ok('the line is there once, never twice', [...full, ...mid].every((t) => t.function.description.split('\nExample').length <= 2));
  const plain = (t) => ({ ...t, function: { ...t.function, description: t.function.description.replace(`\n${lineOf(t.function.name)}`, '') } });
  const added = (tools) => THREE.map((n) => { const t = byName(tools, n); return t ? JSON.stringify(t).length - JSON.stringify(plain(t)).length : Infinity; });
  ok(`each adds under ${EXAMPLE_MOST} characters to what a larger model is sent`, added(full).every((k) => k > 0 && k < EXAMPLE_MOST), added(full).join());
  ok('...and to what a mid-sized model is sent', added(mid).every((k) => k > 0 && k < EXAMPLE_MOST), added(mid).join());
  ok('the same for every provider: only the description changes, no field is added', THREE.every((n) => { const t = byName(full, n); return JSON.stringify(Object.keys(t)) === '["type","function"]' && JSON.stringify(Object.keys(t.function)) === '["name","description","parameters"]'; }));
  ok('the tools the app holds are not changed in place', THREE.every((n) => !/\nExample/.test(HC.code.TOOL_DEFINITIONS.find((d) => d.name === n).description)));
}

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/hashcoder.js tool examples)`);
process.exit(fail ? 1 : 0);
