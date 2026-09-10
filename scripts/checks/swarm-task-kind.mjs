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
const bounds = ['Build a landing page', 'Write a complete essay', 'Write a poem'].map(K.recommendedAgentBounds);
ok('a build gets the largest team', bounds[0].target === 6);
ok('a big assignment a middling one', bounds[1].target === 5);
ok('anything else a small one', bounds[2].target === 4);
ok('the target always lies between the least and the most', bounds.every((b) => b.min <= b.target && b.target <= b.max));

console.log('\nWhat a build owes:');
const plain = K.artifactContractsForTask('Build a landing page for my bakery').map((a) => a.name);
const shop = K.artifactContractsForTask('Build a website shop with checkout and payment').map((a) => a.name);
ok('the page, its styles and its script', ['index.html', 'styles.css', 'app.js'].every((n) => plain.includes(n)));
ok('a site with no server says it needs none', plain.includes('NO_BACKEND_NEEDED') && !plain.includes('server.js'));
ok('a site that takes payments owes a server', shop.includes('server.js') && !shop.includes('NO_BACKEND_NEEDED'));
ok('checkout and payment mean a server', K.taskRequiresBackend('a shop with checkout') && !K.taskRequiresBackend('a landing page'));
ok('an analysis owes a plan, findings and one answer',
  K.artifactContractsForTask('Analyze sales.csv').map((a) => a.name).join() === 'analysis_plan.json,findings.md,final_analysis.md');
ok('every contract names who owes it and in what form',
  ['Build a landing page', 'Analyze sales.csv', 'Write a poem'].every((t) => K.artifactContractsForTask(t).every((a) => a.ownerRole && a.format)));

console.log('\nThe rules it is held to:');
const base = K.qualityGatesForTask('Write a poem');
ok('every task must answer what was asked', base.length === 3 && /directly satisfies/.test(base[0]));
const build = K.qualityGatesForTask('Build a landing page');
ok('a build adds its own rules on top', build.length > base.length && base.every((g) => build.includes(g)));
ok('a server adds one more', K.qualityGatesForTask('Build a website with login').length === build.length + 1);
const codeBudget = K.budgetControlsForTask('Build a landing page');
const plainBudget = K.budgetControlsForTask('Write a poem');
ok('a build passes more between agents', codeBudget.maxContextCharsPerDependency > plainBudget.maxContextCharsPerDependency);
ok('and does not reach for tools by default', codeBudget.allowToolUseByDefault === false && plainBudget.allowToolUseByDefault === true);

console.log('\nA run never rewrites the saved team:');
{
  // A task read as a website build runs with the website rules. They used to
  // be written into the saved team, so one question about CSS took a research
  // team's web search away, added an agent and rewrote every agent's
  // instructions, for good.
  const run = /async function runSwarm\([\s\S]*?\n  \}\n/.exec(mode)?.[0] || '';
  ok('the rules are applied to a copy', /hardenGodBlueprint\(structuredClone\(bp\), task, \[\]\)/.test(run));
  ok('and never to the team itself', !/hardenGodBlueprint\(bp\b/.test(run));
  ok('the copy is what runs and what the run records', /runDAG\(runBp,/.test(run) && /aggregateResults\(runBp,/.test(run) && /startRun\(runBp, task\)/.test(run));
  ok('and the trace says the saved team is unchanged', /the saved team is unchanged/.test(run));
}

console.log('\nThe Agent Swarm reads these from one place:');
ok('it takes them from js/swarm/task-kind.js', /\} = window\.HCSwarmTaskKind;/.test(mode));
ok('and keeps no copy of its own', !/function (isCodeBuildTask|isBigAssignment|classifyTask|artifactContractsForTask)\(/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/task-kind.js)`);
process.exit(fail ? 1 : 0);
