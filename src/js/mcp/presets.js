// ============================================================
// mcp/presets.js — ready-made connections, and how a key is presented
//
// Settings → Connections offers the services people most often connect, by
// name, so that connecting one takes a key and little else. A hosted
// service has a fixed address and is set the way its own documentation says
// it is reached and signs in; none is guessed. A system a company runs
// itself (Odoo, through one of several MCP apps) needs the address its app
// shows, and its key is tried the usual ways.
//
// Where a service offers an address that can only read, that is the one
// used unless the person turns "Reading only" off. The app's own rules sit
// on top either way: tools that change records start off, and each change
// asks first (js/mcp/connections.js).
//
// A system that signs in through the browser needs no preset: with no key
// given, the app signs in through the browser when the system asks for it
// (src-tauri/src/commands/mcp/oauth.rs).
//
// With a key and no sign-in chosen ("Automatic"), the key is tried the
// common ways in turn — as a bearer token, then in the key header most
// systems read — each only to the address the person gave, and the next
// only after the system refused the one before. A hosted service is only
// ever sent its key the one way its documentation names.
//
// Pure. Published as window.HCMcpPresets. Checked by scripts/checks/mcp-presets.mjs.
// ============================================================
(function () {
  "use strict";

  const PRESETS = [
    {
      id: "odoo", name: "Odoo", auth: "auto",
      address: {
        placeholder: "https://your-company.odoo.com/mcp",
        note: "the MCP address shown by the MCP server app in your Odoo. Install one from Odoo Apps first",
      },
      key: { label: "Key", note: "the key that app gives you, for an Odoo user with only the access agents need" },
    },
    {
      id: "github", name: "GitHub", auth: "bearer",
      url: "https://api.githubcopilot.com/mcp/", readOnlyUrl: "https://api.githubcopilot.com/mcp/readonly",
      key: { label: "Personal access token", note: "a fine-grained token from GitHub's developer settings, with access only to the repositories agents need" },
    },
    {
      id: "stripe", name: "Stripe", auth: "bearer",
      url: "https://mcp.stripe.com",
      key: { label: "Agent key", note: "an agent key from your Stripe Dashboard, with only the permissions agents need. From 31 October 2026 Stripe accepts only agent keys here" },
    },
    {
      id: "supabase", name: "Supabase", auth: "bearer",
      url: "https://mcp.supabase.com/mcp", readOnlyUrl: "https://mcp.supabase.com/mcp?read_only=true",
      key: { label: "Personal access token", note: "from your Supabase account settings. Reading only runs every query as a read-only database user" },
    },
    {
      id: "other", name: "Other system", auth: "auto",
      address: { placeholder: "https://erp.example.com/mcp", note: "its MCP address. https, or http for a system on this computer" },
      key: { label: "Key", note: "leave it empty if the system needs none, or has you sign in through your browser. Use an account made for this, with only the access it needs" },
    },
  ];

  const find = (id) => PRESETS.find((p) => p.id === id) || PRESETS[PRESETS.length - 1];

  /** The address a preset connects to: its own, the reading-only one when asked for, or the one the person gave. */
  function addressOf(preset, { address = "", readOnly = true } = {}) {
    if (!preset.url) return String(address || "").trim();
    return readOnly && preset.readOnlyUrl ? preset.readOnlyUrl : preset.url;
  }

  /**
   * The ways to sign in, in the order they are tried: the one chosen, or for
   * "auto" with a key a bearer token and then the key header most systems
   * read, and with no key none and then the browser, when the system asks
   * for a sign-in.
   */
  function attempts(auth, header, hasKey) {
    if (auth === "oauth") return [{ auth: "oauth", header: "" }];
    if (auth === "auto" && !hasKey) return [{ auth: "none", header: "" }, { auth: "oauth", header: "" }];
    if (!hasKey || auth === "none") return [{ auth: "none", header: "" }];
    if (auth === "auto") return [{ auth: "bearer", header: "" }, { auth: "header", header: "X-API-Key" }];
    return [{ auth, header: auth === "header" ? String(header || "").trim() : "" }];
  }

  /** A tool's name as a person reads it: "search_records" and "searchRecords" are "Search records". */
  function toolLabel(name) {
    const words = String(name || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_\-.\s]+/g, " ")
      .trim()
      .toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : "";
  }

  window.HCMcpPresets = { PRESETS, find, addressOf, attempts, toolLabel };
})();
