// ==============================================================
// The cap on cloud AI requests — checks
//
// Loads the REAL src/js/providers.js, src/js/model-routes.js and
// src/js/request-cap.js with a stand-in network, and holds what the cap
// counts, when it refuses, when a place is given back, and that its refusal
// is not mistaken by any failover for a provider's own limit.
//
// Run with: npm run check:request-cap
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A page with the real modules, a stand-in fetch and bridge, and a clock moved by hand. */
function page() {
  const sent = [];
  // The cap's three-minute hold timers must not keep this check running.
  const unrefTimeout = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  const sandbox = { console, URL, Response, ReadableStream, Headers, TextEncoder, AbortController, DOMException, setTimeout: unrefTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.fetch = async (input, init = {}) => {
    sent.push({ url: String(input), method: init.method || 'GET' });
    if (init.fail) throw new TypeError('Failed to fetch');
    return new Response(init.status === 204 ? null : 'data: answer\n\n', { status: init.status || 200 });
  };
  sandbox.HC = { providerBridge: { request: async (provider, route) => { sent.push({ bridge: `${provider}/${route}` }); return new Response('{}'); } } };
  vm.createContext(sandbox);
  vm.runInContext(src('js', 'providers.js'), sandbox, { filename: 'providers.js' });
  vm.runInContext(src('js', 'model-routes.js'), sandbox, { filename: 'model-routes.js' });
  vm.runInContext(src('js', 'request-cap.js'), sandbox, { filename: 'request-cap.js' });
  return { w: sandbox, sent };
}
const POST = { method: 'POST', body: '{}' };
const refused = async (p) => { try { await p; return null; } catch (e) { return e; } };

console.log('What counts:');
{
  const { w } = page();
  const origins = new Set(w.HCProviders.allHosts());
  const is = (url, method) => w.HCRequestCap.isCloudAiRequest(url, { method }, origins);
  ok('a chat request to a cloud provider counts', is('https://api.groq.com/openai/v1/chat/completions', 'POST'));
  ok('... so does one to Anthropic and one to Gemini', is('https://api.anthropic.com/v1/messages', 'POST') && is('https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent', 'POST'));
  ok('a model list, which only reads, does not', !is('https://api.groq.com/openai/v1/models', 'GET'));
  ok('a local model does not', !is('http://localhost:11434/api/chat', 'POST') && !is('http://127.0.0.1:11434/api/chat', 'POST'));
  ok('web search does not', !is('https://api.tavily.com/search', 'POST'));
  ok('a malformed address does not, and does not throw', !is('not a url', 'POST'));
}

console.log('\nThirty a minute:');
{
  let now = 0;
  const { w } = page();
  const cap = w.HCRequestCap.createCap({ now: () => now });
  const gives = [];
  for (let i = 0; i < 30; i++) { gives.push(cap.take()); gives.at(-1)(); }
  const e = (() => { try { cap.take(); return null; } catch (err) { return err; } })();
  ok('the thirty-first in a minute is refused', e && e.name === 'RequestCapError' && e.cap === 'minute');
  ok('... saying what was reached and what to do', /more than 30 cloud AI requests in one minute[\s\S]*Wait a minute/.test(e?.message || ''));
  now += 59_999;
  ok('still refused just before the minute is up', (() => { try { cap.take(); return false; } catch { return true; } })());
  now += 1;
  ok('allowed again once the first has left the minute', (() => { try { cap.take()(); return true; } catch { return false; } })());
}

console.log('\nSix at once:');
{
  const { w } = page();
  const cap = w.HCRequestCap.createCap();
  const gives = Array.from({ length: 6 }, () => cap.take());
  const e = (() => { try { cap.take(); return null; } catch (err) { return err; } })();
  ok('a seventh running at once is refused', e && e.cap === 'once' && /more than 6 cloud AI requests running at once/.test(e.message));
  gives[0](); gives[0]();
  ok('giving one back twice frees one place, not two', cap.state().running === 5);
  ok('... and a new request fits', (() => { try { cap.take(); return true; } catch { return false; } })());
}

console.log('\nIn the page, a place is held until the answer is done:');
{
  const { w, sent } = page();
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const open = [];
  for (let i = 0; i < 6; i++) open.push(await w.fetch(url, POST));
  const seventh = await refused(w.fetch(url, POST));
  ok('six answers still unread hold six places; the seventh is refused before it is sent', seventh?.cap === 'once' && sent.length === 6);
  await open[0].text();
  ok('reading an answer to the end frees its place', !(await refused(w.fetch(url, POST))));
  await open[1].body.cancel();
  ok('cancelling an answer frees its place', !(await refused(w.fetch(url, POST))));
  ok('what is read is the answer the provider sent', (await open[2].text()) === 'data: answer\n\n' && open[3].status === 200);
  const models = await refused(w.fetch('https://api.groq.com/openai/v1/models'));
  const local = await refused(w.fetch('http://localhost:11434/api/chat', POST));
  ok('a model list and a local model are sent even with every place taken', !models && !local);
  const failing = await refused(w.fetch(url, { ...POST, fail: true }));
  ok('a request that fails gives its place back', failing?.name === 'TypeError' && w.HCRequestCap.state().running === 5);
}
{
  const { w } = page();
  const url = 'https://api.openai.com/v1/chat/completions';
  const ctrl = new AbortController();
  for (let i = 0; i < 5; i++) await w.fetch(url, POST);
  await w.fetch(url, { ...POST, signal: ctrl.signal });
  ctrl.abort();
  ok('a stopped request gives its place back', w.HCRequestCap.state().running === 5);
  const empty = await w.fetch(url, { ...POST, status: 204 });
  ok('an answer with no body holds no place', empty.status === 204 && w.HCRequestCap.state().running === 5);
}
{
  const { w } = page();
  let fire = null;
  const give = () => { give.called = (give.called || 0) + 1; };
  w.HCRequestCap.holdUntilRead(new Response('x'), give, { holdMs: 5, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  fire();
  ok('an answer nobody reads gives its place back after the hold time', give.called === 1);
}

console.log('\nThe three providers called through the app:');
{
  const { w, sent } = page();
  for (let i = 0; i < 6; i++) await w.HC.providerBridge.request('samba', 'chat', {});
  const seventh = await refused(w.HC.providerBridge.request('nvidia', 'chat', {}));
  ok('their chat requests count toward the same cap', seventh?.cap === 'once');
  ok('their model lists do not', !(await refused(w.HC.providerBridge.request('nvidia', 'models', {}))) && sent.at(-1).bridge === 'nvidia/models');
}

console.log('\nNo failover mistakes the cap for a provider\'s limit:');
{
  const { w } = page();
  const errs = ['minute', 'once'].map((k) => w.HCRequestCap.capError(k));
  ok('the shared router reads it as a plain failure, not a limit, busy, key or slow', errs.every((e) => w.HCModelRoutes.failureKind(e) === 'other'));
  const chatRetry = /rate limit|overloaded|server error|429|503|529|5\d\d/;
  ok('chat does not retry it on another model', errs.every((e) => !chatRetry.test(e.message)));
  const vos = src('modes', 'virtual-os', 'mode.js');
  const m = vos.match(/function isRouteFailure\(err\) \{[\s\S]*?return (\/[\s\S]*?\/i)\.test\(msg\);/);
  const vosRetry = m ? vm.runInNewContext(m[1]) : null;
  ok('Virtual OS does not try another model for it', !!vosRetry && errs.every((e) => !vosRetry.test(e.message)));
}

console.log('\nIt is in place before anything can send:');
{
  const boot = src('boot.js');
  const at = (f) => boot.indexOf(`'${f}'`);
  ok('after the provider table and the Rust bridge', at('/js/request-cap.js') > at('/js/providers.js') && at('/js/request-cap.js') > at('/platform/tauri/provider-bridge.js'));
  ok('before the app, the modes and the sandbox', at('/js/request-cap.js') < at('/js/app.js') && at('/js/request-cap.js') < at('/modes/manifest.js') && at('/js/request-cap.js') < at('/core/sandbox/pyodide.js'));
}

console.log(`\n${pass} passed, ${fail} failed  (request cap)`);
process.exit(fail ? 1 : 0);
