// ==============================================================
// A scripted stand-in for a local model server, for `run.mjs --smoke`
//
// It answers one task, js-fix-range, turn by turn the way a model would: run
// the tests, read the file, write the fix into its reply instead of making
// it, make the edit once sent back — its passage indented one level less than
// the file, as small models often write it — and then try to finish without
// running the tests again. What the app must do in answer is fixed, so a run
// with this model checks the HashCoder loop itself: the tools, being sent
// back to make a change written into the reply, the edit matching, being sent
// back to prove the change, and the line saying what was proven. It needs no
// real model and takes seconds.
//
// It listens on this computer only, answers only what the app asks of a model
// server, and is closed by the run that started it.
// ==============================================================
import { createServer } from 'node:http';

export const SCRIPTED_MODEL = 'scripted:7b';
const NOTE = 'Note from HashCortX';

/** The next reply, from the conversation so far. */
function reply(messages) {
  const sys = messages.find((m) => m.role === 'system')?.content || '';
  const root = (/Project root: (.+)/.exec(sys) || [])[1]?.trim() || '';
  const done = messages.filter((m) => m.role === 'tool').length;
  const notes = messages.filter((m) => m.role === 'user' && String(m.content).startsWith(NOTE)).map((m) => String(m.content));
  const toMake = notes.some((n) => n.includes('no file in the project was changed'));
  const sentBack = notes.some((n) => n.includes('no test has run'));
  const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });
  if (done === 0) return call('shell_run', { command: 'npm', args: ['test'], cwd: root });
  if (done === 1) return call('read_file', { path: `${root}/src/range.js` });
  if (done === 2 && !toMake) {
    return { role: 'assistant', content: 'Here is the fix:\n\n```js\nfunction range(start, end, step = 1) {\n  const out = [];\n  for (let n = start; n <= end; n += step) out.push(n);\n  return out;\n}\n```' };
  }
  if (done === 2) {
    // Two lines written without the file's indentation, so the passage is not
    // there as written and is found only with its indentation adjusted.
    return call('patch_file', {
      path: `${root}/src/range.js`,
      search: 'const out = [];\nfor (let n = start; n < end; n += step) out.push(n);',
      replace: 'const out = [];\nfor (let n = start; n <= end; n += step) out.push(n);',
    });
  }
  if (done === 3 && !sentBack) return { role: 'assistant', content: 'Fixed the loop so the end is included.' };
  if (done === 3) return call('shell_run', { command: 'npm test' });
  return { role: 'assistant', content: 'Fixed the loop so the end is included, and npm test passes.' };
}

/** Start the stand-in on a free port. Resolves to `{ url, close }`. */
export function startScriptedModel() {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.end(); return; }
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch {}
      const json = (v) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
      const url = req.url || '';
      if (url.startsWith('/api/tags')) return json({ models: [{ name: SCRIPTED_MODEL, model: SCRIPTED_MODEL, size: 1, details: { parameter_size: '7.6B' } }] });
      if (url.startsWith('/api/version')) return json({ version: '0.0.0' });
      if (url.startsWith('/api/ps')) return json({ models: [] });
      if (url.startsWith('/api/show')) return json({ details: { parameter_size: '7.6B' }, capabilities: ['completion', 'tools'], model_info: { 'scripted.context_length': 32768 } });
      if (url.startsWith('/api/generate')) return json({ done: true });
      if (url.startsWith('/api/chat')) {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const message = messages.length ? reply(messages) : { role: 'assistant', content: '' };
        const end = { done: true, done_reason: 'stop', prompt_eval_count: 1000, eval_count: 50 };
        if (body.stream === false) return json({ message, ...end });
        res.setHeader('content-type', 'application/x-ndjson');
        res.write(JSON.stringify({ message, done: false }) + '\n');
        res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, ...end }) + '\n');
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}
