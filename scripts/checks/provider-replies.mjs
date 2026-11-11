// ==============================================================
// Invented provider replies — checks
//
// lib/provider-replies.mjs holds invented answers in each provider's own
// shape: a reply that carries the model's thinking, a refusal naming a field,
// a refusal for a sampling setting, a refusal for the per-minute limit, and a
// reply with nothing in it. Later checks feed them to the real functions that
// shape a turn, so a change for one provider can be proven with no model and
// no key.
//
// This check holds the library to what it says of itself: each reply has the
// shape it claims, its thinking and its answer are where it says they are,
// and each refusal, made into the error the app makes of it (js/providers.js
// cloudHttpError, as js/app.js does), is read by the real
// js/model-routes.js failureKind and js/model-limits.js readRefusal as what
// it is.
//
// Run with: npm run check:provider-replies
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { SHAPES, thinkingReplies, refusals, emptyReplies, at } from './lib/provider-replies.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['providers.js', 'model-routes.js', 'model-limits.js']) vm.runInContext(src('js', f), sandbox, { filename: f });
const P = sandbox.HCProviders, R = sandbox.HCModelRoutes, L = sandbox.HCModelLimits;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const text = (v) => typeof v === 'string' && v.trim().length > 0;
/** The error js/app.js makes of a refused request. */
const errorOf = (r) => Object.assign(new Error(P.cloudHttpError(r.provider, r.status, JSON.stringify(r.body), r.retryAfter || null)), { status: r.status, body: JSON.stringify(r.body) });

console.log('\nA reply that carries the thinking, in each shape:');
{
  ok('every shape has one', SHAPES.every((s) => thinkingReplies.some((r) => r.shape === s)), SHAPES.filter((s) => !thinkingReplies.some((r) => r.shape === s)).join(', '));
  for (const r of thinkingReplies) {
    ok(`${r.name}: the thinking is where it says`, text(at(r.body, r.thinking)), JSON.stringify(r.thinking));
    ok(`${r.name}: and so is the answer, apart from it`, text(at(r.body, r.answer)) && at(r.body, r.answer) !== at(r.body, r.thinking));
    ok(`${r.name}: it survives being sent as text`, JSON.stringify(JSON.parse(JSON.stringify(r.body))) === JSON.stringify(r.body) && r.status === 200);
  }
}

console.log('\nRefusals, read by the app as what they are:');
{
  for (const r of refusals) {
    const err = errorOf(r);
    const read = L.readRefusal(`${err.body}\n${err.message}`);
    if (r.field) ok(`${r.name}: the field it names is one to leave out`, (read.drop || []).includes(r.field), JSON.stringify(read));
    if (r.tpm) ok(`${r.name}: its limit a minute is read`, read.tpm === r.tpm, JSON.stringify(read));
    ok(`${r.name}: it is a failure of the kind it is`, R.failureKind(err) === r.kind, `${R.failureKind(err)}: ${err.message}`);
  }
  ok('one names a field, one a sampling setting, one the limit a minute', refusals.some((r) => r.field && r.field !== 'temperature') && refusals.some((r) => r.field === 'temperature') && refusals.some((r) => r.tpm));
}

console.log('\nA reply with nothing in it:');
{
  for (const r of emptyReplies) {
    const answer = at(r.body, r.answer);
    ok(`${r.name}: it is a reply, with no words and no call`, r.status === 200 && (answer === '' || answer == null) && !at(r.body, r.calls), JSON.stringify(r.body));
  }
  ok('there is one', emptyReplies.length > 0);
}

console.log('\nThe check is run:');
ok('it is part of npm run check', /npm run check:provider-replies/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (invented provider replies)`);
process.exit(fail ? 1 : 0);
