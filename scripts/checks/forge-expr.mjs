// ==============================================================
// Forge expression checks
//
// Loads the REAL src/js/forge/expr.js into a Node VM.
//
// Two things are being pinned here, and the second matters more than the first.
// One: the arithmetic is right, including the awkward corners — precedence, a
// power binding to the right, unary minus, a division by zero. Two: **the
// language cannot reach anything.** A design's arithmetic arrives from a model,
// so every rule below that tries to escape is a rule about what happens when
// that text is hostile rather than merely wrong.
//
// Run with: npm run check:forge-expr
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'expr.js'), 'utf8'), sandbox, { filename: 'expr.js' });
const E = sandbox.window.HCForgeExpr;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const val = (text, scope) => E.evaluate(text, scope).value;
const err = (text, scope) => E.evaluate(text, scope).error;

console.log('\nThe arithmetic is the arithmetic:');
{
  ok('a plain number passes through', val(42) === 42);
  ok('so does one written as text', val('42') === 42);
  ok('a decimal without a leading zero reads', val('.5') === 0.5);
  ok('exponent notation reads', val('1.5e2') === 150);
  ok('adding and subtracting', val('2 + 3 - 1') === 4);
  ok('multiply before add', val('2 + 3 * 4') === 14);
  ok('brackets first', val('(2 + 3) * 4') === 20);
  ok('divide', near(val('10 / 4'), 2.5));
  ok('remainder', val('10 % 3') === 1);
  ok('unary minus', val('-5 + 2') === -3);
  ok('unary minus on a bracket', val('-(5 + 2)') === -7);
  ok('two minuses', val('3 - -2') === 5);
  ok('a leading plus is harmless', val('+7') === 7);
  ok('a power', val('2 ^ 5') === 32);
  ok('a power binds to the right', val('2 ^ 3 ^ 2') === 512, 'should be 2^9, not 8^2');
  ok('a power binds tighter than multiply', val('2 * 3 ^ 2') === 18);
  ok('whitespace is ignored', val('  2\t+\n3 ') === 5);
}

console.log('\nThe functions a part actually needs:');
{
  ok('min and max', val('min(3, 7)') === 3 && val('max(3, 7)') === 7);
  ok('more than two arguments', val('max(1, 9, 4)') === 9);
  ok('a root', val('sqrt(16)') === 4);
  ok('absolute', val('abs(0 - 3)') === 3);
  ok('rounding', val('round(2.6)') === 3 && val('floor(2.6)') === 2 && val('ceil(2.1)') === 3);
  ok('clamped between two values', val('clamp(12, 0, 10)') === 10);
  ok('degrees where a person thinks in degrees', near(val('sin(rad(90))'), 1));
  ok('and back again', near(val('deg(pi)'), 180));
  ok('pi is available', near(val('pi'), Math.PI));
  ok('so is a full turn', near(val('tau'), Math.PI * 2));
  ok('a function of an expression', near(val('sqrt(3 * 3 + 4 * 4)'), 5));
  ok('nested functions', val('max(min(5, 3), 1)') === 3);
}

console.log('\nNamed values, and values named in terms of each other:');
{
  ok('a variable resolves', val('wall * 2', { wall: 3 }) === 6);
  const { values, issues } = E.resolveVars({ wall: 2, inner: 30, outer: 'inner + wall * 2' });
  ok('a variable may be written from others', values.outer === 34);
  ok('and order in the object does not matter',
    E.resolveVars({ outer: 'inner + 1', inner: 5 }).values.outer === 6);
  ok('nothing is reported when everything resolves', issues.length === 0);

  // A design that has written a circle must stop, not hang.
  const circular = E.resolveVars({ a: 'b + 1', b: 'a + 1' });
  ok('a circular definition is reported rather than looping',
    circular.issues.some((i) => i.code === 'unresolved-var'));
  ok('and neither name is invented', circular.values.a === undefined && circular.values.b === undefined);

  const reserved = E.resolveVars({ pi: 3 });
  ok('a variable may not take a name the language already uses',
    reserved.issues.some((i) => i.code === 'reserved-name'));
  ok('and the real value is untouched', near(val('pi'), Math.PI));
  ok('variables that are not an object are simply none', E.resolveVars(null).issues.length === 0);
}

