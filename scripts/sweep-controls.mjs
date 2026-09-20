// ==============================================================
// Click every control in every mode, and report what throws
//
//     node scripts/sweep-controls.mjs            # every mode
//     node scripts/sweep-controls.mjs Coder ERP  # only these
//
// NOT part of `npm run check`. It needs a real browser, so it belongs in a
// developer's hands rather than in CI, and it is slow — about half a minute per
// mode.
//
// WHY IT EXISTS. The checks read the source. They cannot see a handler that
// throws when it runs, and that is where this app's defects have actually been:
// an export menu that opened, closed, wrote nothing and said nothing, because
// the function behind it threw inside a promise nobody awaited. Nothing static
// finds that. Clicking it does, immediately.
//
// IT ALSO REPORTS SILENCE, which is the other half of "this button does not
// work". A control that throws nothing but changes NOTHING — no mark on the
// page, no message, no dialog — is indistinguishable from a broken one to the
// person pressing it. Every click is watched for changes to the page, and the
// ones that caused none are listed separately, as something to look at rather
// than as a failure: a toggle already in the state it was set to is properly
// silent, and so is a control whose work needs a key this pass does not have.
//
// WHAT IT COVERS, AND WHAT IT DOES NOT. It opens each mode from cold, clicks
// every control visible at that moment, and then clicks whatever that click
// REVEALED — a menu's items, a dialog's buttons, a panel that opened. Two
// levels, because one level never opened a menu, and a menu's items are where
// this app's defects have actually been: the export item that wrote nothing,
// the import item that pointed at an input that was not there.
//
// It still does NOT reach the states that need content: a generated ERP system,
// a Coder run in flight, a model loaded in Forge. A clean sweep means the front
// door and everything behind it opens, not that the whole house is sound.
//
// It runs without API keys, and not in Tauri, so nothing here can write a file,
// run a shell command or spend anyone's quota.
//
// THREE THINGS IT TOOK TO MAKE THIS WORK, all of them non-obvious:
//
//   · macOS has no `timeout`. Every early attempt "produced nothing" because the
//     shell pipeline failed before Chrome ran. Nothing about the output said so.
//   · Chrome does not exit while the page has live timers, and this app has a
//     clock. So --dump-dom never prints, and results come back through a request
//     to this script's own server instead.
//   · A control that reloads the app restarts the sweep, which loops for ever.
//     So progress is recorded BEFORE each click and the run resumes after it:
//     a reloading control costs one button, not the run.
// ==============================================================
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const PAGE = join(srcDir, '__sweep.html');
const PORT = 8899;
const SECONDS_PER_MODE = 75;

const MODES = ['Chat', 'Coder', 'Finance', 'Sandbox', 'ERP', 'Swarm', 'VirtualOS', 'Forge'];
// The Forge was left out for a long time because it needs a WebGL context and a
// headless browser has none. It gets one in software, which is why the flag
// below is passed — and why the browser is killed as a group the moment the
// pass ends: software WebGL renders on the CPU, and a forgotten one of these
// once sat at two and a half cores for hours.

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => existsSync(p));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.whl': 'application/octet-stream',
};

