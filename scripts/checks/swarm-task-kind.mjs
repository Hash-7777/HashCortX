// ==============================================================
// Swarm task-kind checks
//
// What kind of task a swarm was given decides how many agents a team gets,
// what it owes, and the rules it is held to. These hold the readings that are
// not in question and what each kind asks for.
//
// Run with: npm run check:swarm-task-kind
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'swarm', 'task-kind.js'), sandbox, { filename: 'task-kind.js' });
const K = sandbox.window.HCSwarmTaskKind;
const mode = src('modes', 'agent-maker', 'mode.js');
const kind = src('js', 'swarm', 'task-kind.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('What kind of task it is:');
ok('a landing page is a build', K.classifyTask('Build a landing page for my bakery') === 'code_build');
ok('a website is a build', K.classifyTask('Make me a website for my dentist clinic') === 'code_build');
ok('a bug to fix is debugging', K.classifyTask('Fix the login bug in my app') === 'debugging');
ok('an audit is security', K.classifyTask('Audit our servers for vulnerabilities') === 'security');
ok('a spreadsheet is data analysis', K.classifyTask('Analyze sales.csv') === 'data_analysis');
ok('a report on a market is research', K.classifyTask('Research the electric car market') === 'research');
ok('a launch plan is strategy', K.classifyTask('Plan a product launch') === 'strategy');
ok('a poem is creative', K.classifyTask('Write a poem') === 'creative');
ok('anything else is general', K.classifyTask('Say hello') === 'general');
ok('no task at all is general, not an error', K.classifyTask('') === 'general' && K.classifyTask(null) === 'general');
ok('case does not matter', K.classifyTask('BUILD A LANDING PAGE') === 'code_build');
ok('a build is always a big assignment', K.isBigAssignment('Build a landing page'));
ok('a short poem is not', !K.isBigAssignment('Write a poem'));

console.log('\nWhether it is a website build:');
{
  // A task read as a build runs with the website rules: code-only output, no
  // reports, a page, a stylesheet and a script owed. So a question about the
  // web must not be read as one, and a site asked for in plain words must.
  const builds = [
    'Build a landing page for my bakery', 'Make me a website for my dentist clinic', 'A one-page site for a tea shop',
    'Create a portfolio site', 'Build a to-do app in React', 'Code only: a calculator in HTML, CSS and JavaScript',
    'Write the HTML and CSS for a signup form', 'Design and build an online shop with a cart', 'Can you make a landing page for my gym?',
    'Could you build me a simple game in JavaScript?', 'Generate a dashboard web app for sales data', 'I need a website for my photography business',
    'Create a frontend for my API', 'Build a backend with login and a database for my store', "Rebuild my restaurant's website with a menu page",
    'Full working snake game', 'A personal blog website with dark mode', 'Make a responsive web page about coffee with a gallery',
    'Please build a site for my band', 'Help me build a website for my school club', 'Make a landing page with a pricing plan section',
    'website for a yoga studio', 'Develop a booking website for a barber', 'Set up a simple storefront for my candles',
    'I want an app that tracks my workouts', 'Code a calculator', 'Make a quiz game for kids', 'Our bakery website, with online orders',
  ];
  const not = [
    'What is the difference between HTML and CSS?', 'Explain how a backend works',
    'Research the JavaScript framework market in 2026 and write a report', 'Summarize this CSS spec',
    'Write a report about building web apps', 'Compare React and Vue for a new project', 'How do I build a website?',
    'Write a blog post about CSS grid', "Review my website's copy and suggest improvements", "Analyze my site's traffic data",
    'Write a poem', 'Plan a product launch for our app', 'Fix the login bug in my app', 'Is JavaScript single-threaded?',
    'List the best landing page practices', 'Tell me about the history of the web', 'Write a cover letter for a frontend developer job',
    'Create a marketing plan for my website', 'Write an email announcing our new app', 'Make a list of apps for budgeting',
    'Recommend some games for my kids', 'Make a game plan for the season', 'Find sites that sell loose-leaf tea',
    'Why does my website load slowly?', "Give me ideas for my app's name", 'Translate my website text into French',
    'Write a tweet about our new site', 'Design a logo for my website', 'A report about websites', 'Draft terms of service for my web app',
  ];
  const missed = builds.filter((t) => !K.isCodeBuildTask(t));
  const wrong = not.filter((t) => K.isCodeBuildTask(t));
  ok(`every one of ${builds.length} ways of asking for a site or app is a build`, missed.length === 0);
  if (missed.length) console.log(`          missed: ${missed.join(' | ')}`);
  ok(`none of ${not.length} questions, pieces of writing and other tasks is`, wrong.length === 0);
  if (wrong.length) console.log(`          read as builds: ${wrong.join(' | ')}`);
  // Control: the rule that stood here looked for a word anywhere in the task.
  const old = (d) => /\b(code only|website|web\s*site|webpage|web app|landing page|frontend|front-end|backend|back-end|html|css|javascript|full working|output code)\b/i.test(d);
  ok('control: the old rule read a question about HTML and CSS as a build', old('What is the difference between HTML and CSS?'));
  ok('control: and missed a one-page site and an app in React', !old('A one-page site for a tea shop') && !old('Build a to-do app in React'));
  ok('a question about building is a question', !K.isCodeBuildTask('How do I build a website?'));
  ok('saying so settles it', K.isCodeBuildTask('code only please'));
}

console.log('\nHow big a team it gets:');
const bounds = ['Build a landing page', 'Write a complete essay', 'Plan a product launch', 'Write a poem'].map((t) => K.recommendedAgentBounds(t));
ok('a build gets the largest team', bounds[0].target === 6);
ok('a big assignment a middling one', bounds[1].target === 5);
ok('ordinary work a small team', bounds[2].target === 3 && bounds[2].min === 2);
ok('a short piece or a question one agent, and at most two', bounds[3].target === 1 && bounds[3].min === 1 && bounds[3].max === 2);
ok('the target always lies between the least and the most', bounds.every((b) => b.min <= b.target && b.target <= b.max));
const local = ['Build a landing page', 'Write a complete essay', 'Write a poem'].map((t) => K.recommendedAgentBounds(t, { local: true }));
ok('a local team is kept to a few agents: one computer runs them one after another', local.every((b) => b.max <= 4 && b.target <= 3) && local[2].target === 1);
ok('... ordinary work on one computer is one or two agents', (() => { const b = K.recommendedAgentBounds('Plan a product launch', { local: true }); return b.min === 1 && b.max === 2; })());
ok('... and a team is never told to use more than it may', ['Build a landing page', 'Write a complete essay', 'Plan a product launch', 'Write a poem'].every((t) => { const b = K.recommendedAgentBounds(t, { local: true }); return b.min <= b.target && b.target <= b.max; }));

console.log('\nHow much work a task is:');
const small = ['Write a short product description for a handmade ceramic coffee mug.', 'Give me 5 names for a small bakery in Alexandria.', 'Write a haiku about rain', 'Explain the immune system', 'What is the capital of Australia?', 'Draft an email declining a meeting'];
ok('a short piece or a plain question is small', small.every((t) => K.effortOf(t) === 'small'));
ok('"app", "system" or "complete" in a question is not big work', !K.isBigAssignment('Explain the immune system') && K.isSmallTask('Explain the immune system'));
ok('several sources, sides or parts are more than one agent\'s work', K.effortOf('Research the electric car market and compare the top five brands') === 'normal' && K.effortOf('Write a detailed business plan for a bakery') === 'normal');
ok('a build is big, however briefly asked', K.effortOf('Build a landing page') === 'big' && !K.isSmallTask('Make me a website'));
ok('the designer is told the size, local teams included', /recommendedAgentBounds\(desc, \{ local: window\.HCModelRoutes\.providerOf\(modelValue\) === "local" \}\)/.test(mode));
ok('a small task\'s team is built by the app: one writer, no designer call', /const r = small \? \{ content: "" \}/.test(mode) && /effortOf\(desc\) === "small"\) \{/.test(mode) && /HCSwarmTeamShape\.oneWriter\(desc, modelAt\(0\)\)/.test(mode));
ok('... and no agent in it is given every tool by default', /codeTask \|\| agentBounds\.effort === "small" \? \[\] : \[\.\.\.ALL_TOOL_IDS\]/.test(mode));

console.log('\nWhether a task needs a server:');
ok('checkout and payment mean one', K.taskRequiresBackend('a shop with checkout') && !K.taskRequiresBackend('a landing page'));
ok('so do accounts and a database', K.taskRequiresBackend('a site with login and a database'));

console.log('\nWhat a team owes is no longer decided here:');
// Three fixed lists used to live in this file — the files a build owed, the
// rules it was held to, and how much it could pass along — one set per
// category. Every build got the same three files and the same bar. They are
// worked out from the task in js/swarm/deliverables.js now, and must not come
// back, because a second place to decide this is a second answer.
for (const gone of ['artifactContractsForTask', 'qualityGatesForTask', 'budgetControlsForTask']) {
  ok(`${gone} is gone from here`, K[gone] === undefined && !new RegExp(`function ${gone}\\(`).test(kind));
  ok(`and the Agent Swarm does not call it`, !new RegExp(`\\b${gone}\\(`).test(mode));
}
ok('the Agent Swarm reads them from the deliverables instead', /window\.HCSwarmDeliverables/.test(mode));

console.log('\nA run never rewrites the saved team:');
{
  // A task read as a website build runs with the website rules. They used to
  // be written into the saved team, so one question about CSS took a research
  // team's web search away, added an agent and rewrote every agent's
  // instructions, for good.
  const run = /async function runSwarm\([\s\S]*?\n  \}\n/.exec(mode)?.[0] || '';
  ok('the rules are applied to a copy', /hardenGodBlueprint\(structuredClone\(bp\), task, \[\]\)/.test(run));
  ok('and never to the team itself', !/hardenGodBlueprint\(bp\b/.test(run));
  ok('the copy is what runs and what the run records', /runDAG\(runBp,/.test(run) && /aggregateResults\(runBp,/.test(run) && /startRun\(\{ \.\.\.runBp, finalOutputAgentId:[^\n]*\}, work, plan\)/.test(run));
  ok('and the trace says the saved team is unchanged', /the saved team is unchanged/.test(run));
  // Both paths work on a copy now, because what a team owes is worked out for
  // the task being run. A team saved for one request and run on another used
  // to carry the first request's deliverables into the second.
  ok('a run that is not a build also works on a copy', /deliverablesForRun\(structuredClone\(bp\), work\)/.test(run));
  ok('neither path passes the saved team itself', !/:\s*bp;/.test(run));
  ok('the trace names what the run owes', /This run owes/.test(run));
}
{
  const fn = /function deliverablesForRun\([\s\S]*?\n  \}\n/.exec(mode)?.[0] || '';
  ok('a team run on the request it was made for keeps its architect\'s answer', /madeFor !== running/.test(fn));
  ok('and one run on a different request drops it', /delete copy\.artifactContracts/.test(fn) && /delete copy\.qualityGates/.test(fn));
  ok('the deliverables are then worked out again', /attachPlanningMetadata\(copy,/.test(fn));
}

console.log('\nThe Agent Swarm reads these from one place:');
ok('it takes them from js/swarm/task-kind.js', /\} = window\.HCSwarmTaskKind;/.test(mode));
ok('and keeps no copy of its own', !/function (isCodeBuildTask|isBigAssignment|classifyTask|artifactContractsForTask)\(/.test(mode));

console.log('\nRead on the person\'s own words, not the questions left unanswered:');
{
  const asked = (t, q) => `${t}\n\nNot given: ${q} Where one of these is a choice of taste, make that choice yourself.`;
  const plan = asked('Plan a one-week social media launch for my handmade mug shop.', 'What is your shop\'s name and website? Which platforms do you use? Do you need a full, complete app?');
  ok('a skipped question about a website does not make a plan a build', !K.isCodeBuildTask(plan) && K.classifyTask(plan) === 'strategy');
  ok('... nor its words make the task big', K.effortOf(plan) === 'normal' && !K.isBigAssignment(plan));
  ok('... nor ask for a server', !K.taskRequiresBackend(asked('Write a product description for my mug', 'Which payment provider and checkout do you use?')));
  ok('a short piece stays small whatever the questions said', K.isSmallTask(asked('Write a haiku about rain', 'Do you want a detailed, comprehensive research report?')));
  ok('the request itself is read as before', K.requestOf(plan) === 'Plan a one-week social media launch for my handmade mug shop.' && K.requestOf('Build a website') === 'Build a website' && K.isCodeBuildTask(asked('Build a website for my mug shop', 'What colours?')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/task-kind.js)`);
process.exit(fail ? 1 : 0);
