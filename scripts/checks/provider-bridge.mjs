// ==============================================================
// The page side of the provider bridge — checks
//
// Loads the REAL src/platform/tauri/provider-bridge.js with a stand-in for
// Tauri: a Channel class and an invoke that plays back what
// src-tauri/src/commands/provider.rs sends. The Rust side has its own tests
// for what it will send and to where; these hold what the page makes of it.
//
// What matters is that the answer reads exactly like a fetch, because every
// reader of a provider's answer — status, error body, streamed events — was
// written for fetch and is not told the difference:
//
//  - a reply that starts is a Response whose body streams as it arrives;
//  - a failure before anything arrives rejects, and one after it errors the
//    stream, each as a TypeError the model router reads as unreachable;
//  - a stopped request rejects with an AbortError at once, and the app is
//    told to drop the reply;
//  - nothing the app did not send is invented, and nothing is sent twice.
//
// Run with: npm run check:provider-bridge
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', '..', 'src', 'platform', 'tauri', 'provider-bridge.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const tick = () => new Promise((r) => setTimeout(r, 1));

/**
 * A page with the bridge loaded. `script(args)` returns the events the app
 * would send for that request; they are played to the channel in order, one
 * tick apart, the way they arrive.
 */
function page({ tauri = true, script = () => [], invokeFails = null } = {}) {
  class Channel { constructor() { this.onmessage = null; } }
  const invokes = [];
  const sandbox = {
    window: {}, console, setTimeout, TextEncoder, TextDecoder, Response, Headers, ReadableStream,
    DOMException, AbortController, crypto: globalThis.crypto,
  };
  sandbox.window = sandbox;
  sandbox.HC = {
    isTauri: tauri,
    invoke: async (cmd, args) => {
      invokes.push({ cmd, args });
      if (cmd !== 'provider_request') return null;
      if (invokeFails) throw new Error(invokeFails);
      for (const evt of script(args)) { await tick(); args.onEvent.onmessage && args.onEvent.onmessage(evt); }
      return null;
    },
  };
  if (tauri) sandbox.__TAURI__ = { core: { Channel } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'provider-bridge.js' });
  return { bridge: sandbox.HC.providerBridge, invokes };
}

const head = (status, mime = 'application/json', retry = null) => ({ kind: 'head', status, mime, retry });
const chunk = (text) => ({ kind: 'chunk', text });
const END = { kind: 'end' };

console.log('A reply reads like a fetch:');
{
  const { bridge, invokes } = page({ script: () => [head(200, 'text/event-stream'), chunk('data: {"a":'), chunk('1}\n\n'), chunk('Café — 日本'), END] });
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{"model":"m"}' });
  ok('it is a Response with the status the provider sent', res instanceof Response && res.status === 200 && res.ok);
  ok('carrying its content type', res.headers.get('content-type') === 'text/event-stream');
  const text = await res.text();
  ok('the body is every chunk, in order, text intact', text === 'data: {"a":1}\n\nCafé — 日本', JSON.stringify(text));
  const sent = invokes.find((i) => i.cmd === 'provider_request').args;
  ok('the request named the provider, the route, the key and the body', sent.provider === 'samba' && sent.route === 'chat' && sent.key === 'k' && sent.body === '{"model":"m"}');
  ok('with an id of the kind the app accepts', /^[A-Za-z0-9-]{1,64}$/.test(sent.requestId));
  ok('and nothing else — no address, no headers', Object.keys(sent).sort().join() === 'body,key,onEvent,provider,requestId,route');
  ok('one request, and nothing to stop once it has ended', invokes.filter((i) => i.cmd === 'provider_request').length === 1 && !invokes.some((i) => i.cmd === 'provider_request_cancel'));
}
{
  const { bridge } = page({ script: () => [head(200), chunk('{"data":[{"id":"m"}]}'), END] });
  const res = await bridge.request('nvidia', 'models', { key: 'k' });
  ok('a model list reads as JSON', (await res.json()).data[0].id === 'm');
}
{
  const { bridge, invokes } = page({ script: () => [head(200), END] });
  await bridge.request('nvidia', 'models', { key: 'k' });
  ok('a model list sends no body at all', invokes[0].args.body === null);
}

console.log('\nA refusal reads like any provider\'s:');
{
  const { bridge } = page({ script: () => [head(429, 'application/json', '30'), chunk('{"error":{"message":"slow down"}}'), END] });
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{}' });
  ok('the status comes through, and ok is false', res.status === 429 && res.ok === false);
  ok('with how long to wait', res.headers.get('retry-after') === '30');
  ok('and the whole body, for the app to read the reason out of', (await res.text()).includes('slow down'));
}
{
  const { bridge } = page({ script: () => [head(204), END] });
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{}' });
  ok('a status that may carry no body gets none, rather than throwing', res.status === 204);
}
{
  const { bridge } = page({ script: () => [head(700), END] });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}' }); } catch (e) { err = e; }
  ok('a status no Response can hold is a failure, not a crash', err?.name === "TypeError" && /status 700/.test(err.message));
}

