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
const askSrc = readFileSync(join(here, '..', '..', 'src', 'js', 'swarm', 'ask.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
function bodyOf(name, text = src) {
  const start = text.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  if (start < 0) return '';
  const end = text.indexOf('\n  }\n', start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
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

console.log('\nA new run asks for details only the person can give:');
{
  const run = bodyOf('runSwarm');
  ok('a new run asks before anything is built', /if \(!again\) \{\s*const asked = await askForDetails\(task, signal\);/.test(run) && run.indexOf('askForDetails(task, signal)') < run.indexOf('runDAG('));
  ok('cancelling ends the run before any agent starts', /if \(asked === null\) \{[\s\S]{0,160}Run cancelled before the team started/.test(run));
  ok('the team, and the kept run, get the task with the answers written in', /work = asked;/.test(run) && /startRun\(\{[^\n]*\}, work\)/.test(run));
  const ask = bodyOf('askForDetails', askSrc);
  ok('the mode hands the asking its model call and trace', /HCSwarmAsk\.askForDetails\(task, signal, \{/.test(bodyOf('askForDetails')));
  ok('what to ask comes from js/swarm/clarify.js', /C\.parseQuestions\(reply\?\.content\)/.test(ask) && /C\.fallbackQuestions\(task\)/.test(ask) && /C\.taskWithAnswers\(task, answers\)/.test(ask));
  ok('the check is time-limited and cancelled with the run', /ROUTES\.callWithin\(45000, signal,/.test(ask));
  const dialog = bodyOf('showAskDialog', askSrc);
  ok('questions are put on the page as text, never as markup', /label\.textContent = q\.question/.test(dialog) && !/innerHTML/.test(dialog));
  ok('Stop closes the questions', /signal\?\.addEventListener\("abort", onStop/.test(dialog));
}

console.log(`\n${pass} passed, ${fail} failed  (src/modes/agent-maker/mode.js)`);
process.exit(fail ? 1 : 0);
