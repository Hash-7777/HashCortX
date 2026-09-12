// ==============================================================
// Links, and where the window may go — checks
//
// The window shows the app and nothing else: src-tauri/src/security/
// navigation.rs refuses any navigation away from it (its own tests hold the
// addresses). A link a person clicks opens in the system browser instead,
// from src/platform/index.js. This loads that file into a VM with a stand-in
// document and Tauri, and holds which clicks open what.
//
// Run with: npm run check:links
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = readFileSync(join(root, 'src', 'platform', 'index.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function page({ tauri = true } = {}) {
  const listeners = [];
  const invoked = [];
  const sandbox = {
    URL, console, Promise,
    location: { href: 'tauri://localhost/index.html' },
    document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
  };
  sandbox.window = sandbox;
  if (tauri) sandbox.__TAURI_INTERNALS__ = { invoke: (cmd, args) => { invoked.push({ cmd, args }); return Promise.resolve(); } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'index.js' });
  const click = (href, extra = {}) => {
    let prevented = false;
    const a = { getAttribute: () => href };
    const e = {
      button: 0, isTrusted: true, defaultPrevented: false,
      target: { closest: () => (href == null ? null : a) },
      preventDefault() { prevented = true; },
      ...extra,
    };
    for (const l of listeners.filter((x) => x.type === 'click')) l.fn(e);
    return prevented;
  };
  return { HC: sandbox.HC, click, invoked, listeners };
}

console.log('Which addresses leave the app:');
{
  const { HC } = page();
  const base = 'tauri://localhost/index.html';
  ok('a web page does', HC.externalLink('https://example.com/a?b=1', base) === 'https://example.com/a?b=1');
  ok('plain http too', HC.externalLink('http://example.com/', base) === 'http://example.com/');
  ok('and an email address', HC.externalLink('mailto:someone@example.com', base) === 'mailto:someone@example.com');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'tauri://localhost/other', '#section', '/wheels/x.whl', 'blob:tauri://localhost/1', '', null]) {
    ok(`not ${JSON.stringify(href)}`, HC.externalLink(href, base) === null);
  }
  ok('nor a web address on the app\'s own origin', HC.externalLink('http://tauri.localhost/x', 'http://tauri.localhost/index.html') === null);
}

console.log('\nA click on a link:');
{
  const p = page();
  ok('opens a web link in the system browser, and not in the window', p.click('https://example.com/') === true
    && p.invoked.length === 1 && p.invoked[0].cmd === 'plugin:opener|open_url' && p.invoked[0].args.url === 'https://example.com/');
  ok('leaves an in-app link alone', p.click('#top') === false && p.invoked.length === 1);
  ok('leaves a script address alone', p.click('javascript:alert(1)') === false && p.invoked.length === 1);
  ok('leaves a click another handler dealt with alone', p.click('https://example.com/', { defaultPrevented: true }) === false && p.invoked.length === 1);
  ok('opens nothing for a click no person made', p.click('https://example.com/', { isTrusted: false }) === false && p.invoked.length === 1);
  ok('nor for a middle or right click', p.click('https://example.com/', { button: 1 }) === false && p.invoked.length === 1);
  ok('nor for a click that is not on a link', p.click(null) === false && p.invoked.length === 1);
}
{
  const p = page({ tauri: false });
  ok('outside the desktop app nothing is intercepted', p.listeners.length === 0);
}

console.log('\nThe window is kept on the app:');
{
  const lib = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const nav = readFileSync(join(root, 'src-tauri', 'src', 'security', 'navigation.rs'), 'utf8');
  ok('the navigation guard is registered, first', /tauri::Builder::default\(\)\s*(?:\/\/[^\n]*\n\s*)*\.plugin\(security::navigation::guard\(\)\)/.test(lib));
  ok('and refuses by default', /_ => false,/.test(nav));
}

console.log(`\n${pass} passed, ${fail} failed  (links and navigation)`);
process.exit(fail ? 1 : 0);
