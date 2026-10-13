// ==============================================================
// Following words as they are written — checks
//
// Loads the REAL src/js/follow.js and holds that a list follows what is
// written only while the reader is at its end, lets go the moment they
// scroll up, follows again when they come back down, and always shows a
// message just sent; that the HashCoder live line draws the words at a
// bounded rate; and that every place in the app that shows text as it
// arrives scrolls through it, rather than moving the list to its end itself.
//
// Run with: npm run check:follow
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'follow.js'), sandbox, { filename: 'follow.js' });
const F = sandbox.window.HCFollow;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('Being at the end:');
ok('scrolled to the end is at it', F.atEnd({ top: 600, height: 1000, view: 400 }));
ok('a few pixels short still is', F.atEnd({ top: 597, height: 1000, view: 400 }));
ok('further up is not', !F.atEnd({ top: 560, height: 1000, view: 400 }));
ok('a list shorter than its view is at its end', F.atEnd({ top: 0, height: 300, view: 400 }));

console.log('\nWhen to follow, after the list moved:');
ok('moved up, away from the end: let go', F.next(true, { top: 500, height: 1000, view: 400, lastTop: 600 }) === false);
ok('back at the end: follow again', F.next(false, { top: 600, height: 1000, view: 400, lastTop: 500 }) === true);
ok('moved down but not yet at the end: as it was', F.next(false, { top: 550, height: 1000, view: 400, lastTop: 500 }) === false);
ok('content taken away leaves it at the end, which is not moving up', F.next(true, { top: 400, height: 800, view: 400, lastTop: 600 }) === true);

console.log('\nOn a list:');
{
  const handlers = {};
  const el = {
    scrollTop: 0, scrollHeight: 1000, clientHeight: 400,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  };
  const fire = (type, e = {}) => (handlers[type] || []).forEach((fn) => fn(e));
  const f = F.create(() => el);
  f.keep();
  ok('it starts by following, and keeps the newest in view', f.following && el.scrollTop === 1000);
  el.scrollTop = 600; fire('scroll');
  el.scrollHeight = 1400; f.keep();
  ok('more words: still followed', el.scrollTop === 1400);
  fire('wheel', { deltaY: -30 });
  el.scrollHeight = 1800; f.keep();
  ok('a turn of the wheel upward lets go before the list has moved, and the words no longer pull it down', !f.following && el.scrollTop === 1400);
  el.scrollTop = 900; fire('scroll');
  el.scrollHeight = 2200; f.keep();
  ok('scrolled up, it stays where the reader put it', el.scrollTop === 900 && !f.following);
  el.scrollTop = el.scrollHeight - el.clientHeight; fire('scroll');
  el.scrollHeight = 2600; f.keep();
  ok('scrolled back to the end, it follows again', f.following && el.scrollTop === 2600);
  el.scrollTop = 1000; fire('scroll');
  f.toEnd();
  ok('a request just sent is shown however far up the reader was', f.following && el.scrollTop === 2600);
  ok('listening is quiet and set up once', (handlers.scroll || []).length === 1 && (handlers.wheel || []).length === 1);
  ok('no list, nothing happens', (() => { try { F.create(() => null).keep(); F.create(() => null).toEnd(); return true; } catch { return false; } })());
}

