// ============================================================
// Speaking MCP to a connected system — src/js/mcp/client.js.
// Every system here is a stand-in answering the way real ones do.
// Run with: npm run check:mcp-client
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, JSON, Math, Number, String, Array, Object, Map, Promise, Error };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'mcp', 'client.js'), 'utf8'), sandbox, { filename: 'client.js' });
const M = sandbox.window.HCMcpClient;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const reply = (status, msg) => ({ status, mime: 'application/json', body: msg === undefined ? '' : JSON.stringify(msg) });
const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** A stand-in system: `answer(body, version)` returns a reply; every request is recorded. */
function system(answer) {
  const sent = [];
  const request = async (id, body, version) => {
    const msg = JSON.parse(body);
    sent.push({ id, msg, version });
    return answer(msg, version, sent);
  };
  return { sent, client: M.create({ request, clientInfo: { name: 'HashCortx', version: 't' } }) };
}

console.log('A system on the current protocol, which keeps no session:');
{
  const s = system((m) => {
    if (m.method === 'server/discover') return reply(200, result(m.id, { supportedVersions: ['2026-07-28'], serverInfo: { name: 'erp' } }));
    if (m.method === 'tools/list' && !m.params.cursor) return reply(200, result(m.id, { tools: [{ name: 'search_records', inputSchema: {} }], nextCursor: 'p2' }));
    if (m.method === 'tools/list') return reply(200, result(m.id, { tools: [{ name: 'get_record', inputSchema: {} }] }));
    if (m.method === 'tools/call') return reply(200, result(m.id, { resultType: 'complete', content: [{ type: 'text', text: 'Invoice 7' }] }));
    return reply(400, error(m.id, -32601, 'no'));
  });
  const tools = await s.client.listTools('c1');
  ok('it is asked what it is, and every page of tools is read', tools.map((t) => t.name).join() === 'search_records,get_record');
  ok('it is never greeted the older way', !s.sent.some((r) => r.msg.method === 'initialize'));
  const listed = s.sent.filter((r) => r.msg.method === 'tools/list');
  ok('every request carries the protocol version in _meta, and names the app', listed.every((r) => r.msg.params._meta['io.modelcontextprotocol/protocolVersion'] === '2026-07-28' && r.msg.params._meta['io.modelcontextprotocol/clientInfo'].name === 'HashCortx'));
  ok('... and the native side is told the version for its header', s.sent.every((r) => r.version === '2026-07-28'));
  const r = await s.client.callTool('c1', 'search_records', { query: 'unpaid' });
  ok('a tool runs and hands back what the system said', r.content[0].text === 'Invoice 7');
  const call = s.sent.find((x) => x.msg.method === 'tools/call');
  ok('with its name and arguments', call.msg.params.name === 'search_records' && call.msg.params.arguments.query === 'unpaid');
}

console.log('\nA system from before, which is greeted first:');
{
  const s = system((m, v) => {
    if (m.method === 'server/discover') return reply(200, error(m.id, -32601, 'Method not found'));
    if (m.method === 'initialize') return reply(200, result(m.id, { protocolVersion: '2025-06-18', serverInfo: { name: 'older-erp' }, capabilities: { tools: {} } }));
    if (m.method === 'notifications/initialized') return reply(202);
    if (m.method === 'tools/list') return reply(200, result(m.id, { tools: [{ name: 'search_records', inputSchema: {} }] }));
    return reply(400);
  });
  const tools = await s.client.listTools('c2');
  ok('it is greeted, told the app is ready, then asked for its tools', s.sent.map((r) => r.msg.method).join() === 'server/discover,initialize,notifications/initialized,tools/list' && tools.length === 1);
  ok('it is offered the newest older version, and answered in the one it chose', s.sent[1].msg.params.protocolVersion === '2025-11-25' && s.sent[3].version === '2025-06-18');
  ok('the note that the app is ready is a notification, with no id', !('id' in s.sent[2].msg));
  ok('no stateless _meta is sent to it', !('_meta' in (s.sent[3].msg.params || {})));
  await s.client.listTools('c2');
  ok('it is greeted once, not before every request', s.sent.filter((r) => r.msg.method === 'initialize').length === 1);
}

