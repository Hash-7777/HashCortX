// ==============================================================
// A system's backup, written and read back
//
// Loads the REAL src/js/systems/backup.js and holds the property the file
// exists for: what comes out of a backup is the system that went in.
//
// The defect it was built against: the ERP could write a backup and had no way
// to read one, and the file it wrote could not have been restored faithfully
// anyway — it carried the tables but not the modules, and the spec gate fills
// a missing module list with a generic one and then invents an empty table for
// every module whose table is not there. A backup of three tables would have
// come back as three plus six nobody asked for.
//
// Run with: npm run check:systems-backup
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', 'backup.js'), 'utf8'), sandbox, { filename: 'backup.js' });
const B = sandbox.window.HCSystemsBackup;
const mode = readFileSync(join(root, 'src', 'modes', 'systems', 'mode.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const SPEC = {
  name: 'Bike Shop', description: 'repairs and parts', domain: 'retail',
  theme: { mode: 'dark', primary: '#2563eb' }, layout: { nav: 'sidebar' },
  modules: [
    { id: 'm1', name: 'Jobs', entity: 'jobs', screen: 'dashboard' },
    { id: 'm2', name: 'Parts', entity: 'parts', screen: 'table' },
  ],
  entities: {
    jobs: { name: 'Jobs', fields: [{ id: 'title' }, { id: 'price' }] },
    parts: { name: 'Parts', fields: [{ id: 'sku' }] },
  },
  workflows: [{ id: 'w1', name: 'Intake' }],
  screens: [],
};
const DATA = {
  jobs: [{ id: '1', title: 'Brake fix', price: 40 }, { id: '2', title: 'Tune', price: 25 }],
  parts: [{ id: 'p1', sku: 'BRK-1' }],
};

console.log('A system comes back as the system that went in:');
{
  const file = B.make(SPEC, DATA);
  const read = B.read(JSON.stringify(file));
  ok('the file it writes is a file it can read', read.ok);
  const { spec, records } = B.toSpec(read.backup);
  ok('the name survives', spec.name === 'Bike Shop', spec.name);
  ok('every table survives', Object.keys(spec.entities).join() === 'jobs,parts', Object.keys(spec.entities).join());
  ok('and their fields', spec.entities.jobs.fields.length === 2);
  ok('every record survives', records.jobs.length === 2 && records.parts.length === 1);
  ok('and the values in them', records.jobs[0].title === 'Brake fix' && records.jobs[0].price === 40);
  ok('the ids that link tables survive', records.jobs[0].id === '1');
  ok('the workflows survive', spec.workflows.length === 1);

  // The whole reason the format changed.
  ok('the modules survive', spec.modules.length === 2, JSON.stringify(spec.modules.map((m) => m.entity)));
  ok('each module still names its own table', spec.modules.every((m) => Object.keys(spec.entities).includes(m.entity)));
  ok('no table is invented', Object.keys(spec.entities).length === 2, Object.keys(spec.entities).join());
  ok('the file says which version wrote it', B.make(SPEC, DATA).version === B.VERSION);
}

console.log('\nA backup written before the format carried modules still restores:');
{
  // Exactly the shape the old exporter wrote.
  const old = {
    name: 'Old Backup', exportedAt: '2026-08-01T00:00:00Z', theme: {}, layout: {},
    entities: {
      customers: { name: 'Customers', fields: [{ id: 'name' }], records: [{ name: 'Acme' }] },
      invoices: { name: 'Invoices', fields: [{ id: 'total' }], records: [] },
    },
    workflows: [],
  };
  const { spec, records } = B.toSpec(B.read(JSON.stringify(old)).backup);
  ok('its tables come back', Object.keys(spec.entities).join() === 'customers,invoices');
  ok('its records come back', records.customers.length === 1);
  ok('it is given one screen per table', spec.modules.length === 2);
  ok('and no generic ones it never had', !spec.modules.some((m) => /inventory|finance|operations|overview/i.test(m.entity)),
    spec.modules.map((m) => m.entity).join());
  ok('so no empty table is invented for one', Object.keys(spec.entities).length === 2, Object.keys(spec.entities).join());
}

console.log('\nA file off a disk is not trusted:');
{
  const refuses = [
    ['nothing at all', ''],
    ['not JSON', 'this is not json {'],
    ['a list', '[1,2,3]'],
    ['an object with no tables', '{"name":"x"}'],
    ['a system with no tables', '{"entities":{}}'],
    ['null', 'null'],
    ['a bare number', '42'],
  ];
  for (const [what, text] of refuses) {
    const r = B.read(text);
    ok(`${what} is refused, with a reason`, !r.ok && typeof r.reason === 'string' && r.reason.length > 10, r.reason || 'accepted');
  }

  const { spec, records } = B.toSpec({
    entities: { t: { name: 'T', fields: [{ id: 'a' }], records: [{ a: 'keep', sneaky: 'drop', nested: { x: 1 } }] } },
    modules: [{ id: 'm', name: 'Ghost', entity: 'not_here', screen: 'table' }],
  });
  ok('a module naming a table the file lacks is dropped', spec.modules.every((m) => m.entity === 't'), spec.modules.map((m) => m.entity).join());
  ok('so the gate is never asked to invent one', Object.keys(spec.entities).join() === 't');
  ok('a value for a field the table does not declare is dropped', records.t[0].sneaky === undefined);
  ok('and a nested structure cannot arrive as one', typeof records.t[0].nested !== 'object');
  ok('a declared field is kept', records.t[0].a === 'keep');

  const huge = B.toSpec({ entities: { t: {
    name: 'T',
    fields: Array.from({ length: 500 }, (_, i) => ({ id: `f${i}` })),
    records: Array.from({ length: 60000 }, () => ({ f0: 'x' })),
  } } });
  ok('a file cannot carry unlimited fields', huge.spec.entities.t.fields.length === B.MAX_FIELDS);
  ok('nor unlimited records', huge.records.t.length === B.MAX_RECORDS);
  ok('nor unlimited tables', Object.keys(B.toSpec({
    entities: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`e${i}`, { name: 'E', fields: [{ id: 'a' }], records: [] }])),
  }).spec.entities).length === B.MAX_ENTITIES);
}

