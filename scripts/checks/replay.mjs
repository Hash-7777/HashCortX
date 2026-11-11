// ==============================================================
// Replaying invented runs through the real context rules
//
// What the model is sent at each step of a run decides two things nobody sees
// on screen: how much it reads, and whether the start of the request can be
// reused from the step before. A request that is the previous one with more
// on the end can be reused up to the new part; a request that changed
// anything earlier is read again from the first change. So a change to the
// context rules can make every run slower and dearer, and pass every other
// check.
//
// This check loads the real src/js/agent-context.js and replays each invented
// run in lib/conversations.mjs as the HashCoder loop does: compressHistory on
// every prefix that ends where the model is called, with the options for each
// size of model (optionsFor). For each step it measures the characters sent,
// and whether the request is the previous one with more on the end.
//
// A step that is not is a rewrite point. Each rewrite point must have one of
// the reasons the rules declare: more results hidden at once, more earlier
// requests rolled into the note, or a note that went on the previous
// request's copy only. Any other rewrite fails.
//
// The number of rewrite points and the characters sent, per run and per size,
// are two-way ratchets, as in app-size.mjs: more fails, and fewer fails until
// the recorded figure is lowered to match. A change that moves them moves
// them in its own commit, deliberately.
//
// REPLAY_STEPS=1 prints every step: its characters and its mark.
//
// Run with: npm run check:replay
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { conversations } from './lib/conversations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', 'src', 'js', 'agent-context.js');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'agent-context.js' });
const { optionsFor, compressHistory } = sandbox.window.HCAgentContext;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** The sizes of model the loop sizes its options for: hashcoder.js sizeOf, and where it runs. */
const SIZES = {
  small: () => optionsFor('small', true),
  mid: () => optionsFor('mid', true),
  local: () => optionsFor('full', true),
  cloud: () => optionsFor('full', false),
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hiddenIn = (req) => req.filter((m) => m && m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('[Earlier result of')).length;
const rolledIn = (req) => {
  const s = req[0] && req[0].role === 'system' ? String(req[0].content) : '';
  const n = /\[Earlier in this conversation, not repeated here: (\d+) earlier request/.exec(s);
  return n ? Number(n[1]) : 0;
};

/**
 * Every request a run sends, in order: the prefix before each answer of the
 * model, with the note the loop puts on that step's copy, if the run has one
 * there, through `compress`.
 */
function requestsOf(run, compress) {
  const out = [];
  run.messages.forEach((m, i) => {
    if (!m || m.role !== 'assistant') return;
    const note = run.notes && run.notes[out.length];
    const prefix = run.messages.slice(0, i);
    out.push({ req: compress(note ? [...prefix, { role: 'user', content: note, note: true }] : prefix), noted: !!note });
  });
  return out;
}

/** Per step: characters sent, and '.' (the previous request with more on the end), a reason, or '?' (a rewrite with no declared reason). */
function replay(run, compress) {
  const steps = [];
  let prev = null;
  for (const { req, noted } of requestsOf(run, compress)) {
    const chars = JSON.stringify(req).length;
    let mark = '.';
    if (prev && !(prev.req.length <= req.length && prev.req.every((m, j) => same(m, req[j])))) {
      mark = hiddenIn(req) > hiddenIn(prev.req) ? 'H' : rolledIn(req) > rolledIn(prev.req) ? 'R' : prev.noted ? 'N' : '?';
    }
    steps.push({ chars, mark });
    prev = { req, noted };
  }
  return steps;
}

// ── The ceilings ─────────────────────────────────────────────────────────
//
// Measured from the rules as they stand. Rewrites, then characters sent in
// the whole run, per size of model. Exact: a run that moves either way fails
// until the figure here is moved with it, in the commit that moved it.
const CEILINGS = {
  "short": { small: [0, 12448], mid: [0, 12448], local: [0, 12448], cloud: [0, 12448] },
  "long": { small: [28, 588900], mid: [21, 799117], local: [13, 1246138], cloud: [8, 1864902] },
  "three-requests": { small: [4, 150178], mid: [1, 190685], local: [0, 255617], cloud: [0, 255617] },
  "mid-way": { small: [7, 124378], mid: [5, 191002], local: [3, 272764], cloud: [1, 378407] },
  "pictures": { small: [10, 160535], mid: [9, 238330], local: [7, 360331], cloud: [5, 496684] },
};

console.log('\nThe detector can fail:');
{
  // A stand-in that marks every message with the step it was sent at changes
  // the start of every request: every step after the first must be a rewrite
  // with no declared reason.
  const run = conversations()[0];
  let n = 0;
  const marked = (msgs) => { n++; return msgs.map((m) => Object.assign({}, m, { step: n })); };
  const steps = replay(run, marked);
  ok('a request that changes its start at every step is caught at every step', steps.length > 2 && steps.slice(1).every((s) => s.mark === '?'), steps.map((s) => s.mark).join(''));
  const steady = replay(run, (msgs) => msgs.slice());
  ok('...and one that only ever grows at the end is not', steady.every((s) => s.mark === '.'), steady.map((s) => s.mark).join(''));
}

for (const run of conversations()) {
  console.log(`\n${run.name}: ${run.about}`);
  for (const [size, opts] of Object.entries(SIZES)) {
    const steps = replay(run, (msgs) => compressHistory(msgs, opts()));
    const rewrites = steps.filter((s) => s.mark !== '.').length;
    const chars = steps.reduce((t, s) => t + s.chars, 0);
    const marks = steps.map((s) => s.mark).join('');
    if (process.env.REPLAY_STEPS) steps.forEach((s, i) => console.log(`        ${size} step ${i + 1}: ${s.chars} ${s.mark}`));
    console.log(`        ${size.padEnd(5)} ${marks}`);
    ok(`${size}: every rewrite has a declared reason`, !marks.includes('?'), marks);
    const at = CEILINGS[run.name] && CEILINGS[run.name][size];
    if (!at) { ok(`${size}: a ceiling is recorded`, false, `none: measured ${rewrites} rewrites, ${chars} characters`); continue; }
    ok(`${size}: rewrite points at the ceiling`, rewrites === at[0], rewrites > at[0] ? `${rewrites}, ceiling ${at[0]}` : `${rewrites}, ceiling ${at[0]}: lower it to ${rewrites}`);
    ok(`${size}: characters sent at the ceiling`, chars === at[1], chars > at[1] ? `${chars}, ceiling ${at[1]}` : `${chars}, ceiling ${at[1]}: lower it to ${chars}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed  (replay of invented runs)`);
process.exit(fail ? 1 : 0);