console.log('\nA failure is reported where the reader will see it:');
{
  const { bridge } = page({ script: () => [{ kind: 'fail', message: 'the provider was unreachable: dns' }] });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}' }); } catch (e) { err = e; }
  ok('before anything arrived, the request rejects', !!err);
  ok('as a TypeError, the way a fetch that could not connect does', err?.name === "TypeError");
  ok('with the reason, and whose it was', /samba/.test(err.message) && /unreachable/.test(err.message));
}
{
  const { bridge } = page({ script: () => [head(200, 'text/event-stream'), chunk('data: partial'), { kind: 'fail', message: 'the network connection broke part-way through the reply' }] });
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{}' });
  let err = null;
  try { await res.text(); } catch (e) { err = e; }
  ok('after the reply started, the stream errors instead', err?.name === "TypeError" && /part-way/.test(err.message));
}
{
  const { bridge } = page({ invokeFails: 'invalid args `requestId`' });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}' }); } catch (e) { err = e; }
  ok('a command Tauri itself refused rejects too', err?.name === "TypeError" && /invalid args/.test(err.message));
}
{
  const { bridge } = page({ script: () => [END] });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}' }); } catch (e) { err = e; }
  ok('an end with no reply before it is a failure, not a hang', err?.name === "TypeError" && /without answering/.test(err.message));
}
{
  const { bridge } = page({ script: () => [head(200), chunk('{"a":1}'), END, chunk('INVENTED'), head(500), END] });
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{}' });
  const text = await res.text();
  ok('nothing after the end is added to the answer', text === '{"a":1}' && res.status === 200);
}

console.log('\nStopping a request:');
{
  let events = [];
  const { bridge, invokes } = page({ script: () => events });
  events = [head(200, 'text/event-stream'), chunk('first ')];
  const ctrl = new AbortController();
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{}', signal: ctrl.signal });
  const reader = res.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  let err = null;
  try { await reader.read(); } catch (e) { err = e; }
  ok('the part that arrived was readable', first === 'first ');
  ok('stopping part-way errors the stream with an AbortError', err && err.name === 'AbortError');
  const id = invokes.find((i) => i.cmd === 'provider_request').args.requestId;
  await tick();
  ok('and tells the app to drop that request', invokes.some((i) => i.cmd === 'provider_request_cancel' && i.args.requestId === id));
}
{
  const ctrl = new AbortController();
  const { bridge } = page({ script: () => { ctrl.abort(); return [head(200), END]; } });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}', signal: ctrl.signal }); } catch (e) { err = e; }
  ok('stopping before the reply starts rejects with an AbortError', err && err.name === 'AbortError');
}
{
  const ctrl = new AbortController();
  ctrl.abort();
  const { bridge, invokes } = page({ script: () => [head(200), END] });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}', signal: ctrl.signal }); } catch (e) { err = e; }
  ok('a request already stopped is never sent', err && err.name === 'AbortError' && invokes.length === 0);
}
{
  const { bridge, invokes } = page({ script: () => [head(200), chunk('a'), chunk('b')] });
  const res = await bridge.request('samba', 'chat', { key: 'k', body: '{}' });
  await res.body.cancel();
  await tick();
  ok('a reader that walks away tells the app too', invokes.some((i) => i.cmd === 'provider_request_cancel'));
}

console.log('\nOutside the desktop app:');
{
  const { bridge, invokes } = page({ tauri: false });
  let err = null;
  try { await bridge.request('samba', 'chat', { key: 'k', body: '{}' }); } catch (e) { err = e; }
  ok('it refuses plainly rather than pretending', err?.name === "TypeError" && /desktop app/.test(err.message) && invokes.length === 0);
}

console.log('\nThe app loads it, and only the platform layer calls it natively:');
{
  const boot = readFileSync(join(here, '..', '..', 'src', 'boot.js'), 'utf8');
  ok('it loads before the app that uses it', boot.indexOf("'/platform/tauri/provider-bridge.js'") > 0 && boot.indexOf("'/platform/tauri/provider-bridge.js'") < boot.indexOf("'/js/app.js'"));
  const app = readFileSync(join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');
  ok('the app never invokes the command itself', !/provider_request/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed  (provider bridge, page side)`);
process.exit(fail ? 1 : 0);
