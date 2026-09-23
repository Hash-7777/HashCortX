// ==============================================================
// Team shape checks
//
// Loads the REAL src/js/swarm/team-shape.js and the starter templates into a
// Node VM.
//
// The rule: the agent that delivers a team's result is one that runs last,
// never a planner that runs first — however the team names its roles.
//
// Run with: npm run check:swarm-team-shape
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'swarm', 'team-shape.js'), 'utf8'), sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'data', 'swarm-templates.js'), 'utf8'), sandbox);
const T = sandbox.window.HCSwarmTeamShape;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const agent = (id, name, role) => ({ id, name, role });
const names = (list) => list.map((a) => a.name).join(', ');

function acyclic(agents, edges) {
  const out = new Map(agents.map((a) => [a.id, []]));
  edges.forEach((e) => out.get(e.from)?.push(e.to));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 2) return true;
    state.set(id, 1);
    for (const n of out.get(id) || []) if (!visit(n)) return false;
    state.set(id, 2);
    return true;
  };
  return agents.every((a) => visit(a.id));
}

// The team a real portfolio run was given: the planner has the supervisor role
// and is listed first.
const portfolio = [
  agent('a1', 'Lead Planner', 'supervisor'),
  agent('a2', 'Frontend Builder', 'coder'),
  agent('a3', 'Visual Designer', 'coder'),
  agent('a4', 'Interaction Engineer', 'coder'),
  agent('a5', 'Validator', 'validator'),
  agent('a6', 'Final Polisher', 'supervisor'),
];

console.log('A planner with the supervisor role is still a planner:');
{
  const L = T.layersOf(portfolio);
  ok('the planner runs first', names(L.first) === 'Lead Planner');
  ok('the makers are in the middle', names(L.work) === 'Frontend Builder, Visual Designer, Interaction Engineer');
  ok('the validator checks', names(L.review) === 'Validator');
  ok('the final polisher delivers', L.deliverer && L.deliverer.name === 'Final Polisher');
  const all = [...L.first, ...L.work, ...L.review, L.deliverer];
  ok('every agent is in exactly one layer', all.length === portfolio.length && new Set(all).size === portfolio.length);
  const edges = T.edgesOf(L);
  ok('the wiring has no loop to cut', acyclic(portfolio, edges));
  ok('nothing waits on the deliverer', !edges.some((e) => e.from === 'a6'));
  ok('the deliverer gets every maker and the check', ['a2', 'a3', 'a4', 'a5'].every((id) => edges.some((e) => e.from === id && e.to === 'a6')));

  // Control: the rule it replaces took the first agent whose name or role said
  // supervisor, which is the planner.
  const old = portfolio.filter((a) => /boss|supervisor|polish|aggregator/i.test(`${a.name} ${a.role}`))[0];
  ok('control: the old rule chose the planner', old.name === 'Lead Planner');
}

console.log('\nAt run time the result comes from an agent nothing waits on:');
{
  const edges = [
    { from: 'a1', to: 'a2' }, { from: 'a1', to: 'a3' }, { from: 'a1', to: 'a4' },
    { from: 'a2', to: 'a5' }, { from: 'a3', to: 'a5' }, { from: 'a4', to: 'a5' },
    { from: 'a2', to: 'a6' }, { from: 'a3', to: 'a6' }, { from: 'a4', to: 'a6' }, { from: 'a5', to: 'a6' },
  ];
  const saved = T.delivererOf(portfolio, edges, 'a1');
  ok('a saved team that named its planner hands the result to the final polisher', saved.id === 'a6' && saved.kept === false);
  ok('a team that named the right agent keeps it', T.delivererOf(portfolio, edges, 'a6').kept === true);
  ok('with no choice made, an agent that finishes is chosen', T.delivererOf(portfolio, edges, '').id === 'a6');
  const two = [agent('x1', 'Writer', 'writer'), agent('x2', 'Editor', 'critic')];
  ok('with nothing that finishes, the last agent nothing waits on is chosen', T.delivererOf(two, [{ from: 'x1', to: 'x2' }], '').id === 'x2');
  ok('a team with no wiring keeps its choice', T.delivererOf(two, [], 'x1').id === 'x1');
}

