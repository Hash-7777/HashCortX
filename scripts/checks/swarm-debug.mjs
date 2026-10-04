// ==============================================================
// An Agent Swarm run, written out for debugging — checks
//
// Loads the REAL src/js/swarm/debug-report.js, with the redaction and fencing
// of src/js/code/debug-export.js it shares, and holds that the report says
// what the run was: the blueprint, the team with each agent's model and
// instructions, the trace, every turn with each failure marked, every version
// and the newest files; that nothing shaped like a key reaches it; and that
// the Result offers it and the run keeps its trace for it.
//
// Run with: npm run check:swarm-debug
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'debug-export.js'), sandbox, { filename: 'debug-export.js' });
sandbox.window.HCCodeDebug = sandbox.window.HCCodeDebug;
vm.runInContext(src('js', 'swarm', 'debug-report.js'), sandbox, { filename: 'debug-report.js' });
const R = sandbox.window.HCSwarmDebug;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const KEY = ['sk-', 'proj', 'A1b2C3d4E5f6G7h8'].join('');
const blueprint = { name: 'Corner Bakery', topology: 'hierarchical', aggregation: 'synthesis', finalOutputAgentId: 'lead', dag: { edges: [{ from: 'plan', to: 'lead' }] } };
const run = {
  id: 'r1', task: 'Build a site for a bakery', work: 'Build a site for a bakery', startedAt: Date.UTC(2026, 0, 2, 10, 0, 0),
  plan: { deliverables: ['index.html', 'style.css'] }, leadAgentId: 'lead', edges: [{ from: 'plan', to: 'lead' }],
  agents: [
    { id: 'plan', name: 'Planner', role: 'planner', model: 'cloud:groq:llama-x', temperature: 0.3, tools: ['web_search'], systemPrompt: `Plan the site. Key ${KEY}` },
    { id: 'lead', name: 'Builder', role: 'coder', model: 'qwen2.5-coder:7b', tools: [], systemPrompt: 'Write the files.' },
  ],
  turns: [
    { who: 'you', text: 'Build a site for a bakery', at: Date.UTC(2026, 0, 2, 10, 0, 0), status: 'ok' },
    { who: 'plan', text: 'Error: provider server error (504)', at: Date.UTC(2026, 0, 2, 10, 1, 0), status: 'error' },
    { who: 'lead', text: 'FILE: index.html\n```html\n<h1>Bakery</h1>\n```', at: Date.UTC(2026, 0, 2, 10, 2, 0), status: 'ok' },
    { who: 'team', text: 'The site is built.', at: Date.UTC(2026, 0, 2, 10, 3, 0), status: 'ok' },
  ],
  versions: [{ rev: 1, by: 'team', at: Date.UTC(2026, 0, 2, 10, 3, 0), changed: ['index.html'], files: { 'index.html': { lang: 'html', content: '<h1>Bakery</h1>' } } }],
};
const trace = [{ time: '0.0s', agent: 'Orchestrator', status: 'boss', message: 'Run 1 · blueprint Corner Bakery', tokens: '' }, { time: '61.2s', agent: 'Planner', status: 'err', message: 'Planner failed: 504', tokens: '' }];
const text = R.buildReport({ blueprint, run, trace, label: (v) => `Label ${v}`, facts: { version: 'v9.9.9', platform: 'macos', settings: { 'Local only': 'off' } } });