/** The page the sweep runs: the real shell, plus a driver and an error trap. */
function sweepPage() {
  const shell = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const trap = `<script>
    window.__errs = [];
    const push = (s) => { if (!window.__errs.includes(s)) window.__errs.push(s); };
    window.addEventListener('error', (e) => push('ERROR ' + (e.message || '') + ' @ ' + String(e.filename||'').split('/').pop() + ':' + e.lineno));
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      const at = ((r && r.stack) || '').split('\\n')[1] || '';
      push('REJECTION ' + ((r && r.message) || r) + ' @ ' + at.trim().split('/').pop());
    });
    const realError = console.error;
    console.error = function (...a) {
      const s = a.map(String).join(' ');
      // A headless browser has no WebGL. That is this harness, not the app.
      if (!/WebGL|THREE|three\\.|GL_VENDOR/i.test(s)) push('console.error ' + s.slice(0, 140));
      realError.apply(console, a);
    };
  </script></head>`;
  const driver = `<script>
  (function () {
    const P = new URLSearchParams(location.search);
    const TABS = {
      Chat: ['tabChats', null], Coder: ['tabCode', '#coder-mode-wrap'],
      Finance: ['tabFinance', '#finance-wrap'], Sandbox: ['tabSandbox', '#sandbox-wrap'],
      ERP: ['tabSystems', '#system-maker-wrap'], Swarm: ['tabAgentMaker', '#agent-maker-wrap'],
      VirtualOS: ['tabVirtualOS', '#virtual-os-wrap'], Forge: ['tabForge', '#forge-mode-wrap'],
    };
    const which = P.get('mode') || 'Chat';
    const K = 'sweep:' + which + ':';
    const get = (k, d) => { try { return JSON.parse(localStorage.getItem(K + k)) ?? d; } catch { return d; } };
    const set = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch {} };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // What a click did to the page. A control that alters nothing at all reads
    // as broken to the person pressing it, whether or not anything threw.
    let changes = 0;
    new MutationObserver((records) => { changes += records.length; })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const quiet = [];
    async function press(control, label) {
      changes = 0;
      window.__errs = [];
      let threw = null;
      try { control.click(); } catch (e) { threw = e.message; }
      await wait(160);
      if (threw) return label + ' -> THREW ' + threw;
      if (window.__errs.length) return label + ' -> ' + window.__errs.join(' ; ');
      // Silence is only silence once the handler has had time to finish. A
      // control whose work is asynchronous — a clipboard write, a file read —
      // changes nothing for as long as it is waiting, and calling that broken
      // reports the tool's own impatience as a defect in the app.
      if (changes === 0) {
        await wait(QUIET_GRACE_MS);
        if (changes === 0) quiet.push(label);
      }
      return null;
    }
    // Controls that leave the mode, restart the app, or ask the OS a question.
    const SKIP_ID = /^tab[A-Z]|^hcReloadAppBtn$|^refresh$|^toggleSide$|^openSettings$|^powerBtn$/;
    const SKIP_TEXT = /^(chats?|coder|forge|finance|sandbox|erp|swarm|virtual\\s*os|split)$/i;
    // How many of the controls one click reveals are clicked in turn. A menu
    // has a handful of items; a list that a click fills has hundreds, and
    // clicking all of them would turn a half-minute pass into an hour.
    const CHILDREN_PER_CONTROL = 8;
    // How much longer a control that changed nothing is given before it is
    // reported as silent.
    const QUIET_GRACE_MS = 700;
    async function dismiss() {
      document.getElementById('terminalAlertCancel')?.click();
      document.getElementById('terminalAlertOk')?.click();
      await wait(25);
      document.querySelectorAll('.modal-overlay.open').forEach((o) => o.classList.remove('open'));
      document.getElementById('hc-perm-dialog')?.classList.remove('open');
    }
    function controls(scope) {
      const root = scope ? (document.querySelector(scope) || document) : document;
      return [...root.querySelectorAll('button')].filter((b) => {
        if (b.disabled || SKIP_ID.test(b.id || '')) return false;
        if (SKIP_TEXT.test((b.id || b.textContent || '').trim())) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    }
    const name = (b) => b.id ? '#' + b.id : ((b.textContent || '').trim().slice(0, 26) || '.' + String(b.className).split(' ')[0]);
    // Everything clickable anywhere, not only inside the mode: a menu or a
    // dialog a mode opens is often mounted on the body, outside the mode's own
    // wrapper, so scoping the second level to the mode would miss exactly the
    // controls this pass exists to reach.
    const everything = () => controls(null);
    document.addEventListener('hashcortx:shell-ready', () => setTimeout(async () => {
      document.getElementById('intro-screen')?.remove();
      const app = document.getElementById('mainApp');
      if (app) { app.style.visibility = 'visible'; app.style.pointerEvents = 'auto'; }
      const [tabId, scope] = TABS[which] || TABS.Chat;
      document.getElementById(tabId)?.click();
      await wait(700);
      const btns = controls(scope);
      const results = get('results', []);
      let at = get('index', 0);
      let deeper = 0;
      for (; at < btns.length; at++) {
        const b = btns[at];
        // The list is taken once, and earlier clicks close panels: a control
        // that has since been hidden is not on screen to be pressed, and
        // pressing it reports a silence that no person could ever meet.
        if (!b || !b.isConnected || !b.getBoundingClientRect().width) continue;
        const label = b.id ? '#' + b.id : ((b.textContent || '').trim().slice(0, 26) || '.' + String(b.className).split(' ')[0]);
        set('index', at + 1);   // before the click, so a reload costs one button
        const before = new Set(everything());
        const broke = await press(b, label);
        if (broke) results.push(broke);
        // What that click revealed — a menu's items, a dialog's buttons. These
        // are clicked too, and counted, because a menu that opens proves
        // nothing about whether its items do anything.
        const revealed = everything().filter((c) => !before.has(c));
        for (const child of revealed.slice(0, CHILDREN_PER_CONTROL)) {
          if (!child.isConnected) continue;
          const r = child.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          deeper++;
          const childBroke = await press(child, label + ' > ' + name(child));
          if (childBroke) results.push(childBroke);
          await dismiss();
          // The parent has to be open again for its next item to be reachable.
          if (revealed.indexOf(child) < revealed.length - 1 && b.isConnected) {
            try { b.click(); } catch {}
            await wait(120);
          }
        }
        set('results', results);
        await dismiss();
      }
      const payload = which + '\\t' + at + '/' + btns.length + ' + ' + deeper + ' revealed'
        + '\\t' + (results.length ? results.join(' || ') : 'nothing threw')
        + '\\t' + quiet.join(', ');
      try { await fetch('/__sweep-result?' + encodeURIComponent(payload)); } catch {}
    }, 500));
  })();
  </script></body>`;
  return shell.replace('</head>', trap).replace('</body>', driver);
}

