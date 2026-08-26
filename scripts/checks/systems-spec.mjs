// ==============================================================
// ERP spec reading and validation — checks
//
// Loads the REAL src/js/systems/spec.js. Until this file existed, the two
// judgements that decide whether a generated business system is usable at all
// — can the model's answer be read, and is it complete enough to build from —
// sat inside a four-thousand-line mode file where nothing could reach them.
//
// The reader is checked against what models actually send rather than against
// what they are asked to send: fences, prose either side, a worked example
// before the real answer, a trailing comma, a comment. Refusing any of those
// is refusing a good answer over its packaging, which a person reads as the
// app failing when the model did not.
//
// Run with: npm run check:systems-spec
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, structuredClone };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', 'spec.js'), 'utf8'), sandbox, { filename: 'spec.js' });
const S = sandbox.window.HCSystemsSpec;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nThe answer is read however the model wrapped it:');
{
  const spec = { name: 'Clinic', modules: [{ name: 'Patients' }] };
  const json = JSON.stringify(spec);

  ok('plain JSON is read', S.parseJson(json).name === 'Clinic');
  ok('JSON in a fence is read', S.parseJson('```json\n' + json + '\n```').name === 'Clinic');
  ok('a fence with no language on it too', S.parseJson('```\n' + json + '\n```').name === 'Clinic');
  ok('prose either side is stepped over',
    S.parseJson('Here is the system you asked for:\n' + json + '\nLet me know if you want changes.').name === 'Clinic');
  ok('a trailing comma is forgiven',
    S.parseJson('{"name":"Clinic","modules":[],}')?.name === 'Clinic');
  ok('and a comment in the middle of it',
    S.parseJson('{\n// the system\n"name":"Clinic","modules":[]\n}')?.name === 'Clinic');

  // A model explaining itself often writes a small example FIRST. Taking the
  // first object that parses would take the example and throw away the answer.
  const withExample = 'For example a module looks like {"name":"Example","screen":"list"} — '
    + 'and here is the full system: ' + json;
  ok('a worked example before the answer does not win', S.parseJson(withExample).name === 'Clinic');

  ok('nothing at all is nothing, not an exception', S.parseJson('') === null);
  ok('prose with no JSON in it is nothing',
    S.parseJson('I cannot design that system for you.') === null);
  ok('and a value that is not an object is not a spec',
    typeof S.parseJson('42') !== 'object' || S.parseJson('42') === null || !S.parseJson('42').name);
}

console.log('\nAn identifier is made from whatever was written:');
{
  ok('spaces and case become one word', S.slug('Purchase Orders') === 'purchase_orders');
  ok('punctuation goes', S.slug('Invoice #1 (draft)') === 'invoice_1_draft');
  ok('nothing usable falls back', S.slug('!!!') === 'item' && S.slug('') === 'item');
  ok('and the fallback can be chosen', S.slug('', 'entity') === 'entity');
}

console.log('\nEntities are read as a map or as a list, because models send both:');
{
  const asMap = S.entityMap({ patients: { fields: [1] }, Visits: { id: 'visits', fields: [2] } });
  ok('a map keyed by name is read', !!asMap.patients && !!asMap.visits);
  const asList = S.entityMap([{ id: 'patients', fields: [1] }, { name: 'Visit Log', fields: [2] }]);
  ok('a list is read the same way', !!asList.patients && !!asList.visit_log);
  ok('an entity that names itself wins over its key',
    !!S.entityMap({ anything: { id: 'invoices' } }).invoices);
  ok('nothing usable is an empty map',
    Object.keys(S.entityMap(null)).length === 0 && Object.keys(S.entityMap('x')).length === 0);
}

// ── The gate ─────────────────────────────────────────────────────────────
const field = (id, type) => ({ id, label: id, type });
const goodEntity = (id) => ({ id, fields: [field('name', 'text'), field('amount', 'number'), field('due_date', 'date')] });
const goodSpec = () => ({
  name: 'Clinic',
  modules: [
    { name: 'Patients', entity: 'patients', screen: 'list' },
    { name: 'Visits', entity: 'visits', screen: 'kanban' },
    { name: 'Billing', entity: 'invoices', screen: 'report' },
    { name: 'Overview', entity: 'patients', screen: 'dashboard' },
    { name: 'Diary', entity: 'visits', screen: 'calendar' },
  ],
  entities: { patients: goodEntity('patients'), visits: goodEntity('visits'), invoices: goodEntity('invoices') },
});

console.log('\nA complete spec passes, and says nothing:');
{
  ok('nothing is wrong with a complete one', S.validate(goodSpec()).length === 0);
}

