// ==============================================================
// One profile per model family — checks
//
// Loads the real src/js/model-profile.js and holds what each family is
// known to need: whether it thinks, whether its thinking goes back with tool
// work and in which field, which sampling settings it takes, how its results
// are sent. An unknown model gets today's behaviour exactly.
//
// Run with: npm run check:model-profile
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'model-names.js'), sandbox, { filename: 'model-names.js' });
vm.runInContext(src('js', 'code', 'light.js'), sandbox, { filename: 'light.js' });   // the size a model's name says (billionsInName)
vm.runInContext(src('js', 'model-profile.js'), sandbox, { filename: 'model-profile.js' });
const M = sandbox.HCModelProfile;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);
const of = (v, info) => M.of(v, info);
const thinkingCaps = { caps: ['completion', 'tools', 'thinking'] };

console.log('\nAn unknown model gets today\'s behaviour:');
{
  const want = { family: 'unknown', thinks: 'unknown', carry: 'never', carryField: null, sampling: { send: true, temperature: null, top_p: null, top_k: null, own: false }, callsAtOnce: true, resultsTogether: false, markFailed: false, effort: null, strong: false };
  ok('a model no row knows', json(of('cloud:groq:some-new-model')) === json(want), json(of('cloud:groq:some-new-model')));
  ok('...and nothing at all', json(of('')) === json(want) && json(of(null)) === json(want));
}

console.log('\nThinking sent back where the provider asks for it:');
{
  const ds = of('cloud:deepseek:deepseek-reasoner');
  ok('a thinking model from its own maker, which must have its thinking back', ds.family === 'deepseek' && ds.thinks === 'always' && ds.carry === 'required' && ds.carryField === 'reasoning_content' && ds.sampling.send === false, json(ds));
  const chat = of('cloud:deepseek:deepseek-chat');
  ok('...not the same maker\'s model that does not think', chat.family === 'deepseek' && chat.carry === 'never' && chat.sampling.send === true, json(chat));
  const kimi = of('cloud:moonshot:kimi-k2-thinking');
  ok('a thinking model whose guide says to send the whole reply back', kimi.family === 'kimi' && kimi.carry === 'required' && kimi.carryField === 'reasoning_content', json(kimi));
  const glm = of('cloud:zai:glm-4.6');
  ok('a model whose kept thinking is a choice', glm.family === 'glm' && glm.thinks === 'optional' && glm.carry === 'recommended' && glm.carryField === 'reasoning_content', json(glm));
  const resold = of('cloud:openrouter:deepseek/deepseek-r1');
  ok('...but through a service that is not its maker, whose fields may differ, nothing is sent back', resold.family === 'deepseek' && resold.carry === 'never' && resold.carryField === null && resold.sampling.send === false, json(resold));
  const mm = of('cloud:openrouter:minimax/minimax-m2');
  ok('a family whose thinking travels another way keeps today\'s', mm.family === 'minimax' && mm.carry === 'never', json(mm));
}

console.log('\nModels on this computer:');
{
  const q = of('qwen3:8b', thinkingCaps);
  ok('a thinking family that thinks when asked, its own settings kept', q.family === 'qwen3' && q.thinks === 'optional' && q.carry === 'recommended' && q.carryField === 'thinking' && q.sampling.own === true && q.sampling.temperature === 0.6 && q.sampling.top_p === 0.95 && q.sampling.top_k === 20, json(q));
  const coder = of('qwen2.5-coder:7b', { caps: ['completion', 'tools'] });
  ok('a coding model that never thinks', coder.family === 'qwen-coder' && coder.thinks === 'never' && coder.carry === 'never' && coder.carryField === null && coder.sampling.own === true, json(coder));
  ok('...and the newer coding one too', of('qwen3-coder:30b').family === 'qwen-coder');
  const g = of('gemma3:12b', { caps: ['completion'] });
  const gt = of('gemma3:12b', thinkingCaps);
  ok('a family that thinks only where the model says it can', g.family === 'gemma' && g.thinks === 'never' && g.carry === 'never' && gt.thinks === 'optional' && gt.carry === 'recommended' && gt.carryField === 'thinking', `${json(g)} / ${json(gt)}`);
  ok('...told apart for each family named', ['llama3.1:8b', 'phi4:14b', 'mistral-nemo:12b', 'granite3.3:8b', 'nemotron-mini:4b'].map((v) => of(v).family).join() === 'llama,phi,mistral,granite,nemotron');
  ok('a model on this computer that no row knows gets today\'s', of('some-local-model:3b').family === 'unknown' && of('some-local-model:3b').sampling.own === false);
}

