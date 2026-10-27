// ============================================================
// HashCoder checks its work by code, never by looking at it —
// src/js/code/by-code.js, and where shell_run asks it.
// Run with: npm run check:code-by-code
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'by-code.js'), sandbox, { filename: 'by-code.js' });
const B = sandbox.window.HCCodeByCode;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const kind = (line) => { const [c, ...a] = line.split(' '); return B.kindOf(c, a); };
const each = (label, lines, want) => {
  const wrong = lines.filter((l) => kind(l) !== want);
  ok(label, !wrong.length, wrong.map((l) => `${l} -> ${kind(l) || 'run'}`).join('; '));
};

console.log('\nNot run: what would look at the result:');
each('a picture of the screen', ['screencapture -x shot.png', '/usr/sbin/screencapture shot.png', 'gnome-screenshot -f a.png', 'scrot a.png', 'npx shot-scraper index.html', 'npx capture-website index.html'], 'picture');
each('a browser, or a program that drives one', ['google-chrome --headless --screenshot index.html', 'firefox index.html', 'npx playwright screenshot index.html a.png', 'npx -y puppeteer browsers install',
  'python3 -m playwright install', 'python3 -m webbrowser index.html', 'npm exec -- lighthouse index.html', 'chromedriver'], 'browser');
each('something that opens a file, a page or an app', ['open index.html', 'open -a Safari index.html', 'xdg-open index.html', 'gio open index.html', 'cmd /d /c start index.html', 'start index.html',
  'explorer index.html', 'osascript -e x', 'powershell -Command Start-Process index.html', 'xcrun simctl io booted screenshot a.png'], 'open');
each('a server or the app started to look at it', ['python3 -m http.server 8000', 'python -m SimpleHTTPServer', 'php -S site.test:8000', 'npx serve .', 'npx http-server', 'live-server',
  'npm start', 'npm run dev', 'npm run-script preview', 'yarn dev', 'pnpm run serve', 'bun dev', 'npx vite', 'vite preview', 'next dev', 'ng serve', 'npm run tauri dev', 'npx tauri dev', 'cargo tauri dev', 'npx electron .'], 'serve');

ok('a program inside an app bundle, its path holding spaces', B.kindOf('/Applications/Web Browser.app/Contents/MacOS/Web Browser', ['--headless']) === 'browser');

console.log('\nRun as before: what checks by code:');
each('tests, builds, syntax checks and reading', ['npm test', 'npm run build', 'npm run lint', 'npm run test:unit', 'yarn test', 'pnpm build', 'npx vite build', 'vite build', 'next build',
  'node --check src/app.js', 'python3 -m py_compile app.py', 'python3 -m pytest', 'python3 manage.py test', 'cargo test', 'cargo build', 'go test ./...', 'git status', 'grep -rn total src',
  'php -s index.php', 'php -l index.php', 'npx tsc --noEmit', 'npx eslint src', 'mkdir -p public', 'ls', 'npm install', 'gio info index.html', 'xcrun swift build', 'flutter test'], '');

console.log('\nWhat is said, and where it is asked:');
{
  const said = B.refusal('open', ['index.html']);
  ok('a refusal names the command and why, and says how to check instead', /^Not run: open index\.html opens a file/.test(said) && said.includes(B.INSTEAD) && /syntax check/.test(said), said);
  ok('a command that checks by code is not refused', B.refusal('npm', ['test']) === '' && B.refusal('node', ['--check', 'a.js']) === '');
  ok('launchers are taken off down to what they start', B.startedOf('npx', ['-y', 'playwright', 'test']).join(' ') === 'playwright test' && B.startedOf('cmd', ['/d', '/c', 'start', 'a.html']).join(' ') === 'start a.html');
  ok('no program is started and nothing is read or written by the module', !/\binvoke\(|HC\.invoke|fetch\(|XMLHttpRequest|require\(|import\(|localStorage/.test(src('js', 'code', 'by-code.js')));
  const tools = src('platform', 'tauri', 'hashcoder.js');
  const run = tools.slice(tools.indexOf('async shellRun('), tools.indexOf("HC.guard.request('shell'"));
  ok('shell_run asks it before the guard, so no question is put for a command that will not run', /HCCodeByCode\?\.refusal\(command/.test(run) && /if \(looks\) throw new Error\(looks\)/.test(run));
  ok('every model size is told to check by code and never look at the result',
    (tools.match(/never open the page or the app/gi) || []).length >= 3);
  const boot = src('boot.js');
  ok('loaded before the Coder mode, beside the other shell helpers', boot.indexOf("'/js/code/by-code.js'") > boot.indexOf("'/js/code/pipe.js'") && boot.indexOf("'/js/code/by-code.js'") > 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/by-code.js)`);
process.exit(fail ? 1 : 0);
