// ==============================================================
// Measure every button in every mode, and report the ones whose contents do
// not sit on the button's own centre line
//
//     node scripts/align-controls.mjs
//
// NOT part of `npm run check`. Like the control sweep beside it, it needs a
// real browser: a mark that hangs low does so because of the box the browser
// gave it, and nothing that reads the stylesheet can work that out.
//
// WHY IT EXISTS. An icon button was drawn twenty-eight pixels tall and kept
// the app's general button padding, which left eight pixels of room inside it
// for a fifteen pixel mark. The mark could not fit, so centring it had nothing
// to centre in and it sat below the middle. Two buttons in the app looked
// wrong, in the same way, for that reason — and no check could see it, because
// every rule involved was correct on its own.
//
// WHAT IT MEASURES. For each visible button: the box its contents actually
// have to sit in (its own height, less border and padding), and where the
// contents ended up. A block sitting off that box's centre line is reported
// with the distance, and so are pieces inside one button that disagree with
// each other. What it does NOT judge: children taken out of flow — a corner
// keyboard hint is meant to be in the corner — and buttons laid out as a
// column, where a mark above a label is the design.
//
// It reads geometry, so it has no opinion about what looks good. A finding is
// a number: this content is this far from the middle.
//
// ENDING THE BROWSER IS PART OF THE JOB. The first version of this file left
// one running on every single run. Three faults compounded: the kill was
// deferred behind a timer while the reporting exited the process first, so the
// timer never fired; killing the top process would not have been enough,
// because with --headless=new the GPU helper is its own process and outlives
// its parent; and software WebGL means that helper spins a core for as long as
// the machine is on. Three of them were found still running, at about 250% of
// a core each, hours later. So: the browser is started in its own process
// group, the whole group is signalled, and it happens on the way out of this
// process however this process ends.
// ==============================================================
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const PORT = 8897;
// Below this, a difference is sub-pixel rounding rather than something a
// person can see.
const OFF_LIMIT = 1.5;
const SPREAD_LIMIT = 2.5;
const PROFILE = join(here, '..', 'node_modules', '.align-browser');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.whl': 'application/octet-stream',
};

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.log('No Chrome or Chromium found. This needs a real browser — install one, or run it on a machine that has one.');
  process.exit(2);
}

const driver = `<script>
(function () {
  const OFF_LIMIT = ${OFF_LIMIT};
  const SPREAD_LIMIT = ${SPREAD_LIMIT};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const TABS = [
    ['Chat', 'tabChats', null], ['Coder', 'tabCode', '#coder-mode-wrap'],
    ['Finance', 'tabFinance', '#finance-wrap'], ['Sandbox', 'tabSandbox', '#sandbox-wrap'],
    ['ERP', 'tabSystems', '#system-maker-wrap'], ['Swarm', 'tabAgentMaker', '#agent-maker-wrap'],
    ['VirtualOS', 'tabVirtualOS', '#virtual-os-wrap'], ['Forge', 'tabForge', '#forge-mode-wrap'],
  ];
  const labelOf = (b) => b.id ? '#' + b.id
    : ((b.textContent || '').trim().slice(0, 22) || '.' + String(b.className || '').split(' ').filter(Boolean).slice(0, 2).join('.'));

  function measure(mode, b) {
    const br = b.getBoundingClientRect();
    if (br.width < 4 || br.height < 4) return null;
    const cs = getComputedStyle(b);
    // A mark above a label is a stack on purpose, not a mark out of place.
    if ((cs.flexDirection || '').startsWith('column')) return null;
    const boxTop = br.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
    const boxBot = br.bottom - (parseFloat(cs.borderBottomWidth) || 0) - (parseFloat(cs.paddingBottom) || 0);
    if (boxBot - boxTop < 4) return null;
    const boxMid = (boxTop + boxBot) / 2;

    const kids = [...b.childNodes].map((n) => {
      if (n.nodeType === 1) {
        const ks = getComputedStyle(n);
        // A corner hint is meant to be in the corner.
        if (ks.position === 'absolute' || ks.position === 'fixed') return null;
        return { r: n.getBoundingClientRect(), tag: n.tagName.toLowerCase() };
      }
      if (n.nodeType === 3 && n.textContent.trim()) {
        const rg = document.createRange();
        rg.selectNodeContents(n);
        return { r: rg.getBoundingClientRect(), tag: 'text' };
      }
      return null;
    }).filter((k) => k && k.r.height > 0 && k.r.width > 0);
    if (!kids.length) return null;

    const contentMid = (Math.min(...kids.map((k) => k.r.top)) + Math.max(...kids.map((k) => k.r.bottom))) / 2;
    const off = contentMid - boxMid;
    const mids = kids.map((k) => (k.r.top + k.r.bottom) / 2);
    const spread = kids.length > 1 ? Math.max(...mids) - Math.min(...mids) : 0;
    if (Math.abs(off) < OFF_LIMIT && spread < SPREAD_LIMIT) return null;
    return mode + '  ' + labelOf(b) + '  [' + kids.map((k) => k.tag).join('+') + ']'
      + '  ' + (off >= 0 ? off.toFixed(1) + 'px below the middle' : (-off).toFixed(1) + 'px above the middle')
      + (spread >= SPREAD_LIMIT ? ', pieces ' + spread.toFixed(1) + 'px apart' : '')
      + '  (button ' + br.height.toFixed(0) + 'px, room inside ' + (boxBot - boxTop).toFixed(0) + 'px)';
  }

  document.addEventListener('hashcortx:shell-ready', () => setTimeout(async () => {
    try {
      document.getElementById('intro-screen')?.remove();
      const app = document.getElementById('mainApp');
      if (app) { app.style.visibility = 'visible'; app.style.opacity = '1'; app.style.pointerEvents = 'auto'; }
      for (const [mode, tab, scope] of TABS) {
        document.getElementById(tab)?.click();
        await wait(900);
        const root = scope ? (document.querySelector(scope) || document) : document;
        const btns = [...root.querySelectorAll('button')]
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        const found = btns.map((b) => { try { return measure(mode, b); } catch { return null; } }).filter(Boolean);
        out.push('COUNT\\t' + mode + '\\t' + btns.length + '\\t' + found.length);
        found.forEach((f) => out.push('OFF\\t' + f));
      }
    } catch (e) { out.push('THREW\\t' + (e && e.message)); }
    try { await fetch('/__align-result?' + encodeURIComponent(out.join('\\n'))); } catch {}
  }, 700));
})();
</script></body>`;