console.log('\nCloud families:');
{
  const c = of('cloud:anthropic:claude-opus-4-1');
  ok('one provider: its thinking kept as today until decided, results together and failures marked; asked no thinking here, it takes its temperature', c.family === 'claude' && c.carry === 'never' && c.carryField === 'blocks' && c.resultsTogether === true && c.markFailed === true && c.sampling.send === true, json(c));
  const r = of('cloud:openai:gpt-5');
  ok('a reasoning model: no sampling, an effort it takes', r.family === 'gpt' && r.thinks === 'always' && r.carry === 'never' && r.sampling.send === false && json(r.effort) === '{"field":"reasoning_effort","levels":["low","medium","high"]}', json(r));
  ok('...and an older series like it', of('cloud:openai:o3-mini').sampling.send === false && of('cloud:openai:o4-mini').thinks === 'always');
  const plain = of('cloud:openai:gpt-4o');
  ok('a model of the same maker that does not reason is sent sampling as today', plain.family === 'gpt' && plain.thinks === 'never' && plain.sampling.send === true && plain.effort === null, json(plain));
  const gem = of('cloud:gemini:gemini-3-pro-preview');
  ok('a family whose thinking the app keeps already, at the temperature its guide asks', gem.family === 'gemini' && gem.carry === 'never' && gem.sampling.temperature === 1.0, json(gem));
  ok('a family the app names but knows nothing more of', of('cloud:xai:grok-4').family === 'grok' && of('cloud:xai:grok-4').carry === 'never');
}

console.log('\nStrong enough to start sub-agents (js/code/delegate.js):');
{
  const strong = ['cloud:anthropic:claude-opus-4-1', 'cloud:anthropic:claude-sonnet-4-5', 'cloud:anthropic:claude-3-7-sonnet-latest', 'cloud:openrouter:anthropic/claude-sonnet-4.5',
    'cloud:openai:gpt-5', 'cloud:openai:gpt-5.1', 'cloud:openai:o3', 'cloud:openai:o3-pro', 'cloud:openrouter:openai/gpt-5',
    'cloud:gemini:gemini-2.5-pro', 'cloud:gemini:gemini-3-pro-preview', 'cloud:openrouter:google/gemini-2.5-pro',
    'cloud:deepseek:deepseek-chat', 'cloud:deepseek:deepseek-reasoner', 'cloud:openrouter:deepseek/deepseek-chat-v3.1', 'cloud:openrouter:deepseek/deepseek-v3.2-exp', 'cloud:openrouter:deepseek/deepseek-r1-0528',
    'cloud:moonshot:kimi-k2-thinking', 'cloud:openrouter:moonshotai/kimi-k2',
    'cloud:groq:openai/gpt-oss-120b', 'cloud:openrouter:meta-llama/llama-3.1-405b-instruct', 'cloud:openrouter:qwen/qwen3-235b-a22b', 'gpt-oss:120b', 'deepseek-v3:671b'];
  const notStrong = ['cloud:anthropic:claude-haiku-4-5', 'cloud:anthropic:claude-3-5-haiku-latest', 'cloud:openai:gpt-5-mini', 'cloud:openai:gpt-5-nano', 'cloud:openai:o4-mini', 'cloud:openai:gpt-4o',
    'cloud:gemini:gemini-2.5-flash', 'cloud:gemini:gemini-2.5-flash-lite', 'cloud:groq:deepseek-r1-distill-llama-70b', 'cloud:deepseek:deepseek-coder', 'cloud:moonshot:moonshot-v1-8k',
    'cloud:openrouter:meta-llama/llama-3.3-70b-instruct', 'cloud:xai:grok-4', 'cloud:zai:glm-4.6', 'llama3.3:70b', 'qwen3:8b', 'deepseek-r1:7b', 'qwen2.5-coder:32b', 'x', ''];
  const wrong = strong.filter((v) => of(v).strong !== true);
  ok('rated strong: Claude Opus and Sonnet, GPT-5 and the o models, Gemini Pro, DeepSeek from V3, Kimi, and any model of 120 billion parameters or more', wrong.length === 0, wrong.join(', '));
  const over = notStrong.filter((v) => of(v).strong !== false);
  ok('not: the small and fast versions, older families, families not chosen, and models under 120 billion', over.length === 0, over.join(', '));
  ok('a model on this computer is judged by the size its model app reports, whatever its name', of('house-model:latest', { caps: [], billions: 235 }).strong === true && of('house-model:latest', { caps: [], billions: 32 }).strong === false);
  ok('the size the model app reports wins over the name', of('gpt-oss:120b', { caps: [], billions: 20 }).strong === false);
  ok('a family name alone does not rate a model on this computer: only its size does', of('kimi-k2:latest', { caps: [], billions: 32 }).strong === false);
  ok(`the line is ${M.STRONG_BILLIONS} billion`, M.STRONG_BILLIONS === 120 && of('cloud:openrouter:vendor/house-119b').strong === false && of('cloud:openrouter:vendor/house-120b').strong === true);
}

