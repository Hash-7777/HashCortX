// ==============================================================
// Whether a model on this computer fits where it runs — checks
//
// Loads the REAL src/js/local-fit.js. A model that does not fit in the graphics
// chip's memory runs partly on the processor: slower, and heavier on the
// computer. Ollama says how much of a loaded model is in graphics memory;
// these hold that a model that fits, one that runs on the processor alone and
// one that is not loaded say nothing, that one that spills says how much and
// what would help, and that nothing here can break the page when Ollama is
// slow, absent or answers with something else.
//
// Run with: npm run check:local-fit
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {}, JSON, Math, Number, String, Array, Object, Promise, Error, AbortController, setTimeout, clearTimeout };
vm.createContext(box);
vm.runInContext(src('js', 'local-fit.js'), box, { filename: 'local-fit.js' });
const F = box.window.HCLocalFit;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const GB = 1e9;
const answer = (...models) => ({ ok: true, json: async () => ({ models }) });
const loaded = (name, sizeGb, vramGb) => ({ name, model: name, size: sizeGb * GB, size_vram: vramGb * GB });

console.log('Which part of a loaded model is where:');
{
  ok('a model wholly in graphics memory fits', F.judge({ size: 4 * GB, vram: 4 * GB }).state === 'fits');
  ok('...and so does one a hair short of it, which is rounding', F.judge({ size: 4 * GB, vram: 3.95 * GB }).state === 'fits');
  ok('one partly in it spills, with how much runs on the processor', (() => { const v = F.judge({ size: 8 * GB, vram: 6 * GB }); return v.state === 'spills' && Math.round(v.onProcessor * 100) === 25 && Math.round(v.spillGb * 10) === 20; })());
  ok('one with none of it there runs on the processor alone, which is not a spill', F.judge({ size: 4 * GB, vram: 0 }).state === 'cpu');
  ok('more in graphics memory than its size is all of it', F.judge({ size: 4 * GB, vram: 5 * GB }).state === 'fits' && F.judge({ size: 4 * GB, vram: 5 * GB }).onGraphics === 1);
  ok('nothing is made up for a size that is not there', F.judge(null) === null && F.judge({ size: 0, vram: 0 }) === null && F.judge({}) === null);
}

console.log('\nFinding the model in what Ollama lists:');
{
  const list = { models: [loaded('a:7b', 5, 5), loaded('b:3b', 2, 1)] };
  ok('by its name', F.find(list, 'b:3b').size === 2 * GB);
  ok('a model that is not loaded is not found', F.find(list, 'c:1b') === null);
  ok('an answer of another shape is read as none', F.find({ processes: [loaded('b:3b', 2, 1)] }, 'b:3b').vram === 1 * GB && F.find({}, 'b:3b') === null && F.find(null, 'b:3b') === null && F.find({ models: 'x' }, 'b:3b') === null);
  ok('a listing with no sizes says nothing', F.find({ models: [{ name: 'b:3b' }] }, 'b:3b') === null && F.find({ models: [{ name: 'b:3b', size: 'x', size_vram: 1 }] }, 'b:3b') === null);
}

console.log('\nWhat the person is told:');
{
  const w = F.warning('qwen2.5:7b', F.judge({ size: 8 * GB, vram: 6 * GB }), 7.4);
  ok('a model that spills is named, with the share on the processor and what it holds', /^qwen2\.5:7b does not fit in the graphics memory: about 25% of it \(2\.0 GB\) runs on the processor and in main memory/.test(w), w);
  ok('with the load it puts on the computer, and its speed when that is known', /slower and the computer is under more load/.test(w) && /about 7 tokens a second/.test(w));
  ok('and what would fit', /A smaller model, or a shorter conversation, would fit\.$/.test(w));
  ok('the speed is left out when it is not known', !/tokens a second/.test(F.warning('m', F.judge({ size: 8 * GB, vram: 6 * GB }), null)) && !/tokens a second/.test(F.warning('m', F.judge({ size: 8 * GB, vram: 6 * GB }), 0)));
  ok('a model that fits says nothing', F.warning('m', F.judge({ size: 4 * GB, vram: 4 * GB })) === '');
  ok('nor one that runs on the processor alone', F.warning('m', F.judge({ size: 4 * GB, vram: 0 })) === '');
  ok('nor one that could not be told', F.warning('m', null) === '');
}

