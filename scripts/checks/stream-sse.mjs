// ==============================================================
// Stream-reading checks
//
// Loads the REAL src/js/stream/sse.js into a Node VM and drives it with byte
// chunks split in the worst places on purpose.
//
// This is the path every answer travels. Bytes arrive in chunks that fall
// wherever the network puts them, and a reader that assumes a chunk is a whole
// line loses whatever straddles the boundary — silently, because a half line
// is not valid JSON and the parse is in a try/catch. So the chunking here is
// deliberately cruel: mid-line, mid-character, and one byte at a time.
//
// Run with: npm run check:stream-sse
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console, TextDecoder, TextEncoder };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'stream', 'sse.js'), 'utf8'),
  sandbox, { filename: 'sse.js' });
const S = sandbox.window.HCStreamSSE;

const enc = new TextEncoder();
const bodyOf = (chunks) => {
  let i = 0;
  return { getReader: () => ({
    read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
    releaseLock() {},
  }) };
};
/** The same bytes, chopped several different cruel ways. */
const chunkings = (text) => {
  const b = enc.encode(text);
  return {
    'in one piece': [b],
    'a line per chunk': text.split('\n').filter(Boolean).map((l) => enc.encode(l + '\n')),
    'split once down the middle': [b.slice(0, b.length >> 1), b.slice(b.length >> 1)],
    'in twenty-byte pieces': Array.from({ length: Math.ceil(b.length / 20) }, (_, k) => b.slice(k * 20, k * 20 + 20)),
    'one byte at a time': [...b].map((x) => new Uint8Array([x])),
  };
};

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const collect = async (gen) => { const out = []; for await (const v of gen) out.push(v); return out; };

console.log('An answer survives however the bytes are chopped up:');
{
  const events = ['Hello', ' there', ' friend'].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}`);
  const text = events.join('\n') + '\n';
  for (const [how, chunks] of Object.entries(chunkings(text))) {
    const got = (await collect(S.openAIStream(bodyOf(chunks)))).join('');
    ok(`openai, ${how}`, got === 'Hello there friend');
  }
}

console.log('\nAnd so does a local model\'s answer, which is one object per line:');
{
  // This one was written without gathering: each chunk was decoded and split
  // on its own, so a line across a boundary became two fragments that both
  // failed to parse and were both swallowed.
  const text = ['Hello', ' there', ' friend'].map((t) => JSON.stringify({ message: { content: t } })).join('\n') + '\n';
  for (const [how, chunks] of Object.entries(chunkings(text))) {
    const got = (await collect(S.jsonLines(bodyOf(chunks)))).map((o) => o.message.content).join('');
    ok(`ollama, ${how}`, got === 'Hello there friend');
  }

  // Control: decoding and splitting each chunk alone, as it was written.
  const b = enc.encode(text);
  const dec = new TextDecoder();
  let lost = '';
  for (const chunk of [b.slice(0, b.length >> 1), b.slice(b.length >> 1)]) {
    for (const line of dec.decode(chunk).split('\n')) {
      if (!line.trim()) continue;
      try { lost += JSON.parse(line).message.content; } catch { /* the fragment vanishes */ }
    }
  }
  ok('control: reading each chunk on its own loses part of the answer', lost !== 'Hello there friend');
}

console.log('\nA character split across two chunks is not broken in half:');
{
  const text = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi 😀 there' } }] })}\n`;
  const b = enc.encode(text);
  const at = b.lastIndexOf(0xf0) + 2;
  const got = (await collect(S.openAIStream(bodyOf([b.slice(0, at), b.slice(at)])))).join('');
  ok('the emoji arrives whole', got === 'hi 😀 there');
  const lines = await collect(S.jsonLines(bodyOf((() => {
    const t = enc.encode(JSON.stringify({ message: { content: 'hi 😀' } }) + '\n');
    const k = t.lastIndexOf(0xf0) + 2;
    return [t.slice(0, k), t.slice(k)];
  })())));
  ok('and so does a local model\'s', lines[0].message.content === 'hi 😀');
}

console.log('\nWhat a line means:');
{
  ok('a data line gives its event', S.eventFromLine('data: {"a":1}').a === 1);
  ok('the closing marker gives nothing', S.eventFromLine('data: [DONE]') === null);
  ok('a blank line gives nothing', S.eventFromLine('') === null);
  ok('a comment gives nothing', S.eventFromLine(': keep-alive') === null);
  ok('an event name line gives nothing', S.eventFromLine('event: message') === null);
  ok('a broken event gives nothing rather than throwing', S.eventFromLine('data: {oops') === null);
  ok('a carriage return does not matter', S.eventFromLine('data: {"a":1}\r').a === 1);
  ok('no space after the colon is fine', S.eventFromLine('data:{"a":1}').a === 1);
  ok('null does not throw', S.eventFromLine(null) === null);
}

console.log('\nA broken event does not end the answer:');
{
  const text = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'before' } }] })}`,
    'data: {this is not json',
    `data: ${JSON.stringify({ choices: [{ delta: { content: ' after' } }] })}`,
  ].join('\n') + '\n';
  const got = (await collect(S.openAIStream(bodyOf([enc.encode(text)])))).join('');
  ok('what came before and after it both arrive', got === 'before after');
}

console.log('\nEach provider\'s events are read the way that provider sends them:');
{
  ok('openai text', S.openAIText({ choices: [{ delta: { content: 'x' } }] }) === 'x');
  ok('openai empty content is not a token', S.openAIText({ choices: [{ delta: { content: '' } }] }) === null);
  ok('openai usage-only chunk carries no text', S.openAIText({ usage: { prompt_tokens: 1 }, choices: [] }) === null);

  ok('anthropic text', S.anthropicText({ type: 'content_block_delta', delta: { text: 'x' } }) === 'x');
  ok('anthropic start carries no text', S.anthropicText({ type: 'message_start', message: {} }) === null);
  ok('anthropic stop carries no text', S.anthropicText({ type: 'message_stop' }) === null);

  ok('gemini text', S.geminiTexts({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }).join('') === 'x');
  // Gemini can split one reply across several parts in a single event; taking
  // only the first would drop the rest of the sentence.
  ok('gemini keeps every part of one event',
    S.geminiTexts({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] } }] }).join('') === 'abc');
  ok('gemini skips parts that are not text',
    S.geminiTexts({ candidates: [{ content: { parts: [{ inlineData: {} }, { text: 'a' }] } }] }).join('') === 'a');
  ok('gemini usage-only chunk carries no text', S.geminiTexts({ usageMetadata: { promptTokenCount: 3 } }).length === 0);

  for (const junk of [null, undefined, {}, { choices: [] }, { candidates: [] }, 'text', 5]) {
    ok(`nothing throws on ${JSON.stringify(junk) ?? 'undefined'}`, (() => {
      try { S.openAIText(junk); S.anthropicText(junk); S.geminiTexts(junk); return true; } catch { return false; }
    })());
  }
}

console.log('\nAn empty or immediately-closed stream is not an error:');
{
  ok('no chunks at all', (await collect(S.sseLines(bodyOf([])))).length === 0);
  ok('one empty chunk', (await collect(S.sseLines(bodyOf([enc.encode('')])))).length === 0);
  ok('only the closing marker', (await collect(S.openAIStream(bodyOf([enc.encode('data: [DONE]\n')])))).length === 0);
  ok('a last line with no newline still arrives',
    (await collect(S.sseLines(bodyOf([enc.encode('data: a\ndata: b')])))).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/stream/sse.js)`);
process.exit(fail ? 1 : 0);
