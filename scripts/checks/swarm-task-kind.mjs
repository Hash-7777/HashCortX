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

console.log('\nThe Agent Swarm reads these from one place:');
ok('it takes them from js/swarm/task-kind.js', /\} = window\.HCSwarmTaskKind;/.test(mode));
ok('and keeps no copy of its own', !/function (isCodeBuildTask|isBigAssignment|classifyTask|artifactContractsForTask)\(/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/task-kind.js)`);
process.exit(fail ? 1 : 0);
