// ==============================================================
// Systems stages checks
//
// How a generated system's records move through their stages, and which
// records a workflow is about. A card could not leave its column and a
// workflow's Run button only wrote to the log; these hold what replaced them.
//
// Run with: npm run check:systems-stages
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'stages.js'), sandbox, { filename: 'stages.js' });
const S = sandbox.window.HCSystemsStages;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const sel = (id, options) => ({ id, label: id, type: 'select', options });
const orders = { id: 'orders', fields: [{ id: 'order_number', type: 'text' }, sel('category', ['Dine-in', 'Takeaway']), sel('status', ['New', 'Cooking', 'Served', 'Paid'])] };

console.log('Which field holds the stage:');
ok('one called status, over an earlier choice field', S.stageField(orders).id === 'status');
ok('failing that, the first choice field', S.stageField({ fields: [sel('kind', ['A', 'B'])] }).id === 'kind');
ok('a choice of one is not a set of stages', S.stageField({ fields: [sel('status', ['Only'])] }) === null);
ok('an entity with no choice field has none', S.stageField({ fields: [{ id: 'name', type: 'text' }] }) === null);

console.log('\nWhat comes before and after:');
const st = orders.fields[2];
ok('after New comes Cooking', S.nextStage(st, 'New') === 'Cooking');
ok('nothing after the last', S.nextStage(st, 'Paid') === null);
ok('before Served comes Cooking', S.previousStage(st, 'Served') === 'Cooking');
ok('nothing before the first', S.previousStage(st, 'New') === null);
ok('stages are matched without regard to case or spaces', S.nextStage(st, ' cooking ') === 'Served');
ok('a value that is not a stage moves on to the first', S.nextStage(st, 'Waiting') === 'New' && S.previousStage(st, 'Waiting') === null);

console.log('\nWhich records a workflow is about:');
const entities = {
  orders,
  bookings: { id: 'bookings', fields: [sel('status', ['Booked', 'Seated', 'No-show'])] },
};
ok('the choice field sharing most of its stages', S.workflowTarget({ stages: ['New', 'Cooking', 'Served', 'Paid'] }, entities)?.entityId === 'orders');
ok('found by its stages, whatever the field is called', S.workflowTarget({ stages: ['Booked', 'Seated'] }, entities)?.field.id === 'status');
ok('one stage in common is not enough', S.workflowTarget({ stages: ['New', 'Archived', 'Gone'] }, entities) === null);
ok('a workflow that names its entity is taken at its word', S.workflowTarget({ entity: 'bookings', stages: ['X', 'Y'] }, entities)?.entityId === 'bookings');

console.log('\nHow many stand at each stage:');
const counts = S.stageCounts([{ status: 'New' }, { status: 'cooking' }, { status: 'Cooking' }, { status: 'Lost' }], st, ['New', 'Cooking', 'Served']);
ok('in the workflow\'s order', counts.map((c) => c.stage).join() === 'New,Cooking,Served');
ok('counted from the records', counts.map((c) => c.count).join() === '1,2,0');

console.log('\nOnly records that move through steps are offered the next one:');
{
  const invoices = { id: 'invoices', fields: [sel('status', ['Draft', 'Sent', 'Paid', 'Overdue'])] };
  const spec = (modules, workflows = []) => ({ entities: { orders, invoices }, modules, workflows });
  ok('an entity shown as a board moves through its stages', S.pipelineField('orders', spec([{ entity: 'orders', screen: 'kanban' }]))?.id === 'status');
  ok('so does one a workflow is about', S.pipelineField('orders', spec([{ entity: 'orders', screen: 'list' }], [{ stages: ['New', 'Cooking', 'Served'] }]))?.id === 'status');
  ok('an invoice listed with its states does not: Paid is not a step before Overdue', S.pipelineField('invoices', spec([{ entity: 'invoices', screen: 'split' }])) === null);
  ok('an entity with no stage field never does', S.pipelineField('x', { entities: { x: { id: 'x', fields: [] } }, modules: [{ entity: 'x', screen: 'kanban' }] }) === null);
  ok('the detail panel asks this before offering a move', /function nextStageButton[\s\S]*?STAGES\(\)\.pipelineField\(entity\?\.id, getActive\(\)\)/.test(mode));
}

console.log('\nThe screens move records for real:');
ok('a board card can be dragged, and dropped on a column', /class="sys-kanban-card"[^>]*draggable="true"/.test(mode) && /class="sys-kanban-col" data-stage=/.test(mode) && /addEventListener\("drop"/.test(mode));
ok('and moved a stage either way with its arrows', /data-action="stage-prev"/.test(mode) && /data-action="stage-next"/.test(mode));
ok('a record\'s detail panel moves it on', /function nextStageButton/.test(mode) && (mode.match(/\$\{nextStageButton\(selected, entity\)\}/g) || []).length === 2);
ok('every move is saved', /function moveRecord[\s\S]*?saveRuntimeData\(spec, data\);/.test(mode));
ok('a workflow shows its stage counts and opens each stage\'s list', /data-action="open-stage"/.test(mode) && /op: "eq", value: actionBtn\.dataset\.stage/.test(mode));
ok('a stage opens the entity\'s list, not a dashboard built on it', /const order = \["list", "split", "kanban"/.test(mode));
ok('a screen with no filter panel says what it is showing, and can show all', /Showing only \$\{/.test(mode) && /id="sysClearFilters">Show all/.test(mode));
ok('no system is handed workflows its model did not design', !/name:"Approval Flow"|name:"Fulfillment"/.test(mode));
ok('the model is asked to tie each workflow to an entity and its stages', (mode.match(/each \{id, name, entity, stages\}/g) || []).length === 2);
ok('and no button pretends to run it', !/run-workflow|>\s*Run\s*</.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/stages.js)`);
process.exit(fail ? 1 : 0);
