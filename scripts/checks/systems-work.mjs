// ==============================================================
// Working the system by asking
//
// Loads the REAL src/js/systems/work.js and holds the property it exists for:
// a sentence becomes changes to somebody's business records, and NOTHING a
// model said is applied as it arrived.
//
// Most of this file is refusals, and that is the right shape for it. A model
// asked to mark one expense paid can answer with fifty deletions, a field that
// does not exist, a value of the wrong kind, or an id it invented. The happy
// path is one test; the ways a wrong answer could quietly destroy a day's
// records are the rest.
//
// Run with: npm run check:systems-work
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'fences.js'), 'utf8'), sandbox, { filename: 'fences.js' });
vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', 'work.js'), 'utf8'), sandbox, { filename: 'work.js' });
const W = sandbox.window.HCSystemsWork;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// A small business system, of the shape the app generates.
const SPEC = {
  name: 'Seif Consulting',
  entities: [
    { id: 'expenses', name: 'Expenses', fields: [
      { id: 'what', label: 'What', type: 'text' },
      { id: 'who', label: 'Who', type: 'text' },
      { id: 'amount', label: 'Amount', type: 'number' },
      { id: 'status', label: 'Status', type: 'select', options: ['Unpaid', 'Paid', 'Disputed'] },
      { id: 'paidOn', label: 'Paid on', type: 'date' },
    ] },
    { id: 'clients', name: 'Clients', fields: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'owing', label: 'Owing', type: 'number' },
    ] },
  ],
};
const DATA = () => ({
  expenses: [
    { id: 'e1', what: 'Laptop', who: 'Seif', amount: 1800, status: 'Unpaid', paidOn: '' },
    { id: 'e2', what: 'Taxi', who: 'Seif', amount: 40, status: 'Unpaid', paidOn: '' },
    { id: 'e3', what: 'Monitor', who: 'Mona', amount: 300, status: 'Unpaid', paidOn: '' },
  ],
  clients: [{ id: 'c1', name: 'Acme', owing: 500 }],
});
const answer = (obj) => W.readAnswer(JSON.stringify(obj));

console.log('The thing somebody actually has a business system for:');
{
  // "Seif paid his due expenses" — two of the three records, not the third.
  const p = W.plan(answer({
    understood: "Mark Seif's unpaid expenses as paid",
    changes: [
      { action: 'update', entity: 'expenses', id: 'e1', set: { status: 'Paid', paidOn: '2026-09-21' }, why: "Seif's laptop" },
      { action: 'update', entity: 'expenses', id: 'e2', set: { status: 'Paid', paidOn: '2026-09-21' }, why: "Seif's taxi" },
    ],
  }), SPEC, DATA());
  ok('both of his records are changed', p.edits.length === 2);
  ok('and Mona\'s is left alone', !p.edits.some((e) => e.id === 'e3'));
  ok('the plan says what it took the request to mean', /unpaid expenses as paid/i.test(p.understood));
  ok('each change says which field, from what, to what',
    p.edits[0].changes.some((c) => c.label === 'Status' && c.from === 'Unpaid' && c.to === 'Paid'));
  ok('and carries a line saying why', /laptop/i.test(p.edits[0].why));
  ok('it reads as what it does', W.summaryOf(p) === '2 records changed');
  const after = W.apply(p, DATA());
  ok('applying it changes those records', after.expenses.filter((r) => r.status === 'Paid').length === 2);
  ok('and leaves the other one as it was', after.expenses.find((r) => r.id === 'e3').status === 'Unpaid');
  ok('the records it was given are not touched', DATA().expenses[0].status === 'Unpaid');
}

