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
for (const f of [['js', 'fences.js'], ['js', 'swarm', 'project-files.js'], ['js', 'swarm', 'runs.js'], ['js', 'swarm', 'workspace-view.js'], ['js', 'swarm', 'talk.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
}
const R = sandbox.window.HCSwarmRuns;
const V = sandbox.window.HCSwarmWorkspaceView;
const T = sandbox.window.HCSwarmTalk;
const ws = src('js', 'swarm', 'workspace.js');

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
  ok('a version lists only the files that really changed', (() => {
    const v = R.withVersion(run2, { by: 'a2', at: 5, changed: { 'index.html': { lang: 'html', content: '<h1>Hello</h1>' }, 'styles.css': { lang: 'css', content: 'h1{color:green}' } } });
    return v.versions.length === 3 && v.versions[2].changed.join() === 'styles.css';
  })());
  ok('a change made to an earlier version builds on that version', (() => {
    const v = R.withVersion(run2, { by: 'a1', at: 5, base: run2.versions[0].files, changed: { 'styles.css': { lang: 'css', content: 'h1{color:green}' } } });
    const f = R.currentFiles(v);
    return v.versions.length === 3 && f['index.html'].content === '<h1>Hi</h1>' && f['styles.css'].content === 'h1{color:green}'
      && R.currentFiles(run2)['index.html'].content === '<h1>Hello</h1>';
  })());
  ok('going back to a version and changing nothing makes no version',
    R.withVersion(run2, { by: 'a1', at: 5, base: run2.versions[0].files, changed: {} }).versions.length === 2);
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

console.log('\nWhat an agent wrote is never rendered as live markup:');
{
  // Agent output can carry text from any page an agent read, and the app's
  // security policy permits inline script, so it is escaped and sanitised on
  // the way to HTML by the shared renderer — never by the markdown library
  // alone.
  ok('the Swarm does not call the markdown library directly', !/marked\.parse\(/.test(code) && !/marked\.parse\(/.test(ws));
  ok('the Workspace renders agent text through the shared renderer', /HCMarkdown\.renderUntrusted\(/.test(ws));
  // A file's contents are code, shown as text — never parsed as a page.
  ok('the Workspace sets a file\'s contents only as text', /pre\.textContent = file\.content/.test(ws));
  ok('and writes markup in one place, for rendered agent text', (ws.match(/\.innerHTML\s*=/g) || []).length === 1);
}

console.log('\nWhat the Workspace shows:');
{
  const run = {
    agents: [{ id: 'a1', name: 'Planner', icon: 'P', role: 'analyst' }, { id: 'a2', name: 'Coder', icon: '', role: 'coder' }],
    turns: [
      { who: 'you', text: 'Build it', status: 'ok' },
      { who: 'a1', text: 'plan', status: 'ok' },
      { who: 'a2', text: 'Skipped: dependency failed (Planner)', status: 'skipped' },
      { who: 'ghost', text: 'from an agent since removed', status: 'ok' },
      { who: 'team', text: 'result', status: 'ok' },
    ],
    versions: [{ rev: 1, by: 'team', changed: ['index.html', 'styles.css'] }, { rev: 2, by: 'a2', changed: ['index.html'] }],
  };
  const t = V.turnsView(run);
  ok('your turn reads as yours', t[0].kind === 'you' && t[0].name === 'You');
  ok('an agent\'s turn carries its name, icon and role', t[1].name === 'Planner' && t[1].icon === 'P' && t[1].role === 'analyst');
  ok('an agent that did not run says so', t[2].statusLabel === 'Did not run');
  ok('a turn from an agent no longer in the run still has a name', t[3].name === 'ghost');
  ok('the team\'s result is labelled as the result', t[4].kind === 'team' && t[4].name === 'Team result');

  ok('file tabs start with the page, then styles, then scripts',
    V.fileOrder(['z.txt', 'app.js', 'styles.css', 'about.html', 'index.html']).join() === 'index.html,about.html,styles.css,app.js,z.txt');
  ok('a set of files with a page can be previewed', V.hasPage({ 'index.html': { lang: 'html', content: '' } }));
  ok('one with no page cannot', !V.hasPage({ 'app.py': { lang: 'python', content: '' } }));
  ok('a version is named by who made it and how many files it touched', V.versionLabel(run, run.versions[1]) === 'v2 · Coder · 1 file');
  ok('the first version is the team\'s', V.versionLabel(run, run.versions[0]) === 'v1 · the team · 2 files');

  const now = 1_800_000_000_000;
  ok('a moment ago', V.timeAgo(now - 10_000, now) === 'just now');
  ok('minutes', V.timeAgo(now - 5 * 60_000, now) === '5 min ago');
  ok('hours', V.timeAgo(now - 3 * 3_600_000, now) === '3 h ago');
  ok('one day', V.timeAgo(now - 86_400_000, now) === '1 day ago');
  ok('older is a date', /^\d{4}-\d{2}-\d{2}$/.test(V.timeAgo(now - 30 * 86_400_000, now)));
  ok('a long task is shortened in the run list', V.runLabel({ task: 'x'.repeat(80), startedAt: now }, now).startsWith('x'.repeat(47) + '…'));
  ok('a long turn starts folded', V.startsFolded('line\n'.repeat(40)) && !V.startsFolded('short'));
}

console.log('\nWho a message is for:');
{
  const agents = [
    { id: 'a1', name: 'Code', role: 'coder' },
    { id: 'a2', name: 'Code Reviewer', role: 'critic' },
    { id: 'a3', name: 'Writer', role: 'writer' },
  ];
  const run = { agents, leadAgentId: 'a3', edges: [{ from: 'a1', to: 'a2' }, { from: 'a2', to: 'a3' }], turns: [], versions: [] };
  ok('with no name, it goes to the lead agent', T.addressee(run, 'make it blue').agentId === 'a3');
  ok('and says so', T.addressee(run, 'make it blue').named === false && T.addressee(run, 'make it blue').text === 'make it blue');
  const named = T.addressee(run, '@Code make it blue');
  ok('@Name sends it to that agent', named.agentId === 'a1' && named.named);
  ok('and the name is taken off the message', named.text === 'make it blue');
  ok('the longest name wins, so @Code Reviewer is not read as @Code', T.addressee(run, '@Code Reviewer: check it').agentId === 'a2');
  ok('names are matched without regard to case', T.addressee(run, '@writer tidy up').agentId === 'a3');
  ok('an agent can be named by its id', T.addressee(run, '@a1 hi').agentId === 'a1');
  ok('a name must end where a word ends', T.addressee(run, '@Codex hi').named === false);
  ok('an @ that names nobody stays in the message and goes to the lead', (() => {
    const w = T.addressee(run, '@Nobody hi'); return w.agentId === 'a3' && w.text === '@Nobody hi';
  })());
  ok('a name with nothing after it is a message with nothing in it', T.addressee(run, '@Writer').text === '');

  ok('the lead is the agent the blueprint names', T.leadAgentId(run) === 'a3');
  ok('if that agent is gone, the supervisor', T.leadAgentId({ ...run, leadAgentId: 'gone', agents: [...agents, { id: 's', name: 'Boss', role: 'supervisor' }] }) === 's');
  ok('failing that, the agent at the end of the chain', T.leadAgentId({ ...run, leadAgentId: '', edges: [{ from: 'a3', to: 'a1' }, { from: 'a2', to: 'a1' }] }) === 'a1');
  ok('and a run with no agents has no lead', T.leadAgentId({ agents: [] }) === '');
}

console.log('\nWhat the agent is given:');
{
  const B = '`'.repeat(3);
  const run = {
    task: 'Build a page',
    agents: [{ id: 'a1', name: 'Coder', role: 'coder', systemPrompt: 'You write tidy HTML.' }],
    turns: [{ who: 'you', text: 'Build a page', status: 'ok' }, { who: 'a1', text: 'Done', status: 'ok' }],
    versions: [],
  };
  const files = { 'index.html': { lang: 'html', content: '<h1>Hi</h1>' } };
  const m = T.messagesFor(run, 'a1', 'make it blue', files);
  ok('its own instructions come first', m[0].role === 'system' && m[0].content.startsWith('You write tidy HTML.'));
  ok('and it is told to label only whole files it changes', /labelled with its language and path/.test(m[0].content) && /never label an example/.test(m[0].content));
  ok('then one message: the task, the conversation, the files and the request', m.length === 2 && m[1].role === 'user'
    && /Build a page/.test(m[1].content) && /Coder:\nDone/.test(m[1].content) && m[1].content.includes(`${B}html index.html\n<h1>Hi</h1>\n${B}`));
  ok('the request is last, where it cannot be lost', m[1].content.trimEnd().endsWith('The request:\nmake it blue'));
  ok('nothing is put in the agent\'s mouth', !m.some((x) => x.role === 'assistant'));

  const long = { ...run, turns: Array.from({ length: 40 }, (_, i) => ({ who: 'you', text: `turn ${i} ` + 'x'.repeat(1500), status: 'ok' })) };
  const t = T.transcript(long);
  ok('a long conversation keeps its newest turns', t.includes('turn 39 ') && !t.includes('turn 0 '));
  ok('and says how many earlier turns were left out', /^\[\d+ earlier turns left out\]/.test(t));
  ok('and stays inside its budget', t.length < T.BUDGET.conversationChars + 200);
  ok('a single long turn is cut, and says so', /more characters left out/.test(T.transcript({ ...run, turns: [{ who: 'you', text: 'y'.repeat(5000), status: 'ok' }] })));
  const big = { 'index.html': { lang: 'html', content: 'a'.repeat(50000) }, 'app.js': { lang: 'javascript', content: 'b'.repeat(20000) } };
  const fc = T.fileContext(big);
  ok('files that do not fit are named, not dropped without a word', fc.includes('index.html\n') && /not shown here to save space: app\.js/.test(fc));
  ok('a project with no files says so', T.fileContext({}) === 'There are no files yet.');
}

console.log('\nWhat an answer does to the run:');
{
  const B = '`'.repeat(3);
  let run = R.newRun({ id: 'r', blueprint: { id: 'b', agents: [{ id: 'a1', name: 'Coder' }] }, task: 'Build', now: 1 });
  run = R.withVersion(run, { by: 'team', at: 1, changed: { 'index.html': { lang: 'html', content: '<h1>Hi</h1>' }, 'styles.css': { lang: 'css', content: 'h1{}' } } });
  const reply = `Made it blue.\n\n${B}css styles.css\nh1{color:blue}\n${B}`;
  const a = T.withReply(run, { agentId: 'a1', message: '@Coder make it blue', reply, at: 2 });
  ok('your message and the answer join the conversation', a.run.turns.slice(-2).map((x) => x.who).join() === 'you,a1');
  ok('the file it changed becomes a new version, made by that agent', a.run.versions.length === 2 && a.run.versions[1].by === 'a1' && a.changed.join() === 'styles.css');
  ok('the files it did not touch carry over', R.currentFiles(a.run)['index.html'].content === '<h1>Hi</h1>');
  ok('the run it was given is not changed', run.turns.length === 1 && run.versions.length === 1);

  const example = T.withReply(run, { agentId: 'a1', message: 'how?', reply: `You could write:\n\n${B}css\nh1{color:red}\n${B}`, at: 2 });
  ok('an unlabelled example does not replace a whole file', example.run.versions.length === 1 && R.currentFiles(example.run)['styles.css'].content === 'h1{}');
  ok('and the person is told why nothing changed', example.unnamedCode === true);
  const words = T.withReply(run, { agentId: 'a1', message: 'why?', reply: 'Because it reads better.', at: 2 });
  ok('an answer with no code changes nothing and is not mistaken for one', words.run.versions.length === 1 && !words.unnamedCode && words.changed.length === 0);
  const page = T.withReply(run, { agentId: 'a1', message: 'redo', reply: `${B}html\n<!DOCTYPE html>\n<html><body>new</body></html>\n${B}`, at: 2 });
  ok('a complete page is taken as the page even unlabelled', page.changed.join() === 'index.html');
  const onV1 = T.withReply(a.run, { agentId: 'a1', message: 'bigger', reply: `${B}html index.html\n<h1>Big</h1>\n${B}`, at: 3, base: a.run.versions[0].files });
  ok('a change asked of an earlier version is made to that version', R.currentFiles(onV1.run)['styles.css'].content === 'h1{}' && R.currentFiles(onV1.run)['index.html'].content === '<h1>Big</h1>');
}

console.log('\nAnother pass by the whole team:');
{
  const B = '`'.repeat(3);
  const agents = [{ id: 'a1', name: 'Designer' }, { id: 'a2', name: 'Builder' }];
  const run = { agents, leadAgentId: 'a2', edges: [], turns: [], versions: [] };
  const t = T.addressee(run, '@team make it warmer');
  ok('@team sends it to the whole team', t.team === true && t.text === 'make it warmer');
  ok('so do @all and @everyone', T.addressee(run, '@all: go').team && T.addressee(run, '@Everyone go').team);
  ok('but an agent called Team is still that agent', (() => {
    const w = T.addressee({ ...run, agents: [...agents, { id: 'a3', name: 'Team' }] }, '@team hi'); return !w.team && w.agentId === 'a3';
  })());
  ok('@teammate is not the team', T.addressee(run, '@teammate hi').team === false);
  ok('a message to one agent is not to the team', T.addressee(run, '@Builder hi').team === false && T.addressee(run, 'hi').team === false);

  const files = { 'index.html': { lang: 'html', content: '<h1>Hi</h1>' } };
  const task = T.teamTask({ task: 'Build a tea page' }, 'make it warmer', files);
  ok('the team is given the task it was first asked', task.startsWith('Build a tea page'));
  ok('the feedback', task.includes('Feedback:\nmake it warmer'));
  ok('and the files as they are on screen', task.includes(`${B}html index.html\n<h1>Hi</h1>\n${B}`));
  ok('and told to keep what the feedback does not mention', /keep what the feedback does not mention/.test(task));
  ok('a run with no recorded task still gives the team something to read', T.teamTask({ task: '' }, 'x', {}).startsWith('(The original task'));

  const blueprint = { id: 'bp', finalOutputAgentId: 'a2', dag: { edges: [{ from: 'a1', to: 'a2' }] },
    agents: [{ id: 'a1', name: 'Designer v2', systemPrompt: 'new' }, { id: 'a4', name: 'Tester' }, { id: 'a2', name: 'Builder' }] };
  let r0 = R.newRun({ id: 'r', blueprint: { id: 'bp', agents: [...agents, { id: 'a3', name: 'Gone' }] }, task: 'Build', now: 1 });
  r0 = R.withVersion(r0, { by: 'team', at: 1, changed: { 'index.html': { lang: 'html', content: '<h1>Hi</h1>' }, 'styles.css': { lang: 'css', content: 'h1{}' } } });
  const r1 = R.continueRun(r0, { blueprint, message: '@team make it warmer', now: 2 });
  ok('the pass carries on the same run', r1.id === r0.id && r1.turns.length === r0.turns.length + 1);
  ok('with your message as the next turn', r1.turns[r1.turns.length - 1].who === 'you' && r1.turns[r1.turns.length - 1].text === '@team make it warmer');
  ok('an agent changed since is asked as it is now', r1.agents.find((a) => a.id === 'a1').name === 'Designer v2');
  ok('an agent added since takes part', r1.agents.some((a) => a.id === 'a4'));
  ok('one removed since keeps its name for the turns it has', r1.agents.find((a) => a.id === 'a3')?.name === 'Gone');
  ok('the run it was given is not changed', r0.turns.length === 1 && r0.agents[0].name === 'Designer');
  // The example comes after the labelled file, so it would win if it counted.
  const results = { a1: `${B}css styles.css\nh1{color:brown}\n${B}`, a2: `For instance:\n\n${B}css\nh1{color:orange}\n${B}` };
  const r2 = R.recordRun(r1, { results, finalOutput: 'Done.', at: 3, named: true });
  ok('its work is added under each agent\'s name', r2.turns.slice(-3).map((x) => x.who).join() === 'a1,a2,team');
  ok('the files it names become a new version', r2.versions.length === 2 && R.currentFiles(r2)['styles.css'].content === 'h1{color:brown}');
  ok('and an unlabelled example in the pass replaces nothing', !Object.values(R.currentFiles(r2)).some((f) => /orange/.test(f.content)));
  const r3 = R.recordRun(r1, { results: { a2: `${B}html index.html\n<h1>Warm</h1>\n${B}` }, finalOutput: '', at: 3, named: true, base: r0.versions[0].files });
  ok('a pass asked of an earlier version is made to that version', R.currentFiles(r3)['index.html'].content === '<h1>Warm</h1>' && R.currentFiles(r3)['styles.css'].content === 'h1{}');

  ok('the mode reads the run to continue, not the top bar', /again \? window\.HCSwarmTalk\.teamTask\(again\.run, again\.feedback, again\.base\) : task/.test(mode)
    && /runDAG\(bp, work, signal\)/.test(mode) && /aggregateResults\(bp, rawResults, work, signal\)/.test(mode));
  ok('and keeps the pass in the same run', /again\s*\? window\.HCSwarmRuns\.continueRun\(again\.run/.test(mode) && /finishRun\(run, \{[^}]*base: again\?\.base, named: !!again \}\)/.test(mode));
  ok('the Run button does not hand its click to the run as a run to continue', !/addEventListener\("click", runSwarm\)/.test(mode));
  ok('the Workspace waits for the pass and opens again on the same run', /await deps\.runTeam\(\{[^}]*\}\)[\s\S]*?await open\(blueprint, run\.id\)/.test(ws));
  ok('and clears the message only if the team\'s work was kept', /if \(kept\) \{\s*\$\('amkWsMessage'\)\.value = '';/.test(ws));
  ok('a pass is refused while the swarm is already running', /if \(deps\.teamBusy\(\)\)/.test(ws));
}

console.log('\nThe message box:');
{
  ok('the Workspace asks through what the mode hands it', /deps\.askAgent\(agent, T\.messagesFor\(/.test(ws));
  ok('the mode asks the agent with no tools', /askAgent: async \(agent, messages, signal\) => \(await callAgentLLM\(agent\.model, messages, signal, agent\.temperature\)\)/.test(mode));
  ok('the change is made to the version on screen', /const base = currentFiles\(\);[\s\S]*?T\.withReply\(run, \{[^}]*base \}\)/.test(ws));
  ok('the message is cleared only once the answer is kept', (() => {
    const body = /async function send\(\)[\s\S]*?\n  \}\n/.exec(ws)?.[0] || '';
    const saved = body.indexOf('saveRun(next)'); const cleared = body.indexOf("box.value = ''");
    return saved > 0 && cleared > saved;
  })());
  ok('Stop cancels the request', /state\.asking\?\.controller\.abort\(\)/.test(ws) && /controller\.signal\)/.test(ws));
  ok('the answer is kept against the run it was asked of', /state\.runs = state\.runs\.map\(\(r\) => \(r\.id === next\.id \? next : r\)\)/.test(ws));
}

console.log('\nA site opens in the browser, never inside the app:');
{
  // A page drawn inside the app inherits the app's policy, which in a release
  // runs none of its inline styles or scripts, so the site is opened where it
  // can run as written. The native side writes one fixed file; the caller
  // names no path.
  const platform = src('platform', 'index.js');
  const call = /HC\.invoke\("swarm_site_open",\s*(\{[^}]*\})\)/.exec(platform);
  ok('the platform layer is what opens it', !!call);
  ok('and it hands over the page and nothing else', call && call[1].replace(/\s/g, '') === '{html}');
  ok('the Workspace opens the version on screen', /async function openInBrowser\(\)[\s\S]*?currentFiles\(\)/.test(ws));
  ok('through what the mode hands it, not the platform directly', /deps\.openInBrowser\(/.test(ws) && !/HC\.invoke|swarm_site_open/.test(ws));
  ok('the Workspace never builds a frame to preview in', !/iframe|srcdoc/i.test(ws));
  const rust = readFileSync(join(here, '..', '..', 'src-tauri', 'src', 'commands', 'swarm_site.rs'), 'utf8');
  ok('the command takes the page as its only argument', /pub fn swarm_site_open\(html: String\)/.test(rust));
  ok('and writes under ~/.hashcortx, which the agent cannot touch', /\.join\("\.hashcortx"\)\.join\("swarm"\)\.join\("site\.html"\)/.test(rust));
}

console.log(`\n${pass} passed, ${fail} failed  (Swarm Workspace)`);
process.exit(fail ? 1 : 0);
