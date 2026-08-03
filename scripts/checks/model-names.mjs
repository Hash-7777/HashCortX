// ==============================================================
// Model-identifier checks
//
// Loads the REAL src/js/model-names.js into a Node VM.
//
// This is all string handling over names the app does not control, and every
// mistake in it is quiet. A provider split at the wrong colon sends a request
// nowhere. A tier read too low sends a hard question to a small model and the
// user blames the answer. A name parsed wrong shows something they do not
// recognise in the picker.
//
// Run with: npm run check:model-names
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'model-names.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'model-names.js' });
const M = sandbox.window.HCModelNames;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
function eq(label, got, want) {
  ok(label, got === want, `wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

console.log('\nA model value splits into provider and model:');
{
  eq('simple', M.parseCloudModel('cloud:groq:llama-3.3-70b').provider, 'groq');
  eq('the model id', M.parseCloudModel('cloud:groq:llama-3.3-70b').modelId, 'llama-3.3-70b');
  // The id itself contains colons on OpenRouter and Moonshot, so only the
  // FIRST two segments may be split off.
  eq('an id containing a colon survives whole',
    M.parseCloudModel('cloud:openrouter:meta-llama/llama-3.3-70b:free').modelId,
    'meta-llama/llama-3.3-70b:free');
  eq('a local model has no provider', M.parseCloudModel('llama3').provider, '');
  eq('empty input is safe', M.parseCloudModel('').modelId, '');
  eq('null is safe', M.parseCloudModel(null).provider, '');
}

console.log('\nA model id reads as a name:');
{
  // The version-number trap: separators become spaces, but 3.1 must not.
  eq('a version number survives', M.prettifyModelId('llama-3.1-8b'), 'Llama 3.1 8B');
  eq('and so does a two-part one', M.prettifyModelId('qwen-2.5-32b'), 'Qwen 2.5 32B');
  eq('the vendor prefix is dropped', M.prettifyModelId('meta-llama/llama-3.3-70b'), 'Llama 3.3 70B');
  eq('a free suffix is said in words', M.prettifyModelId('meta-llama/llama-3.3-70b:free'), 'Llama 3.3 70B (free)');
  eq('known acronyms stay upper', M.prettifyModelId('gpt-4o'), 'GPT 4o');
  eq('custom casing is respected', M.prettifyModelId('deepseek-r1'), 'DeepSeek R1');
  eq('and for QwQ', M.prettifyModelId('qwq-32b'), 'QwQ 32B');
  eq('a parameter count is upper-cased', M.prettifyModelId('mistral-7b'), 'Mistral 7B');
  eq('a mixture-of-experts spec', M.prettifyModelId('qwen3-a22b'), 'Qwen3 A22B');
  eq('empty input is safe', M.prettifyModelId(''), '');
  eq('null is safe', M.prettifyModelId(null), '');
}

console.log('\nHow capable a model is, read from its name:');
{
  const T = M.MODEL_TIER;
  eq('a frontier model', M.getModelTier('cloud:openai:gpt-4o', ''), T.frontier);
  eq('a 405B model', M.getModelTier('llama-3.1-405b', ''), T.frontier);
  eq('a 70B model is capable or better', true, M.getModelTier('llama-3.3-70b', '') >= T.capable);
  eq('a 32B model', M.getModelTier('qwen2.5-32b', ''), T.moderate);
  // Recorded as it behaves, not as it ideally would: the family pattern is
  // tried before the "mini/flash/lite" rule, so gpt-4o-mini matches gpt-4o and
  // is treated as frontier. That makes failover consider it a peer of the full
  // model. Pinning it here means changing it later is a deliberate decision
  // with a check to update, rather than a silent shift in which model answers.
  eq('gpt-4o-mini is classed by its family, not by "mini"', M.getModelTier('gpt-4o-mini', ''), T.frontier);
  ok('a flash model is small', M.getModelTier('gemini-1.5-flash', '') === T.small);
  ok('an 8B model is small', M.getModelTier('llama-3.1-8b', '') === T.small);
  ok('an unknown name still gets a tier', typeof M.getModelTier('mystery-model', '') === 'number');
  ok('the label is read as well as the value', M.getModelTier('x', 'Llama 3.1 405B') === T.frontier);
  ok('empty input does not throw', typeof M.getModelTier('', '') === 'number');
}

console.log('\nFailover picks something comparable, not something worse:');
{
  const T = M.MODEL_TIER;
  const pool = [
    { value: 'cloud:groq:small',     provider: 'groq',      tier: T.small },
    { value: 'cloud:openai:frontier',provider: 'openai',    tier: T.frontier },
    { value: 'cloud:gemini:frontier',provider: 'gemini',    tier: T.frontier },
    { value: 'cloud:samba:capable',  provider: 'samba',     tier: T.capable },
  ];
  const best = M.getBestFailoverModel('cloud:openai:gpt-4o', pool);
  ok('it picks a frontier replacement for a frontier model', best.tier === T.frontier);
  // Between equals, a free-tier provider comes first: failover should not
  // quietly move someone onto something that bills them.
  ok('and prefers the free-tier provider between equals', best.provider === 'gemini');

  const excluded = M.getBestFailoverModel('cloud:openai:gpt-4o', pool, new Set(['cloud:gemini:frontier']));
  ok('an excluded model is not offered', excluded.value !== 'cloud:gemini:frontier');
  ok('the current model is never its own replacement',
    M.getBestFailoverModel('cloud:groq:small', [pool[0]]) === null);
  ok('nothing available means nothing returned', M.getBestFailoverModel('x', []) === null);
  ok('an undefined pool is safe', M.getBestFailoverModel('x', undefined) === null);

  // When only smaller models remain, an answer beats no answer.
  const onlySmall = M.getBestFailoverModel('cloud:openai:gpt-4o', [pool[0]]);
  ok('it falls back to a smaller model rather than giving up', onlySmall === pool[0]);
}

console.log('\nModels the app does not offer stay out of the list:');
{
  ok('matched by value', M.isExcludedCloudModel({ value: 'cloud:x:baidu-ernie' }) === true);
  ok('matched by label', M.isExcludedCloudModel({ label: 'Qianfan Large' }) === true);
  ok('an ordinary model is kept', M.isExcludedCloudModel({ value: 'cloud:groq:llama' }) === false);
  ok('an empty object is kept', M.isExcludedCloudModel({}) === false);
  const filtered = M.visibleCloudModels([{ value: 'a' }, { value: 'baidu-x' }, { value: 'b' }]);
  ok('filtering removes only those', filtered.length === 2);
  ok('an undefined list is safe', M.visibleCloudModels(undefined).length === 0);
}

console.log('\nA catalogued model uses its catalogue name:');
{
  const catalogue = [{ models: [{ value: 'cloud:groq:llama-3.3-70b', label: 'Llama 3.3 70B', imageGen: false },
                                { value: 'cloud:x:draw', label: 'Drawer', imageGen: true }] }];
  eq('from the catalogue', M.cloudModelLabel('cloud:groq:llama-3.3-70b', catalogue), 'Llama 3.3 70B');
  // A model discovered from a provider's own list is not in the catalogue and
  // still needs a readable name.
  eq('not in the catalogue', M.cloudModelLabel('cloud:groq:new-model', catalogue), 'new-model · groq');
  eq('a local model is its own name', M.cloudModelLabel('llama3', catalogue), 'llama3');
  eq('empty input is safe', M.cloudModelLabel('', catalogue), '');
  ok('an image model is recognised', M.isImageGenModel('cloud:x:draw', catalogue) === true);
  ok('a text model is not', M.isImageGenModel('cloud:groq:llama-3.3-70b', catalogue) === false);
  ok('an unknown model is not', M.isImageGenModel('cloud:x:unknown', catalogue) === false);
  ok('no catalogue is safe', M.isImageGenModel('cloud:x:draw', undefined) === false);
}

console.log('\nAn Ollama listing names its model in whichever field it uses:');
{
  eq('a plain string', M.ollamaModelName('llama3'), 'llama3');
  eq('the name field', M.ollamaModelName({ name: 'llama3' }), 'llama3');
  eq('the model field', M.ollamaModelName({ model: 'llama3' }), 'llama3');
  eq('the id field', M.ollamaModelName({ id: 'llama3' }), 'llama3');
  eq('nothing usable', M.ollamaModelName({}), '');
  eq('null is safe', M.ollamaModelName(null), '');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-names.js)`);
process.exit(fail ? 1 : 0);
