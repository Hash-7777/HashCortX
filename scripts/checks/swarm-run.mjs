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
  ok('an answer with nothing in it throws, so the next model is asked', /if \(!candidateText\.trim\(\) \|\| window\.HCSwarmOutput\.isRefusal\(candidateText\)\) throw Object\.assign\(new Error\(candidateText\.trim\(\) \? "declined the task" : "returned an empty answer"\), \{ empty: true \}\)/.test(agent));
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
  ok('the mode hands the asking its model call and trace', /HCSwarmAsk\.askForDetails\(task, signal, askDeps\(\)\)/.test(bodyOf('askForDetails')));
  ok('what to ask comes from js/swarm/clarify.js', /C\.parseQuestions\(reply\?\.content\)/.test(ask) && /C\.fallbackQuestions\(task\)/.test(ask) && /C\.taskWithAnswers\(task, answers\)/.test(ask));
  ok('the check is time-limited and cancelled with the run', /ROUTES\.callWithin\(45000, signal,/.test(ask));
  const dialog = bodyOf('showAskDialog', askSrc);
  ok('questions are put on the page as text, never as markup', /label\.textContent = q\.question/.test(dialog) && !/innerHTML/.test(dialog));
  ok('Stop closes the questions', /signal\?\.addEventListener\("abort", onStop/.test(dialog));
}

console.log('\nA run asks a model what it owes, and is never stopped by the answer:');
{
  const run = bodyOf('runSwarm');
  const ask = bodyOf('askForDeliverables', askSrc);
  ok('the run asks before the team is built', /const plan = await askForDeliverables\(work, signal\);/.test(run));
  ok('it asks about the task the person is actually running', /askForDeliverables\(work, signal\)/.test(run) && !/askForDeliverables\(task,/.test(run));
  ok('and before any agent runs', run.indexOf('askForDeliverables(') < run.indexOf('runDAG('));
  ok('what comes back is written into the copy the run works from', /const runBp = applyDeliverables\(/.test(run));
  ok('the question comes from js/swarm/deliverables.js', /D\.messages\(task\)/.test(ask) && /D\.readPlan\(reply\?\.content\)/.test(ask));
  ok('the call is time-limited and cancelled with the run', /ROUTES\.callWithin\(45000, signal,/.test(ask));
  ok('it fails over to other models', /routes\.next\(model, err\)/.test(ask));

  // The whole point: nothing about this call can end a run. A free model that
  // never answers costs the run a better list and nothing else.
  ok('an unreadable answer is not an error the run sees', /D\.merge\(answered, task\)/.test(ask));
  ok('it always returns a plan', /return plan;/.test(ask) && !/return null/.test(ask));
  ok('and says which it used', /planned what this run owes/.test(ask) && /Worked out what this run owes from the task/.test(ask));

  const apply = bodyOf('applyDeliverables');
  ok('the plan sets what the team owes', /artifactContracts = DELIVERABLES\.contractsOf\(plan\)/.test(apply));
  ok('the bar it is held to', /qualityGates = plan\.bar/.test(apply));
  ok('and the room it gets, without an older task\'s room winning', /budgetControls = DELIVERABLES\.budgetsFor\(plan\)/.test(apply) && !/\.\.\.\(bpCopy\.budgetControls/.test(apply));

  // A saved team carries the merged result of an earlier task, so without
  // this the old room would win for ever through the spread that exists to
  // keep an architect's own choice.
  ok('a team run on a different request drops its old room too', /delete copy\.budgetControls;/.test(bodyOf('deliverablesForRun')));
}

console.log('\nA run that could not finish does not report that it did:');
{
  const run = bodyOf('runSwarm');
  ok('the agents that could not answer are counted', /const broke = runBp\.agents\.filter\(a => \/\^\(\?:Error\|Skipped\): \//.test(run));
  ok('the trace says so when any did', /unable to answer/.test(run));
  ok('and the status counts only the ones that worked', /Done · \$\{ran\} of \$\{runBp\.agents\.length\} agents/.test(run));
}

console.log('\nThe app reads the work before the person does:');
{
  const report = bodyOf('reportOnWork');
  ok('it asks js/swarm/project-check.js', /HCSwarmProjectCheck/.test(report) && /C\.inspect\(/.test(report));
  ok('it is told what the run owed, so a missing deliverable is found', /owed: \(\(blueprint && blueprint\.artifactContracts\)/.test(report));
  ok('a reading that fails never stops a run', /catch \{ return \[\]; \}/.test(report));
  ok('it changes nothing, it only says', !/withVersion|saveRun|finishRun/.test(report));
}

console.log('\nOne round is asked for what will not work at all:');
{
  const repair = bodyOf('repairWork');
  const run = bodyOf('runSwarm');
  ok('nothing is asked when nothing is broken', /if \(!kept\.run \|\| !found\.some\(f => f\.level === "broken"\)\) return kept;/.test(repair));
  ok('the asking is in js/swarm/ask.js, beside the run\'s other calls', /HCSwarmAsk\.askForRepair\(/.test(repair));
  ok('it is given the project, not the conversation', /HCSwarmRuns\.currentFiles\(kept\.run\)/.test(repair));
  ok('a model that will not answer costs the repair and nothing else', /if \(!answer\) return kept;/.test(repair));
  ok('only the files it names are taken', /named: true/.test(repair));
  ok('the run is already kept before any of this, so nothing can be lost', run.indexOf('finishRun(run,') < run.indexOf('repairWork(kept'));
  ok('the work is read through again afterwards', /reportOnWork\(after\.run, blueprint, true\)/.test(repair));
  ok('a repair that cannot be kept leaves the run as it was', /Could not keep the repair/.test(repair) && /return kept;/.test(repair));
  ok('the status stops saying Done while it is happening', /setRunStatus\("running", "Putting right what was found"\)/.test(repair));
}

console.log('\nAsking for a repair cannot end a run:');
{
  const ask = bodyOf('askForRepair', askSrc);
  ok('nothing is asked with nothing to fix', /if \(!note\) return null;/.test(ask));
  ok('it fails over to other models', /routes\.next\(model, err\)/.test(ask));
  ok('an answer with no files in it is a failure, so the next model is asked', /it returned no files/.test(ask));
  ok('a stop is a stop', /if \(err\.name === "AbortError" \|\| signal\?\.aborted\) return null;/.test(ask));
  ok('and when nothing can be reached, what the team built is kept', /what the team built is kept as it is/.test(ask));
  ok('it is given longer than the planning calls, because it writes whole files', /callWithin\(90000,/.test(ask));
}

console.log('\nA run in which no agent answered is not called done:');
{
  ok('the status says it failed', /const doneLabel = !ran \? "Failed · no agent could answer"/.test(src));
  ok('... and is drawn as an error, not a success', /setRunStatus\(ran \? "done" : "error", doneLabel\)/.test(src) && /updateTraceDot\(ran \? "done" : "error"\)/.test(src));
  ok('the trace says nothing was built, and gives the reason an agent was refused', /No agent could answer, so nothing was built\./.test(src) && /replace\(\/\^Error: \/, ""\)/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed  (src/modes/agent-maker/mode.js)`);
process.exit(fail ? 1 : 0);
