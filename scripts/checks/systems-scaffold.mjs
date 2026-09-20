// ==============================================================
// A whole working system, built without asking anything
//
// Loads the REAL modules and builds a system for a spread of businesses, then
// puts every one of them through the app's OWN gate — the same validate() the
// mode runs on a model's answer. That is the property worth holding: not that
// this file produces something, but that what it produces is renderable, every
// time, for any request, with no model involved.
//
// The defect it replaces, measured: generating a system asked a model to design
// a database from nothing. One run had the first model out of quota, the second
// and third out of credit, and the ladder ended on a nano model, which answered
// in two seconds with no name, three modules and two tables — then the app
// spent another round trip trying to repair an answer that was never usable.
//
// Run with: npm run check:systems-scaffold
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
// The real ones, in the order the app loads them.
for (const file of ['spec.js', 'money.js', 'samples.js', 'domain.js', 'scaffold.js']) {
  vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', file), 'utf8'), sandbox, { filename: file });
}
const Sc = sandbox.window.HCSystemsScaffold;
const S = sandbox.window.HCSystemsSpec;
const D = sandbox.window.HCSystemsDomain;
const TODAY = '2026-09-21';

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('Every kind of business gets a system the app can actually draw:');
{
  // One per industry the app knows, plus the requests that name none of them.
  const asks = [
    'a pizza restaurant in Cairo', 'a small hotel', 'a dentist clinic', 'a private school',
    'a gym and wellness studio', 'a property agency', 'an online clothing store',
    'a law firm', 'a logistics company', 'a car workshop', 'a bakery',
    'a system for Seif\'s bike shop', 'something for my business', 'x', '',
  ];
  let renderable = 0;
  for (const ask of asks) {
    const spec = Sc.build(ask, TODAY);
    const issues = spec ? S.validate(spec) : ['nothing was built'];
    if (!issues.length) renderable += 1;
    else console.log(`        ${ask || '(nothing)'} → ${issues.join(' | ')}`);
  }
  ok(`all ${asks.length} pass the app's own gate`, renderable === asks.length, `${renderable} of ${asks.length}`);
}

console.log('\nAnd every one of them is a system somebody could use:');
{
  const spec = Sc.build('a pizza restaurant in Cairo', TODAY);
  ok('it has the modules the gate asks for', spec.modules.length >= Sc.MIN_MODULES);
  ok('each one is drawn on a screen the app has', spec.modules.every((m) => S.VALID_SCREENS.includes(m.screen)));
  ok('and more than one kind of screen', new Set(spec.modules.map((m) => m.screen)).size >= 4);
  ok('every module names a table that exists', spec.modules.every((m) => spec.entities.some((e) => e.id === m.entity)));
  ok('every table carries at least three fields', spec.entities.every((e) => e.fields.length >= 3));
  ok('and records to show on the screen', Object.values(spec.mockData).every((rows) => rows.length >= 5));
  ok('the records match the fields', spec.entities.every((e) => e.fields.every((f) => f.id in spec.mockData[e.id][0])));
  ok('it knows what trade it is for', spec.domain === 'restaurant');
  ok('and it says it was built without a model', spec.builtWithoutAModel === true);
}

console.log('\nIt is named for the business, not for the industry:');
{
  ok('a named shop keeps its name', /bike shop/i.test(Sc.build("a system for Seif's bike shop", TODAY).name));
  ok('and the words after "for" are the ones taken', Sc.nameFrom('an ERP for Cairo Dental', 'Healthcare') === 'Cairo Dental');
  ok('a request naming nothing still gets a name', Sc.build('', TODAY).name.length > 0);
  ok('and it is not left blank for the gate to reject', S.validate(Sc.build('', TODAY)).length === 0);
}

console.log('\nA screen is never shown something it cannot draw:');
{
  // The gate asks a board for stages, a report for a figure, a calendar for a
  // date. An industry's own fields do not always carry one.
  const boards = [];
  for (const ask of ['a restaurant', 'a hotel', 'a clinic', 'a gym', 'a law firm', 'a logistics company']) {
    const spec = Sc.build(ask, TODAY);
    for (const module of spec.modules) {
      const entity = spec.entities.find((e) => e.id === module.entity);
      const needs = S.SCREEN_NEEDS[module.screen] || {};
      if (needs.stage) boards.push(entity.fields.some((f) => f.type === 'select' && (f.options || []).length >= 2));
      if (needs.figure) boards.push(entity.fields.some((f) => f.type === 'number' || /amount|total|price|cost|revenue|salary|qty|quantity|balance|value/i.test(f.id + f.label)));
      if (needs.date) boards.push(entity.fields.some((f) => f.type === 'date' || /date|time|due|created|updated/i.test(f.id + f.label)));
    }
  }
  ok(`every screen that needs a field has one (${boards.length} checked)`, boards.length > 0 && boards.every(Boolean));
  // A table drawn on two screens needs what BOTH of them want.
  const twice = Sc.build('a restaurant', TODAY);
  const shared = twice.modules.filter((m, i, all) => all.findIndex((o) => o.entity === m.entity) !== i);
  ok('including a table drawn on two different screens', shared.length > 0);
}

console.log('\nNothing about it depends on a model, a clock or a network:');
{
  ok('it builds with no model anywhere in reach', Sc.build('a bakery', TODAY) !== null);
  ok('the date is passed in rather than read', /function build\(description, today/.test(readFileSync(join(root, 'src', 'js', 'systems', 'scaffold.js'), 'utf8')));
  ok('the same request twice gives the same system',
    JSON.stringify(Sc.build('a bakery', TODAY)) === JSON.stringify(Sc.build('a bakery', TODAY)));
  ok('it carries the trade\'s own colours', !!Sc.build('a hotel', TODAY).theme.primary);
  ok('and the stages that trade\'s work moves through', Sc.build('a restaurant', TODAY).workflows.length > 0);
}

console.log('\nThe mode builds it before it asks anything:');
{
  const mode = readFileSync(join(root, 'src', 'modes', 'systems', 'mode.js'), 'utf8');
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  const standalone = readFileSync(join(root, 'src', 'js', 'systems', 'export-app.js'), 'utf8');
  ok('it is loaded', /\/js\/systems\/scaffold\.js/.test(boot));
  ok('after the two files it reads', boot.indexOf('/js/systems/domain.js') < boot.indexOf('/js/systems/scaffold.js')
    && boot.indexOf('/js/systems/samples.js') < boot.indexOf('/js/systems/scaffold.js'));
  ok('and an exported app carries it too, in that order too',
    standalone.indexOf('/js/systems/domain.js') < standalone.indexOf('/js/systems/scaffold.js'));
  ok('the system is built before a model is asked',
    mode.indexOf('HCSystemsScaffold?.build') < mode.indexOf('await generateWithModel'));
  ok('and kept when no model can design one',
    /catch \(err\) \{[\s\S]{0,400}spec = scaffold;/.test(mode));
  ok('a stop is still a stop, not a fallback', /if \(err\.name === "AbortError" \|\| !scaffold\) throw err;/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/scaffold.js)`);
process.exit(fail ? 1 : 0);