console.log('\nNothing a model says is written as it arrived:');
{
  const bad = (changes) => W.plan(answer({ changes }), SPEC, DATA());
  ok('a table the system does not have',
    bad([{ action: 'update', entity: 'payroll', id: 'e1', set: { status: 'Paid' } }]).edits.length === 0);
  ok('a field the table does not declare',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { approvedBy: 'Seif' } }]).edits.length === 0);
  ok('an id that was never there',
    bad([{ action: 'update', entity: 'expenses', id: 'e99', set: { status: 'Paid' } }]).edits.length === 0);
  ok('a choice that is not one of the choices',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { status: 'Settled' } }]).edits.length === 0);
  ok('but a choice written in the wrong case is understood',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { status: 'paid' } }]).edits[0].changes[0].to === 'Paid');
  // This one found a real defect on its first run. "quite a lot" strips to an
  // empty string, and Number('') is 0 — so an Amount field was being set to
  // zero because a model was vague. Somebody's money, gone, silently.
  ok('a number field given words is refused, NOT set to zero',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { amount: 'quite a lot' } }]).edits.length === 0);
  ok('and nothing else vague becomes zero either',
    ['', '   ', 'lots', 'TBD', 'n/a', '--', '.', '$', 'many dollars'].every((v) =>
      bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { amount: v } }]).edits.length === 0));
  ok('while a real zero is still a real zero',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { amount: '0' } }]).edits[0].changes[0].to === 0);
  ok('but money written as money is still a number',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { amount: '$1,950.50' } }]).edits[0].changes[0].to === 1950.5);
  ok('a date that is not a date',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { paidOn: 'soon' } }]).edits.length === 0);
  ok('a structure where a cell should be',
    bad([{ action: 'update', entity: 'expenses', id: 'e1', set: { what: { nested: true } } }]).edits.length === 0);
  ok('something that is not an action at all',
    bad([{ action: 'drop table', entity: 'expenses', id: 'e1', set: { status: 'Paid' } }]).edits.length === 0);
  ok('and every refusal says what was refused and why',
    bad([{ action: 'update', entity: 'payroll', id: 'e1', set: {} }]).dropped[0].why.length > 0);
}

console.log('\nA removal is never folded in with an edit:');
{
  const p = W.plan(answer({ changes: [
    { action: 'update', entity: 'expenses', id: 'e1', set: { status: 'Paid' }, why: 'paid' },
    { action: 'delete', entity: 'expenses', id: 'e2', why: 'asked to remove it' },
  ] }), SPEC, DATA());
  ok('it is counted on its own', p.edits.length === 1 && p.removals.length === 1);
  ok('and said loudly enough to be seen before allowing it', /REMOVED/.test(W.summaryOf(p)));
  ok('a removal of a record that is not there is refused',
    W.plan(answer({ changes: [{ action: 'delete', entity: 'expenses', id: 'e99' }] }), SPEC, DATA()).removals.length === 0);
  const after = W.apply(p, DATA());
  ok('applying it removes that record and only that one',
    after.expenses.length === 2 && !after.expenses.some((r) => r.id === 'e2'));
}

console.log('\nAnd it cannot run away with the system:');
{
  const many = Array.from({ length: 200 }, (_, i) => ({ action: 'delete', entity: 'expenses', id: `e${(i % 3) + 1}` }));
  const p = W.plan(answer({ changes: many }), SPEC, DATA());
  ok('there is a ceiling on how much one request may do',
    p.edits.length + p.additions.length + p.removals.length <= W.MAX_CHANGES);
  ok('and it says it stopped', p.dropped.some((d) => /more changes/.test(d.why)));
  const wide = {};
  for (let i = 0; i < 100; i++) wide[`f${i}`] = 'x';
  wide.status = 'Paid';
  ok('one change cannot set a hundred fields',
    W.plan(answer({ changes: [{ action: 'update', entity: 'expenses', id: 'e1', set: wide }] }), SPEC, DATA())
      .edits.every((e) => e.changes.length <= W.MAX_FIELDS));
}

console.log('\nWhen it did not understand, it says so instead of guessing:');
{
  const p = W.plan(answer({ changes: [], unsure: 'Two clients are called Acme and I cannot tell which is meant.' }), SPEC, DATA());
  ok('no changes is a perfectly good answer', W.isEmpty(p));
  ok('and it reads as nothing to change', W.summaryOf(p) === 'nothing to change');
  ok('what it could not work out is carried back', /cannot tell which/.test(p.unsure));
  ok('an answer that is not JSON is not read as one', W.readAnswer('I have marked them paid.') === null);
  ok('an answer inside a code block still is', W.readAnswer('```json\n{"changes":[]}\n```') !== null);
  ok('setting a field to what it already holds is not a change',
    W.isEmpty(W.plan(answer({ changes: [{ action: 'update', entity: 'expenses', id: 'e1', set: { status: 'Unpaid' } }] }), SPEC, DATA())));
}

