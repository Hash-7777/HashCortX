// ==============================================================
// Reading a model's answer off the wire
//
// Every cloud provider streams its reply as server-sent events, and every one
// of them is read the same way: bytes arrive in chunks that fall wherever the
// network puts them, are gathered into whole lines, and each line carries one
// JSON event. Only what each event MEANS differs between providers.
//
// That reading was written out once per provider family, and the local model
// path alone had three copies of it, each doing its own chunk gathering. A
// fault found in one copy would have been fixed in one copy, and one of them
// had already lost the buffer the others kept. The gathering is here now,
// once; the meaning of an event stays with the provider that sends it.
//
// This is the path every answer travels, so the parts that can be checked are
// separated from the parts that need a network: a line reader that takes any
// stream of bytes, and a set of small readers that turn one event into text.
//
// Loaded before app.js and published as window.HCStreamSSE.
// Checked by scripts/checks/stream-sse.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Whole lines out of a stream of bytes.
   *
   * A chunk boundary lands wherever the network puts it: in the middle of a
   * line, or in the middle of a character. The decoder is told the bytes are
   * streaming so a character split across two chunks is held until it is
   * complete, and it is flushed at the end so a stream that stops mid-character
   * does not silently drop it.
   */
  async function* sseLines(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) yield line;
      }
      buf += decoder.decode();
      if (buf) yield buf;
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  /**
   * The event carried by one line, or null when the line carries none.
   *
   * Blank lines, comments, the closing marker and anything that is not JSON all
   * come back as null. A malformed event is skipped rather than ending the
   * stream: the rest of an answer is worth more than the part that arrived
   * broken.
   */
  function eventFromLine(line) {
    const s = String(line == null ? '' : line).trim();
    if (!s.startsWith('data:')) return null;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  /**
   * One JSON object per line, which is how a local model streams.
   *
   * Same gathering as the events above. Written out separately once without
   * it, each chunk was decoded and split on its own with nothing carried
   * between them, so any line that straddled a chunk boundary became two
   * fragments that both failed to parse and were both swallowed. Whole
   * sentences went missing, and with small enough chunks the entire answer did.
   */
  async function* jsonLines(body) {
    for await (const line of sseLines(body)) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // A line that is not JSON is skipped, the way a broken event is.
      }
    }
  }

  /** The text an OpenAI-shaped event carries, if any. */
  function openAIText(evt) {
    const content = evt?.choices?.[0]?.delta?.content;
    return typeof content === 'string' && content !== '' ? content : null;
  }

  /**
   * The thinking a reasoning model streams before its answer, if any.
   *
   * Not shown as the answer. It is read only so a model that is thinking can
   * be told apart from one that has not started — for a reasoning model the
   * first words of the answer can come many seconds after the first sign of
   * work.
   */
  function openAIReasoning(evt) {
    const d = evt?.choices?.[0]?.delta;
    const r = d && (d.reasoning ?? d.reasoning_content);
    return typeof r === 'string' && r !== '' ? r : null;
  }

  /**
   * The failure an OpenAI-shaped reply carries inside itself, or null.
   *
   * A gateway that has already answered 200 cannot change its status when the
   * model behind it then fails, so it says so in the body instead: an `error`
   * on the event (or on the whole reply, when not streaming), or on the choice.
   * Read as text, that reply is simply empty — which is a failure that looks
   * like a finished answer, and never reaches the code that moves on to
   * another model. `status` is the code the body gives, so it is judged the
   * way the same failure sent as an HTTP status would be.
   */
  function openAIError(evt) {
    if (!evt || typeof evt !== 'object') return null;
    const choice = Array.isArray(evt.choices) ? evt.choices[0] : null;
    const err = evt.error || (choice && choice.error) || null;
    if (err) {
      const message = typeof err === 'string' ? err : String(err.message || err.type || 'the provider reported an error');
      const code = Number(typeof err === 'object' ? err.code || err.status : NaN);
      return { status: Number.isInteger(code) && code >= 400 && code < 600 ? code : 502, message };
    }
    if (choice && choice.finish_reason === 'error') return { status: 502, message: 'the model stopped with an error' };
    return null;
  }

  /** The text an Anthropic event carries, if any. */
  function anthropicText(evt) {
    if (evt?.type !== 'content_block_delta') return null;
    const text = evt.delta?.text;
    return typeof text === 'string' && text !== '' ? text : null;
  }

  /**
   * The text a Gemini event carries.
   *
   * Gemini may split one reply across several parts in a single event, so this
   * returns a list rather than one string — taking only the first would drop
   * the rest of the sentence.
   */
  function geminiTexts(evt) {
    const parts = evt?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return [];
    return parts.map((p) => p?.text).filter((t) => typeof t === 'string' && t !== '');
  }

  /**
   * Read a whole OpenAI-shaped stream as text.
   *
   * `onUsage` is handed each event so the provider's own token counting can
   * read it, which differs between them and does not belong here.
   */
  async function* openAIStream(body, onEvent) {
    for await (const line of sseLines(body)) {
      const evt = eventFromLine(line);
      if (!evt) continue;
      if (onEvent) onEvent(evt);
      const failed = openAIError(evt);
      if (failed) throw Object.assign(new Error(failed.message), { status: failed.status, inBody: true });
      const text = openAIText(evt);
      if (text !== null) yield text;
    }
  }

  window.HCStreamSSE = {
    sseLines,
    jsonLines,
    eventFromLine,
    openAIText,
    openAIReasoning,
    openAIError,
    anthropicText,
    geminiTexts,
    openAIStream,
  };
})();
