// ==============================================================
// Agent Swarm topology and aggregation menus — checks
//
// The canvas toolbar's two menus set a blueprint's topology and aggregation.
// They once listed values nothing else used, so loading any starter template
// left both blank, and choosing an aggregation from the menu set a value the
// run did not recognise, which it quietly treated as synthesis. These hold
// the menus, the templates, the God Agent and the run to one vocabulary.
//
// Run with: npm run check:swarm-menus
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const panel = src('modes', 'agent-maker', 'panel.html');
const mode = src('modes', 'agent-maker', 'mode.js');
const optionsOf = (id) => {
  const m = panel.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  return m ? [...m[1].matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]) : [];
};
const setOf = (name) => {
  const m = mode.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
};
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const topologies = optionsOf('amkTopologySelect');
const aggregations = optionsOf('amkAggregationSelect');
const godTopologies = setOf('validTopologies');
const godAggregations = setOf('validAggregations');

console.log('The menus speak the run\'s vocabulary:');
ok('the topology menu lists what the God Agent may choose', godTopologies.length > 0 && same(topologies, godTopologies), `menu ${topologies} vs ${godTopologies}`);
ok('the aggregation menu lists what the God Agent may choose', godAggregations.length > 0 && same(aggregations, godAggregations), `menu ${aggregations} vs ${godAggregations}`);
const body = mode.slice(mode.indexOf('async function aggregateResults'), mode.indexOf('async function aggregateResults') + 6000);
for (const a of aggregations.filter((x) => x !== 'synthesis')) {
  ok(`the run acts on "${a}"`, body.includes(`strategy === "${a}"`));
}
ok('synthesis is what the run does when no other applies', /bp\.aggregation \|\| "synthesis"/.test(body));

console.log('\nEvery starter template fits the menus:');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('data', 'swarm-templates.js'), sandbox);
for (const t of sandbox.window.HCSwarmTemplates.TEMPLATES) {
  ok(`${t.name}: ${t.topology} / ${t.aggregation}`, topologies.includes(t.topology) && aggregations.includes(t.aggregation));
}

console.log('\nA saved value the menus do not list is still shown:');
{
  const fn = mode.slice(mode.indexOf('function syncTopologySelect()'), mode.indexOf('// ── God Modal'));
  const options = [{ value: 'pipeline' }];
  const sel = { options, value: '', add(o) { options.push(o); } };
  const els = { amkTopologySelect: sel, amkAggregationSelect: { options: [{ value: 'synthesis' }], value: '', add(o) { this.options.push(o); } } };
  const s2 = { document: { getElementById: (id) => els[id] }, Option: function (t, v) { return { text: t, value: v }; }, getActive: () => ({ topology: 'fan-out', aggregation: 'synthesis' }) };
  vm.createContext(s2);
  vm.runInContext(fn + '\nsyncTopologySelect();', s2);
  ok('an older topology is added to the menu and selected', sel.value === 'fan-out' && options.some((o) => o.value === 'fan-out'));
  ok('a listed one is selected without adding anything', els.amkAggregationSelect.value === 'synthesis' && els.amkAggregationSelect.options.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed  (swarm menus)`);
process.exit(fail ? 1 : 0);
