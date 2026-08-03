// ==============================================================
// Usage-log checks
//
// HashMeterAi reads ~/.hashcortx/usage.jsonl and reports it as MEASURED. That
// promise only holds if every path records, and records real counts.
//
// It did not: usage was logged in one place, so cloud chat was counted and
// local Ollama and every Coder-mode turn were not. The total was quietly short
// and nothing looked wrong.
//
// These load the real usageFrom() out of app.js and feed it each provider's
// actual response shape.
//
// Run with: npm run check:usage
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appjs = readFileSync(process.argv[2] || join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');

// Lift the real function out rather than reimplementing it.
const start = appjs.indexOf('  function usageFrom(data) {');
const end = appjs.indexOf('\n  }\n', start) + 4;
if (start < 0 || end < 4) { console.error('could not locate usageFrom in app.js'); process.exit(1); }
const usageFrom = new Function(appjs.slice(start, end) + '; return usageFrom;')();

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const eq = (got, i, o) => got && got.input === i && got.output === o;

console.log('\nEach provider reports counts in its own shape:');
check('OpenAI-compatible (most providers)',
  eq(usageFrom({ usage: { prompt_tokens: 120, completion_tokens: 45 } }), 120, 45));
check('Anthropic', eq(usageFrom({ usage: { input_tokens: 300, output_tokens: 90 } }), 300, 90));
check('Gemini', eq(usageFrom({ usageMetadata: { promptTokenCount: 55, candidatesTokenCount: 12 } }), 55, 12));
check('Ollama', eq(usageFrom({ prompt_eval_count: 800, eval_count: 210 }), 800, 210));

console.log('\nNothing is invented when a provider stays silent:');
check('no usage field at all', usageFrom({ choices: [] }) === null);
check('empty object', usageFrom({}) === null);
check('null and undefined', usageFrom(null) === null && usageFrom(undefined) === null);
check('a non-object', usageFrom('nope') === null);

console.log('\nEvery path that finishes a model turn records:');
const paths = ['streamCloudModel', 'streamChat', 'agentTurnOllama', 'agentTurnOpenAI',
               'agentTurnAnthropic', 'agentTurnGemini'];
for (const name of paths) {
  const s = appjs.indexOf(`function ${name}(`);
  const nextFn = appjs.indexOf('\n  async function ', s + 10);
  const body = appjs.slice(s, nextFn > 0 ? nextFn : s + 20000);
  check(`${name} records usage`, /recordUsage\(/.test(body),
    'a path that does not record makes the reported total short');
}

console.log(`\n${pass} passed, ${fail} failed  (usage log)`);
process.exit(fail ? 1 : 0);
