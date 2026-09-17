// ==============================================================
// Agent Swarm run checks
//
// Reads src/modes/agent-maker/mode.js for the rules a run keeps, where the
// behaviour lives in the mode rather than in a module that can be loaded.
// The rules themselves are exercised in scripts/checks/model-routes.mjs
// (a call cancelled when time is up) and in the headless run recorded in
// each commit.
//
// Run with: npm run check:swarm-run
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'modes', 'agent-maker', 'mode.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
function bodyOf(name) {
  const start = src.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  if (start < 0) return '';
  const end = src.indexOf('\n  }\n', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

console.log('An agent that runs out of time is cancelled, not left running:');
{
  const agent = bodyOf('executeOneAgent');
  ok('the model call goes through callWithin, which aborts it', /HCModelRoutes\.callWithin\(timeoutMs, signal,/.test(agent));
  ok('and no timer is raced against it any more', !/Promise\.race\(\[\s*callAgentLLM/.test(agent));
}

console.log('\nAn empty answer is a failure, not a result:');
{
  const agent = bodyOf('executeOneAgent');
  ok('an answer with nothing in it throws, so the next model is asked', /if \(!candidateText\.trim\(\)\) throw Object\.assign\(new Error\("returned an empty answer"\), \{ empty: true \}\)/.test(agent));
  ok('running out of tool rounds with no answer throws too', /used every tool round without an answer/.test(agent));
  ok('"(no output)" is never handed on as an agent\'s work', !/\(no output\)/.test(agent));
}

console.log('\nThe agent that runs last delivers the result:');
{
  ok('a hardened team is laid out by js/swarm/team-shape.js', /TEAM\.layersOf\(parsed\.agents\)/.test(bodyOf('hardenGodBlueprint')) && /parsed\.dag\.edges = TEAM\.edgesOf\(layers\)/.test(bodyOf('hardenGodBlueprint')));
  ok('the old supervisor-means-deliverer rule is gone', !/const isFinalOwner = \(a\) =>/.test(src));
  ok('every run picks its deliverer from what nothing waits on', /HCSwarmTeamShape\.delivererOf\(agents, edges, bp\.finalOutputAgentId\)/.test(bodyOf('runDAG')));
  ok('the agent told to deliver is that one', /finalOutputAgentId: choice\.deliverer/.test(bodyOf('runDAG')));
  ok('and the result is its answer, unless it failed', /o\.id === delivererId && !\/\^\(\?:Error\|Skipped\): \/\.test/.test(bodyOf('aggregateResults')));
  ok('the God Agent is not told to make a planner the deliverer', !/lead planner\/supervisor as finalOutputAgentId/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed  (src/modes/agent-maker/mode.js)`);
process.exit(fail ? 1 : 0);
