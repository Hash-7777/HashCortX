// ==============================================================
// Swarm model strength checks
//
// Loads the REAL src/js/swarm/model-strength.js (with js/model-speed.js) and
// holds how a team's models are ranked: family and size from the name, words
// matched whole, and the Swarm's own team designer using it, offered only
// models on the side of the model it is designed on.
//
// Run with: npm run check:swarm-model-strength
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const memory = new Map();
const sandbox = { window: {}, Map, Set, Date, JSON, Math, localStorage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) } };
vm.createContext(sandbox);
vm.runInContext(src('js', 'model-speed.js'), sandbox, { filename: 'model-speed.js' });
vm.runInContext(src('js', 'swarm', 'model-strength.js'), sandbox, { filename: 'model-strength.js' });
const S = sandbox.window.HCSwarmModelStrength;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('How a model is ranked for a team:');
ok('size is read from the name, in billions', S.sizeScore('llama-3.1-405b') === 405 && S.sizeScore('kimi-k2-1t') === 1000 && S.sizeScore('gemini-pro') === 0);
ok('"gemini" is not "mini": a Gemini Pro is not marked down on a big task', S.score('cloud:gemini:gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', true) > S.score('cloud:gemini:gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', false));
ok('... while a real mini, flash or lite model is', S.score('cloud:openai:gpt-4o-mini', 'GPT-4o mini', true) < S.score('cloud:openai:gpt-4o-mini', 'GPT-4o mini', false)
  && S.score('cloud:gemini:gemini-3.5-flash', 'Gemini 3.5 Flash', true) < S.score('cloud:gemini:gemini-3.5-flash', 'Gemini 3.5 Flash', false));
ok('a 120B model outranks a 7B one', S.score('cloud:groq:openai/gpt-oss-120b', 'GPT OSS 120B', true) > S.score('qwen2.5-coder:7b', 'qwen2.5-coder:7b', true));
ok('a model that is not for text never leads', S.score('cloud:gemini:gemini-3-pro-image', 'Gemini 3 Pro Image', true) < 0);
ok('the best of a provider\'s models is the strongest', S.best([{ value: 'cloud:groq:openai/gpt-oss-20b', label: 'GPT OSS 20B' }, { value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B' }], true).value === 'cloud:groq:openai/gpt-oss-120b');

console.log('\nHow the Agent Swarm uses it:');
{
  const mode = src('modes', 'agent-maker', 'mode.js');
  ok('the ranking comes from here, with no copy left in the mode', /window\.HCSwarmModelStrength\.score\(/.test(mode) && !/function modelSizeScore|function modelStrengthScore/.test(mode));
  ok('a team is offered only models on the side of the model it is designed on', /\(window\.HCModelRoutes\.providerOf\(o\.value\) === "local"\) === \(window\.HCModelRoutes\.providerOf\(modelValue\) === "local"\)/.test(mode));
  ok('the questions before a run and the summary after it use the team\'s own model', /const teamModel = \(bp\) => bp\?\.supervisorModel \|\| \(bp\?\.agents \|\| \[\]\)\.find\(a => a\.model\)\?\.model/.test(mode)
    && /chosen: \(\) => teamModel\(getActive\(\)\)/.test(mode) && /const supervisorModel = teamModel\(bp\);/.test(mode));
  ok('the God Agent\'s goal starts as the task already typed', /if \(goal && typed && !goal\.value\.trim\(\)\) goal\.value = typed;/.test(mode));
  ok('the team open last time is open again, or the newest, so Run has one', /const reopen = blueprints\.find\(b => b\.id === readActive\(\)\) \|\| blueprints\[0\]; if \(reopen\) setActive\(reopen\.id\);/.test(mode) && /localStorage\.setItem\(ACTIVE_KEY, id \|\| ""\)/.test(mode));
  ok('it loads before the mode', src('boot.js').indexOf("'/js/swarm/model-strength.js'") > 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/model-strength.js)`);
process.exit(fail ? 1 : 0);
