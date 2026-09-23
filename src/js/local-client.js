// ============================================================
// local-client.js — one way of talking to a model on this computer
//
// The chat, the side-by-side view, the agents and every mode each wrote out
// their own request to Ollama and their own reading of its reply. Each read
// only the words, so a model that thinks before it answers sat silent for as
// long as it thought, with its thinking thrown away; a failure Ollama reports
// part-way through a reply was never read at all; and each copy chose its own
// window and its own lifetime for the model.
//
// A model is kept loaded for as long as Ollama keeps any model after a
// request — five minutes unless the person set it otherwise — and never for
// good. Held for good, a model marked to make room for another was kept by the
// next request to it, and on a computer short of memory the other model
// waited until it was given up on.
//
// There is one request and one reading of the reply now. The reply is read as
// it arrives: the words, the thinking, and the tool calls, each handed to the
// caller as it comes, and the whole returned at the end with Ollama's own
// counts. A model that writes its thinking into its words between think tags
// has it taken out of the answer the same way.
//
// `warm` loads a model ahead of the request that needs it, at the window that
// request will use, so the first answer does not wait for the load.
//
// Pure apart from the network call it is given. Published as window.HCLocal.
// Checked by scripts/checks/local-client.mjs.
// ============================================================
(function () {
  "use strict";

  /** The body of one request to Ollama's chat. */
  function body({ model, messages, stream = true, temperature, numCtx, numPredict, json, tools, keepAlive, think }) {
    const options = {};
    if (Number.isFinite(numCtx)) options.num_ctx = numCtx;
    // An answer held to a schema can only end when its JSON closes, and a small
    // model can keep adding to a list without end; its length is bounded.
    // Every other answer ends where its window does. Left unbounded, Ollama
    // makes room by dropping the start of the conversation and writes on, so
    // a small model repeating itself never stopped: an agent on a 3B model
    // wrote for its whole five minutes and was given up on.
    const C = typeof window !== "undefined" && window.HCLocalContext;
    const room = C && Number.isFinite(numCtx) && Array.isArray(messages) && messages.length
      ? Math.max(1024, numCtx - C.tokensOf(Array.isArray(tools) && tools.length ? [...messages, { content: JSON.stringify(tools) }] : messages))
      : 0;
    const limit = Number.isFinite(numPredict) && numPredict > 0 ? numPredict : room;
    if (limit) options.num_predict = limit;
    if (Number.isFinite(temperature)) options.temperature = temperature;
    return {
      model,
      messages,
      stream,
      ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}),
      ...(json ? { format: json === true ? "json" : json } : {}),
      ...(Array.isArray(tools) && tools.length ? { tools } : {}),
      ...(typeof think === "boolean" ? { think } : {}),
      options,
    };
  }

  /**
   * Thinking a model writes into its words, between <think> tags at the very
   * start, taken out as it streams. Only a reply that opens on the tag counts,
   * so an answer that talks about the tag is left alone.
   */
  function thinkTags() {
    let state = "start";   // start | inside | answer
    let held = "";
    return function feed(delta) {
      const out = { answer: "", thinking: "" };
      if (state === "answer") { out.answer = delta; return out; }
      held += delta;
      if (state === "start") {
        const lead = held.replace(/^\s+/, "");
        if (!lead) return out;
        if ("<think>".startsWith(lead)) return out;          // could still be the tag
        if (!lead.startsWith("<think>")) { state = "answer"; out.answer = held; held = ""; return out; }
        state = "inside";
        held = lead.slice("<think>".length);
      }
      const end = held.indexOf("</think>");
      if (end < 0) {
        // Keep back what could be the start of the closing tag.
        let keep = 0;
        for (let k = Math.min(7, held.length); k > 0; k--) if ("</think>".startsWith(held.slice(-k))) { keep = k; break; }
        out.thinking = held.slice(0, held.length - keep);
        held = held.slice(held.length - keep);
        return out;
      }
      out.thinking = held.slice(0, end);
      out.answer = held.slice(end + "</think>".length).replace(/^\s+/, "");
      held = "";
      state = "answer";
      return out;
    };
  }

  /**
   * A streamed reply read to its end. `lines` are Ollama's events in order.
   * Words and thinking are handed on as they come; the result is the whole.
   */
  async function read(lines, { onToken, onThinking } = {}) {
    const split = thinkTags();
    let content = "";
    let thinking = "";
    let last = null;
    const calls = [];
    const think = (text) => {
      if (!text) return;
      thinking += text;
      if (onThinking) onThinking(text, thinking);
    };
    for await (const evt of lines) {
      if (!evt || typeof evt !== "object") continue;
      if (evt.error) throw new Error(`Ollama: ${typeof evt.error === "string" ? evt.error : JSON.stringify(evt.error)}`);
      const m = evt.message || {};
      think(m.thinking);
      if (m.content) {
        const part = split(m.content);
        think(part.thinking);
        if (part.answer) {
          content += part.answer;
          if (onToken) onToken(part.answer, content);
        }
      }
      if (Array.isArray(m.tool_calls)) calls.push(...m.tool_calls);
      if (evt.done) last = evt;
    }
    return { content, thinking, tool_calls: calls, last };
  }

  /**
   * One request to a local model, read as it arrives. `request` is what
   * `body` takes; `lineReader` turns the response body into events.
   */
  async function chat(host, request, { signal, onToken, onThinking, fetchFn = (...a) => fetch(...a), lineReader } = {}) {
    // A model on another local app is reached its own way (js/local-apps.js).
    const apps = typeof window !== "undefined" && window.HCLocalApps;
    if (apps && apps.isLocalApp(request.model)) return apps.chat(request.model, request, { signal, onToken, onThinking });
    const res = await fetchFn(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body({ ...request, stream: true })),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${String(await res.text()).slice(0, 300)}`);
    const lines = (lineReader || window.HCStreamSSE.jsonLines)(res.body);
    return read(lines, { onToken, onThinking });
  }

  const warming = new Map();   // host|model|window -> when it was last asked for

  /**
   * Load a model at the window its next request will use, so that request
   * does not wait for it. Asked at most once a minute for the same window;
   * a model already loaded at it answers at once. It stays loaded as long as
   * any model does, and no longer (see above).
   */
  function warm(host, model, numCtx, { fetchFn = (...a) => fetch(...a), now = Date.now() } = {}) {
    if (!host || !model || /^(?:cloud|local):/.test(String(model))) return Promise.resolve(false);
    const key = `${host}|${model}|${numCtx}`;
    if (warming.has(key) && now - warming.get(key) < 60000) return Promise.resolve(false);
    warming.set(key, now);
    return fetchFn(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body({ model, messages: [], stream: false, numCtx })),
    }).then((r) => !!(r && r.ok), () => false);
  }

  window.HCLocal = { body, thinkTags, read, chat, warm };
})();