console.log('\nOther ways teams name their roles:');
{
  const leadOnly = [agent('b1', 'Researcher', 'researcher'), agent('b2', 'Writer', 'writer'), agent('b3', 'Project Supervisor', 'supervisor')];
  ok('a supervisor that is not a planner delivers', T.layersOf(leadOnly).deliverer.id === 'b3');
  const noFinal = [agent('c1', 'Planner', 'analyst'), agent('c2', 'Coder', 'coder')];
  const L = T.layersOf(noFinal);
  ok('with nobody to finish, the last agent delivers and is not also a planner', L.deliverer.id === 'c2' && !L.first.includes(L.deliverer));
  const makersOnly = [agent('d1', 'Frontend Builder', 'coder'), agent('d2', 'Backend Builder', 'coder'), agent('d3', 'Final Synthesizer', 'supervisor')];
  const M = T.layersOf(makersOnly);
  ok('a team with no planner starts from its first maker', M.first.length === 1 && M.first[0].id === 'd1' && acyclic(makersOnly, T.edgesOf(M)));
}

console.log('\nEvery starter template gets a deliverer that runs last:');
for (const tpl of sandbox.window.HCSwarmTemplates.TEMPLATES || []) {
  const agents = tpl.agents || [];
  const edges = (tpl.dag && tpl.dag.edges) || [];
  const d = T.delivererOf(agents, edges, tpl.finalOutputAgentId || '');
  ok(`${tpl.name}: its deliverer has nothing waiting on it`, !!d.id && !edges.some((e) => e.from === d.id));
}

console.log('\nA team cut to what the task was sized for:');
{
  const five = [{ id: 'a1', name: 'Market Researcher', role: 'researcher' }, { id: 'a2', name: 'Content Creator', role: 'writer' }, { id: 'a3', name: 'Social Media Manager', role: 'custom' }, { id: 'a4', name: 'Critic', role: 'critic' }, { id: 'a5', name: 'Launch Plan Synthesizer', role: 'supervisor' }];
  const cut = T.trimTo(five, 2);
  ok('the deliverer stays, with the agent who makes the work', cut.agents.map((a) => a.name).join() === 'Content Creator,Launch Plan Synthesizer' && cut.deliverer === 'a5');
  ok('the work is handed on to the deliverer', cut.edges.length === 1 && cut.edges[0].from === 'a2' && cut.edges[0].to === 'a5');
  ok('and what was cut is named', cut.dropped.join() === 'Market Researcher,Social Media Manager,Critic');
  ok('a team within its size is left alone', T.trimTo(five, 5) === null && T.trimTo(five.slice(0, 2), 3) === null);
  ok('cut to one, the deliverer alone', T.trimTo(five, 1).agents.map((a) => a.id).join() === 'a5');
}

console.log('\nThe tools an agent is given in a run:');
{
  const t = T.toolsFor({ tools: ['memory', 'web_search', 'remember_fact', 'code_interpreter'] }, false);
  ok('it may read what is remembered about the person, never write to it', t.includes('recall_facts') && !t.includes('remember_fact') && !t.includes('memory') && t.includes('web_search'));
  ok('the agent that delivers searches and fetches nothing, and keeps Python for a file', T.toolsFor({ tools: ['memory', 'web_search', 'fetch_url', 'code_interpreter'] }, true).join() === 'code_interpreter');
  ok('no tools, none given', T.toolsFor({}, false).length === 0);
  const one = T.oneWriter('Write a haiku', 'qwen2.5-coder:3b');
  ok('a short task\'s team is one writer with no tools, on the chosen model, who delivers', one.agents.length === 1 && one.agents[0].tools.length === 0 && one.agents[0].model === 'qwen2.5-coder:3b' && one.finalOutputAgentId === 'a1' && /Never invent a person, a brand/.test(one.agents[0].systemPrompt));
}

console.log('\nWhat an agent on a build is held to:');
{
  const c = (name, role) => T.codeContractFor({ name, role });
  ok('every one of them is held to the build contract', [c('Planner', 'analyst'), c('Frontend Developer', 'coder'), c('Critic', 'validator'), c('Final Polisher', 'supervisor'), c('Helper', 'custom')].every((x) => /STRICT CODE-BUILD CONTRACT/.test(x)));
  ok('a planner writes a brief', /compact implementation brief only/.test(c('Lead Planner', 'analyst')));
  ok('a maker writes the files it owns', /complete frontend code only/.test(c('Frontend Developer', 'coder')));
  ok('a checker writes fixes, not a report', /Do not write a general review report/.test(c('Critic', 'validator')));
  ok('the finisher writes the finished files', /Merge and polish concrete files/.test(c('Final Polisher', 'supervisor')));
  ok('and the Swarm takes it from here, keeping no copy', /HCSwarmTeamShape\.codeContractFor\(agent\)/.test(readFileSync(join(root, 'src/modes/agent-maker/mode.js'), 'utf8')) && !/function codeContractFor/.test(readFileSync(join(root, 'src/modes/agent-maker/mode.js'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/team-shape.js)`);
process.exit(fail ? 1 : 0);