console.log('\nWhat the model is shown is the system, and the records that might be meant:');
{
  const tables = W.shown(SPEC, DATA(), 'Seif paid his due expenses');
  const expenses = tables.find((t) => t.id === 'expenses');
  ok('every table is described', tables.length === 2);
  ok('with its fields and their kinds', expenses.fields.some((f) => f.id === 'status' && f.type === 'select'));
  ok('and the choices a choice field offers', expenses.fields.find((f) => f.id === 'status').options.includes('Paid'));
  ok('the records that match the words come first', expenses.records[0].who === 'Seif');
  ok('and how many there are in total is said', expenses.total === 3);
  const big = { expenses: Array.from({ length: 500 }, (_, i) => ({ id: `x${i}`, what: 'thing', who: 'nobody' })), clients: [] };
  ok('a table of five hundred is not sent whole',
    W.shown(SPEC, big, 'anything').find((t) => t.id === 'expenses').records.length <= W.MAX_SHOWN);
}

console.log('\nWhat the model is told:');
{
  const [system, user] = W.messages(SPEC, DATA(), 'Seif paid his due expenses', '2026-09-21');
  ok('it is told to use only the ids it was given', /not a field/i.test(system.content));
  ok('and that an id must be one it was shown', /must be a record id you were actually shown/i.test(system.content));
  ok('and to change none of them when it cannot tell which', /change none of them/i.test(system.content));
  ok('and that marking something done is not a deletion', /Marking something done is an update/i.test(system.content));
  ok('it is told the date, since "due" depends on it', /2026-09-21/.test(user.content));
  ok('and what happened', /Seif paid his due expenses/.test(user.content));
}

console.log('\nThe last thing somebody reads before their records change:');
{
  const p = W.plan(answer({ changes: [
    { action: 'update', entity: 'expenses', id: 'e1', set: { status: 'Paid' }, why: 'paid' },
    { action: 'delete', entity: 'expenses', id: 'e2', why: 'remove it' },
  ], unsure: 'Mona may have paid hers too.' }), SPEC, DATA());
  const text = W.previewOf(p);
  ok('it says which table and which field', /Expenses: Status Unpaid to Paid/.test(text));
  ok('a removal is spelled out, not counted in with the rest', /a record REMOVED/.test(text));
  ok('and said to be the one that cannot be looked at again', /cannot be looked at again/.test(text));
  ok('what it was unsure about is carried into the question', /Mona may have paid/.test(text));
  ok('and it says plainly that nothing has happened yet', /Nothing has been changed yet/.test(text));
  ok('an empty field reads as empty rather than as nothing',
    /\(empty\)/.test(W.previewOf(W.plan(answer({ changes: [{ action: 'update', entity: 'expenses', id: 'e1', set: { paidOn: '2026-09-21' } }] }), SPEC, DATA()))));
  ok('what was done afterwards is one line each', W.doneLines(p).length === 2);
}

console.log('\nAnd the mode uses it that way round:');
{
  const mode = readFileSync(join(root, 'src', 'modes', 'systems', 'mode.js'), 'utf8');
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  const panel = readFileSync(join(root, 'src', 'modes', 'systems', 'panel.html'), 'utf8');
  const standalone = readFileSync(join(root, 'src', 'js', 'systems', 'export-app.js'), 'utf8');
  ok('the module is loaded', /\/js\/systems\/work\.js/.test(boot));
  ok('and goes into an exported app too', /systems\/work\.js/.test(standalone));
  ok('there is a control for it', /id="sysWorkBtn"/.test(panel));
  ok('which needs a system open', /work\.disabled = running \|\| !getActive\(\)/.test(mode));
  ok('it asks before writing anything', /themedConfirm\(W\.previewOf\(plan\)/.test(mode));
  ok('a refusal writes nothing', /if \(!ok\) \{ trace\("Left as it was"/.test(mode));
  ok('the records are kept before they are written over', /undoRecords = \{[\s\S]{0,120}JSON\.parse\(JSON\.stringify\(data\)\)/.test(mode));
  ok('and putting them back is a matter of putting them back', /function undoWork[\s\S]{0,200}saveRuntimeData\(spec, undoRecords\.data\)/.test(mode));
  ok('there is a control that does it', /id="sysUndoWorkBtn"/.test(panel) && /sysUndoWorkBtn"\)\?\.addEventListener\("click", undoWork\)/.test(mode));
  ok('offered only while there is something to put back',
    /btn\.hidden = !\(undoRecords && getActive\(\) && undoRecords\.id === getActive\(\)\.id\)/.test(mode),
    'an undo offered after switching systems would put one system\'s records into another');
  ok('the wait for the model is a live line', /traceLive\(`Working out what to change/.test(mode));
  ok('what was left alone is said, not swallowed', /Left alone — \$\{d\.why\}/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/work.js)`);
process.exit(fail ? 1 : 0);