console.log('\nAsking Ollama:');
{
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, init }); return answer(loaded('m:7b', 8, 6)); };
  ok('a loaded model that spills is told', /m:7b does not fit in the graphics memory/.test(await F.describe('http://h:11434', 'm:7b', { fetchFn })));
  ok('from the list of loaded models, asked afresh, with a time limit', seen[0].url === 'http://h:11434/api/ps' && seen[0].init.cache === 'no-store' && !!seen[0].init.signal);
  ok('one that fits is not', (await F.describe('http://h', 'm:7b', { fetchFn: async () => answer(loaded('m:7b', 8, 8)) })) === '');
  ok('one that is not loaded is not', (await F.describe('http://h', 'x:1b', { fetchFn })) === '');
  ok('a model in the cloud or on another local app is not asked about', (await F.describe('http://h', 'cloud:openai:gpt', { fetchFn })) === '' && (await F.describe('http://h', 'local:lmstudio:x', { fetchFn })) === '' && seen.length === 2);
  ok('no host, no model, nothing asked', (await F.describe('', 'm', { fetchFn })) === '' && (await F.describe('http://h', '', { fetchFn })) === '' && seen.length === 2);
  ok('an app that is off, or answers badly, says nothing and breaks nothing',
    (await F.describe('http://h', 'm:7b', { fetchFn: async () => { throw new TypeError('Failed to fetch'); } })) === ''
    && (await F.describe('http://h', 'm:7b', { fetchFn: async () => ({ ok: false }) })) === ''
    && (await F.describe('http://h', 'm:7b', { fetchFn: async () => ({ ok: true, json: async () => { throw new Error('not json'); } }) })) === ''
    && (await F.describe('http://h', 'm:7b', { fetchFn: async () => undefined })) === '');
  ok('one that never answers is given up on', (await F.describe('http://h', 'm:7b', { ms: 20, fetchFn: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) })) === '');
  box.window.HCLocalSpeed = { tokensPerSecond: (host, model) => (model === 'm:7b' ? 6.2 : null) };
  ok('the speed it has been writing at here is added when the app remembers one', /about 6 tokens a second/.test(await F.describe('http://h', 'm:7b', { fetchFn })));
}

console.log('\nWhere it is used:');
{
  const mode = src('modes', 'code', 'mode.js');
  const boot = src('boot.js');
  ok('the note under the composer joins the one about a small model, and is hidden when there is nothing to say', /const spills = info \? await Promise\.resolve\(window\.HCLocalFit\?\.describe\(window\.HashCortxRuntime\?\.getHost\?\.\(\), model\)\)\.catch\(\(\) => ''\) : '';/.test(mode) && /\.filter\(Boolean\)\.join\(' '\);\n\s+el\.hidden = !el\.textContent;/.test(mode));
  ok('only a model on this computer is asked about', /const spills = info \?/.test(mode) && /const info = \/\^cloud:\/\.test\(model\) \|\| !model \? null/.test(mode));
  ok('it is read again when a run ends, since a model is only listed once it is loaded', /setRouterChip\('Auto', ''\); warnIfSmall\(\);/.test(mode));
  ok('it is loaded with the speed it reads, before the Coder', boot.indexOf("'/js/local-speed.js'") > 0 && boot.indexOf("'/js/local-speed.js'") < boot.indexOf("'/js/local-fit.js'") && boot.indexOf("'/js/local-fit.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('it touches only the request it is given: no page, no storage', !/\bdocument\b|localStorage|sessionStorage/.test(src('js', 'local-fit.js').replace(/\/\/.*$/gm, '')));
  ok('the check is part of npm run check', /npm run check:local-fit/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-fit.js)`);
process.exit(fail ? 1 : 0);