console.log('\nEvery profile is whole:');
{
  const values = ['cloud:deepseek:deepseek-reasoner', 'cloud:moonshot:kimi-k2-thinking', 'cloud:zai:glm-4.6', 'qwen3:8b', 'qwen2.5-coder:7b', 'gemma3:12b', 'cloud:anthropic:claude-opus-4-1', 'cloud:openai:gpt-5', 'cloud:gemini:gemini-3-pro-preview', 'cloud:xai:grok-4', 'x'];
  const shape = (p) => typeof p.family === 'string' && ['always', 'optional', 'never', 'unknown'].includes(p.thinks) && ['required', 'recommended', 'never'].includes(p.carry)
    && (p.carryField === null || ['reasoning_content', 'thinking', 'blocks'].includes(p.carryField)) && typeof p.sampling === 'object' && typeof p.sampling.send === 'boolean' && typeof p.sampling.own === 'boolean'
    && typeof p.callsAtOnce === 'boolean' && typeof p.resultsTogether === 'boolean' && typeof p.markFailed === 'boolean' && (p.effort === null || Array.isArray(p.effort.levels)) && typeof p.strong === 'boolean';
  const bad = values.filter((v) => !shape(of(v)));
  ok('each has every field, of its kind', bad.length === 0, bad.join(', '));
  ok('a profile handed out cannot change the table', (() => { const p = of('qwen3:8b', thinkingCaps); p.sampling.temperature = 9; return of('qwen3:8b', thinkingCaps).sampling.temperature === 0.6; })());
}

console.log('\nEach model\'s recommended temperature, by the person\'s choice:');
{
  const store = new Map();
  const box = { getItem: (x) => (store.has(x) ? store.get(x) : null), setItem: (x, v) => store.set(x, String(v)), removeItem: (x) => store.delete(x) };
  ok('off until it is switched on', M.familyTemperature(box) === false);
  M.setFamilyTemperature(true, box);
  ok('...on, it is on', M.familyTemperature(box) === true);
  M.setFamilyTemperature(false, box);
  ok('...and off again', M.familyTemperature(box) === false);
  ok('a store that cannot be read leaves it off', M.familyTemperature({ getItem: () => { throw new Error('x'); } }) === false);
  const panel = src('core', 'settings', 'panel.html');
  const pane = (() => { try { return src('core', 'settings', 'model-temperature.js'); } catch { return ''; } })();
  ok('Settings, HashCoder has the switch, off to begin with', /<input type="checkbox" id="cdrSetFamilyTemp" class="check-box" \/>/.test(panel) && /Use each model's recommended temperature/.test(panel));
  ok('...which reads and writes it here, loaded with the other settings panes', /box\.checked = M\(\)\.familyTemperature\(\)/.test(pane) && /M\(\)\.setFamilyTemperature\(box\.checked\)/.test(pane) && src('boot.js').indexOf("'/core/settings/model-temperature.js'") > src('boot.js').indexOf("'/js/model-profile.js'"));
}

console.log('\nThinking on or off, step by step, for a model on this computer:');
{
  const q = of('qwen3:8b', thinkingCaps), coder = of('qwen2.5-coder:7b');
  ok('off until it is measured: nothing is said, as today', M.THINK_PER_STEP === false && M.thinkFor(q, { json: true }) === undefined && M.thinkFor(q, { tools: 5 }) === undefined);
  M.THINK_PER_STEP = true;
  ok('switched on, no thinking for an answer held to a shape, a step held short, or a step with no tools', M.thinkFor(q, { json: true, tools: 5 }) === false && M.thinkFor(q, { most: 900, tools: 5 }) === false && M.thinkFor(q, { tools: 0 }) === false);
  ok('...and the model decides for an ordinary step', M.thinkFor(q, { tools: 5 }) === undefined);
  ok('...and nothing is said to a model that does not think, or one no row knows', M.thinkFor(coder, { json: true }) === undefined && M.thinkFor(of('x'), { json: true }) === undefined);
  M.THINK_PER_STEP = false;
  const app = src('js', 'app.js');
  ok('the local turn asks it, with what the step is', /think: window\.HCModelProfile\?\.thinkFor\?\.\(window\.HCModelProfile\.of\(model, info\), \{ json, most, tools: tools\.length \}\)/.test(app));
}

console.log('\nEffort, by the task:');
{
  const r = of('cloud:openai:gpt-5');
  ok('low for small talk and for a helper that only explores', M.effortFor(r, { smallTalk: true }) === 'low' && M.effortFor(r, { explore: true }) === 'low');
  ok('high for a request of five asks or more, or a plan of five steps or more', M.effortFor(r, { asks: 5 }) === 'high' && M.effortFor(r, { steps: 6 }) === 'high');
  ok('the provider\'s own otherwise, and nothing for a model that takes no effort setting', M.effortFor(r, { asks: 2 }) === null && M.effortFor(of('cloud:groq:some-new-model'), { asks: 9 }) === null && M.effortFor(of('cloud:openai:gpt-4o'), { smallTalk: true }) === null);
}

console.log('\nThe module:');
{
  const boot = src('boot.js');
  ok('it is loaded before the files that will use it', boot.indexOf("'/js/model-profile.js'") > 0 && boot.indexOf("'/js/model-profile.js'") < boot.indexOf("'/js/agent-shape.js'"));
  ok('...and reads a cloud model\'s value with the parser the app has, when it is asked', /window\.HCModelNames/.test(src('js', 'model-profile.js')));
  ok('it is part of npm run check', /npm run check:model-profile/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-profile.js)`);
process.exit(fail ? 1 : 0);
