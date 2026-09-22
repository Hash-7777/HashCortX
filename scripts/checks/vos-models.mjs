// ==============================================================
// Virtual OS model choice checks
//
// Loads the REAL src/js/vos/models.js (with js/model-routes.js, which says
// what is local) and holds which model the Virtual OS asks: sizes read from
// names, the job kept on the side it started on, and the chosen model always
// asked first, however small.
//
// Run with: npm run check:vos-models
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Map, Set, Date, JSON, Math };
vm.createContext(sandbox);
vm.runInContext(src('js', 'model-routes.js'), sandbox, { filename: 'model-routes.js' });
vm.runInContext(src('js', 'vos', 'models.js'), sandbox, { filename: 'models.js' });
const M = sandbox.window.HCVosModels;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const opt = (value, label = value) => ({ value, label });
const local7 = opt('qwen2.5-coder:7b');
const localBig = opt('qwen3:235b');
const cloudBig = opt('cloud:groq:openai/gpt-oss-120b', 'GPT OSS 120B');
const cloudPro = opt('cloud:gemini:gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview');
const cloudFlash = opt('cloud:gemini:gemini-3.5-flash', 'Gemini 3.5 Flash');
const all = [local7, localBig, cloudBig, cloudPro, cloudFlash];

console.log('A model\'s size is read from its name:');
ok('7b, 1.5b and a range such as 3.8-27b', M.sizeOf('qwen2.5-coder:7b') === 7 && M.sizeOf('deepseek-r1:1.5b') === 1.5 && M.sizeOf('qwen/qwen3.8-27b:free') === 27);
ok('the largest number in a name with two', M.sizeOf('nemotron-3-super-120b-a12b') === 120);
ok('no size said, none guessed', M.sizeOf('gemini-3.1-pro-preview') === null);
ok('a local 7B coder is small, whatever it is called', M.isSmall(local7) && !M.isLarge(local7));
ok('... and does not outscore a 120B model', M.strength(local7) < M.strength(cloudBig));
ok('"gemini" is not "mini": a Gemini Pro is large, a Flash and a mini are small', M.isLarge(cloudPro) && M.isSmall(cloudFlash) && M.isSmall(opt('cloud:openai:gpt-4o-mini')));
ok('a coder with no size in its name keeps its standing', M.strength(opt('cloud:openrouter:qwen/qwen3-coder:free')) > M.strength(cloudBig));

console.log('\nThe worker is on the side the job started on:');
ok('a cloud job gets a large cloud worker, never the local 7B', M.workerFor(cloudBig.value, all).startsWith('cloud:'));
ok('a local job gets a large local worker', M.workerFor(local7.value, all) === localBig.value);
ok('with nothing larger on its side, the chosen model does the work', M.workerFor(local7.value, [local7, cloudBig]) === local7.value);

console.log('\nThe models asked in turn:');
{
  const r = M.routes(local7.value, 'worker', [local7, cloudBig]);
  ok('the chosen model first, however small', r[0].value === local7.value);
  ok('a local job is never handed to the cloud', r.every((o) => !o.value.startsWith('cloud:')));
  const c = M.routes(cloudFlash.value, 'worker', all).map((o) => o.value);
  ok('a cloud job tries the chosen model, then large cloud ones, never a local one', c[0] === cloudFlash.value && c.includes(cloudBig.value) && c.includes(cloudPro.value) && !c.some((v) => !v.startsWith('cloud:')));
  ok('small fallbacks are left out', !M.routes(cloudBig.value, 'worker', all).some((o) => o.value === cloudFlash.value));
  ok('at most six', M.routes(cloudBig.value, 'worker', Array.from({ length: 12 }, (_, i) => opt(`cloud:groq:model-${i}-120b`))).length === 6);
}

console.log('\nHow the Virtual OS uses it:');
{
  const mode = src('modes', 'virtual-os', 'mode.js');
  ok('the worker and the routes come from it, with no copy left in the mode', /MODELS\(\)\.workerFor\(/.test(mode) && /MODELS\(\)\.routes\(/.test(mode) && !/function modelStrengthScore|function isSmallModelOption/.test(mode));
  ok('it loads before the mode', src('boot.js').indexOf("'/js/vos/models.js'") > 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/vos/models.js)`);
process.exit(fail ? 1 : 0);
