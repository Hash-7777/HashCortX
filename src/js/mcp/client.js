// ============================================================
// mcp/client.js — speaking the Model Context Protocol to a connected system
//
// The app asks a system three things: what it is, which tools it has, and to
// run one. Systems in use speak two generations of the protocol:
//
//   The current one (2026-07-28) keeps no session. Every request carries the
//   protocol version in its _meta, and a system says what it supports when
//   asked server/discover.
//
//   Earlier ones begin with a greeting — initialize, then
//   notifications/initialized — and may hand back a session the requests
//   after it carry. The native side keeps that session (src-tauri/src/commands/mcp.rs).
//
// A system is asked server/discover first. One that does not know it is
// greeted the older way, at the newest version both sides speak. Nothing
// here reaches the network itself: `request(id, body, version)` is the native
// command, which sends to the address saved with the connection and nowhere
// else. Asking a person for more input part-way through a call is not
// supported yet, and says so.
//
// Pure apart from the request it is given. Published as window.HCMcpClient.
// Checked by scripts/checks/mcp-client.mjs.
// ============================================================
(function () {
  "use strict";

  const LATEST = "2026-07-28";
  const OLDER = ["2025-11-25", "2025-06-18", "2025-03-26"];
  const MAX_PAGES = 10;
  const MAX_TOOLS = 200;

  /** An error a person can act on. `kind` is "auth", "unreachable", "protocol" or "tool". */
  function failure(kind, message) {
    return Object.assign(new Error(message), { kind });
  }

  /**
   * A client over `request`, which sends one JSON-RPC body to a connection and
   * resolves { status, mime, body }. `clientInfo` names the app.
   */
  function create({ request, clientInfo = { name: "HashCortx", version: "0" } }) {
    const state = new Map();   // connection id → { version, stateless }
    let next = 1;

    const meta = (version) => ({
      "io.modelcontextprotocol/protocolVersion": version,
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": clientInfo,
    });

    /** One request; the JSON-RPC result, or a failure that says what went wrong. */
    async function rpc(id, method, params, version, { notify = false } = {}) {
      const body = { jsonrpc: "2.0", method };
      if (!notify) body.id = next++;
      if (params !== undefined) body.params = params;
      let reply;
      try {
        reply = await request(id, JSON.stringify(body), version);
      } catch (e) {
        throw failure("unreachable", String((e && e.message) || e));
      }
      const status = Number(reply && reply.status) || 0;
      if (status === 401 || status === 403) throw failure("auth", "the system refused the sign-in. Check its key, or sign in again, in Settings → Connections.");
      if (notify) {
        if (status >= 200 && status < 300) return null;
        throw failure("protocol", `the system answered HTTP ${status}.`);
      }
      let msg = null;
      try { msg = reply && reply.body ? JSON.parse(reply.body) : null; } catch { msg = null; }
      if (msg && msg.error) {
        throw Object.assign(failure("protocol", `the system said: ${String(msg.error.message || "an error").slice(0, 300)}`), { code: msg.error.code, status });
      }
      if (status < 200 || status >= 300) throw Object.assign(failure("protocol", `the system answered HTTP ${status}.`), { status });
      if (!msg || typeof msg !== "object" || !("result" in msg)) throw failure("protocol", "the system's answer was not one the app can read.");
      return msg.result;
    }

    /** How a connection is spoken to; worked out once, then kept. */
    async function connect(id) {
      if (state.has(id)) return state.get(id);
      try {
        const found = await rpc(id, "server/discover", { _meta: meta(LATEST) }, LATEST);
        const offered = Array.isArray(found && found.supportedVersions) ? found.supportedVersions : [LATEST];
        const version = [LATEST, ...OLDER].find((v) => offered.includes(v));
        if (version) {
          const how = { version, stateless: version === LATEST, server: found && found.serverInfo };
          if (!how.stateless) await greet(id, how);
          state.set(id, how);
          return how;
        }
      } catch (e) {
        if (e.kind === "auth" || e.kind === "unreachable") throw e;
        // Anything else: a system from before server/discover. Greeted below.
      }
      const how = { version: OLDER[0], stateless: false };
      await greet(id, how);
      state.set(id, how);
      return how;
    }

    /** The older greeting. The system names the version it will speak; it must be one the app speaks too. */
    async function greet(id, how) {
      const result = await rpc(id, "initialize", { protocolVersion: how.version, capabilities: {}, clientInfo }, how.version);
      const agreed = String((result && result.protocolVersion) || "");
      if (![LATEST, ...OLDER].includes(agreed)) throw failure("protocol", `the system speaks protocol version ${agreed || "(none)"}, which the app does not.`);
      how.version = agreed;
      how.server = result && result.serverInfo;
      await rpc(id, "notifications/initialized", undefined, agreed, { notify: true });
    }

    /** A request on a connection, greeting it again once if its session ended. */
    async function call(id, method, params) {
      let how = await connect(id);
      const send = () => rpc(id, method, how.stateless ? { ...(params || {}), _meta: meta(how.version) } : params, how.version);
      try {
        return await send();
      } catch (e) {
        if (how.stateless || e.status !== 404) throw e;
        state.delete(id);
        how = await connect(id);
        return send();
      }
    }

    /** Every tool the system offers, a page at a time, up to a limit. */
    async function listTools(id) {
      const tools = [];
      let cursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await call(id, "tools/list", cursor ? { cursor } : {});
        for (const t of Array.isArray(result && result.tools) ? result.tools : []) {
          if (t && typeof t.name === "string" && t.name) tools.push(t);
          if (tools.length >= MAX_TOOLS) return tools;
        }
        cursor = result && result.nextCursor;
        if (!cursor) break;
      }
      return tools;
    }

    /** Run one tool. The result as the system gave it. */
    async function callTool(id, name, args) {
      const result = await call(id, "tools/call", { name, arguments: args && typeof args === "object" ? args : {} });
      if (result && result.resultType === "input_required") {
        throw failure("tool", "the system asked for more input part-way through, which the app does not support yet.");
      }
      return result;
    }

    /** Start again with a connection: after its address or sign-in changed, or it was removed. */
    const forget = (id) => state.delete(id);

    return { connect, listTools, callTool, forget };
  }

  window.HCMcpClient = { create, LATEST, OLDER };
})();