console.log('The facts at the top:');
ok('the blueprint with its shape, how answers are joined and its size', /- Blueprint: Corner Bakery · hierarchical · answers joined by synthesis · 2 agents/.test(text));
ok('the run: when, passes, turns, versions', /- Run: started 2026-01-02 10:00:00 · 1 pass · 4 turns · 1 version of the files/.test(text));
ok('who failed, named', /- Failed: Planner \(error\)/.test(text));
ok('the app, the platform and the settings', /HashCortx v9\.9\.9 on macos/.test(text) && /- Settings: Local only off/.test(text));
ok('the task, and the plan folded', /## The task\n\n```text\nBuild a site for a bakery\n```/.test(text) && /<summary>What it was to hand back \(the plan\)<\/summary>/.test(text));

console.log('\nThe team, the trace, the conversation, the files:');
ok('each agent with role, model by its label and id, temperature and tools', /\| Planner \| planner \| Label cloud:groq:llama-x \(cloud:groq:llama-x\) \| 0\.3 \| web_search \|/.test(text));
ok('who hands work to whom, and the lead', /Who hands work to whom: Planner → Builder\./.test(text) && /The lead, whose answer is the result: Builder\./.test(text));
ok('each agent\'s instructions, folded', /<summary>Instructions for Planner<\/summary>/.test(text));
ok('the trace as a table, every row', /\| 61\.2s \| Planner \| err \| Planner failed: 504 \|/.test(text) && /\| 0\.0s \| Orchestrator \| boss \|/.test(text));
ok('every turn, a failure marked as one', /### 2 · Planner \(planner\) — failed/.test(text) && /### 1 · the person/.test(text) && /### 4 · the team's result/.test(text));
ok('every version, and the newest files', /- v1, by the team, at 2026-01-02 10:03:00: changed index\.html\./.test(text) && /<summary>index\.html · html · 1 line<\/summary>/.test(text) && /<h1>Bakery<\/h1>/.test(text));

console.log('\nWhat must not reach it:');
ok('a key in an agent\'s instructions is replaced, and the count is said', !text.includes(KEY) && /\[redacted: looked like a key\]/.test(text) && /- Keys: 1 string shaped like a key was replaced/.test(text));

console.log('\nA run that was not kept:');
{
  const t = R.buildReport({ blueprint, run: null, trace, facts: {} });
  ok('it says so, and still carries the trace', /- Run: not kept/.test(t) && /This run was not kept, so only its trace is here\./.test(t) && /Planner failed: 504/.test(t));
}

console.log('\nThe name and the saving:');
ok('the file is named for the blueprint, the day and the time', /^swarm-debug-corner-bakery-\d{4}-\d\d-\d\d-\d{4}\.md$/.test(R.fileName('Corner Bakery')) && /^swarm-debug-swarm-/.test(R.fileName('')));
{
  let saved = null;
  const done = await R.exportReport({ blueprint, run: { ...run, trace }, host: null, label: (v) => v, save: async (name, content, mime) => { saved = { name, content, mime }; return true; }, doc: null });
  ok('a kept run is saved as markdown, with its own trace', done === true && /markdown/.test(saved.mime) && /Planner failed: 504/.test(saved.content));
  const none = await R.exportReport({ blueprint, run: null, host: null, save: async () => true, doc: null });
  ok('with no run and no trace there is nothing to save', none === false);
}

console.log('\nIt is in the Swarm:');
{
  const panel = src('modes', 'agent-maker', 'panel.html');
  const ws = src('js', 'swarm', 'workspace.js');
  const mode = src('modes', 'agent-maker', 'mode.js');
  ok('the Result has an Export for bugs button, wired to the report', /id="amkWsDebug"/.test(panel) && /\$\('amkWsDebug'\)\?\.addEventListener\('click', exportDebug\)/.test(ws) && /window\.HCSwarmDebug\.exportReport\(/.test(ws));
  ok('a finished run keeps the trace it left, for the report', /trace: window\.HCSwarmDebug\.traceRows\(document\.getElementById\("amkTraceEntries"\)\) \}\)\.catch\(\(\) => \{\}\);/.test(mode));
  const boot = src('boot.js');
  ok('it loads after HashCoder\'s export, whose rules it shares, and before the Result', boot.indexOf("'/js/swarm/debug-report.js'") > boot.indexOf("'/js/code/debug-export.js'") && boot.indexOf("'/js/swarm/debug-report.js'") < boot.indexOf("'/js/swarm/workspace.js'"));
  ok('this check is part of npm run check', /npm run check:swarm-debug/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/debug-report.js)`);
process.exit(fail ? 1 : 0);