console.log('\nThe panel and the live line:');
{
  const mode = src('modes', 'code', 'mode.js');
  const live = src('js', 'code', 'live.js');
  ok('the panel scrolls only through it', /function scrollMessages\(force\) \{ follow = follow \|\| window\.HCFollow\.create\(\(\) => \$\('cdrMessages'\)\); if \(force === true\) follow\.toEnd\(\); else follow\.keep\(\); \}/.test(mode)
    && !/\$\('cdrMessages'\)[^\n]*scrollTop = /.test(mode));
  ok('a request the person sends is always shown', /function appendUserMsg\([\s\S]*?msgs\.appendChild\(el\);\n\s*scrollMessages\(true\);/.test(mode));
  ok('the words of an answer are drawn at a bounded rate, and the wait is cleared when the line ends', /const DRAW_EVERY = \d+;/.test(live) && /const wait = DRAW_EVERY - \(Date\.now\(\) - drawn\);/.test(live) && /if \(waiting\) clearTimeout\(waiting\);/.test(live));
  const boot = src('boot.js');
  ok('it loads before the app and every mode', boot.indexOf("'/js/follow.js'") > 0 && boot.indexOf("'/js/follow.js'") < boot.indexOf("'/js/app.js'") && boot.indexOf("'/js/follow.js'") < boot.indexOf("'/js/swarm/workspace.js'"));
  ok('this check is part of npm run check', /npm run check:follow\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log('\nOne follower for each list:');
{
  const make = () => {
    const handlers = {};
    return { handlers, scrollTop: 0, scrollHeight: 1000, clientHeight: 400, addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); } };
  };
  const fire = (el, type, e = {}) => (el.handlers[type] || []).forEach((fn) => fn(e));
  const a = make(), b = make();
  ok('a list never scrolled here counts as following', F.following(a));
  F.keep(a); F.keep(b);
  ok('keep moves a following list to its end', a.scrollTop === 1000 && b.scrollTop === 1000);
  fire(a, 'wheel', { deltaY: -10 });
  a.scrollHeight = 1600; b.scrollHeight = 1600; F.keep(a); F.keep(b);
  ok('a reader who scrolls up in one list is left there, and the other list still follows', a.scrollTop === 1000 && !F.following(a) && b.scrollTop === 1600 && F.following(b));
  a.scrollTop = 1180; fire(a, 'scroll');
  a.scrollHeight = 1700; F.keep(a);
  ok('a small scroll up, still close to the end, is not pulled back down', a.scrollTop === 1180 && !F.following(a));
  F.toEnd(a);
  ok('toEnd shows the end and follows again', a.scrollTop === 1700 && F.following(a));
  F.keep(a); F.keep(a);
  ok('each list is listened to once, however often it is kept', (a.handlers.scroll || []).length === 1 && (a.handlers.wheel || []).length === 1);
  ok('no list, nothing happens', (() => { try { F.keep(null); F.toEnd(undefined); return true; } catch { return false; } })());
}

console.log('\nEvery place that shows text as it arrives:');
{
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === 'vendor' ? [] : walk(p)) : /\.js$/.test(n) ? [p] : []; });
  const root = join(here, '..', '..', 'src');
  const own = (p) => p.slice(root.length + 1).replace(/\\/g, '/');
  // Moving a list to its end by hand is left only to follow.js itself, and to
  // the audit log, which is filled once when it opens and never written to.
  const KEPT = new Map([['js/follow.js', 'the follower itself'], ['modes/code/mode.js', 'pre.scrollTop = pre.scrollHeight']]);
  const by = [];
  for (const p of walk(root)) {
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/(\w+)\.scrollTop\s*=\s*[\w.]+\.scrollHeight/g)) {
      const kept = KEPT.get(own(p));
      if (kept && (kept === 'the follower itself' || m[0] === kept)) continue;
      by.push(`${own(p)}: ${m[0]}`);
    }
  }
  ok(`nothing moves a list to its end itself${by.length ? ` (${by.join('; ')})` : ''}`, !by.length);
  const app = src('js', 'app.js');
  ok('the chat no longer judges following by distance alone', !/pinned = dist < \d+/.test(app) && !/let pinned = true;/.test(app));
  ok('the chat shows a message just sent', /HCFollow\.toEnd\(msgs\);\s+\/\/ the message just sent is shown/.test(app));
  ok('the chat drawn again keeps the reader where they are, and another chat opens at its end',
    /const readingAt = msgs\.scrollTop;/.test(app) && /if \(shownChatId !== state\.currentChatId\) \{ shownChatId = state\.currentChatId; HCFollow\.toEnd\(msgs\); \}\s+else \{ HCFollow\.keep\(msgs\); if \(!HCFollow\.following\(msgs\)\) msgs\.scrollTop = readingAt; \}/.test(app));
  const ws = src('js', 'swarm', 'workspace.js');
  ok('the Agent Swarm conversation drawn again keeps the reader where they are',
    /const readingAt = box\.scrollTop;/.test(ws) && /if \(shownRunId !== run\.id\) \{ shownRunId = run\.id; window\.HCFollow\.toEnd\(box\); \}\s+else \{ window\.HCFollow\.keep\(box\); if \(!window\.HCFollow\.following\(box\)\) box\.scrollTop = readingAt; \}/.test(ws));
  const erp = src('js', 'systems', 'agent-chat.js');
  ok('the ERP agent follows through it, and shows what the person sent', /function scroll\(\) \{ window\.HCFollow\.keep\(\$\('sysAgentLog'\)\); \}/.test(erp) && /if \(role === 'user'\) window\.HCFollow\.toEnd\(log\); else scroll\(\);/.test(erp));
  const fin = src('modes', 'finance', 'mode.js');
  ok('Finance shows what the person sent, and follows the rest', /if \(isUser\) window\.HCFollow\.toEnd\(el\); else window\.HCFollow\.keep\(el\);/.test(fin));
  for (const [where, file, list] of [['the HashCoder trace', ['modes', 'code', 'mode.js'], 'list'], ['the HashCoder terminal', ['modes', 'code', 'mode.js'], 'body'], ['the Agent Swarm trace', ['modes', 'agent-maker', 'mode.js'], 'list'], ['the Sandbox log', ['modes', 'sandbox', 'mode.js'], 'logEl'], ['the Finance trace', ['modes', 'finance', 'mode.js'], 'list'], ['the 3D Forge trace', ['modes', 'forge', 'mode.js'], 'host']]) {
    ok(`${where} follows through it`, new RegExp(`window\\.HCFollow\\.keep\\(${list}\\);`).test(src(...file)));
  }
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/follow.js)`);
process.exit(fail ? 1 : 0);