let done = false;
let chrome;

/**
 * End the browser and everything it started.
 *
 * Signals the process group rather than the one process: the GPU helper is a
 * separate process and does not go when its parent does. Safe to call twice,
 * and safe to call when nothing was ever started.
 */
function stopBrowser() {
  if (!chrome || chrome.killed) return;
  try { process.kill(-chrome.pid, 'SIGKILL'); }
  catch { try { chrome.kill('SIGKILL'); } catch {} }
}

// However this process ends — reported, timed out, interrupted, or thrown —
// the browser ends with it. 'exit' handlers run synchronously, which is what
// makes this reliable where a timer is not.
process.on('exit', stopBrowser);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stopBrowser(); process.exit(130); });
}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__align-result') {
    done = true;
    res.end('ok');
    // Before reporting, because reporting ends this process.
    stopBrowser();
    server.close();
    report(decodeURIComponent(url.search.slice(1)));
    return;
  }
  const p = url.pathname === '/' || url.pathname === '/__align.html' ? '__page' : url.pathname;
  if (p === '__page') {
    res.setHeader('content-type', 'text/html');
    res.end(readFileSync(join(srcDir, 'index.html'), 'utf8').replace('</body>', driver));
    return;
  }
  const file = join(srcDir, p);
  if (!existsSync(file)) { res.statusCode = 404; res.end('not here'); return; }
  res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});

function report(text) {
  let buttons = 0;
  let off = 0;
  for (const line of text.split('\n')) {
    const [kind, ...rest] = line.split('\t');
    if (kind === 'COUNT') {
      buttons += Number(rest[1]);
      off += Number(rest[2]);
      console.log(`  ${rest[0]} … ${rest[1]} buttons` + (Number(rest[2]) ? ` — ${rest[2]} off centre` : ''));
    } else if (kind === 'OFF') {
      console.log(`      ${rest.join('\t')}`);
    } else if (kind === 'THREW') {
      console.log(`  the page threw: ${rest.join('\t')}`);
      off++;
    }
  }
  console.log(off
    ? `\n${off} of ${buttons} buttons do not sit on their own centre line.`
    : `\nAll ${buttons} buttons sit on their own centre line.`);
  process.exit(off ? 1 : 0);
}

server.listen(PORT, () => {
  console.log('Measuring every button in every mode. About ten seconds.\n');
  // A browser left behind by an interrupted run holds a lock on its profile,
  // and the next run then starts no window at all and simply times out —
  // which reads as "the page is broken" rather than "the last one is still
  // holding the door". Cheap to take the profile away and let it be made again.
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader',
    '--window-size=1500,950', '--force-device-scale-factor=1',
    '--user-data-dir=' + PROFILE,
    `http://127.0.0.1:${PORT}/__align.html`,
  ], { stdio: 'ignore', detached: true });
  setTimeout(() => {
    if (done) return;
    console.log('Nothing came back. The page did not finish — run it again, or open the address by hand to see why.');
    stopBrowser();
    process.exit(3);
  }, 90000);
});