console.log('\nAn incomplete one says everything that is wrong, not the first thing:');
{
  // A model given one complaint fixes one thing, and the next attempt fails on
  // the next. Saying it all at once is what makes a re-ask worth making.
  const thin = { name: '', modules: [{ name: 'One', entity: 'nope', screen: 'wrong' }], entities: {} };
  const issues = S.validate(thin);
  ok('several problems come back together', issues.length >= 4, `${issues.length}`);
  ok('a missing name is named', issues.some((i) => /Missing non-empty name/.test(i)));
  ok('too few modules is named', issues.some((i) => /at least 5 business modules/.test(i)));
  ok('too few entities is named', issues.some((i) => /at least 3 entity schemas/.test(i)));
  ok('a screen nobody offers is named', issues.some((i) => /invalid or missing screen/.test(i)));
  // The one that produces a broken app rather than a thin one.
  ok('a module pointing at an entity nobody defined is named',
    issues.some((i) => /is not defined/.test(i)));

  ok('anything that is not an object at all is refused outright',
    S.validate(null).length === 1 && /must be a JSON object/.test(S.validate(null)[0]));
  ok('and so is a list', /must be a JSON object/.test(S.validate([])[0]));
  ok('nothing is said twice', (() => {
    const list = S.validate(thin);
    return new Set(list).size === list.length;
  })());
  ok('and the list stops before it stops being readable', S.validate({
    name: '', modules: Array.from({ length: 40 }, (_, i) => ({ name: '', entity: 'x' + i, screen: 'no' })), entities: {},
  }).length <= 14);
}

console.log('\nA record with nothing countable or nothing dated is not a business record:');
{
  const noNumber = goodSpec();
  noNumber.entities.patients = { id: 'patients', fields: [field('name', 'text'), field('notes', 'text'), field('due_date', 'date')] };
  ok('an entity with nothing to count is named',
    S.validate(noNumber).some((i) => /numeric\/business value field/.test(i)));

  // A model that writes an amount as text has still understood the job, so
  // the NAME is read as well as the type.
  const namedNumber = goodSpec();
  namedNumber.entities.patients = { id: 'patients', fields: [field('name', 'text'), field('total_price', 'text'), field('due_date', 'date')] };
  ok('but an amount written as text still counts',
    !S.validate(namedNumber).some((i) => /numeric\/business value field/.test(i)));

  const noDate = goodSpec();
  noDate.entities.visits = { id: 'visits', fields: [field('name', 'text'), field('amount', 'number'), field('notes', 'text')] };
  ok('an entity with no date is named', S.validate(noDate).some((i) => /date\/time field/.test(i)));

  const oneScreen = goodSpec();
  oneScreen.modules = oneScreen.modules.map((m) => ({ ...m, screen: 'list' }));
  ok('five modules all on one screen is named',
    S.validate(oneScreen).some((i) => /at least 4 different screen types/.test(i)));
}

console.log('\nA table shows what was searched, filtered and sorted for:');
{
  const rows = [
    { id: 1, name: 'Ahmed', amount: 100, city: 'Cairo' },
    { id: 2, name: 'Bea', amount: 20, city: 'Lisbon' },
    { id: 3, name: 'Cai', amount: 300, city: 'Cairo' },
  ];
  ok('with nothing asked for, everything comes back', S.prepareRecords(rows).length === 3);
  ok('a search looks in every column',
    S.prepareRecords(rows, { search: 'lisbon' }).length === 1);
  ok('and is not case-sensitive', S.prepareRecords(rows, { search: 'AHMED' }).length === 1);
  ok('an equals filter is exact',
    S.prepareRecords(rows, { filters: [{ field: 'city', op: 'eq', value: 'cairo' }] }).length === 2);
  ok('greater-than compares as numbers',
    S.prepareRecords(rows, { filters: [{ field: 'amount', op: 'gt', value: '50' }] }).length === 2);
  ok('a filter with no value is ignored rather than matching nothing',
    S.prepareRecords(rows, { filters: [{ field: 'city', op: 'eq', value: '' }] }).length === 3);

  // The one a person notices: a column of amounts sorted as text puts 100
  // before 20, which reads as the sort being broken.
  const sorted = S.prepareRecords(rows, { sort: { field: 'amount', dir: 'asc' } }).map((r) => r.amount);
  ok('numbers sort as numbers, not as words', sorted.join() === '20,100,300', sorted.join());
  const desc = S.prepareRecords(rows, { sort: { field: 'amount', dir: 'desc' } }).map((r) => r.amount);
  ok('and the other way round', desc.join() === '300,100,20');
  const byName = S.prepareRecords(rows, { sort: { field: 'name', dir: 'asc' } }).map((r) => r.name);
  ok('words sort as words', byName.join() === 'Ahmed,Bea,Cai');

  ok('the rows handed in are not reordered underneath the caller',
    rows[0].amount === 100);
  ok('nothing that is not a list is survivable', S.prepareRecords(null).length === 0);
}

console.log('\nA copy is a copy, however the platform feels about it:');
{
  const original = { a: { b: 1 } };
  const copy = S.cloneSafe(original);
  copy.a.b = 2;
  ok('changing the copy leaves the original alone', original.a.b === 1);
  ok('and nothing usable still gives an object', typeof S.cloneSafe(null) === 'object');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/spec.js)\n`);
process.exit(fail === 0 ? 0 : 1);
