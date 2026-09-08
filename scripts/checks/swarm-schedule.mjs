// ==============================================================
// Agent scheduling checks
//
// Loads the REAL src/js/swarm/schedule.js into a Node VM.
//
// The Agent Maker runs a set of agents that depend on each other. Everything
// that goes wrong here goes wrong quietly: an agent that is handed half its
// input still answers, and an agent that never runs at all raises nothing. The
// checks below are about work going missing without a word.
//
// Run with: npm run check:swarm-schedule
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'swarm', 'schedule.js'), 'utf8'),
  sandbox, { filename: 'schedule.js' });
const S = sandbox.window.HCSwarmSchedule;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const set = (...ids) => new Set(ids);

console.log('Dependencies are read off the edges:');
{
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const map = S.dependencyMap(agents, [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]);
  ok('an agent with no edges depends on nothing', map.a.length === 0);
  ok('an agent gathers every edge into it', map.c.length === 2);
  ok('every agent appears in the map', Object.keys(map).length === 3);
  ok('the same edge twice is one dependency',
    S.dependencyMap(agents, [{ from: 'a', to: 'c' }, { from: 'a', to: 'c' }]).c.length === 1);

  // An edge naming an agent that is not in the blueprint would become a
  // dependency that can never complete, stalling everything behind it with no
  // message that explains why.
  ok('an edge from an agent that does not exist is ignored',
    S.dependencyMap(agents, [{ from: 'ghost', to: 'c' }]).c.length === 0);
  ok('an edge to an agent that does not exist is ignored',
    Object.keys(S.dependencyMap(agents, [{ from: 'a', to: 'ghost' }])).length === 3);
  ok('rubbish in the edge list does not throw',
    S.dependencyMap(agents, [null, undefined, {}, 5]).c.length === 0);
  ok('no agents gives an empty map', Object.keys(S.dependencyMap([], [])).length === 0);
  ok('edges that are not a list are ignored', S.dependencyMap(agents, 'lots').c.length === 0);
}

console.log('\nOnly agents whose dependencies are done can run:');
{
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const map = S.dependencyMap(agents, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  ok('at the start only the first can run',
    S.readyAgents(agents, map, set(), set()).map((a) => a.id).join() === 'a');
  ok('once it is done the next can run',
    S.readyAgents(agents, map, set('a'), set()).map((a) => a.id).join() === 'b');
  ok('an agent already done is not offered again',
    !S.readyAgents(agents, map, set('a', 'b'), set()).some((a) => a.id === 'a'));
  ok('an agent that failed is not offered again',
    !S.readyAgents(agents, map, set(), set('a')).some((a) => a.id === 'a'));
  ok('an agent whose dependency failed is not ready',
    !S.readyAgents(agents, map, set(), set('a')).some((a) => a.id === 'b'));
  const wide = S.dependencyMap(agents, []);
  ok('agents with no dependencies all run at once',
    S.readyAgents(agents, wide, set(), set()).length === 3);
}

console.log('\nAn agent that can never run is reported, not forgotten:');
{
  // This is the one that loses work. An agent waiting on a failed one is never
  // ready, so the step finds nothing to dispatch and stops — leaving that agent
  // neither done nor failed, missing from the results, and missing from the
  // final answer with nothing to say a branch was dropped.
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const map = S.dependencyMap(agents, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);

  const stranded = S.strandedAgents(agents, map, set(), set('a'));
  ok('the agent waiting on the failure is reported', stranded.some((x) => x.agent.id === 'b'));
  ok('and so is the one behind it', stranded.some((x) => x.agent.id === 'c'));
  ok('each says what blocked it', stranded.find((x) => x.agent.id === 'b').blockedBy.join() === 'a');
  ok('the failed agent itself is not reported again', !stranded.some((x) => x.agent.id === 'a'));
  ok('nothing is stranded when nothing failed', S.strandedAgents(agents, map, set(), set()).length === 0);
  ok('an agent already done is not stranded',
    !S.strandedAgents(agents, map, set('b'), set('a')).some((x) => x.agent.id === 'b'));
  ok('an agent on a healthy branch is left alone', (() => {
    const four = [...agents, { id: 'd', name: 'D' }];
    const m = S.dependencyMap(four, [{ from: 'a', to: 'b' }, { from: 'd', to: 'c' }]);
    return !S.strandedAgents(four, m, set('d'), set('a')).some((x) => x.agent.id === 'c');
  })());
  ok('a long chain behind a failure is followed all the way', (() => {
    const chain = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase() }));
    const m = S.dependencyMap(chain, [
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e' },
    ]);
    return S.strandedAgents(chain, m, set(), set('a')).length === 4;
  })());

  // Control: looking only one step back finds the first agent behind the
  // failure and none of the ones behind that.
  const oneStep = agents.filter((a) => (map[a.id] || []).some((d) => set('a').has(d)));
  ok('control: checking only direct dependencies misses the rest of the branch',
    oneStep.length === 1 && stranded.length === 2);
}

console.log('\nTwo agents may share a name without losing each other\'s work:');
{
  // Results are handed over under the producing agent's name, and nothing stops
  // two agents having the same one. When two did, one overwrote the other and
  // the agent downstream silently received half of what it was owed.
  const agents = [{ id: 'a', name: 'Research' }, { id: 'b', name: 'Research' }, { id: 'c', name: 'Writer' }];
  const map = S.dependencyMap(agents, [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]);
  const labels = S.labelsFor(agents);
  ok('the first keeps the plain name', labels.a === 'Research');
  ok('the second is told apart', labels.b !== labels.a);
  ok('an agent with its own name is untouched', labels.c === 'Writer');
  ok('an agent with no name still gets a label', !!S.labelsFor([{ id: 'x' }]).x);

  const given = S.dependencyResults(agents[2], map, agents, { a: 'from A', b: 'from B' }, labels);
  ok('both results reach the agent that depends on them', Object.keys(given).length === 2);
  ok('and neither has overwritten the other',
    Object.values(given).includes('from A') && Object.values(given).includes('from B'));

  // Control: keying by the raw name is what lost one of them.
  const byRawName = {};
  for (const depId of map.c) byRawName[agents.find((a) => a.id === depId).name] = depId;
  ok('control: keying by the raw name keeps only one of the two',
    Object.keys(byRawName).length === 1);
}

console.log('\nAn agent that answered with nothing still answered:');
{
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const map = S.dependencyMap(agents, [{ from: 'a', to: 'b' }]);
  const given = S.dependencyResults(agents[1], map, agents, { a: '' });
  ok('an empty answer is passed on', 'A' in given);
  ok('and it is still empty', given.A === '');
  ok('an agent that has not run yet is not passed on',
    Object.keys(S.dependencyResults(agents[1], map, agents, {})).length === 0);

  // Control: testing the result for truth is what dropped it.
  ok('control: keeping only truthy results drops an empty answer', !'');
}

console.log('\nWaiting on a failure reads differently from waiting on work:');
{
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const map = S.dependencyMap(agents, [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]);
  const stillGoing = S.waitingOn(agents[2], map, agents, set(), set(), null);
  ok('an agent waiting on running work lists them as pending', stillGoing.pending.length === 2);
  ok('and none as broken', stillGoing.broken.length === 0);
  const oneDead = S.waitingOn(agents[2], map, agents, set('b'), set('a'), null);
  ok('a failed dependency is named as broken', oneDead.broken.join() === 'A');
  ok('a finished dependency is not listed at all', oneDead.pending.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/schedule.js)`);
process.exit(fail ? 1 : 0);