console.log('\nWhat is wrong is said, and nothing is guessed:');
{
  ok('an unknown name is an error, not a zero', !!err('width * 2'));
  ok('and it says which name', /width/.test(err('width * 2')));
  ok('an unknown function is an error', /no function/.test(err('frobnicate(2)')));
  ok('an unclosed bracket is an error', /bracket/.test(err('(2 + 3')));
  ok('trailing rubbish is an error', !!err('2 + 3 4'));
  ok('an empty expression is an error', !!err('   '));
  ok('a division by zero is an error, not infinity', /zero/.test(err('5 / 0')));
  ok('a remainder by zero too', /zero/.test(err('5 % 0')));
  ok('a result that is not finite is refused', !!err('sqrt(0 - 1)'));
  ok('an error carries no value', E.evaluate('nope').value === undefined);
  ok('nothing ever throws', (() => { try { E.evaluate('((((' ); E.evaluate(null); E.evaluate({}); return true; } catch { return false; } })());
}

console.log('\nThe language cannot reach anything:');
{
  // Every one of these is a way out of an expression evaluator that took a
  // shortcut. None of them is a character this one will even tokenise.
  const escapes = [
    'constructor', 'this', 'globalThis', 'window', 'process',
    'a.b', 'a["b"]', '"text"', "'text'", '`text`',
    'x = 1', 'x => 1', 'function(){}', 'new Date()',
    '1; 2', 'require("fs")', 'import("fs")', 'eval("1")',
    '{}', '[]', 'a?.b', 'a && b', 'a || b', '!a', 'a < b',
  ];
  ok('every way out of an evaluator is refused',
    escapes.every((text) => !!E.evaluate(text, { a: 1, b: 2, x: 3 }).error),
    escapes.filter((t) => !E.evaluate(t, { a: 1, b: 2, x: 3 }).error).join(' · '));
  ok('a name inherited from every object is not in scope',
    !!err('toString') && !!err('hasOwnProperty') && !!err('__proto__'));
  ok('a function inherited from every object cannot be called',
    !!err('toString()') && !!err('valueOf()'));
  ok('a scope of nothing resolves no names', !!err('anything', null));
  ok('the character that was refused is named', /is not something an expression may contain/.test(err('"a"')));
}

console.log('\nA plan comes back with its numbers worked out:');
{
  const plan = {
    name: 'Cup',
    sizeMm: 'height * 10',
    vars: { wall: 2, bore: 30, height: 9.5 },
    nodes: [
      { id: 'body', name: 'body', type: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
        params: { radius: 'bore / 2 + wall', height: 'height / 5', segments: 64 } },
      { id: 'rim', name: 'rim', type: 'torus', position: [0, 'height / 10', 0], rotation: [0, 0, 0], scale: [1, 1, 1],
        params: { radius: 'bore / 2 + wall', tube: 'wall / 2' } },
    ],
  };
  const out = E.resolvePlan(plan);
  ok('a variable reaches a shape parameter', out.plan.nodes[0].params.radius === 17);
  ok('and a position', near(out.plan.nodes[1].position[1], 0.95));
  ok('and the object size', out.plan.sizeMm === 95);
  ok('a literal number is left as it was', out.plan.nodes[0].params.segments === 64);
  ok('nothing is reported when it all resolves', out.issues.length === 0);
  ok('the original plan is not modified', typeof plan.nodes[0].params.radius === 'string');

  // A name is a name. An app that evaluated them would treat a part called
  // "body" as something to look up and lose it.
  ok('a part name is never evaluated', out.plan.nodes[0].name === 'body');
  ok('and neither is its type', out.plan.nodes[0].type === 'cylinder');
  ok('nor its id', out.plan.nodes[0].id === 'body');

  const broken = E.resolvePlan({ nodes: [{ id: 'a', position: ['wall + 1', 0, 0], params: {} }] });
  ok('an expression that cannot be worked out is reported', broken.issues.some((i) => i.code === 'bad-expression'));
  ok('and the field is left exactly as the design wrote it', broken.plan.nodes[0].position[0] === 'wall + 1');
  ok('a plan that is not a plan does not throw', E.resolvePlan(null).issues.length === 0);

  const points = E.resolvePlan({
    vars: { r: 0.4 },
    nodes: [{ id: 'p', params: { points: [['0 - r', 0], ['r', 'r / 2']] } }],
  });
  ok('a list of points is worked out too',
    points.plan.nodes[0].params.points[0][0] === -0.4 && points.plan.nodes[0].params.points[1][1] === 0.2);
}

console.log('\nThe module reaches nothing outside itself:');
{
  const code = readFileSync(join(root, 'src', 'js', 'forge', 'expr.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  ok('there is no eval and no Function constructor', !/\beval\s*\(|new Function|Function\s*\(/.test(code));
  ok('it touches no page and no geometry', !/document|THREE|fetch|XMLHttpRequest/.test(code));
  ok('and reaches nothing but its own export', (code.match(/window\./g) || []).length === 1);
  ok('names are looked up as own properties only',
    (code.match(/hasOwnProperty\.call/g) || []).length >= 3);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/expr.js)\n`);
process.exit(fail ? 1 : 0);