const reported = new Map();

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__sweep-result') {
    const [mode, count, detail, silent] = decodeURIComponent(url.search.slice(1)).split('\t');
    if (!reported.has(mode)) reported.set(mode, { count, detail, silent });
    res.writeHead(204).end();
    return;
  }
  const path = join(srcDir, decodeURIComponent(url.pathname));
  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404).end();
  }
});

/**
 * End the browser this tool started, whatever happens.
 *
 * It is killed as a GROUP, not as one process: a headless Chrome starts
 * helpers that outlive their parent, so signalling only the process we spawned
 * leaves them running. Three of them once sat at two and a half cores each for
 * two hours after a run that looked like it had finished.
 *
 * And it is killed on every way out, not only on the timer — a Ctrl-C part way
 * through a sweep used to walk away and leave Chrome behind.
 */
let browser = null;
function stopBrowser() {
  if (!browser || browser.killed) return;
  try { process.kill(-browser.pid, 'SIGKILL'); }
  catch { try { browser.kill('SIGKILL'); } catch {} }
}
process.on('exit', stopBrowser);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stopBrowser(); process.exit(130); });
}

function run(mode, profile) {
  return new Promise((resolve) => {
    browser = spawn(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--enable-unsafe-swiftshader',   // the Forge needs a WebGL context; this one is on the CPU
      `--user-data-dir=${profile}`, '--window-size=1440,900',
      '--virtual-time-budget=20000',
      `http://127.0.0.1:${PORT}/__sweep.html?mode=${mode}`,
    ], { stdio: 'ignore', detached: true });
    // Chrome will not exit on its own: the app keeps a clock running. The result
    // has already come back over HTTP by the time this fires.
    const stop = setTimeout(() => { stopBrowser(); resolve(); }, SECONDS_PER_MODE * 1000);
    browser.on('exit', () => { clearTimeout(stop); resolve(); });
  });
}

const wanted = process.argv.slice(2).filter((a) => MODES.includes(a));
const modes = wanted.length ? wanted : MODES;

if (!CHROME) {
  console.error('No Chrome or Chromium found. This needs a real browser; install one or run it elsewhere.');
  process.exit(2);
}

writeFileSync(PAGE, sweepPage());
const profile = join(here, '..', 'src-tauri', 'target', 'sweep-profile');
server.listen(PORT);
console.log(`Clicking every visible control in ${modes.length} mode(s). About ${SECONDS_PER_MODE}s each.\n`);
try {
  for (const mode of modes) {
    process.stdout.write(`  ${mode} … `);
    await run(mode, profile);
    const r = reported.get(mode);
    console.log(r ? `${r.count} controls — ${r.detail === 'nothing threw' ? 'nothing threw' : '\n      ' + r.detail.split(' || ').join('\n      ')}`
                  : 'NO RESULT — the pass did not finish, run it again to resume');
    if (r && r.silent) console.log(`      changed nothing on the page: ${r.silent}`);
  }
} finally {
  stopBrowser();
  server.close();
  try { unlinkSync(PAGE); } catch {}
}

const broke = [...reported.entries()].filter(([, r]) => r.detail !== 'nothing threw');
const missing = modes.filter((m) => !reported.has(m));
console.log(`\n${modes.length - broke.length - missing.length} of ${modes.length} mode(s) clean` +
  (missing.length ? `, ${missing.length} did not report` : ''));
process.exit(broke.length || missing.length ? 1 : 0);
