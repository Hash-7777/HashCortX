// ============================================================
// Cloud models in the HashCoder benchmark — scripts/bench/coder/cloud.mjs.
// The keys here are made up. Run with: npm run check:bench-cloud
// ============================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const C = await import(join(root, 'scripts', 'bench', 'coder', 'cloud.mjs'));
const P = C.loadProviders(join(root, 'src'));

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const FAKE = 'made-up-value-0123456789';
console.log('Keys come from this terminal, under their own names:');
{
  const got = C.keysFrom({ HASHCORTX_BENCH_KEY_ANTHROPIC: ` ${FAKE} `, HASHCORTX_BENCH_KEY_OPENAI: '', OTHER: 'x' }, P);
  ok('a key set is put where the app keeps it', got.bundle.anthropicKey === FAKE && Object.keys(got.bundle).length === 1 && got.providers.join() === 'anthropic');
  ok('an empty one is not a key', !got.providers.includes('openai'));
  ok('every name is one the app loads', Object.values(C.KEY_NAMES).every((n) => /'[a-zA-Z]+Key'/.test(`'${n}'`) && readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8').includes(`'${n}'`)));
  ok('a provider reached through the native side is never given a key', C.keysFrom({ HASHCORTX_BENCH_KEY_NVIDIA: FAKE, HASHCORTX_BENCH_KEY_SAMBA: FAKE }, P).providers.length === 0);
  ok('the variable is named after the provider', C.envName('gemini') === 'HASHCORTX_BENCH_KEY_GEMINI');
}

console.log('\nWhat may be run, and what the browser may reach:');
{
  ok('a model with no key is refused, saying which variable to set', /set HASHCORTX_BENCH_KEY_OPENAI/.test(C.refusal('cloud:openai:any', P, ['anthropic'])));
  ok('a provider reached through the native side is refused, saying why', /native side/.test(C.refusal('cloud:nvidia:any', P, ['nvidia'])));
  ok('a model with its key is not refused', C.refusal('cloud:anthropic:any', P, ['anthropic']) === '');
  ok('something that is not a cloud model is refused', !!C.refusal('qwen2.5-coder:7b', P, []));
  const hosts = C.hostsFor(['anthropic'], P);
  ok('only the addresses of the providers given', hosts.join() === 'api.anthropic.com', hosts.join());
  ok('a provider with several addresses gets each', C.hostsFor(['moonshot'], P).length > 1);
}

console.log('\nNothing written or printed holds a key:');
{
  const clean = C.scrubber([FAKE]);
  const out = clean({ answer: `used ${FAKE}`, trail: [`401 for sk-proj-${'a'.repeat(20)}`, { deep: `AIza${'B'.repeat(30)}` }], n: 3, ok: true });
  ok('a key given is replaced wherever it is', out.answer === 'used [key]');
  ok('so is anything shaped like a key, however deep', out.trail[0] === '401 for [key]' && out.trail[1].deep === '[key]');
  ok('other values are left as they were', out.n === 3 && out.ok === true);
  const run = readFileSync(join(root, 'scripts', 'bench', 'coder', 'run.mjs'), 'utf8');
  ok('every task record is scrubbed before it is kept or printed', /return scrub\(record\);/.test(run));
  ok('the browser profile that held the keys is deleted after each task', /if \(cloudModels\.length\) fs\.rmSync\(profile, \{ recursive: true, force: true \}\);/.test(run));
  ok('keys are put in the page only when a cloud model is run', /\$\{cloudModels\.length \? `try \{ localStorage\.setItem\('hc_api_bundle_v2'/.test(run));
  ok('and the browser reaches only the providers given', /--proxy-bypass-list=\$\{\['127\.0\.0\.1', 'localhost', \.\.\.CLOUD_HOSTS\]\.join\(';'\)\}/.test(run));
}

console.log(`\n${pass} passed, ${fail} failed  (scripts/bench/coder/cloud.mjs)`);
process.exit(fail ? 1 : 0);
