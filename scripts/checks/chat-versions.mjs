// ==============================================================
// Versions of a message in a chat — checks
//
// Loads the REAL src/js/chat/versions.js and holds that editing a message
// keeps the chat one chat, the message as it was and every message after it
// kept as its first version; that moving between versions brings back the
// conversation that went with each, and moving back brings back what was
// written since; that a regenerated answer keeps the one it replaces; that
// one that failed before it began shows the old one again; that versions
// within versions are kept; that what is saved holds each version once;
// and that chat edits, regenerates, saves and draws through it.
//
// Run with: npm run check:chat-versions
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'versions.js'), sandbox, { filename: 'versions.js' });
const V = sandbox.HCVersions;
const say = (list) => list.map((m) => m.content).join(' | ');
const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });

console.log('Editing a message:');
let chat = [u('plan a trip to Rome'), a('Day one: the Forum'), u('add a day in Florence'), a('Day four: the Uffizi')];
chat = V.branch(chat, 0, u('plan a trip to Paris'));
ok('the edit takes the message\'s place, and what followed it leaves the chat shown', say(chat) === 'plan a trip to Paris');
ok('...the message as it was, and all that followed it, kept as its first version', V.of(chat[0]).at === 2 && V.of(chat[0]).count === 2 && say(chat[0].versions[0].tail) === 'Day one: the Forum | add a day in Florence | Day four: the Uffizi');
chat.push(a('Day one: the Louvre'));
const back = V.show(chat, 0, 0);
ok('moving to the first version brings back its conversation, whole', say(back) === 'plan a trip to Rome | Day one: the Forum | add a day in Florence | Day four: the Uffizi' && V.of(back[0]).at === 1);
const again = V.show(back, 0, 1);
ok('...and moving back brings back what was written since the edit', say(again) === 'plan a trip to Paris | Day one: the Louvre' && V.of(again[0]).at === 2);
ok('the same version, or one that is not there, changes nothing', say(V.show(again, 0, 1)) === say(again) && say(V.show(again, 0, 7)) === say(again));
const third = V.branch(again, 0, u('plan a trip to Lisbon'));
ok('a third edit is a third version, the other two kept', V.of(third[0]).count === 3 && say(V.show(third, 0, 1)) === 'plan a trip to Paris | Day one: the Louvre');

console.log('\nRegenerating an answer:');
{
  let c = [u('a haiku about rain'), a('soft rain on the roof'), u('now one about snow'), a('white hush on the hill')];
  const kept = V.snapshot(c, 1);
  c = c.slice(0, 1);
  c.push(a('grey sky, puddles grow'));
  c = V.adopt(c, 1, kept);
  ok('the new answer is the newest version, the old one and what followed it kept', say(c) === 'a haiku about rain | grey sky, puddles grow' && V.of(c[1]).count === 2 && say(V.show(c, 1, 0)) === 'a haiku about rain | soft rain on the roof | now one about snow | white hush on the hill');
  const failed = V.adopt([u('a haiku about rain')], 1, V.snapshot([u('a haiku about rain'), a('soft rain on the roof'), u('more')], 1));
  ok('an answer that failed before it began shows the old one again, and what followed it', say(failed) === 'a haiku about rain | soft rain on the roof | more' && !V.of(failed[1]));
}

console.log('\nVersions within versions:');
{
  let c = [u('one'), a('r1'), u('two'), a('r2')];
  c = V.branch(c, 2, u('two, changed'));
  c.push(a('r2b'));
  c = V.branch(c, 0, u('one, changed'));
  c.push(a('r1b'));
  const first = V.show(c, 0, 0);
  ok('an earlier version keeps the versions made inside it', say(first) === 'one | r1 | two, changed | r2b' && V.of(first[2]).count === 2 && say(V.show(first, 2, 0)) === 'one | r1 | two | r2');
}

console.log('\nWhat is saved:');
{
  const clean = (m) => ({ role: m.role, content: m.content });
  let c = [u('q'), a('first')];
  c = V.branch(c, 0, u('q, edited'));
  c.push(a('second'));
  const saved = V.forStorage(c[0], clean);
  ok('each version once: the one shown holds nothing the chat already holds', saved.length === 2 && saved[1].tail.length === 0 && saved[1].message.content === 'q, edited' && saved[0].tail[0].content === 'first');
  ok('...and a message with no other version saves none', V.forStorage(a('x'), clean) === undefined && V.of(a('x')) === null);
  ok('a version keeps the message without its versions inside it', !('versions' in V.strip(c[0])) && !('version' in V.strip(c[0])));
}

console.log('\nIn chat:');
{
  const app = src('js', 'app.js');
  ok('an edit stays in the same chat, the old version kept, not copied into a new chat', /state\.messages = HCVersions\.branch\(state\.messages, editedIdx, prepareEditBranch\(editedIdx, text\)\[editedIdx\]\);/.test(app) && !/state\.currentChatId = uid\(\);\n\s*state\.messages = prepareEditBranch/.test(app));
  ok('Regenerate keeps the answer it replaces, in the same chat, and only if that chat is still open', /const kept = HCVersions\.snapshot\(state\.messages, idx\), chatId = state\.currentChatId;/.test(app) && / if \(state\.currentChatId === chatId\) \{ state\.messages = HCVersions\.adopt\(state\.messages, idx, kept\); persistCurrentChat\(\); render\(\); \}/.test(app));
  ok('a chat is saved with its versions, each cleaned as a message is', /\.map\(function clean\(m\) \{ return \{/.test(app) && / versions: HCVersions\.forStorage\(m, clean\), version: HCVersions\.of\(m\) \? m\.version : undefined,/.test(app));
  ok('a message with versions shows which, of how many, and moves between them, never while a reply is written', /if \(HCVersions\.of\(m\)\) parts\.push\(HCVersions\.switchHtml\(m\)\);/.test(app) && /data-action="ver-prev"/.test(V.switchHtml({ versions: [{}, {}], version: 1 })) && V.switchHtml({ versions: [{}, {}], version: 0 }).includes('aria-label="Previous version" disabled') && V.switchHtml(a('x')) === '' && /if \(action === "ver-prev" \|\| action === "ver-next"\) \{ if \(state\.streaming\) return; state\.messages = HCVersions\.show\(/.test(app));
  ok('the model is sent each message\'s words, never its versions', /const entry = \{ role: m\.role, content: m\._modelContent \|\| m\.content \|\| "" \};/.test(app));
  const coder = src('modes', 'code', 'mode.js');
  ok('HashCoder brings a request back to the box to change and send again, its words without the names of what was attached, removing nothing', /<button class="cdr-action-btn cdr-act-edit"/.test(coder) && /box\.value = String\(text\)\.replace\(\/\\n\\nAttached: \[\^\\n\]\*\$\/, ''\);/.test(coder));
  ok('it loads before the app', src('boot.js').indexOf("'/js/chat/versions.js'") > 0 && src('boot.js').indexOf("'/js/chat/versions.js'") < src('boot.js').indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:chat-versions\b/.test(readFileSync(join(root, 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/versions.js)`);
process.exit(fail ? 1 : 0);
