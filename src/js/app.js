
  document.documentElement.dataset.theme = "dark";
  (function prepareLogoFont() {
    var root = document.documentElement;
    var markReady = function () { root.classList.add("logo-font-ready"); };
    if (!document.fonts || !document.fonts.load) {
      markReady();
      return;
    }
    document.fonts.load('1em "Great Vibes"').then(markReady, markReady);
  })();
  window.HashCortxRuntime = {
    getHost: function () {
      var raw = "";
      var inp = document.getElementById("host");
      if (inp && inp.value) raw = String(inp.value);
      if (!raw) {
        try {
          var saved = JSON.parse(localStorage.getItem("atelier") || "{}");
          if (saved && saved.host) raw = String(saved.host);
        } catch {}
      }
      raw = raw.trim().replace(/\/$/, "");
      if (!raw) raw = "http://localhost:11434";
      if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
      return /^https?:\/\//i.test(raw) ? raw : "http://localhost:11434";
    },
    makeSignal: function (ms) {
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
      var ctrl = new AbortController();
      setTimeout(function () { ctrl.abort(); }, ms);
      return ctrl.signal;
    },
    fmtGB: function (bytes) {
      if (!bytes) return "0 GB";
      var gb = bytes / 1073741824;
      return gb.toFixed(gb < 10 ? 1 : 0) + " GB";
    },
    readOllamaStatus: async function (host, timeoutMs) {
      host = host || this.getHost();
      var t0 = performance.now();
      var tagsRes = await fetch(host + "/api/tags", { cache: "no-store", signal: this.makeSignal(timeoutMs || 3000) });
      var pingMs = Math.round(performance.now() - t0);
      if (!tagsRes.ok) throw new Error("HTTP " + tagsRes.status);
      var tags = await tagsRes.json().catch(function () { return {}; });
      var models = Array.isArray(tags.models) ? tags.models : [];
      var loaded = [];
      try {
        var psRes = await fetch(host + "/api/ps", { cache: "no-store", signal: this.makeSignal(timeoutMs || 3000) });
        if (psRes.ok) {
          var ps = await psRes.json();
          loaded = Array.isArray(ps.models) ? ps.models : Array.isArray(ps.processes) ? ps.processes : Array.isArray(ps) ? ps : [];
        }
      } catch {}
      var totalLoadedBytes = loaded.reduce(function (sum, m) { return sum + (Number(m.size) || 0); }, 0);
      return { host: host, pingMs: pingMs, models: models, modelCount: models.length, loaded: loaded, totalLoadedBytes: totalLoadedBytes };
    }
  };



(async () => {
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const toggleSide = $("toggleSide");
  const hostEl = $("host");
  const backendSyncTokenEl = $("backendSyncToken");
  const backendSecretsStatusEl = $("backendSecretsStatus");
  const modelEl = $("model");
  const systemEl = $("system");
  const tempEl = $("temp");
  const tempVal = $("tempVal");
  const msgs = $("messages");
  const input = $("input");
  const sendBtn = $("send");
  const contextWindowEl = $("contextWindow");
  const contextTextEl = $("contextText");
  const contextFillEl = $("contextFill");
  const pending = $("pending");
  const imgInput = $("imgFile");
  const txtInput = $("txtFile");
  const statusDot = $("statusDot");
  const statusText = $("statusText");
  const activeTitle = $("activeTitle");
  const activeSub = $("activeSub");
  const cloudBadgeEl    = $("cloudBadge");
  const ragBlockedBadgeEl = $("ragBlockedBadge");
  // Helper: update model subtitle + cloud/RAG badges together
  // Provider SVG icons — 14×14, minimal, no fills unless noted.
  const PROVIDER_ICONS = {
    groq:        `<svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true"><path d="M7 1.5L8.8 5.5H13L9.5 8.2 10.8 12.5 7 10 3.2 12.5 4.5 8.2 1 5.5H5.2L7 1.5Z" stroke="#F59E0B" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    gemini:      `<svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true"><polygon points="7,1.5 12.5,7 7,12.5 1.5,7" stroke="#4285F4" stroke-width="1.3" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.5" fill="#4285F4"/></svg>`,
    openrouter:  `<svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="1.5" fill="#8B5CF6"/><circle cx="2" cy="3.5" r="1" fill="#8B5CF6"/><circle cx="12" cy="3.5" r="1" fill="#8B5CF6"/><circle cx="2" cy="10.5" r="1" fill="#8B5CF6"/><circle cx="12" cy="10.5" r="1" fill="#8B5CF6"/><line x1="7" y1="7" x2="2" y2="3.5" stroke="#8B5CF6" stroke-width="1"/><line x1="7" y1="7" x2="12" y2="3.5" stroke="#8B5CF6" stroke-width="1"/><line x1="7" y1="7" x2="2" y2="10.5" stroke="#8B5CF6" stroke-width="1"/><line x1="7" y1="7" x2="12" y2="10.5" stroke="#8B5CF6" stroke-width="1"/></svg>`,
    cerebras:    `<svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" stroke="#06B6D4" stroke-width="1.3"/><rect x="4.5" y="4.5" width="5" height="5" rx="1" stroke="#06B6D4" stroke-width="1"/><line x1="4.5" y1="2" x2="4.5" y2="0.5" stroke="#06B6D4" stroke-width="1" stroke-linecap="round"/><line x1="9.5" y1="2" x2="9.5" y2="0.5" stroke="#06B6D4" stroke-width="1" stroke-linecap="round"/><line x1="4.5" y1="12" x2="4.5" y2="13.5" stroke="#06B6D4" stroke-width="1" stroke-linecap="round"/><line x1="9.5" y1="12" x2="9.5" y2="13.5" stroke="#06B6D4" stroke-width="1" stroke-linecap="round"/></svg>`,
    samba:       `<svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true"><path d="M1.5 10Q4 3.5 7 7Q10 10.5 12.5 4" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/><path d="M1.5 6.5Q4 0 7 3.5Q10 7 12.5 0.5" stroke="#EF4444" stroke-width="1" stroke-linecap="round" opacity="0.45"/></svg>`,
  };

  function setActiveSub(val) {
    const label = cloudModelLabel(val) || "—";
    const isCloud = !!(val && val.startsWith("cloud:"));
    if (isCloud) {
      const { provider } = parseCloudModel(val);
      const icon = PROVIDER_ICONS[provider] || "";
      // Strip " · ProviderName" suffix — the chip conveys that
      const shortName = label.replace(/\s*·\s*[^·]+$/, "") || label;
      activeSub.innerHTML = icon
        ? `<span class="provider-icon-chip provider-chip-${provider}">${icon}</span>${escapeHtml(shortName)}`
        : escapeHtml(label);
    } else {
      activeSub.textContent = label;
    }
    if (cloudBadgeEl)      cloudBadgeEl.style.display      = isCloud ? "inline-flex" : "none";
    // RAG OFF badge: shown whenever a cloud/external model is active —
    // reminds the user that their personal knowledge base is protected.
    if (ragBlockedBadgeEl) ragBlockedBadgeEl.style.display = isCloud ? "inline-flex" : "none";
  }
  const errorSlot = $("errorSlot");
  const chatsListEl  = $("chatsList");
  const agentsListEl = $("agentsList");
  const searchInput  = $("searchInput");
  const searchWrap   = $("searchWrap");
  const memoryRowEl  = $("memoryRow");
  const settingsOverlay = $("settingsOverlay");
  const agentOverlay = $("agentOverlay");
  const tavilyKeyEl = $("tavilyKey");
  const nvidiaKeyEl = $("nvidiaKey");
  const nvidiaModelEl = $("nvidiaModel");   // removed from Settings UI — element will be null; references below are null-safe
  const groqKeyEl = $("groqKey");
  const geminiKeyEl = $("geminiKey");
  const openRouterKeyEl = $("openRouterKey");
  const cerebrasKeyEl   = $("cerebrasKey");
  const sambaKeyEl      = $("sambaKey");
  const openaiKeyEl     = $("openaiKey");
  const anthropicKeyEl  = $("anthropicKey");
  const moonshotKeyEl   = $("moonshotKey");
  const deepseekKeyEl   = $("deepseekKey");
  const mistralKeyEl    = $("mistralKey");
  const autoRouterEl = $("autoRouter");   // removed from Settings UI — element will be null; auto-router is permanently disabled
  const privacyLocalEl     = $("privacyLocal");
  const privacyLocalSideEl = $("privacyLocalSide");
  const sideModelWrap = $("sideModelWrap");
  const trackedLocalModels = new Set();
  // RAG enabled state — boolean, synced to localStorage. DOM elements rendered per-tab.
  let ragEnabled = false;
  // injectionEnabled: false = pure messages only; true = RAG + web tools fire.
  // Persisted in localStorage so preference survives refresh.
  let injectionEnabled = false;

  const compareBar = $("compareBar");
  const compareModelEl = $("compareModel");
  const compareClose = $("compareClose");
  const slashPalette = $("slashPalette");
  const templateOverlay = $("templateOverlay");
  const templateListEl = $("templateList");
  const templateNameEl = $("templateName");
  const templateBodyEl = $("templateBody");
  const googleKeyEl = $("googleKey");
  const googleCxEl = $("googleCx");
  const rewriterEl = $("rewriterModel");   // removed from Settings UI — element will be null; rewriter is permanently disabled
  const activeAgentChip = $("activeAgentChip");
  const listLabel = $("listLabel");
  const projectSelect = $("projectSelect");
  const projectNewBtn = $("projectNewBtn");
  const projectNameInput = $("projectNameInput");
  const projectInstructionsInput = $("projectInstructionsInput");
  const projectMemoryMode = $("projectMemoryMode");
  const projectSaveBtn = $("projectSaveBtn");
  const tpsBtn = $("tpsBtn");
  const tpsVal = $("tpsVal");
  const exportBtn = $("exportBtn");
  const exportMenu = $("exportMenu");
  const terminalAlertOverlay = $("terminalAlertOverlay");
  const terminalAlertTitle = $("terminalAlertTitle");
  const terminalAlertBody = $("terminalAlertBody");
  const terminalAlertOk = $("terminalAlertOk");
  const terminalAlertCancel = $("terminalAlertCancel");

  function setSidebarCollapsed(collapsed) {
    if (!app) return;
    app.classList.toggle("collapsed", collapsed);
    if (toggleSide) {
      toggleSide.setAttribute("aria-expanded", String(!collapsed));
      toggleSide.setAttribute("aria-pressed", String(collapsed));
      toggleSide.title = collapsed ? "Show sidebar" : "Hide sidebar";
    }
    try { localStorage.setItem("hashcortx_sidebar_collapsed", collapsed ? "1" : "0"); } catch {}
  }

  try {
    setSidebarCollapsed(localStorage.getItem("hashcortx_sidebar_collapsed") === "1");
  } catch {
    setSidebarCollapsed(false);
  }

  toggleSide?.addEventListener("click", (e) => {
    e.preventDefault();
    setSidebarCollapsed(!app?.classList.contains("collapsed"));
  });

  function terminalDialog(message, { title = "System Alert", confirm = false, okText = "OK", cancelText = "Cancel" } = {}) {
    if (!terminalAlertOverlay) {
      if (confirm) return Promise.resolve(window.confirm(message));
      window.alert(message);
      return Promise.resolve(true);
    }
    terminalAlertTitle.textContent = title;
    terminalAlertBody.textContent = message;
    terminalAlertOk.textContent = okText;
    terminalAlertCancel.textContent = cancelText;
    terminalAlertCancel.style.display = confirm ? "" : "none";
    terminalAlertOverlay.classList.add("open");
    terminalAlertOverlay.setAttribute("aria-hidden", "false");
    return new Promise(resolve => {
      const cleanup = (value) => {
        terminalAlertOverlay.classList.remove("open");
        terminalAlertOverlay.setAttribute("aria-hidden", "true");
        terminalAlertOk.removeEventListener("click", ok);
        terminalAlertCancel.removeEventListener("click", cancel);
        terminalAlertOverlay.removeEventListener("click", backdrop);
        window.removeEventListener("keydown", key);
        resolve(value);
      };
      const ok = () => cleanup(true);
      const cancel = () => cleanup(false);
      const backdrop = (e) => { if (e.target === terminalAlertOverlay) cleanup(false); };
      const key = (e) => {
        if (e.key === "Escape") { e.preventDefault(); cleanup(false); }
        if (e.key === "Enter") { e.preventDefault(); cleanup(true); }
      };
      terminalAlertOk.addEventListener("click", ok);
      terminalAlertCancel.addEventListener("click", cancel);
      terminalAlertOverlay.addEventListener("click", backdrop);
      window.addEventListener("keydown", key);
      setTimeout(() => terminalAlertOk.focus(), 0);
    });
  }
  const themedAlert = (message, title = "System Alert") => terminalDialog(message, { title, confirm: false, okText: "OK" });
  const themedConfirm = (message, title = "Confirm") => terminalDialog(message, { title, confirm: true, okText: "OK", cancelText: "Cancel" });
  function themedPrompt(message, defaultValue = "", title = "Input") {
    if (!terminalAlertOverlay) return Promise.resolve(window.prompt(message, defaultValue));
    terminalAlertTitle.textContent = title;
    terminalAlertBody.textContent = "";
    const label = document.createElement("div");
    label.textContent = message;
    const inputEl = document.createElement("input");
    inputEl.className = "terminal-alert-input";
    inputEl.type = "text";
    inputEl.value = defaultValue ?? "";
    terminalAlertBody.append(label, inputEl);
    terminalAlertOk.textContent = "OK";
    terminalAlertCancel.textContent = "Cancel";
    terminalAlertCancel.style.display = "";
    terminalAlertOverlay.classList.add("open");
    terminalAlertOverlay.setAttribute("aria-hidden", "false");
    return new Promise(resolve => {
      const cleanup = (value) => {
        terminalAlertOverlay.classList.remove("open");
        terminalAlertOverlay.setAttribute("aria-hidden", "true");
        terminalAlertOk.removeEventListener("click", ok);
        terminalAlertCancel.removeEventListener("click", cancel);
        terminalAlertOverlay.removeEventListener("click", backdrop);
        window.removeEventListener("keydown", key);
        resolve(value);
      };
      const ok = () => cleanup(inputEl.value);
      const cancel = () => cleanup(null);
      const backdrop = (e) => { if (e.target === terminalAlertOverlay) cleanup(null); };
      const key = (e) => {
        if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
        if (e.key === "Enter") { e.preventDefault(); cleanup(inputEl.value); }
      };
      terminalAlertOk.addEventListener("click", ok);
      terminalAlertCancel.addEventListener("click", cancel);
      terminalAlertOverlay.addEventListener("click", backdrop);
      window.addEventListener("keydown", key);
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 0);
    });
  }

  // ========= State =========
  const state = {
    projects: [],
    currentProjectId: "project_personal",
    agentRuns: [],
    activeRunId: null,
    chats: [],          // [{ id, title, messages, updatedAt, model, agentId }]
    currentChatId: null,
    messages: [],       // active conversation
    codeChats: [],      // separate history for code mode
    codeCurrentChatId: null,
    forgeChats: [],     // separate history for 3D Forge mode
    forgeCurrentChatId: null,
    _normalMessages: [],        // stashed normal messages while in code mode
    _normalCurrentChatId: null, // stashed normal chat id while in code mode
    _codeMessages: [],
    _codeCurrentChatId: null,
    _forgeMessages: [],
    _forgeCurrentChatId: null,
    pendingImages: [],
    pendingFiles: [],
    streaming: false,
    abort: null,
    tab: "chats",       // "chats" | "agents" | "code" | "split"
    agents: [],         // custom agents
    activeAgentId: null,
    replyTo: null,      // { idx, role, preview } — set when user clicks Reply on a message
    editing: null,      // { idx, original } — editing an earlier user turn creates a branch
    compareMode: false,
    slashOpen: false,
    slashIndex: 0,
    templates: [],
    activeTemplateId: null,
  };

  // Ready-made agents
  const BUILTIN_AGENTS = [
    {
      id: "builtin_hash_ai",
      builtin: true,
      icon: "H",
      name: "HashCortx",
      description: "Personal assistant with real persistent memory + tools",
      systemPrompt: `You are the user's personal AI agent. You operate like a senior engineer: thoughtful, direct, calibrated.

Voice:
- Open with the answer. No "Sure!", "Of course", "Great question", "I'd be happy to", "I will now". No restating the question.
- Match the user's register and length. "hi" → one word back. A casual question gets a casual one-liner. A real question gets as much as it needs and no more.
- Markdown only when it materially aids comprehension (lists, code, tables). Otherwise plain prose.
- Honest about uncertainty. Prefer "I don't know" or a calibrated guess over invention. Never fabricate sources, filenames, or numbers.

Source honesty (CRITICAL):
- If asked "where did you get this / what's your source / how do you know", you may ONLY cite: (a) a tool you actually called in this conversation (web_search, fetch_url, pubmed, wikipedia — quote the URL/title from the real tool result), or (b) "my training data" if you answered without a tool.
- NEVER invent a source. NEVER name a song, book, paper, video, or URL you didn't actually retrieve via a tool. If you don't recall where a fact came from, say "I don't recall a specific source — it's likely from training data; I can web_search to verify."
- Do not pattern-match the user's wording to invent citations. "Where did you get this" is a question, not a clue.

Tools (call them — don't describe or narrate them):
- remember_fact / recall_facts — silent long-term memory. Save preferences/projects/names as you notice them, with stable keys. Recall before saying "unknown" on anything personal.
- execute_python — Pyodide sandbox with python-docx, openpyxl, reportlab, pandas, numpy, matplotlib. Globals persist across calls in a chat. Save deliverables to /output/<descriptive>.<ext> — they auto-download.
- web_search / fetch_url — fresh facts and pasted links.
- current_datetime / calculate — time and arithmetic.

Tool-use judgment:
- One well-formed call beats three speculative ones. Skip tools when you already know the answer.
- Issue parallel calls only when the calls are truly independent.
- After a tool returns, write a 1-2 sentence answer using the real values. Don't paste the code back, don't re-narrate the steps.

Conventions:
- Memory injected into context is INTERNAL — never recite or list it unless the user explicitly asks "what do you remember / know about me".
- Treat love/like/favorite/prefer/enjoy as equivalent for recall.
- "Now as PDF / Word / Excel" = re-export the prior data in the requested format, reusing globals when possible. Never produce a placeholder doc.
- When the user asks for an app, UI, website, game, demo, artifact, preview, interactive file, or working HTML: output one complete runnable HTML document in a single \`\`\`html fence. Include all CSS and JS inline. No placeholders.
- When the user asks for a real Word/Excel/PDF file: use execute_python and write the actual file to /output/. Mention the generated filename only after the tool succeeds.`,
      tools: ["memory", "web_search", "fetch_url", "datetime", "calculate", "code_interpreter"]
    },
    {
      id: "builtin_lite",
      builtin: true,
      lite: true, // Lite mode: skip tool-calling loop, use compact memory injection, force fallback path
      icon: "·",
      name: "HashCortx Lite",
      description: "Tuned for tiny models (1.5B–3B). Short prompt, no tool-calling, memory still works.",
      // Deliberately tiny — small models drift on long prompts.
      systemPrompt: `You are the user's assistant. Be short, direct, accurate.
Rules: open with the answer, no filler. Plain prose. Say "I don't know" instead of guessing. Never invent sources, songs, URLs, or numbers. Match the user's tone — short questions get short replies.
The "Memory:" lines (if any) are background context — never list them back unless asked.`,
      tools: ["memory", "datetime", "calculate"]
    },
    {
      id: "builtin_researcher",
      builtin: true,
      icon: "RS",
      name: "Researcher",
      description: "Multi-step research — searches, reads pages, follows up",
      systemPrompt: `You are a research agent. You have real tools — use them iteratively, not just once:

1. Start with web_search or wikipedia for an overview.
2. If a result looks promising but the snippet is thin, call fetch_url on its link to read the full page.
3. If your first search comes back weak, refine the query and search again — don't give up after one shot.
4. Use current_datetime when recency matters (news, prices, events, "latest", "today").
5. Cite each source by title and URL in your final answer.
6. remember_fact / recall_facts — save and retrieve user preferences, projects, and context across sessions.

Only call tools that actually help. Don't search if the answer is general knowledge. If you're confident, skip the tools and answer directly. Never invent facts or citations.`,
      tools: ["memory", "web_search", "wikipedia", "fetch_url", "datetime", "code_interpreter"]
    },
    {
      id: "builtin_deep_research",
      builtin: true,
      icon: "DR",
      name: "Deep Research",
      description: "Plans, searches, reads, cross-checks, then writes a cited brief",
      systemPrompt: `You are a deep-research agent. Produce source-grounded work, not quick summaries.

Workflow:
1. State a compact research plan.
2. Use current_datetime when recency matters.
3. Run web_search for the broad landscape.
4. Fetch promising URLs when snippets are not enough.
5. Use wikipedia only for background orientation, not as the main authority.
6. For medical/life-science topics, use pubmed_search and prefer papers with PMID/DOI.
7. Cross-check claims across independent sources.
8. remember_fact / recall_facts — save key findings and user preferences for future sessions.
9. Final answer must include: executive answer, evidence table, caveats, and source list with URLs/PMIDs.

Never invent citations. If sources are weak, say the evidence is weak.`,
      tools: ["memory", "web_search", "wikipedia", "fetch_url", "pubmed", "datetime", "code_interpreter"]
    },
    {
      id: "builtin_coder",
      builtin: true,
      icon: "</>",
      name: "Coder",
      description: "Senior-staff coding help at 2026 pro standards",
      systemPrompt: `You are a senior staff software engineer and product designer. Every answer must meet a professional, ship-ready bar.

=== CODE QUALITY (non-negotiable) ===
- Production-grade, idiomatic code. No pseudo-code, no placeholders, no "TODO: implement later", no "left as exercise".
- Strict TypeScript when the stack supports it. Explicit types on public surfaces. Prefer type narrowing over casts.
- Short focused functions. No dead code. No commented-out blocks.
- Meaningful names. No abbreviations. No single-letter variables outside loop indices.
- Error handling is required: validate inputs, catch network/IO errors, surface user-friendly messages, never swallow errors silently.
- Security defaults: parameterized queries, input sanitization, no secrets in code, env vars via .env with a committed .env.example.
- Performance defaults: lazy-load heavy modules, memoize expensive renders, debounce text input, cache API calls where safe.
- Accessibility defaults: semantic HTML, proper ARIA, keyboard navigation, focus-visible rings, contrast ≥ WCAG AA.
- Follow the ESLint + Prettier conventions that ship with each framework's official starter.

=== 2026 DESIGN LANGUAGE (for any UI you touch) ===
- Minimal but rich. Generous whitespace, confident typography, a restrained accent palette (one hero color + 2 neutrals).
- Typography: modern variable font (Inter, Geist) + serif display face for headings (Fraunces, Cormorant).
- Dark mode is the default; light mode must also work.
- Subtle depth via backdrop-filter, soft inner highlights, 1px hairline borders, gentle shadows. No harsh drop-shadows.
- Rounded-2xl on cards (1rem), fully-round on pill buttons.
- Gradients used sparingly — mesh or 2-stop diagonals only, never rainbow.
- Grain/noise texture at ~3% opacity on large surfaces.

=== ANIMATIONS (required on every interactive UI) ===
- Page transitions: fade + 4–8px slide, 250–350ms, cubic-bezier(0.22, 1, 0.36, 1).
- Hover: scale 1.02 + shadow lift, 150ms ease-out.
- Press: scale 0.97, 100ms.
- List entrance: staggered fade-in, 40ms step delay per item.
- Use Framer Motion on React, react-native-reanimated v3 (worklets) on React Native.
- Prefer transform + opacity (GPU accelerated). Respect \`prefers-reduced-motion\`.

=== RESPONSE FORMAT ===
- If I ask for a project or feature: start with a folder tree, then every file's full contents in fenced code blocks labeled with language and file path (as a first-line comment).
- If I ask for a bug fix: show the full corrected file, not a diff (unless I explicitly ask for a diff).
- If I ask a concept question: answer in 3-8 lines. Expand only if I ask.
- End meaningful answers with exact run commands and a short "verify" checklist.
- Never invent APIs, library methods, or config keys. If unsure, call web_search or fetch_url to verify against real docs.
- Never ship code you haven't mentally executed.

=== TOOLS ===
- remember_fact / recall_facts: save and retrieve user preferences, coding style, project context, and stack choices across sessions.
- web_search: verify API signatures, library versions, error messages.
- fetch_url: read official docs when the user pastes a link.
- calculate: any arithmetic — never do it in your head.
- current_datetime: when discussing versions, EOL dates, or anything time-sensitive.
Skip the tools if the question is straightforward and you're confident.`,
      tools: ["memory", "web_search", "fetch_url", "datetime", "calculate", "code_interpreter"]
    },
    {
      id: "builtin_url_reader",
      builtin: true,
      icon: "URL",
      name: "URL Reader",
      description: "Paste a URL — fetches the page and analyzes it",
      systemPrompt: `You are a page-analysis agent. When the user provides URLs, call fetch_url on each one to read the real content. If the page references another URL that's important, fetch that too. Never make up content you didn't actually read. Summarize or analyze as the user requests.

Tools: remember_fact / recall_facts — save user interests and reading habits for better future recommendations.`,
      tools: ["memory", "fetch_url", "web_search", "code_interpreter"]
    },
    {
      id: "builtin_papers",
      builtin: true,
      icon: "PM",
      name: "Published Papers Researcher",
      description: "Searches PubMed / Europe PMC for medical & scientific papers",
      systemPrompt: `You are a scientific-literature agent. Use pubmed_search to find peer-reviewed papers and preprints in life sciences and medicine. If a paper looks central to the answer, you may call fetch_url on its DOI/PubMed link to read more. Cite every claim as (Author, Year, PMID). Never invent citations or PMIDs. If results are thin, refine the query and search again.

Tools: remember_fact / recall_facts — save the user's research interests and frequently queried topics for better future recommendations.`,
      tools: ["memory", "pubmed", "fetch_url", "datetime", "code_interpreter"]
    },
    {
      id: "builtin_medical_lexi",
      builtin: true,
      icon: "Rx",
      name: "Medical Lexi-Check",
      description: "Scans prescription lists for drug–drug interactions and grades each risk A–X",
      systemPrompt: `You are Medical Lexi-Check, a clinical pharmacology agent specialising in drug–drug interaction analysis. Patient safety is the top priority — never diagnose, never recommend dosage changes; always advise consulting a licensed pharmacist or physician.

MANDATORY RESEARCH RULE — NEVER SKIP THIS:
Before grading any pair, call web_search: "[Drug A] [Drug B] drug interaction drugs.com"
Read results carefully. Search again if results are thin. NEVER grade from memory alone.
If web_search is unavailable, mark every pair "? — verify manually."

Tools: remember_fact / recall_facts — save the user's medication list and health profile for safer future checks.

GRADING SCALE:
  A – No known interaction (RARE — only if source explicitly confirms none)
  B – Minor: monitor, usually no action
  C – Moderate: monitor closely, consider dose/timing adjustment
  D – Major: active intervention required before continuing
  X – Contraindicated: combination must be avoided

BIAS RULE: When uncertain, ALWAYS pick the more serious grade. Never assign A without explicit source confirmation. Thin/conflicting data = C minimum.

WORKFLOW:
1. Parse all drugs from the user's list
2. List all unique pairs
3. For each pair: search → grade
4. Output as cards (see format below)
5. Add a CRITICAL ALERTS summary at the end

OUTPUT FORMAT — use this card layout per pair (NOT a table):

---
**Drug A ↔ Drug B**
Grade: **C** — Moderate
Mechanism: [pharmacokinetic/pharmacodynamic explanation]
Effect: [what can happen clinically]
Action: [what should be done]
Source: [site name or URL]

---

After all cards, output:

**⚠️ CRITICAL ALERTS** (D and X grades only, one line each with bold drug names)

**Sources consulted:** [list]

*This report is for informational purposes only. Verify with a licensed pharmacist or physician and Lexicomp / Drugs.com before making any medication decisions.*`,
      tools: ["memory", "web_search", "fetch_url", "code_interpreter"]
    },
    {
      id: "builtin_ats_auditor",
      builtin: true,
      icon: "CV",
      name: "ATS CV Auditor",
      description: "Forensic resume analysis — keyword gaps, ATS scoring, structural fixes for 2026 hiring",
      systemPrompt: `You are the ATS CV Auditor, a forensic resume analyst calibrated to 2026 applicant-tracking system (ATS) standards and recruiter expectations. You help job seekers maximise resume visibility and pass automated screening filters before human review.

ATS SCORING MODEL (internal, explain to user):
  • Keyword match score  (0–40 pts): hard skills, tools, certifications matching the job description
  • Format compliance    (0–20 pts): clean headings, no tables/graphics, parseable fonts, standard section names
  • Impact metrics       (0–20 pts): quantified achievements (numbers, %, $, time saved)
  • Structure score      (0–10 pts): correct section order, appropriate length (1–2 pages for <10 yrs experience)
  • Soft-signal score    (0–10 pts): action-verb density, no pronouns, no filler phrases
  Total: 100 pts. ATS pass threshold: ≥ 65 pts (typical). Competitive: ≥ 80 pts.

WORKFLOW — when the user pastes a resume (and optionally a job description):

PHASE 1 — PARSE
- Extract: name/contact, summary, experience entries (title, company, dates, bullets), education, skills, certifications.
- Note any sections that are missing or oddly named.

PHASE 2 — ATS SIMULATION
- Score each of the 5 dimensions above.
- List keywords present vs. keywords missing (compare against job description if provided, otherwise use role-standard keywords for the inferred target role).
- Flag ATS-hostile formatting: columns, tables, headers/footers, graphics, non-standard fonts, icons.

PHASE 3 — STRUCTURAL FORENSICS
- Check section order: Summary → Experience → Education → Skills → Certifications (adjust for role).
- Flag: job-hopping patterns, unexplained employment gaps > 6 months, inconsistent date formats, orphaned bullets.
- Check length and density.

PHASE 4 — IMPACT AUDIT
- For every bullet point, mark it as: ✅ Quantified | ⚠️ Vague | ❌ Responsibility-only.
- Rewrite up to 5 of the weakest bullets as examples (use placeholders like [X%] if real numbers unknown).

PHASE 5 — 2026 STANDARDS CHECK
- Remote/hybrid adaptability signals.
- AI-tool fluency (LLMs, Copilot, automation).
- DEI-neutral language (no age signals, no gendered language).
- LinkedIn URL present and consistent.

PHASE 6 — PRIORITY ACTION LIST
Produce a ranked list: Critical (must fix before applying) → Important → Nice-to-have.

FORMATTING:
- Use clear markdown headers for each phase.
- Score breakdown as a table.
- Use emoji: ✅ good, ⚠️ needs improvement, ❌ critical issue.
- End with an overall ATS Score /100 and a one-paragraph executive summary of the resume's competitive position.

If no resume is pasted yet, ask the user to paste it (plain text is best for ATS analysis) and optionally a job description for targeted analysis.

Tools: remember_fact / recall_facts — save the user's target roles, industries, and career preferences for more tailored future advice.`,
      tools: ["memory", "web_search", "code_interpreter"]
    }
  ];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Returns the current Ollama host, always stripped of trailing slash.
  // Validates it starts with http(s):// so a corrupted localStorage value
  // can never produce a javascript:, file://, or data: fetch URL.
  function safeHost() {
    return window.HashCortxRuntime.getHost();
  }

  // ========= Projects / workspace foundation =========
  // This is intentionally light-touch: existing chats stay visible under the
  // default Personal project, while new chats are tagged with the active
  // project. Memory can stay global or become project-only from Workbench.
  const PROJECTS_KEY = "hashui_projects_v1";
  const DEFAULT_PROJECT_ID = "project_personal";
  const DEFAULT_PROJECT = {
    id: DEFAULT_PROJECT_ID,
    name: "Personal",
    instructions: "",
    memoryMode: "default",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  function normalizeProject(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id || "").trim();
    const name = String(raw.name || "").trim();
    if (!id || !name) return null;
    return {
      id,
      name: name.slice(0, 80),
      instructions: String(raw.instructions || "").slice(0, 4000),
      memoryMode: raw.memoryMode === "project" ? "project" : "default",
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function loadProjects() {
    let projects = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
      if (Array.isArray(parsed)) projects = parsed.map(normalizeProject).filter(Boolean);
    } catch {}
    if (!projects.some(p => p.id === DEFAULT_PROJECT_ID)) projects.unshift({ ...DEFAULT_PROJECT });
    state.projects = projects;
    const savedId = SAVED.currentProjectId || DEFAULT_PROJECT_ID;
    state.currentProjectId = projects.some(p => p.id === savedId) ? savedId : DEFAULT_PROJECT_ID;
    saveProjects();
  }

  function saveProjects() {
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(state.projects)); } catch {}
  }

  function currentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || state.projects[0] || DEFAULT_PROJECT;
  }

  function chatProjectId(chat) {
    return chat?.projectId || DEFAULT_PROJECT_ID;
  }

  function chatBelongsToCurrentProject(chat) {
    return chatProjectId(chat) === state.currentProjectId;
  }

  function renderProjectSelect() {
    if (!projectSelect) return;
    projectSelect.innerHTML = state.projects.map(p =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
    ).join("");
    projectSelect.value = state.currentProjectId;
    projectSelect.title = `Project: ${currentProject().name}`;
  }

  function switchProject(id) {
    if (!id || id === state.currentProjectId || !state.projects.some(p => p.id === id)) return;
    persistCurrentChat();
    state.currentProjectId = id;
    state.messages = [];
    state.currentChatId = null;
    state.pendingImages = [];
    state.pendingFiles = [];
    state.replyTo = null;
    state.editing = null;
    input.value = "";
    input.style.height = "auto";
    renderPending();
    setActiveTitle("New Conversation");
    setActiveSub(modelEl.value);
    saveSettings();
    renderProjectSelect();
    renderChatList();
    render();
  }

  async function createProject() {
    const name = await themedPrompt("Project name:", "", "New Project");
    if (!name || !name.trim()) return;
    const record = {
      ...DEFAULT_PROJECT,
      id: "project_" + uid(),
      name: name.trim().slice(0, 80),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.projects.unshift(record);
    saveProjects();
    renderProjectSelect();
    switchProject(record.id);
  }

  async function renameProject() {
    const proj = currentProject();
    const name = await themedPrompt("Rename project:", proj.name, "Rename Project");
    if (!name || !name.trim() || name.trim() === proj.name) return;
    proj.name = name.trim().slice(0, 80);
    proj.updatedAt = Date.now();
    saveProjects();
    renderProjectSelect();
  }

  async function deleteProject() {
    const proj = currentProject();
    if (proj.id === DEFAULT_PROJECT_ID) {
      await themedAlert("The Personal project cannot be deleted.", "Delete Project");
      return;
    }
    const ok = await themedConfirm(`Delete "${proj.name}"? Its chats will move to Personal.`, "Delete Project");
    if (!ok) return;
    state.chats.forEach(c => { if ((c.projectId || DEFAULT_PROJECT_ID) === proj.id) c.projectId = DEFAULT_PROJECT_ID; });
    saveChats();
    state.projects = state.projects.filter(p => p.id !== proj.id);
    saveProjects();
    state.currentProjectId = DEFAULT_PROJECT_ID;
    renderProjectSelect();
    switchProject(DEFAULT_PROJECT_ID);
  }

  function projectScopedItems(items) {
    return (items || []).filter(it => (it.projectId || DEFAULT_PROJECT_ID) === state.currentProjectId);
  }

  const AGENT_RUNS_KEY = "hashui_agent_runs_v1";

  function loadAgentRuns() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AGENT_RUNS_KEY) || "[]");
      state.agentRuns = Array.isArray(parsed) ? parsed.filter(r => r && typeof r === "object") : [];
    } catch { state.agentRuns = []; }
  }

  function saveAgentRuns() {
    try { localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify(state.agentRuns.slice(0, 250))); } catch {}
  }

  function beginAgentRun(agent, userText) {
    return {
      id: "run_" + uid(),
      projectId: state.currentProjectId,
      chatId: state.currentChatId || null,
      agentId: agent?.id || null,
      agentName: agent?.name || "Agent",
      model: modelEl.value,
      userText: String(userText || "").slice(0, 500),
      events: [],
      startedAt: Date.now(),
      completedAt: null
    };
  }

  function recordAgentEvent(assistant, type, label, data = null) {
    if (!assistant) return;
    if (!assistant.runEvents) assistant.runEvents = [];
    assistant.runEvents.push({ ts: Date.now(), type, label: String(label || ""), data });
  }

  function finishAgentRun(assistant) {
    if (!assistant?.runTrace) return;
    const run = assistant.runTrace;
    run.events = assistant.runEvents || [];
    run.completedAt = Date.now();
    run.durationMs = run.completedAt - run.startedAt;
    run.finalChars = (assistant.content || "").length;
    state.agentRuns.unshift(run);
    state.activeRunId = run.id;
    saveAgentRuns();
  }

  // ========= Persistence =========
  function readSavedSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem("atelier") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      console.warn("[settings] ignoring invalid atelier settings:", err);
      return {};
    }
  }

  const SAVED = readSavedSettings();
  if (SAVED.host) hostEl.value = SAVED.host;
  if (SAVED.system) systemEl.value = SAVED.system;
  if (SAVED.temp) { tempEl.value = SAVED.temp; tempVal.textContent = SAVED.temp; }
  if (SAVED.nvidiaModel && nvidiaModelEl) nvidiaModelEl.value = SAVED.nvidiaModel;
  if (SAVED.backendSyncToken && backendSyncTokenEl) backendSyncTokenEl.value = SAVED.backendSyncToken;

  // Phase 6 — Load API keys from OS Keychain (async, non-blocking)
  const HC_KEY_PROVIDERS = [
    'groqKey','geminiKey','openRouterKey','cerebrasKey','sambaKey',
    'openaiKey','anthropicKey','moonshotKey','deepseekKey','mistralKey',
    'googleKey','googleCx','tavilyKey','nvidiaKey',
  ];
  const KEY_EL_MAP = {
    groqKey: groqKeyEl, geminiKey: geminiKeyEl, openRouterKey: openRouterKeyEl,
    cerebrasKey: cerebrasKeyEl, sambaKey: sambaKeyEl,
    openaiKey: openaiKeyEl, anthropicKey: anthropicKeyEl, moonshotKey: moonshotKeyEl,
    deepseekKey: deepseekKeyEl, mistralKey: mistralKeyEl,
    googleKey: googleKeyEl, googleCx: googleCxEl,
    tavilyKey: tavilyKeyEl, nvidiaKey: nvidiaKeyEl,
  };
  if (window.HC && HC.keychain) {
    HC.keychain.loadAll(HC_KEY_PROVIDERS).then(keys => {
      for (const [k, v] of Object.entries(keys)) {
        if (v && KEY_EL_MAP[k]) KEY_EL_MAP[k].value = v;
      }
    }).catch(() => {
      // Fallback: non-keychain values already in localStorage (migration path)
      if (SAVED.googleKey) googleKeyEl.value = SAVED.googleKey;
      if (SAVED.googleCx) googleCxEl.value = SAVED.googleCx;
      if (SAVED.tavilyKey) tavilyKeyEl.value = SAVED.tavilyKey;
      if (SAVED.nvidiaKey) nvidiaKeyEl.value = SAVED.nvidiaKey;
      if (SAVED.groqKey) groqKeyEl.value = SAVED.groqKey;
      if (SAVED.geminiKey) geminiKeyEl.value = SAVED.geminiKey;
      if (SAVED.openRouterKey) openRouterKeyEl.value = SAVED.openRouterKey;
      if (SAVED.cerebrasKey) cerebrasKeyEl.value = SAVED.cerebrasKey;
      if (SAVED.sambaKey) sambaKeyEl.value = SAVED.sambaKey;
      if (SAVED.openaiKey) openaiKeyEl.value = SAVED.openaiKey;
      if (SAVED.anthropicKey) anthropicKeyEl.value = SAVED.anthropicKey;
      if (SAVED.moonshotKey) moonshotKeyEl.value = SAVED.moonshotKey;
      if (SAVED.deepseekKey) deepseekKeyEl.value = SAVED.deepseekKey;
      if (SAVED.mistralKey) mistralKeyEl.value = SAVED.mistralKey;
    });
  } else {
    // Browser mode / keychain not loaded — use localStorage values
    if (SAVED.googleKey) googleKeyEl.value = SAVED.googleKey;
    if (SAVED.googleCx) googleCxEl.value = SAVED.googleCx;
    if (SAVED.tavilyKey) tavilyKeyEl.value = SAVED.tavilyKey;
    if (SAVED.nvidiaKey) nvidiaKeyEl.value = SAVED.nvidiaKey;
    if (SAVED.groqKey) groqKeyEl.value = SAVED.groqKey;
    if (SAVED.geminiKey) geminiKeyEl.value = SAVED.geminiKey;
    if (SAVED.openRouterKey) openRouterKeyEl.value = SAVED.openRouterKey;
    if (SAVED.cerebrasKey) cerebrasKeyEl.value = SAVED.cerebrasKey;
    if (SAVED.sambaKey) sambaKeyEl.value = SAVED.sambaKey;
    if (SAVED.openaiKey) openaiKeyEl.value = SAVED.openaiKey;
    if (SAVED.anthropicKey) anthropicKeyEl.value = SAVED.anthropicKey;
    if (SAVED.moonshotKey) moonshotKeyEl.value = SAVED.moonshotKey;
    if (SAVED.deepseekKey) deepseekKeyEl.value = SAVED.deepseekKey;
    if (SAVED.mistralKey) mistralKeyEl.value = SAVED.mistralKey;
  }
  if (autoRouterEl) autoRouterEl.checked = SAVED.autoRouter === true;
  privacyLocalEl.checked     = SAVED.privacyLocal === true;
  privacyLocalSideEl.checked = SAVED.privacyLocal === true;
  ragEnabled = SAVED.ragEnabled === true; // default OFF; user can toggle in Agents tab
  // rewriter model restored later in loadModels() once tags are known
  state.activeAgentId = SAVED.activeAgentId || null;
  // Clear removed built-in agent IDs so old localStorage doesn't ghost-activate them
  const _removedAgents = ["builtin_general", "builtin_writer", "builtin_translator"];
  if (_removedAgents.includes(state.activeAgentId)) state.activeAgentId = null;
  updateRangeFill();

  function backendAuthHeaders() {
    const t = (backendSyncTokenEl?.value || "").trim();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  let backendSecretsReachable = false;
  let backendAuthRequired = false;
  let backendFetchProxyAvailable = false;

  function applyServerSecretIfPresent(el, v) {
    if (!el || typeof v !== "string" || !v) return;
    el.value = v;
  }

  async function pullBackendSecrets() {
    const line = (s) => { if (backendSecretsStatusEl) backendSecretsStatusEl.textContent = s; };
    backendSecretsReachable = false;
    backendAuthRequired = false;
    backendFetchProxyAvailable = false;
    try {
      const h = await fetch("/api/backend/health", { cache: "no-store" });
      if (!h.ok) throw new Error("health_" + h.status);
      const health = await h.json().catch(() => ({}));
      backendAuthRequired = !!health.authRequired;
      backendFetchProxyAvailable = !!health.fetchUrlProxy;
      const rs = await fetch("/api/backend/secrets", { cache: "no-store", headers: { ...backendAuthHeaders() } });
      if (!rs.ok) {
        if (rs.status === 401) {
          line(
            "Backend is running but requires a sync token — copy the bearer from the server file " +
              (health.dataDir ? `${health.dataDir}/api-bearer.txt` : "data/api-bearer.txt") +
              " (also printed in the terminal when the server first created it) into Settings → Backend sync token. " +
              "For open local dev only, restart the server with HASH_UI_OPEN_API=1."
          );
          return;
        }
        throw new Error("secrets_" + rs.status);
      }
      const sec = await rs.json();
      if (typeof sec !== "object" || !sec) throw new Error("bad_secrets");
      applyServerSecretIfPresent(googleKeyEl, sec.googleKey);
      applyServerSecretIfPresent(googleCxEl, sec.googleCx);
      applyServerSecretIfPresent(tavilyKeyEl, sec.tavilyKey);
      applyServerSecretIfPresent(nvidiaKeyEl, sec.nvidiaKey);
      applyServerSecretIfPresent(groqKeyEl, sec.groqKey);
      applyServerSecretIfPresent(geminiKeyEl, sec.geminiKey);
      applyServerSecretIfPresent(openRouterKeyEl, sec.openRouterKey);
      applyServerSecretIfPresent(cerebrasKeyEl,   sec.cerebrasKey);
      applyServerSecretIfPresent(sambaKeyEl,      sec.sambaKey);
      applyServerSecretIfPresent(openaiKeyEl,     sec.openaiKey);
      applyServerSecretIfPresent(anthropicKeyEl,  sec.anthropicKey);
      applyServerSecretIfPresent(moonshotKeyEl,   sec.moonshotKey);
      applyServerSecretIfPresent(deepseekKeyEl,   sec.deepseekKey);
      applyServerSecretIfPresent(mistralKeyEl,    sec.mistralKey);
      backendSecretsReachable = true;
      line(
        health.hasSecretsFile
          ? "Backend: connected — non-empty API keys from the server were merged into this form (see data/secrets.json on the machine running node server.js)."
          : "Backend: connected — server has no key file yet; saving Settings will create data/secrets.json."
      );
    } catch {
      const port = (typeof location !== "undefined" && location.port) ? location.port : "3000";
      line(
        `Backend: not syncing (open this UI via http://localhost:${port} with node server.js running, or ignore — keys stay in this browser only).`
      );
    }
  }

  async function pushBackendSecretsQuietly() {
    if (!backendSecretsReachable) return;
    try {
      const body = {
        googleKey: googleKeyEl.value || "",
        googleCx: googleCxEl.value || "",
        tavilyKey: tavilyKeyEl.value || "",
        nvidiaKey: nvidiaKeyEl.value || "",
        groqKey: groqKeyEl.value || "",
        geminiKey: geminiKeyEl.value || "",
        openRouterKey: openRouterKeyEl.value || "",
        cerebrasKey:   cerebrasKeyEl.value   || "",
        sambaKey:      sambaKeyEl.value      || "",
        openaiKey:     openaiKeyEl.value     || "",
        anthropicKey:  anthropicKeyEl.value  || "",
        moonshotKey:   moonshotKeyEl.value   || "",
        deepseekKey:   deepseekKeyEl.value   || "",
        mistralKey:    mistralKeyEl.value    || "",
      };
      const r = await fetch("/api/backend/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        console.warn("[backend] POST /api/backend/secrets failed:", r.status);
        if (r.status === 401 && backendSecretsStatusEl) {
          backendSecretsStatusEl.textContent =
            "Backend: save rejected (401) — paste the bearer from data/api-bearer.txt (or HASH_UI_API_TOKEN) into Backend sync token, or use HASH_UI_OPEN_API=1 on the server.";
        }
      }
    } catch (e) {
      console.warn("[backend] POST secrets:", e);
    }
  }

  await pullBackendSecrets();

  const saveSettings = () => {
    try {
      // Non-sensitive settings → localStorage
      localStorage.setItem("atelier", JSON.stringify({
        ...readSavedSettings(),
        host: hostEl.value, system: systemEl.value, temp: tempEl.value, model: modelEl.value,
        nvidiaModel: nvidiaModelEl?.value || "",
        backendSyncToken: backendSyncTokenEl ? backendSyncTokenEl.value : "",
        autoRouter: !!(autoRouterEl?.checked),
        privacyLocal: privacyLocalEl.checked,
        ragEnabled,
        rewriterModel: rewriterEl?.value || "",
        currentProjectId: state.currentProjectId,
        activeAgentId: state.activeAgentId,
        // Remove API keys from localStorage (Phase 6 migration: wipe old values)
        groqKey: "", geminiKey: "", openRouterKey: "", cerebrasKey: "", sambaKey: "",
        openaiKey: "", anthropicKey: "", moonshotKey: "", deepseekKey: "", mistralKey: "",
        googleKey: "", googleCx: "", tavilyKey: "", nvidiaKey: "",
      }));
      // API keys → OS Keychain (async fire-and-forget)
      if (window.HC && HC.keychain) {
        void HC.keychain.store('groqKey',       groqKeyEl.value       || "");
        void HC.keychain.store('geminiKey',     geminiKeyEl.value     || "");
        void HC.keychain.store('openRouterKey', openRouterKeyEl.value || "");
        void HC.keychain.store('cerebrasKey',   cerebrasKeyEl.value   || "");
        void HC.keychain.store('sambaKey',      sambaKeyEl.value      || "");
        void HC.keychain.store('openaiKey',     openaiKeyEl.value     || "");
        void HC.keychain.store('anthropicKey',  anthropicKeyEl.value  || "");
        void HC.keychain.store('moonshotKey',   moonshotKeyEl.value   || "");
        void HC.keychain.store('deepseekKey',   deepseekKeyEl.value   || "");
        void HC.keychain.store('mistralKey',    mistralKeyEl.value    || "");
        void HC.keychain.store('googleKey',     googleKeyEl.value     || "");
        void HC.keychain.store('googleCx',      googleCxEl.value      || "");
        void HC.keychain.store('tavilyKey',     tavilyKeyEl.value     || "");
        void HC.keychain.store('nvidiaKey',     nvidiaKeyEl.value     || "");
      }
      void pushBackendSecretsQuietly();
    } catch (err) {
      console.warn("[settings] save failed:", err);
      showError(err);
    }
  };

  try {
    window.mermaid?.initialize?.({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
  } catch {}

  function loadAgents() {
    try {
      const raw = localStorage.getItem("atelier_agents");
      const arr = raw ? JSON.parse(raw) : [];
      state.agents = Array.isArray(arr) ? arr.filter(a => a && typeof a === "object") : [];
    } catch { state.agents = []; }
  }
  function saveAgents() {
    try { localStorage.setItem("atelier_agents", JSON.stringify(state.agents)); } catch {}
  }
  function allAgents() { return [...BUILTIN_AGENTS, ...state.agents]; }
  function getAgent(id) { return allAgents().find(a => a.id === id) || null; }
  function getActiveAgent() { return getAgent(state.activeAgentId); }

  function loadChats() {
    try {
      const raw = localStorage.getItem("atelier_chats");
      const arr = raw ? JSON.parse(raw) : [];
      state.chats = Array.isArray(arr) ? arr.filter(c => c && typeof c === "object") : [];
    } catch { state.chats = []; }
    try {
      const raw = localStorage.getItem("atelier_code_chats");
      const arr = raw ? JSON.parse(raw) : [];
      state.codeChats = Array.isArray(arr) ? arr.filter(c => c && typeof c === "object") : [];
    } catch { state.codeChats = []; }
    try {
      const raw = localStorage.getItem("atelier_forge_chats");
      const arr = raw ? JSON.parse(raw) : [];
      state.forgeChats = Array.isArray(arr) ? arr.filter(c => c && typeof c === "object") : [];
    } catch { state.forgeChats = []; }
  }
  function saveChats() {
    try { localStorage.setItem("atelier_chats", JSON.stringify(state.chats)); } catch {}
  }
  function saveCodeChats() {
    try { localStorage.setItem("atelier_code_chats", JSON.stringify(state.codeChats)); } catch {}
  }
  function saveForgeChats() {
    try { localStorage.setItem("atelier_forge_chats", JSON.stringify(state.forgeChats)); } catch {}
  }
  function isCodeMode() { return state.tab === "code"; }
  function isForgeMode() { return state.tab === "forge"; }
  function activeChatList() {
    if (isCodeMode()) return state.codeChats;
    if (isForgeMode()) return state.forgeChats;
    return state.chats;
  }
  function saveActiveChatList() {
    if (isCodeMode()) saveCodeChats();
    else if (isForgeMode()) saveForgeChats();
    else saveChats();
  }
  function chatBucketForTab(tab) {
    if (tab === "code") return "code";
    if (tab === "forge") return "forge";
    return "normal";
  }
  function stashConversationBucket(bucket) {
    if (bucket === "code") {
      state._codeMessages = state.messages.slice();
      state._codeCurrentChatId = state.currentChatId;
    } else if (bucket === "forge") {
      state._forgeMessages = state.messages.slice();
      state._forgeCurrentChatId = state.currentChatId;
    } else {
      state._normalMessages = state.messages.slice();
      state._normalCurrentChatId = state.currentChatId;
    }
  }
  function restoreConversationBucket(bucket) {
    if (bucket === "code") {
      state.messages = state._codeMessages || [];
      state.currentChatId = state._codeCurrentChatId || null;
    } else if (bucket === "forge") {
      state.messages = state._forgeMessages || [];
      state.currentChatId = state._forgeCurrentChatId || null;
    } else {
      state.messages = state._normalMessages || [];
      state.currentChatId = state._normalCurrentChatId || null;
    }
    state.pendingImages = [];
    state.pendingFiles = [];
    state.replyTo = null;
    state.editing = null;
    if (typeof replyBanner !== "undefined") replyBanner.classList.remove("visible");
    if (typeof editBanner !== "undefined") editBanner.classList.remove("visible");
    input.value = "";
    input.style.height = "auto";
    renderPending();
    const list = bucket === "code" ? state.codeChats : bucket === "forge" ? state.forgeChats : state.chats;
    const chat = list.find(c => c.id === state.currentChatId);
    setActiveTitle(chat ? chat.title : "New Conversation");
    setActiveSub((chat && chat.model) || modelEl.value);
  }

  function deriveTitle(messages) {
    const first = messages.find(m => m.role === "user" && m.content);
    if (!first) return "New chat";
    const words = first.content.trim().replace(/\s+/g, " ").split(" ");
    return words.length > 3 ? words.slice(0, 3).join(" ") + "…" : words.join(" ");
  }

  function persistCurrentChat() {
    // Save the live conversation into state.chats, creating a record if needed.
    // Skip a totally empty conversation.
    const nonEmpty = state.messages.some(m => (m.content && m.content.trim()) || (m.images && m.images.length) || (m.attachments && m.attachments.length));
    if (!nonEmpty) return;

    const chatList = activeChatList();
    if (!state.currentChatId) state.currentChatId = uid();
    let chat = chatList.find(c => c.id === state.currentChatId);
    // Clean transient fields off a deep copy (e.g. base64 kept separately is fine, keep it for re-send)
    const cleanMessages = state.messages
      .filter(m => !(m.role === "assistant" && m === state.messages[state.messages.length - 1] && state.streaming && !m.content))
      .map(m => ({
        role: m.role,
        content: m.content || "",
        images: m.images ? m.images.slice() : undefined,
        attachments: m.attachments ? m.attachments.map(a => typeof a === "object" ? { ...a } : a) : undefined,
        _imgBase64: m._imgBase64 ? m._imgBase64.slice() : undefined,
        // Persist the duration so the timestamp chip survives page reloads
        // and chat switching (previously stripped → chips disappeared on reload).
        durationMs: m.durationMs || undefined,
        _modelContent: m._modelContent || undefined,
        replyTo: m.replyTo || undefined,
        diffFrom: m.diffFrom || undefined,
        compare: m.compare ? JSON.parse(JSON.stringify(m.compare)) : undefined,
      }));
    if (!chat) {
      chat = { id: state.currentChatId, createdAt: Date.now(), title: deriveTitle(cleanMessages), messages: cleanMessages, updatedAt: Date.now(), model: modelEl.value, agentId: state.activeAgentId, projectId: state.currentProjectId };
      chatList.unshift(chat);
    } else {
      chat.messages = cleanMessages;
      chat.updatedAt = Date.now();
      chat.model = modelEl.value || chat.model;
      chat.agentId = state.activeAgentId;
      chat.projectId = chat.projectId || state.currentProjectId;
      if (!chat.title || chat.title === "New chat") chat.title = deriveTitle(cleanMessages);
      // Move to top
      if (isCodeMode()) state.codeChats = [chat, ...state.codeChats.filter(c => c.id !== chat.id)];
      else if (isForgeMode()) state.forgeChats = [chat, ...state.forgeChats.filter(c => c.id !== chat.id)];
      else              state.chats     = [chat, ...state.chats.filter(c => c.id !== chat.id)];
    }
    saveActiveChatList();
    renderChatList();
  }

  function newChat() {
    if (state.streaming) abort();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    state.messages = [];
    state.currentChatId = null;
    state.pendingImages = []; state.pendingFiles = [];
    state.replyTo = null;
    state.editing = null;
    if (typeof replyBanner !== "undefined") replyBanner.classList.remove("visible");
    if (typeof editBanner !== "undefined") editBanner.classList.remove("visible");
    input.value = ""; input.style.height = "auto";
    renderPending();
    setActiveTitle("New Conversation");
    setActiveSub(modelEl.value);
    render();
    renderChatList();
    if (isNarrow()) app.classList.remove("open");
    input.focus();
  }

  function loadChat(id) {
    if (state.streaming) abort();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const chatList = activeChatList();
    const chat = chatList.find(c => c.id === id);
    if (!chat) return;
    state.currentChatId = id;
    state.messages = (chat.messages || []).map(m => ({ ...m }));
    state.pendingImages = []; state.pendingFiles = [];
    state.replyTo = null;
    state.editing = null;
    if (typeof replyBanner !== "undefined") replyBanner.classList.remove("visible");
    if (typeof editBanner !== "undefined") editBanner.classList.remove("visible");
    input.value = ""; input.style.height = "auto";
    renderPending();
    setActiveTitle(chat.title || "Conversation");
    setActiveSub(chat.model || modelEl.value);
    // Restore the agent this chat was using (if any)
    if (chat.agentId !== undefined) {
      state.activeAgentId = chat.agentId;
      saveSettings();
      renderActiveAgentChip();
    }
    render();
    renderChatList();
    if (isNarrow()) app.classList.remove("open");
  }

  function deleteChat(id) {
    if (isCodeMode()) {
      state.codeChats = state.codeChats.filter(c => c.id !== id);
      saveCodeChats();
    } else if (isForgeMode()) {
      state.forgeChats = state.forgeChats.filter(c => c.id !== id);
      saveForgeChats();
    } else {
      state.chats = state.chats.filter(c => c.id !== id);
      saveChats();
    }
    if (state.currentChatId === id) newChat();
    else renderChatList();
  }

  function renderChatList() {
    const chatList = activeChatList().filter(chatBelongsToCurrentProject);
    const q = (searchInput.value || "").trim().toLowerCase();
    const filtered = q
      ? chatList.filter(c =>
          (c.title || "").toLowerCase().includes(q) ||
          (c.messages || []).some(m => (m.content || "").toLowerCase().includes(q))
        )
      : chatList;

    chatsListEl.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "chats-empty";
      empty.textContent = q ? "No matches." : (isCodeMode()
        ? "No coding sessions in this project yet."
        : isForgeMode()
          ? "No 3D Forge sessions in this project yet."
          : "No chats in this project yet — start a new one.");
      chatsListEl.appendChild(empty);
      return;
    }
    filtered.forEach(chat => {
      const row = document.createElement("div");
      row.className = "chat-item" + (chat.id === state.currentChatId ? " active" : "");
      const modelLabel = chat.model || "—";
      // Date: prefer stored createdAt, fall back to updatedAt, else show nothing
      const ts = chat.createdAt || chat.updatedAt;
      const dateStr = ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      row.innerHTML = `
        <span class="title-col">
          <span class="title-txt" title="${escapeHtml(chat.title || "Untitled")}">${escapeHtml(chat.title || "Untitled")}</span>
          <span class="model-tag">${escapeHtml(modelLabel)}</span>
        </span>
        ${dateStr ? `<span class="chat-date">${escapeHtml(dateStr)}</span>` : ""}
        <span class="ren" data-id="${chat.id}" title="Rename" tabindex="0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
        </span>
        <span class="del" data-id="${chat.id}" title="Delete" tabindex="0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </span>`;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".del") || e.target.closest(".ren")) return;
        loadChat(chat.id);
      });
      row.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });
      // ── Inline rename ──
      row.querySelector(".ren").addEventListener("click", (e) => {
        e.stopPropagation();
        const titleSpan = row.querySelector(".title-txt");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "rename-input";
        input.value = chat.title || "";
        input.maxLength = 80;
        titleSpan.replaceWith(input);
        input.focus(); input.select();
        function commitRename() {
          const newTitle = input.value.trim() || chat.title || "Untitled";
          const chatList = activeChatList();
          const c = chatList.find(x => x.id === chat.id);
          if (c) { c.title = newTitle; saveActiveChatList(); }
          if (state.currentChatId === chat.id) setActiveTitle(newTitle);
          renderChatList();
        }
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); commitRename(); }
          if (ev.key === "Escape") renderChatList();
        });
        input.addEventListener("blur", commitRename);
      });
      chatsListEl.appendChild(row);
    });
  }

  function slugifyTitle(title) {
    return (title || "conversation")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "conversation";
  }

  function currentConversationSnapshot() {
    if (!state.messages.length) return null;
    const chat = activeChatList().find(c => c.id === state.currentChatId);
    return {
      title: chat?.title || deriveTitle(state.messages) || "New chat",
      model: modelEl.value || chat?.model || "",
      exportedAt: new Date().toISOString(),
      agentId: state.activeAgentId || null,
      messages: state.messages
        .filter(m => !(state.streaming && m === state.messages[state.messages.length - 1] && m.role === "assistant" && !m.content))
        .map(m => ({
        role: m.role,
        content: m.content || "",
        replyTo: m.replyTo ? { ...m.replyTo } : undefined,
        attachments: m.attachments ? m.attachments.map(a => typeof a === "object" ? { ...a } : a) : undefined,
        images: m.images ? m.images.slice() : undefined,
        durationMs: m.durationMs || undefined,
      })),
    };
  }

  function messageMarkdown(m) {
    const head = m.role === "assistant" ? "## Assistant" : "## You";
    const body = m.role === "user" ? stripReplyPrelude(m.content || "") : (m.content || "");
    const parts = [head];
    if (m.replyTo) parts.push(`> Replying to ${m.replyTo.role === "assistant" ? "assistant" : "user"}: ${m.replyTo.preview || ""}`);
    parts.push(body || "_(empty)_");
    if (m.attachments?.length) {
      parts.push(`Attachments: ${m.attachments.map(a => typeof a === "string" ? a : a.name).join(", ")}`);
    }
    if (m.images?.length) {
      parts.push(`Images: ${m.images.length}`);
    }
    return parts.join("\n\n");
  }

  function conversationToMarkdown(snapshot) {
    return [
      `# ${snapshot.title}`,
      snapshot.model ? `Model: \`${snapshot.model}\`` : "",
      `Exported: ${snapshot.exportedAt}`,
      "",
      ...snapshot.messages.map(messageMarkdown),
    ].filter(Boolean).join("\n\n");
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportConversation(format) {
    const snapshot = currentConversationSnapshot();
    if (!snapshot) {
      await themedAlert("No conversation to export yet.", "Export");
      return;
    }
    const stem = slugifyTitle(snapshot.title);
    if (format === "markdown") {
      downloadBlob(`${stem}.md`, new Blob([conversationToMarkdown(snapshot)], { type: "text/markdown;charset=utf-8" }));
      return;
    }
    if (format === "json") {
      downloadBlob(`${stem}.json`, new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" }));
      return;
    }
    if (format === "pdf") {
      // Use jsPDF (already loaded) to generate a real PDF — avoids popup blockers
      const { jsPDF } = window.jspdf;
      if (!jsPDF) {
        await themedAlert("PDF library not loaded. Please restart the app.", "PDF Export");
        return;
      }

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 40;
      const maxW = pageW - margin * 2;
      let y = margin;

      // Helper: add text with wrapping
      function addWrapped(text, x, startY, opts = {}) {
        const lines = doc.splitTextToSize(text, maxW);
        const lineH = opts.lineHeight || 14;
        const pageH = doc.internal.pageSize.getHeight();
        lines.forEach((line) => {
          if (startY + lineH > pageH - margin) {
            doc.addPage();
            startY = margin;
          }
          doc.text(line, x, startY, opts);
          startY += lineH;
        });
        return startY;
      }

      // Title
      doc.setFontSize(18);
      doc.setTextColor(26, 18, 8);
      doc.setFont("helvetica", "bold");
      y = addWrapped(snapshot.title || "Conversation", margin, y, { lineHeight: 22 });
      y += 4;

      // Meta
      doc.setFontSize(9);
      doc.setTextColor(102, 102, 102);
      doc.setFont("helvetica", "normal");
      const meta = `Model: ${snapshot.model || "—"}   ·   Exported: ${snapshot.exportedAt || ""}`;
      y = addWrapped(meta, margin, y, { lineHeight: 11 });
      y += 12;

      // Divider line
      doc.setDrawColor(201, 169, 110);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y);
      y += 16;

      // Messages
      for (const m of snapshot.messages) {
        const role = m.role === "assistant" ? "AI" : "You";
        const isAi = m.role === "assistant";

        // Role header
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(isAi ? 122 : 26, isAi ? 78 : 58, isAi ? 16 : 92);
        const dur = m.durationMs ? `  (${formatDuration(m.durationMs)})` : "";
        y = addWrapped(role.toUpperCase() + dur, margin, y, { lineHeight: 11 });
        y += 4;

        // Body
        let body = m.role === "user" ? stripReplyPrelude(m.content || "") : (m.content || "");
        // Strip markdown syntax for cleaner PDF text
        body = body
          .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, "").replace(/```/g, ""))
          .replace(/`([^`]+)`/g, "$1")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/#{1,6}\s+/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/>\s+/g, "")
          .replace(/\n{3,}/g, "\n\n");

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(17, 17, 17);
        y = addWrapped(body, margin, y, { lineHeight: 13 });

        // Attachments note
        if (m.attachments?.length) {
          doc.setFontSize(8);
          doc.setTextColor(119, 119, 119);
          const attText = "📎 " + m.attachments.map(a => typeof a === "string" ? a : a.name).join(", ");
          y = addWrapped(attText, margin, y, { lineHeight: 10 });
        }

        y += 14;

        // Page break guard
        if (y > doc.internal.pageSize.getHeight() - margin - 30) {
          doc.addPage();
          y = margin;
        }
      }

      doc.save(`${stem}.pdf`);
    }
  }

  function toggleExportMenu(force) {
    const open = force === undefined ? !exportMenu.classList.contains("open") : force;
    if (open && exportBtn) {
      // Anchor to viewport so the dropdown escapes every ancestor's overflow:hidden
      // (#mainApp, .app, main, and the .actions backdrop-filter stacking context).
      const rect = exportBtn.getBoundingClientRect();
      exportMenu.style.setProperty("position", "fixed", "important");
      exportMenu.style.setProperty("top", (rect.bottom + 8) + "px", "important");
      exportMenu.style.setProperty("right", (window.innerWidth - rect.right) + "px", "important");
      exportMenu.style.setProperty("left", "auto", "important");
      exportMenu.style.setProperty("z-index", "99999", "important");
    } else {
      // Restore stylesheet-controlled positioning on close
      exportMenu.style.removeProperty("position");
      exportMenu.style.removeProperty("top");
      exportMenu.style.removeProperty("right");
      exportMenu.style.removeProperty("left");
      exportMenu.style.removeProperty("z-index");
    }
    exportMenu.classList.toggle("open", open);
    exportMenu.setAttribute("aria-hidden", open ? "false" : "true");
  }

  exportBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExportMenu();
  });
  exportMenu?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-export]");
    if (!b) return;
    toggleExportMenu(false);
    exportConversation(b.dataset.export);
  });
  document.addEventListener("click", (e) => {
    if (!exportMenu?.classList.contains("open")) return;
    if (e.target.closest(".export-wrap")) return;
    toggleExportMenu(false);
  });

  // ========= Tabs =========
  // "chats"  → normal conversation list
  // "agents" → manage & activate built-in / custom agents
  // "code"   → Claude-Code-style terminal-themed panel with code-focused
  // "forge"  → architecture-first 3D build planning mode
  // "split"  → side-by-side comparison mode for two selected models
  //            prompt chips. Still a normal chat, just a different skin +
  //            chip preset. Tabs don't blow away chat history.
  const BUILTIN_BODY_MODE_CLASSES = ["agent-maker-mode","system-maker-mode","forge-studio-mode","virtual-os-mode","coder-mode","finance-mode"];
  const BUILTIN_APP_MODE_CLASSES  = ["canvas-mode","code-mode","forge-mode","split-mode","sandbox-mode","system-maker-mode","agent-maker-mode"];
  let activeFullscreenMode = null;
  let modeTransitionToken = 0;

  function registeredModes() {
    return window._registeredModes || {};
  }

  function modeButtonId(tab, mode) {
    return mode?.btnId || ("tab" + tab.charAt(0).toUpperCase() + tab.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
  }

  function normalizeModeConfig(tab, config = {}) {
    return {
      label: tab,
      btnId: modeButtonId(tab, config),
      bodyClass: null,
      appClass: null,
      fullscreen: true,
      mount: null,
      destroy: null,
      ...config,
    };
  }

  function setActiveTabButton(tab) {
    document.querySelectorAll(".tabs [data-tab]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    const mode = registeredModes()[tab];
    if (mode?.btnId) $(mode.btnId)?.classList.add("active");
  }

  function clearModeClasses() {
    const appEl = document.getElementById("app");
    const bodyClasses = new Set(BUILTIN_BODY_MODE_CLASSES);
    const appClasses = new Set(BUILTIN_APP_MODE_CLASSES);
    for (const mode of Object.values(registeredModes())) {
      if (mode?.bodyClass) bodyClasses.add(mode.bodyClass);
      if (mode?.appClass) appClasses.add(mode.appClass);
    }
    bodyClasses.forEach(cls => document.body.classList.remove(cls));
    appClasses.forEach(cls => appEl?.classList.remove(cls));
    document.body.classList.remove("hashcortx-fullscreen-active");
  }

  function destroyRegisteredModes(exceptTab = null) {
    for (const [id, mode] of Object.entries(registeredModes())) {
      if (id === exceptTab) continue;
      try { mode?.destroy?.(); } catch (err) { console.warn(`[HashCortx] failed to destroy mode "${id}"`, err); }
    }
    if (activeFullscreenMode !== exceptTab) activeFullscreenMode = null;
  }

  function leaveFullscreenModes() {
    destroyRegisteredModes(null);
    clearModeClasses();
  }

  function resetSharedModeUi(tab) {
    const chatTabs = new Set(["chats", "code", "forge", "split"]);
    const showChatSidebar = chatTabs.has(tab);
    setActiveTabButton(tab);
    chatsListEl.style.display = showChatSidebar ? "" : "none";
    agentsListEl.style.display = "none";
    searchWrap.style.display  = showChatSidebar ? "" : "none";
    memoryRowEl.style.display = showChatSidebar ? "" : "none";
    const agentsHeader = document.getElementById("agentsHeader");
    if (agentsHeader) agentsHeader.style.display = "none";
    if (listLabel) {
      listLabel.style.display = "";
      listLabel.textContent = tab === "code" ? "Coding" : (tab === "forge" ? "3D Forge" : (tab === "split" ? "Split" : "Recent"));
    }
    setCompareMode(tab === "split");
    renderComposerChips(tab === "code" ? "code" : tab === "forge" ? "forge" : "default");
    renderCodeBadge(tab === "code");
    renderForgeBadge(tab === "forge");
  }

  function safeExitMode() {
    setTab("chats");
  }

  function setTab(tab) {
    const registered = registeredModes()[tab];
    if (registered) {
      void activateRegisteredMode(tab, registered);
      return;
    }

    modeTransitionToken++;
    const fromFullscreen = !!activeFullscreenMode;
    leaveFullscreenModes();

    // "agents" is a sidebar panel, not a mode — preserve the underlying mode when entering/leaving it
    if (tab === "agents") {
      if (state.tab !== "agents") state._preAgentsTab = state.tab; // remember where we came from
      state.tab = "agents";
      setActiveTabButton("agents");
      chatsListEl.style.display = "none";
      agentsListEl.style.display = "";
      searchWrap.style.display  = "none";
      memoryRowEl.style.display = "none";
      const ah = document.getElementById("agentsHeader");
      if (ah) ah.style.display = "";
      if (listLabel) listLabel.style.display = "none";
      renderAgentsList();
      return;
    }

    // Leaving agents panel — restore the mode we saved (or fall through to requested tab)
    const effectiveFrom = fromFullscreen ? "chats" : ((state.tab === "agents" && state._preAgentsTab) ? state._preAgentsTab : state.tab);
    const fromBucket = chatBucketForTab(effectiveFrom);
    const toBucket = chatBucketForTab(tab);

    // When crossing normal/code/Forge conversation buckets, save and swap live state.
    if (fromBucket !== toBucket) {
      persistCurrentChat(); // save whatever is active before switching
      stashConversationBucket(fromBucket);
      restoreConversationBucket(toBucket);
      render();
    }

    state.tab = tab;
    const app = document.getElementById("app");
    app.classList.toggle("code-mode", tab === "code");
    app.classList.toggle("forge-mode", tab === "forge");
    app.classList.toggle("split-mode", tab === "split");
    resetSharedModeUi(tab);
    renderChatList();
  }

  // ── Mode registry — lets mode JS files self-register without editing app.js ──
  async function activateRegisteredMode(tab, rawMode) {
    const mode = normalizeModeConfig(tab, rawMode);
    const transitionId = ++modeTransitionToken;
    if (state.tab !== tab) state[`_pre${tab}Tab`] = state.tab;
    destroyRegisteredModes(tab);
    clearModeClasses();
    activeFullscreenMode = mode.fullscreen === false ? null : tab;

    state.tab = tab;
    setActiveTabButton(tab);
    chatsListEl.style.display = "none";
    agentsListEl.style.display = "none";
    searchWrap.style.display  = "none";
    memoryRowEl.style.display = "none";
    const agentsHeader = document.getElementById("agentsHeader");
    if (agentsHeader) agentsHeader.style.display = "none";
    if (listLabel) { listLabel.style.display = ""; listLabel.textContent = mode.label || tab; }
    setCompareMode(false);
    renderComposerChips("default");
    renderCodeBadge(false);
    renderForgeBadge(false);

    const appEl = document.getElementById("app");
    if (mode.appClass) appEl?.classList.add(mode.appClass);
    if (mode.bodyClass) document.body.classList.add(mode.bodyClass);
    document.body.classList.toggle("hashcortx-fullscreen-active", mode.fullscreen !== false);

    try {
      await Promise.resolve(mode.mount?.());
      if (transitionId !== modeTransitionToken) return;
    } catch (err) {
      if (transitionId !== modeTransitionToken) return;
      console.error(`[HashCortx] mode "${tab}" failed to mount`, err);
      try { mode.destroy?.(); } catch {}
      leaveFullscreenModes();
      setTab("chats");
      showError(new Error(`${mode.label || tab} failed to open: ${err?.message || err}`));
    }
  }

  // Composer chip presets. Default = general-purpose, code = Claude-Code style.
  const COMPOSER_CHIPS = {
    default: [
      { preset: "hashAi",    label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true" style="vertical-align:-1px"><path d="M8 1.5l1.6 4.9L15 8l-5.4 1.6L8 14.5l-1.6-4.9L1 8l5.4-1.6z"/></svg> HashCortx`, title: "Prime HashCortx system rules" },
      { preset: "fullstack", label: "Full Stack",         title: "Pro 2026 full-stack website brief" },
      { preset: "mobile",    label: "Mobile App",         title: "Pro 2026 mobile app brief" },
      { preset: "freeRam",   label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free RAM and enable speed mode" },
    ],
    code: [
      { preset: "fullstack",   label: "⌘ Full-stack app",     title: "Scaffold a production full-stack web app" },
      { preset: "mobile",      label: "⌘ Mobile app",         title: "Scaffold a production React Native app" },
      { preset: "restApi",     label: "⌘ REST API + auth",    title: "Build a secured REST API with auth, validation, rate-limit" },
      { preset: "refactor",    label: "⌘ Refactor",           title: "Refactor a pasted file/function for clarity, perf, a11y" },
      { preset: "explainErr",  label: "⌘ Explain error",      title: "Paste an error/stack trace — get cause + fix" },
      { preset: "writeTests",  label: "⌘ Write tests",        title: "Write unit + integration tests for a pasted file" },
      { preset: "debug",       label: "⌘ Debug",              title: "Systematic debug walkthrough of a pasted snippet" },
      { preset: "optimize",    label: "⌘ Optimize",           title: "Improve speed, bundle size, memory, query cost" },
      { preset: "codeReview",  label: "⌘ Code review",        title: "Senior-staff code review of a pasted PR/diff" },
      { preset: "freeRam",     label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free RAM and enable speed mode" },
    ],
    forge: [
      { preset: "forgeScaffold", label: "Forge scaffold", title: "Generate the Vite/React/Three.js scaffold and dependency plan" },
      { preset: "forgeTypes",    label: "Type system",    title: "Write the Forge geometry and swarm TypeScript types first" },
      { preset: "forgeAgent",    label: "AI protocol",    title: "Design the generate_geometry_plan tool schema and streaming parser" },
      { preset: "forgeSwarm",    label: "Swarm particles", title: "Implement Bezier particles, instanced trails, and solidification" },
      { preset: "forgePhases",   label: "7 phases",       title: "Break Forge into the 7 build phases with done criteria" },
      { preset: "freeRam",       label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free RAM and enable speed mode" },
    ],
  };
  function renderComposerChips(which) {
    const chips = COMPOSER_CHIPS[which] || COMPOSER_CHIPS.default;
    const host = $("composerChips");
    if (!host) return;
    host.innerHTML = chips.map(c =>
      `<button data-preset="${escapeHtml(c.preset)}"${c.accent ? ' class="accent"' : ''} title="${escapeHtml(c.title)}">${c.label}</button>`
    ).join("");
  }
  function renderCodeBadge(show) {
    let badge = document.getElementById("codeModeBadge");
    const row = document.querySelector(".crumbs .badge-row");
    if (!badge && row) {
      badge = document.createElement("span");
      badge.id = "codeModeBadge";
      badge.className = "code-mode-badge";
      badge.textContent = "CODING MODE";
      row.insertBefore(badge, activeAgentChip || null);
    }
    if (!badge) return;
    badge.style.display = show ? "inline-flex" : "none";
    if (row && badge.parentElement !== row) {
      row.insertBefore(badge, activeAgentChip || null);
    }
  }
  function renderForgeBadge(show) {
    let badge = document.getElementById("forgeModeBadge");
    const row = document.querySelector(".crumbs .badge-row");
    if (!badge && row) {
      badge = document.createElement("span");
      badge.id = "forgeModeBadge";
      badge.className = "forge-mode-badge";
      badge.textContent = "3D FORGE";
      row.insertBefore(badge, activeAgentChip || null);
    }
    if (!badge) return;
    badge.style.display = show ? "inline-flex" : "none";
    if (row && badge.parentElement !== row) {
      row.insertBefore(badge, activeAgentChip || null);
    }
  }

  // ========= Agents UI =========
  function renderActiveAgentChip() {
    const agent = getActiveAgent();
    if (!agent) {
      activeAgentChip.hidden = true;
      activeAgentChip.className = "";
      activeAgentChip.removeAttribute("title");
      activeAgentChip.innerHTML = "";
      activeAgentChip.onclick = null;
      return;
    }
    activeAgentChip.hidden = false;
    activeAgentChip.style.display = "";
    activeAgentChip.className = "agent-chip";
    activeAgentChip.title = `Active agent: ${agent.name}`;
    activeAgentChip.innerHTML = `<span class="ico">${agentIconSvg(agent)}</span><span class="agent-chip-name">${escapeHtml(agent.name)}</span><span class="clear agent-chip-clear" title="Deactivate agent">×</span>`;
    activeAgentChip.querySelector(".clear").addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveAgent(null);
    });
    activeAgentChip.onclick = () => { setTab("agents"); };
  }

  function setActiveAgent(id) {
    state.activeAgentId = id;
    saveSettings();
    renderActiveAgentChip();
    renderAgentsList();
  }

  function agentIconSvg(agent) {
    const id = agent?.id || "";
    const tools = new Set(agent?.tools || []);
    let paths;
    if (id === "builtin_hash_ai") {
      paths = `<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>`;
    } else if (id === "builtin_coder") {
      paths = `<polyline points="8 9 4 12 8 15"/><polyline points="16 9 20 12 16 15"/><path d="M14 5l-4 14"/>`;
    } else if (id === "builtin_medical_lexi") {
      paths = `<path d="M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M12 3v5h5"/><path d="M9 13h6"/><path d="M12 10v6"/>`;
    } else if (id === "builtin_ats_auditor") {
      paths = `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/><circle cx="17" cy="17" r="3"/><path d="m19.5 19.5 1.5 1.5"/>`;
    } else if (tools.has("web_search") || tools.has("wikipedia")) {
      paths = `<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/><path d="M8.5 11h5"/><path d="M11 8.5v5"/>`;
    } else if (tools.has("fetch_url")) {
      paths = `<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>`;
    } else if (tools.has("pubmed")) {
      paths = `<path d="M5 4h10a4 4 0 0 1 0 8H5Z"/><path d="M5 12h11a3 3 0 0 1 0 6H5Z"/><path d="M8 7h5"/><path d="M8 15h6"/>`;
    } else {
      paths = `<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M18 4l2 2"/><path d="M4 6l2-2"/>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  function renderAgentsList() {
    agentsListEl.innerHTML = "";

    // ── Knowledge Base card (first item, scrolls with agents) ──
    const macCount = loadRAG().length;
    const kb = document.createElement("div");
    kb.className = "kb-card";
    kb.innerHTML = `
      <span class="kb-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="7" ry="3"/>
          <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>
          <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>
          <path d="M8.5 15.5h7"/>
        </svg>
      </span>
      <div class="kb-body">
        <div class="kb-title">Knowledge Base</div>
        <div class="kb-stats">
          <span>This PC: <b id="ragCount">${macCount}</b></span>
          <span style="color:var(--line-strong)">·</span>
          <span>Local PC: <b id="ragDellCount">—</b></span>
          <button class="kb-clear" id="ragClearBtn">Clear This PC</button>
          <button class="kb-clear" id="ragDellClearBtn" style="display:none">Clear Local PC</button>
        </div>
      </div>
      <div class="rag-toggle${ragEnabled ? " on" : ""}" id="ragToggle" title="Enable/disable knowledge base"></div>`;
    kb.querySelector("#ragToggle").addEventListener("click", (e) => {
      e.stopPropagation();
      ragEnabled = !ragEnabled;
      e.currentTarget.classList.toggle("on", ragEnabled);
      saveSettings();
    });
    kb.querySelector("#ragClearBtn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!await themedConfirm("Clear all This PC knowledge chunks?", "Knowledge Base")) return;
      localStorage.removeItem(RAG_KEY);
      updateRagCount();
    });
    kb.querySelector("#ragDellClearBtn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!await themedConfirm("Clear Local PC knowledge base?", "Knowledge Base")) return;
      await ragDellClear();
    });
    agentsListEl.appendChild(kb);
    // Fetch local stats async and update the card
    ragDellStats().then(s => {
      const dc = document.getElementById("ragDellCount");
      const db = document.getElementById("ragDellClearBtn");
      if (dc && s !== null) {
        dc.textContent = s.count;
        if (db && s.count > 0) db.style.display = "";
      }
    }).catch(() => {});

    // ── Separator ──
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:rgba(255,255,255,0.05);margin:2px 0 4px";
    agentsListEl.appendChild(sep);

    const list = allAgents();
    list.forEach(agent => {
      const row = document.createElement("div");
      row.className = "agent-item" + (agent.id === state.activeAgentId ? " active" : "");
      const toolsHtml = (agent.tools && agent.tools.length)
        ? `<div class="agent-tools">${agent.tools.map(t => `<span class="agent-tool">${escapeHtml(t.replace("_"," "))}</span>`).join("")}</div>`
        : "";
      const editBtn = !agent.builtin
        ? `<button class="edit-agent" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
           <button class="del-agent" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>`
        : `<button class="edit-agent" title="Duplicate & edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
      row.innerHTML = `
        <div class="agent-icon">${agentIconSvg(agent)}</div>
        <div class="agent-meta">
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-desc">${escapeHtml(agent.description || "")}</div>
          ${toolsHtml}
        </div>
        <div class="agent-actions">${editBtn}</div>`;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".edit-agent") || e.target.closest(".del-agent")) return;
        setActiveAgent(agent.id === state.activeAgentId ? null : agent.id);
      });
      const editEl = row.querySelector(".edit-agent");
      if (editEl) editEl.addEventListener("click", (e) => { e.stopPropagation(); openAgentEditor(agent); });
      const delEl = row.querySelector(".del-agent");
      if (delEl) delEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!await themedConfirm(`Delete agent "${agent.name}"?`, "Delete Agent")) return;
        state.agents = state.agents.filter(a => a.id !== agent.id);
        if (state.activeAgentId === agent.id) state.activeAgentId = null;
        saveAgents(); saveSettings();
        renderAgentsList(); renderActiveAgentChip();
      });
      agentsListEl.appendChild(row);
    });
  }

  // ========= Agent editor =========
  const ICON_OPTIONS = [
    "⚙︎", "✦", "✎", "{ }",
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2.5-2.5 4-2.5 6s.5 3.5 2.5 6M8 2c2 2.5 2.5 4 2.5 6s-.5 3.5-2.5 6"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 10.5a3 3 0 004.24 0l2-2a3 3 0 00-4.24-4.24L6.5 5.5"/><path d="M10.5 5.5a3 3 0 00-4.24 0l-2 2a3 3 0 004.24 4.24l1-1"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="12" rx="0.5"/><rect x="9" y="3" width="5" height="11" rx="0.5"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><circle cx="8" cy="11" r="1.5"/><path d="M5 6.5v2.5c0 .8.7 1.5 1.5 1.5H8M11 6.5v2.5c0 .8-.7 1.5-1.5 1.5H8"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2a3.5 3.5 0 00-3.5 4.5L2.5 13a1.5 1.5 0 002 2L11 8.5A3.5 3.5 0 1011.5 2z"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M4 6h8M4 9h5"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="6" r="2.5"/><path d="M3 14a5 5 0 0110 0"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6l-1.4 1.4M5 11l-1.4 1.4"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="12" height="10" rx="1.5"/><path d="M2 10l4-3 3 2 2-2 3 3"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h10a1 1 0 011 1v6a1 1 0 01-1 1H3l-2-2v-4l2-2z"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M8 5v6M5 8h6"/></svg>`,
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13V8a4 4 0 118 0v5"/><path d="M1 13h14"/></svg>`,
  ];
  let editingAgent = null;

  function openAgentEditor(source) {
    // source=null → create new; source=builtin → duplicate; source=custom → edit
    if (!source) {
      editingAgent = { id: null, icon: "✦", name: "", description: "", systemPrompt: "", tools: [] };
      $("agentTitle").textContent = "New agent";
      $("deleteAgentBtn").style.display = "none";
    } else if (source.builtin) {
      editingAgent = {
        id: null,
        icon: source.icon, name: source.name + " (copy)", description: source.description,
        systemPrompt: source.systemPrompt, tools: [...(source.tools || [])]
      };
      $("agentTitle").textContent = "Duplicate agent";
      $("deleteAgentBtn").style.display = "none";
    } else {
      editingAgent = JSON.parse(JSON.stringify(source));
      $("agentTitle").textContent = "Edit agent";
      $("deleteAgentBtn").style.display = "";
    }
    $("agentName").value = editingAgent.name;
    $("agentDesc").value = editingAgent.description;
    $("agentSystem").value = editingAgent.systemPrompt;
    $("toolWiki").checked = editingAgent.tools.includes("wikipedia");
    $("toolWebSearch").checked = editingAgent.tools.includes("web_search");
    $("toolFetchUrl").checked = editingAgent.tools.includes("fetch_url");
    $("toolPubmed").checked = editingAgent.tools.includes("pubmed");
    $("toolMemory").checked = editingAgent.tools.includes("memory");
    $("toolDatetime").checked = editingAgent.tools.includes("datetime");
    $("toolCalc").checked = editingAgent.tools.includes("calculate");
    $("toolPython").checked = editingAgent.tools.includes("code_interpreter");
    renderIconPicker();
    agentOverlay.classList.add("open");
  }

  function renderIconPicker() {
    const picker = $("iconPicker");
    picker.innerHTML = "";
    ICON_OPTIONS.forEach(ic => {
      const b = document.createElement("button");
      b.innerHTML = ic;
      b.className = ic === editingAgent.icon ? "selected" : "";
      b.addEventListener("click", () => { editingAgent.icon = ic; renderIconPicker(); });
      picker.appendChild(b);
    });
  }

  async function saveAgentFromEditor() {
    const name = $("agentName").value.trim();
    if (!name) { await themedAlert("Give your agent a name.", "Agent Required"); return; }
    const tools = [];
    if ($("toolWiki").checked) tools.push("wikipedia");
    if ($("toolWebSearch").checked) tools.push("web_search");
    if ($("toolFetchUrl").checked) tools.push("fetch_url");
    if ($("toolPubmed").checked) tools.push("pubmed");
    if ($("toolMemory").checked) tools.push("memory");
    if ($("toolDatetime").checked) tools.push("datetime");
    if ($("toolCalc").checked) tools.push("calculate");
    if ($("toolPython").checked) tools.push("code_interpreter");
    const record = {
      id: editingAgent.id || ("agent_" + uid()),
      builtin: false,
      icon: editingAgent.icon || "✦",
      name,
      description: $("agentDesc").value.trim(),
      systemPrompt: $("agentSystem").value.trim(),
      tools
    };
    if (editingAgent.id) {
      state.agents = state.agents.map(a => a.id === record.id ? record : a);
    } else {
      state.agents.unshift(record);
    }
    saveAgents();
    editingAgent = null;
    agentOverlay.classList.remove("open");
    renderAgentsList();
    renderActiveAgentChip();
  }

  async function deleteAgentFromEditor() {
    if (!editingAgent?.id) return;
    if (!await themedConfirm("Delete this agent?", "Delete Agent")) return;
    state.agents = state.agents.filter(a => a.id !== editingAgent.id);
    if (state.activeAgentId === editingAgent.id) state.activeAgentId = null;
    saveAgents(); saveSettings();
    editingAgent = null;
    agentOverlay.classList.remove("open");
    renderAgentsList(); renderActiveAgentChip();
  }

  document.querySelector(".tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn || !btn.closest(".tabs")) return;
    e.preventDefault();
    setTab(btn.dataset.tab);
  });
  $("hcSafeExitModeBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    safeExitMode();
  });
  projectSelect?.addEventListener("change", () => {
    switchProject(projectSelect.value);
  });
  projectNewBtn?.addEventListener("click", createProject);
  $("projectRenameBtn")?.addEventListener("click", renameProject);
  $("projectDeleteBtn")?.addEventListener("click", deleteProject);
  $("closeAgent").addEventListener("click", () => agentOverlay.classList.remove("open"));
  $("cancelAgentBtn").addEventListener("click", () => agentOverlay.classList.remove("open"));
  $("saveAgentBtn").addEventListener("click", saveAgentFromEditor);
  $("deleteAgentBtn").addEventListener("click", deleteAgentFromEditor);
  agentOverlay.addEventListener("click", (e) => { if (e.target === agentOverlay) agentOverlay.classList.remove("open"); });

  // ========= UI wiring =========
  function updateRangeFill() {
    const pct = ((+tempEl.value - +tempEl.min) / (+tempEl.max - +tempEl.min)) * 100;
    tempEl.style.setProperty("--val", pct + "%");
  }
  tempEl.addEventListener("input", () => { tempVal.textContent = tempEl.value; updateRangeFill(); saveSettings(); });
  systemEl.addEventListener("change", saveSettings);
  hostEl.addEventListener("change", () => { syncHostPreset(); saveSettings(); loadModels(); });
  backendSyncTokenEl?.addEventListener("change", () => { saveSettings(); void pullBackendSecrets(); });

  // ════════════════════════════════════════════════════════════════
  // Ollama endpoint presets — store + + Save / Delete / dropdown wiring
  // Previously the HTML existed but no JS wired it, so the dropdown was
  // empty and "+ Save" did nothing. localStorage key holds the user's
  // custom presets; 3 built-ins always show first and can't be deleted.
  // ════════════════════════════════════════════════════════════════
  const HOST_PRESETS_KEY = "hashui_host_presets_v1";
  const BUILTIN_PRESETS = [
    { label: "Off — disable local Ollama", url: "",                          builtin: true },
    { label: "Local (this Mac)",           url: "http://127.0.0.1:11434",   builtin: true },
    { label: "Local (alt: localhost)",     url: "http://localhost:11434",   builtin: true },
    { label: "LAN — common /24",           url: "http://192.168.1.107:11434", builtin: true },
  ];
  function loadHostPresets() {
    try { return JSON.parse(localStorage.getItem(HOST_PRESETS_KEY) || "[]"); } catch { return []; }
  }
  function saveHostPresets(arr) {
    try { localStorage.setItem(HOST_PRESETS_KEY, JSON.stringify(arr.slice(0, 30))); } catch {}
  }
  function allHostPresets() {
    return [...BUILTIN_PRESETS, ...loadHostPresets().map(p => ({ ...p, builtin: false }))];
  }
  function renderHostPresetDropdown() {
    const sel = $("hostPreset");
    if (!sel) return;
    const all = allHostPresets();
    const current = (hostEl.value || "").trim();
    sel.innerHTML = "";
    all.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.url;
      opt.textContent = p.label;
      opt.dataset.builtin = p.builtin ? "1" : "0";
      if (p.url === current) opt.selected = true;
      sel.appendChild(opt);
    });
    // If current URL isn't in any preset, prepend an "(unsaved) <url>" option
    if (current && !all.some(p => p.url === current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = "(unsaved) " + current;
      opt.dataset.builtin = "1"; // treat as undeletable
      opt.selected = true;
      sel.insertBefore(opt, sel.firstChild);
    }
    updateDeleteBtnVisibility();
  }
  function updateDeleteBtnVisibility() {
    const sel = $("hostPreset");
    const del = $("deleteHostBtn");
    if (!sel || !del) return;
    const selected = sel.selectedOptions?.[0];
    del.style.display = (selected && selected.dataset.builtin === "0") ? "" : "none";
  }
  function syncHostPreset() {
    // Called when the user types a URL directly — mark matching preset as selected,
    // or add an "(unsaved)" entry if it's new. Rerender the dropdown to reflect state.
    renderHostPresetDropdown();
  }
  // Dropdown selection → fill the URL + label inputs
  $("hostPreset")?.addEventListener("change", () => {
    const sel = $("hostPreset");
    const labelInput = $("hostLabel");
    const selected = sel.selectedOptions?.[0];
    if (!selected) return;
    hostEl.value = selected.value;
    if (labelInput) labelInput.value = selected.dataset.builtin === "0" ? selected.textContent : "";
    updateDeleteBtnVisibility();
    saveSettings();
    // "Off" preset (empty URL) → don't try to ping a non-existent endpoint
    if (!selected.value) {
      try { setStatus("warn", "Local Ollama: Off"); } catch {}
      try { modelEl.innerHTML = `<option value="">— local Ollama disabled —</option>`; } catch {}
      try { populateCloudModels(); } catch {}
      return;
    }
    loadModels();
  });
  // + Save button → append current URL+label to localStorage presets
  $("saveHostBtn")?.addEventListener("click", () => {
    const url = (hostEl.value || "").trim();
    const label = (($("hostLabel")?.value) || "").trim();
    if (!url) return;
    if (!label) {
      $("hostLabel")?.focus();
      return;
    }
    const presets = loadHostPresets();
    // Replace if same URL already exists in custom, otherwise append
    const idx = presets.findIndex(p => p.url === url);
    if (idx >= 0) presets[idx] = { label, url };
    else presets.unshift({ label, url });
    saveHostPresets(presets);
    if ($("hostLabel")) $("hostLabel").value = "";
    renderHostPresetDropdown();
  });
  // Delete button → only deletes custom presets
  $("deleteHostBtn")?.addEventListener("click", () => {
    const sel = $("hostPreset");
    const selected = sel?.selectedOptions?.[0];
    if (!selected || selected.dataset.builtin !== "0") return;
    const url = selected.value;
    const presets = loadHostPresets().filter(p => p.url !== url);
    saveHostPresets(presets);
    // Switch back to the first built-in
    hostEl.value = BUILTIN_PRESETS[0].url;
    renderHostPresetDropdown();
    saveSettings();
    loadModels();
  });
  // Initial render
  renderHostPresetDropdown();

  // ========= Terminate session — unload models from local RAM =========
  const terminateBtn = $("terminateSession");
  terminateBtn.addEventListener("click", async () => {
    if (terminateBtn.classList.contains("busy")) return;
    terminateBtn.classList.add("busy");
    const originalLabel = terminateBtn.querySelector("svg").nextSibling;
    // Abort any live stream
    if (state.streaming) { try { state.abort?.abort(); } catch {} state.streaming = false; sendBtn.textContent = "Send"; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    // Persist current chat BEFORE touching anything so it's preserved
    try { persistCurrentChat(); } catch {}
    const host = safeHost();
    let unloaded = 0;
    try {
      let names = [];
      try {
        const snap = await fetchLoadedLocalModels(host, 5000);
        names = snap.names;
      } catch {
        names = getTrackedLocalModels();
      }
      const unloadSet = [...new Set(names)];
      unloaded = unloadSet.length;
      await unloadLocalModels(unloadSet);
      setStatus("ok", unloaded > 0 ? `Unloaded ${unloaded} model${unloaded===1?"":"s"} · RAM freed` : `RAM freed`);
    } catch (err) {
      showError(new Error(`Couldn't unload models: ${err.message}`));
    } finally {
      terminateBtn.classList.remove("busy");
    }
  });

  // Settings modal + tabs
  function openSettings() {
    activateSettingsTab(settingsOverlay.dataset.activeTab || "settings");
    settingsOverlay.classList.add("open");
    settingsOverlay.querySelector(".settings-pane:not([hidden])")?.scrollTo?.(0, 0);
  }
  function closeSettings() { settingsOverlay.classList.remove("open"); saveSettings(); }
  $("openSettings").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", closeSettings);
  $("closeSettingsFooter").addEventListener("click", closeSettings);
  $("settingsNotesToggle")?.addEventListener("click", () => {
    const notes = $("settingsNotes");
    if (!notes) return;
    const open = notes.style.display === "none";
    notes.style.display = open ? "" : "none";
    $("settingsNotesToggle").classList.toggle("active", open);
  });
  settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettings(); });
  document.addEventListener("keydown", (e) => {
    if (terminalAlertOverlay?.classList.contains("open")) return;
    if (e.key === "Escape" && settingsOverlay.classList.contains("open")) closeSettings();
  });

  // Settings ↔ APIs ↔ Memory ↔ About tab switching
  const stabSettings = $("stab-settings"), stabApis = $("stab-apis"), stabMemory = $("stab-memory"), stabAbout = $("stab-about");
  const settingsPane = $("settingsPane"), apisPane = $("apisPane"), memoryPane = $("memoryPane"), aboutPane = $("aboutPane");
  function setSettingsPaneVisible(pane, visible) {
    if (!pane) return;
    pane.hidden = !visible;
    pane.style.display = visible ? "" : "none";
    pane.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  function activateSettingsTab(which) {
    const tabs = {
      settings: { tab: stabSettings, pane: settingsPane, title: "Settings" },
      apis: { tab: stabApis, pane: apisPane, title: "APIs", onShow: renderApisPane },
      memory: { tab: stabMemory, pane: memoryPane, title: "Memory", onShow: renderMemoryPane },
      about: { tab: stabAbout, pane: aboutPane, title: "About" },
    };
    const activeKey = tabs[which]?.tab && tabs[which]?.pane ? which : "settings";
    Object.entries(tabs).forEach(([key, cfg]) => {
      const active = key === activeKey;
      cfg.tab?.classList.toggle("active", active);
      setSettingsPaneVisible(cfg.pane, active);
    });
    settingsOverlay.dataset.activeTab = activeKey;
    $("settingsTitle").textContent = tabs[activeKey]?.title || "Settings";
    tabs[activeKey]?.onShow?.();
  }
  stabSettings?.addEventListener("click", () => activateSettingsTab("settings"));
  stabApis?.addEventListener("click",    () => activateSettingsTab("apis"));
  stabMemory?.addEventListener("click",   () => activateSettingsTab("memory"));
  stabAbout?.addEventListener("click",    () => activateSettingsTab("about"));
  activateSettingsTab("settings");

  // Ecosystem links in the About pane open the repo in the system browser.
  aboutPane?.addEventListener("click", (e) => {
    const el = e.target.closest("[data-eco-url]");
    if (!el) return;
    e.preventDefault();
    const url = el.getAttribute("data-eco-url");
    if (url && window.HC?.invoke) HC.invoke("plugin:opener|open_url", { url }).catch(() => {});
  });

  // ── APIs pane: status dots + test buttons ──────────────────────────────
  const MOONSHOT_API_BASES = [
    "https://api.kimi.com/v1",
    "https://api.kimi.ai/v1",
    "https://api.moonshot.ai/v1",
    "https://api.moonshot.cn/v1",
  ];
  // Anthropic-compatible bases used by the new Kimi for Code platform.
  // Keys minted at kimi.com/code/console start with "sk-ki" and only work here.
  const KIMI_ANTHROPIC_BASES = [
    "https://api.moonshot.ai/anthropic",
    "https://api.moonshot.cn/anthropic",
    "https://api.kimi.com/anthropic",
    "https://api.kimi.ai/anthropic",
  ];
  const _moonshotApiBaseByKey = new Map();

  function isKimiCodeKey(key) {
    return typeof key === "string" && key.trim().toLowerCase().startsWith("sk-ki");
  }

  async function fetchKimiAnthropic(path, key, initFactory) {
    let lastError = null;
    let lastUrl = "";
    for (const base of KIMI_ANTHROPIC_BASES) {
      const fullUrl = `${base}${path}`;
      lastUrl = fullUrl;
      try {
        const init = typeof initFactory === "function" ? initFactory(base) : {};
        const res = await fetch(fullUrl, { referrerPolicy: "no-referrer", ...init });
        if (res.ok) return { res, baseUrl: base };
        const txt = await res.text().catch(() => "");
        const enriched = `${cloudHttpError("moonshot", res.status, txt, res.headers.get("Retry-After"))}\nEndpoint tried: ${fullUrl}`;
        lastError = new Error(enriched);
        if (res.status !== 401 && res.status !== 403 && res.status !== 404) return Promise.reject(lastError);
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        lastError = err;
      }
    }
    throw lastError || new Error(`Kimi (Anthropic-compat) request failed. Last endpoint: ${lastUrl}`);
  }

  function buildKimiAnthropicBody(model, messages, opts) {
    const systemMsg = messages.find(m => m.role === "system");
    const anthropicMessages = messages
      .filter(m => m.role !== "system")
      .map(m => {
        const content = [];
        if (m.content) content.push({ type: "text", text: m.content });
        if (m.images?.length) m.images.forEach(b64 => content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
        return { role: m.role === "assistant" ? "assistant" : "user", content: content.length ? content : [{ type: "text", text: "" }] };
      });
    const body = { model, messages: anthropicMessages, max_tokens: (opts && opts.maxTokens) || 4096 };
    if (systemMsg) body.system = systemMsg.content;
    if (opts && typeof opts.temperature === "number") body.temperature = opts.temperature;
    if (opts && opts.stream) body.stream = true;
    return body;
  }

  function moonshotEndpointLabel(baseUrl) {
    const s = String(baseUrl || "");
    if (s.includes("kimi.com")) return "api.kimi.com";
    if (s.includes("kimi.ai"))  return "api.kimi.ai";
    if (s.includes(".cn"))      return "api.moonshot.cn";
    return "api.moonshot.ai";
  }

  function orderedMoonshotBases(apiKey) {
    const cached = _moonshotApiBaseByKey.get(apiKey || "");
    if (!cached) return MOONSHOT_API_BASES.slice();
    return [cached, ...MOONSHOT_API_BASES.filter(base => base !== cached)];
  }

  function shouldTryNextMoonshotEndpoint(status) {
    // Kimi.com (sk-ki keys) and legacy Moonshot platforms are SEPARATE auth backends
    // — a key minted on one will 401 on the other. So fall back on 401/403/404 to
    // sweep all four candidates (kimi.com → kimi.ai → moonshot.ai → moonshot.cn).
    return status === 401 || status === 403 || status === 404;
  }

  async function fetchMoonshotApi(path, apiKey, initFactory) {
    let lastError = null;
    for (const baseUrl of orderedMoonshotBases(apiKey)) {
      try {
        const init = typeof initFactory === "function" ? initFactory(baseUrl) : {};
        const res = await fetch(`${baseUrl}${path}`, { referrerPolicy: "no-referrer", ...init });
        if (res.ok) {
          _moonshotApiBaseByKey.set(apiKey || "", baseUrl);
          return { res, baseUrl };
        }
        const txt = await res.text().catch(() => "");
        lastError = new Error(cloudHttpError("moonshot", res.status, txt, res.headers.get("Retry-After")));
        if (!shouldTryNextMoonshotEndpoint(res.status)) return Promise.reject(lastError);
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        lastError = err;
      }
    }
    throw lastError || new Error("Moonshot (Kimi) request failed.");
  }

  const API_PROVIDERS = [
    { id: "groq",       name: "Groq",        keyId: "groqKey",       testUrl: "https://api.groq.com/openai/v1/models",           auth: "bearer" },
    { id: "gemini",     name: "Gemini",      keyId: "geminiKey",     testUrl: "https://generativelanguage.googleapis.com/v1beta/models?key=", auth: "query" },
    { id: "openai",     name: "OpenAI",      keyId: "openaiKey",     testUrl: "https://api.openai.com/v1/models",               auth: "bearer" },
    { id: "anthropic",  name: "Anthropic",   keyId: "anthropicKey",  testUrl: null,                                             auth: null }, // no public test endpoint
    { id: "moonshot",   name: "Moonshot (Kimi)", keyId: "moonshotKey", testUrl: null,                                             auth: "moonshot" },
    { id: "deepseek",   name: "DeepSeek",    keyId: "deepseekKey",   testUrl: "https://api.deepseek.com/v1/models",             auth: "bearer" },
    { id: "mistral",    name: "Mistral",     keyId: "mistralKey",    testUrl: "https://api.mistral.ai/v1/models",               auth: "bearer" },
    { id: "cerebras",   name: "Cerebras",    keyId: "cerebrasKey",   testUrl: "https://api.cerebras.ai/v1/models",              auth: "bearer" },
    { id: "samba",      name: "SambaNova",   keyId: "sambaKey",      testUrl: "https://api.sambanova.ai/v1/models",             auth: "bearer" },
    { id: "openrouter", name: "OpenRouter",  keyId: "openRouterKey", testUrl: "https://openrouter.ai/api/v1/auth/key",          auth: "bearer" },
    { id: "nvidia",     name: "NVIDIA NIM",  keyId: "nvidiaKey",     testUrl: null,                                             auth: null }, // tested via route, not here
  ];

  async function testProviderConnection(provider) {
    const key = ($(provider.keyId)?.value || "").trim();
    if (!key) return { ok: false, error: "No API key entered" };
    if (provider.auth === "moonshot") {
      try {
        // sk-ki keys (Kimi for Code) require the Anthropic-compatible path —
        // /v1/models exists there too on Moonshot's hybrid backend.
        if (isKimiCodeKey(key)) {
          const { baseUrl } = await fetchKimiAnthropic("/v1/models", key, () => ({
            method: "GET",
            headers: { "Authorization": `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" },
            signal: makeSignal(8000),
          }));
          return { ok: true, note: `Connected via ${baseUrl.replace(/^https?:\/\//, "")}` };
        }
        const { baseUrl } = await fetchMoonshotApi("/models", key, () => ({
          method: "GET",
          headers: { Authorization: `Bearer ${key}` },
          signal: makeSignal(8000),
        }));
        return { ok: true, note: `Connected via ${moonshotEndpointLabel(baseUrl)}` };
      } catch (e) {
        return { ok: false, error: e?.message || "Network error" };
      }
    }
    if (!provider.testUrl) return { ok: true, note: "Key present — test on first use" };
    try {
      const url = provider.auth === "query" ? `${provider.testUrl}${encodeURIComponent(key)}` : provider.testUrl;
      const headers = provider.auth === "bearer" ? { Authorization: `Bearer ${key}` } : {};
      const r = await fetch(url, { method: "GET", referrerPolicy: "no-referrer", headers, signal: makeSignal(8000) });
      if (r.ok) return { ok: true };
      const txt = await r.text().catch(() => "");
      return { ok: false, error: cloudHttpError(provider.id, r.status, txt) };
    } catch (e) {
      return { ok: false, error: e?.message || "Network error" };
    }
  }

  function renderApisPane() {
    for (const p of API_PROVIDERS) {
      const input = $(p.keyId);
      if (!input) continue;
      let row = input.closest(".api-key-row");
      if (!row) {
        // Wrap input in a row with status dot and test button
        row = document.createElement("div");
        row.className = "api-key-row";
        input.parentNode.insertBefore(row, input);
        row.appendChild(input);
        const actions = document.createElement("div");
        actions.className = "api-key-actions";
        const dot = document.createElement("span");
        dot.className = "api-key-dot";
        dot.title = "Key status";
        const btn = document.createElement("button");
        btn.className = "api-key-test";
        btn.type = "button";
        btn.textContent = "Test";
        btn.addEventListener("click", async () => {
          btn.textContent = "…";
          btn.disabled = true;
          const res = await testProviderConnection(p);
          btn.disabled = false;
          btn.textContent = res.ok ? "OK" : "Fail";
          dot.className = "api-key-dot " + (res.ok ? "ok" : "err");
          if (!res.ok && res.error) showError(new Error(`${p.name}: ${res.error}`));
          setTimeout(() => { btn.textContent = "Test"; }, res.ok ? 1200 : 2500);
        });
        actions.appendChild(dot);
        actions.appendChild(btn);
        row.appendChild(actions);
      }
      // Update dot based on current value
      const dot = row.querySelector(".api-key-dot");
      const hasKey = !!(input.value || "").trim();
      dot.className = "api-key-dot " + (hasKey ? "ok" : "");
    }
  }

  // ── Memory CRUD UI ─────────────────────────────────────────────────────
  // Reads/writes via memLoad / memSave / memAdd / memClear (already defined
  // in the agent layer) so the agent and UI share one source of truth.
  function fmtRelative(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); if (d < 30)  return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }
  function renderMemoryPane() {
    const projectOnly = currentProject()?.memoryMode === "project";
    const all = (typeof memLoad === "function" ? memLoad() : [])
      .filter(f => {
        const pid = f.projectId || DEFAULT_PROJECT_ID;
        return projectOnly ? pid === state.currentProjectId : (pid === DEFAULT_PROJECT_ID || pid === state.currentProjectId);
      })
      .slice().sort((a, b) => b.ts - a.ts);
    const q = ($("memSearchInput")?.value || "").trim().toLowerCase();
    const filtered = q
      ? all.filter(f => (f.key + " " + f.value).toLowerCase().includes(q))
      : all;
    const countEl = $("memCountBadge");
    if (countEl) countEl.textContent = `${all.length} fact${all.length === 1 ? "" : "s"}` + (q ? ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}` : "");
    const list = $("memList");
    if (!list) return;
    if (!filtered.length) {
      list.innerHTML = `<div class="mem-empty">${
        all.length === 0
          ? "No memories yet. The agent will save preferences and details automatically as you chat — or use <b>+ Add</b> to enter one manually."
          : "No facts match your search."
      }</div>`;
      return;
    }
    list.innerHTML = filtered.map(f => `
      <div class="mem-row" data-id="${escapeHtml(f.id)}">
        <div class="mem-key" title="${escapeHtml(f.key)}">${escapeHtml(f.key)}</div>
        <div class="mem-val" data-role="val" title="Click to edit">${escapeHtml(f.value)}</div>
        <div class="mem-actions">
          <button class="mem-edit" title="Edit value" aria-label="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="mem-del"  title="Delete" aria-label="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
        </div>
        <div class="mem-time">${fmtRelative(f.ts)}</div>
      </div>
    `).join("");
    // Wire row actions
    list.querySelectorAll(".mem-row").forEach(row => {
      const id = row.dataset.id;
      const valEl = row.querySelector('[data-role="val"]');
      const startEdit = () => {
        valEl.contentEditable = "true";
        valEl.focus();
        // Place caret at end
        const r = document.createRange(); r.selectNodeContents(valEl); r.collapse(false);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      };
      const commitEdit = () => {
        valEl.contentEditable = "false";
        const newVal = valEl.textContent.trim();
        const arr = memLoad();
        const i = arr.findIndex(x => x.id === id);
        if (i >= 0 && newVal && newVal !== arr[i].value) {
          arr[i].value = newVal.slice(0, 1200);
          arr[i].ts = Date.now();
          memSave(arr);
          renderMemoryPane();
        } else if (i >= 0 && !newVal) {
          // Empty value = delete
          arr.splice(i, 1); memSave(arr); renderMemoryPane();
        }
      };
      row.querySelector(".mem-edit").addEventListener("click", startEdit);
      valEl.addEventListener("dblclick", startEdit);
      valEl.addEventListener("blur", commitEdit);
      valEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); valEl.blur(); }
        if (e.key === "Escape") { e.preventDefault(); valEl.textContent = arr_value_for(id); valEl.blur(); }
      });
      row.querySelector(".mem-del").addEventListener("click", async () => {
        const arr = memLoad();
        const i = arr.findIndex(x => x.id === id);
        if (i < 0) return;
        const ok = await themedConfirm(`Delete fact "${arr[i].key}"?`, "Memory");
        if (!ok) return;
        arr.splice(i, 1); memSave(arr); renderMemoryPane();
      });
    });
  }
  function arr_value_for(id) {
    const f = memLoad().find(x => x.id === id);
    return f ? f.value : "";
  }
  // Search (live filter)
  $("memSearchInput")?.addEventListener("input", () => renderMemoryPane());
  // + Add
  $("memAddBtn")?.addEventListener("click", async () => {
    const key = await themedPrompt("Fact key (short label, e.g. favorite_animal):", "", "Memory");
    if (!key) return;
    const value = await themedPrompt(`Value for "${key.trim()}":`, "", "Memory");
    if (!value) return;
    memAdd(key, value);
    renderMemoryPane();
  });
  // Export
  $("memExportBtn")?.addEventListener("click", () => {
    const data = JSON.stringify(memLoad(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dt = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `hashui-memory-${dt}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  // Import
  $("memImportBtn")?.addEventListener("click", () => $("memImportFile").click());
  $("memImportFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = JSON.parse(text);
      if (!Array.isArray(incoming)) throw new Error("Not an array");
      const mode = await themedConfirm(
        `Import ${incoming.length} fact(s)?\n\nOK = MERGE (keep current, add new, overwrite same keys)\nCancel = abort.\nTo REPLACE everything, click Clear all first then import.`,
        "Import memory"
      );
      if (!mode) { e.target.value = ""; return; }
      const cur = memLoad();
      const byKey = new Map(cur.map(f => [f.key.toLowerCase(), f]));
      for (const f of incoming) {
        if (!f || !f.key || !f.value) continue;
        byKey.set(String(f.key).toLowerCase(), {
          id: f.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          key: String(f.key).slice(0, 120),
          value: String(f.value).slice(0, 1200),
          ts: f.ts || Date.now(),
          projectId: f.projectId || DEFAULT_PROJECT_ID,
          scope: f.scope || "personal",
          confidence: Number.isFinite(f.confidence) ? f.confidence : 1,
          approved: f.approved !== false,
          source: f.source || "import"
        });
      }
      memSave([...byKey.values()]);
      renderMemoryPane();
    } catch (err) {
      themedAlert("Import failed: " + (err?.message || err), "Memory");
    } finally {
      e.target.value = "";
    }
  });
  // ── Memory map (radial diagram) ─────────────────────────────────────
  // Center node = "You". Categories derived from key prefix (text before
  // the first underscore) or from key itself when no underscore. Facts
  // sit on the outer ring under their category. Click anything to see
  // the full value in the bottom strip.
  function memCategoryOf(key) {
    const k = String(key || "").toLowerCase();
    const i = k.indexOf("_");
    if (i > 0) return k.slice(0, i);
    // Common single-token keys → group by theme
    if (/^(name|age|birthday|location|origin|languages|allergies)$/.test(k)) return "identity";
    if (/^(likes|dislikes|preferred|favorite|favourite)$/.test(k)) return "preferences";
    if (/^(employer|role|job|career)$/.test(k)) return "work";
    if (/^note_/.test(k)) return "notes";
    return "other";
  }
  // ── Map state — persisted positions + view (pan/zoom) ───────────────────
  const MEM_MAP_POS_KEY = "hashui_memmap_pos_v1";
  const MEM_MAP_VIEW_KEY = "hashui_memmap_view_v1";
  function memMapLoadPos() { try { return JSON.parse(localStorage.getItem(MEM_MAP_POS_KEY) || "{}"); } catch { return {}; } }
  function memMapSavePos(p) { try { localStorage.setItem(MEM_MAP_POS_KEY, JSON.stringify(p)); } catch {} }
  function memMapLoadView() { try { return JSON.parse(localStorage.getItem(MEM_MAP_VIEW_KEY) || "null"); } catch { return null; } }
  function memMapSaveView(v) { try { localStorage.setItem(MEM_MAP_VIEW_KEY, JSON.stringify(v)); } catch {} }

  // Convert a pointer event into SVG-userspace coords.
  function mmSvgPoint(svg, ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: ev.clientX, y: ev.clientY };
  }

  let _mmState = null;

  function renderMemoryMap() {
    const svg   = document.getElementById("memMapSvg");
    const world = document.getElementById("mmWorld");
    const grid  = document.getElementById("mmGridBg");
    const detail = document.getElementById("memMapDetail");
    if (!svg || !world) return;

    const projectOnly = currentProject()?.memoryMode === "project";
    const facts = (typeof memLoad === "function" ? memLoad() : [])
      .filter(f => {
        const pid = f.projectId || DEFAULT_PROJECT_ID;
        return projectOnly ? pid === state.currentProjectId : (pid === DEFAULT_PROJECT_ID || pid === state.currentProjectId);
      })
      .slice();
    if (!facts.length) {
      world.removeAttribute("transform");
      if (grid) grid.removeAttribute("transform");
      _mmState = null;
      world.innerHTML = `<text x="600" y="400" text-anchor="middle" style="fill:var(--text-dim);font-size:14px;font-family:ui-sans-serif,system-ui,sans-serif">No memories yet — chat with the agent to populate the map.</text>`;
      detail.innerHTML = `<span style="color:var(--text-dim)">Empty memory.</span>`;
      return;
    }
    // Group by category
    const cats = new Map();
    for (const f of facts) {
      const c = memCategoryOf(f.key);
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c).push(f);
    }
    const catList = [...cats.entries()].sort((a, b) => b[1].length - a[1].length);

    // ---- Compute default layout (radial), then override with saved drags ----
    const cx0 = 600, cy0 = 400;
    const innerR = 180, outerR = 330;
    const savedPos = memMapLoadPos();
    const nodes = []; // {id, type, x, y, w, h, label, sub, fact?, parent?}

    nodes.push({ id: "_center", type: "center", x: cx0, y: cy0, w: 110, h: 110, label: "YOU", sub: `${facts.length} fact${facts.length === 1 ? "" : "s"}` });

    catList.forEach(([cat, items], ci) => {
      const angle = (ci / catList.length) * Math.PI * 2 - Math.PI / 2;
      const dx = cx0 + Math.cos(angle) * innerR;
      const dy = cy0 + Math.sin(angle) * innerR;
      const lbl = cat.toUpperCase();
      const w = Math.max(96, lbl.length * 8 + 36);
      nodes.push({ id: "cat:" + cat, type: "cat", x: dx, y: dy, w, h: 32, label: lbl, count: items.length, parent: "_center" });
      // Spread facts on an arc around the category
      const arcSpan = Math.min((Math.PI * 2) / catList.length * 0.95, 1.3);
      items.forEach((f, fi) => {
        const t = items.length === 1 ? 0 : (fi / (items.length - 1)) - 0.5;
        const fa = angle + t * arcSpan;
        const fx = cx0 + Math.cos(fa) * outerR;
        const fy = cy0 + Math.sin(fa) * outerR;
        const keyLabel = f.key.length > 18 ? f.key.slice(0, 17) + "…" : f.key;
        const valLabel = (f.value || "").length > 22 ? f.value.slice(0, 21) + "…" : (f.value || "");
        const w = Math.max(116, Math.min(170, Math.max(keyLabel.length, valLabel.length) * 5.6 + 24));
        nodes.push({ id: "fact:" + f.id, type: "fact", x: fx, y: fy, w, h: 40, label: keyLabel, sub: valLabel, fact: f, parent: "cat:" + cat });
      });
    });
    // Apply saved overrides
    nodes.forEach(n => {
      const p = savedPos[n.id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { n.x = p.x; n.y = p.y; }
    });

    // ---- Render edges first (they sit beneath nodes) ----
    const edges = [];
    nodes.forEach(n => {
      if (!n.parent) return;
      const p = nodes.find(x => x.id === n.parent);
      if (!p) return;
      edges.push({ from: p, to: n, kind: n.type === "cat" ? "cat" : "fact" });
    });

    const svgEdges = edges.map((e, i) =>
      `<line class="mm-link ${e.kind === "cat" ? "cat" : ""}" data-edge="${i}" x1="${e.from.x.toFixed(1)}" y1="${e.from.y.toFixed(1)}" x2="${e.to.x.toFixed(1)}" y2="${e.to.y.toFixed(1)}"/>`
    ).join("");

    const svgNodes = nodes.map(n => {
      if (n.type === "center") {
        return `<g class="mm-node" data-id="${n.id}" data-type="center" transform="translate(${n.x} ${n.y})">
          <circle class="mm-center-halo" r="74"/>
          <circle class="mm-center-core" r="48"/>
          <text class="mm-center-text" y="-4">${escapeHtml(n.label)}</text>
          <text class="mm-center-sub"  y="13">${escapeHtml(n.sub)}</text>
        </g>`;
      }
      if (n.type === "cat") {
        return `<g class="mm-node" data-id="${escapeHtml(n.id)}" data-type="cat" transform="translate(${n.x} ${n.y})">
          <rect class="mm-cat-bg" x="${-n.w/2}" y="${-n.h/2}" width="${n.w}" height="${n.h}" rx="${n.h/2}"/>
          <text class="mm-cat-text" y="-1">${escapeHtml(n.label)}</text>
          <text class="mm-cat-count" x="${n.w/2 - 14}" y="0">·${n.count}</text>
        </g>`;
      }
      // fact
      return `<g class="mm-node" data-id="${escapeHtml(n.id)}" data-type="fact" transform="translate(${n.x} ${n.y})">
        <rect class="mm-fact-bg" x="${-n.w/2}" y="${-n.h/2}" width="${n.w}" height="${n.h}" rx="10"/>
        <text class="mm-fact-key" y="-7">${escapeHtml(n.label)}</text>
        <text class="mm-fact-val" y="9">${escapeHtml(n.sub)}</text>
      </g>`;
    }).join("");

    world.innerHTML = svgEdges + svgNodes;

    // ---- View transform (pan/zoom) ----
    const savedView = memMapLoadView() || { tx: 0, ty: 0, k: 1 };
    const view = {
      tx: Number.isFinite(savedView.tx) ? savedView.tx : 0,
      ty: Number.isFinite(savedView.ty) ? savedView.ty : 0,
      k: Number.isFinite(savedView.k) ? Math.max(0.25, Math.min(3.5, savedView.k)) : 1
    };
    function applyView() {
      world.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.k})`);
      if (grid) grid.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    }
    applyView();

    // ---- Stash state for handlers (zoom buttons read this) ----
    function fitView(persist = true) {
      if (!nodes.length) return;
      const pad = 120;
      const bounds = nodes.reduce((acc, n) => ({
        minX: Math.min(acc.minX, n.x - n.w / 2),
        minY: Math.min(acc.minY, n.y - n.h / 2),
        maxX: Math.max(acc.maxX, n.x + n.w / 2),
        maxY: Math.max(acc.maxY, n.y + n.h / 2)
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const vb = svg.viewBox.baseVal;
      const bw = Math.max(1, bounds.maxX - bounds.minX);
      const bh = Math.max(1, bounds.maxY - bounds.minY);
      const k = Math.max(0.45, Math.min(1.6, Math.min((vb.width - pad * 2) / bw, (vb.height - pad * 2) / bh)));
      view.k = k;
      view.tx = vb.x + vb.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k;
      view.ty = vb.y + vb.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k;
      applyView();
      if (persist) memMapSaveView(view);
    }

    _mmState = { svg, world, view, applyView, fitView, nodes, edges, savedPos };

    // ---- Drag a single node ----
    function attachDrag(g) {
      const id = g.getAttribute("data-id");
      const node = nodes.find(n => n.id === id);
      if (!node) return;
      let dragStart = null;
      g.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        g.setPointerCapture(e.pointerId);
        g.classList.add("dragging");
        const pt = mmSvgPoint(svg, e);
        // Convert to world coords
        const wx = (pt.x - view.tx) / view.k;
        const wy = (pt.y - view.ty) / view.k;
        dragStart = { wx, wy, nx: node.x, ny: node.y, moved: false };
      });
      g.addEventListener("pointermove", (e) => {
        if (!dragStart) return;
        const pt = mmSvgPoint(svg, e);
        const wx = (pt.x - view.tx) / view.k;
        const wy = (pt.y - view.ty) / view.k;
        const dx = wx - dragStart.wx;
        const dy = wy - dragStart.wy;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragStart.moved = true;
        node.x = dragStart.nx + dx;
        node.y = dragStart.ny + dy;
        g.setAttribute("transform", `translate(${node.x} ${node.y})`);
        // Update incident edges
        edges.forEach((edge, i) => {
          if (edge.from.id === id || edge.to.id === id) {
            const line = world.querySelector(`line[data-edge="${i}"]`);
            if (!line) return;
            line.setAttribute("x1", edge.from.x.toFixed(1));
            line.setAttribute("y1", edge.from.y.toFixed(1));
            line.setAttribute("x2", edge.to.x.toFixed(1));
            line.setAttribute("y2", edge.to.y.toFixed(1));
          }
        });
      });
      const finish = (e) => {
        if (!dragStart) return;
        g.classList.remove("dragging");
        try { g.releasePointerCapture(e.pointerId); } catch {}
        if (dragStart.moved) {
          savedPos[id] = { x: node.x, y: node.y };
          memMapSavePos(savedPos);
        } else {
          // It was a click — show details
          if (node.type === "fact" && node.fact) {
            world.querySelectorAll(".mm-node").forEach(n => n.classList.remove("active"));
            g.classList.add("active");
            detail.innerHTML = `<span style="color:var(--gold-deep);font-family:ui-monospace,Menlo,monospace;font-size:11.5px">${escapeHtml(node.fact.key)}</span> &nbsp;<span style="color:var(--muted);font-size:10.5px">${fmtRelative(node.fact.ts)}</span><div style="margin-top:4px;color:var(--text)">${escapeHtml(node.fact.value)}</div><div style="margin-top:6px;font-size:10.5px;color:var(--muted)">Double-click the node to edit · drag to reposition</div>`;
          } else if (node.type === "cat") {
            detail.innerHTML = `<span style="color:var(--gold-deep)">Category:</span> ${escapeHtml(node.label)} <span style="color:var(--muted)">— ${node.count} fact(s). Drag to rearrange the cluster.</span>`;
          } else if (node.type === "center") {
            detail.innerHTML = `<span style="color:var(--gold)">YOU</span> — drag categories around to organize, double-click facts to edit.`;
          }
        }
        dragStart = null;
      };
      g.addEventListener("pointerup", finish);
      g.addEventListener("pointercancel", finish);

      // Edit on double-click (facts only)
      g.addEventListener("dblclick", async (e) => {
        if (node.type !== "fact" || !node.fact) return;
        e.stopPropagation();
        const next = await themedPrompt(`Edit "${node.fact.key}":`, node.fact.value, "Memory");
        if (next == null) return;
        const arr = memLoad();
        const i = arr.findIndex(x => x.id === node.fact.id);
        if (i < 0) return;
        if (!next.trim()) { arr.splice(i, 1); }
        else { arr[i].value = next.trim().slice(0, 1200); arr[i].ts = Date.now(); }
        memSave(arr);
        renderMemoryMap();
      });
    }
    world.querySelectorAll(".mm-node").forEach(attachDrag);

    // ---- Pan on background drag ----
    let panStart = null;
    svg.onpointerdown = (e) => {
      if (e.target.closest(".mm-node")) return; // node drag handled by attachDrag
      if (e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("panning");
      panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    };
    svg.onpointermove = (e) => {
      if (!panStart) return;
      const ctm = svg.getScreenCTM();
      const scaleX = ctm ? 1 / ctm.a : 1;
      const scaleY = ctm ? 1 / ctm.d : 1;
      view.tx = panStart.tx + (e.clientX - panStart.x) * scaleX;
      view.ty = panStart.ty + (e.clientY - panStart.y) * scaleY;
      applyView();
    };
    const endPan = (e) => {
      if (!panStart) return;
      try { svg.releasePointerCapture(e.pointerId); } catch {}
      svg.classList.remove("panning");
      panStart = null;
      memMapSaveView(view);
    };
    svg.onpointerup = endPan;
    svg.onpointercancel = endPan;

    // ---- Zoom on wheel (around cursor) ----
    svg.onwheel = (e) => {
      e.preventDefault();
      const pt = mmSvgPoint(svg, e);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newK = Math.max(0.25, Math.min(3.5, view.k * factor));
      // Keep cursor anchored: world coord under cursor stays put
      const wx = (pt.x - view.tx) / view.k;
      const wy = (pt.y - view.ty) / view.k;
      view.tx = pt.x - wx * newK;
      view.ty = pt.y - wy * newK;
      view.k = newK;
      applyView();
      memMapSaveView(view);
    };
  }

  // Zoom buttons + reset positions
  function memMapZoom(factor) {
    if (!_mmState) return;
    const { svg, view, applyView } = _mmState;
    const rect = svg.getBoundingClientRect();
    const fakeEv = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const pt = mmSvgPoint(svg, fakeEv);
    const newK = Math.max(0.25, Math.min(3.5, view.k * factor));
    const wx = (pt.x - view.tx) / view.k;
    const wy = (pt.y - view.ty) / view.k;
    view.tx = pt.x - wx * newK;
    view.ty = pt.y - wy * newK;
    view.k = newK;
    applyView();
    memMapSaveView(view);
  }
  $("memMapBtn")?.addEventListener("click", () => {
    const ov = $("memMapOverlay");
    if (!ov) return;
    ov.classList.add("open");
    renderMemoryMap();
  });
  $("memMapClose")?.addEventListener("click", () => $("memMapOverlay")?.classList.remove("open"));
  $("memMapOverlay")?.addEventListener("click", (e) => { if (e.target.id === "memMapOverlay") e.currentTarget.classList.remove("open"); });
  $("memMapZoomIn")?.addEventListener("click",  () => memMapZoom(1.2));
  $("memMapZoomOut")?.addEventListener("click", () => memMapZoom(1 / 1.2));
  $("memMapFit")?.addEventListener("click", () => {
    if (!_mmState) return;
    _mmState.fitView();
  });
  $("memMapReset")?.addEventListener("click", async () => {
    const ok = await themedConfirm("Reset all node positions back to the default radial layout?", "Memory map");
    if (!ok) return;
    try { localStorage.removeItem(MEM_MAP_POS_KEY); } catch {}
    renderMemoryMap();
  });

  // Clear all
  $("memClearBtn")?.addEventListener("click", async () => {
    const n = memLoad().length;
    if (!n) return;
    const ok = await themedConfirm(`Permanently delete all ${n} memories?\n\nThis can't be undone (export first if you want a backup).`, "Memory");
    if (!ok) return;
    memClear();
    renderMemoryPane();
  });

  // Memory depth — declared here so applyMemoryDepth() can assign it before buildOllamaMessages
  // Memory depth — declared here so applyMemoryDepth() can assign it before buildOllamaMessages.
  // parseInt with radix 10; guard against NaN (corrupted localStorage → use default 20).
  let HISTORY_LIMIT = (v => (Number.isFinite(v) && v >= 0 ? v : 20))(
    parseInt(localStorage.getItem('hashHistoryLimit') ?? '20', 10)
  );

  // Memory depth — sidebar + settings sliders stay in sync
  const historyDepthEl     = $("historyDepth"),     historyValEl     = $("historyVal");
  const historyDepthSideEl = $("historyDepthSide"), historyValSideEl = $("historyValSide");

  function applyMemoryDepth(val, source) {
    // Clamp: integer 0–40, NaN → 20
    val = Number.isFinite(val) && val >= 0 ? Math.min(40, Math.floor(val)) : 20;
    HISTORY_LIMIT = val;
    const label = val === 0 ? 'Off' : String(val);
    const pct   = (val / 40 * 100).toFixed(1) + '%';
    historyValEl.textContent      = label;
    historyValSideEl.textContent  = label;
    if (source !== 'settings') { historyDepthEl.value = val; }
    historyDepthEl.style.setProperty('--val', pct);       // settings slider uses --val
    if (source !== 'side')     { historyDepthSideEl.value = val; }
    historyDepthSideEl.style.setProperty('--fill', pct);  // sidebar slider uses --fill
    try { localStorage.setItem('hashHistoryLimit', String(val)); } catch {}
    updateContextIndicator();
  }

  // Initialize sliders from the already-parsed HISTORY_LIMIT (no second localStorage read)
  applyMemoryDepth(HISTORY_LIMIT, 'init');

  historyDepthEl.addEventListener("input", () =>
    applyMemoryDepth(parseInt(historyDepthEl.value, 10), 'settings'));

  historyDepthSideEl.addEventListener("input", () =>
    applyMemoryDepth(parseInt(historyDepthSideEl.value, 10), 'side'));

  // Scroll pinning
  let pinned = true;
  msgs.addEventListener("scroll", () => {
    const dist = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
    pinned = dist < 80;
  });

  function loadTemplates() {
    try {
      const raw = localStorage.getItem("hashui_templates");
      const parsed = raw ? JSON.parse(raw) : [];
      state.templates = Array.isArray(parsed) ? parsed.filter(t => t && typeof t === "object") : [];
    } catch { state.templates = []; }
    if (!state.templates.length) {
      state.templates = [
        { id: uid(), name: "Translate", body: "Translate this to {{language}}:\n\n{{text}}" },
        { id: uid(), name: "Summarize File", body: "Summarize the attached content for {{audience}}. Focus on {{focus}}." },
      ];
      saveTemplates();
    }
    state.activeTemplateId = state.templates[0]?.id || null;
  }

  function saveTemplates() {
    try { localStorage.setItem("hashui_templates", JSON.stringify(state.templates)); } catch {}
  }

  function templateVars(body) {
    return [...new Set((String(body || "").match(/{{\s*[\w.-]+\s*}}/g) || []).map(v => v.replace(/[{}]/g, "").trim()).filter(Boolean))];
  }

  function activeTemplate() {
    return state.templates.find(t => t.id === state.activeTemplateId) || state.templates[0] || null;
  }

  function renderTemplates() {
    if (!templateListEl) return;
    templateListEl.innerHTML = "";
    state.templates.forEach(t => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "template-item" + (t.id === state.activeTemplateId ? " active" : "");
      const vars = templateVars(t.body);
      b.innerHTML = `<div class="template-title">${escapeHtml(t.name || "Untitled")}</div><div class="template-vars">${vars.length ? vars.map(v => "{{" + escapeHtml(v) + "}}").join(" ") : "no variables"}</div>`;
      b.addEventListener("click", () => {
        state.activeTemplateId = t.id;
        templateNameEl.value = t.name || "";
        templateBodyEl.value = t.body || "";
        renderTemplates();
      });
      templateListEl.appendChild(b);
    });
    const t = activeTemplate();
    if (t && !templateNameEl.value && !templateBodyEl.value) {
      templateNameEl.value = t.name || "";
      templateBodyEl.value = t.body || "";
    }
  }

  function openTemplates() {
    loadTemplates();
    renderTemplates();
    templateOverlay.classList.add("open");
    templateNameEl.focus();
  }

  function closeTemplates() {
    templateOverlay.classList.remove("open");
  }

  async function fillTemplate(t) {
    if (!t) return "";
    let body = t.body || "";
    for (const key of templateVars(body)) {
      const val = await themedPrompt(key, "", "Template");
      if (val === null) return "";
      body = body.replace(new RegExp(`{{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*}}`, "g"), val);
    }
    return body;
  }

  function insertAtComposer(text, replace = false) {
    if (!text) return;
    if (replace) input.value = text;
    else input.value = input.value ? `${input.value.trimEnd()}\n\n${text}` : text;
    input.dispatchEvent(new Event("input"));
    input.focus();
  }

  loadTemplates();
  $("templateClose").addEventListener("click", closeTemplates);
  templateOverlay.addEventListener("click", (e) => { if (e.target === templateOverlay) closeTemplates(); });
  $("templateNew").addEventListener("click", () => {
    const t = { id: uid(), name: "New Template", body: "" };
    state.templates.unshift(t);
    state.activeTemplateId = t.id;
    templateNameEl.value = t.name;
    templateBodyEl.value = "";
    saveTemplates();
    renderTemplates();
    templateBodyEl.focus();
  });
  $("templateSave").addEventListener("click", () => {
    let t = activeTemplate();
    if (!t) {
      t = { id: uid(), name: "", body: "" };
      state.templates.unshift(t);
      state.activeTemplateId = t.id;
    }
    t.name = templateNameEl.value.trim() || "Untitled";
    t.body = templateBodyEl.value;
    saveTemplates();
    renderTemplates();
  });
  $("templateDelete").addEventListener("click", () => {
    const t = activeTemplate();
    if (!t) return;
    state.templates = state.templates.filter(x => x.id !== t.id);
    state.activeTemplateId = state.templates[0]?.id || null;
    saveTemplates();
    templateNameEl.value = activeTemplate()?.name || "";
    templateBodyEl.value = activeTemplate()?.body || "";
    renderTemplates();
  });
  $("templateUse").addEventListener("click", async () => {
    const t = activeTemplate();
    const text = await fillTemplate(t);
    if (text) {
      insertAtComposer(text);
      closeTemplates();
    }
  });

  const slashCommands = [
    { name: "/model", desc: "Focus the model picker", run: () => modelEl.focus() },
    { name: "/compare", desc: "Open side-by-side model comparison", run: () => setTab("split") },
    { name: "/clear", desc: "Start a new chat", run: () => newChat() },
    { name: "/system", desc: "Open system prompt settings", run: () => { openSettings(); systemEl.focus(); } },
    { name: "/export", desc: "Export conversation as Markdown", run: () => exportConversation("markdown") },
    { name: "/json", desc: "Export conversation as JSON", run: () => exportConversation("json") },
    { name: "/pdf", desc: "Export conversation as PDF", run: () => exportConversation("pdf") },
    { name: "/temp", desc: "Set temperature, e.g. /temp 0.3", run: (arg) => { const v = parseFloat(arg); if (Number.isFinite(v)) { tempEl.value = Math.max(0, Math.min(2, v)); tempVal.textContent = tempEl.value; updateRangeFill(); saveSettings(); } else tempEl.focus(); } },
    { name: "/privacy", desc: "Toggle local-only privacy mode", run: () => { privacyLocalEl.checked = !privacyLocalEl.checked; privacyLocalEl.dispatchEvent(new Event("change")); } },
    { name: "/inject", desc: "Toggle RAG and web context injection", run: () => { injectionEnabled = !injectionEnabled; applyInjectionState(); } },
    { name: "/templates", desc: "Open prompt template library", run: openTemplates },
    { name: "/template", desc: "Use a saved prompt template", run: async () => { const t = activeTemplate(); const text = await fillTemplate(t); if (text) insertAtComposer(text, true); } },
  ];

  function currentSlashQuery() {
    const val = input.value;
    if (!val.startsWith("/")) return null;
    return val.slice(1).trim().toLowerCase();
  }

  function filteredSlashCommands() {
    const q = currentSlashQuery();
    if (q == null) return [];
    const cmdPart = q.split(/\s+/)[0] || "";
    return slashCommands.filter(c => c.name.slice(1).includes(cmdPart)).slice(0, 8);
  }

  function closeSlashPalette() {
    state.slashOpen = false;
    slashPalette.classList.remove("open");
    slashPalette.setAttribute("aria-hidden", "true");
  }

  function renderSlashPalette() {
    const items = filteredSlashCommands();
    if (!items.length) { closeSlashPalette(); return; }
    state.slashOpen = true;
    state.slashIndex = Math.max(0, Math.min(state.slashIndex, items.length - 1));
    slashPalette.innerHTML = items.map((c, i) => `
      <button type="button" class="slash-item${i === state.slashIndex ? " active" : ""}" data-slash="${escapeHtml(c.name)}">
        <span class="slash-name">${escapeHtml(c.name)}</span>
        <span class="slash-desc">${escapeHtml(c.desc)}</span>
      </button>`).join("");
    const rect = input.getBoundingClientRect();
    slashPalette.style.left = `${Math.max(12, rect.left)}px`;
    slashPalette.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
    slashPalette.classList.add("open");
    slashPalette.setAttribute("aria-hidden", "false");
  }

  function runSlashCommand(commandName = null) {
    const items = filteredSlashCommands();
    const cmd = commandName ? slashCommands.find(c => c.name === commandName) : items[state.slashIndex];
    if (!cmd) return false;
    const raw = input.value.trim();
    const arg = raw.replace(/^\/\S+\s*/, "");
    input.value = "";
    closeSlashPalette();
    Promise.resolve(cmd.run(arg)).catch(err => {
      console.warn("[slash] command failed:", err);
      themedAlert(err?.message || String(err), "Command");
    });
    input.dispatchEvent(new Event("input"));
    return true;
  }

  slashPalette.addEventListener("click", (e) => {
    const b = e.target.closest("[data-slash]");
    if (!b) return;
    runSlashCommand(b.dataset.slash);
  });

  // Textarea auto-grow
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 240) + "px";
    if (state.editing && editPreview) {
      const compact = input.value.replace(/\s+/g, " ").trim();
      editPreview.textContent = compact ? compact.slice(0, 180) : "(empty message)";
    }
    updateContextIndicator();
    if (currentSlashQuery() != null) renderSlashPalette();
    else closeSlashPalette();
  });
  input.addEventListener("keydown", (e) => {
    if (state.slashOpen) {
      const items = filteredSlashCommands();
      if (e.key === "ArrowDown") { e.preventDefault(); state.slashIndex = (state.slashIndex + 1) % Math.max(1, items.length); renderSlashPalette(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); state.slashIndex = (state.slashIndex - 1 + Math.max(1, items.length)) % Math.max(1, items.length); renderSlashPalette(); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); runSlashCommand(); return; }
      if (e.key === "Escape") { e.preventDefault(); closeSlashPalette(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener("click", () => state.streaming ? abort() : send());
  $("newChatBtn")?.addEventListener("click", () => newChat());
  $("agentsNewChatBtn")?.addEventListener("click", () => newChat());

  // ── Preview button — show full payload that would be sent to the model ──
  const previewModal = $("previewModal");
  const previewBody  = $("previewBody");
  const previewMeta  = $("previewMeta");
  $("previewClose").addEventListener("click", () => previewModal.classList.remove("open"));
  previewModal.addEventListener("click", (e) => { if (e.target === previewModal) previewModal.classList.remove("open"); });

  let _previewPayload = null; // last built payload — for copy-JSON

  $("previewBtn").addEventListener("click", async () => {
    previewBody.innerHTML = `<div class="preview-loading">Building payload… fetching live context</div>`;
    previewMeta.textContent = "";
    _previewPayload = null;
    previewModal.classList.add("open");

    const text = input.value.trim();
    let toolContext = null;
    const activeAgent = getActiveAgent();
    const route = currentRoute(text, !!(state.pendingImages?.length || state.pendingFiles?.length));
    const routeDef = route?.route ? ROUTE_DEFS[route.route] : null;
    const routeSearchMode = routeDef?.useSearch === true || routeDef?.useSearch === "pubmed";

    try {
      if (activeAgent && activeAgent.tools?.length && routeSearchMode) {
        let searchQuery = null;
        if (rewriterEl?.value) searchQuery = await rewriteForSearch(text);
        toolContext = await runAgentTools(activeAgent, text, searchQuery);
      } else if (route?.route) {
        const def = routeDef;
        if (def?.useSearch === true) {
          const tav = await tavilySearch(text);
          if (tav && (tav.results.length || tav.answer)) {
            const parts = [];
            if (tav.answer) parts.push(tav.answer);
            if (tav.results.length) parts.push(tav.results.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n"));
            toolContext = `Sources:\n${parts.join("\n\n")}`;
          } else {
            const goog = await googleSearch(text);
            if (goog && goog.length) {
              toolContext = `Sources:\n` + goog.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n");
            }
          }
        }
      }
    } catch(e) { console.warn("Preview tool fetch failed:", e); }

    // SECURITY: never expose personal knowledge base in preview for cloud/external models
    const _previewIsExternal = modelEl.value.startsWith("cloud:") ||
      !!(route?.route && ROUTE_DEFS[route.route]?.backend === "nvidia");
    const ragChunks = _previewIsExternal ? [] : await queryRAGMerged(text);
    if (ragChunks.length) {
      const ragBlock = `Background:\n` + ragChunks.map((c,i)=>`${i+1}. ${c.title}: ${c.text}`).join("\n\n");
      toolContext = toolContext ? `${toolContext}\n\n${ragBlock}` : ragBlock;
    }

    // Build messages exactly as send() would: pending input must exist before
    // tool/RAG context is injected so context attaches to the current turn.
    const messages = buildOllamaMessages();
    const pendingContent = currentPendingModelContent();
    if (pendingContent || state.pendingImages.length) {
      const pendingEntry = {
        role: "user",
        content: pendingContent || "Describe what you see in this image.",
        _pending: true,
      };
      if (state.pendingImages.length) pendingEntry.images = state.pendingImages.map(i => i.base64);
      messages.push(pendingEntry);
    }
    if (toolContext) {
      const last = messages[messages.length - 1];
      if (last?.role === "user") last.content = `${toolContext}\n\nQuestion: ${last.content}`;
      else messages.splice(messages.length - 1, 0, { role: "system", content: toolContext });
    }

    _previewPayload = messages;

    // ── Stats ──
    const totalChars  = JSON.stringify(messages.map(m => ({ role: m.role, content: m.content }))).length;
    const estTokens   = Math.round(totalChars / 3.8);
    const historyMsgs = messages.filter(m => m.role !== "system" && !m._pending).length;
    const sysMsgs     = messages.filter(m => m.role === "system").length;
    const hasPreviewAttachments = messages.some(m => /\[ATTACHED FILES - use this content when answering\]/.test(m.content || ""));
    const numCtx      = hasPreviewAttachments ? 16384 : (HISTORY_LIMIT > 0 ? 8192 : 4096);

    previewMeta.textContent =
      `${messages.length} msg${messages.length !== 1 ? "s" : ""} · ~${estTokens.toLocaleString()} tokens`;

    // ── Render ──
    let turnCounter = 0;
    const parts = [];

    // Stats bar at top
    parts.push(`<div class="preview-stats">
      <span>Memory: <b>${HISTORY_LIMIT === 0 ? 'Off' : HISTORY_LIMIT + ' turns'}</b></span>
      <span>History: <b>${historyMsgs} msg${historyMsgs !== 1 ? 's' : ''}</b></span>
      <span>System: <b>${sysMsgs}</b></span>
      <span>~Tokens: <b>${estTokens.toLocaleString()}</b></span>
      <span>num_ctx: <b>${numCtx.toLocaleString()}</b></span>
      <span>Model: <b>${cloudModelLabel(modelEl.value) || '—'}</b></span>
    </div>`);

    messages.forEach((m, i) => {
      const isPending = !!m._pending;
      const hasImg    = m.images?.length;
      const imgNote   = hasImg ? `\n\n[+ ${m.images.length} image(s) attached]` : "";

      // Separator before the pending (current) message
      if (isPending && i > 0) {
        parts.push(`<div class="preview-sep">Sending now</div>`);
      }

      let roleDisplay, turnLabel;
      if (m.role === "system") {
        roleDisplay = i === 0 ? "System Prompt" : "Tool / RAG Context";
        turnLabel   = "";
      } else {
        turnCounter++;
        const which = isPending ? "pending" : `turn ${turnCounter}`;
        roleDisplay = m.role === "user"
          ? (isPending ? "You · Pending" : "You")
          : "AI";
        turnLabel   = which;
      }

      parts.push(`<div class="preview-msg role-${m.role}${isPending ? " preview-pending" : ""}">
        <div class="preview-role-label">
          <span>${roleDisplay}${hasImg ? " · 🖼" : ""}</span>
          <span class="preview-turn">${turnLabel}</span>
        </div>${escapeHtml(m.content)}${imgNote}</div>`);
    });

    previewBody.innerHTML = parts.join("");
  });

  $("previewCopy").addEventListener("click", () => {
    if (!_previewPayload) return;
    const clean = _previewPayload.map(({ _pending, ...m }) => m);
    const json = JSON.stringify(clean, null, 2);
    const done = () => {
      const btn = $("previewCopy");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy JSON"; }, 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(done).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = json; document.body.appendChild(ta);
      ta.select(); try { document.execCommand("copy"); done(); } catch {}
      document.body.removeChild(ta);
    }
  });

  $("refresh").addEventListener("click", loadModels);
  $("attachImg").addEventListener("click", () => imgInput.click());
  $("attachFile").addEventListener("click", () => txtInput.click());
  imgInput.addEventListener("change", (e) => handleImages(e.target.files));
  txtInput.addEventListener("change", (e) => handleFiles(e.target.files));

  // Drag-drop + paste
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imgs = files.filter(f => f.type.startsWith("image/"));
    const docs = files.filter(f => !f.type.startsWith("image/"));
    if (imgs.length) handleImages(imgs);
    if (docs.length) handleFiles(docs);
  });
  window.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgs = items.filter(it => it.type.startsWith("image/")).map(it => it.getAsFile()).filter(Boolean);
    if (imgs.length) handleImages(imgs);
  });

  async function handleImages(fileList) {
    for (const f of fileList) {
      const dataUrl = await compressImage(f, 1280, 0.82);
      const base64 = dataUrl.split(",")[1];
      state.pendingImages.push({ name: f.name, dataUrl, base64 });
    }
    renderPending(); imgInput.value = "";
  }

  // Resize + JPEG-compress an image file before sending to the vision model.
  // Full-resolution photos (3–8 MB) cause Ollama to hang; 1280px / 85% is
  // more than enough for OCR and visual Q&A at a fraction of the payload.
  function compressImage(file, maxPx, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else        { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); readAsDataURL(file).then(resolve); };
      img.src = url;
    });
  }
  // File uploads — previously any attached PDF was read via `f.text()` which
  // returned the raw binary stream (the garbled characters the user saw in
  // the chat). Now we route by MIME type:
  //   - PDFs     → pdf.js extracts real text, saved under `f.text`
  //   - text/*   → read as UTF-8 directly
  //   - images   → funneled into the image pipeline instead (ignored here)
  //   - anything else → a friendly "[binary file]" placeholder so the AI
  //                     doesn't choke on gibberish but the user still sees
  //                     the attachment chip.
  async function waitForPdfJs(timeoutMs = 6000) {
    if (window.pdfjsLib) return window.pdfjsLib;
    const started = Date.now();
    while (!window.pdfjsLib && Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    if (!window.pdfjsLib) throw new Error("pdf.js did not finish loading");
    return window.pdfjsLib;
  }

  async function extractPdfText(file) {
    const pdfjs = await waitForPdfJs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const chunks = [];
    const maxPages = Math.min(doc.numPages, 120); // hard cap so huge PDFs don't blow the prompt
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => ("str" in it ? it.str : "")).join(" ");
      chunks.push(`--- Page ${i} ---\n${pageText}`);
    }
    const trailing = doc.numPages > maxPages ? `\n\n[… ${doc.numPages - maxPages} more pages truncated …]` : "";
    const text = chunks.join("\n\n").trim();
    if (!text) {
      return {
        text: `[PDF attached: ${file.name} — no selectable text was found. This is probably a scanned/image-only PDF and needs OCR.]`,
        pages: doc.numPages,
        extracted: false,
      };
    }
    return { text: text + trailing, pages: doc.numPages, extracted: true };
  }

  function looksTextLike(file) {
    if (file.type.startsWith("text/")) return true;
    if (/\.(txt|md|markdown|csv|tsv|log|json|yml|yaml|xml|html|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|h|cpp|sh|toml|ini|env)$/i.test(file.name)) return true;
    return false;
  }

  function fileCharLabel(chars) {
    const n = Number(chars) || 0;
    if (!n) return "";
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k chars` : `${n} chars`;
  }

  function fileKindIcon(kind) {
    const k = kind || "file";
    if (k === "pdf") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 15h8"/><path d="M8 18h5"/><path d="M8 11h2"/></svg>`;
    }
    if (k === "binary") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>`;
  }

  function buildAttachedFileContext(files, maxChars = 28000) {
    if (!files?.length) return "";
    const perFileBudget = Math.max(1800, Math.floor(maxChars / files.length));
    const sections = files.map((f, i) => {
      const raw = String(f.text || "").trim() || "[No extracted text available for this attachment.]";
      const clipped = raw.length > perFileBudget;
      const text = clipped
        ? raw.slice(0, perFileBudget) + `\n\n[Attachment truncated for context: ${raw.length - perFileBudget} chars omitted.]`
        : raw;
      const meta = [
        `name: ${f.name || `attachment-${i + 1}`}`,
        `kind: ${f.kind || "file"}`,
        f.pages ? `pages: ${f.pages}` : "",
        `extracted_chars: ${raw.length}`,
        clipped ? `sent_chars: ${perFileBudget}` : "",
      ].filter(Boolean).join(", ");
      return `--- Attachment ${i + 1} (${meta}) ---\n${text}`;
    });
    return [
      "",
      "[ATTACHED FILES - use this content when answering]",
      "The user attached the following file text. Treat it as part of the current user message.",
      sections.join("\n\n"),
      "[END ATTACHED FILES]",
    ].join("\n");
  }

  async function handleFiles(fileList) {
    for (const f of fileList) {
      try {
        // Images shouldn't hit this path (the image input handles them), but
        // just in case someone drags one in: shuttle it to handleImages.
        if (f.type.startsWith("image/")) {
          await handleImages([f]);
          continue;
        }
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          try {
            const { text, pages, extracted } = await extractPdfText(f);
            state.pendingFiles.push({
              name: f.name, kind: "pdf", pages,
              chars: text.trim().length,
              extracted,
              text: text.slice(0, 400_000),
            });
            // Feed into knowledge base in 1200-char chunks
            for (let ci = 0; ci < Math.min(text.length, 12000); ci += 1200) {
              addToRAG(f.name, text.slice(ci, ci + 1200), `file:${f.name}:p${Math.floor(ci/1200)}`);
            }
          } catch (err) {
            console.warn("[pdf] extract failed:", err);
            state.pendingFiles.push({
              name: f.name, kind: "pdf",
              chars: 0,
              extracted: false,
              text: `[PDF attached: ${f.name} — text extraction failed: ${err.message}]`,
            });
          }
          continue;
        }
        if (looksTextLike(f)) {
          const text = await f.text();
          state.pendingFiles.push({
            name: f.name,
            kind: "text",
            chars: text.trim().length,
            extracted: true,
            text: text.slice(0, 200_000),
          });
          for (let ci = 0; ci < Math.min(text.length, 12000); ci += 1200) {
            addToRAG(f.name, text.slice(ci, ci + 1200), `file:${f.name}:c${Math.floor(ci/1200)}`);
          }
          continue;
        }
        // Unknown binary — don't send garbage to the model. Leave a note.
        state.pendingFiles.push({
          name: f.name, kind: "binary",
          chars: 0,
          extracted: false,
          text: `[Binary file attached: ${f.name} (${Math.round(f.size / 1024)} KB, type ${f.type || "unknown"}) — contents not sent to the model.]`,
        });
      } catch (err) {
        console.warn("[file] failed:", f.name, err);
      }
    }
    renderPending(); txtInput.value = "";
  }
  const readAsDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  function renderPending() {
    pending.innerHTML = "";
    state.pendingImages.forEach((img, i) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<img src="${img.dataUrl}"/><span>${escapeHtml(img.name)}</span><span class="x" data-i="${i}" data-kind="img">✕</span>`;
      pending.appendChild(chip);
    });
    state.pendingFiles.forEach((f, i) => {
      const chip = document.createElement("div");
      chip.className = "chip file";
      const extra = f.kind === "pdf" && f.pages ? ` · ${f.pages}p` : "";
      const chars = fileCharLabel(f.chars);
      chip.innerHTML = `<span>${fileKindIcon(f.kind)} ${escapeHtml(f.name)}${extra}${chars ? ` · ${chars}` : ""}</span><span class="x" data-i="${i}" data-kind="file">✕</span>`;
      pending.appendChild(chip);
    });
    pending.querySelectorAll(".x").forEach(el => {
      el.addEventListener("click", () => {
        const i = +el.dataset.i;
        if (el.dataset.kind === "img") state.pendingImages.splice(i, 1);
        else state.pendingFiles.splice(i, 1);
        renderPending();
      });
    });
    updateContextIndicator();
  }

  // ========= Cloud Models =========
  // Direct browser→API calls (no proxy, no server).
  // Keys live only in localStorage and are sent exclusively to their
  // respective API endpoints over HTTPS. Nothing is ever forwarded to a
  // third party or stored server-side.

  // Fallback lists used when the provider's /models endpoint can't be reached
  // (no key entered, network error, CORS). The live fetcher populates the full
  // catalog whenever a key is present and replaces these.
  // Each entry has: value (cloud:provider:modelId), label (full, with provider
  // suffix for use in compare/workbench), shortLabel (compact, for dropdown options).
  const CLOUD_FALLBACK = {
    // Groq — free, ultra-fast inference. IDs are the raw model slugs from console.groq.com/docs/models
    groq: [
      { value: "cloud:groq:openai/gpt-oss-120b",           label: "GPT OSS 120B · Groq",            shortLabel: "GPT OSS 120B" },
      { value: "cloud:groq:openai/gpt-oss-20b",            label: "GPT OSS 20B · Groq",             shortLabel: "GPT OSS 20B (fast)" },
      { value: "cloud:groq:llama-3.3-70b-versatile",       label: "Llama 3.3 70B · Groq",           shortLabel: "Llama 3.3 70B" },
      { value: "cloud:groq:deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B · Groq", shortLabel: "DeepSeek R1 Distill 70B" },
      { value: "cloud:groq:qwen-qwq-32b",                  label: "Qwen QwQ 32B · Groq",            shortLabel: "Qwen QwQ 32B" },
      { value: "cloud:groq:llama-3.1-8b-instant",          label: "Llama 3.1 8B · Groq",            shortLabel: "Llama 3.1 8B (fast)" },
    ],
    // Gemini — generous free tier. Stable non-preview model IDs only.
    gemini: [
      { value: "cloud:gemini:gemini-2.5-flash",                          label: "Gemini 2.5 Flash · Google",     shortLabel: "Gemini 2.5 Flash" },
      { value: "cloud:gemini:gemini-2.5-pro",                            label: "Gemini 2.5 Pro · Google",       shortLabel: "Gemini 2.5 Pro" },
      { value: "cloud:gemini:gemini-2.0-flash",                          label: "Gemini 2.0 Flash · Google",     shortLabel: "Gemini 2.0 Flash" },
      { value: "cloud:gemini:gemini-2.0-flash-lite",                     label: "Gemini 2.0 Flash Lite · Google",shortLabel: "Gemini 2.0 Flash Lite (fast)" },
      { value: "cloud:gemini:gemini-2.0-flash-preview-image-generation", label: "Gemini Image Gen · Google",     shortLabel: "Gemini Image Gen ✦", imageGen: true },
    ],
    // OpenRouter — only confirmed :free models with provider/model format
    openrouter: [
      { value: "cloud:openrouter:openai/gpt-oss-120b:free",                        label: "GPT OSS 120B (free) · OpenRouter",         shortLabel: "GPT OSS 120B (free)" },
      { value: "cloud:openrouter:openai/gpt-oss-20b:free",                         label: "GPT OSS 20B (free) · OpenRouter",           shortLabel: "GPT OSS 20B (free)" },
      { value: "cloud:openrouter:deepseek/deepseek-r1:free",                       label: "DeepSeek R1 (free) · OpenRouter",           shortLabel: "DeepSeek R1 (free)" },
      { value: "cloud:openrouter:meta-llama/llama-3.3-70b-instruct:free",          label: "Llama 3.3 70B (free) · OpenRouter",         shortLabel: "Llama 3.3 70B (free)" },
      { value: "cloud:openrouter:meta-llama/llama-4-maverick:free",                label: "Llama 4 Maverick (free) · OpenRouter",      shortLabel: "Llama 4 Maverick (free)" },
      { value: "cloud:openrouter:google/gemma-4-31b-it:free",                      label: "Gemma 4 31B (free) · OpenRouter",           shortLabel: "Gemma 4 31B (free)" },
      { value: "cloud:openrouter:qwen/qwen3-30b-a3b:free",                         label: "Qwen3 30B (free) · OpenRouter",             shortLabel: "Qwen3 30B (free)" },
      { value: "cloud:openrouter:nousresearch/hermes-3-llama-3.1-405b:free",       label: "Hermes 3 405B (free) · OpenRouter",         shortLabel: "Hermes 3 405B (free)" },
    ],
    // Cerebras — confirmed stable model IDs from cerebras.ai/models
    cerebras: [
      { value: "cloud:cerebras:llama-3.3-70b", label: "Llama 3.3 70B · Cerebras",  shortLabel: "Llama 3.3 70B" },
      { value: "cloud:cerebras:llama3.1-8b",   label: "Llama 3.1 8B · Cerebras",   shortLabel: "Llama 3.1 8B (fast)" },
    ],
    // SambaNova — free mega-scale inference. IDs are PascalCase as shown in cloud.sambanova.ai
    samba: [
      { value: "cloud:samba:Llama-4-Maverick-17B-128E-Instruct", label: "Llama 4 Maverick 17B · SambaNova", shortLabel: "Llama 4 Maverick 17B" },
      { value: "cloud:samba:Meta-Llama-3.1-405B-Instruct",       label: "Llama 3.1 405B · SambaNova",      shortLabel: "Llama 3.1 405B" },
      { value: "cloud:samba:Meta-Llama-3.3-70B-Instruct",        label: "Llama 3.3 70B · SambaNova",       shortLabel: "Llama 3.3 70B" },
      { value: "cloud:samba:QwQ-32B",                            label: "Qwen QwQ 32B · SambaNova",        shortLabel: "Qwen QwQ 32B" },
      { value: "cloud:samba:DeepSeek-R1",                        label: "DeepSeek R1 · SambaNova",         shortLabel: "DeepSeek R1" },
      { value: "cloud:samba:DeepSeek-V3-0324",                   label: "DeepSeek V3 · SambaNova",         shortLabel: "DeepSeek V3" },
    ],
    // OpenAI — paid, frontier models
    openai: [
      { value: "cloud:openai:gpt-4o",            label: "GPT-4o · OpenAI",            shortLabel: "GPT-4o" },
      { value: "cloud:openai:gpt-4o-mini",       label: "GPT-4o Mini · OpenAI",       shortLabel: "GPT-4o Mini" },
      { value: "cloud:openai:gpt-4-turbo",       label: "GPT-4 Turbo · OpenAI",       shortLabel: "GPT-4 Turbo" },
      { value: "cloud:openai:o3-mini",           label: "o3 Mini · OpenAI",           shortLabel: "o3 Mini" },
    ],
    // Anthropic Claude — paid, strong reasoning
    anthropic: [
      { value: "cloud:anthropic:claude-sonnet-4-20250514", label: "Claude Sonnet 4 · Anthropic", shortLabel: "Claude Sonnet 4" },
      { value: "cloud:anthropic:claude-opus-4-20250514",   label: "Claude Opus 4 · Anthropic",   shortLabel: "Claude Opus 4" },
      { value: "cloud:anthropic:claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet · Anthropic", shortLabel: "Claude 3.5 Sonnet" },
    ],
    // Moonshot AI (Kimi) — OpenAI-compatible API. The live /models call replaces
    // this list whenever a key is available; keep the fallback on current public IDs.
    moonshot: [
      { value: "cloud:moonshot:kimi-k2.6",                 label: "Kimi K2.6 · Moonshot",              shortLabel: "Kimi K2.6" },
      { value: "cloud:moonshot:kimi-k2.5",                 label: "Kimi K2.5 · Moonshot",              shortLabel: "Kimi K2.5" },
      { value: "cloud:moonshot:kimi-k2-thinking-turbo",    label: "Kimi K2 Thinking Turbo · Moonshot", shortLabel: "Kimi K2 Thinking Turbo" },
      { value: "cloud:moonshot:kimi-k2-thinking",          label: "Kimi K2 Thinking · Moonshot",       shortLabel: "Kimi K2 Thinking" },
      { value: "cloud:moonshot:kimi-k2-turbo-preview",     label: "Kimi K2 Turbo Preview · Moonshot",  shortLabel: "Kimi K2 Turbo" },
      { value: "cloud:moonshot:kimi-k2-0905-preview",      label: "Kimi K2 0905 Preview · Moonshot",   shortLabel: "Kimi K2 0905" },
      { value: "cloud:moonshot:moonshot-v1-128k",          label: "Moonshot v1 128K · Kimi",           shortLabel: "Kimi 128K" },
      { value: "cloud:moonshot:moonshot-v1-32k",           label: "Moonshot v1 32K · Kimi",            shortLabel: "Kimi 32K" },
      { value: "cloud:moonshot:moonshot-v1-8k",            label: "Moonshot v1 8K · Kimi",             shortLabel: "Kimi 8K" },
    ],
    // DeepSeek — strong reasoning, cheap
    deepseek: [
      { value: "cloud:deepseek:deepseek-chat",     label: "DeepSeek V3 · DeepSeek",     shortLabel: "DeepSeek V3" },
      { value: "cloud:deepseek:deepseek-reasoner", label: "DeepSeek R1 · DeepSeek",     shortLabel: "DeepSeek R1" },
    ],
    // Mistral AI — European provider, strong coding
    mistral: [
      { value: "cloud:mistral:mistral-large-latest", label: "Mistral Large · Mistral", shortLabel: "Mistral Large" },
      { value: "cloud:mistral:codestral-latest",     label: "Codestral · Mistral",     shortLabel: "Codestral" },
      { value: "cloud:mistral:mistral-medium-latest", label: "Mistral Medium · Mistral", shortLabel: "Mistral Medium" },
    ],
  };

  // In-memory cache of fetched model lists (cleared on reload).
  // Keyed by provider; invalidated when the API key changes.
  const _cloudModelCache      = { groq: null, gemini: null, openrouter: null, cerebras: null, samba: null, openai: null, anthropic: null, moonshot: null, deepseek: null, mistral: null };
  const _cloudModelKeyAtFetch = { groq: "",   gemini: "",   openrouter: "",   cerebras: "",   samba: "",   openai: "",   anthropic: "",   moonshot: "",   deepseek: "",   mistral: "" };
  const _cloudFetchInflight   = { groq: null, gemini: null, openrouter: null, cerebras: null, samba: null, openai: null, anthropic: null, moonshot: null, deepseek: null, mistral: null };
  let _cloudModelsFetchedOnce = false;

  // Pretty-print a raw model id into a label.
  // "llama-3.3-70b-versatile"  → "Llama 3.3 70B Versatile"
  // "openai/gpt-oss-120b:free" → "GPT OSS 120B (free)" with provider suffix added later
  function prettifyModelId(id) {
    if (!id) return "";
    let core = id.split("/").pop().replace(/:free$/i, "");

    // Replace separators — but protect digit.digit (version numbers like 3.1, 2.5)
    core = core
      .replace(/[-_]/g, " ")
      .replace(/(\d)\.(\d)/g, "$1\x00$2")   // shield "3.1", "2.5" etc.
      .replace(/\./g, " ")
      .replace(/\x00/g, ".")                  // restore shielded dots
      .replace(/\s+/g, " ").trim();

    // Token-level casing
    const ALWAYS_UPPER = new Set(["gpt", "oss", "llm", "api", "rag", "sql"]);
    const CUSTOM_CASE  = { deepseek: "DeepSeek", qwq: "QwQ", llava: "LLaVA", nvidia: "NVIDIA" };

    core = core.split(" ").filter(Boolean).map(tok => {
      const lo = tok.toLowerCase();
      if (CUSTOM_CASE[lo])  return CUSTOM_CASE[lo];
      if (ALWAYS_UPPER.has(lo)) return tok.toUpperCase();
      // Parameter-count suffix: "8b" → "8B", "70b" → "70B", "405b" → "405B"
      if (/^\d+(\.\d+)?[bkmtBKMT]$/i.test(tok))
        return tok.slice(0, -1) + tok.slice(-1).toUpperCase();
      // MoE spec like "a22b" → "A22B"
      if (/^[a-zA-Z]\d+[bkmtBKMT]$/i.test(tok))
        return tok.charAt(0).toUpperCase() + tok.slice(1, -1) + tok.slice(-1).toUpperCase();
      // Pure number or version number → keep as-is
      if (/^[\d.]+$/.test(tok)) return tok;
      // Default title case
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    }).join(" ");

    return /:free$/i.test(id.split("/").pop()) ? `${core} (free)` : core;
  }

  function isExcludedCloudModel(model) {
    const haystack = [
      model?.value,
      model?.id,
      model?.name,
      model?.label,
      model?.shortLabel,
    ].filter(Boolean).join(" ").toLowerCase();
    return /baidu|qianfan|cobuddy/.test(haystack);
  }

  function visibleCloudModels(models) {
    return (models || []).filter(m => !isExcludedCloudModel(m));
  }

  function sortMoonshotModelIds(ids) {
    const preferred = [
      "kimi-k2.6",
      "kimi-k2.5",
      "kimi-k2-thinking-turbo",
      "kimi-k2-thinking",
      "kimi-k2-turbo-preview",
      "kimi-k2-0905-preview",
      "kimi-k2-0711-preview",
      "moonshot-v1-128k",
      "moonshot-v1-32k",
      "moonshot-v1-8k",
    ];
    return (ids || []).slice().sort((a, b) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      const ar = ai === -1 ? 999 : ai;
      const br = bi === -1 ? 999 : bi;
      return ar - br || String(a).localeCompare(String(b));
    });
  }

  async function fetchGroqModels(apiKey) {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Groq /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .filter(m => m.active !== false && (m.object === "model" || !m.object))
      .map(m => m.id)
      .filter(id => !/whisper|tts|guard|embed|orpheus|allam|speech|safeguard|prompt-guard|compound/i.test(id))
      .sort();
    return list.map(id => ({
      value: `cloud:groq:${id}`,
      label: `${prettifyModelId(id)} · Groq`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchGeminiModels(apiKey) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!r.ok) throw new Error(`Gemini /models ${r.status}`);
    const j = await r.json();
    // Only Gemini 2.x models are on the free tier; 1.x is deprecated.
    // Exclude non-chat models. Preserve imageGen flag for image-generation variants.
    const ids = (j.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) &&
                   m.supportedGenerationMethods.includes("generateContent"))
      .map(m => String(m.name || "").replace(/^models\//, ""))
      .filter(id => id &&
        /^gemini-2\./i.test(id) &&
        !/embedding|aqa|tts|deep-research|veo|learnlm|exp-/i.test(id))
      .sort();
    // Text models first, image-gen models last
    const textIds  = ids.filter(id => !/image-generation/i.test(id));
    const imageIds = ids.filter(id => /image-generation/i.test(id));
    return [
      ...textIds.map(id => ({
        value: `cloud:gemini:${id}`,
        label: `${prettifyModelId(id)} · Google`,
        shortLabel: prettifyModelId(id),
      })),
      ...imageIds.map(id => ({
        value: `cloud:gemini:${id}`,
        label: `${prettifyModelId(id)} · Google`,
        shortLabel: `${prettifyModelId(id)} ✦`,
        imageGen: true,
      })),
    ];
  }

  async function fetchOpenRouterModels(apiKey) {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch("https://openrouter.ai/api/v1/models", { headers });
    if (!r.ok) throw new Error(`OpenRouter /models ${r.status}`);
    const j = await r.json();
    const isFree = (m) => /:free$/i.test(String(m.id || ""));
    const list = (j.data || [])
      .filter(isFree)
      .map(m => ({ id: m.id, name: m.name || m.id }))
      .filter(m => m.id.includes("/") && !/embedding|moderation|rerank|ocr|tts|whisper|venice|thudm\/glm|glm-z/i.test(m.id))
      .filter(m => !isExcludedCloudModel(m))
      .sort((a, b) => a.id.localeCompare(b.id));
    return list.map(m => ({
      value: `cloud:openrouter:${m.id}`,
      label: `${m.name.replace(/\s*\(free\)\s*$/i, "")} (free) · OpenRouter`,
      shortLabel: `${m.name.replace(/\s*\(free\)\s*$/i, "")} (free)`,
    }));
  }

  async function fetchCerebrasModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.cerebras;
    const r = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Cerebras /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|guard|tts|whisper|vision|glm|zai/i.test(id))
      .sort();
    if (!list.length) return CLOUD_FALLBACK.cerebras;
    return list.map(id => ({
      value: `cloud:cerebras:${id}`,
      label: `${prettifyModelId(id)} · Cerebras`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchSambaModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.samba;
    const r = await fetch("https://api.sambanova.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`SambaNova /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|guard|tts|audio/i.test(id))
      .sort();
    if (!list.length) return CLOUD_FALLBACK.samba;
    return list.map(id => ({
      value: `cloud:samba:${id}`,
      label: `${prettifyModelId(id)} · SambaNova`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchOpenAIModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.openai;
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`OpenAI /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && /^gpt-|^[oO][0-9]/.test(id) && !/embedding|tts|whisper|dall|moderation|instruct/i.test(id))
      .sort();
    if (!list.length) return CLOUD_FALLBACK.openai;
    return list.map(id => ({
      value: `cloud:openai:${id}`,
      label: `${prettifyModelId(id)} · OpenAI`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchAnthropicModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.anthropic;
    // Anthropic does not expose a public /models endpoint as of mid-2025.
    // We return the fallback list; users can still enter custom model IDs manually.
    return CLOUD_FALLBACK.anthropic;
  }

  async function fetchMoonshotModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.moonshot;
    const { res } = await fetchMoonshotApi("/models", apiKey, () => ({
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    }));
    const j = await res.json();
    const list = sortMoonshotModelIds((j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|tts|image/i.test(id))
    );
    if (!list.length) return CLOUD_FALLBACK.moonshot;
    return list.map(id => ({
      value: `cloud:moonshot:${id}`,
      label: `${prettifyModelId(id)} · Kimi`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchDeepSeekModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.deepseek;
    const r = await fetch("https://api.deepseek.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`DeepSeek /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|image/i.test(id))
      .sort();
    if (!list.length) return CLOUD_FALLBACK.deepseek;
    return list.map(id => ({
      value: `cloud:deepseek:${id}`,
      label: `${prettifyModelId(id)} · DeepSeek`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchMistralModels(apiKey) {
    if (!apiKey) return CLOUD_FALLBACK.mistral;
    const r = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Mistral /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embed/i.test(id))
      .sort();
    if (!list.length) return CLOUD_FALLBACK.mistral;
    return list.map(id => ({
      value: `cloud:mistral:${id}`,
      label: `${prettifyModelId(id)} · Mistral`,
      shortLabel: prettifyModelId(id),
    }));
  }

  const CLOUD_FETCHERS = {
    groq: fetchGroqModels,
    gemini: fetchGeminiModels,
    openrouter: fetchOpenRouterModels,
    cerebras: fetchCerebrasModels,
    samba: fetchSambaModels,
    openai: fetchOpenAIModels,
    anthropic: fetchAnthropicModels,
    moonshot: fetchMoonshotModels,
    deepseek: fetchDeepSeekModels,
    mistral: fetchMistralModels,
  };

  // Load + cache the live model list for one provider. Returns the fallback
  // list on any error so the UI never shows an empty cloud group.
  async function loadCloudModelsFor(provider, keyEl) {
    const apiKey = (keyEl?.value || "").trim();
    // OpenRouter doesn't strictly require a key for /models; everything else does.
    if (!apiKey && provider !== "openrouter") {
      return CLOUD_FALLBACK[provider] || [];
    }
    if (_cloudModelCache[provider] && _cloudModelKeyAtFetch[provider] === apiKey) {
      return _cloudModelCache[provider];
    }
    if (_cloudFetchInflight[provider]) return _cloudFetchInflight[provider];
    const fetcher = CLOUD_FETCHERS[provider];
    if (!fetcher) return CLOUD_FALLBACK[provider] || [];
    const p = (async () => {
      try {
        const models = visibleCloudModels(await fetcher(apiKey));
        if (Array.isArray(models) && models.length) {
          _cloudModelCache[provider] = models;
          _cloudModelKeyAtFetch[provider] = apiKey;
          return models;
        }
        return CLOUD_FALLBACK[provider] || [];
      } catch (err) {
        console.warn(`[cloud] ${provider} fetch failed:`, err);
        return CLOUD_FALLBACK[provider] || [];
      } finally {
        _cloudFetchInflight[provider] = null;
      }
    })();
    _cloudFetchInflight[provider] = p;
    return p;
  }

  const CLOUD_MODELS = [
    { group: "Groq  —  Free · Fast Inference",    keyEl: () => groqKeyEl,       provider: "groq",       models: CLOUD_FALLBACK.groq.slice() },
    { group: "Google Gemini  —  Free",            keyEl: () => geminiKeyEl,     provider: "gemini",     models: CLOUD_FALLBACK.gemini.slice() },
    { group: "OpenAI  —  Paid · Frontier",        keyEl: () => openaiKeyEl,     provider: "openai",     models: CLOUD_FALLBACK.openai.slice() },
    { group: "Anthropic Claude  —  Paid · Strong Reasoning", keyEl: () => anthropicKeyEl, provider: "anthropic", models: CLOUD_FALLBACK.anthropic.slice() },
    { group: "Moonshot (Kimi)  —  Paid · 256K Context", keyEl: () => moonshotKeyEl, provider: "moonshot", models: CLOUD_FALLBACK.moonshot.slice() },
    { group: "DeepSeek  —  Paid · Reasoning",     keyEl: () => deepseekKeyEl,   provider: "deepseek",   models: CLOUD_FALLBACK.deepseek.slice() },
    { group: "Mistral AI  —  Paid · European",    keyEl: () => mistralKeyEl,    provider: "mistral",    models: CLOUD_FALLBACK.mistral.slice() },
    { group: "Cerebras  —  Free · Ultra-Fast",    keyEl: () => cerebrasKeyEl,   provider: "cerebras",   models: CLOUD_FALLBACK.cerebras.slice() },
    { group: "SambaNova  —  Free · Mega-Scale",   keyEl: () => sambaKeyEl,      provider: "samba",      models: CLOUD_FALLBACK.samba.slice() },
    { group: "OpenRouter  —  Free Models",        keyEl: () => openRouterKeyEl, provider: "openrouter", models: CLOUD_FALLBACK.openrouter.slice() },
  ];

  // Parse "cloud:provider:modelId" — modelId may contain colons (OpenRouter paths).
  // Guards against malformed values: returns empty strings instead of undefined.
  function parseCloudModel(val) {
    if (!val || !val.startsWith("cloud:")) return { provider: "", modelId: "" };
    const parts = val.split(":");
    return { provider: parts[1] || "", modelId: parts.slice(2).join(":") };
  }

  // True when the selected cloud model generates images instead of text.
  function isImageGenModel(val) {
    if (!val) return false;
    for (const grp of CLOUD_MODELS) {
      const m = grp.models.find(x => x.value === val);
      if (m) return !!m.imageGen;
    }
    return false;
  }

  function seedSavedModelDropdown() {
    const savedModel = SAVED.model || "";
    if (!savedModel || isExcludedCloudModel({ value: savedModel, label: savedModel, shortLabel: savedModel })) {
      modelEl.innerHTML = `<option value="" disabled selected>Loading models…</option>`;
      setActiveSub("");
      return;
    }
    modelEl.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = savedModel;
    opt.textContent = cloudModelLabel(savedModel) || savedModel;
    modelEl.appendChild(opt);
    modelEl.value = savedModel;
    setActiveSub(savedModel);
    populateCloudModels();
  }

  // Return a human-readable label for a model value (cloud or local)
  function cloudModelLabel(val) {
    if (!val) return "";
    if (isExcludedCloudModel({ value: val, label: val, shortLabel: val })) return "";
    if (!val.startsWith("cloud:")) return val;
    for (const grp of CLOUD_MODELS) {
      const m = grp.models.find(x => x.value === val);
      if (m) return m.label;
    }
    const { provider, modelId } = parseCloudModel(val);
    return `${modelId} · ${provider}`;
  }

  // ── Model tier system for quality-aware failover ────────────────
  const MODEL_TIER = {
    frontier: 300, // GPT-4o, Claude 4, Gemini 2.5 Pro, Kimi K1.5, DeepSeek-V3, Llama-4-Maverick, 405B+
    strong:   200, // GPT-4, Claude 3.5, Gemini Pro, 120B–235B, Qwen3-235B
    capable:  100, // 70B class: Llama-3.3, Qwen3-72B, Nemotron-70B
    moderate:  50, // 32B–40B: DeepSeek-R1-Distill, Qwen2.5-32B
    small:      0, // < 32B: flash, lite, mini, 8B, 3B
  };

  function getModelTier(value, label) {
    const s = `${value || ""} ${label || ""}`.toLowerCase();
    const sizeMatch = s.match(/(\d+)(?:\.\d+)?\s*([bkmt])/i);
    const sizeUnit = sizeMatch?.[2]?.toLowerCase();
    const sizeNum = sizeMatch ? (sizeUnit === 't' ? parseFloat(sizeMatch[1]) * 1000 : parseFloat(sizeMatch[1])) : 0;
    // Explicit tier detection by model family
    if (/gpt-4o|claude-4|gemini-2\.5-pro|kimi-k(?:1\.5|2(?:\.|-))|deepseek-v3|llama-4-maverick|405b|253b|235b|120b/i.test(s)) return MODEL_TIER.frontier;
    if (/gpt-4|claude-3\.5|gemini-pro|qwen3-235|120b|70b|maverick|nemotron-ultra/i.test(s)) return MODEL_TIER.strong;
    if (/70b|llama-3\.3|qwen3-72|nemotron-70/i.test(s)) return MODEL_TIER.capable;
    if (/32b|40b|deepseek-r1-distill|qwen2\.5-32/i.test(s)) return MODEL_TIER.moderate;
    if (/8b|7b|3b|mini|flash|lite|instant|small|tiny/i.test(s)) return MODEL_TIER.small;
    return sizeNum >= 120 ? MODEL_TIER.frontier : sizeNum >= 70 ? MODEL_TIER.capable : sizeNum >= 32 ? MODEL_TIER.moderate : MODEL_TIER.small;
  }

  // Build a flat list of all currently-available cloud models with their keys set.
  function getAvailableCloudModels() {
    const available = [];
    for (const grp of CLOUD_MODELS) {
      const key = (grp.keyEl().value || "").trim();
      if (!key) continue;
      for (const m of grp.models) {
        available.push({ ...m, provider: grp.provider, tier: getModelTier(m.value, m.label) });
      }
    }
    return available;
  }

  // Pick the best failover model when `currentModel` fails.
  // Prefers same or higher tier, then falls back one tier at a time.
  // Returns null if nothing usable is available.
  function getBestFailoverModel(currentModel, excludeSet = new Set()) {
    const currentTier = getModelTier(currentModel, cloudModelLabel(currentModel));
    const available = getAvailableCloudModels()
      .filter(m => !excludeSet.has(m.value) && m.value !== currentModel);
    if (!available.length) return null;

    // Sort by tier desc, then by whether provider is free-tier preferred
    const FREE_PREFERRED = { groq: 1, gemini: 1, cerebras: 1, samba: 1, openrouter: 1 };
    available.sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier;
      return (FREE_PREFERRED[b.provider] || 0) - (FREE_PREFERRED[a.provider] || 0);
    });

    // Try same tier or higher first
    const sameOrBetter = available.find(m => m.tier >= currentTier);
    if (sameOrBetter) return sameOrBetter;
    // Then one tier down
    const oneDown = available.find(m => m.tier >= currentTier - 50);
    if (oneDown) return oneDown;
    // Finally anything available
    return available[0];
  }

  function ollamaModelName(entry) {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return "";
    return entry.name || entry.model || entry.id || "";
  }

  function rememberLocalModels(names) {
    trackedLocalModels.clear();
    (names || []).forEach(name => {
      if (name && !String(name).startsWith("cloud:")) trackedLocalModels.add(String(name));
    });
  }

  function trackLocalModel(name) {
    if (name && !String(name).startsWith("cloud:")) trackedLocalModels.add(String(name));
  }

  function untrackLocalModel(name) {
    if (name) trackedLocalModels.delete(String(name));
  }

  function getTrackedLocalModels() {
    const names = Array.from(trackedLocalModels);
    const selected = modelEl.value || "";
    if (selected && !selected.startsWith("cloud:") && !names.includes(selected)) names.push(selected);
    return names;
  }

  async function fetchLoadedLocalModels(host, timeoutMs = 4000) {
    const r = await fetch(`${host}/api/ps`, { cache: "no-store", signal: makeSignal(timeoutMs) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const loaded = Array.isArray(data.models) ? data.models
                 : Array.isArray(data.processes) ? data.processes
                 : Array.isArray(data) ? data : [];
    const names = loaded.map(m => m.model || m.name).filter(Boolean);
    return { loaded, names };
  }

  async function unloadLocalModels(names, { keepalive = false } = {}) {
    const host = safeHost();
    const uniq = [...new Set((names || []).filter(name => name && !String(name).startsWith("cloud:")))];
    for (const modelName of uniq) {
      const payload = JSON.stringify({ model: modelName, keep_alive: 0 });
      if (keepalive) {
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(`${host}/api/generate`, new Blob([payload], { type: "application/json" }));
          } else {
            fetch(`${host}/api/generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              keepalive: true,
            }).catch(() => {});
          }
        } catch {}
        continue;
      }
      try {
        await fetch(`${host}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        untrackLocalModel(modelName);
      } catch {}
    }
  }

  function updateCloudModelVisualState() {
    const privacyOn = !!privacyLocalEl.checked;
    const hasCloudModels = !!modelEl.querySelector('optgroup[data-cloud]');
    sideModelWrap.classList.toggle("cloud-dim", privacyOn && hasCloudModels);
    modelEl.dataset.privacyLocal = privacyOn ? "1" : "0";

    modelEl.querySelectorAll('optgroup[data-cloud]').forEach(group => {
      const baseLabel = group.dataset.baseLabel || group.label || "Cloud Models";
      group.label = privacyOn ? `${baseLabel} [dimmed: privacy local-only]` : baseLabel;
      group.style.color = privacyOn ? "rgba(120, 180, 250, 0.46)" : "";
    });

    modelEl.querySelectorAll('option[data-cloud-option="1"]').forEach(opt => {
      if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent || opt.value;
      opt.textContent = privacyOn ? `   ${opt.dataset.baseLabel} · privacy locked` : opt.dataset.baseLabel;
      opt.style.color = privacyOn ? "rgba(120, 180, 250, 0.46)" : "";
      opt.disabled = false;
    });
  }

  // Rebuild the cloud optgroups in the model dropdown.
  // Called on page load (inside loadModels) and whenever a key changes.
  // Providers without an API key are hidden entirely (no optgroup shown).
  function populateCloudModels() {
    // Remove stale cloud optgroups first
    modelEl.querySelectorAll("optgroup[data-cloud]").forEach(g => g.remove());
    modelEl.querySelectorAll('option[data-separator="1"]').forEach(o => o.remove());
    const hasAnyCloudKey = CLOUD_MODELS.some(grp => !!(grp.keyEl().value || "").trim());
    if (hasAnyCloudKey) {
      const separator = document.createElement("option");
      separator.disabled = true;
      separator.value = "";
      separator.dataset.separator = "1";
      separator.textContent = "\u2500\u2500 Local models above \u2500\u2500 Cloud models below \u2500\u2500";
      modelEl.appendChild(separator);
    }
    CLOUD_MODELS.forEach(grp => {
      const hasKey = !!(grp.keyEl().value || "").trim();
      // Skip providers without a key entirely — clean dropdown, no clutter
      if (!hasKey) return;
      const group = document.createElement("optgroup");
      group.dataset.cloud = "1";
      group.dataset.provider = grp.provider;
      group.dataset.baseLabel = grp.group;
      group.dataset.missingKey = "0";
      group.label = grp.group;
      visibleCloudModels(grp.models).forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.dataset.cloudOption = "1";
        opt.dataset.baseLabel = m.shortLabel || m.label;
        opt.dataset.missingKey = "0";
        opt.textContent = m.shortLabel || m.label;
        group.appendChild(opt);
      });
      modelEl.appendChild(group);
    });
    updateCloudModelVisualState();
    syncCompareModelOptions();
    // Kick off live fetches only once on app boot.
    // Each provider only fetches if a key is present (or is keyless like OpenRouter).
    // Results are cached by key so repeat calls are cheap.
    if (!_cloudModelsFetchedOnce) {
      _cloudModelsFetchedOnce = true;
      refreshCloudModelsFromAPIs();
    }
  }

  // Rebuild one provider's optgroup in-place with live model data, preserving selection.
  function _replaceProviderOptgroup(grp) {
    const sel = modelEl.value;
    const hasKey = !!(grp.keyEl().value || "").trim();
    const existing = modelEl.querySelector(`optgroup[data-cloud][data-provider='${grp.provider}']`);
    // If key was removed, remove the optgroup entirely
    if (!hasKey) {
      if (existing) existing.remove();
      // Also remove separator if no cloud keys remain
      const hasAnyCloudKey = CLOUD_MODELS.some(g => !!(g.keyEl().value || "").trim());
      if (!hasAnyCloudKey) {
        modelEl.querySelectorAll('option[data-separator="1"]').forEach(o => o.remove());
      }
      if (sel && Array.from(modelEl.options).some(o => o.value === sel)) modelEl.value = sel;
      return;
    }
    // Key present — build/replace optgroup
    const newGrp = document.createElement("optgroup");
    newGrp.dataset.cloud = "1";
    newGrp.dataset.provider = grp.provider;
    newGrp.dataset.baseLabel = grp.group;
    newGrp.dataset.missingKey = "0";
    newGrp.label = grp.group;
    grp.models.forEach(m => {
      if (isExcludedCloudModel(m)) return;
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.dataset.cloudOption = "1";
      opt.dataset.baseLabel = m.shortLabel || m.label;
      opt.dataset.missingKey = "0";
      opt.textContent = m.shortLabel || m.label;
      newGrp.appendChild(opt);
    });
    // Ensure separator exists before first cloud group
    const hasAnyCloudKey = CLOUD_MODELS.some(g => !!(g.keyEl().value || "").trim());
    if (hasAnyCloudKey && !modelEl.querySelector('option[data-separator="1"]')) {
      const separator = document.createElement("option");
      separator.disabled = true;
      separator.value = "";
      separator.dataset.separator = "1";
      separator.textContent = "\u2500\u2500 Local models above \u2500\u2500 Cloud models below \u2500\u2500";
      // Insert before first cloud optgroup, or at end if none
      const firstCloud = modelEl.querySelector('optgroup[data-cloud]');
      if (firstCloud) modelEl.insertBefore(separator, firstCloud);
      else modelEl.appendChild(separator);
    }
    if (existing) existing.replaceWith(newGrp);
    else modelEl.appendChild(newGrp);
    if (sel && Array.from(modelEl.options).some(o => o.value === sel)) modelEl.value = sel;
  }

  // Fetch live model list for every provider that has a key (or is keyless like OpenRouter).
  // Safe to call repeatedly — loadCloudModelsFor caches by key and deduplicates inflight fetches.
  async function refreshCloudModelsFromAPIs() {
    await Promise.all(CLOUD_MODELS.map(async (grp) => {
      try {
        const live = await loadCloudModelsFor(grp.provider, grp.keyEl());
        if (!Array.isArray(live) || !live.length) return;
        const before = grp.models.map(m => m.value).join("|");
        const after  = live.map(m => m.value).join("|");
        if (before === after) return;
        grp.models = live;
        _replaceProviderOptgroup(grp);
      } catch (e) {
        console.warn(`[cloud] ${grp.provider} live fetch failed:`, e.message);
      }
    }));
    updateCloudModelVisualState();
    syncCompareModelOptions();
  }

  function syncCompareModelOptions() {
    if (!compareModelEl || !modelEl) return;
    const previous = compareModelEl.value || localStorage.getItem("hashui_compare_model") || "";
    compareModelEl.innerHTML = "";
    Array.from(modelEl.children).forEach(child => {
      compareModelEl.appendChild(child.cloneNode(true));
    });
    Array.from(compareModelEl.querySelectorAll("option")).forEach(opt => {
      if (opt.dataset.separator === "1") opt.remove();
      else if (opt.value === modelEl.value && Array.from(compareModelEl.options).some(o => o.value && o.value !== modelEl.value && !o.disabled)) {
        opt.disabled = true;
      }
    });
    const available = Array.from(compareModelEl.options).find(o => o.value && !o.disabled && o.value !== modelEl.value) ||
      Array.from(compareModelEl.options).find(o => o.value && !o.disabled);
    if (previous && Array.from(compareModelEl.options).some(o => o.value === previous && !o.disabled)) compareModelEl.value = previous;
    else if (available) compareModelEl.value = available.value;
  }

  function setCompareMode(on) {
    state.compareMode = !!on;
    compareBar?.classList.toggle("visible", state.compareMode);
    try { localStorage.setItem("hashui_compare_mode", state.compareMode ? "1" : "0"); } catch {}
    syncCompareModelOptions();
    input.focus();
  }

  // Shared SSE parser for OpenAI-compatible streams (Groq, OpenRouter)
  async function* parseOpenAISSE(body, onUsage) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    function parseLine(line) {
      const s = line.trim();
      if (!s.startsWith("data:")) return null;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") return null;
      try {
        const evt = JSON.parse(payload);
        // Final usage chunk (stream_options.include_usage) — real token counts.
        if (evt.usage && onUsage) {
          onUsage({ inputTokens: evt.usage.prompt_tokens || 0, outputTokens: evt.usage.completion_tokens || 0 });
        }
        return evt.choices?.[0]?.delta?.content || null;
      } catch {
        return null;
      }
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const delta = parseLine(line);
          if (delta) yield delta;
        }
      }
      const delta = parseLine(buf);
      if (delta) yield delta;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  // Route a streaming chat request to the right cloud API.
  // Images are stripped — all free cloud tiers are text-only.
  // Keys are read from the DOM (localStorage-backed) at call time, never cached.
  // Human-readable error messages for common cloud API HTTP status codes.
  // `retryAfter` is the value of the Retry-After header (seconds) when present.
  function cloudHttpError(provider, status, body, retryAfter) {
    const PROVIDER_LABELS = {
      groq: "Groq", gemini: "Google Gemini", openrouter: "OpenRouter",
      cerebras: "Cerebras", samba: "SambaNova",
      openai: "OpenAI", anthropic: "Anthropic", moonshot: "Moonshot (Kimi)",
      deepseek: "DeepSeek", mistral: "Mistral AI",
    };
    const providerLabel = PROVIDER_LABELS[provider] || provider;
    const hints = {
      groq:        { key: "console.groq.com → API Keys",            quota: "console.groq.com → Usage" },
      gemini:      { key: "aistudio.google.com → Get API key",      quota: "ai.google.dev/gemini-api/docs/quota" },
      openrouter:  { key: "openrouter.ai → Keys",                   quota: "openrouter.ai/activity" },
      cerebras:    { key: "cloud.cerebras.ai → API Keys (free)",    quota: "cloud.cerebras.ai → Usage" },
      samba:       { key: "cloud.sambanova.ai → API Keys (free)",   quota: "cloud.sambanova.ai → Usage" },
      openai:      { key: "platform.openai.com → API Keys",         quota: "platform.openai.com/usage" },
      anthropic:   { key: "console.anthropic.com → API Keys",       quota: "console.anthropic.com/settings/plans" },
      moonshot:    { key: "platform.kimi.ai or platform.kimi.com → API Keys", quota: "platform.kimi.ai / platform.kimi.com" },
      deepseek:    { key: "platform.deepseek.com → API Keys",       quota: "platform.deepseek.com" },
      mistral:     { key: "console.mistral.ai → API Keys",          quota: "console.mistral.ai" },
    }[provider] || { key: "provider dashboard", quota: "provider dashboard" };
    if (status === 429) {
      const wait = retryAfter ? ` Try again in ${retryAfter}s.` : " Wait ~60s and try again, or switch to a different model.";
      return `${providerLabel} rate limit — free-tier quota exceeded (failed requests count too).${wait}\nCheck usage: ${hints.quota}`;
    }
    if (status === 401 || status === 403) {
      const serverDetail = (body || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const detailLine = serverDetail ? `\nServer said: ${serverDetail}` : "";
      return `${providerLabel} rejected the API key (HTTP ${status}). Check it was generated on the matching platform — ${hints.key} — and that API access is enabled on your project.${detailLine}`;
    }
    if (status === 404) {
      return `${providerLabel} model not found.\nThe model may have been renamed or retired.`;
    }
    if (status === 503 || status === 529) {
      return `${providerLabel} is overloaded right now. Try again in a few seconds.`;
    }
    if (status >= 500) {
      return `${providerLabel} server error (${status}). Try again shortly.`;
    }
    const detail = (body || "").slice(0, 120);
    return `${providerLabel} error ${status}${detail ? ": " + detail : ""}`;
  }

  // Image generation via Gemini (Nano Banana = gemini-3.1-flash-image-preview).
  // Non-streaming — returns { text, images: ["data:image/png;base64,..."] }.
  // The response modality is TEXT + IMAGE so any caption/description text is
  // also returned alongside the generated image.
  async function generateCloudImage(modelId, messages, signal) {
    const key = (geminiKeyEl.value || "").trim();
    if (!key) throw new Error("Google AI Studio key missing.\nAdd it in Settings → Cloud Models — free at aistudio.google.com");
    const textMessages = messages.map(m => ({ role: m.role, content: m.content || "" }));
    const systemMsg = textMessages.find(m => m.role === "system");
    const geminiContents = textMessages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user",
                   parts: [{ text: m.content }] }));
    const body = {
      contents: geminiContents,
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`,
      { method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const retry = res.headers.get("Retry-After");
      throw new Error(cloudHttpError("gemini", res.status, txt, retry));
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    let text = "";
    const images = [];
    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.inlineData) {
        const mime = part.inlineData.mimeType || "image/png";
        images.push(`data:${mime};base64,${part.inlineData.data}`);
      }
    }
    if (!images.length) throw new Error("Gemini returned no image. Try rephrasing your prompt.");
    return { text: text.trim(), images };
  }

  // Convert Ollama-format messages (images: [base64...]) to OpenAI vision format.
  function toOpenAIVision(messages) {
    return messages.map(m => {
      if (!m.images?.length) return { role: m.role, content: m.content || "" };
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content || "Describe what you see." },
          ...m.images.map(b64 => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })),
        ],
      };
    });
  }

  async function streamCloudModel(provider, modelId, messages, temperature, onToken, signal) {
    const temp = typeof temperature === "number" ? temperature : 0.7;
    // Text-only fallback (for providers that don't support vision)
    const textMessages = messages.map(m => ({ role: m.role, content: m.content || "" }));
    const hasImages = messages.some(m => m.images?.length);
    // Real token usage for this response, captured from each provider's final
    // stream chunk and logged once at the end for the HashMeter ecosystem.
    let captured = null;
    const onUsage = (u) => { captured = u; };

    if (provider === "groq") {
      const key = (groqKeyEl.value || "").trim();
      if (!key) throw new Error("Groq API key missing.\nAdd it in Settings → Cloud Models — free at console.groq.com");
      // Vision models accept image_url content blocks; text-only models get plain strings
      const groqMessages = (hasImages && /vision/i.test(modelId)) ? toOpenAIVision(messages) : textMessages;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: groqMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("groq", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else if (provider === "gemini") {
      const key = (geminiKeyEl.value || "").trim();
      if (!key) throw new Error("Google AI Studio key missing.\nAdd it in Settings → Cloud Models — free at aistudio.google.com");
      const systemMsg = messages.find(m => m.role === "system");
      // Build Gemini parts — supports both text and inlineData images
      const geminiContents = messages
        .filter(m => m.role !== "system")
        .map(m => {
          const parts = [];
          if (m.content) parts.push({ text: m.content });
          if (m.images?.length) m.images.forEach(b64 => parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } }));
          return { role: m.role === "assistant" ? "model" : "user", parts: parts.length ? parts : [{ text: "" }] };
        });
      const body = {
        contents: geminiContents,
        generationConfig: { temperature: temp },
        ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
        { method: "POST", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }
      );
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("gemini", res.status, txt, res.headers.get("Retry-After"))); }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
      const parseGeminiLine = (line) => {
        const s = line.trim(); if (!s.startsWith("data:")) return;
        const payload = s.slice(5).trim(); if (!payload) return;
        try {
          const evt = JSON.parse(payload);
          if (evt.usageMetadata) captured = { inputTokens: evt.usageMetadata.promptTokenCount || 0, outputTokens: evt.usageMetadata.candidatesTokenCount || 0 };
          // Collect text from all parts (Gemini can return multiple text parts)
          const parts = evt.candidates?.[0]?.content?.parts || [];
          parts.forEach(p => { if (p.text) onToken(p.text); });
        } catch {}
      };
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || ""; for (const line of lines) parseGeminiLine(line); }
        parseGeminiLine(buf);
      } finally { try { reader.releaseLock(); } catch {} }

    } else if (provider === "openrouter") {
      const key = (openRouterKeyEl.value || "").trim();
      if (!key) throw new Error("OpenRouter API key missing.\nAdd it in Settings → Cloud Models — free at openrouter.ai");
      // OpenRouter supports OpenAI vision format
      const orMessages = hasImages ? toOpenAIVision(messages) : textMessages;
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "HTTP-Referer": "hash-gpt://local", "X-Title": "HashCortx" },
        body: JSON.stringify({ model: modelId, messages: orMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("openrouter", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else if (provider === "cerebras") {
      const key = (cerebrasKeyEl.value || "").trim();
      if (!key) throw new Error("Cerebras API key missing.\nAdd it in Settings → Cloud Models — free at cloud.cerebras.ai");
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: textMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("cerebras", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else if (provider === "samba") {
      const key = (sambaKeyEl.value || "").trim();
      if (!key) throw new Error("SambaNova API key missing.\nAdd it in Settings → Cloud Models — free at cloud.sambanova.ai");
      const res = await fetch("https://api.sambanova.ai/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: textMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("samba", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else if (provider === "openai") {
      const key = (openaiKeyEl.value || "").trim();
      if (!key) throw new Error("OpenAI API key missing.\nAdd it in Settings → APIs");
      const oaMessages = hasImages ? toOpenAIVision(messages) : textMessages;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: oaMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("openai", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else if (provider === "anthropic") {
      const key = (anthropicKeyEl.value || "").trim();
      if (!key) throw new Error("Anthropic API key missing.\nAdd it in Settings → APIs");
      const systemMsg = messages.find(m => m.role === "system");
      const anthropicMessages = messages
        .filter(m => m.role !== "system")
        .map(m => {
          const content = [];
          if (m.content) content.push({ type: "text", text: m.content });
          if (m.images?.length) m.images.forEach(b64 => content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
          return { role: m.role, content: content.length ? content : [{ type: "text", text: "" }] };
        });
      const body = {
        model: modelId,
        messages: anthropicMessages,
        max_tokens: 4096,
        stream: true,
        ...(systemMsg ? { system: systemMsg.content } : {}),
      };
      if (typeof temperature === "number") body.temperature = temperature;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("anthropic", res.status, txt, res.headers.get("Retry-After"))); }
      // Anthropic SSE format is similar to OpenAI but uses event: content_block_delta
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
      const parseAnthropicLine = (line) => {
        const s = line.trim(); if (!s.startsWith("data:")) return;
        const payload = s.slice(5).trim(); if (!payload || payload === "[DONE]") return;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "message_start" && evt.message?.usage)
            captured = { inputTokens: evt.message.usage.input_tokens || 0, outputTokens: (captured && captured.outputTokens) || 0 };
          if (evt.type === "message_delta" && evt.usage && evt.usage.output_tokens != null)
            captured = { inputTokens: (captured && captured.inputTokens) || 0, outputTokens: evt.usage.output_tokens || 0 };
          if (evt.type === "content_block_delta" && evt.delta?.text) onToken(evt.delta.text);
        } catch {}
      };
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || ""; for (const line of lines) parseAnthropicLine(line); }
        parseAnthropicLine(buf);
      } finally { try { reader.releaseLock(); } catch {} }

    } else if (provider === "moonshot") {
      const key = (moonshotKeyEl.value || "").trim();
      if (!key) throw new Error("Moonshot API key missing.\nAdd it in Settings → APIs");

      // sk-ki keys are from the new Kimi for Code platform (kimi.com) — they only
      // accept the Anthropic-compatible protocol at api.moonshot.{ai,cn}/anthropic.
      if (isKimiCodeKey(key)) {
        const body = buildKimiAnthropicBody(modelId, textMessages, { temperature: temp, stream: true });
        const { res } = await fetchKimiAnthropic("/v1/messages", key, () => ({
          method: "POST", referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(body),
          signal,
        }));
        if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("moonshot", res.status, txt, res.headers.get("Retry-After"))); }
        const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
        const parseLine = (line) => {
          const s = line.trim(); if (!s.startsWith("data:")) return;
          const payload = s.slice(5).trim(); if (!payload || payload === "[DONE]") return;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "message_start" && evt.message?.usage)
              captured = { inputTokens: evt.message.usage.input_tokens || 0, outputTokens: (captured && captured.outputTokens) || 0 };
            if (evt.type === "message_delta" && evt.usage && evt.usage.output_tokens != null)
              captured = { inputTokens: (captured && captured.inputTokens) || 0, outputTokens: evt.usage.output_tokens || 0 };
            if (evt.type === "content_block_delta" && evt.delta?.text) onToken(evt.delta.text);
          } catch {}
        };
        try {
          while (true) { const { value, done } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || ""; for (const line of lines) parseLine(line); }
          parseLine(buf);
        } finally { try { reader.releaseLock(); } catch {} }
      } else {
        // Legacy sk-... keys from platform.moonshot.ai/.cn use OpenAI-compatible API
        const { res } = await fetchMoonshotApi("/chat/completions", key, () => ({
          method: "POST", referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: modelId, messages: textMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
          signal,
        }));
        if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("moonshot", res.status, txt, res.headers.get("Retry-After"))); }
        for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);
      }

    } else if (provider === "deepseek") {
      const key = (deepseekKeyEl.value || "").trim();
      if (!key) throw new Error("DeepSeek API key missing.\nAdd it in Settings → APIs");
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: textMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("deepseek", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else if (provider === "mistral") {
      const key = (mistralKeyEl.value || "").trim();
      if (!key) throw new Error("Mistral API key missing.\nAdd it in Settings → APIs");
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: textMessages, temperature: temp, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(cloudHttpError("mistral", res.status, txt, res.headers.get("Retry-After"))); }
      for await (const delta of parseOpenAISSE(res.body, onUsage)) onToken(delta);

    } else {
      throw new Error(`Unknown cloud provider: ${provider}`);
    }

    // Record the real token usage for this response (measured-only — skipped
    // when the provider reported none). Best-effort; never blocks the chat.
    if (captured && (captured.inputTokens || captured.outputTokens)) {
      HC.usageLog.append({
        ts: new Date().toISOString(),
        model: modelId,
        input_tokens: captured.inputTokens || 0,
        output_tokens: captured.outputTokens || 0,
      });
    }
  }

  let loadModelsSeq = 0;
  async function loadModels() {
    const seq = ++loadModelsSeq;
    clearError();
    // "Off" — user picked the "Off" preset (empty URL). Skip the ping entirely.
    if (!(hostEl.value || "").trim()) {
      setStatus("warn", "Local Ollama: Off");
      modelEl.innerHTML = `<option value="">— local Ollama disabled —</option>`;
      populateCloudModels();
      return;
    }
    setStatus("warn", "Connecting…");
    try {
      const r = await fetch(`${safeHost()}/api/tags`, { cache: "no-store", signal: makeSignal(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (seq !== loadModelsSeq) return;
      const models = (data.models || []).map(ollamaModelName).filter(Boolean);
      const current = modelEl.value;
      modelEl.innerHTML = "";
      if (models.length === 0) {
        modelEl.innerHTML = `<option value="">No models — run: ollama pull llama3.2</option>`;
        setStatus("warn", "Connected · no models installed");
      } else {
        models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m; opt.textContent = m;
          modelEl.appendChild(opt);
        });
        setStatus("ok", `Connected · ${models.length} model${models.length === 1 ? "" : "s"}`);
      }
      // Add cloud model optgroups below local models
      populateCloudModels();
      const canSelectModel = (value) =>
        !!value && Array.from(modelEl.options).some(opt => opt.value === value && !opt.disabled);
      const pick = canSelectModel(current) ? current :
                   canSelectModel(SAVED.model) ? SAVED.model :
                   (models[0] || "");
      if (pick) modelEl.value = pick;
      setActiveSub(modelEl.value);

      // Query rewriter dropdown removed from Settings UI — population skipped when element absent
      if (rewriterEl) {
        const rewriterPrev = rewriterEl.value || SAVED.rewriterModel || "";
        rewriterEl.innerHTML = `<option value="">— off — use raw message —</option>`;
        models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m; opt.textContent = m;
          rewriterEl.appendChild(opt);
        });
        if (rewriterPrev && models.includes(rewriterPrev)) rewriterEl.value = rewriterPrev;
      }

      saveSettings();
    } catch (err) {
      if (seq !== loadModelsSeq) return;
      // Local host offline — show cloud models so the user can still chat
      modelEl.innerHTML = `<option value="" disabled>(Local host offline)</option>`;
      populateCloudModels();
      // Restore a saved cloud model selection if any
      const savedModel = SAVED.model || "";
      if (savedModel.startsWith("cloud:")) {
        modelEl.value = savedModel;
        setActiveSub(savedModel);
      } else {
        activeSub.textContent = "Local host offline";
        if (cloudBadgeEl) cloudBadgeEl.style.display = "none";
      }
      const hasCloud = CLOUD_MODELS.some(g => (g.keyEl().value || "").trim());
      setStatus(hasCloud ? "warn" : "err", hasCloud ? "Local host offline · cloud ready" : "Local host offline");
    }
  }

  function setStatus(kind, text) {
    statusDot.className = "dot " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "warn");
    statusText.textContent = text;
  }

  function showError(err) {
    const msg = err?.message || String(err || "Unknown error");
    errorSlot.innerHTML = `<div class="error-banner"><b>Request failed</b><span>${escapeHtml(msg)}</span><button type="button" class="error-close" aria-label="Dismiss request failed message" title="Close">&times;</button></div>`;
  }
  function clearError() { errorSlot.innerHTML = ""; }
  errorSlot?.addEventListener("click", (e) => {
    if (e.target.closest(".error-close")) clearError();
  });

  // ========= Rendering =========
  // Every preset ends with a TASK slot the user fills in. Short = less prompt
  // processing on the local host, faster first token.

  // 2026 design vocabulary. Concrete and descriptive so even local models with
  // older training cutoffs (that have never "seen" 2026) produce the right look.
  const LOOK_2026 = `=== 2026 LOOK (concrete spec — follow exactly even if your training is older) ===
Layout: bento-grid sections (asymmetric tiles, varied row heights), generous whitespace, max-width ~1200px content gutters.
Background: warm-tinted near-black (e.g. #0a0a0f, #0d0e14 — never pure #000 or pure #fff). Add a soft mesh/aurora gradient blob (2-3 stops, 40% opacity, blurred 80px+) behind the hero.
Typography: variable sans for body (Geist, Inter, or Satoshi). Editorial serif display for hero headlines (Fraunces, Instrument Serif, or Cormorant). Headlines 4xl-7xl, tight tracking (-0.02em), line-height 1.0-1.1.
Color: ONE bold accent (e.g. electric violet #7c3aed, lime #a3e635, or warm amber #f59e0b) + 2 neutral grays. No rainbow. No flat primary blue.
Surfaces: glass cards — bg rgba(255,255,255,0.04), backdrop-blur(20px), 1px hairline border rgba(255,255,255,0.08), rounded-2xl (16px) or rounded-3xl (24px) corners.
Texture: 3% opacity grain/noise overlay across large surfaces (SVG noise filter). Breaks the flatness.
Buttons: pill-shaped (rounded-full), accent-colored solid for primary, ghost (transparent border) for secondary. No drop shadows — use inner highlight + 1px ring instead.
Motion: spring physics (Framer Motion on web, Reanimated on RN). Hover = scale 1.02 + soft glow, 150ms. Press = scale 0.97, 100ms. Page enter = fade + 8px upward slide, 300ms cubic-bezier(0.22,1,0.36,1). Lists = stagger 40ms per item. Respect prefers-reduced-motion.
Patterns: floating sticky nav (backdrop-blur, hairline border), Cmd+K command palette, skeleton loaders not spinners, optimistic UI, empty states with personality.
Reference vibe: Linear + Vercel + Arc Browser + Raycast. Quiet confidence, not loud. Every detail intentional.`;

  const HASH_AI_PROMPT = `You are the user's personal AI assistant.
Be direct and concise. No preamble, no filler, no closing remarks.
Use bullet points for lists. Use code blocks for all code.
Prefer practical steps over theory.
Never guess or invent facts — say "I don't know" instead.`;

  const FULLSTACK_PROMPT = `Build a production-ready full-stack web app.
Stack: Next.js 15 + TS + Tailwind v4 + shadcn/ui + Framer Motion · tRPC v11 · Drizzle + Postgres · Auth.js · Zod · pnpm.
Deliverables: folder tree, every file's full contents (labeled), run commands, .env.example.

${LOOK_2026}`;

  const MOBILE_PROMPT = `Build a production-ready cross-platform mobile app.
Stack: Expo SDK 52 + TS + Expo Router + NativeWind v4 + Reanimated v3 + Zustand + TanStack Query · pnpm.
Deliverables: folder tree, every file's full contents (labeled), run commands.
Mobile extras: animated custom tab bar, haptics on every meaningful interaction, light+dark with smooth transition, shared-element transitions between screens.

${LOOK_2026}`;

  const SPEED_PROMPT = `SPEED MODE — until I say "normal mode":
- 1-3 short sentences by default. No preamble, no recap, no closers.
- Shortest correct reasoning path. Don't think out loud.
- "unknown" if you don't know. Never invent APIs/citations.
- Bullets over prose. Code blocks only when code is needed.`;

  // ================ Coding-mode preset prompts ================
  // Tight, task-focused. They lean on past chat for the actual code rather
  // than re-shipping a long preamble — that keeps prompt processing fast.

  const REST_API_PROMPT = `Build a production REST API.
Stack: TS + Fastify or NestJS · JWT (access+refresh, httpOnly, rotation) · Postgres + Prisma/Drizzle · Zod on every route · pino logs · helmet + CORS + rate limit · vitest + supertest · multi-stage Dockerfile + docker-compose.
Deliver: folder tree → every file → run commands.`;

  const REFACTOR_PROMPT = `Refactor the code from our chat above.
1. Top 3 concrete issues (naming, coupling, dead code, types, a11y, perf).
2. Full refactored file (not a diff). Preserve public behavior.
3. Bullet list: every change → one-line rationale.`;

  const EXPLAIN_ERROR_PROMPT = `Explain the error from our chat above.
1. Exact cause (one sentence).
2. Why it happens (2-4 mechanism-level bullets).
3. Full corrected snippet.
4. Hardening: guard / test / lint rule that prevents recurrence.`;

  const WRITE_TESTS_PROMPT = `Write tests for the code from our chat above.
- Pick the right framework for the stack (vitest / jest / pytest / xctest).
- Unit tests per exported function: happy + 1 failure + 1 edge.
- Integration tests where there's real IO (DB/HTTP/FS).
- Run command + expected output at the end.`;

  const DEBUG_PROMPT = `Debug the code from our chat above.
1. What it currently does (3 lines).
2. What it should do.
3. The specific bug, named (off-by-one, race, stale closure, type coercion…).
4. Full corrected file.
5. A one-liner test that would have caught it.`;

  const OPTIMIZE_PROMPT = `Optimize the code from our chat above (speed / memory / bundle / DB / render).
1. Name the profiling tool you'd use to confirm the bottleneck.
2. Full optimized file.
3. Table: change → expected win → cost.
If it's already fine, say so.`;

  const CODE_REVIEW_PROMPT = `Review the diff/file from our chat above like a staff engineer.
- Correctness (must-fix), design (should-fix, justify), style (optional), security/a11y/perf, missing tests.
- Each finding: verdict + rationale + suggested fix as code.
- End with a 1-sentence ship/no-ship call.`;

  const FORGE_ARCHITECT_PROMPT = `You are 3D Forge mode inside HashCortx.
Goal: help build Forge, a React + Three.js architecture-first 3D agent swarm planner. Be concrete and implementation-focused.

Core stack:
- Vite + React + TypeScript.
- Three.js 0.184, @react-three/fiber 9.6, drei 10.7, postprocessing 3.0.
- Rapier and manifold-3d use WASM, so vite.config.ts needs wasm(), topLevelAwait(), COOP/COEP headers, and optimizeDeps.exclude for WASM packages.
- Zustand + immer for state. No per-frame React re-renders.

Architecture rules:
- Write /src/types/forge.ts and /src/types/geometry.ts before implementation.
- AgentRole = structure | surface | detail | audit. Keep ROLE_COLORS centralized.
- GeometryPlan is the AI output. It contains nodes, edges, surfaces, and constraints.
- Data flow is one-way: prompt -> forgeAgent stream -> nodes arrive -> particles spawn -> density rises -> solidifyNode -> build mesh/CSG/check constraints -> fade opacity -> push snapshot.
- Hot path lives in useStore.getState() inside useFrame. Do not put per-frame particle data in React state.
- Particle trails use preallocated instancing and shader attributes, not per-frame DOM or React updates.
- CSG and constraint checks fire once on solidification, never every frame.

AI protocol:
- Force exactly one tool call named generate_geometry_plan.
- The schema requires 2-40 nodes, CSG edges, surface material hints, and constraints.
- Stream tool-call argument deltas. Use bracket depth to emit node_added events as soon as complete node objects arrive.
- System prompt must order nodes before edges.

Swarm math:
- Spawn points are random points on a sphere radius 8.
- Targets are node positions.
- Use THREE.CubicBezierCurve3.getPoint(t).
- Durations: structure 2800ms, surface 2000ms, detail 1400ms, audit 3500ms.
- Solidification opacity = clamp(arrivedParticles / totalParticles / threshold, 0, 1).

Build order:
1. Dark void + orbit controls.
2. Prompt bar + mock 5-node chair GeometryPlan.
3. Swarm particle system.
4. Mesh emergence animation.
5. Constraint overlay.
6. Version scrubber.
7. Export pipeline.

Answer format:
- For implementation requests, return exact file paths and full code or tight patches.
- For planning requests, return phase, file order, acceptance criteria, and risks.
- Keep performance budgets visible when touching SwarmParticles, meshBuilder, or useGeometry.`;

  const FORGE_SCAFFOLD_PROMPT = `Create the 3D Forge project scaffold.
Use Vite React TypeScript and this exact dependency plan:
- 3D: three@0.184.0, @react-three/fiber@9.6.1, @react-three/drei@10.7.7, @react-three/postprocessing@3.0.4, postprocessing@6.39.1, @types/three@0.184.0
- Physics visuals: @dimforge/rapier3d-compat@0.19.3
- Geometry: three-csg-ts@3.2.0, manifold-3d@3.4.1
- State/AI/UI: zustand@5.0.13, immer@11.1.7, openai@6.36.0, @anthropic-ai/sdk@0.95.0, framer-motion@12.38.0, clsx@2.1.1, tailwind-merge@3.5.0, leva@0.10.1
- Dev: tailwindcss@4.2.4, @tailwindcss/vite, vite-plugin-wasm@3.6.0, vite-plugin-top-level-await@1.6.0
Deliver folder tree, commands, vite.config.ts with WASM plugins plus COOP/COEP headers, and the first runnable App.tsx.`;

  const FORGE_TYPES_PROMPT = `Write Forge's TypeScript type system first.
Deliver /src/types/forge.ts and /src/types/geometry.ts.
Include AgentRole, ROLE_COLORS, ParticleState, BezierPath, SwarmParticle with trailPoints[32], AgentMessage, ConflictEntry, GeometrySnapshot, ExportOptions, all five Zustand slice interfaces, primitive discriminated unions, GeometryNode, GeometryEdge, GeometryPlan, VertexDensityMap, and ConstraintViolation.`;

  const FORGE_AGENT_PROMPT = `Design /src/agents/forgeAgent.ts.
Implement the generate_geometry_plan tool schema, forced tool_choice, streaming argument accumulation, bracket-depth node extraction, node_added events, final plan validation, and the system prompt that orders nodes before edges. Include robust parsing failure behavior.`;

  const FORGE_SWARM_PROMPT = `Implement /src/canvas/SwarmParticles.tsx and the supporting store methods.
Use instanced particles, CubicBezierCurve3 paths, role-specific arcs and durations, ring-buffer trailPoints[32], preallocated trail instancing, and no per-frame React state. Include dirty flags and activeCount-based draw counts.`;

  const FORGE_PHASES_PROMPT = `Turn 3D Forge into a 7-phase implementation checklist.
For each phase include deliverables, files touched, done criteria, tests/visual checks, and likely failure points. Preserve the critical file order: types, forgeAgent, SwarmParticles, meshBuilder, useGeometry.`;

  const PRESET_PROMPTS = {
    hashAi: HASH_AI_PROMPT,
    fullstack: FULLSTACK_PROMPT,
    mobile: MOBILE_PROMPT,
    freeRam: SPEED_PROMPT,
    restApi: REST_API_PROMPT,
    refactor: REFACTOR_PROMPT,
    explainErr: EXPLAIN_ERROR_PROMPT,
    writeTests: WRITE_TESTS_PROMPT,
    debug: DEBUG_PROMPT,
    optimize: OPTIMIZE_PROMPT,
    codeReview: CODE_REVIEW_PROMPT,
    forgeScaffold: FORGE_SCAFFOLD_PROMPT,
    forgeTypes: FORGE_TYPES_PROMPT,
    forgeAgent: FORGE_AGENT_PROMPT,
    forgeSwarm: FORGE_SWARM_PROMPT,
    forgePhases: FORGE_PHASES_PROMPT,
  };

  // Shared preset handler — runs whether the chip was clicked on the
  // empty-state splash or on the composer-level chip row mid-conversation.
  async function applyPreset(preset, chipEl) {
    input.value = PRESET_PROMPTS[preset] || (chipEl && chipEl.dataset.q) || "";
    input.focus();
    input.dispatchEvent(new Event("input"));
    // Free RAM chip also unloads every currently-loaded model on the local host.
    if (preset === "freeRam") {
      const host = safeHost();
      setStatus("warn", "Freeing RAM on the local host…");
      try {
        const snap = await fetchLoadedLocalModels(host, 5000);
        const names = snap.names;
        await unloadLocalModels(names);
        setStatus("ok", names.length
          ? `RAM freed · unloaded ${names.length} model${names.length === 1 ? "" : "s"} · speed mode prompt ready`
          : `No models were loaded · speed mode prompt ready`);
      } catch (err) {
        console.error("[freeRam] failed:", err);
        setStatus("warn", "Could not reach the local host — speed prompt loaded anyway");
      }
    }
  }

  // Wire the persistent composer-level chip row once, on startup. The chips
  // inside .empty get re-wired each time render() redraws the empty state.
  const composerChips = $("composerChips");
  if (composerChips) {
    composerChips.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-preset]");
      if (!b) return;
      applyPreset(b.dataset.preset, b);
    });
  }

  function render() {
    msgs.innerHTML = "";
    // Toggle the .has-chat class so the composer chips row only appears once
    // the conversation has actually started — keeps the empty splash clean.
    document.getElementById("app").classList.toggle("has-chat", state.messages.length > 0);
    if (state.messages.length === 0) {
      msgs.innerHTML = `
        <div class="empty">
          <div class="empty-inner">
            <div class="crest-wrap">
              <img src="/assets/logo-full.png" class="crest-logo-img" draggable="false" alt="HashCortx"/>
            </div>
            <p>Massive UI . Isolated Intellegence . Agentic<span class="drone-inline"><svg viewBox="0 0 200 120" width="40" height="24" overflow="visible" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="dg-s" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f5d77a"/><stop offset="0.5" stop-color="#c9a96e"/><stop offset="1" stop-color="#8a6a10"/></linearGradient><radialGradient id="dr-s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="rgba(201,169,110,0.40)"/><stop offset="1" stop-color="rgba(201,169,110,0)"/></radialGradient></defs><line x1="40" y1="40" x2="160" y2="80" stroke="url(#dg-s)" stroke-width="3" stroke-linecap="round"/><line x1="160" y1="40" x2="40" y2="80" stroke="url(#dg-s)" stroke-width="3" stroke-linecap="round"/><circle cx="40" cy="40" r="20" fill="url(#dr-s)"/><circle cx="160" cy="40" r="20" fill="url(#dr-s)"/><circle cx="40" cy="80" r="20" fill="url(#dr-s)"/><circle cx="160" cy="80" r="20" fill="url(#dr-s)"/><g><ellipse cx="40" cy="40" rx="15" ry="2" fill="url(#dg-s)" opacity="0.9"/><ellipse cx="40" cy="40" rx="2" ry="15" fill="url(#dg-s)" opacity="0.9"/><animateTransform attributeName="transform" type="rotate" from="0 40 40" to="360 40 40" dur="0.78s" repeatCount="indefinite"/></g><g><ellipse cx="160" cy="40" rx="15" ry="2" fill="url(#dg-s)" opacity="0.9"/><ellipse cx="160" cy="40" rx="2" ry="15" fill="url(#dg-s)" opacity="0.9"/><animateTransform attributeName="transform" type="rotate" from="0 160 40" to="-360 160 40" dur="0.70s" repeatCount="indefinite"/></g><g><ellipse cx="40" cy="80" rx="15" ry="2" fill="url(#dg-s)" opacity="0.9"/><ellipse cx="40" cy="80" rx="2" ry="15" fill="url(#dg-s)" opacity="0.9"/><animateTransform attributeName="transform" type="rotate" from="0 40 80" to="-360 40 80" dur="0.84s" repeatCount="indefinite"/></g><g><ellipse cx="160" cy="80" rx="15" ry="2" fill="url(#dg-s)" opacity="0.9"/><ellipse cx="160" cy="80" rx="2" ry="15" fill="url(#dg-s)" opacity="0.9"/><animateTransform attributeName="transform" type="rotate" from="0 160 80" to="360 160 80" dur="0.74s" repeatCount="indefinite"/></g><rect x="72" y="46" width="56" height="28" rx="8" fill="rgba(8,10,18,0.95)" stroke="url(#dg-s)" stroke-width="1.5"/><rect x="78" y="52" width="14" height="9" rx="2" fill="url(#dg-s)" opacity="0.8"/><circle cx="118" cy="60" r="2.5" fill="#f5d77a"/><line x1="80" y1="74" x2="75" y2="94" stroke="url(#dg-s)" stroke-width="1.5" stroke-linecap="round"/><line x1="120" y1="74" x2="125" y2="94" stroke="url(#dg-s)" stroke-width="1.5" stroke-linecap="round"/><line x1="75" y1="94" x2="125" y2="94" stroke="url(#dg-s)" stroke-width="1.6" stroke-linecap="round"/><circle cx="100" cy="60" r="1.6" fill="#f5d77a"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.6s" begin="0.3s" repeatCount="indefinite"/></circle></svg></span></p>
            <div class="chips">
              <button data-preset="hashAi">Initialize HashCortx</button>
              <button data-preset="fullstack">Full Stack website</button>
              <button data-preset="mobile">Mobile App</button>
              <button data-preset="freeRam" title="Unloads all models on the local host to free RAM and preps a speed-mode prompt"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM · Speed mode</button>
            </div>
          </div>
        </div>`;
      msgs.querySelectorAll(".chips button").forEach(b =>
        b.addEventListener("click", () => applyPreset(b.dataset.preset, b))
      );
      updateContextIndicator();
      return;
    }
    state.messages.forEach((m, idx) => msgs.appendChild(renderMessage(m, idx)));
    msgs.scrollTop = msgs.scrollHeight;
    updateContextIndicator();
    requestAnimationFrame(() => {
      renderMermaidDiagrams();
      window.HC_CODE?.afterRender?.();
    });
  }

  function stripReplyPrelude(text) {
    const raw = String(text || "");
    const parts = raw.split(/\n\n(?=[^>])/);
    if (parts.length > 1 && /^Replying to /.test(parts[0])) {
      return parts.slice(1).join("\n\n");
    }
    return raw;
  }

  function buildReplyWrappedContent(baseText, replyMeta) {
    if (!replyMeta || !state.messages[replyMeta.idx]) return baseText;
    const src = state.messages[replyMeta.idx];
    const quoted = (src.content || "").split("\n").map(l => "> " + l).join("\n");
    const whose = src.role === "assistant" ? "the assistant's earlier reply" : "my earlier message";
    return `Replying to ${whose}:\n${quoted}\n\n${baseText}`;
  }

  function diffWordsHtml(oldText, newText) {
    const oldWords = String(oldText || "").trim().split(/\s+/).filter(Boolean).slice(0, 260);
    const newWords = String(newText || "").trim().split(/\s+/).filter(Boolean).slice(0, 260);
    if (!oldWords.length && !newWords.length) return "";
    const n = oldWords.length, m = newWords.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oldWords[i] === newWords[j]) {
        out.push(escapeHtml(newWords[j]));
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push(`<span class="diff-del">${escapeHtml(oldWords[i])}</span>`);
        i++;
      } else {
        out.push(`<span class="diff-add">${escapeHtml(newWords[j])}</span>`);
        j++;
      }
    }
    while (i < n) out.push(`<span class="diff-del">${escapeHtml(oldWords[i++])}</span>`);
    while (j < m) out.push(`<span class="diff-add">${escapeHtml(newWords[j++])}</span>`);
    const truncated = /\s/.test(String(oldText).trim().split(/\s+/).slice(260).join(" ")) ||
      /\s/.test(String(newText).trim().split(/\s+/).slice(260).join(" "));
    return out.join(" ") + (truncated ? ` <span class="diff-add">…</span>` : "");
  }

  function diffBlockHtml(oldText, newText, live = false) {
    const body = diffWordsHtml(oldText, newText);
    if (!body) return "";
    return `<div class="diff-box"><div class="diff-title">${live ? "Live regenerate diff" : "Regenerate diff"}</div><div class="diff-text">${body}</div></div>`;
  }

  function cloneMessage(msg) {
    return {
      ...msg,
      images: msg.images ? msg.images.slice() : undefined,
      attachments: msg.attachments ? msg.attachments.map(a => typeof a === "object" ? { ...a } : a) : undefined,
      _imgBase64: msg._imgBase64 ? msg._imgBase64.slice() : undefined,
      replyTo: msg.replyTo ? { ...msg.replyTo } : undefined,
    };
  }

  function renderMessage(m, idx) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${m.role}`;
    wrap.dataset.idx = idx;
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = m.role === "user" ? "You" : "AI";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (m.compare) {
      wrap.classList.add("compare-msg");
      bubble.classList.add("has-actions");
      const paneHtml = (side) => {
        const branch = m.compare[side] || {};
        const status = branch.error ? "error" : branch.done ? "done" : "streaming";
        const body = branch.done || branch.error
          ? formatContent(branch.error ? branch.error : (branch.content || ""))
          : `<div class="typing"><span></span><span></span><span></span></div><pre style="white-space:pre-wrap;margin-top:10px">${escapeHtml(branch.content || "")}</pre>`;
        return `<div class="compare-pane" data-compare-side="${side}">
          <div class="compare-head"><span class="compare-model">${escapeHtml(cloudModelLabel(branch.model) || branch.model || side)}</span><span class="compare-status">${escapeHtml(status)}</span></div>
          <div class="compare-body">${body}</div>
        </div>`;
      };
      bubble.innerHTML = `<div class="compare-grid">${paneHtml("left")}${paneHtml("right")}</div>`;
      if (!(idx === state.messages.length - 1 && state.streaming)) {
        const actions = document.createElement("div");
        actions.className = "msg-actions";
        actions.innerHTML = `
          <button class="msg-action" data-action="copy-msg" title="Copy both comparison replies">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
            Copy
          </button>`;
        bubble.appendChild(actions);
      }
      wrap.appendChild(av); wrap.appendChild(bubble);
      return wrap;
    }
    // If this user message was a reply to an earlier one, show a compact
    // quote badge at the top of the bubble (clickable → scrolls to source).
    let displayContent = m.content || "";
    if (m.role === "user" && m.replyTo) {
      const srcRole = m.replyTo.role === "assistant" ? "AI" : "You";
      const srcPreview = m.replyTo.preview || "(empty message)";
      const quote = document.createElement("div");
      quote.className = "reply-quote";
      quote.dataset.target = String(m.replyTo.idx);
      quote.innerHTML = `
        <span class="reply-quote-role">↳ ${srcRole}</span>
        <span class="reply-quote-text">${escapeHtml(srcPreview)}</span>`;
      bubble.appendChild(quote);
      // Strip the auto-generated quoted block from the displayed content so
      // the user's actual message shows clean. We built it as:
      // "Replying to ... :\n> quoted...\n\n<real text>"
      displayContent = stripReplyPrelude(displayContent);
    }
    const isStreamingPlaceholder = m.role === "assistant" && idx === state.messages.length - 1 && state.streaming;
    if (displayContent || !isStreamingPlaceholder) {
      // Use cached HTML for finished messages so formatContent never runs twice
      // for the same message content. Cache is keyed on the message object so
      // it dies automatically when the message is GC'd.
      let html;
      if (!isStreamingPlaceholder) {
        if (!_htmlCache.has(m)) _htmlCache.set(m, formatContent(displayContent));
        html = _htmlCache.get(m);
      } else {
        html = formatContent(displayContent); // streaming — content still changing
      }
      const body = document.createElement("div");
      body.innerHTML = html;
      while (body.firstChild) bubble.appendChild(body.firstChild);
      if (m.role === "assistant" && m.diffFrom && displayContent) {
        bubble.insertAdjacentHTML("beforeend", diffBlockHtml(m.diffFrom, displayContent, isStreamingPlaceholder));
      }
    } else {
      bubble.insertAdjacentHTML("beforeend", `<div class="typing"><span></span><span></span><span></span></div>`);
    }
    if (m.images?.length) {
      m.images.forEach((dataUrl, imgIdx) => {
        const isGenerated = m.role === "assistant"; // user images are inputs; assistant images are generated
        if (isGenerated) {
          const wrap = document.createElement("div");
          wrap.className = "gen-img-wrap";
          const img = document.createElement("img");
          img.src = dataUrl;
          img.alt = "Generated image";
          // Download button
          const dlBtn = document.createElement("button");
          dlBtn.className = "gen-img-dl";
          dlBtn.title = "Download image";
          dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save`;
          dlBtn.addEventListener("click", () => {
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `hash-image-${Date.now()}.png`;
            a.click();
          });
          // Copy button
          const cpBtn = document.createElement("button");
          cpBtn.className = "gen-img-copy";
          cpBtn.title = "Copy image to clipboard";
          cpBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> Copy`;
          cpBtn.addEventListener("click", async () => {
            try {
              const res2 = await fetch(dataUrl);
              const blob = await res2.blob();
              await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
              const prev = cpBtn.innerHTML;
              cpBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
              setTimeout(() => { cpBtn.innerHTML = prev; }, 1600);
            } catch { cpBtn.textContent = "n/a"; }
          });
          wrap.appendChild(img);
          wrap.appendChild(cpBtn);
          wrap.appendChild(dlBtn);
          bubble.appendChild(wrap);
        } else {
          const img = document.createElement("img");
          img.src = dataUrl; bubble.appendChild(img);
        }
      });
    }
    if (m.attachments?.length) {
      const at = document.createElement("div");
      at.className = "attachments";
      m.attachments.forEach(a => {
        const s = document.createElement("span");
        s.className = "attachment";
        // `a` is either a plain filename (legacy saved chats) or a rich
        // object { name, kind, pages }. Handle both so old chats still open.
        const name = typeof a === "string" ? a : a.name;
        const kind = typeof a === "string" ? "file" : (a.kind || "file");
        const pages = typeof a === "object" ? a.pages : undefined;
        const chars = typeof a === "object" ? fileCharLabel(a.chars) : "";
        const extra = [pages ? `${pages}p` : "", chars].filter(Boolean).join(" · ");
        s.innerHTML = `${fileKindIcon(kind)} <span>${escapeHtml(name)}${extra ? ` · ${escapeHtml(extra)}` : ""}</span>`;
        at.appendChild(s);
      });
      bubble.appendChild(at);
    }
    // Duration chip — floats at the top-right of every finished assistant reply.
    // Shows the response time when available; falls back to "—" for old chats
    // that were saved before we started persisting durationMs.
    if (m.role === "assistant" && m.content && !(idx === state.messages.length - 1 && state.streaming)) {
      const meta = document.createElement("div");
      meta.className = "msg-meta";
      const label = m.durationMs ? formatDuration(m.durationMs) : "—";
      meta.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15.5 14"/>
        </svg>
        <span><b>${escapeHtml(label)}</b></span>`;
      bubble.classList.add("has-meta");
      bubble.appendChild(meta);
    }
    // Message-action row — assistant replies get reply/copy/regenerate.
    if (m.role === "assistant" && m.content && !(idx === state.messages.length - 1 && state.streaming)) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      if (state.replyTo && state.replyTo.idx === idx) actions.classList.add("pinned");
      actions.innerHTML = `
        <button class="msg-action" data-action="reply" title="Reply to this message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          Reply
        </button>
        <button class="msg-action" data-action="copy-msg" title="Copy the full reply">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          Copy
        </button>
        <button class="msg-action" data-action="regenerate" title="Regenerate from the previous prompt">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.5 15a9 9 0 0 1-14.13 3.36L1 14"/></svg>
          Regenerate
        </button>`;
      bubble.classList.add("has-actions");
      bubble.appendChild(actions);
    }
    if (m.role === "user" && m.content) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      if (state.editing && state.editing.idx === idx) actions.classList.add("pinned");
      actions.innerHTML = `
        <button class="msg-action" data-action="edit-msg" title="Edit this message and branch from here">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          Edit
        </button>
        <button class="msg-action" data-action="copy-msg" title="Copy this message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          Copy
        </button>`;
      bubble.classList.add("has-actions");
      bubble.appendChild(actions);
    }
    // Highlight the message currently being replied to.
    if (state.replyTo && state.replyTo.idx === idx) wrap.classList.add("reply-target");
    if (state.editing && state.editing.idx === idx) wrap.classList.add("reply-target");
    wrap.appendChild(av); wrap.appendChild(bubble);
    return wrap;
  }

  // --- Reply-to-message wiring ---
  const replyBanner = $("replyBanner");
  const replyPreview = $("replyPreview");
  const replyLabelRole = $("replyLabelRole");
  const replyClose = $("replyClose");
  const editBanner = $("editBanner");
  const editPreview = $("editPreview");
  const editClose = $("editClose");

  function setReplyTo(idx) {
    const m = state.messages[idx];
    if (!m) return;
    state.editing = null;
    editBanner.classList.remove("visible");
    if (!state.streaming) sendBtn.textContent = "Send";
    const raw = (m.content || "").replace(/\s+/g, " ").trim();
    const preview = raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
    state.replyTo = { idx, role: m.role, preview };
    replyLabelRole.textContent = m.role === "assistant" ? "AI" : "your message";
    replyPreview.textContent = preview || "(empty message)";
    replyBanner.classList.add("visible");
    input.focus();
    render(); // re-render so the pinned highlight appears
  }
  function clearReplyTo() {
    state.replyTo = null;
    replyBanner.classList.remove("visible");
    render();
  }
  function setEditingMessage(idx) {
    const m = state.messages[idx];
    if (!m || m.role !== "user") return;
    state.editing = { idx, original: cloneMessage(m) };
    state.replyTo = null;
    state.pendingImages = [];
    state.pendingFiles = [];
    renderPending();
    replyBanner.classList.remove("visible");
    input.value = stripReplyPrelude(m.content || "");
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
    editPreview.textContent = (input.value || "(empty message)").replace(/\s+/g, " ").trim().slice(0, 180) || "(empty message)";
    editBanner.classList.add("visible");
    if (!state.streaming) sendBtn.textContent = "Branch";
    input.focus();
    render();
  }
  function clearEditingMessage() {
    state.editing = null;
    editBanner.classList.remove("visible");
    if (!state.streaming) sendBtn.textContent = "Send";
    render();
  }
  replyClose.addEventListener("click", clearReplyTo);
  editClose.addEventListener("click", clearEditingMessage);

  // Click a reply-quote badge → jump to and briefly flash the source message.
  msgs.addEventListener("click", (e) => {
    const q = e.target.closest(".reply-quote");
    if (!q) return;
    const targetIdx = Number(q.dataset.target);
    if (!Number.isFinite(targetIdx)) return;
    const target = msgs.querySelector(`.msg[data-idx="${targetIdx}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("flash"); // retrigger animation
    // Force reflow so the animation actually restarts.
    void target.offsetWidth;
    target.classList.add("flash");
  });

  // Delegate Reply/Copy clicks on assistant bubbles. Copy-code is handled
  // separately further down; keep this listener narrow so they don't conflict.
  msgs.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="reply"], [data-action="copy-msg"], [data-action="edit-msg"], [data-action="regenerate"]');
    if (!btn) return;
    const msgEl = btn.closest(".msg");
    if (!msgEl) return;
    const idx = Number(msgEl.dataset.idx);
    if (!Number.isFinite(idx)) return;
    const action = btn.dataset.action;
    if (action === "reply") {
      setReplyTo(idx);
      return;
    }
    if (action === "edit-msg") {
      setEditingMessage(idx);
      return;
    }
    if (action === "regenerate") {
      regenerateFromAssistant(idx);
      return;
    }
    if (action === "copy-msg") {
      const text = state.messages[idx]?.content || "";
      const done = () => {
        const prev = btn.innerHTML;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
        setTimeout(() => { btn.innerHTML = prev; }, 1300);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
      else {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta);
        ta.select(); try { document.execCommand("copy"); done(); } catch {}
        document.body.removeChild(ta);
      }
    }
  });

  // Human-friendly duration formatter ("812 ms", "4.3s", "1m 12s").
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s - m * 60);
    return `${m}m ${rem}s`;
  }

  function estimateGeneratedTokens(text) {
    if (!text) return 0;
    const compact = String(text).trim();
    if (!compact) return 0;
    return Math.max(1, Math.ceil(compact.length / 3.8));
  }

  function setTpsDisplay(tps) {
    if (!Number.isFinite(tps) || tps <= 0) return;
    const rounded = Math.max(1, Math.round(tps));
    if (tpsVal) tpsVal.textContent = `${rounded} t/s`;
    if (tpsBtn) {
      tpsBtn.className = "ping-btn tps-btn" +
        (rounded >= 10 ? " tps-fast" : rounded >= 4 ? " tps-mid" : "");
    }
  }

  function setSplitTpsDisplay(compare) {
    const left = compare?.left?.tps;
    const right = compare?.right?.tps;
    const fmt = (v) => Number.isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : "…";
    if (tpsVal) tpsVal.textContent = `L${fmt(left)} · R${fmt(right)}`;
    if (tpsBtn) {
      const vals = [left, right].filter(v => Number.isFinite(v) && v > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      tpsBtn.className = "ping-btn tps-btn split-tps streaming" +
        (avg >= 10 ? " tps-fast" : avg >= 4 ? " tps-mid" : "");
      tpsBtn.title = "Tokens per second — left and right split models";
    }
  }

  // Escape map hoisted out of the replace callback — allocated once, not per call.
  const _esc = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => _esc[c]); }
  /** Only absolute http(s) URLs for markdown links — blocks javascript:, data:, etc. */
  function safeMarkdownHref(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (u.username !== "" || u.password !== "") return null;
      return u.href;
    } catch {
      return null;
    }
  }
  function extractMarkedLinkArgs(args) {
    const first = args[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const label = first.tokens?.map(t => t.raw || t.text || "").join("") || first.text || first.href || "";
      return { href: first.href || "", title: first.title || "", text: label };
    }
    return {
      href: first || "",
      title: args[1] || "",
      text: args[2] || first || "",
    };
  }
  function extractMarkedCodeArgs(args) {
    const first = args[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return { text: first.text || "", lang: first.lang || "" };
    }
    return { text: first || "", lang: args[1] || "" };
  }
  function decodeHtmlEntities(s) {
    let t = String(s || "");
    if (!t) return "";
    t = t.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const c = parseInt(hex, 16);
      return Number.isFinite(c) && c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : _;
    });
    t = t.replace(/&#(\d+);/g, (_, dec) => {
      const c = parseInt(dec, 10);
      return Number.isFinite(c) && c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : _;
    });
    t = t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
    t = t.replace(/&amp;/g, "&");
    return t;
  }
  const markdownRenderer = (() => {
    if (!window.marked?.Renderer) return null;
    const renderer = new window.marked.Renderer();
    renderer.link = function(...args) {
      const { href, title, text } = extractMarkedLinkArgs(args);
      const resolved = safeMarkdownHref(href);
      const label = escapeHtml(text || href || "");
      if (!resolved) {
        return `<span class="md-link-blocked" title="Only http(s) links are allowed">${label}</span>`;
      }
      const safeHref = escapeHtml(resolved);
      const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${safeTitle}>${escapeHtml(text || href || "")}</a>`;
    };
    renderer.code = function(...args) {
      const { text, lang } = extractMarkedCodeArgs(args);
      const src = decodeHtmlEntities(text).replace(/\n$/, "");
      const label = (lang || "").trim().split(/\s+/)[0];
      if (label.toLowerCase() === "mermaid") {
        return `<div class="mermaid-wrap"><div class="mermaid">${escapeHtml(src)}</div></div>`;
      }
      let html = escapeHtml(src);
      if (window.hljs) {
        try {
          html = label && window.hljs.getLanguage(label)
            ? window.hljs.highlight(src, { language: label, ignoreIllegals: true }).value
            : window.hljs.highlightAuto(src).value;
        } catch {}
      }
      const langBadge = label ? `<span class="code-lang">${escapeHtml(label)}</span>` : "";
      return `<div class="code-block">${langBadge}<button class="copy-btn" data-action="copy-code">Copy</button><pre><code class="hljs${label ? ` language-${escapeHtml(label)}` : ""}">${html}</code></pre></div>`;
    };
    return renderer;
  })();

  function fallbackFormatContent(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function renderMermaidDiagrams() {
    if (!window.mermaid) return;
    try {
      window.mermaid.run({ nodes: msgs.querySelectorAll(".mermaid:not([data-processed='true'])") });
    } catch (err) {
      console.warn("[mermaid] render failed:", err);
    }
  }

  function formatContent(text) {
    if (!window.marked || !markdownRenderer) return fallbackFormatContent(text);
    const safe = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      const raw = `<div class="markdown-body">${window.marked.parse(safe, {
        gfm: true,
        breaks: true,
        silent: true,
        renderer: markdownRenderer,
      })}</div>`;
      // Final pass: strip anything that slipped through (script, iframe, event handlers, javascript: URLs)
      // ADD_ATTR preserves renderer-added attributes DOMPurify strips by default
      if (window.DOMPurify) {
        return window.DOMPurify.sanitize(raw, {
          ADD_ATTR: ["target", "rel", "data-action", "data-processed", "data-language"],
          FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "meta", "link", "base"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onkeydown", "onkeyup", "onsubmit", "action", "formaction"],
        });
      }
      return raw;
    } catch {
      return fallbackFormatContent(text);
    }
  }

  // WeakMap cache: formatContent runs once per finalized message object,
  // never again on subsequent render() calls. Entries die with the object.
  const _htmlCache = new WeakMap();

  // Delegate copy-button clicks inside the messages pane
  msgs.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="copy-code"]');
    if (!btn) return;
    const codeEl = btn.parentElement.querySelector("pre code");
    if (!codeEl) return;
    const text = codeEl.textContent;
    const done = () => {
      const old = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = old || "Copy"; btn.classList.remove("copied"); }, 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta);
        ta.select(); try { document.execCommand("copy"); done(); } catch {}
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand("copy"); done(); } catch {}
      document.body.removeChild(ta);
    }
  });

  // Trim any title down to at most four words for the topbar crumb —
  // keeps the header compact while the sidebar list still shows the full title.
  function shortTitle(title, maxWords) {
    if (!title) return "";
    const clean = String(title).trim().replace(/\s+/g, " ");
    if (!clean) return "";
    const lim = maxWords || 4;
    const words = clean.split(" ");
    if (words.length <= lim) return clean;
    return words.slice(0, lim).join(" ") + "…";
  }
  function setActiveTitle(title) {
    const full = title || "";
    activeTitle.textContent = shortTitle(full) || "New Conversation";
    activeTitle.title = full + " — double-click to rename";
  }

  // Double-click the header title to rename the active chat inline.
  activeTitle.addEventListener("dblclick", () => {
    if (!state.currentChatId) return; // nothing to rename
    const chatList = activeChatList();
    const chat = chatList.find(c => c.id === state.currentChatId);
    if (!chat) return;
    const prev = chat.title || "";
    activeTitle.contentEditable = "true";
    activeTitle.textContent = prev;
    activeTitle.focus();
    // Select all
    const range = document.createRange();
    range.selectNodeContents(activeTitle);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    function finishRename() {
      activeTitle.contentEditable = "false";
      const newTitle = activeTitle.textContent.trim() || prev;
      chat.title = newTitle;
      saveActiveChatList();
      setActiveTitle(newTitle);
      renderChatList();
    }
    activeTitle.addEventListener("keydown", function kd(e) {
      if (e.key === "Enter") { e.preventDefault(); activeTitle.removeEventListener("keydown", kd); finishRename(); }
      if (e.key === "Escape") { activeTitle.removeEventListener("keydown", kd); activeTitle.contentEditable = "false"; setActiveTitle(prev); }
    });
    activeTitle.addEventListener("blur", function bl() {
      activeTitle.removeEventListener("blur", bl);
      finishRename();
    });
  });

  function ensureChatIdForCurrentMessages() {
    if (!state.currentChatId) state.currentChatId = uid();
    setActiveTitle(deriveTitle(state.messages));
  }

  function lastUserMessage(messages) {
    const arr = messages || state.messages;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === "user") return arr[i];
    }
    return null;
  }

  function normalizeUserMessageText(msg) {
    return stripReplyPrelude(msg?.content || "").trim();
  }

  function prepareEditBranch(idx, newText) {
    const original = state.messages[idx];
    const branched = state.messages.slice(0, idx).map(cloneMessage);
    const replyMeta = original.replyTo ? { ...original.replyTo } : null;
    const content = replyMeta ? buildReplyWrappedContent(newText, replyMeta) : newText;
    const next = cloneMessage(original);
    next.content = content;
    next.replyTo = replyMeta || undefined;
    if (original._modelContent) {
      next._modelContent = original._modelContent.startsWith(original.content || "")
        ? content + original._modelContent.slice((original.content || "").length)
        : content;
    }
    branched.push(next);
    return branched;
  }

  async function runAssistantTurn(seedText, hadAttachments, opts = {}) {
    ensureChatIdForCurrentMessages();

    const assistant = { role: "assistant", content: "", startedAt: Date.now(), ...(opts.diffFrom ? { diffFrom: opts.diffFrom } : {}) };
    state.messages.push(assistant);
    state.streaming = true;
    sendBtn.textContent = "Stop";
    pinned = true;
    if (tpsBtn) tpsBtn.className = "ping-btn tps-btn streaming";
    if (tpsVal) tpsVal.textContent = "…";
    render();

    const route = currentRoute(seedText, hadAttachments);
    if (route?.manual) routeOverride = null;

    const last = msgs.querySelector(".msg.assistant:last-of-type .bubble");
    const pulse = (label, sub) => {
      if (!last) return;
      last.classList.add("thinking-bubble");
      last.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>
        <div class="thinking-status-label">${escapeHtml(label)}</div>
        ${sub ? `<div class="thinking-status-sub">${escapeHtml(sub)}</div>` : ""}`;
      if (pinned) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
    };

    const _selectedIsCloud = modelEl.value.startsWith("cloud:");
    const _selectedIsNvidia = !!(route?.route && ROUTE_DEFS[route.route]?.backend === "nvidia");
    const _isExternalModel  = _selectedIsCloud || _selectedIsNvidia;
    const activeAgent = getActiveAgent();

    // ── Code Mode dispatch — HashCoder agent (Tauri only) ───────────────
    if (isCodeMode() && HC.isTauri && window.HC_CODE) {
      const ctrl = new AbortController();
      state.abort = ctrl;
      try {
        const onStatus = (label) => pulse(label, "HashCoder");
        const onFinalToken = () => { updateLastBubble(assistant.content); };
        await HC_CODE.run(assistant, { signal: ctrl.signal, onStatus, onFinalToken });
      } catch (err) {
        if (err.name !== "AbortError") showError(err);
      }
    }

    // ── Agent-mode dispatch ──────────────────────────────────────────────
    // Agent behaviors (system prompt + tools + memory) ONLY fire when an
    // agent is explicitly selected. Without an agent, this is a plain chat
    // — no auto tools, no auto memory injection. That matches the user's
    // mental model: "agent mode = on" only when I pick one.
    else if (activeAgent && injectionEnabled) {
      const ctrl = new AbortController();
      state.abort = ctrl;
      assistant.runTrace = beginAgentRun(activeAgent, seedText);
      recordAgentEvent(assistant, "start", `Agent ${activeAgent.name} started`, { model: modelEl.value, tools: agentToolNames(activeAgent) });
      try {
        const onStatus = (label, kind) => {
          recordAgentEvent(assistant, kind || "status", label);
          pulse(label, agentToolNames(activeAgent).join(" · "));
        };
        const onFinalToken = (delta) => {
          if (!assistant.firstTokenAt) assistant.firstTokenAt = Date.now();
          assistant.content += delta;
          assistant.generatedTokens = (assistant.generatedTokens || 0) + estimateGeneratedTokens(delta);
          assistant.tpsSource = "estimated";
          const elapsed = (Date.now() - assistant.firstTokenAt) / 1000;
          if (elapsed > 0.35) {
            assistant.tps = Math.max(1, Math.round((assistant.generatedTokens || 0) / elapsed));
            setTpsDisplay(assistant.tps);
          }
          updateLastBubble(assistant.content);
        };
        await runAgentLoop({ agent: activeAgent, assistant, signal: ctrl.signal, onStatus, onFinalToken });
      } catch (err) {
        recordAgentEvent(assistant, "error", err?.message || String(err || "Agent failed"));
        if (err.name !== "AbortError") showError(err);
      }
      finishAgentRun(assistant);
      flushPendingBubbleUpdate();
    } else {
      // ── Plain chat / route-based search (no agent selected) ───────────
      let toolContext = null;
      if (injectionEnabled && route?.route) {
        const routeDef = ROUTE_DEFS[route.route];
        try {
          if (routeDef?.useSearch === true) {
            pulse("Searching the web…");
            const tav = await tavilySearch(seedText);
            if (tav && (tav.results.length || tav.answer)) {
              const parts = [];
              if (tav.answer) parts.push(tav.answer);
              if (tav.results.length) {
                parts.push(tav.results.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n"));
                tav.results.forEach(r => addToRAG(r.title, r.snippet, `tavily:${r.url}`));
                if (tav.answer) addToRAG("Tavily synthesized answer", tav.answer, `tavily:answer:${seedText.slice(0,60)}`);
              }
              toolContext = `Sources:\n${parts.join("\n\n")}`;
            } else {
              const goog = await googleSearch(seedText);
              if (goog && goog.length) {
                goog.forEach(r => addToRAG(r.title, r.snippet, `google:${r.url}`));
                toolContext = `Sources:\n` + goog.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n");
              } else {
                const wiki = await wikipediaSearch(seedText);
                if (wiki.length) {
                  wiki.forEach(r => addToRAG(r.title, r.snippet, `wiki:${r.url}`));
                  toolContext = `Sources:\n` + wiki.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n");
                }
              }
            }
          } else if (routeDef?.useSearch === "pubmed") {
            pulse("Searching PubMed…");
            const papers = await pubmedSearch(seedText);
            if (papers.length) {
              papers.forEach(p => addToRAG(p.title, `${p.authors} (${p.year}). ${p.abstract}`, `pubmed:${p.pmid || p.doi || p.url}`));
              toolContext = `Papers:\n` +
                papers.map((p,i)=>`${i+1}. ${p.title} (${p.year}${p.pmid ? `, PMID:${p.pmid}` : ""}): ${p.abstract}`).join("\n\n");
            }
          }
        } catch (e) { console.warn("Route search failed:", e); }

        if (!_isExternalModel) {
          const ragChunks = await queryRAGMerged(seedText);
          if (ragChunks.length) {
            const ragBlock = `Background:\n` + ragChunks.map((c,i) => `${i+1}. ${c.title}: ${c.text}`).join("\n\n");
            toolContext = toolContext ? `${toolContext}\n\n${ragBlock}` : ragBlock;
          }
        }
      }
      try {
        await streamChat(assistant, toolContext, route);
      } finally {
        flushPendingBubbleUpdate();
      }
    }

    assistant.completedAt = Date.now();
    if (assistant.startedAt) assistant.durationMs = assistant.completedAt - assistant.startedAt;
    if ((assistant.tpsSource === "estimated" || !assistant.tps) && assistant.content) {
      const elapsed = ((assistant.completedAt || Date.now()) - (assistant.firstTokenAt || assistant.startedAt || Date.now())) / 1000;
      if (elapsed > 0) {
        const tokens = assistant.generatedTokens || estimateGeneratedTokens(assistant.content);
        assistant.tps = Math.max(1, Math.round(tokens / elapsed));
        assistant.tpsSource = assistant.tpsSource || "estimated";
        setTpsDisplay(assistant.tps);
      }
    }
    state.streaming = false;
    sendBtn.textContent = "Send";
    // Light up HashNotch — "HashCortX finished", like the iPhone island.
    // Fires once per turn for every path (cloud, local, agent, code mode).
    HC.notch?.finished((modelEl.value || "").split(":").pop());
    if (tpsBtn && !assistant.tps) {
      tpsBtn.className = "ping-btn tps-btn";
      if (tpsVal) tpsVal.textContent = "— t/s";
    }
    // Auto-extract facts from the assistant's final reply (covers "noted, you live in X" etc.)
    try { if (assistant.content) memAutoExtractFromAssistant(assistant.content); } catch {}
    render();
    persistCurrentChat();
    const current = activeChatList().find(c => c.id === state.currentChatId);
    if (current) setActiveTitle(current.title);
  }

  async function regenerateFromAssistant(idx) {
    if (state.streaming) return;
    const target = state.messages[idx];
    if (!target || target.role !== "assistant") return;
    const base = state.messages.slice(0, idx).map(cloneMessage);
    const user = lastUserMessage(base);
    if (!user) return;
    state.currentChatId = uid();
    state.messages = base;
    state.pendingImages = [];
    state.pendingFiles = [];
    clearReplyTo();
    clearEditingMessage();
    await runAssistantTurn(normalizeUserMessageText(user), !!(user.images?.length || user.attachments?.length), { diffFrom: target.content || "" });
  }

  // ========= Send =========
  async function sendCompare() {
    if (state.streaming) return;
    const text = input.value.trim();
    if (!text && state.pendingImages.length === 0 && state.pendingFiles.length === 0) return;
    const leftModel = modelEl.value;
    const rightModel = compareModelEl.value;
    if (!leftModel || !rightModel) { await themedAlert("Select two models for comparison first.", "Compare"); return; }
    if (leftModel === rightModel) { await themedAlert("Pick a different second model for comparison.", "Compare"); return; }

    let displayContent = text;
    const fileBlocks = buildAttachedFileContext(state.pendingFiles);
    let replyMeta = null;
    if (state.replyTo && state.messages[state.replyTo.idx]) {
      replyMeta = { idx: state.replyTo.idx, role: state.messages[state.replyTo.idx].role, preview: state.replyTo.preview };
      displayContent = buildReplyWrappedContent(displayContent, replyMeta);
    }
    const userMsg = {
      role: "user",
      content: displayContent,
      _modelContent: fileBlocks ? (displayContent + fileBlocks) : undefined,
      images: state.pendingImages.map(i => i.dataUrl),
      attachments: state.pendingFiles.map(f => ({ name: f.name, kind: f.kind || "file", pages: f.pages, chars: f.chars, extracted: f.extracted })),
      _imgBase64: state.pendingImages.map(i => i.base64),
      ...(replyMeta ? { replyTo: replyMeta } : {}),
    };
    state.messages.push(userMsg);
    ensureChatIdForCurrentMessages();
    const messages = buildOllamaMessages();
    const hasAttachedFileContext = messages.some(m => /\[ATTACHED FILES - use this content when answering\]/.test(m.content || ""));
    const numCtx = hasAttachedFileContext ? 16384 : (HISTORY_LIMIT > 0 ? 8192 : 4096);
    const compareMsg = {
      role: "assistant",
      content: "",
      startedAt: Date.now(),
      compare: {
        left: { model: leftModel, content: "", done: false, error: "" },
        right: { model: rightModel, content: "", done: false, error: "" },
      },
    };
    state.messages.push(compareMsg);
    state.pendingImages = [];
    state.pendingFiles = [];
    clearReplyTo();
    input.value = ""; input.style.height = "auto";
    renderPending();
    state.streaming = true;
    sendBtn.textContent = "Stop";
    if (tpsBtn) tpsBtn.className = "ping-btn tps-btn split-tps streaming";
    if (tpsVal) tpsVal.textContent = "L… · R…";
    const ctrl = new AbortController();
    state.abort = ctrl;
    render();
    const idx = state.messages.indexOf(compareMsg);
    const temperature = (v => Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.7)(parseFloat(tempEl.value));
    const runSide = async (side) => {
      const branch = compareMsg.compare[side];
      try {
        await streamWithModelValue({
          modelValue: branch.model,
          messages: messages.map(m => ({ ...m, images: m.images ? m.images.slice() : undefined })),
          signal: ctrl.signal,
          temperature,
          numCtx,
          onStats: (stats) => {
            if (stats?.eval_count && stats?.eval_duration) {
              branch.tps = Math.max(1, Math.round(stats.eval_count / (stats.eval_duration / 1e9)));
              branch.tpsSource = "ollama";
              setSplitTpsDisplay(compareMsg.compare);
            }
          },
          onToken: (delta) => {
            if (!branch.firstTokenAt) branch.firstTokenAt = Date.now();
            branch.content += delta;
            branch.generatedTokens = (branch.generatedTokens || 0) + estimateGeneratedTokens(delta);
            const elapsed = (Date.now() - branch.firstTokenAt) / 1000;
            if (elapsed > 0.35 && !branch.tpsSource) {
              branch.tps = Math.max(1, Math.round((branch.generatedTokens || 0) / elapsed));
              branch.tpsSource = "estimated";
              setSplitTpsDisplay(compareMsg.compare);
            }
            updateComparePane(idx, side, branch);
          },
        });
      } catch (err) {
        if (err.name !== "AbortError") branch.error = err.message || String(err);
      } finally {
        if (!branch.tps && branch.content) {
          const elapsed = ((Date.now()) - (branch.firstTokenAt || compareMsg.startedAt || Date.now())) / 1000;
          if (elapsed > 0) {
            branch.tps = Math.max(1, Math.round((branch.generatedTokens || estimateGeneratedTokens(branch.content)) / elapsed));
            branch.tpsSource = branch.tpsSource || "estimated";
            setSplitTpsDisplay(compareMsg.compare);
          }
        }
        branch.done = true;
        updateComparePane(idx, side, branch);
      }
    };
    await Promise.allSettled([runSide("left"), runSide("right")]);
    compareMsg.completedAt = Date.now();
    compareMsg.durationMs = compareMsg.completedAt - compareMsg.startedAt;
    compareMsg.content = [
      `## ${cloudModelLabel(leftModel) || leftModel}`,
      compareMsg.compare.left.error || compareMsg.compare.left.content || "",
      `## ${cloudModelLabel(rightModel) || rightModel}`,
      compareMsg.compare.right.error || compareMsg.compare.right.content || "",
    ].join("\n\n");
    state.streaming = false;
    sendBtn.textContent = "Send";
    setSplitTpsDisplay(compareMsg.compare);
    if (tpsBtn) tpsBtn.classList.remove("streaming");
    render();
    persistCurrentChat();
  }

  async function send() {
    if (state.streaming) return;
    if (state.compareMode) {
      await sendCompare();
      return;
    }
    // Stop dictation the moment we commit to sending
    const text = input.value.trim();
    const editingSource = state.editing ? state.messages[state.editing.idx] : null;
    const editingHasAssets = !!(editingSource?.images?.length || editingSource?.attachments?.length);
    if (!text && state.pendingImages.length === 0 && state.pendingFiles.length === 0 && !editingHasAssets) return;
    if (!modelEl.value) { await themedAlert("Select a model first.\n• Local: on the local host, run: ollama pull llama3.2\n• Cloud: add a free API key in Settings → Cloud Models.", "Model Required"); return; }

    // Separate what the user sees (their raw typed text + nice attachment
    // chips) from what the model sees (typed text + extracted file content).
    // Previously both were the same, which is why attached PDFs rendered
    // as a wall of raw text in the user's own bubble.
    let displayContent = text;
    const fileBlocks = buildAttachedFileContext(state.pendingFiles);
    let replyMeta = null;
    if (state.replyTo && state.messages[state.replyTo.idx]) {
      replyMeta = { idx: state.replyTo.idx, role: state.messages[state.replyTo.idx].role, preview: state.replyTo.preview };
      displayContent = buildReplyWrappedContent(displayContent, replyMeta);
    }
    const hadAttachments = state.pendingImages.length > 0 || state.pendingFiles.length > 0;
    if (state.editing) {
      const editedIdx = state.editing.idx;
      state.currentChatId = uid();
      state.messages = prepareEditBranch(editedIdx, text);
      state.pendingImages = [];
      state.pendingFiles = [];
      clearReplyTo();
      clearEditingMessage();
    } else {
      const userMsg = {
        role: "user",
        content: displayContent,
        _modelContent: fileBlocks ? (displayContent + fileBlocks) : undefined,
        images: state.pendingImages.map(i => i.dataUrl),
        attachments: state.pendingFiles.map(f => ({
          name: f.name,
          kind: f.kind || "file",
          pages: f.pages,
          chars: f.chars,
          extracted: f.extracted,
        })),
        _imgBase64: state.pendingImages.map(i => i.base64),
        ...(replyMeta ? { replyTo: replyMeta } : {}),
      };
      state.messages.push(userMsg);
      state.pendingImages = [];
      state.pendingFiles = [];
      clearReplyTo();
    }
    input.value = ""; input.style.height = "auto";
    renderPending();

    // Trigger the PCB traces pulse — lines glow, then fade back
    document.body.classList.add("pulse-traces");
    clearTimeout(window._pulseTimer);
    window._pulseTimer = setTimeout(() => document.body.classList.remove("pulse-traces"), 1400);

    const seedMsg = lastUserMessage(state.messages);
    await runAssistantTurn(normalizeUserMessageText(seedMsg), hadAttachments || !!(seedMsg?.images?.length || seedMsg?.attachments?.length));
  }

  function abort() { state.abort?.abort(); }

  async function streamChat(assistant, toolContext = null, route = null) {
    clearError();
    const messages = buildOllamaMessages();
    if (toolContext) {
      // Embed context directly into the last user message — local models
      // trained to say "I can't access the internet" will ignore a separate
      // system message but cannot ignore content in the user turn itself.
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        last.content = `${toolContext}\n\nQuestion: ${last.content}`;
      } else {
        messages.splice(messages.length - 1, 0, { role: "system", content: toolContext });
      }
    }
    const ctrl = new AbortController();
    state.abort = ctrl;
    const temperature = (v => Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.7)(parseFloat(tempEl.value));
    const hasAttachedFileContext = messages.some(m => /\[ATTACHED FILES - use this content when answering\]/.test(m.content || ""));
    const numCtx = hasAttachedFileContext ? 16384 : (HISTORY_LIMIT > 0 ? 8192 : 4096);
    const def = route ? ROUTE_DEFS[route.route] : null;
    const useNvidia = def?.backend === "nvidia";
    const isCloud = modelEl.value.startsWith("cloud:");
    const onCloudToken = (delta) => {
      if (!assistant.firstTokenAt) assistant.firstTokenAt = Date.now();
      assistant.content += delta;
      assistant.generatedTokens = (assistant.generatedTokens || 0) + estimateGeneratedTokens(delta);
      assistant.tpsSource = "estimated";
      const elapsed = (Date.now() - assistant.firstTokenAt) / 1000;
      if (elapsed > 0.35) {
        assistant.tps = Math.max(1, Math.round((assistant.generatedTokens || 0) / elapsed));
        setTpsDisplay(assistant.tps);
      }
      updateLastBubble(assistant.content);
    };

    try {
      if (isCloud) {
        // ── Direct cloud model (user chose from the Cloud Models dropdown) ───
        // Privacy guard: if "Local only" is enabled, confirm before sending to cloud.
        if (privacyLocalEl.checked) {
          const ok = await themedConfirm(
            "⚠️ Privacy: Local only is enabled.\n\n" +
            "You selected a cloud model — this will send your message to an external server.\n\n" +
            "Send anyway?",
            "Privacy Check"
          );
          if (!ok) {
            assistant.content = "_(Blocked by Privacy: Local only)_";
            return;
          }
        }
        let currentModelValue = modelEl.value;
        const triedModels = new Set();
        let failoverCount = 0;
        while (true) {
          const { provider, modelId } = parseCloudModel(currentModelValue);
          if (!provider || !modelId) throw new Error("Invalid cloud model value: " + currentModelValue);
          assistant.model = currentModelValue;
          try {
            if (isImageGenModel(currentModelValue)) {
              assistant.firstTokenAt = Date.now();
              showImageGenLoading();
              const { text, images } = await generateCloudImage(modelId, messages, ctrl.signal);
              assistant.content = text;
              assistant.images = images;
            } else {
              await streamCloudModel(provider, modelId, messages, temperature, onCloudToken, ctrl.signal);
            }
            break; // success
          } catch (err) {
            if (err.name === "AbortError") throw err;
            const msg = err?.message || String(err);
            const isRetriable = /rate limit|overloaded|server error|429|503|529|5\d\d/.test(msg);
            if (!isRetriable) throw err;
            triedModels.add(currentModelValue);
            const fallback = getBestFailoverModel(currentModelValue, triedModels);
            if (!fallback) throw err; // no fallback available — surface original error
            failoverCount++;
            // Brief status in bubble before retrying
            assistant.content = `_(Failover ${failoverCount}: ${cloudModelLabel(currentModelValue)} → ${fallback.shortLabel || fallback.label})_\n\n`;
            updateLastBubble(assistant.content);
            currentModelValue = fallback.value;
          }
        }
      } else if (useNvidia) {
        if (privacyLocalEl.checked) {
          assistant.content = "_(Blocked by Privacy: Local only)_";
          return;
        }
        if (!(nvidiaKeyEl.value || "").trim()) {
          throw new Error("NVIDIA route picked but no API key set in Settings.");
        }
        await nvidiaStreamChat({
          messages,
          model: (nvidiaModelEl?.value) || "meta/llama-3.3-70b-instruct",
          temperature,
          onToken: onCloudToken,
          signal: ctrl.signal,
        });
      } else {
        const host = safeHost();
        trackLocalModel(modelEl.value);
        const res = await fetch(`${host}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelEl.value,
            stream: true,
            keep_alive: -1,
            // Attachments need extra room; otherwise extracted PDF/file text can be truncated before the model reads it.
            options: { temperature, num_ctx: numCtx },
            messages,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const parseOllamaLine = (line) => {
          if (!line.trim()) return;
          try {
            const evt = JSON.parse(line);
            if (evt.message?.content) {
              if (!assistant.firstTokenAt) assistant.firstTokenAt = Date.now();
              assistant.content += evt.message.content;
              updateLastBubble(assistant.content);
            }
            if (evt.done && evt.eval_count && evt.eval_duration) {
              const tps = Math.round(evt.eval_count / (evt.eval_duration / 1e9));
              assistant.tps = tps;
              setTpsDisplay(tps);
            }
          } catch {}
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) parseOllamaLine(line);
        }
        parseOllamaLine(buf);
      }
    } catch (err) {
      if (err.name !== "AbortError") showError(err);
    } finally {
      // If the stream completed but produced no content, surface a clear error
      // instead of leaving an empty bubble with no indication of what happened.
      if (!assistant.content && !assistant.images?.length) {
        const last = msgs.querySelector(".msg.assistant:last-of-type .bubble");
        if (last) {
          last.classList.remove("thinking-bubble");
          last.innerHTML = `<span style="color:var(--error,#f87171);font-style:italic;">No response received — check that your model is loaded and your API key is set.</span>`;
        }
        assistant.content = "[No response]";
      }
    }
  }

  // RAF-throttled bubble updater.
  // During streaming we write raw text (textContent) — zero HTML parsing, zero
  // markdown overhead per token. formatContent runs exactly once at the end via
  // the post-stream render() call, so the final view is still fully formatted.
  let _rafPending = false;
  let _rafId = null;
  let _pendingBubbleText = "";
  function writeLastBubbleText() {
    const last = msgs.querySelector(".msg.assistant:last-of-type .bubble");
    if (last) {
      last.classList.remove("thinking-bubble");
      const msg = state.messages[state.messages.length - 1];
      if (msg?.diffFrom) {
        last.innerHTML = `<pre style="white-space:pre-wrap;margin:0;background:transparent;border:0;padding:0">${escapeHtml(_pendingBubbleText)}</pre>${diffBlockHtml(msg.diffFrom, _pendingBubbleText, true)}`;
      } else {
        last.textContent = _pendingBubbleText;   // raw — no escapeHtml, no regex
      }
      if (pinned) msgs.scrollTop = msgs.scrollHeight;
    }
  }
  // Show a spinner in the last assistant bubble while an image is generating.
  // Uses innerHTML with a hardcoded string — no user data interpolated.
  function showImageGenLoading() {
    const last = msgs.querySelector(".msg.assistant:last-of-type .bubble");
    if (last) {
      last.innerHTML = `<div class="gen-img-loading"><div class="spinner"></div>Generating image with Nano Banana…</div>`;
      if (pinned) msgs.scrollTop = msgs.scrollHeight;
    }
  }
  function flushPendingBubbleUpdate() {
    if (_rafId != null) cancelAnimationFrame(_rafId);
    _rafId = null;
    if (_rafPending) {
      _rafPending = false;
      writeLastBubbleText();
    }
    _pendingBubbleText = "";  // clear stale text so it can never bleed onto the next message
  }
  function updateLastBubble(text) {
    _pendingBubbleText = text;
    if (_rafPending) return;          // already scheduled for this frame
    _rafPending = true;
    _rafId = requestAnimationFrame(() => {
      _rafPending = false;
      _rafId = null;
      writeLastBubbleText();
    });
  }

  function updateComparePane(idx, side, branch) {
    const pane = msgs.querySelector(`.msg[data-idx="${idx}"] [data-compare-side="${side}"]`);
    if (!pane) return;
    const status = pane.querySelector(".compare-status");
    const body = pane.querySelector(".compare-body");
    if (status) status.textContent = branch.error ? "error" : branch.done ? "done" : "streaming";
    if (body) body.textContent = branch.error || branch.content || "";
    if (pinned) msgs.scrollTop = msgs.scrollHeight;
  }

  async function streamWithModelValue({ modelValue, messages, onToken, onStats, signal, temperature, numCtx }) {
    if (!modelValue) throw new Error("No model selected.");
    if (modelValue.startsWith("cloud:")) {
      if (privacyLocalEl.checked) throw new Error("Blocked by Privacy: Local only.");
      const { provider, modelId } = parseCloudModel(modelValue);
      if (!provider || !modelId) throw new Error("Invalid cloud model value: " + modelValue);
      if (isImageGenModel(modelValue)) throw new Error("Image generation models are not supported in compare mode.");
      await streamCloudModel(provider, modelId, messages, temperature, onToken, signal);
      return;
    }
    const host = safeHost();
    trackLocalModel(modelValue);
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelValue,
        stream: true,
        keep_alive: -1,
        options: { temperature, num_ctx: numCtx },
        messages,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const parseLine = (line) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line);
        if (evt.message?.content) onToken(evt.message.content);
        if (evt.done && typeof onStats === "function") onStats(evt);
      } catch {}
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) parseLine(line);
    }
    parseLine(buf);
  }

  // HISTORY_LIMIT is declared near the memory-depth slider block above.
  // 0 = only current user message + system prompt, no history.
  // buildOllamaMessages() uses the live value that applyMemoryDepth() keeps updated.

  function buildOllamaMessages() {
    const arr = [];
    // Agent's system prompt takes precedence over the Settings one.
    const agent = getActiveAgent();
    const projectInstructions = (currentProject()?.instructions || "").trim();
    const baseSys = (agent && agent.systemPrompt) ? agent.systemPrompt.trim() : systemEl.value.trim();
    const modeSys = isForgeMode() ? FORGE_ARCHITECT_PROMPT : "";
    const sys = [baseSys, modeSys, projectInstructions ? `[PROJECT INSTRUCTIONS]\n${projectInstructions}` : ""].filter(Boolean).join("\n\n");
    if (sys) arr.push({ role: "system", content: sys });

    const all = state.messages;
    // Strip the trailing empty assistant placeholder (the streaming target) so
    // HISTORY_LIMIT correctly counts only real, completed messages.
    const tail = all[all.length - 1];
    const base = (tail?.role === "assistant" && !tail?.content)
      ? all.slice(0, -1) : all;

    // Grab [last HISTORY_LIMIT history messages] + [current user message].
    // With HISTORY_LIMIT=0 this is just the single current user message.
    const start = Math.max(0, base.length - 1 - HISTORY_LIMIT);
    let lastUserIdx = -1;
    for (let i = base.length - 1; i >= 0; i--) {
      if (base[i].role === "user") { lastUserIdx = i; break; }
    }

    for (let i = start; i < base.length; i++) {
      const m = base[i];
      // Prefer `_modelContent` (has extracted file text) over display-only content.
      const entry = { role: m.role, content: m._modelContent || m.content || "" };
      if (m._imgBase64?.length && i === lastUserIdx) {
        entry.images = m._imgBase64;
        if (!entry.content) entry.content = "Describe what you see in this image.";
      }
      arr.push(entry);
    }
    return arr;
  }

  function compactNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(Math.max(0, Math.round(n)));
  }

  function estimatePromptTokens(messages) {
    const chars = JSON.stringify(messages.map(m => ({
      role: m.role,
      content: m.content || "",
      images: m.images ? `[${m.images.length} image(s)]` : undefined,
    }))).length;
    return Math.ceil(chars / 3.8);
  }

  function currentPendingModelContent() {
    const text = input.value.trim();
    const fileBlocks = buildAttachedFileContext(state.pendingFiles);
    if (!text && !fileBlocks && !state.pendingImages.length) return "";
    return fileBlocks ? text + fileBlocks : text;
  }

  function updateContextIndicator() {
    if (!contextWindowEl || !contextTextEl || !contextFillEl) return;
    const messages = buildOllamaMessages();
    const pendingContent = currentPendingModelContent();
    if (pendingContent || state.pendingImages.length) {
      const entry = { role: "user", content: pendingContent || "Describe what you see in this image." };
      if (state.pendingImages.length) entry.images = state.pendingImages.map(i => i.base64);
      messages.push(entry);
    }
    const hasAttachedFileContext = messages.some(m => /\[ATTACHED FILES - use this content when answering\]/.test(m.content || ""));
    const maxTokens = hasAttachedFileContext ? 16384 : (HISTORY_LIMIT > 0 ? 8192 : 4096);
    const used = estimatePromptTokens(messages);
    const pct = Math.min(100, Math.round((used / maxTokens) * 100));
    contextTextEl.textContent = `Context ${pct}%`;
    contextFillEl.style.setProperty("--ctx", pct + "%");
    contextWindowEl.classList.toggle("warn", pct >= 70 && pct < 90);
    contextWindowEl.classList.toggle("hot", pct >= 90);
    contextWindowEl.title = `Estimated context: ${compactNumber(used)} / ${compactNumber(maxTokens)} tokens`;
  }

  // ========= Agent tools =========
  async function wikipediaSearch(query, limit = 3) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${limit}&utf8=1`;
      const r = await fetch(searchUrl, { referrerPolicy: "no-referrer" });
      if (!r.ok) return [];
      const data = await r.json();
      const titles = (data.query?.search || []).map(s => s.title);
      if (!titles.length) return [];
      // Fetch extracts in one call
      const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`;
      const e = await fetch(extractUrl, { referrerPolicy: "no-referrer" });
      const ed = await e.json();
      const pages = Object.values(ed.query?.pages || {});
      return pages.map(p => ({
        title: p.title,
        snippet: (p.extract || "").slice(0, 400),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((p.title || "").replace(/ /g, "_"))}`
      })).filter(x => x.snippet);
    } catch { return []; }
  }

  // Tavily — purpose-built for LLMs. Returns clean snippets + a synthesized
  // answer string. CORS-friendly (POST to api.tavily.com directly from browser).
  // Key is stored only in localStorage and only ever sent to api.tavily.com.
  // Timezone resolved locally via Intl.DateTimeFormat — no network call, no IP leak.
  let _cachedTz = "";

  async function getCurrentDateString() {
    // Use the browser's built-in timezone API — accurate, instant, zero network cost,
    // and no IP address leak (previously this fetched worldtimeapi.org).
    if (!_cachedTz) {
      _cachedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }

    // Always use live Date() — instantaneous, NTP-accurate, never stale.
    const now = new Date();
    const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `Today is ${dateStr}. Current time: ${timeStr} (${_cachedTz}).`;
  }

  async function tavilySearch(query, limit = 5) {
    const key = (tavilyKeyEl.value || "").trim();
    if (!key) return null;
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query,
          search_depth: "basic",
          include_answer: true,
          max_results: limit,
        }),
        signal: makeSignal(12000),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return {
        answer: data.answer || "",
        results: (data.results || []).map(it => ({
          title: it.title || "",
          snippet: (it.content || "").slice(0, 400),
          url: it.url || "",
          score: it.score ?? null,
        })),
      };
    } catch { return null; }
  }

  async function googleSearch(query, limit = 5) {
    const key = googleKeyEl.value.trim();
    const cx = googleCxEl.value.trim();
    if (!key || !cx) return null;
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${limit}`;
      const r = await fetch(url, { referrerPolicy: "no-referrer" });
      if (!r.ok) return null;
      const data = await r.json();
      return (data.items || []).map(it => ({
        title: it.title,
        snippet: it.snippet || "",
        url: it.link
      }));
    } catch { return null; }
  }

  // Allowed URL prefixes for the fetch_url agent tool.
  // Block file://, javascript:, data:, private/local ranges, link-local
  // (169.254.x.x / cloud metadata), and common metadata hostnames.
  // When the HashCortx server is used with a Backend sync token, fetch_url uses
  // POST /api/backend/fetch-url (DNS + IP checks on the server). Without that,
  // this URL gate still applies to direct browser fetches only.
  function isSafeExternalUrl(raw) {
    let parsed;
    try { parsed = new URL(raw); } catch { return false; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
    const h = parsed.hostname.toLowerCase();
    if (h === "localhost" || h === "0.0.0.0") return false;
    if (/^127\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^192\.168\./.test(h)) return false;
    if (/^169\.254\./.test(h)) return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
    if (h === "metadata.google.internal" || h === "metadata.goog") return false;
    if (h === "::1" || h === "[::1]" || h.startsWith("[::1")) return false;
    if (h.startsWith("[fe80:") || h.startsWith("[fe80::")) return false;
    if (/^\[f[cd][0-9a-f:/]/i.test(h)) return false;
    if (/^::ffff:127\./i.test(h)) return false;
    return true;
  }

  async function fetchUrl(url) {
    if (!isSafeExternalUrl(url)) return null;
    const stripForAgent = (text) =>
      String(text || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);

    async function viaServerProxy() {
      try {
        const r = await fetch("/api/backend/fetch-url", {
          method: "POST",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
          body: JSON.stringify({ url }),
          signal: makeSignal(12000),
        });
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        if (j && j.ok && typeof j.text === "string") return j.text;
        return null;
      } catch {
        return null;
      }
    }

    if (backendFetchProxyAvailable) {
      const hasTok = !!(backendSyncTokenEl?.value || "").trim();
      if (backendAuthRequired && hasTok) {
        const proxied = await viaServerProxy();
        if (proxied != null) return proxied;
        return null;
      }
      if (!backendAuthRequired) {
        const proxied = await viaServerProxy();
        if (proxied != null) return proxied;
      }
      if (backendAuthRequired && !hasTok) {
        console.warn(
          "[fetch_url] Server uses a bearer token — set Backend sync token so fetches use the hardened proxy (blocks rebinding to private IPs)."
        );
        return null;
      }
    }

    try {
      const r = await fetch(url, {
        referrerPolicy: "no-referrer",
        signal: makeSignal(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      return stripForAgent(text);
    } catch {
      return null;
    }
  }

  function extractUrls(text) {
    const re = /https?:\/\/[^\s)<>"']+/g;
    return (text.match(re) || []).slice(0, 3);
  }

  // Europe PMC indexes PubMed + preprints + life-sciences journals, returns JSON with abstracts, CORS-friendly.
  async function pubmedSearch(query, limit = 5) {
    try {
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${limit}&sort=CITED+desc`;
      const r = await fetch(url, { referrerPolicy: "no-referrer" });
      if (!r.ok) return [];
      const data = await r.json();
      const results = (data.resultList?.result || []).map(p => ({
        title: p.title || "",
        authors: p.authorString || "",
        journal: p.journalTitle || p.bookOrReportDetails?.publisher || "",
        year: p.pubYear || "",
        abstract: (p.abstractText || "").slice(0, 500),
        pmid: p.pmid || "",
        doi: p.doi || "",
        source: p.source || "",
        citations: p.citedByCount ?? null,
        isReview: p.pubTypeList?.pubType?.some?.(t => /review/i.test(t)) || false,
        url: p.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`
          : (p.doi ? `https://doi.org/${p.doi}` : `https://europepmc.org/article/${p.source || 'MED'}/${p.id || ''}`)
      })).filter(x => x.title && x.abstract);
      return results;
    } catch { return []; }
  }

  // ========= Query rewriter =========
  // When an agent with tools is active, we first ask a small fast local model
  // to turn the user's conversational message into a short keyword search query.
  // This keeps the model offline — it's still just a local Ollama call — but
  // gives the browser a cleaner query to hand to Europe PMC / Wikipedia / Google.
  async function rewriteForSearch(userText) {
    const rewriter = (rewriterEl?.value || "").trim();
    if (!rewriter) return null; // feature off — caller will use raw text
    const host = safeHost();
    const prompt =
`You are a search query rewriter. Convert the user's message into a concise keyword search query suitable for a search engine or research database (PubMed, Wikipedia, Google). Rules:
- Return ONLY the query text. No quotes, no explanation, no prefix.
- Keep it short (3–10 keywords).
- Drop filler words ("what do you think about", "can you tell me", "please").
- Keep proper nouns, drug names, gene names, acronyms, years exactly as written.
- Do not add information the user did not provide.

User message:
${userText}

Search query:`;
    try {
      const r = await fetch(`${host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: rewriter,
          prompt,
          stream: false,
          keep_alive: -1,
          options: { temperature: 0.2, num_predict: 60 }
        }),
        signal: makeSignal(8000) // don't block research for more than 8s
      });
      if (!r.ok) return null;
      const j = await r.json();
      let q = (j.response || "").trim();
      // Strip common wrappers the rewriter model might add anyway
      q = q.replace(/^["'`]+|["'`]+$/g, "");
      q = q.replace(/^(search query:|query:)\s*/i, "");
      q = q.split(/\r?\n/)[0].trim();
      if (!q || q.length < 2) return null;
      if (q.length > 200) q = q.slice(0, 200);
      return q;
    } catch { return null; }
  }

  async function runAgentTools(agent, userText, searchQuery = null) {
    if (!agent || !agent.tools?.length) return null;
    // The query used for API lookups: rewritten if available, else raw.
    // URL extraction always uses the raw userText so pasted links aren't lost.
    const q = (searchQuery && searchQuery.trim()) || userText;
    const pieces = [];
    // Web search — prefer Tavily (cleaner snippets, built for LLMs), then Google CSE, then Wikipedia.
    if (agent.tools.includes("web_search")) {
      const tav = await tavilySearch(q);
      if (tav && (tav.results.length || tav.answer)) {
        const tavParts = [];
        if (tav.answer) tavParts.push(tav.answer);
        if (tav.results.length) {
          tavParts.push(tav.results.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n"));
          tav.results.forEach(r => addToRAG(r.title, r.snippet, `tavily:${r.url}`));
          if (tav.answer) addToRAG("Tavily synthesized answer", tav.answer, `tavily:answer:${q.slice(0,60)}`);
        }
        pieces.push(tavParts.join("\n\n"));
      } else {
        const results = await googleSearch(q);
        if (results && results.length) {
          results.forEach(r => addToRAG(r.title, r.snippet, `google:${r.url}`));
          pieces.push(results.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n"));
        } else if (!agent.tools.includes("wikipedia")) {
          const wiki = await wikipediaSearch(q);
          if (wiki.length) {
            wiki.forEach(r => addToRAG(r.title, r.snippet, `wiki:${r.url}`));
            pieces.push(wiki.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n"));
          }
        }
      }
    }
    if (agent.tools.includes("wikipedia")) {
      const wiki = await wikipediaSearch(q);
      if (wiki.length) {
        wiki.forEach(r => addToRAG(r.title, r.snippet, `wiki:${r.url}`));
        pieces.push(wiki.map((r,i)=>`${i+1}. ${r.title}: ${r.snippet}`).join("\n"));
      }
    }
    if (agent.tools.includes("fetch_url")) {
      const urls = extractUrls(userText);
      for (const u of urls) {
        const content = await fetchUrl(u);
        if (content) {
          addToRAG(u, content, `fetch:${u}`);
          pieces.push(`Page (${u}):\n${content}`);
        }
      }
    }
    if (agent.tools.includes("pubmed")) {
      const papers = await pubmedSearch(q);
      if (papers.length) {
        papers.forEach(p => addToRAG(p.title, `${p.authors} (${p.year}). ${p.abstract}`, `pubmed:${p.pmid || p.doi || p.url}`));
        pieces.push(papers.map((p,i)=>
          `${i+1}. ${p.title} (${p.year}${p.pmid ? `, PMID:${p.pmid}` : ""}): ${p.abstract}`
        ).join("\n\n"));
      }
    }
    if (!pieces.length) return null;
    return `Sources:\n${pieces.join("\n\n")}`;
  }

  // =========================================================================
  // AGENT 2.0 — Real tool-calling loop. Memory. Multi-step. Every provider.
  // =========================================================================
  // Design notes:
  // • Tools follow the OpenAI function-calling JSON Schema. Ollama (≥0.3),
  //   Groq, NVIDIA NIM, and OpenRouter accept this format directly. For
  //   Gemini we translate to functionDeclarations on the fly.
  // • The loop is non-streaming for tool-using turns (each iteration is one
  //   round-trip), then writes the final assistant text into the bubble. We
  //   show live status pulses so the UX still feels responsive.
  // • If a model returns plain text without tool_calls (or doesn't support
  //   tools at all), we fall back gracefully to the legacy pre-fetch pattern
  //   so EVERY model still works — including small local ones and Gemma.
  // • Memory lives in localStorage under MEM_KEY. It is browser-local and
  //   never leaves the device unless the agent itself injects a recall
  //   into a cloud model's context.
  // -------------------------------------------------------------------------

  const MEM_KEY = "hashui_agent_memory_v1";
  const MEM_MAX_FACTS = 500;
  const AGENT_MAX_ITERATIONS = 8;        // hard cap on tool-call rounds
  const AGENT_TOOL_TIMEOUT_MS = 20000;   // per-tool wall-clock cap

  function memLoad() {
    try {
      const raw = localStorage.getItem(MEM_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(f => ({
        id: f.id || uid(),
        key: String(f.key || "").slice(0, 120),
        value: String(f.value || "").slice(0, 1200),
        ts: Number(f.ts) || Date.now(),
        projectId: f.projectId || DEFAULT_PROJECT_ID,
        scope: f.scope || (f.projectId && f.projectId !== DEFAULT_PROJECT_ID ? "project" : "personal"),
        confidence: Number.isFinite(f.confidence) ? f.confidence : 1,
        approved: f.approved !== false,
        source: f.source || "chat"
      })).filter(f => f.key && f.value) : [];
    } catch { return []; }
  }
  function memSave(arr) {
    try {
      while (arr.length > MEM_MAX_FACTS) arr.shift();
      localStorage.setItem(MEM_KEY, JSON.stringify(arr));
    } catch {}
  }
  function memAdd(key, value) {
    const k = String(key || "").trim().slice(0, 120);
    const v = String(value || "").trim().slice(0, 1200);
    if (!k || !v) return { ok: false, error: "key and value are required" };
    const arr = memLoad();
    const projectOnly = currentProject()?.memoryMode === "project";
    const projectId = projectOnly ? state.currentProjectId : DEFAULT_PROJECT_ID;
    // dedup by key — newest wins, but keep history
    const existing = arr.findIndex(f => f.key.toLowerCase() === k.toLowerCase() && (f.projectId || DEFAULT_PROJECT_ID) === projectId);
    if (existing >= 0) arr.splice(existing, 1);
    arr.push({ id: uid(), key: k, value: v, ts: Date.now(), projectId, scope: projectOnly ? "project" : "personal", confidence: 1, approved: true, source: "chat" });
    memSave(arr);
    return { ok: true, saved: { key: k, value: v, projectId } };
  }
  // Synonym groups so semantically related queries hit the same facts.
  // E.g. asking "what do I love" matches a saved "likes" / "favorite".
  const MEM_SYNONYMS = [
    ["love","loves","loved","loving","like","likes","liked","liking","favorite","favourite","favorites","favourites","favored","prefer","prefers","preferred","preference","preferences","enjoy","enjoys","enjoyed","fan","into","adore","adores"],
    ["hate","hates","hated","dislike","dislikes","disliked","loathe","loathes","despise","despises"],
    ["animal","animals","pet","pets","creature","creatures"],
    ["work","works","working","job","jobs","career","employer","company","employed","occupation","profession"],
    ["live","lives","living","home","city","town","reside","resides","based","located","location","address"],
    ["name","named","called","calls"],
    ["birthday","birth","born","dob","age"],
    ["family","spouse","wife","husband","partner","kid","kids","child","children","son","daughter","mom","dad","mother","father","brother","sister"],
    ["food","foods","eat","eats","cuisine","meal","dish","snack"],
    ["drink","drinks","beverage","coffee","tea","alcohol"],
    ["music","song","songs","band","artist","genre"],
    ["movie","movies","film","films","show","shows","series"],
    ["color","colors","colour","colours"],
    ["language","languages","speak","speaks","spoken"],
    ["project","projects","building","builds","working_on"],
    ["deadline","deadlines","due","by","ship","launch"],
    ["goal","goals","aim","aims","plan","plans","target","targets"],
    ["allergy","allergies","allergic","intolerant"]
  ];
  const MEM_SYN_MAP = (() => {
    const m = new Map();
    for (const group of MEM_SYNONYMS) for (const w of group) m.set(w, group);
    return m;
  })();
  // Cheap suffix stemmer — collapses plurals/verb tenses to a common stub.
  function memStem(w) {
    w = w.toLowerCase();
    if (w.length <= 3) return w;
    return w
      .replace(/(?:ing|edly|edness|ies|ied|ily|ment|ness|tion|sion)$/,"")
      .replace(/(?:ed|es|ly|er|or|al)$/,"")
      .replace(/s$/,"");
  }
  function memExpand(token) {
    const base = memStem(token);
    const out = new Set([token, base]);
    const grp = MEM_SYN_MAP.get(token) || MEM_SYN_MAP.get(base);
    if (grp) for (const w of grp) { out.add(w); out.add(memStem(w)); }
    return Array.from(out).filter(t => t.length >= 2);
  }
  function memRecall(query, limit = 6) {
    const projectOnly = currentProject()?.memoryMode === "project";
    const arr = memLoad().filter(f => {
      const pid = f.projectId || DEFAULT_PROJECT_ID;
      return projectOnly ? pid === state.currentProjectId : (pid === DEFAULT_PROJECT_ID || pid === state.currentProjectId);
    });
    if (!arr.length) return [];
    const q = String(query || "").toLowerCase();
    if (!q) return arr.slice(-limit).reverse(); // most recent if no query
    const rawTokens = q.split(/[^a-z0-9_]+/i).filter(t => t.length >= 2);
    // Build expanded token set with synonyms + stems
    const expanded = new Map(); // token -> weight
    for (const t of rawTokens) {
      for (const e of memExpand(t)) {
        const w = e === t ? t.length : Math.max(2, e.length * 0.7);
        expanded.set(e, Math.max(expanded.get(e) || 0, w));
      }
    }
    const scored = arr.map(f => {
      const blob = (f.key + " " + f.value).toLowerCase();
      const blobStem = blob.split(/[^a-z0-9_]+/).map(memStem).join(" ");
      let score = 0;
      for (const [tok, w] of expanded) {
        if (blob.includes(tok) || blobStem.includes(memStem(tok))) score += w;
      }
      // recency boost — facts under 7 days always get a small floor so they
      // survive the > 0 filter even when no keyword matches.
      const ageDays = (Date.now() - f.ts) / 86400000;
      const recency = 2 - ageDays * 0.05;
      score += ageDays < 7 ? Math.max(0.1, recency) : Math.max(0, recency);
      return { ...f, _score: score };
    });
    return scored.filter(f => f._score > 0).sort((a,b) => b._score - a._score).slice(0, limit);
  }
  // Lightweight auto-extractor: catches the most common "I am / I like / I
  // work at / I live in / my name is" patterns from a user message and
  // saves them silently. Runs on every user turn so memory is reliable
  // even when the model forgets to call remember_fact.
  function memAutoExtract(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 1200) return [];
    const saved = [];
    const push = (key, value) => {
      const v = String(value || "").trim().replace(/[.!?]+$/, "");
      if (!v || v.length > 200) return;
      memAdd(key, v);
      saved.push({ key, value: v });
    };
    const patterns = [
      // Identity
      [/\bmy\s+name\s+is\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, m => push("name", m[1])],
      [/\bi(?:'m|\s+am)\s+called\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, m => push("name", m[1])],
      [/\bcall\s+me\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, m => push("name", m[1])],
      [/\bthis\s+is\s+([A-Za-z][A-Za-z'\- ]{1,40})\s+speaking/i, m => push("name", m[1])],
      // Preferences
      [/\bi\s+(?:love|like|enjoy|adore|prefer|am\s+a\s+fan\s+of)\s+([^,.;!?\n]{2,80})/i, m => push("likes", m[1])],
      [/\bmy\s+favou?rite\s+([a-z ]{2,30}?)\s+(?:is|are)\s+([^,.;!?\n]{2,80})/i, m => push(`favorite_${m[1].trim().replace(/\s+/g,"_")}`, m[2])],
      [/\bi\s+(?:hate|dislike|can'?t\s+stand|loathe|despise)\s+([^,.;!?\n]{2,80})/i, m => push("dislikes", m[1])],
      [/\bi\s+(?:always|usually|tend\s+to)\s+([^,.;!?\n]{4,100})/i, m => push("habits", m[1])],
      [/\bi\s+(?:never|don'?t|do\s+not)\s+([^,.;!?\n]{4,100})/i, m => push("avoids", m[1])],
      // Work
      [/\bi\s+(?:work|am\s+working)\s+(?:at|for)\s+([^,.;!?\n]{2,80})/i, m => push("employer", m[1])],
      [/\bi(?:'m|\s+am)\s+(?:a|an)\s+([a-z ]{2,40}?)(?:\s+(?:at|for|in)\s+([^,.;!?\n]{2,80}))?/i, m => { push("role", m[1]); if (m[2]) push("employer", m[2]); }],
      [/\bi(?:'m|\s+am)\s+(?:building|making|developing|creating)\s+([^,.;!?\n]{4,120})/i, m => push("current_project", m[1])],
      // Place / origin
      [/\bi\s+live\s+in\s+([^,.;!?\n]{2,80})/i, m => push("location", m[1])],
      [/\bi(?:'m|\s+am)\s+(?:from|based\s+in)\s+([^,.;!?\n]{2,80})/i, m => push("origin", m[1])],
      [/\bi\s+speak\s+([^,.;!?\n]{2,80})/i, m => push("languages", m[1])],
      // Health
      [/\bi(?:'m|\s+am)\s+allergic\s+to\s+([^,.;!?\n]{2,80})/i, m => push("allergies", m[1])],
      [/\bmy\s+(birthday|dob)\s+(?:is\s+)?([^,.;!?\n]{2,40})/i, m => push("birthday", m[2])],
      [/\bi(?:'m|\s+am)\s+(\d{1,2})\s+years?\s+old/i, m => push("age", m[1])],
      // Project / paths the user mentions (great for coder mode)
      [/\bmy\s+project\s+(?:is\s+(?:at|in|located\s+at)\s+|root\s+is\s+)([^\s,.;!?\n]{4,200})/i, m => push("project_root", m[1])],
      [/\bworking\s+(?:directory|dir)\s+(?:is\s+)?([^\s,.;!?\n]{4,200})/i, m => push("workdir", m[1])],
      [/\bcheck\s+(?:the\s+)?file\s+(?:at\s+)?([^\s,.;!?\n]{4,200})/i, m => push("recent_file", m[1])],
      // Tech preferences
      [/\bi\s+(?:use|prefer|code\s+in|write\s+in)\s+([A-Za-z0-9+#./\- ]{2,40})\s+(?:for|as|when)/i, m => push("preferred_tech", m[1])],
      [/\bmy\s+stack\s+is\s+([^,.;!?\n]{4,160})/i, m => push("stack", m[1])],
      // Explicit "remember"
      [/\bremember\s+(?:that\s+)?([^,.;!?\n]{2,160})/i, m => push("note_" + Date.now().toString(36), m[1])],
      [/\bplease\s+(?:remember|note|save)\s+(?:that\s+)?([^,.;!?\n]{2,160})/i, m => push("note_" + Date.now().toString(36), m[1])],
      // Arabic-friendly (transliterated patterns the user uses occasionally)
      [/\bana\s+esmi\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, m => push("name", m[1])],
      [/\bismi\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, m => push("name", m[1])],
    ];
    for (const [re, fn] of patterns) {
      const m = t.match(re);
      if (m) try { fn(m); } catch {}
    }
    return saved;
  }

  // Run extraction on assistant replies too. Catches facts the assistant
  // confirmed/echoed back ("Got it — I'll remember you live in Cairo")
  // and silently extracts inferred facts from the user side of the dialog.
  function memAutoExtractFromAssistant(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 4000) return [];
    const saved = [];
    const push = (key, value) => {
      const v = String(value || "").trim().replace(/[.!?,]+$/, "");
      if (!v || v.length > 200) return;
      memAdd(key, v);
      saved.push({ key, value: v });
    };
    // Assistant-side patterns — the AI confirming a fact
    const patterns = [
      [/(?:I'?ll|I\s+will|let\s+me)\s+remember\s+(?:that\s+)?(?:your|you'?re|you\s+are)\s+([^,.;!?\n]{2,160})/i, m => push("note_" + Date.now().toString(36), m[1])],
      [/(?:got\s+it|noted|saved)[\s,.\-—]+(?:your|you'?re)\s+(?:name\s+is\s+)?([A-Za-z][A-Za-z'\- ]{1,40})\b/i, m => push("name", m[1])],
      [/(?:noted|saved|remembered)\s+(?:that\s+)?you\s+(?:work\s+at|are\s+at)\s+([^,.;!?\n]{2,80})/i, m => push("employer", m[1])],
      [/(?:noted|saved)\s+(?:that\s+)?you\s+(?:live\s+in|are\s+in|are\s+from)\s+([^,.;!?\n]{2,80})/i, m => push("location", m[1])],
    ];
    for (const [re, fn] of patterns) {
      const m = t.match(re);
      if (m) try { fn(m); } catch {}
    }
    return saved;
  }
  // Expose for other modes (coder, swarm) to call after their assistant turns
  try { window.memAutoExtractFromAssistant = memAutoExtractFromAssistant; } catch {}
  function memClear() { try { localStorage.removeItem(MEM_KEY); } catch {} }

  // -------------------------------------------------------------------------
  // Tool registry — each tool: { name, description, parameters (JSON Schema),
  //                              execute(args) → any (becomes the tool result),
  //                              statusLabel(args) → string for UI pulse }
  // -------------------------------------------------------------------------
  const AGENT_TOOLS = {
    web_search: {
      description: "Live web search. Use for current events, prices, versions, anything that may have changed.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Concise search query (3-10 keywords)." } },
        required: ["query"]
      },
      statusLabel: a => `Searching the web: ${(a.query || "").slice(0, 60)}`,
      async execute({ query }) {
        if (!query) return { error: "query is required" };
        const tav = await tavilySearch(query);
        if (tav && (tav.results.length || tav.answer)) {
          tav.results.forEach(r => addToRAG(r.title, r.snippet, `tavily:${r.url}`));
          return {
            answer: tav.answer || null,
            results: tav.results.map(r => ({ title: r.title, snippet: r.snippet, url: r.url }))
          };
        }
        const goog = await googleSearch(query);
        if (goog && goog.length) {
          goog.forEach(r => addToRAG(r.title, r.snippet, `google:${r.url}`));
          return { results: goog.map(r => ({ title: r.title, snippet: r.snippet, url: r.url })) };
        }
        const wiki = await wikipediaSearch(query);
        if (wiki.length) {
          wiki.forEach(r => addToRAG(r.title, r.snippet, `wiki:${r.url}`));
          return { results: wiki.map(r => ({ title: r.title, snippet: r.snippet, url: r.url })), note: "Wikipedia fallback (no Tavily/Google key set)." };
        }
        return { results: [], note: "No results." };
      }
    },
    wikipedia: {
      description: "Wikipedia lookup. Use for definitions and historical/established knowledge.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Topic to look up." } },
        required: ["query"]
      },
      statusLabel: a => `Checking Wikipedia: ${(a.query || "").slice(0, 60)}`,
      async execute({ query }) {
        if (!query) return { error: "query is required" };
        const wiki = await wikipediaSearch(query, 3);
        wiki.forEach(r => addToRAG(r.title, r.snippet, `wiki:${r.url}`));
        return { results: wiki };
      }
    },
    fetch_url: {
      description: "Fetch a public URL and return up to 3000 chars of readable text. Blocks private IPs.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL." } },
        required: ["url"]
      },
      statusLabel: a => `Reading page: ${(a.url || "").slice(0, 60)}`,
      async execute({ url }) {
        if (!url) return { error: "url is required" };
        const text = await fetchUrl(url);
        if (!text) return { error: "Could not fetch (timeout, blocked private IP, or non-text page)." };
        addToRAG(url, text, `fetch:${url}`);
        return { url, text };
      }
    },
    pubmed_search: {
      description: "PubMed / Europe PMC search. Peer-reviewed medical papers with PMID/DOI.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — drug names, gene names, conditions, etc." },
          limit: { type: "integer", description: "Max results (default 5).", default: 5 }
        },
        required: ["query"]
      },
      statusLabel: a => `Searching PubMed: ${(a.query || "").slice(0, 60)}`,
      async execute({ query, limit }) {
        if (!query) return { error: "query is required" };
        const papers = await pubmedSearch(query, Math.min(10, Math.max(1, limit || 5)));
        papers.forEach(p => addToRAG(p.title, `${p.authors} (${p.year}). ${p.abstract}`, `pubmed:${p.pmid || p.doi || p.url}`));
        return { papers };
      }
    },
    remember_fact: {
      description: "Save a fact to cross-session memory. Call silently for any preference, project, person, deadline. Use stable keys (favorite_animal, employer, location).",
      parameters: {
        type: "object",
        properties: {
          key:   { type: "string", description: "Short label for the fact (e.g. 'preferred_language', 'home_city', 'project_alpha_deadline')." },
          value: { type: "string", description: "The fact itself, in natural language." }
        },
        required: ["key", "value"]
      },
      statusLabel: a => `Saving to memory: ${(a.key || "").slice(0, 50)}`,
      async execute({ key, value }) {
        return memAdd(key, value);
      }
    },
    recall_facts: {
      description: "Search long-term memory. Call before saying 'unknown' if the topic might be saved. Pass keywords, not the full question.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Keywords to search memory for. Empty string returns most recent facts." } }
      },
      statusLabel: a => `Recalling memory: ${(a.query || "(recent)").slice(0, 50)}`,
      async execute({ query }) {
        const facts = memRecall(query || "");
        return { facts: facts.map(f => ({ key: f.key, value: f.value, saved_at: new Date(f.ts).toISOString() })) };
      }
    },
    current_datetime: {
      description: "Current date, time, timezone. Use for 'today', 'now', scheduling.",
      parameters: { type: "object", properties: {} },
      statusLabel: () => "Reading current time",
      async execute() {
        const now = new Date();
        return {
          iso: now.toISOString(),
          local: now.toString(),
          unix_seconds: Math.floor(now.getTime() / 1000),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          weekday: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()]
        };
      }
    },
    calculate: {
      description: "Evaluate math. Supports +-*/%**(), Math.sqrt/sin/cos/log/PI. Use for any arithmetic.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "Math expression, e.g. '(3.14 * 2**10) / 7' or 'Math.sqrt(2)'." } },
        required: ["expression"]
      },
      statusLabel: a => `Calculating: ${(a.expression || "").slice(0, 60)}`,
      async execute({ expression }) {
        if (!expression) return { error: "expression is required" };
        // Whitelist: numbers, operators, parens, dots, whitespace, and Math.<fn>
        const safe = /^[\s\d+\-*/%().,]*(?:Math\.(?:PI|E|sqrt|cbrt|abs|floor|ceil|round|min|max|pow|exp|log|log2|log10|sin|cos|tan|asin|acos|atan|atan2)\s*\(?\)?[\s\d+\-*/%().,]*)*$/;
        // Allow Math.<fn>(args) where args may contain nested expression — simple
        // multi-pass check: strip valid Math.<fn>(…) calls then re-check the rest.
        let cleaned = expression;
        for (let i = 0; i < 5; i++) {
          const next = cleaned.replace(/Math\.(?:PI|E|sqrt|cbrt|abs|floor|ceil|round|min|max|pow|exp|log|log2|log10|sin|cos|tan|asin|acos|atan|atan2)\s*\([^()]*\)/g, "0");
          if (next === cleaned) break;
          cleaned = next;
        }
        if (!/^[\s\d+\-*/%().,]+$/.test(cleaned)) {
          return { error: "expression contains disallowed characters" };
        }
        try {
          // eslint-disable-next-line no-new-func
          const result = Function('"use strict"; return (' + expression + ')')();
          if (typeof result !== "number" || !Number.isFinite(result)) return { error: "result is not a finite number" };
          return { expression, result };
        } catch (e) {
          return { error: String(e?.message || e) };
        }
      }
    },
    execute_python: {
      description: "Run Python (Pyodide). Globals persist across calls. Files saved to /output/ auto-download.\nPre-installed: python-docx, openpyxl, reportlab, pandas, numpy, matplotlib.\nWord: from docx import Document; doc=Document(); doc.add_heading(t); doc.add_paragraph(p); doc.save('/output/x.docx').\nExcel: from openpyxl import Workbook; wb=Workbook(); ws=wb.active; ws.append(row); wb.save('/output/x.xlsx').\nPDF (use platypus, not Canvas.drawString for reports): from reportlab.platypus import SimpleDocTemplate,Table,TableStyle,Paragraph; from reportlab.lib.pagesizes import letter; from reportlab.lib.styles import getSampleStyleSheet; SimpleDocTemplate('/output/x.pdf',pagesize=letter).build([...]).\nNever paste this code in chat — call the tool.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "Python source. Stdout is captured. Files written to /output/<name> are downloaded automatically." } },
        required: ["code"]
      },
      statusLabel: a => `Running Python: ${(a.code || "").split("\n")[0].slice(0, 60)}`,
      async execute({ code }) {
        if (!code) return { error: "code is required" };
        try {
          const py = await getPyodide();
          py.runPython(`
import sys, io as _io
_stdout = _io.StringIO()
_stderr = _io.StringIO()
sys.stdout = _stdout
sys.stderr = _stderr
`);
          let runError = null;
          try {
            await py.runPythonAsync(code);
          } catch (e) {
            runError = String(e?.message || e).split("\n").slice(-12).join("\n");
          }
          const stdout = py.runPython("_stdout.getvalue()") || "";
          const stderr = py.runPython("_stderr.getvalue()") || "";
          py.runPython("sys.stdout = sys.__stdout__\nsys.stderr = sys.__stderr__");
          const files = [];
          try {
            const names = py.FS.readdir("/output").filter(n => n !== "." && n !== "..");
            for (const name of names) {
              const path = "/output/" + name;
              const data = py.FS.readFile(path);
              const blob = new Blob([data]);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = name;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 8000);
              files.push({ filename: name, bytes: data.length });
              try { py.FS.unlink(path); } catch {}
            }
          } catch {}
          return {
            stdout: stdout.slice(0, 4000),
            stderr: stderr.slice(0, 2000),
            error: runError,
            files,
            note: files.length
              ? `${files.length} file(s) downloaded to the user's computer: ${files.map(f => f.filename).join(", ")}`
              : "No files written. To export a document for the user, write to /output/<filename>."
          };
        } catch (e) {
          return { error: "Python runtime failed to start: " + String(e?.message || e) };
        }
      }
    }
  };

  // ── Pyodide lazy loader (code-interpreter sandbox) ──────────────────────
  // Loaded on first execute_python call. Heavy (~10 MB) so we never load it
  // on page start. Pre-installs python-docx, openpyxl, reportlab via micropip
  // so the agent can produce real Word/Excel/PDF files.
  let _pyodidePromise = null;
  function getPyodide() {
    if (_pyodidePromise) return _pyodidePromise;
    _pyodidePromise = (async () => {
      if (!window.loadPyodide) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
          s.onload = res;
          s.onerror = () => rej(new Error("Failed to load Pyodide CDN"));
          document.head.appendChild(s);
        });
      }
      const py = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
      await py.loadPackage(["micropip"]);
      const micropip = py.pyimport("micropip");
      // python-docx + openpyxl + reportlab cover Word/Excel/PDF.
      // pandas/numpy/matplotlib are loaded on demand via py.loadPackage when imported.
      try { await micropip.install(["python-docx", "openpyxl", "reportlab"]); } catch (e) { console.warn("micropip install warning:", e); }
      try { py.FS.mkdirTree("/output"); } catch {}
      return py;
    })();
    return _pyodidePromise;
  }

  // Map agent.tools[] entries to AGENT_TOOLS keys. The agent stores ids like
  // "memory" (= remember + recall) and "datetime" — expand them here.
  function agentToolNames(agent) {
    if (!agent || !Array.isArray(agent.tools)) return [];
    const out = new Set();
    for (const t of agent.tools) {
      if (t === "memory") { out.add("remember_fact"); out.add("recall_facts"); }
      else if (t === "datetime") out.add("current_datetime");
      else if (t === "pubmed") out.add("pubmed_search");
      else if (t === "code_interpreter" || t === "python") out.add("execute_python");
      else if (AGENT_TOOLS[t]) out.add(t);
    }
    return [...out];
  }

  // Build OpenAI-compatible tools array from agent's selected tool ids.
  function buildOpenAITools(agent) {
    return agentToolNames(agent).map(name => ({
      type: "function",
      function: {
        name,
        description: AGENT_TOOLS[name].description,
        parameters: AGENT_TOOLS[name].parameters
      }
    }));
  }

  // Same shape, slightly different wrapper for Ollama's /api/chat tools field.
  // (Ollama actually accepts the OpenAI shape one-for-one as of 0.3+.)
  function buildOllamaTools(agent) { return buildOpenAITools(agent); }

  // Gemini wants functionDeclarations[] inside tools[].
  function buildGeminiTools(agent) {
    const decls = agentToolNames(agent).map(name => ({
      name,
      description: AGENT_TOOLS[name].description,
      parameters: AGENT_TOOLS[name].parameters
    }));
    return decls.length ? [{ functionDeclarations: decls }] : [];
  }

  // -------------------------------------------------------------------------
  // Tool execution — with per-tool timeout, error capture, status pulse.
  // Returns a string suitable for feeding back as a tool message content.
  // -------------------------------------------------------------------------
  async function runOneTool(name, args, onStatus, tracker) {
    const tool = AGENT_TOOLS[name];
    const t0 = performance.now();
    if (!tool) {
      if (tracker) tracker.push({ name, ok: false, ms: 0 });
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    try {
      if (onStatus) onStatus(tool.statusLabel?.(args || {}) || `Running ${name}…`, "running");
      const result = await Promise.race([
        Promise.resolve(tool.execute(args || {})),
        new Promise((_, rej) => setTimeout(() => rej(new Error("tool timeout")), AGENT_TOOL_TIMEOUT_MS))
      ]);
      if (onStatus) onStatus(`${name} ✓`, "done");
      if (tracker) tracker.push({ name, ok: true, ms: Math.round(performance.now() - t0) });
      // Note which web-search backend actually fired (Tavily / Google / Wikipedia)
      // so the per-message badge tells the truth instead of just "web_search".
      if (tracker && name === "web_search" && result && typeof result === "object") {
        const sample = (result.results || []).map(r => r.url || "").join(" ");
        if (sample.includes("tavily")) tracker.push({ name: "tavily", ok: true, ms: 0, derived: true });
        else if (sample.includes("google")) tracker.push({ name: "google", ok: true, ms: 0, derived: true });
        else if (sample.includes("wikipedia")) tracker.push({ name: "wikipedia", ok: true, ms: 0, derived: true });
      }
      return JSON.stringify(result ?? { ok: true });
    } catch (e) {
      if (onStatus) onStatus(`${name} ✗`, "failed");
      if (tracker) tracker.push({ name, ok: false, ms: Math.round(performance.now() - t0) });
      return JSON.stringify({ error: String(e?.message || e) });
    }
  }

  // -------------------------------------------------------------------------
  // Provider adapters — non-streaming single turn returning
  //   { content: string|null, tool_calls: [{id, name, arguments}]|null }
  // -------------------------------------------------------------------------
  async function agentTurnOllama({ model, messages, tools, temperature, signal }) {
    const host = safeHost();
    const r = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages, stream: false, keep_alive: -1,
        tools: tools.length ? tools : undefined,
        options: { temperature, num_ctx: 8192 }
      }),
      signal
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
    const data = await r.json();
    const msg = data.message || {};
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`,
      name: c.function?.name || c.name,
      // Ollama returns parsed object; cloud APIs return a JSON string. Normalize.
      arguments: typeof c.function?.arguments === "string"
        ? safeJsonParse(c.function.arguments)
        : (c.function?.arguments || c.arguments || {})
    })) : null;
    return { content: msg.content || null, tool_calls: calls && calls.length ? calls : null, raw: msg };
  }

  async function agentTurnOpenAI({ provider, model, messages, tools, temperature, signal }) {
    let url, headers;
    let moonshotKeyForRequest = "";
    const hasImages = messages.some(m => m.images?.length);
    const textMessages = messages.map(m => {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        return { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls };
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id, name: m.name || '', content: m.content || '' };
      }
      return { role: m.role, content: m.content || '' };
    });
    if (provider === "groq") {
      const key = (groqKeyEl.value || "").trim();
      if (!key) throw new Error("Groq API key missing.");
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "openrouter") {
      const key = (openRouterKeyEl.value || "").trim();
      if (!key) throw new Error("OpenRouter API key missing.");
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "HTTP-Referer": "hash-gpt://local", "X-Title": "HashCortx" };
    } else if (provider === "cerebras") {
      const key = (cerebrasKeyEl.value || "").trim();
      if (!key) throw new Error("Cerebras API key missing.");
      url = "https://api.cerebras.ai/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "samba") {
      const key = (sambaKeyEl.value || "").trim();
      if (!key) throw new Error("SambaNova API key missing.");
      url = "https://api.sambanova.ai/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "nvidia") {
      const key = (nvidiaKeyEl.value || "").trim();
      if (!key) throw new Error("NVIDIA API key missing.");
      url = "https://integrate.api.nvidia.com/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "openai") {
      const key = (openaiKeyEl.value || "").trim();
      if (!key) throw new Error("OpenAI API key missing.");
      url = "https://api.openai.com/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "moonshot") {
      const key = (moonshotKeyEl.value || "").trim();
      if (!key) throw new Error("Moonshot API key missing.");

      // sk-ki keys (Kimi for Code / kimi.com platform) use the Anthropic protocol.
      // Short-circuit here — convert OpenAI-style payload → Anthropic and return.
      if (isKimiCodeKey(key)) {
        const body = buildKimiAnthropicBody(model, messages, { temperature, maxTokens: 4096 });
        if (tools && tools.length) {
          body.tools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters || { type: "object", properties: {} },
          }));
        }
        const { res } = await fetchKimiAnthropic("/v1/messages", key, () => ({
          method: "POST", referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(body),
          signal,
        }));
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(cloudHttpError("moonshot", res.status, txt, res.headers.get("Retry-After")));
        }
        const data = await res.json();
        const contentBlocks = data.content || [];
        let text = "";
        const toolCalls = [];
        for (const block of contentBlocks) {
          if (block.type === "text") text += block.text;
          if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, arguments: block.input || {} });
        }
        return {
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls.map(c => ({ id: c.id, function: { name: c.name, arguments: c.arguments } })) : null,
          raw: data,
        };
      }

      moonshotKeyForRequest = key;
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "deepseek") {
      const key = (deepseekKeyEl.value || "").trim();
      if (!key) throw new Error("DeepSeek API key missing.");
      url = "https://api.deepseek.com/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else if (provider === "mistral") {
      const key = (mistralKeyEl.value || "").trim();
      if (!key) throw new Error("Mistral API key missing.");
      url = "https://api.mistral.ai/v1/chat/completions";
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
    } else {
      throw new Error("Unknown provider: " + provider);
    }
    const supportsOpenAIVision =
      provider === "openai" ||
      provider === "openrouter" ||
      provider === "nvidia" ||
      (provider === "groq" && /vision/i.test(model));
    if (hasImages && !supportsOpenAIVision) {
      throw new Error(`${provider}:${model} cannot read PDF page images. Select OpenAI, Gemini, Anthropic, OpenRouter vision, NVIDIA vision, or a Groq vision model for image-only PDFs.`);
    }
    const requestMessages = hasImages ? toOpenAIVision(messages) : textMessages;
    const body = {
      model, messages: requestMessages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      stream: false
    };
    if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }
    let r;
    if (provider === "moonshot") {
      ({ res: r } = await fetchMoonshotApi("/chat/completions", moonshotKeyForRequest, () => ({
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      })));
    } else {
      r = await fetch(url, { method: "POST", referrerPolicy: "no-referrer", headers, body: JSON.stringify(body), signal });
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(cloudHttpError(provider, r.status, txt, r.headers.get("Retry-After")));
    }
    const data = await r.json();
    const msg = data.choices?.[0]?.message || {};
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`,
      name: c.function?.name,
      arguments: typeof c.function?.arguments === "string"
        ? safeJsonParse(c.function.arguments)
        : (c.function?.arguments || {})
    })) : null;
    return { content: msg.content || null, tool_calls: calls && calls.length ? calls : null, raw: msg };
  }

  async function agentTurnAnthropic({ model, messages, tools, temperature, signal }) {
    const key = (anthropicKeyEl.value || "").trim();
    if (!key) throw new Error("Anthropic API key missing.");
    const systemMsg = messages.find(m => m.role === "system");
    // Convert OpenAI-style messages to Anthropic format
    const anthropicMessages = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        anthropicMessages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content) }]
        });
        continue;
      }
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const content = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const c of m.tool_calls) {
          content.push({
            type: "tool_use",
            id: c.id || `tu_${Date.now()}`,
            name: c.function?.name || c.name,
            input: typeof c.function?.arguments === "string" ? safeJsonParse(c.function.arguments) : (c.function?.arguments || c.arguments || {})
          });
        }
        anthropicMessages.push({ role: "assistant", content });
        continue;
      }
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      if (m.images?.length) m.images.forEach(b64 => content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
      anthropicMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content });
    }
    const body = {
      model,
      messages: anthropicMessages,
      max_tokens: 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
    };
    if (tools.length) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object", properties: {} }
      }));
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(cloudHttpError("anthropic", r.status, txt, r.headers.get("Retry-After")));
    }
    const data = await r.json();
    const contentBlocks = data.content || [];
    let text = "";
    const toolCalls = [];
    for (const block of contentBlocks) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input || {}
        });
      }
    }
    return {
      content: text || null,
      tool_calls: toolCalls.length ? toolCalls.map(c => ({ id: c.id, function: { name: c.name, arguments: c.arguments } })) : null,
      raw: data
    };
  }

  async function agentTurnGemini({ model, messages, tools, temperature, signal }) {
    const key = (geminiKeyEl.value || "").trim();
    if (!key) throw new Error("Google AI Studio key missing.");
    // Translate OpenAI-style messages → Gemini contents.
    const systemMsg = messages.find(m => m.role === "system");
    const contents = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: m.name, response: safeJsonParse(m.content) || { text: String(m.content) } } }]
        });
        continue;
      }
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        contents.push({
          role: "model",
          // appendAssistantToolCallTurn stores args as { function: { name, arguments: "json-string" } }
          // Gemini needs args as a plain object, so we parse the string here.
          parts: m.tool_calls.map(c => ({
            functionCall: {
              name: c.function?.name || c.name,
              args: typeof c.function?.arguments === "string"
                ? safeJsonParse(c.function.arguments)
                : (c.arguments || c.function?.arguments || {})
            }
          }))
        });
        continue;
      }
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      if (m.images?.length) m.images.forEach(b64 => parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } }));
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: parts.length ? parts : [{ text: "" }]
      });
    }
    const body = {
      contents,
      generationConfig: { temperature: typeof temperature === "number" ? temperature : 0.7 },
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      ...(tools.length ? { tools } : {})
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { method: "POST", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(cloudHttpError("gemini", r.status, txt, r.headers.get("Retry-After")));
    }
    const data = await r.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    let textOut = "";
    const calls = [];
    for (const p of parts) {
      if (p.text) textOut += p.text;
      if (p.functionCall) {
        calls.push({
          id: `call_${Date.now()}_${calls.length}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args || {}
        });
      }
    }
    return { content: textOut || null, tool_calls: calls.length ? calls : null, raw: data };
  }

  function safeJsonParse(s) {
    if (typeof s !== "string") return s;
    try { return JSON.parse(s); } catch { return {}; }
  }

  // Pull python source out of one or more ```python``` fences in a model
  // reply. Handles the common buggy variants ([wb.save](...) auto-links,
  // smart quotes) so we can re-run the code reliably.
  function extractPythonFence(text) {
    if (!text) return "";
    const fences = [];
    const re = /```(?:python|py)?\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(text)) !== null) fences.push(m[1]);
    if (!fences.length) return "";
    let code = fences.join("\n\n");
    // Markdown auto-link mangling: [wb.save](http://wb.save) → wb.save
    code = code.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // Smart quotes → straight quotes
    code = code.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    return code.trim();
  }

  // Pick the right adapter based on the model selector value.
  function selectAgentAdapter(modelValue) {
    if (modelValue.startsWith("cloud:")) {
      const { provider, modelId } = parseCloudModel(modelValue);
      if (provider === "gemini") return { kind: "gemini", model: modelId };
      if (provider === "anthropic") return { kind: "anthropic", model: modelId };
      if (provider === "groq" || provider === "openrouter" || provider === "cerebras" || provider === "samba" || provider === "openai" || provider === "moonshot" || provider === "deepseek" || provider === "mistral") {
        return { kind: "openai", provider, model: modelId };
      }
      throw new Error(`Unknown cloud provider for agent mode: ${provider}`);
    }
    return { kind: "ollama", model: modelValue };
  }

  // Convert message list into the right shape for tool-call appending.
  // OpenAI/Ollama use the same shape; Gemini we translate inside its adapter.
  function appendAssistantToolCallTurn(messages, content, toolCalls) {
    messages.push({
      role: "assistant",
      content: content || "",
      tool_calls: toolCalls.map(c => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) }
      }))
    });
  }
  function appendToolResult(messages, call, resultStr) {
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: resultStr
    });
  }

  // -------------------------------------------------------------------------
  // The loop. Builds messages, calls provider, executes tool_calls, repeats.
  // Streams status into the assistant bubble. Returns the final text.
  // -------------------------------------------------------------------------
  async function runAgentLoop({ agent, assistant, signal, onStatus, onFinalToken }) {
    // Lite mode: tiny models (1.5B–3B) can't reliably emit tool_calls and
    // get confused by long system prompts. Skip the tool-calling round-trip
    // entirely and use the streaming fallback with compact memory injection.
    if (agent && agent.lite) {
      return await runAgentLiteFlow({ agent, assistant, signal, onStatus, onFinalToken });
    }
    const modelValue = modelEl.value;
    const adapter = selectAgentAdapter(modelValue);
    // Per-message tool tracker — the renderer reads this off the message
    // object to draw the "tools used" badges below the bubble.
    if (!assistant.toolsUsed) assistant.toolsUsed = [];
    const tracker = assistant.toolsUsed;
    const temperature = (v => Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.7)(parseFloat(tempEl.value));
    const tools = adapter.kind === "gemini" ? buildGeminiTools(agent) : buildOpenAITools(agent);

    // ---- Build initial message list ----
    const baseMessages = buildOllamaMessages();

    // Inject relevant memories at the top of the system prompt — this is the
    // "real memory" piece. The model gets context from past conversations
    // automatically, even before it calls recall_facts itself.
    const userText = baseMessages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
    // Auto-save common preference/identity statements so memory works even
    // if the model forgets to call remember_fact (small models often do).
    try { memAutoExtract(userText); } catch {}
    const scored = memRecall(userText, 8);
    // Keyword recall misses semantic matches (e.g. "what animal do I love"
    // won't match a saved "likes: cats"). Always merge in the most recent
    // facts so the model has baseline context even when keywords don't overlap.
    const recentTop = memLoad().slice(-12).reverse();
    const seen = new Set(scored.map(f => f.key.toLowerCase()));
    const recalled = scored.slice();
    for (const f of recentTop) {
      if (recalled.length >= 14) break;
      const k = f.key.toLowerCase();
      if (!seen.has(k)) { recalled.push(f); seen.add(k); }
    }
    if (recalled.length) {
      const memBlock = "[INTERNAL MEMORY — do NOT recite, list, or acknowledge this block unless the user explicitly asks what you remember. Use silently as background context only.]\n" +
        recalled.map(f => `- ${f.key}: ${f.value}`).join("\n");
      // Prepend to system message, or insert one if none exists
      const sysIdx = baseMessages.findIndex(m => m.role === "system");
      if (sysIdx >= 0) baseMessages[sysIdx].content = `${baseMessages[sysIdx].content}\n\n${memBlock}`;
      else baseMessages.unshift({ role: "system", content: memBlock });
    }

    // Trim baseMessages so tool-call iterations have room inside the context window.
    // Each iteration adds 2 messages (assistant tool-call + tool result).
    // Target: keep base under 8K estimated tokens, leaving ~8K for tool history.
    // We drop oldest non-system pairs while the estimate is over budget.
    (function trimBaseToContextBudget() {
      const est = (msgs) => msgs.reduce((s, m) => s + Math.ceil((m.content || "").length / 3.8), 0);
      const BUDGET = 8000;
      if (est(baseMessages) <= BUDGET) return;
      const sysCount = baseMessages.filter(m => m.role === "system").length;
      // Always keep: all system messages + last 4 non-system messages (2 user/assistant pairs)
      while (baseMessages.length > sysCount + 4 && est(baseMessages) > BUDGET) {
        // Find the first non-system message and drop it
        const dropIdx = baseMessages.findIndex((m, i) => i >= sysCount);
        if (dropIdx < 0) break;
        baseMessages.splice(dropIdx, 1);
      }
    })();

    let messages = baseMessages;
    let iter = 0;
    let finalText = "";
    let hasNudged = false; // prevent repeated nudges if model keeps returning empty

    while (iter < AGENT_MAX_ITERATIONS) {
      iter++;
      recordAgentEvent(assistant, "thinking", `Step ${iter}`);
      onStatus?.(`Thinking (step ${iter})…`, "thinking");

      let turn;
      try {
        if (adapter.kind === "ollama") {
          turn = await agentTurnOllama({ model: adapter.model, messages, tools, temperature, signal });
        } else if (adapter.kind === "gemini") {
          turn = await agentTurnGemini({ model: adapter.model, messages, tools, temperature, signal });
        } else if (adapter.kind === "anthropic") {
          turn = await agentTurnAnthropic({ model: adapter.model, messages, tools, temperature, signal });
        } else {
          turn = await agentTurnOpenAI({ provider: adapter.provider, model: adapter.model, messages, tools, temperature, signal });
        }
      } catch (e) {
        // If the model rejects tools (older models, some configs), retry once
        // without tools — the agent then runs in legacy "RAG-prefetch" mode.
        const msg = String(e?.message || "");
        if (tools.length && /tool|function/i.test(msg) && iter === 1) {
          onStatus?.("Model doesn't support tools — falling back to context injection", "warn");
          return await runAgentFallback({ agent, assistant, signal, onStatus, onFinalToken });
        }
        throw e;
      }

      if (turn.tool_calls && turn.tool_calls.length) {
        // Persist the assistant's tool-call turn into history
        appendAssistantToolCallTurn(messages, turn.content, turn.tool_calls);
        // Execute each requested tool
        for (const call of turn.tool_calls) {
          if (signal?.aborted) return finalText;
          recordAgentEvent(assistant, "tool_call", call.name, call.arguments || {});
          const resultStr = await runOneTool(call.name, call.arguments, onStatus, tracker);
          recordAgentEvent(assistant, "tool_result", call.name, safeJsonParse(resultStr));
          appendToolResult(messages, call, resultStr);
        }
        // Loop — model sees tool results next iteration
        continue;
      }

      // No tool calls → we have a final answer.
      // ── Auto-execute safety net ──────────────────────────────────────
      // Smaller / weaker tool-calling models sometimes write the code in
      // a markdown fence and pretend they ran it. If the agent has the
      // code interpreter enabled and the reply contains a python fence
      // but no execute_python call happened, run it ourselves and let
      // the model see the real result on the next iteration.
      const candidateText = turn.content || "";
      const hasPythonTool = (agent.tools || []).includes("code_interpreter") || (agent.tools || []).includes("python");
      if (hasPythonTool && candidateText && iter < AGENT_MAX_ITERATIONS) {
        const pyCode = extractPythonFence(candidateText);
        const claimsRan = /\b(downloaded|saved|created|generated|exported)\b/i.test(candidateText) && /\/output\//.test(candidateText + pyCode);
        if (pyCode && (claimsRan || /\/output\//.test(pyCode))) {
          onStatus?.("Model wrote code without calling the tool — auto-executing…", "warn");
          // Synthesize a tool call so history stays consistent
          const synth = {
            id: `call_auto_${Date.now()}`,
            name: "execute_python",
            arguments: { code: pyCode }
          };
          appendAssistantToolCallTurn(messages, candidateText, [synth]);
          const resultStr = await runOneTool("execute_python", synth.arguments, onStatus, tracker);
          appendToolResult(messages, synth, resultStr);
          // Nudge the model to acknowledge what really happened
          messages.push({
            role: "system",
            content: "The Python code in your previous reply was executed automatically. Use the tool result above to write your real answer. If files were generated, mention their actual filenames from the result. Do not show the code again."
          });
          continue;
        }
      }
      // Model returned empty content after running tools — nudge it once to write
      // an acknowledgement so the bubble is never silently blank.
      if (!candidateText && !hasNudged && iter < AGENT_MAX_ITERATIONS && tracker.length) {
        hasNudged = true;
        const nudge = tracker.some(t => t.name === "remember_fact" && t.ok)
          ? "You just saved a fact to memory. Briefly confirm what you saved in one sentence."
          : "You just completed a tool action. Briefly summarize what you did in one sentence.";
        messages.push({ role: "user", content: nudge });
        continue;
      }
      finalText = candidateText;
      recordAgentEvent(assistant, "final", `Final answer · ${finalText.length} chars`);
      break;
    }

    if (iter >= AGENT_MAX_ITERATIONS) {
      onStatus?.("Reached max tool iterations — finalizing", "warn");
      // One more call without tools to force a text answer
      try {
        const closing = adapter.kind === "ollama"
          ? await agentTurnOllama({ model: adapter.model, messages, tools: [], temperature, signal })
          : adapter.kind === "gemini"
          ? await agentTurnGemini({ model: adapter.model, messages, tools: [], temperature, signal })
          : adapter.kind === "anthropic"
          ? await agentTurnAnthropic({ model: adapter.model, messages, tools: [], temperature, signal })
          : await agentTurnOpenAI({ provider: adapter.provider, model: adapter.model, messages, tools: [], temperature, signal });
        finalText = closing.content || finalText || "(no answer)";
      } catch {}
    }

    // If still empty but tools ran, synthesize a fallback so the bubble is never blank.
    if (!finalText && tracker.length) {
      const memSaved = tracker.filter(t => t.name === "remember_fact" && t.ok);
      finalText = memSaved.length
        ? `Saved ${memSaved.length === 1 ? "that" : `${memSaved.length} facts`} to memory.`
        : "Done.";
    }

    // Stream the final text into the bubble so the UX feels live even though
    // the call itself was non-streaming.
    if (finalText) typewriterIntoBubble(finalText, onFinalToken);
    return finalText;
  }

  // Lite flow — for small models (1.5B–3B). No tool-calling, no extra
  // tool-call round-trips. Just: auto-extract from user msg, inject a
  // compact memory block (top 5 most recent, plain "Key: value" lines —
  // small models drift on the [INTERNAL MEMORY] framing), then stream.
  async function runAgentLiteFlow({ agent, assistant, signal, onStatus, onFinalToken }) {
    if (!assistant.toolsUsed) assistant.toolsUsed = [];
    const userText = buildOllamaMessages().filter(m=>m.role==="user").slice(-1)[0]?.content || "";
    try { memAutoExtract(userText); } catch {}
    let toolContext = null;
    try {
      const scored = memRecall(userText, 4);
      const recent = memLoad().slice(-5).reverse();
      const seen = new Set(scored.map(f => f.key.toLowerCase()));
      const merged = scored.slice();
      for (const f of recent) {
        if (merged.length >= 6) break;
        const k = f.key.toLowerCase();
        if (!seen.has(k)) { merged.push(f); seen.add(k); }
      }
      if (merged.length) {
        toolContext = "Memory:\n" + merged.map(f => `- ${f.key}: ${f.value}`).join("\n");
      }
    } catch {}
    onStatus?.("Generating reply…", "running");
    await streamChat(assistant, toolContext, null);
  }

  // Legacy fallback for models that genuinely don't speak function-calling.
  // We pre-fetch tool context (old runAgentTools), then do a streaming chat.
  async function runAgentFallback({ agent, assistant, signal, onStatus, onFinalToken }) {
    onStatus?.("Pre-fetching context…", "running");
    const userText = buildOllamaMessages().filter(m=>m.role==="user").slice(-1)[0]?.content || "";
    try { memAutoExtract(userText); } catch {}
    let toolContext = null;
    try {
      let q = null;
      if (rewriterEl?.value) q = await rewriteForSearch(userText);
      toolContext = await runAgentTools(agent, userText, q);
    } catch {}
    // Inject memories into context for non-tool-calling models too
    try {
      const scored = memRecall(userText, 8);
      const recentTop = memLoad().slice(-12).reverse();
      const seen = new Set(scored.map(f => f.key.toLowerCase()));
      const recalled = scored.slice();
      for (const f of recentTop) {
        if (recalled.length >= 14) break;
        const k = f.key.toLowerCase();
        if (!seen.has(k)) { recalled.push(f); seen.add(k); }
      }
      if (recalled.length) {
        const memBlock = "[INTERNAL MEMORY — do NOT recite or list unless the user explicitly asks what you remember. Use silently as background.]\n" +
          recalled.map(f => `- ${f.key}: ${f.value}`).join("\n");
        toolContext = toolContext ? `${memBlock}\n\n${toolContext}` : memBlock;
      }
    } catch {}
    onStatus?.("Generating reply…", "running");
    await streamChat(assistant, toolContext, null);
  }

  // Animated typewriter — writes the final non-streamed answer into the bubble
  // at ~120 chars/s so the UI still feels alive after the agent loop returns.
  function typewriterIntoBubble(text, onToken) {
    if (!text) return;
    // For very long answers, skip the animation past 2000 chars.
    const FAST_CUTOFF = 2000;
    if (text.length > FAST_CUTOFF) {
      onToken?.(text);
      return;
    }
    let i = 0;
    const STEP = 8; // chars per tick
    const tick = () => {
      const slice = text.slice(i, i + STEP);
      if (!slice) return;
      onToken?.(slice);
      i += STEP;
      if (i < text.length) requestAnimationFrame(tick);
    };
    tick();
  }

  // ========= NVIDIA NIM (cloud LLM) =========
  // OpenAI-compatible streaming chat completions. Key is held only in
  // localStorage and sent only to integrate.api.nvidia.com over HTTPS.
  async function nvidiaStreamChat({ messages, model, temperature, onToken, signal }) {
    const key = (nvidiaKeyEl.value || "").trim();
    if (!key) throw new Error("Missing NVIDIA API key");
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: typeof temperature === "number" ? temperature : 0.7,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`NVIDIA HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const parseNvidiaLine = (line) => {
      const s = line.trim();
      if (!s.startsWith("data:")) return;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      try {
        const evt = JSON.parse(payload);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) onToken(delta);
      } catch {}
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) parseNvidiaLine(line);
    }
    parseNvidiaLine(buf);
  }

  // ========= Auto-router =========
  // Reads the user's message and decides which backend to use. Pure local
  // heuristics — zero network round-trip, ~0.1 ms. Result is shown in the
  // chip above the composer so the user can see (and override) every route.
  const ROUTE_DEFS = {
    dell:        { backend: "dell",   useSearch: false, label: "Local",        icon: "⌂", cls: "" },
    dellSearch:  { backend: "dell",   useSearch: true,  label: "Local + web",          icon: "⌂", cls: "search" },
    dellPubmed:  { backend: "dell",   useSearch: "pubmed", label: "Local + PubMed",    icon: "⌂", cls: "search" },
    nvidia:      { backend: "nvidia", useSearch: false, label: "NVIDIA cloud",        icon: "☁", cls: "cloud" },
    nvidiaSearch:{ backend: "nvidia", useSearch: true,  label: "NVIDIA + web",        icon: "☁", cls: "cloud search" },
  };
  // Reset on every send. null = "auto", anything else = manual override
  // for the next message only.
  let routeOverride = null;

  // Heuristic classifier. Order = priority (first match wins).
  function classifyMessage(text, hasAttachments) {
    const t = (text || "").toLowerCase();
    const hasCodeBlock = /```/.test(text || "");
    const codeWords = /\b(function|class|const |let |var |refactor|debug|stack ?trace|exception|null pointer|segfault|compile|typescript|python|node\.js|react|next\.js|tailwind|sql|regex|api endpoint|docker|kubernetes)\b/.test(t);
    const recencyWords = /\b(today|yesterday|tonight|this week|latest|current(ly)?|right now|just (released|announced|launched)|news|breaking|202[5-9]|recent(ly)?|update[ds]?)\b/.test(t);
    const newsWords = /\b(who won|score|election|stock price|weather|forecast|exchange rate|trending)\b/.test(t);
    const factWords = /\b(when (is|was|did|will)|what year|how (old|tall|big|much) is|capital of|president of|ceo of|population of|distance (from|to))\b/.test(t);
    const medicalWords = /\b(clinical|trial|placebo|cohort|meta-?analysis|pubmed|peer[- ]?reviewed|mg\/kg|in vitro|in vivo|systematic review|patient(s)?|diagnos(is|ed)|symptom(s)?|treatment|therapy|drug|medication|dose|dosage|side effect|prognosis|pathology|biomarker|gene expression)\b/.test(t);
    const reasoningWords = /\b(prove|proof|derivation|step[- ]by[- ]step|reason about|think through|theorem|integral|derivative)\b/.test(t);

    if (hasCodeBlock || codeWords) return { route: "dell", reason: "code-related" };
    if (medicalWords) return { route: "dellPubmed", reason: "medical/scientific" };
    if (recencyWords || newsWords || factWords) {
      const cloudOk = canUseCloud();
      return {
        route: cloudOk ? "nvidiaSearch" : "dellSearch",
        reason: cloudOk ? "needs current info" : "needs current info (local-only mode)",
      };
    }
    if (reasoningWords && canUseCloud()) return { route: "nvidia", reason: "reasoning-heavy" };
    return { route: "dell", reason: "general (default)" };
  }

  function canUseCloud() {
    if (privacyLocalEl.checked) return false;
    return !!(nvidiaKeyEl.value || "").trim();
  }
  function canUseSearch() {
    return !!(tavilyKeyEl.value || "").trim() || !!(googleKeyEl.value || "").trim();
  }

  // Returns the route the next send() will use. Honors manual override.
  function currentRoute(text, hasAttachments) {
    if (!autoRouterEl?.checked) return null; // router off → use legacy path (always true now: auto-router removed from UI)
    if (routeOverride) {
      const def = ROUTE_DEFS[routeOverride.route];
      if (privacyLocalEl.checked && def?.backend === "nvidia") {
        routeOverride = null;
        return { route: "dell", reason: "local-only mode", manual: false };
      }
      return routeOverride;
    }
    const c = classifyMessage(text, hasAttachments);
    return { ...c, manual: false };
  }

  // Keep both privacy toggles (settings panel + sidebar shortcut) in sync.
  function applyPrivacyLocal(checked) {
    privacyLocalEl.checked     = checked;
    privacyLocalSideEl.checked = checked;
    saveSettings();
    updateCloudModelVisualState();
  }
  privacyLocalEl.addEventListener("change",     () => applyPrivacyLocal(privacyLocalEl.checked));
  privacyLocalSideEl.addEventListener("change", () => applyPrivacyLocal(privacyLocalSideEl.checked));
  tavilyKeyEl.addEventListener("change", saveSettings);
  nvidiaKeyEl.addEventListener("change", saveSettings);
  nvidiaModelEl?.addEventListener("change", saveSettings);
  groqKeyEl.addEventListener("change", () => { saveSettings(); populateCloudModels(); });
  geminiKeyEl.addEventListener("change", () => { saveSettings(); populateCloudModels(); });
  openRouterKeyEl.addEventListener("change", () => { saveSettings(); populateCloudModels(); });
  cerebrasKeyEl.addEventListener("change",   () => { saveSettings(); populateCloudModels(); });
  sambaKeyEl.addEventListener("change",      () => { saveSettings(); populateCloudModels(); });
  openaiKeyEl.addEventListener("change",     () => { saveSettings(); populateCloudModels(); });
  anthropicKeyEl.addEventListener("change",  () => { saveSettings(); populateCloudModels(); });
  moonshotKeyEl.addEventListener("change",   () => { saveSettings(); populateCloudModels(); });
  deepseekKeyEl.addEventListener("change",   () => { saveSettings(); populateCloudModels(); });
  mistralKeyEl.addEventListener("change",    () => { saveSettings(); populateCloudModels(); });
  // ========= Local Knowledge Base (RAG) =========
  // Pure client-side retrieval: keyword-overlap scoring against a localStorage
  // store of chunks ingested from search results, papers, and uploaded files.
  // No server changes, no embeddings — fast enough for thousands of chunks.

  const RAG_KEY = "hashgpt_rag";
  const RAG_MAX_BYTES = 6_500_000; // ~6.5 MB char budget — embeddings add ~1.5 KB per chunk
  const RAG_MAX_CONTEXT = 3;       // chunks injected per query
  const RAG_CHUNK_MAX = 600;       // max chars stored per chunk
  const RAG_VECTOR_MIN_SIM = 0.32; // cosine-sim threshold for vector hits

  // ── Local embeddings (transformers.js) ────────────────────────────────
  // Lazy-load all-MiniLM-L6-v2 (~22 MB) on first embed call. Stays in
  // memory after that. Browser-only, no API key, no network at query time.
  let _embedderPromise = null;
  async function getEmbedder() {
    if (_embedderPromise) return _embedderPromise;
    _embedderPromise = (async () => {
      const mod = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm");
      try { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true; } catch {}
      return await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    })();
    return _embedderPromise;
  }
  async function embedText(text) {
    const t = String(text || "").trim().slice(0, 1000);
    if (!t) return null;
    try {
      const embedder = await getEmbedder();
      const out = await embedder(t, { pooling: "mean", normalize: true });
      return Array.from(out.data);
    } catch (e) {
      console.warn("[embed] failed:", e?.message || e);
      return null;
    }
  }
  function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    // Vectors are L2-normalized at extraction time, so cosine = dot product.
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  const STOP_WORDS = new Set("a an the and or but in on at to of for is are was were be been being have has had do does did will would could should may might shall can this that these those with from by into out up as it its if not no so i we you he she they their them our my your his her its what which who when where how all just also only more over than then".split(" "));

  function ragExtractKeywords(text) {
    return [...new Set(
      (text || "").toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    )];
  }

  function ragScore(queryKw, chunk) {
    if (!queryKw.length || !chunk.keywords?.length) return 0;
    const cSet = new Set(chunk.keywords);
    const titleKw = new Set(ragExtractKeywords(chunk.title || ""));
    let score = 0, totalWeight = 0;
    for (const w of queryKw) {
      // Word length proxies IDF: longer terms are rarer and more informative
      const weight = Math.log(2 + w.length);
      totalWeight += weight;
      if (cSet.has(w)) score += weight * (titleKw.has(w) ? 1.6 : 1.0);
    }
    return totalWeight > 0 ? score / totalWeight : 0;
  }

  function loadRAG() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RAG_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    }
    catch { return []; }
  }

  function saveRAG(store) {
    try {
      let s = JSON.stringify(store);
      // Trim oldest entries if over size cap
      while (s.length > RAG_MAX_BYTES && store.length > 0) {
        store.shift();
        s = JSON.stringify(store);
      }
      localStorage.setItem(RAG_KEY, s);
    } catch {}
    updateRagCount();
  }

  function updateRagCount() {
    const n = loadRAG().length;
    const el = document.getElementById("ragCount");
    if (el) el.textContent = n;
    const tog = document.getElementById("ragToggle");
    if (tog) tog.classList.toggle("on", ragEnabled);
  }

  function _ragLocalAdd(title, text, source) {
    if (!ragEnabled) return;
    if (!text || text.trim().length < 40) return;
    const store = loadRAG();
    const key = `${source}::${(title || "").slice(0, 80)}`;
    if (store.some(c => c.key === key)) return;
    const chunk = text.slice(0, RAG_CHUNK_MAX);
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      key,
      title: (title || "").slice(0, 120),
      text: chunk,
      source: source || "unknown",
      keywords: ragExtractKeywords(chunk),
      addedAt: Date.now(),
    };
    store.push(entry);
    saveRAG(store);
    // Async embed + patch — so ingestion never blocks UI even on first run
    // when the 22 MB embedding model is still downloading.
    embedText(`${entry.title}. ${chunk}`).then(vec => {
      if (!vec) return;
      const cur = loadRAG();
      const i = cur.findIndex(c => c.key === entry.key);
      if (i >= 0) { cur[i].vec = vec; saveRAG(cur); }
    }).catch(() => {});
  }

  function queryRAG(text, topK = RAG_MAX_CONTEXT) {
    if (!ragEnabled) return [];
    const store = loadRAG();
    if (!store.length) return [];
    const queryKw = ragExtractKeywords(text);
    if (!queryKw.length) return [];
    return store
      .map(c => ({ ...c, _score: ragScore(queryKw, c) }))
      .filter(c => c._score > 0.14)
      .sort((a, b) => b._score - a._score)
      .slice(0, topK);
  }

  // Vector retrieval — semantic search via cosine similarity. Runs in
  // parallel with keyword retrieval and the two are merged, so chunks
  // ingested before embeddings existed still surface via keywords.
  async function queryRAGVector(text, topK = RAG_MAX_CONTEXT) {
    if (!ragEnabled) return [];
    const store = loadRAG();
    const withVec = store.filter(c => Array.isArray(c.vec) && c.vec.length);
    if (!withVec.length) return [];
    // First call may need to download the 22 MB model. Race against a
    // generous timeout so we never block a user query for >2 s — keyword
    // search will carry that turn, vector takes over once warm.
    const qVec = await Promise.race([
      embedText(text),
      new Promise(r => setTimeout(() => r(null), 2000))
    ]);
    if (!qVec) return [];
    return withVec
      .map(c => ({ ...c, _score: cosineSim(qVec, c.vec) }))
      .filter(c => c._score >= RAG_VECTOR_MIN_SIM)
      .sort((a, b) => b._score - a._score)
      .slice(0, topK);
  }

  // RAG card events are wired per-render inside renderAgentsList()

  // ========= Local RAG (persistent 5 GB SQLite on the local host) =========
  // Endpoints added to /opt/hashgpt/helper.py:
  //   POST /rag/add   { title, text, source }
  //   POST /rag/query { query, limit }  → { results: [{title,text,source,score}] }
  //   GET  /rag/stats                   → { count, size_mb }
  //   POST /rag/clear

  function dellRagBase() {
    // Use the sensor helper port (9999) on whichever host Ollama is using
    return safeHost().replace(":11434", ":9999");
  }

  // Use AbortSignal.timeout when available (Chrome 103+, Safari 16+, FF 100+).
  // It is GC-safe — no dangling setTimeout on successful requests.
  // Falls back to the old AbortController pattern on older engines.
  function makeSignal(ms) {
    return window.HashCortxRuntime.makeSignal(ms);
  }

  async function ragDellAdd(title, text, source) {
    if (!ragEnabled) return;
    try {
      await fetch(`${dellRagBase()}/rag/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: (title||"").slice(0,200), text: text.slice(0,2000), source: source||"" }),
        signal: makeSignal(4000),
      });
    } catch {}
  }

  async function ragDellQuery(query, limit = 3) {
    try {
      const r = await fetch(`${dellRagBase()}/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
        signal: makeSignal(4000),
      });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.results || []).map(c => ({ title: c.title, text: c.text, source: c.source }));
    } catch { return []; }
  }

  async function ragDellStats() {
    try {
      const r = await fetch(`${dellRagBase()}/rag/stats`, { signal: makeSignal(3000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function ragDellClear() {
    try {
      await fetch(`${dellRagBase()}/rag/clear`, { method: "POST", signal: makeSignal(4000) });
      renderAgentsList();
    } catch {}
  }

  function addToRAG(title, text, source) {
    _ragLocalAdd(title, text, source);
    ragDellAdd(title, text, source);
  }

  // Hybrid retrieval: vector (semantic) + keyword (lexical) + server.
  // Vector goes first — it catches paraphrases and synonyms that keyword
  // misses ("CEO" ↔ "chief executive"). Keyword fills in exact-match cases
  // (rare names, codes, IDs) where embeddings can be fuzzy.
  const _queryRAGLocal = queryRAG;
  async function queryRAGMerged(text) {
    if (!ragEnabled) return [];
    const [macVec, dell] = await Promise.all([
      queryRAGVector(text, RAG_MAX_CONTEXT).catch(() => []),
      ragDellQuery(text, RAG_MAX_CONTEXT).catch(() => [])
    ]);
    const macKw = _queryRAGLocal(text);
    const seen = new Set();
    const out = [];
    const dedupKey = c => (c.title || "").trim().toLowerCase() + "|" + (c.text || "").slice(0, 80);
    const push = (arr) => {
      for (const c of arr) {
        const k = dedupKey(c);
        if (!seen.has(k)) { seen.add(k); out.push(c); }
      }
    };
    push(macVec);   // semantic matches first
    push(macKw);    // exact-token fallbacks
    push(dell);     // server-side knowledge base
    return out.slice(0, RAG_MAX_CONTEXT + 2);
  }

  // ========= Boot =========
  loadProjects();
  loadAgentRuns();
  loadChats();
  loadAgents();
  renderProjectSelect();
  renderChatList();
  renderAgentsList();
  renderActiveAgentChip();
  setTab("chats");
  render();
  seedSavedModelDropdown();

  window.HashCortxRuntime.unloadTrackedModelsOnExit = () => {
    unloadLocalModels(getTrackedLocalModels(), { keepalive: true });
  };
  loadModels();


  // ========= Agent Swarm + Canvas =========

  // Global abort controllers — the ONLY way to stop running processes
  let workflowAbort = null;
  let swarmAbort = null;

  // Core LLM streaming call with abort signal support.
  // Routes cloud models (cloud:provider:modelId) through the main app's streaming
  // infrastructure so they hit the correct API endpoints with stored API keys.
  async function ollamaChat(model, messages, onToken, signal) {
    if (model && model.startsWith("cloud:")) {
      let full = "";
      await streamWithModelValue({
        modelValue: model,
        messages,
        onToken: (tok) => { full += tok; if (onToken) onToken(tok, full); },
        onStats: null,
        signal,
        temperature: 0.7,
      });
      return full;
    }
    const host = window.HashCortxRuntime ? window.HashCortxRuntime.getHost() : "http://localhost:11434";
    const resp = await fetch(host + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!resp.ok) throw new Error("Ollama error: " + resp.status);
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value).split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const tok = obj.message?.content || "";
          full += tok;
          if (onToken) onToken(tok, full);
        } catch {}
      }
    }
    return full;
  }

  const SwarmState = { active: false, mode: null, log: [] };

  function sanitizeSwarmLogStatus(status) {
    const s = status || "info";
    return s === "done" || s === "err" || s === "info" ? s : "info";
  }

  function swarmLog(agentLabel, text, status) {
    SwarmState.log.push({
      agentLabel,
      text,
      status: sanitizeSwarmLogStatus(status),
      ts: Date.now(),
    });
    renderSwarmLog();
  }

  function renderSwarmLog() {
    const logEl = document.getElementById("swarm-log-entries");
    if (!logEl) return;
    logEl.innerHTML = SwarmState.log.slice(-30).reverse().map(e => {
      const st = sanitizeSwarmLogStatus(e.status);
      return `<div class="swarm-log-entry ${st}">
        <span class="agent-tag">[${escapeHtml(e.agentLabel)}]</span>${escapeHtml(e.text)}
      </div>`;
    }).join("");
  }

  // Mode 1: Boss Team — boss plans, workers execute in parallel, boss synthesizes
  async function runBossTeam(task, workerModels, signal) {
    SwarmState.active = true;
    const currentModel = document.getElementById("model")?.value || "llama3.2";
    swarmLog("Boss", "Breaking down the task…");

    const planPrompt = `You are the Boss. Task: "${task.slice(0, 400)}"
Workers: ${workerModels.join(", ")}
Reply with a JSON array only, no extra text:
[{"w":"model_name","t":"brief task for that worker"},...]`;

    let planText = "";
    try {
      planText = await ollamaChat(currentModel, [
        { role: "system", content: "Reply with a JSON array only. No explanation." },
        { role: "user", content: planPrompt }
      ], null, signal);
    } catch (e) { if (e.name === "AbortError") throw e; planText = ""; }

    let subtasks;
    try { const m = planText.match(/\[[\s\S]*\]/); subtasks = m ? JSON.parse(m[0]) : null; } catch { subtasks = null; }
    if (!subtasks || !subtasks.length) subtasks = workerModels.map(w => ({ w, t: task }));
    swarmLog("Boss", `Assigned ${subtasks.length} task(s). Workers running…`, "done");

    const results = await Promise.all(subtasks.map(async (st, i) => {
      const wModel = st.w || workerModels[i % workerModels.length];
      swarmLog(wModel, `Working: "${(st.t || task).slice(0, 60)}…"`);
      let result = "";
      try {
        result = await ollamaChat(wModel, [
          { role: "system", content: "You are a focused worker. Complete the task clearly and concisely." },
          { role: "user", content: st.t || task }
        ], null, signal);
      } catch (e) { if (e.name === "AbortError") throw e; result = `[Error: ${e.message}]`; }
      swarmLog(wModel, `Done (${result.split(" ").length} words)`, "done");
      return { model: wModel, task: st.t || task, result };
    }));

    swarmLog("Boss", "Combining results…");
    const synthPrompt = `Task was: "${task.slice(0, 300)}"
Worker results:
${results.map((r, i) => `Worker ${i + 1} (${r.model}): ${r.result.slice(0, 500)}`).join("\n---\n")}
Write a clear final answer combining all the above.`;

    let synthesis = "";
    try {
      synthesis = await ollamaChat(currentModel, [
        { role: "system", content: "Synthesize the worker outputs into one clear final answer." },
        { role: "user", content: synthPrompt }
      ], null, signal);
    } catch (e) { if (e.name === "AbortError") throw e; synthesis = results.map(r => r.result).join("\n\n"); }

    swarmLog("Boss", "Final answer ready.", "done");
    SwarmState.active = false;
    return { mode: "boss-team", label: "Boss Team", results, synthesis };
  }

  // Mode 2: All Vote — all models answer, judge picks the best
  async function runAllVote(task, voterModels, signal) {
    SwarmState.active = true;
    swarmLog("AllVote", `Sending to ${voterModels.length} model(s) simultaneously…`);
    const currentModel = document.getElementById("model")?.value || "llama3.2";

    const votes = await Promise.all(voterModels.map(async (model) => {
      swarmLog(model, "Answering…");
      let answer = "";
      try {
        answer = await ollamaChat(model, [{ role: "user", content: task }], null, signal);
      } catch (e) { if (e.name === "AbortError") throw e; answer = `[Error: ${e.message}]`; }
      swarmLog(model, "Done", "done");
      return { model, answer };
    }));

    swarmLog("Judge", "Picking the best answer…");
    const judgePrompt = `Question: "${task.slice(0, 300)}"
${votes.map((v, i) => `Response ${i + 1} (${v.model}):\n${v.answer.slice(0, 400)}`).join("\n---\n")}
Pick the best response or merge them into one final answer. Start with "BEST:" then the answer.`;

    let verdict = "";
    try {
      verdict = await ollamaChat(currentModel, [
        { role: "system", content: "You are a judge. Pick or merge the best response into one clear answer." },
        { role: "user", content: judgePrompt }
      ], null, signal);
    } catch (e) { if (e.name === "AbortError") throw e; verdict = votes[0]?.answer || ""; }

    swarmLog("Judge", "Verdict ready.", "done");
    SwarmState.active = false;
    return { mode: "all-vote", label: "All Vote", votes, verdict };
  }

  // Mode 3: Chain Refine — each model improves on the previous output
  async function runChainRefine(task, models, signal) {
    SwarmState.active = true;
    swarmLog("Chain", `Starting ${models.length}-step refinement chain…`);

    const stages = [
      "Write an initial answer",
      "Review and improve the previous answer — fix errors, add depth",
      "Polish: make it clearer and better structured",
      "Final pass: concise, well-formatted, complete"
    ];

    let current = task;
    let history = [];

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const stage = stages[i] || "Improve and refine the previous output";
      const prompt = i === 0 ? task : `${stage}:\n\n${current.slice(0, 1200)}`;
      swarmLog(model, `Step ${i + 1}: ${stage.slice(0, 50)}…`);
      let output = "";
      try {
        output = await ollamaChat(model, [
          { role: "system", content: `You are step ${i + 1} in a refinement chain. ${stage}.` },
          { role: "user", content: prompt }
        ], null, signal);
      } catch (e) { if (e.name === "AbortError") throw e; output = `[Error: ${e.message}]`; }
      swarmLog(model, `Step ${i + 1} done`, "done");
      history.push({ step: i + 1, model, stage, output });
      current = output;
    }

    SwarmState.active = false;
    return { mode: "chain-refine", label: "Chain Refine", history, final: current };
  }

  // Mode 4: Devil's Advocate — propose, challenge, then resolve
  async function runDevilsAdvocate(task, models, signal) {
    SwarmState.active = true;
    const currentModel = document.getElementById("model")?.value || "llama3.2";
    const proposer   = models[0] || currentModel;
    const challenger = models[1] || models[0] || currentModel;
    const resolver   = models[2] || currentModel;

    swarmLog("Proposer", `Proposing with ${proposer}…`);
    let proposal = "";
    try {
      proposal = await ollamaChat(proposer, [
        { role: "system", content: "Give a clear, confident answer." },
        { role: "user", content: task }
      ], null, signal);
    } catch (e) { if (e.name === "AbortError") throw e; proposal = "[Error]"; }
    swarmLog("Proposer", "Proposal ready.", "done");

    swarmLog("Challenger", `Challenging with ${challenger}…`);
    let challenge = "";
    try {
      challenge = await ollamaChat(challenger, [
        { role: "system", content: "You are a devil's advocate. Find flaws, missing points, and counter-arguments in the answer below." },
        { role: "user", content: `Task: ${task.slice(0, 300)}\n\nProposed answer:\n${proposal.slice(0, 600)}` }
      ], null, signal);
    } catch (e) { if (e.name === "AbortError") throw e; challenge = "[Error]"; }
    swarmLog("Challenger", "Challenge ready.", "done");

    swarmLog("Resolver", `Resolving with ${resolver}…`);
    let resolution = "";
    try {
      resolution = await ollamaChat(resolver, [
        { role: "system", content: "Given a proposal and a challenge, write the best possible final answer that incorporates valid criticisms." },
        { role: "user", content: `Task: ${task.slice(0, 300)}\n\nProposal:\n${proposal.slice(0, 400)}\n\nChallenge:\n${challenge.slice(0, 400)}\n\nWrite the improved final answer.` }
      ], null, signal);
    } catch (e) { if (e.name === "AbortError") throw e; resolution = proposal; }
    swarmLog("Resolver", "Resolution ready.", "done");

    SwarmState.active = false;
    return { mode: "devils-advocate", label: "Devil's Advocate", proposal, challenge, resolution };
  }

  // Swarm runner — dispatches to the right mode
  async function runSwarm(mode, task, models) {
    if (!task?.trim()) { alert("Enter a task first."); return; }
    if (!models?.length) { alert("Select at least one model."); return; }
    SwarmState.log = [];
    renderSwarmLog();

    if (swarmAbort) swarmAbort.abort();
    swarmAbort = new AbortController();
    const signal = swarmAbort.signal;

    const termBtn = document.getElementById("cv-swarm-terminate");
    if (termBtn) termBtn.classList.add("visible");

    let result;
    try {
      if      (mode === "boss-team")       result = await runBossTeam(task, models, signal);
      else if (mode === "all-vote")        result = await runAllVote(task, models, signal);
      else if (mode === "chain-refine")    result = await runChainRefine(task, models, signal);
      else if (mode === "devils-advocate") result = await runDevilsAdvocate(task, models, signal);
      else return;
    } catch (err) {
      if (err.name === "AbortError") swarmLog("System", "Swarm stopped by user.", "err");
      else swarmLog("Error", err.message, "err");
      return;
    } finally {
      swarmAbort = null;
      if (termBtn) termBtn.classList.remove("visible");
    }

    showSwarmResult(result);
    injectSwarmResult(result);
  }

  // Display result inline in the swarm panel
  function showSwarmResult(result) {
    const box   = document.getElementById("cv-swarm-result-box");
    const body  = document.getElementById("cv-swarm-result-body");
    const title = document.getElementById("cv-swarm-result-title");
    if (!box || !body) return;
    let content = "";
    if      (result.mode === "boss-team")       content = result.synthesis;
    else if (result.mode === "all-vote")        content = result.verdict;
    else if (result.mode === "chain-refine")    content = result.final;
    else if (result.mode === "devils-advocate") content = result.resolution;
    if (title) title.textContent = (result.label || result.mode) + " — Result";
    body.textContent = content;
    box.classList.add("visible");
  }

  // Also push result to the chat tab
  function injectSwarmResult(result) {
    const label = result.label || result.mode;
    let content = "";
    if      (result.mode === "boss-team")       content = `**Swarm — ${label}**\n\n${result.synthesis}\n\n---\n*${result.results.length} workers collaborated.*`;
    else if (result.mode === "all-vote")        content = `**Swarm — ${label}**\n\n${result.verdict}\n\n---\n*${result.votes.length} models voted.*`;
    else if (result.mode === "chain-refine")    content = `**Swarm — ${label}**\n\n${result.final}\n\n---\n*Refined through ${result.history.length} steps.*`;
    else if (result.mode === "devils-advocate") content = `**Swarm — ${label}**\n\n${result.resolution}\n\n---\n*Proposal challenged and resolved.*`;
    if (typeof state !== "undefined") {
      state.messages.push({ role: "assistant", content, id: Date.now().toString(36), ts: Date.now() });
      if (typeof render === "function") render();
      if (typeof persistCurrentChat === "function") persistCurrentChat();
    }
  }

  // ── Chat text selection toolbar ────────────────────────────────────
  (function initSelectionToolbar() {
    const toolbar = document.getElementById("selectionToolbar");
    const btnCopy  = document.getElementById("stb-copy");
    const btnQuote = document.getElementById("stb-quote");
    const btnExplain = document.getElementById("stb-explain");
    const btnFix   = document.getElementById("stb-fix");
    if (!toolbar) return;

    function getSelectedText() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return "";
      return sel.toString().trim();
    }

    function isInsideBubble(node) {
      while (node) {
        if (node.classList && node.classList.contains("bubble")) return true;
        node = node.parentNode;
      }
      return false;
    }

    function showToolbar() {
      const sel = window.getSelection();
      const text = getSelectedText();
      if (!text || sel.rangeCount === 0) { hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height) { hideToolbar(); return; }
      if (!isInsideBubble(range.commonAncestorContainer)) { hideToolbar(); return; }

      // Show/hide Fix button based on whether we're in code mode
      if (btnFix) btnFix.style.display = document.body.classList.contains("coder-mode") ? "" : "none";

      toolbar.classList.add("visible");
      const tbRect = toolbar.getBoundingClientRect();
      let left = rect.left + (rect.width / 2) - (tbRect.width / 2);
      let top = rect.top - tbRect.height - 10;
      if (left < 8) left = 8;
      if (left + tbRect.width > window.innerWidth - 8) left = window.innerWidth - tbRect.width - 8;
      if (top < 8) top = rect.bottom + 10;
      toolbar.style.left = left + "px";
      toolbar.style.top = top + "px";
    }

    function hideToolbar() {
      toolbar.classList.remove("visible");
    }

    document.addEventListener("mouseup", () => {
      requestAnimationFrame(() => {
        const text = getSelectedText();
        if (text) showToolbar();
        else hideToolbar();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hideToolbar(); window.getSelection().removeAllRanges(); }
    });
    document.addEventListener("mousedown", (e) => {
      if (!toolbar.contains(e.target)) hideToolbar();
    });

    if (btnCopy) btnCopy.addEventListener("click", () => {
      const text = getSelectedText();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
      hideToolbar();
    });

    if (btnQuote) btnQuote.addEventListener("click", () => {
      const text = getSelectedText();
      if (text) {
        const quote = text.split("\n").map(l => "> " + l).join("\n");
        input.value = (input.value ? input.value + "\n\n" : "") + quote + "\n\n";
        input.focus();
      }
      hideToolbar();
    });

    if (btnExplain) btnExplain.addEventListener("click", () => {
      const text = getSelectedText();
      if (text) {
        input.value = `Explain this:\n\n${text}`;
        input.focus();
        send();
      }
      hideToolbar();
    });

    if (btnFix) btnFix.addEventListener("click", () => {
      const text = getSelectedText();
      if (text) {
        input.value = `Fix or improve this code:\n\n\`\`\`\n${text}\n\`\`\``;
        input.focus();
        send();
      }
      hideToolbar();
    });
  })();

  // ── Global keyboard shortcuts ─────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    // Cmd/Ctrl + Shift + C → toggle Coder Mode
    if (e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (isCodeMode()) setTab(state._preCoderTab || 'chats');
      else setTab('code');
      return;
    }
    // Cmd/Ctrl + Shift + N → new chat
    if (e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newChat();
      return;
    }
    // Cmd/Ctrl + K → focus model picker (mini command palette)
    if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
      e.preventDefault();
      modelEl.focus();
      return;
    }
  });

  // ── Cross-module bridge — lets swarm-maker.js (loaded separately) access core app functions ──
  window._H = {
    get state()                  { return state; },
    runOneTool,
    appendAssistantToolCallTurn,
    appendToolResult,
    extractPythonFence,
    persistCurrentChat,
    setTab,
    safeExitMode,
    render,
    ollamaChat,
    backendAuthHeaders,
    selectedModel: () => modelEl.value,
    selectedTemperature: () => (v => Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.3)(parseFloat(tempEl.value)),
    agentTurnOpenAI,
    agentTurnGemini,
    agentTurnAnthropic,
    agentTurnOllama,
    buildOpenAITools,
    buildGeminiTools,
    buildOllamaTools,
    buildOllamaMessages,
    safeJsonParse,
    updateLastBubble,
    flushPendingBubbleUpdate,
    isCodeMode,
    parseCloudModel,
    getAvailableCloudModels,
    showError,
    escapeHtml,
    runSwarm,
    registerMode(id, config) {
      (window._registeredModes = window._registeredModes || {})[id] = normalizeModeConfig(id, config);
    },
  };



})();