console.log('\nA system that does not know server/discover at all:');
{
  const s = system((m) => {
    if (m.method === 'server/discover') return { status: 400, mime: 'text/plain', body: 'Bad Request: No valid session ID provided' };
    if (m.method === 'initialize') return reply(200, result(m.id, { protocolVersion: '2025-11-25' }));
    if (m.method === 'notifications/initialized') return reply(202);
    return reply(200, result(m.id, { tools: [] }));
  });
  await s.client.listTools('c3');
  ok('an answer that is not JSON-RPC still leads to the older greeting', s.sent.some((r) => r.msg.method === 'initialize'));
}

console.log('\nWhat goes wrong is said plainly:');
{
  const s = system(() => reply(401));
  let e = null;
  try { await s.client.listTools('c4'); } catch (x) { e = x; }
  ok('a refused sign-in says so, and points at Settings', e && e.kind === 'auth' && /refused the sign-in/.test(e.message));
  ok('... and is not tried again the older way', s.sent.length === 1);

  const down = M.create({ request: async () => { throw new Error('connection refused'); } });
  let u = null;
  try { await down.listTools('c5'); } catch (x) { u = x; }
  ok('a system that cannot be reached says so', u && u.kind === 'unreachable' && /connection refused/.test(u.message));

  const odd = system((m) => {
    if (m.method === 'server/discover') return reply(200, error(m.id, -32601, 'no'));
    return reply(200, result(m.id, { protocolVersion: '1999-01-01' }));
  });
  let v = null;
  try { await odd.client.listTools('c6'); } catch (x) { v = x; }
  ok('a system speaking a version the app does not is refused', v && v.kind === 'protocol' && /1999-01-01/.test(v.message));

  const asks = system((m) => {
    if (m.method === 'server/discover') return reply(200, result(m.id, { supportedVersions: ['2026-07-28'] }));
    return reply(200, result(m.id, { resultType: 'input_required', inputRequests: {} }));
  });
  let w = null;
  try { await asks.client.callTool('c7', 'x', {}); } catch (x) { w = x; }
  ok('a system asking for more input part-way says the app does not support it yet', w && w.kind === 'tool' && /does not support it yet|does not support/.test(w.message));

  const bad = system((m) => {
    if (m.method === 'server/discover') return reply(200, result(m.id, { supportedVersions: ['2026-07-28'] }));
    return reply(200, error(m.id, -32602, 'Unknown tool: nope'));
  });
  let x = null;
  try { await bad.client.callTool('c8', 'nope', {}); } catch (y) { x = y; }
  ok('an error the system gives is passed on in its words', x && /Unknown tool: nope/.test(x.message));
}

console.log('\nA session that ended:');
{
  let listedOnce = false;
  const s = system((m) => {
    if (m.method === 'server/discover') return reply(200, error(m.id, -32601, 'no'));
    if (m.method === 'initialize') return reply(200, result(m.id, { protocolVersion: '2025-11-25' }));
    if (m.method === 'notifications/initialized') return reply(202);
    if (!listedOnce) { listedOnce = true; return reply(404); }
    return reply(200, result(m.id, { tools: [{ name: 'a', inputSchema: {} }] }));
  });
  const tools = await s.client.listTools('c9');
  ok('the system is greeted again and the request made once more', tools.length === 1 && s.sent.filter((r) => r.msg.method === 'initialize').length === 2);
}

console.log('\nLimits:');
{
  let n = 0;
  const s = system((m) => {
    if (m.method === 'server/discover') return reply(200, result(m.id, { supportedVersions: ['2026-07-28'] }));
    n++;
    return reply(200, result(m.id, { tools: [{ name: `t${n}`, inputSchema: {} }], nextCursor: `p${n}` }));
  });
  const tools = await s.client.listTools('c10');
  ok('a list that never ends is read a bounded number of pages', tools.length === 10 && n === 10);
  const many = system((m) => {
    if (m.method === 'server/discover') return reply(200, result(m.id, { supportedVersions: ['2026-07-28'] }));
    return reply(200, result(m.id, { tools: Array.from({ length: 500 }, (_, i) => ({ name: `t${i}`, inputSchema: {} })) }));
  });
  ok('... and a bounded number of tools', (await many.client.listTools('c11')).length === 200);
  const nameless = system((m) => {
    if (m.method === 'server/discover') return reply(200, result(m.id, { supportedVersions: ['2026-07-28'] }));
    return reply(200, result(m.id, { tools: [{ inputSchema: {} }, { name: '', inputSchema: {} }, { name: 'real', inputSchema: {} }] }));
  });
  ok('a tool with no name is not kept', (await nameless.client.listTools('c12')).map((t) => t.name).join() === 'real');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/mcp/client.js)`);
process.exit(fail ? 1 : 0);
