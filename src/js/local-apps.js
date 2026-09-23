// ============================================================
// local-apps.js — models served by another app on this computer
//
// Ollama is not the only way people run a model on their own machine. Other
// local model apps, and model servers run by hand, answer in the shape most
// cloud providers use, on a port of their own. The app spoke only to Ollama,
// so a model loaded in any of them could not be used at all.
//
// Such a server is found by asking the usual ports on this computer for its
// model list, or at a port the person names. Its models are offered beside
// Ollama's, marked with the port, and a request to one is read the same way a
// reply from Ollama is: the words, the thinking — sent apart or between think
// tags — and the tool calls, each handed on as it arrives, and the whole
// returned in the shape js/local-client.js returns for Ollama. So every mode,
// agent and chat that talks to a local model talks to these too, and none of
// them needs to know which kind it is.
//
// In the desktop app the request goes through the app itself
// (src-tauri/src/commands/provider.rs), which reaches only this computer, on
// the named port, at the two paths a model server answers on. That also means
// a server that does not answer requests from web pages still works.
//
// A model here is written "local:<port>/<model id>".
//
// Pure apart from the request it is given. Published as window.HCLocalApps.
// Checked by scripts/checks/local-apps.mjs.
// ============================================================
(function () {
  "use strict";

  /** Ports local model apps listen on unless told otherwise. */
  const PORTS = [1234, 8080, 1337, 8000, 5001, 4891, 8081];
  const PREFIX = "local:";

  const isLocalApp = (value) => /^local:\d{4,5}\//.test(String(value || ""));

  /** { port, model } for a model value, or null. */
  function parse(value) {
    const m = /^local:(\d{4,5})\/(.+)$/.exec(String(value || ""));
    if (!m) return null;
    const port = Number(m[1]);
    return port >= 1024 && port <= 65535 ? { port, model: m[2] } : null;
  }

  const valueOf = (port, model) => `${PREFIX}${port}/${model}`;
  const labelOf = (port, model) => `${model} · port ${port}`;

  /** A port as the person typed it, or null. */
  function portOf(text) {
    const n = Number(String(text || "").trim().replace(/^.*:/, ""));
    return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null;
  }

  /**
   * How requests reach a server. In the desktop app, through the app itself;
   * elsewhere, straight from the page. `route` is "models" or "chat".
   */
  function transport(port, route, { body, signal } = {}) {
    const HC = typeof window !== "undefined" ? window.HC : null;
    if (HC && HC.isTauri && HC.providerBridge) return HC.providerBridge.request("local", route, { port, body, signal });
    const path = route === "models" ? "v1/models" : "v1/chat/completions";
    return fetch(`http://127.0.0.1:${port}/${path}`, body == null
      ? { signal }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
  }

  /** The models a server lists, as ids. Ollama's own port is not another app. */
  async function modelsAt(port, { send = transport, timeoutMs = 1500 } = {}) {
    if (port === 11434) return [];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await send(port, "models", { signal: ctrl.signal });
      if (!r || !r.ok) return [];
      const data = await r.json();
      const list = Array.isArray(data && data.data) ? data.data : Array.isArray(data && data.models) ? data.models : [];
      return list.map((m) => String((m && (m.id || m.name || m.model)) || "")).filter(Boolean)
        // A model only for turning text into vectors cannot hold a conversation.
        .filter((id) => !/(?:^|[-_/:.])(?:embed|embedding|embeddings|rerank|reranker)(?:$|[-_/:.])/i.test(id));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Every server answering on the usual ports and the ones named, with its models. */
  async function discover(extraPorts = [], opts = {}) {
    const ports = [...new Set([...PORTS, ...extraPorts.map(portOf).filter(Boolean)])];
    const found = await Promise.all(ports.map(async (port) => ({ port, models: await modelsAt(port, opts) })));
    return found.filter((s) => s.models.length);
  }

  /** The conversation in the shape these servers read: pictures as parts, call arguments as text. */
  function toWire(messages) {
    return (messages || []).map((m) => {
      if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id || m.name || "call", content: String(m.content || "") };
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        return {
          role: "assistant",
          content: m.content || "",
          tool_calls: m.tool_calls.map((c, i) => ({
            id: c.id || `call_${i}`,
            type: "function",
            function: { name: c.function && c.function.name, arguments: typeof (c.function && c.function.arguments) === "string" ? c.function.arguments : JSON.stringify((c.function && c.function.arguments) || {}) },
          })),
        };
      }
      if (Array.isArray(m.images) && m.images.length) {
        return {
          role: m.role,
          content: [{ type: "text", text: String(m.content || "") }, ...m.images.map((b64) => ({ type: "image_url", image_url: { url: /^data:/.test(b64) ? b64 : `data:image/png;base64,${b64}` } }))],
        };
      }
      return { role: m.role, content: String(m.content || "") };
    });
  }

  /** The request body: the answer held to a schema when one is asked for. */
  function bodyOf({ model, messages, temperature, json, tools }) {
    const b = { model, messages: toWire(messages), stream: true, stream_options: { include_usage: true } };
    if (Number.isFinite(temperature)) b.temperature = temperature;
    if (Array.isArray(tools) && tools.length) b.tools = tools;
    if (json) b.response_format = { type: "json_schema", json_schema: { name: "answer", strict: true, schema: json === true ? { type: "object" } : json } };
    return b;
  }

  /**
   * One request to a model on another local app, read as it arrives: words
   * and thinking handed on, calls gathered, and the whole returned in the
   * shape js/local-client.js returns — { content, thinking, tool_calls, last }.
   */
  async function chat(value, request, { signal, onToken, onThinking, send = transport } = {}) {
    const where = parse(value);
    if (!where) throw new Error(`${value} is not a model on another local app.`);
    const res = await send(where.port, "chat", { body: JSON.stringify(bodyOf({ ...request, model: where.model })), signal });
    if (!res.ok) throw new Error(`Local model app on port ${where.port}: HTTP ${res.status}: ${String(await res.text()).slice(0, 300)}`);
    const split = window.HCLocal.thinkTags();
    let content = "";
    let thinking = "";
    let usage = null;
    let finish = null;
    const calls = [];
    const think = (t) => { if (t) { thinking += t; if (onThinking) onThinking(t, thinking); } };
    const words = (t) => {
      const part = split(t);
      think(part.thinking);
      if (part.answer) { content += part.answer; if (onToken) onToken(part.answer, content); }
    };
    for await (const line of window.HCStreamSSE.sseLines(res.body)) {
      const evt = window.HCStreamSSE.eventFromLine(line);
      if (!evt) continue;
      if (evt.error) throw new Error(`Local model app on port ${where.port}: ${typeof evt.error === "string" ? evt.error : (evt.error.message || JSON.stringify(evt.error))}`);
      if (evt.usage) usage = evt.usage;
      const choice = evt.choices && evt.choices[0];
      if (!choice) continue;
      const d = choice.delta || choice.message || {};
      think(d.reasoning_content || d.reasoning);
      if (typeof d.content === "string" && d.content) words(d.content);
      for (const tc of d.tool_calls || []) {
        const i = Number.isInteger(tc.index) ? tc.index : calls.length;
        const slot = calls[i] || (calls[i] = { name: "", args: "" });
        if (tc.function && tc.function.name) slot.name = tc.function.name;
        if (tc.function && tc.function.arguments) slot.args += typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    const tool_calls = calls.filter((c) => c && c.name).map((c) => {
      let args = {};
      try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = {}; }
      return { function: { name: c.name, arguments: args } };
    });
    const last = { done: true, done_reason: finish === "length" ? "length" : "stop", prompt_eval_count: usage && usage.prompt_tokens, eval_count: usage && usage.completion_tokens };
    return { content, thinking, tool_calls, last };
  }

  /** What Settings says was found. */
  const foundText = (servers) => (servers.length
    ? `Found: ${servers.map((x) => `${x.models.length} model${x.models.length === 1 ? "" : "s"} on port ${x.port}`).join(", ")}`
    : "None found on the usual ports.");

  /** The model menu's group of these models, or null when there are none. Built as text, never markup. */
  function menuGroup(servers, doc = document) {
    if (!servers.length) return null;
    const group = doc.createElement("optgroup");
    group.label = "Other local apps";
    group.dataset.localApps = "1";
    for (const x of servers) {
      for (const id of x.models) {
        const opt = doc.createElement("option");
        opt.value = valueOf(x.port, id);
        opt.textContent = labelOf(x.port, id);
        group.appendChild(opt);
      }
    }
    return group;
  }

  window.HCLocalApps = { PORTS, isLocalApp, parse, valueOf, labelOf, portOf, transport, modelsAt, discover, toWire, bodyOf, chat, foundText, menuGroup };
})();
