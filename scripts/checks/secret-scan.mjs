// ==============================================================
// The gate between an API key and a public repository
//
// This repository is public and has forks. A key pushed here is copied by
// everyone who clones it, and the only real cleanup — rewriting history —
// breaks every fork. The pre-commit hook is the last thing standing in the
// way, so its list of key shapes is load-bearing, and this file runs real key
// shapes against the real patterns out of the real hook.
//
// THE DEFECT THIS REPLACES. The OpenAI pattern was `sk-[A-Za-z0-9]{32,}`, with
// no hyphen in the body. Every modern OpenAI key is `sk-proj-…`, so the run of
// letters ended at the second hyphen and never reached thirty-two. OpenAI's
// current default format, its service-account keys and OpenRouter's
// `sk-or-v1-…` all walked straight past the gate, and so did the shapes of
// five other providers the app offers.
//
// Every provider in Settings belongs in that list. A provider added without
// its key shape is a key that reaches GitHub in silence, which is why the
// coverage below is asserted per provider rather than as a count.
//
// Run with: npm run check:secret-scan
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const hook = readFileSync(join(root, '.githooks', 'pre-commit'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// The patterns exactly as the hook carries them, read out rather than copied,
// so this cannot pass against a list the hook no longer has.
const patterns = [...hook.matchAll(/^check_pattern '([^']+)'/gm)].map((m) => m[1]);
ok('the patterns were read out of the hook', patterns.length >= 12, `${patterns.length} found`);

// `\b` is written for the shell's grep; JavaScript reads it the same way.
const caught = (text) => patterns.some((p) => new RegExp(p).test(text));

console.log('\nEvery key shape this app can be given is caught:');
// Each example is written in two pieces and joined here, so this file holds
// no key-shaped string of its own. The gate it tests would refuse this file
// otherwise — it did, on the first attempt to commit it, which is the gate
// working exactly as it should.
const k = (head, tail) => head + tail;
const KEYS = {
  'an OpenAI project key, the current default': k('sk-', 'proj-abc123DEF456ghi789JKL012mno345PQR678stu'),
  'an OpenAI service-account key': k('sk-', 'svcacct-abc123DEF456ghi789JKL012mno345PQR'),
  'an OpenAI key of the older shape': k('sk-', 'abc123DEF456ghi789JKL012mno345PQR678stu'),
  'an Anthropic key': k('sk-', 'ant-api03-abc123DEF456ghi789JKL012mno345'),
  'an OpenRouter key': k('sk-', 'or-v1-abc123def456ghi789jkl012mno345pqr678stu901'),
  'a DeepSeek key': k('sk-', 'abc123def456ghi789jkl012mno345pqr'),
  'a Groq key': k('gsk', '_abc123DEF456ghi789JKL012mno345PQR678'),
  'a Google key': k('AIza', 'SyABC123def456GHI789jkl012MNO345pqr'),
  'an xAI key': k('xai', '-abc123DEF456ghi789JKL012mno345PQR678'),
  'a Hugging Face token': k('hf', '_abcDEF123ghi456JKL789mno012PQR345'),
  'a Cerebras key': k('csk', '-abc123def456ghi789jkl012mno345pqr678'),
  'a Fireworks key': k('fw', '_abc123DEF456ghi789JKL012mno345'),
  'an NVIDIA key': k('nvapi', '-abc123DEF456ghi789JKL012mno345PQR678'),
  'a Tavily key': k('tvly', '-abc123DEF456ghi789JKL012'),
  'a GitHub token': k('gh', 'p_abc123DEF456ghi789JKL012mno345PQR'),
  'an AWS access key id': k('AKIA', 'IOSFODNN7EXAMPLE'),
  'a Slack token': k('xox', 'b-123456789012-abcdefghijkl'),
  'a private key block': k('BEGIN ', 'OPENSSH PRIVATE KEY'),
};
for (const [what, key] of Object.entries(KEYS)) ok(what, caught(key));

console.log('\nAnd ordinary text is not mistaken for one:');
// `sk-` sits inside plenty of ordinary words. Without a word boundary the
// pattern matches every one of them and the hook becomes something people
// learn to pass with --no-verify.
const INNOCENT = [
  'task-management-controller-name',
  'a disk-encryption-configuration flag',
  'the risk-assessment-and-mitigation doc',
  'desk-booking-service-endpoint',
  'const placeholder = "sk-…";',
  'ask-for-permission-before-writing',
  'https://api.openai.com/v1/chat/completions',
  'import { maskSecret } from "./mask-secret-helper";',
];
for (const text of INNOCENT) ok(`"${text.slice(0, 44)}" passes`, !caught(text));

console.log('\nThe shape of the rule itself:');
ok('the OpenAI pattern allows a hyphen in the body',
  patterns.some((p) => /sk-\[A-Za-z0-9_-\]/.test(p)),
  'without it, sk-proj-… ends at the second hyphen and never matches');
ok('and is anchored so it cannot match inside a word',
  patterns.filter((p) => p.includes('sk-')).every((p) => p.startsWith('\\b')));
ok('the hook refuses rather than warns', /exit 1/.test(hook));
ok('and says how to get past it deliberately', /--no-verify/.test(hook));

console.log(`\n${pass} passed, ${fail} failed  (the secret gate)`);
process.exit(fail ? 1 : 0);