console.log('\nWhat the person is told before it happens:');
{
  const line = B.describe(B.make(SPEC, DATA));
  ok('the system is named', line.includes('Bike Shop'), line);
  ok('and how many tables', /2 tables/.test(line), line);
  ok('and how many records', /3 records/.test(line), line);
  ok('one table reads as one, not "1 tables"', /1 table\b/.test(B.describe({ name: 'x', entities: { a: { records: [{}] } } })));
}

console.log('\nThe ERP writes and reads through this one file:');
ok('the export builds the file here', /HCSystemsBackup\.make\(spec, getRuntimeData\(spec\)\)/.test(mode));
ok('and no longer assembles one by hand', !/exportedAt: new Date\(\)\.toISOString\(\)/.test(mode));
ok('the restore reads it here', /HCSystemsBackup\.read\(text\)/.test(mode) && /HCSystemsBackup/.test(mode));
ok('a restored system goes through the same gate a made one does', /normalizeSpec\(fromFile/.test(mode));
// A restore that could overwrite is a restore that can destroy the work it was
// meant to protect.
ok('a restore adds a system and replaces none', /systems\.unshift\(spec\)/.test(mode) && !/systems\s*=\s*\[spec\]/.test(mode));
ok('and says so before it happens', /Nothing you have now is changed/.test(mode));
ok('the person is asked first', /themedConfirm\(/.test(mode));
ok('a file that cannot be read says why', /themedAlert\(parsed\.reason/.test(mode));
ok('choosing the same file twice runs again', /picker\.value = ""/.test(mode));
ok('it is offered beside the CSV import', /sysRestoreJsonBtn/.test(mode) && /sysImportCsvBtn/.test(mode));
ok('and the picker only offers JSON', /id="sysRestoreFile" accept="\.json,application\/json"/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/backup.js)`);
process.exit(fail ? 1 : 0);
