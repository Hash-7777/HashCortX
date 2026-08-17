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
// WHAT IT COVERS, AND WHAT IT DOES NOT. It opens each mode from cold and clicks
// every control that is visible at that moment. So it exercises the state a mode
// starts in — which is the state every user meets first — and NOT the states that
// need content: a generated ERP system, a Coder run in flight, a model loaded in
// Forge. A clean sweep means the front door is sound, not that the house is.
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
const SECONDS_PER_MODE = 30;

const MODES = ['Chat', 'Coder', 'Finance', 'Sandbox', 'ERP', 'Swarm', 'VirtualOS'];
// Forge is left out on purpose: it needs a WebGL context, and a headless browser
// has none, so every run would report a failure that says nothing about the app.

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
      VirtualOS: ['tabVirtualOS', '#virtual-os-wrap'],
    };
    const which = P.get('mode') || 'Chat';
    const K = 'sweep:' + which + ':';
    const get = (k, d) => { try { return JSON.parse(localStorage.getItem(K + k)) ?? d; } catch { return d; } };
    const set = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch {} };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Controls that leave the mode, restart the app, or ask the OS a question.
    const SKIP_ID = /^tab[A-Z]|^hcReloadAppBtn$|^refresh$|^toggleSide$|^openSettings$|^powerBtn$/;
    const SKIP_TEXT = /^(chats?|coder|forge|finance|sandbox|erp|swarm|virtual\\s*os|split)$/i;
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
      for (; at < btns.length; at++) {
        const b = btns[at];
        if (!b || !b.isConnected) continue;
        const label = b.id ? '#' + b.id : ((b.textContent || '').trim().slice(0, 26) || '.' + String(b.className).split(' ')[0]);
        set('index', at + 1);   // before the click, so a reload costs one button
        window.__errs = [];
        try { b.click(); } catch (e) { results.push(label + ' -> THREW ' + e.message); }
        await wait(100);
        if (window.__errs.length) results.push(label + ' -> ' + window.__errs.join(' ; '));
        set('results', results);
        await dismiss();
      }
      const payload = which + '\\t' + at + '/' + btns.length + '\\t' + (results.length ? results.join(' || ') : 'nothing threw');
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
    const [mode, count, detail] = decodeURIComponent(url.search.slice(1)).split('\t');
    if (!reported.has(mode)) reported.set(mode, { count, detail });
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

function run(mode, profile) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
      `--user-data-dir=${profile}`, '--window-size=1440,900',
      '--virtual-time-budget=20000',
      `http://127.0.0.1:${PORT}/__sweep.html?mode=${mode}`,
    ], { stdio: 'ignore' });
    // Chrome will not exit on its own: the app keeps a clock running. The result
    // has already come back over HTTP by the time this fires.
    const stop = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, SECONDS_PER_MODE * 1000);
    child.on('exit', () => { clearTimeout(stop); resolve(); });
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
  }
} finally {
  server.close();
  try { unlinkSync(PAGE); } catch {}
}

const broke = [...reported.entries()].filter(([, r]) => r.detail !== 'nothing threw');
const missing = modes.filter((m) => !reported.has(m));
console.log(`\n${modes.length - broke.length - missing.length} of ${modes.length} mode(s) clean` +
  (missing.length ? `, ${missing.length} did not report` : ''));
process.exit(broke.length || missing.length ? 1 : 0);
