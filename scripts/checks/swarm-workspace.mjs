// ==============================================================
// Swarm Workspace checks
//
// The Agent Swarm's work lives in the Swarm tab and nowhere else. These checks
// hold that, and grow with the Workspace: the run store, who a message is
// for, and the sandboxed preview each add a section here.
//
// Run with: npm run check:swarm-workspace
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const mode = src('modes', 'agent-maker', 'mode.js');
const code = mode.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const f of [['js', 'fences.js'], ['js', 'swarm', 'project-files.js'], ['js', 'swarm', 'runs.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
}
const R = sandbox.window.HCSwarmRuns;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('The Swarm does not write into the normal chat:');
{
  // A finished run used to be pushed into the normal chat's messages and saved
  // there — into whichever chat happened to be open.
  ok('it never touches the chat\'s messages', !/_H\??\.state\??\.messages/.test(code));
  ok('it never saves a chat', !/persistCurrentChat/.test(code));
  ok('it never redraws the chat', !/_H\??\.render\b/.test(code));
}

console.log('\nA run is kept as a conversation:');
{
  const B = '`'.repeat(3);
  const blueprint = {
    id: 'bp1', name: 'Site', finalOutputAgentId: 'a2', dag: { edges: [{ from: 'a1', to: 'a2' }] },
    agents: [
      { id: 'a1', name: 'Planner', icon: 'P', role: 'analyst', systemPrompt: 'Plan it.', model: 'm1', temperature: 0.5, tools: ['web'] },
      { id: 'a2', name: 'Coder', icon: 'C', role: 'coder', systemPrompt: 'Build it.', model: 'm2', tools: [] },
      { id: 'a3', name: 'Reviewer', icon: 'R', role: 'critic', systemPrompt: 'Check it.' },
    ],
  };
  const run0 = R.newRun({ id: 'run_1', blueprint, task: 'Build a page', now: 1000 });
  ok('the task is the first turn, from you', run0.turns.length === 1 && run0.turns[0].who === 'you' && run0.turns[0].text === 'Build a page');
  ok('the agents are kept with the run', run0.agents.map((a) => a.name).join() === 'Planner,Coder,Reviewer');
  ok('with what is needed to talk to them later', run0.agents[1].systemPrompt === 'Build it.' && run0.agents[1].model === 'm2');
  ok('the lead agent is kept', run0.leadAgentId === 'a2');
  ok('changing the blueprint afterwards does not change the run', (() => {
    blueprint.agents[0].name = 'Renamed'; const kept = run0.agents[0].name; blueprint.agents[0].name = 'Planner'; return kept === 'Planner';
  })());

  const results = {
    a1: 'Plan: one page with a header.',
    a2: `Here:\n\n${B}html index.html\n<h1>Hi</h1>\n${B}\n\n${B}css styles.css\nh1{color:red}\n${B}`,
    a3: 'Skipped: dependency failed (Coder)',
  };
  const finalOutput = `Done.\n\n${B}css styles.css\nh1{color:blue}\n${B}`;
  const run1 = R.recordRun(run0, { results, finalOutput, at: 2000 });
  ok('each agent\'s work is a turn under its own name', run1.turns.slice(1, 4).map((t) => t.who).join() === 'a1,a2,a3');
  ok('an agent that never ran is shown as skipped, not dropped', run1.turns[3].status === 'skipped');
  ok('the team\'s result comes last', run1.turns[4].who === 'team' && run1.turns[4].text === finalOutput);
  ok('the files become version 1', run1.versions.length === 1 && run1.versions[0].rev === 1);
  ok('it holds every file an agent wrote', Object.keys(R.currentFiles(run1)).sort().join() === 'index.html,styles.css');
  ok('and a later correction replaces what it corrects', R.currentFiles(run1)['styles.css'].content === 'h1{color:blue}');
  ok('recording does not change the run it was given', run0.turns.length === 1 && run0.versions.length === 0);

  console.log('\nVersions are never overwritten:');
  const run2 = R.withVersion(run1, { by: 'a2', at: 3000, changed: { 'index.html': { lang: 'html', content: '<h1>Hello</h1>' } } });
  ok('a change makes a new version', run2.versions.length === 2 && run2.versions[1].rev === 2);
  ok('with the changed file', R.currentFiles(run2)['index.html'].content === '<h1>Hello</h1>');
  ok('and the files it did not touch carried over', R.currentFiles(run2)['styles.css'].content === 'h1{color:blue}');
  ok('the version before is still there to go back to', run2.versions[0].files['index.html'].content === '<h1>Hi</h1>');
  ok('it records who made it and what it changed', run2.versions[1].by === 'a2' && run2.versions[1].changed.join() === 'index.html');
  ok('a reply that changes nothing makes no version',
    R.withVersion(run2, { by: 'a2', at: 4000, changed: { 'index.html': { lang: 'html', content: '<h1>Hello</h1>' } } }).versions.length === 2);
  ok('a run with no files has no version', R.recordRun(run0, { results: { a1: 'just words' }, finalOutput: 'still words', at: 1 }).versions.length === 0);

  console.log('\nA result saved before runs existed becomes a run:');
  const legacy = `**Swarm Result — Site**\n\n*Task: Build a page*\n\n---\n\n${B}html index.html\n<p>old</p>\n${B}`;
  const old = R.fromLegacyOutput({ id: 'run_old', blueprint, output: legacy, now: 5 });
  ok('the task is read back out of it', old.turns[0].who === 'you' && old.turns[0].text === 'Build a page');
  ok('the result is kept as the team\'s turn', old.turns[old.turns.length - 1].who === 'team');
  ok('its files are version 1', R.currentFiles(old)['index.html']?.content === '<p>old</p>');
  ok('a legacy result with no task line still becomes a run', R.fromLegacyOutput({ id: 'x', blueprint, output: 'plain', now: 1 }).turns.length === 1);

  ok('run ids are plain and unique per moment', /^run_[a-z0-9]+_[a-z0-9]+$/.test(R.makeRunId(1789000000000, 'ab/c1!2')));
}

console.log(`\n${pass} passed, ${fail} failed  (Swarm Workspace)`);
process.exit(fail ? 1 : 0);
