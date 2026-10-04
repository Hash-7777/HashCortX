// ==============================================================
// Following a HashCoder answer as it is written — checks
//
// Loads the REAL src/js/code/follow.js and holds that the conversation
// follows an answer only while the reader is at its end, lets go the moment
// they scroll up, follows again when they come back down, and always shows a
// request just sent; that the live line draws the words at a bounded rate;
// and that the panel scrolls only through it.
//
// Run with: npm run check:code-follow
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'follow.js'), sandbox, { filename: 'follow.js' });
const F = sandbox.window.HCCodeFollow;

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
  ok('the panel scrolls only through it', /function scrollMessages\(force\) \{ follow = follow \|\| window\.HCCodeFollow\.create\(\(\) => \$\('cdrMessages'\)\); if \(force === true\) follow\.toEnd\(\); else follow\.keep\(\); \}/.test(mode)
    && !/\$\('cdrMessages'\)[^\n]*scrollTop = /.test(mode));
  ok('a request the person sends is always shown', /function appendUserMsg\([\s\S]*?msgs\.appendChild\(el\);\n\s*scrollMessages\(true\);/.test(mode));
  ok('the words of an answer are drawn at a bounded rate, and the wait is cleared when the line ends', /const DRAW_EVERY = \d+;/.test(live) && /const wait = DRAW_EVERY - \(Date\.now\(\) - drawn\);/.test(live) && /if \(waiting\) clearTimeout\(waiting\);/.test(live));
  const boot = src('boot.js');
  ok('it loads before the Coder', boot.indexOf("'/js/code/follow.js'") > 0 && boot.indexOf("'/js/code/follow.js'") < boot.indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:code-follow/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/follow.js)`);
process.exit(fail ? 1 : 0);
