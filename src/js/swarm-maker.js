// ════════════════════════════════════════════════════════════════════
//  SWARM MAKER — loaded separately from app.js
//  Dependencies are wired through window._H (set by app.js at boot).
// ════════════════════════════════════════════════════════════════════

/* global wrappers — these call the live functions exposed by app.js */
const runOneTool                  = (...a) => window._H.runOneTool(...a);
const appendAssistantToolCallTurn = (...a) => window._H.appendAssistantToolCallTurn(...a);
const appendToolResult            = (...a) => window._H.appendToolResult(...a);
const extractPythonFence          = (...a) => window._H.extractPythonFence(...a);
const persistCurrentChat          = (...a) => window._H.persistCurrentChat(...a);
const setTab                      = (...a) => window._H.setTab(...a);
const render                      = (...a) => window._H.render(...a);
const agentTurnOpenAI             = (...a) => window._H.agentTurnOpenAI(...a);
const agentTurnGemini             = (...a) => window._H.agentTurnGemini(...a);
const agentTurnOllama             = (...a) => window._H.agentTurnOllama(...a);
const buildOpenAITools            = (...a) => window._H.buildOpenAITools(...a);
const buildGeminiTools            = (...a) => window._H.buildGeminiTools(...a);
const buildOllamaTools            = (...a) => window._H.buildOllamaTools(...a);

// ═══════════════════════════════════════════════════════════════════
//  SWARM MAKER — Agent swarm architect studio (Phases 2–6)
// ═══════════════════════════════════════════════════════════════════
const SwarmMaker = (() => {

  // ── State ──────────────────────────────────────────────────────────
  let blueprints = [];
  let activeBlueprintId = null;
  let selectedAgentId   = null;
  let nodePositions     = {};   // { agentId: {x, y} }
  let nodeStatuses      = {};   // { agentId: "idle"|"running"|"done"|"error" }
  let swarmAbortCtrl    = null;
  let traceRunCount     = 0;
  let shiftSelectFrom   = null; // agent id we started edge-drawing from
  let mounted           = false;
  let tplPanelOpen      = false;
  let lastSwarmOutput   = "";

  const STORE_KEY = "hashui_swarm_blueprints";
  const NODE_W = 164, NODE_H = 74, H_GAP = 64, V_GAP = 44;

  let _polishedHtmlCache = "";

  // ── Themed dialogs ─────────────────────────────────────────────────
  function _amkDialog({ msg, showInput, inputDefault, showCancel }) {
    return new Promise(resolve => {
      const overlay  = document.getElementById("amkDialog");
      const msgEl    = document.getElementById("amkDialogMsg");
      const inputEl  = document.getElementById("amkDialogInput");
      const okBtn    = document.getElementById("amkDialogOk");
      const cancelBtn= document.getElementById("amkDialogCancel");
      if (!overlay) { resolve(showInput ? inputDefault : (showCancel ? true : undefined)); return; }
      msgEl.textContent          = msg;
      inputEl.style.display      = showInput  ? "block" : "none";
      cancelBtn.style.display    = showCancel ? "" : "none";
      if (showInput) { inputEl.value = inputDefault || ""; }
      overlay.classList.add("open");
      if (showInput) setTimeout(() => inputEl.focus(), 80);
      const cleanup = () => { overlay.classList.remove("open"); okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); inputEl.removeEventListener("keydown", onKey); };
      const onOk     = () => { cleanup(); resolve(showInput ? inputEl.value : true); };
      const onCancel = () => { cleanup(); resolve(showInput ? null : false); };
      const onKey    = (e) => { if (e.key === "Enter") onOk(); if (e.key === "Escape") onCancel(); };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      inputEl.addEventListener("keydown", onKey);
    });
  }
  const amkAlert   = (msg) => _amkDialog({ msg, showInput: false, showCancel: false });
  const amkConfirm = (msg) => _amkDialog({ msg, showInput: false, showCancel: true });
  const amkPrompt  = (msg, def) => _amkDialog({ msg, showInput: true, inputDefault: def, showCancel: true });

  // ── Canvas zoom/pan state ──────────────────────────────────────────
  let dagZoom = 1.0;
  let dagPan  = { x: 0, y: 0 };
  const DAG_ZOOM_MIN = 0.2, DAG_ZOOM_MAX = 3.0, DAG_ZOOM_STEP = 0.05;

  function _dagTransform() {
    const g = document.getElementById("amkDagContent");
    const val = document.getElementById("amkZoomVal");
    if (g) g.setAttribute("transform", `translate(${dagPan.x},${dagPan.y}) scale(${dagZoom})`);
    if (val) val.textContent = Math.round(dagZoom * 100) + "%";
  }

  function applyDagZoom(newZ, pivotScreen) {
    const svg = document.getElementById("amkDagSvg");
    if (!svg) return;
    const oldZ = dagZoom;
    const z = Math.min(DAG_ZOOM_MAX, Math.max(DAG_ZOOM_MIN, newZ));
    if (!pivotScreen) {
      const r = svg.getBoundingClientRect();
      pivotScreen = { x: r.width / 2, y: r.height / 2 };
    }
    // Keep world point under pivot fixed
    const wx = (pivotScreen.x - dagPan.x) / oldZ;
    const wy = (pivotScreen.y - dagPan.y) / oldZ;
    dagZoom = z;
    dagPan.x = pivotScreen.x - wx * dagZoom;
    dagPan.y = pivotScreen.y - wy * dagZoom;
    _dagTransform();
  }

  // ── Role colours ────────────────────────────────────────────────────
  const ROLE_COLORS = {
    researcher: "#4ecdc4", writer: "#a78bfa", critic: "#d98a85",
    coder: "#5fb88a", analyst: "#c9a96e", validator: "#e8a94a",
    supervisor: "#7c6af5", custom: "#8899aa"
  };

  // ── Starter templates ──────────────────────────────────────────────
  const ALL_TOOL_IDS = ["memory","web_search","fetch_url","wikipedia","pubmed","datetime","calculate","code_interpreter"];
  const TEMPLATES = [
    {
      name: "Research Swarm", icon: "🔬", description: "Deep research with fact-checking and synthesis",
      topology: "pipeline", aggregation: "synthesis",
      agents: [
        { id: "a1", name: "Researcher", icon: "🔬", role: "researcher", systemPrompt: "You are a thorough researcher. Search for information, gather facts, and produce detailed research notes on the given topic.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.7 },
        { id: "a2", name: "Fact-Checker", icon: "✅", role: "validator", systemPrompt: "You are a rigorous fact-checker. Review the research notes provided and identify which claims are well-supported, uncertain, or potentially incorrect.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.3 },
        { id: "a3", name: "Summarizer",  icon: "📝", role: "writer",     systemPrompt: "You are an expert summarizer. Synthesize the research and fact-check results into a clear, well-structured, cited summary report.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.6 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Dev Squad", icon: "💻", description: "Plan → Code → Review → Test cycle",
      topology: "sequential", aggregation: "hierarchical",
      agents: [
        { id: "a1", name: "Planner",    icon: "🗺️", role: "analyst",  systemPrompt: "You are a senior software architect. Break down the feature request into a clear implementation plan with subtasks, architecture decisions, and acceptance criteria.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.5 },
        { id: "a2", name: "Coder",      icon: "💻", role: "coder",    systemPrompt: "You are an expert software engineer. Implement the plan provided. Write clean, production-ready code with proper error handling.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 150, retries: 2, temperature: 0.4 },
        { id: "a3", name: "Reviewer",   icon: "🔍", role: "critic",   systemPrompt: "You are a senior code reviewer. Review the code for bugs, security issues, performance problems, and style violations. Be specific and constructive.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4 },
        { id: "a4", name: "Documenter", icon: "📚", role: "writer",   systemPrompt: "You are a technical writer. Write clear, concise documentation for the code including function descriptions, usage examples, and edge cases.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.6 }
      ],
      dag: { nodes: ["a1","a2","a3","a4"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }, { from:"a2", to:"a4" }] }
    },
    {
      name: "Debate Club", icon: "⚖️", description: "Advocate → Critic → Synthesizer for decisions",
      topology: "debate", aggregation: "synthesis",
      agents: [
        { id: "a1", name: "Advocate",     icon: "⚖️", role: "writer",     systemPrompt: "You are a persuasive advocate. Present the strongest possible case in favor of the proposed position. Be thorough and convincing.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.8 },
        { id: "a2", name: "Critic",        icon: "🔥", role: "critic",     systemPrompt: "You are a sharp critic. Challenge the proposal rigorously. Identify weaknesses, risks, and counterarguments. Be direct and analytical.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.8 },
        { id: "a3", name: "Synthesizer",   icon: "🌐", role: "supervisor", systemPrompt: "You are a neutral synthesizer. Review the advocate and critic arguments and produce a balanced, nuanced final verdict with clear recommendation.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.5 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a3" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Data Analyst", icon: "📊", description: "Extract → Analyze → Report pipeline",
      topology: "pipeline", aggregation: "synthesis",
      agents: [
        { id: "a1", name: "Extractor",   icon: "📥", role: "analyst",    systemPrompt: "You are a data extraction expert. Extract all key data points, metrics, and structured information from the provided content.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.3 },
        { id: "a2", name: "Statistician",icon: "📊", role: "analyst",    systemPrompt: "You are a statistician. Analyze the extracted data, identify patterns, trends, anomalies, and compute relevant statistics.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4 },
        { id: "a3", name: "Reporter",    icon: "📋", role: "writer",     systemPrompt: "You are a data reporter. Transform the statistical analysis into a clear, executive-level report with key insights and actionable recommendations.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.6 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Security Audit", icon: "🛡️", description: "Parallel scan → Consensus verdict",
      topology: "parallel", aggregation: "voting",
      agents: [
        { id: "a1", name: "Scanner",    icon: "🔭", role: "analyst",    systemPrompt: "You are a security scanner. Analyze the provided code or config for security vulnerabilities, hardcoded secrets, and unsafe patterns.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.2 },
        { id: "a2", name: "Forensics",  icon: "🔬", role: "analyst",    systemPrompt: "You are a digital forensics expert. Examine the provided content for indicators of compromise, malicious logic, and suspicious behavior.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.2 },
        { id: "a3", name: "Reporter",   icon: "📋", role: "writer",     systemPrompt: "You are a security reporter. Combine the scanner and forensics findings into a structured security report with severity ratings and remediation steps.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a3" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Content Factory", icon: "✍️", description: "Research → Outline → Write → Edit",
      topology: "sequential", aggregation: "hierarchical",
      agents: [
        { id: "a1", name: "Researcher", icon: "🔍", role: "researcher", systemPrompt: "You are a content researcher. Gather key facts, statistics, and insights on the topic to inform a high-quality article.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.7 },
        { id: "a2", name: "Outliner",   icon: "📐", role: "analyst",    systemPrompt: "You are a content strategist. Create a detailed article outline with headings, key points per section, and narrative flow.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 60, retries: 1, temperature: 0.6 },
        { id: "a3", name: "Writer",     icon: "✍️", role: "writer",     systemPrompt: "You are a skilled content writer. Write a compelling, well-structured article based on the research and outline provided.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.75 },
        { id: "a4", name: "Editor",     icon: "✏️", role: "critic",     systemPrompt: "You are a professional editor. Polish the draft for clarity, flow, grammar, and engagement. Improve without changing the core message.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.5 }
      ],
      dag: { nodes: ["a1","a2","a3","a4"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }, { from:"a3", to:"a4" }] }
    },
    {
      name: "Website Builder", icon: "🌐", description: "Design → HTML → CSS/Tailwind → JS → QA preview",
      topology: "pipeline", aggregation: "concat",
      task: "Build a modern landing page website",
      agents: [
        {
          id: "wb1", name: "Designer", icon: "🎨", role: "analyst",
          systemPrompt: "You are a UI/UX designer. Given a website brief, produce a detailed written design spec: layout sections, colour palette (hex), typography, component list, and Tailwind class strategy. Do NOT write code yet — output a structured design document.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 60, retries: 1, temperature: 0.7
        },
        {
          id: "wb2", name: "HTML Builder", icon: "🌐", role: "coder",
          systemPrompt: "You are an expert HTML developer. Using the design spec, write the complete semantic HTML for the website.\n\nOutput EXACTLY this format — do not deviate:\n```html index.html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>...</title>\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  ...ALL content here, no truncation...\n  <script src=\"app.js\"></script>\n</body>\n</html>\n```\n\nRules: include ALL sections in full — never truncate with '...' or comments like '<!-- rest of content -->'.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.4
        },
        {
          id: "wb3", name: "Style Agent", icon: "🎨", role: "writer",
          systemPrompt: "You are a CSS expert. Write ALL custom CSS for this website (animations, gradients, custom fonts, component overrides, anything Tailwind can't handle alone).\n\nOutput EXACTLY this format:\n```css styles.css\n/* All custom CSS here */\n:root { ... }\n/* animations, custom components, etc. */\n```\n\nRules: always output the complete file even if minimal — never skip this file.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4
        },
        {
          id: "wb4", name: "JS Developer", icon: "⚡", role: "coder",
          systemPrompt: "You are a vanilla JavaScript developer. Add ALL interactivity: mobile nav toggle, smooth scroll, animations, carousels, modals, form validation, counters, etc.\n\nOutput EXACTLY this format:\n```javascript app.js\n// All JavaScript here\ndocument.addEventListener('DOMContentLoaded', () => {\n  ...\n});\n```\n\nRules: vanilla JS only (no frameworks), always output the complete file.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.4
        },
        {
          id: "wb5", name: "QA Agent", icon: "✅", role: "validator",
          systemPrompt: "You are a web QA engineer. Review index.html, styles.css, and app.js for: broken file references, unclosed tags, undefined CSS classes, JS errors, accessibility issues.\n\nFor each file that needs fixes, output the COMPLETE corrected version using the SAME format:\n```html index.html\n...full corrected file...\n```\n```css styles.css\n...full corrected file...\n```\n```javascript app.js\n...full corrected file...\n```\n\nIf a file is already correct, say so and do NOT re-output it.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.3
        }
      ],
      dag: {
        nodes: ["wb1","wb2","wb3","wb4","wb5"],
        edges: [
          { from:"wb1", to:"wb2" }, { from:"wb1", to:"wb3" },
          { from:"wb2", to:"wb4" }, { from:"wb3", to:"wb4" },
          { from:"wb4", to:"wb5" }
        ]
      }
    }
  ];

  // ── Storage ────────────────────────────────────────────────────────
  function loadBlueprints() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      blueprints = raw ? JSON.parse(raw) : [];
    } catch { blueprints = []; }
    // Enforce 2-word limit on all loaded names and persist if anything changed
    let dirty = false;
    blueprints.forEach(bp => {
      const fixed = enforceTwoWordName(bp.name);
      if (fixed !== bp.name) { bp.name = fixed; dirty = true; }
    });
    if (dirty) saveBlueprints();
  }

  function saveBlueprints() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(blueprints)); } catch {}
  }

  // ── Blueprint CRUD ─────────────────────────────────────────────────
  function enforceTwoWordName(raw) {
    const words = (raw || "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).join(" ") || "My Swarm";
  }

  function createBlueprint(name, fromTemplate) {
    const id = "bp_" + Date.now().toString(36);
    const bp = fromTemplate ? JSON.parse(JSON.stringify(fromTemplate)) : {
      agents: [], dag: { nodes: [], edges: [] }, topology: "pipeline", aggregation: "synthesis"
    };
    bp.id = id;
    bp.name = enforceTwoWordName(name || "Untitled Swarm");
    bp.task = bp.task || "";
    bp.createdAt = Date.now();
    blueprints.unshift(bp);
    saveBlueprints();
    return bp;
  }

  function deleteBlueprint(id) {
    blueprints = blueprints.filter(b => b.id !== id);
    if (activeBlueprintId === id) { activeBlueprintId = null; selectedAgentId = null; }
    saveBlueprints();
  }

  function getActive() { return blueprints.find(b => b.id === activeBlueprintId) || null; }

  function setActive(id) {
    activeBlueprintId = id;
    selectedAgentId = null;
    nodeStatuses = {};
    dagZoom = 1.0; dagPan = { x: 20, y: 20 }; // reset view on blueprint switch
    const bp = getActive();
    if (bp) {
      autoLayoutBlueprint(bp);
      const taskEl = document.getElementById("amkTaskInput");
      if (taskEl && bp.task != null) taskEl.value = bp.task;
    }
  }

  // ── Agent CRUD ─────────────────────────────────────────────────────

  function addAgentToBlueprint(bp, overrides) {
    const id = "ag_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,5);
    const agent = {
      id, name: "New Agent", icon: "🤖", role: "custom",
      systemPrompt: "You are a helpful AI agent. Complete the assigned task thoroughly.",
      tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.7,
      model: document.getElementById("model")?.value || "",
      ...overrides
    };
    bp.agents.push(agent);
    bp.dag.nodes.push(id);
    saveBlueprints();
    return agent;
  }

  function removeAgentFromBlueprint(bp, agentId) {
    bp.agents = bp.agents.filter(a => a.id !== agentId);
    bp.dag.nodes = bp.dag.nodes.filter(n => n !== agentId);
    bp.dag.edges = bp.dag.edges.filter(e => e.from !== agentId && e.to !== agentId);
    saveBlueprints();
  }

  function addEdge(bp, fromId, toId) {
    if (fromId === toId) return;
    if (bp.dag.edges.some(e => e.from === fromId && e.to === toId)) return;
    bp.dag.edges.push({ from: fromId, to: toId });
    saveBlueprints();
  }

  function removeEdge(bp, fromId, toId) {
    bp.dag.edges = bp.dag.edges.filter(e => !(e.from === fromId && e.to === toId));
    saveBlueprints();
  }

  // ── DAG cycle detection ────────────────────────────────────────────
  function hasCycle(agents, edges) {
    const visited = {}, stack = {};
    function dfs(id) {
      if (stack[id]) return true;
      if (visited[id]) return false;
      visited[id] = stack[id] = true;
      for (const e of edges) {
        if (e.from === id && dfs(e.to)) return true;
      }
      stack[id] = false;
      return false;
    }
    return agents.some(a => dfs(a.id));
  }

  // ── Auto-layout (topological sort → layered positions) ────────────
  function autoLayoutBlueprint(bp) {
    const agents = bp.agents || [];
    const edges  = bp.dag?.edges || [];
    if (!agents.length) { nodePositions = {}; return; }

    const children  = Object.fromEntries(agents.map(a => [a.id, []]));
    const inDegree  = Object.fromEntries(agents.map(a => [a.id, 0]));
    for (const e of edges) {
      if (children[e.from]) children[e.from].push(e.to);
      if (inDegree[e.to] !== undefined) inDegree[e.to]++;
    }

    const layers = [];
    const queue  = agents.filter(a => inDegree[a.id] === 0).map(a => a.id);
    const placed = new Set();

    while (queue.length) {
      const layer = queue.splice(0);
      layers.push(layer);
      layer.forEach(nid => {
        placed.add(nid);
        (children[nid] || []).forEach(cid => {
          inDegree[cid]--;
          if (inDegree[cid] === 0 && !placed.has(cid)) queue.push(cid);
        });
      });
    }

    // Any nodes not in layers (isolated) get their own layer
    const unlayered = agents.filter(a => !layers.flat().includes(a.id));
    if (unlayered.length) layers.push(unlayered.map(a => a.id));

    const SVG_H = 480;
    nodePositions = {};
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const totalH = layer.length * NODE_H + (layer.length - 1) * V_GAP;
      const startY = Math.max(24, (SVG_H - totalH) / 2);
      layer.forEach((nid, i) => {
        nodePositions[nid] = { x: 40 + li * (NODE_W + H_GAP), y: startY + i * (NODE_H + V_GAP) };
      });
    }
  }

  // ── LLM call dispatcher ────────────────────────────────────────────
  async function callAgentLLM(modelValue, messages, signal, temperature) {
    const mv = modelValue || document.getElementById("model")?.value || "llama3.2";
    const temp = typeof temperature === "number" ? temperature : 0.7;
    // Build tool definitions from agent config
    const agentObj = arguments[4] || null; // optional 5th arg
    if (mv.startsWith("cloud:")) {
      const rest     = mv.slice(6);
      const colon    = rest.indexOf(":");
      const provider = colon !== -1 ? rest.slice(0, colon) : rest;
      const model    = colon !== -1 ? rest.slice(colon + 1) : rest;
      if (provider === "gemini") {
        return await agentTurnGemini({ model, messages, tools: agentObj ? buildGeminiTools(agentObj) : [], temperature: temp, signal });
      }
      return await agentTurnOpenAI({ provider, model, messages, tools: agentObj ? buildOpenAITools(agentObj) : [], temperature: temp, signal });
    }
    return await agentTurnOllama({ model: mv, messages, tools: agentObj ? buildOllamaTools(agentObj) : [], temperature: temp, signal });
  }

  function modelTraceLabel(modelValue) {
    const mv = modelValue || "default";
    if (!mv.startsWith("cloud:")) return `local:${mv}`;
    const [, provider, model] = mv.split(":");
    return `${provider || "cloud"}:${model || "default"}`;
  }

  // Returns whether an error looks like a rate-limit / quota / availability failure
  function isRateLimitError(err) {
    const msg = (err?.message || "").toLowerCase();
    return /rate.?limit|quota|429|too many|capacity|overloaded|unavailable|timeout|timed.?out|not respond|network|failed to fetch/i.test(msg);
  }

  // Hard incompatibility errors — provider / model can't run this request at all.
  // Treat like a provider failure: failover immediately, no wait.
  function isHardProviderError(err) {
    const msg = err?.message || "";
    return /tool.{0,10}call(ing)?.{0,10}(not supported|unsupported|unavailable|disabled)|function.{0,10}call(ing)?.{0,10}not supported|does not support.{0,10}tool|tools?.{0,10}not.{0,10}supported|invalid_request_error|jsondecodeerror|expecting property name enclosed in double quotes|invalid.{0,20}(tool|function).{0,20}(json|arguments)|context.{0,10}length|maximum.{0,10}token|model.{0,10}not.{0,10}found|no such model/i.test(msg);
  }

  // Provider priority per agent role — best fit first
  const ROLE_PROVIDER_PRIORITY = {
    researcher:  ["groq","openrouter","gemini","samba","cerebras"],
    analyst:     ["groq","samba","openrouter","gemini","cerebras"],
    coder:       ["openrouter","samba","groq","gemini","cerebras"],
    writer:      ["gemini","openrouter","samba","groq","cerebras"],
    critic:      ["openrouter","samba","gemini","groq","cerebras"],
    validator:   ["cerebras","groq","openrouter","gemini","samba"],
    supervisor:  ["samba","gemini","openrouter","groq","cerebras"],
    custom:      ["groq","gemini","openrouter","samba","cerebras"],
  };

  // Build a role-prioritised list of fallback models, one per untried provider.
  function getFailoverModels(currentModel, triedModels, role) {
    const tried = new Set(triedModels);
    tried.add(currentModel);
    const triedProviders = new Set([...tried].map(v => v?.startsWith("cloud:") ? v.split(":")[1] : "local"));

    // One model per provider from the dropdown
    const opts = Array.from(document.getElementById("model")?.options || []).map(o => o.value).filter(v => v);
    const providerMap = {};
    for (const v of opts) {
      const prov = v.startsWith("cloud:") ? v.split(":")[1] : "local";
      if (!providerMap[prov]) providerMap[prov] = v;
    }

    const priority = ROLE_PROVIDER_PRIORITY[role] || ROLE_PROVIDER_PRIORITY.custom;
    const pool = [];
    // Add in role-priority order first
    for (const prov of priority) {
      if (!triedProviders.has(prov) && providerMap[prov]) pool.push(providerMap[prov]);
    }
    // Then any remaining providers not in the priority list
    for (const [prov, v] of Object.entries(providerMap)) {
      if (!triedProviders.has(prov) && !pool.includes(v)) pool.push(v);
    }
    return pool;
  }

  // Extract any useful partial progress from message history before switching models.
  // Returns a concise summary string or "" if nothing found.
  function summariseProgress(messages) {
    // Return partial assistant output directly — no extra LLM round-trip on failover.
    const assistantMsgs = messages.filter(m => m.role === "assistant" && m.content);
    if (!assistantMsgs.length) return "";
    const combined = assistantMsgs.map(m => m.content).join("\n\n").trim();
    return combined ? `[Partial progress from previous attempt]\n${combined.slice(0, 1200)}` : "";
  }

  // Detects and wraps raw unfenced code blocks in an agent's text output.
  // Handles: full-document HTML, inline raw tag blocks, and common code patterns.
  function normaliseAgentOutput(text) {
    if (!text) return text;

    // Already fully fenced — nothing to do
    const hasFence = /```[\w]*\n[\s\S]*?```/.test(text);

    // Split text into lines and scan for contiguous raw-code regions
    const lines = text.split("\n");
    const out   = [];
    let   block = null; // { lang, lines[] }

    const flushBlock = () => {
      if (!block) return;
      out.push("```" + block.lang);
      out.push(...block.lines);
      out.push("```");
      block = null;
    };

    // Patterns that signal the start of a raw code line
    const HTML_LINE   = /^\s*(<(!DOCTYPE|html|head|body|div|section|header|footer|nav|main|article|aside|span|p|h[1-6]|ul|ol|li|a|img|input|button|form|table|tr|td|th|script|style|link|meta|title)[^>]*>|<\/\w+>|<!--)/i;
    const PY_LINE     = /^\s*(import |from |def |class |if __name__|#!\/usr\/bin\/env python)/;
    const JS_LINE     = /^\s*(const |let |var |function |class |import |export |\/\/|=>|async |await )/;
    const CSS_LINE    = /^\s*([.#]?[\w-]+\s*\{|@media|@keyframes|:root\s*\{)/;
    const JSON_START  = /^\s*[\[{]/;
    const BASH_LINE   = /^\s*(#!\/bin\/|apt |npm |pip |curl |wget |echo |export |cd |mkdir |chmod )/;

    function detectLang(line) {
      if (HTML_LINE.test(line)) return "html";
      if (PY_LINE.test(line))   return "python";
      if (JS_LINE.test(line))   return "javascript";
      if (CSS_LINE.test(line))  return "css";
      if (BASH_LINE.test(line)) return "bash";
      return null;
    }

    // If the whole output looks like a single language document, wrap it all
    if (!hasFence) {
      const trimmed = text.trim();
      if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
        return "```html\n" + text.trim() + "\n```";
      }
      const nonEmpty = lines.filter(l => l.trim());
      if (nonEmpty.length > 3) {
        const htmlRatio = nonEmpty.filter(l => HTML_LINE.test(l)).length / nonEmpty.length;
        const pyRatio   = nonEmpty.filter(l => PY_LINE.test(l) || /^\s{4}/.test(l)).length / nonEmpty.length;
        const jsRatio   = nonEmpty.filter(l => JS_LINE.test(l)).length / nonEmpty.length;
        if (htmlRatio > 0.45) return "```html\n" + text.trim() + "\n```";
        if (pyRatio   > 0.45) return "```python\n" + text.trim() + "\n```";
        if (jsRatio   > 0.45) return "```javascript\n" + text.trim() + "\n```";
      }
    }

    if (hasFence) return text; // already has fences, trust them

    // Mixed content: scan line-by-line for raw code islands
    for (const line of lines) {
      if (line.startsWith("```")) { flushBlock(); out.push(line); continue; }
      const lang = detectLang(line);
      if (lang) {
        if (!block) block = { lang, lines: [] };
        else if (block.lang !== lang) { flushBlock(); block = { lang, lines: [] }; }
        block.lines.push(line);
      } else {
        if (block && line.trim() === "") {
          block.lines.push(line); // allow blank lines inside a block
        } else {
          flushBlock();
          out.push(line);
        }
      }
    }
    flushBlock();
    return out.join("\n");
  }

  // ── Execute a single agent (with tool-calling loop) ────────────────
  async function executeOneAgent(agent, task, depResults, signal, execOptions = {}) {
    const depCharLimit = execOptions.dependencyCharLimit || 2000;
    const finalOwnerId = execOptions.finalOutputAgentId || "";
    const isFinalOwner = finalOwnerId && agent.id === finalOwnerId;
    const contextLines = Object.entries(depResults)
      .filter(([,v]) => v)
      .map(([name, out]) => {
        const text = String(out);
        const limit = isFinalOwner ? Math.max(depCharLimit, text.length) : depCharLimit;
        return `\n[${name}]:\n${text.slice(0, limit)}`;
      });
    const context = contextLines.length ? "\n\n--- Input from prior agents ---" + contextLines.join("") : "";
    const hasPyTool = (agent.tools || []).includes("code_interpreter");
    const codeNote = hasPyTool
      ? "\n\nIMPORTANT: When generating files (PDF, Word, Excel, CSV, etc.) you MUST call the execute_python tool and write the file to /output/<filename>. Do NOT write code in text — call the tool directly so the file downloads to the user."
      : "";
    const fenceNote = "\n\nFORMATTING RULE: Always wrap any code you produce in markdown fenced code blocks with the correct language tag. Examples: ```html, ```python, ```javascript, ```css, ```json, ```bash. Never output raw code outside of fences.";
    const isWebTask = /website|webpage|web app|landing page|frontend|html|tailwind|react|vue|svelte|portfolio|dashboard/i.test(task);
    const webFileNote = isWebTask
      ? "\n\nWEB FILE FORMAT: When outputting files for a web project, include the filename in the fence opener using this exact format:\n```html index.html\n...content...\n```\n```css styles.css\n...content...\n```\n```javascript app.js\n...content...\n```\nThis allows files to be extracted and previewed. Use Tailwind CSS via CDN (<script src=\"https://cdn.tailwindcss.com\"></script>) instead of a local build. Do NOT split a single HTML file across multiple blocks — output each file completely in one block.\n\nWEBSITE QUALITY CONTRACT:\n- Produce a polished, integrated website, not isolated snippets. The HTML must reference the exact CSS and JS files you output.\n- If the task asks for images/products/gallery, use visible remote HTTPS image URLs and add alt text, width/height or stable aspect-ratio, object-fit styling, and an onerror fallback that replaces broken images with an inline SVG/data URI.\n- For jewelry/gold/luxury sites, prefer these known remote image URL patterns when you need real product photos: https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80, https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=80, https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=80.\n- Do not use relative image paths like assets/foo.jpg unless you also output that file. Do not use example.com, placeholder.com, empty src, or fake local paths.\n- If the task asks for a cart, implement add/remove/quantity controls, cart count, total calculation, empty state, and localStorage persistence. Bind events after DOMContentLoaded or use deferred scripts.\n- Use tasteful CSS transitions/keyframes for requested animations, include :hover/:focus states, and include a prefers-reduced-motion fallback.\n- Final supervisor output must be the complete final code bundle only, with no reports or planning prose."
      : "";
    const messages = [
      { role: "system", content: (agent.systemPrompt || `You are ${agent.name}, a ${agent.role || "helpful"} AI agent.`) + codeNote + fenceNote + webFileNote },
      { role: "user",   content: `Task: ${task}${context}\n\nProvide your output directly.` }
    ];
    const timeoutMs = (agent.timeout || 120) * 1000;
    const maxToolRounds = execOptions.maxToolRounds || 8;
    traceAdd(agent.name, `Prepared prompt · role ${agent.role || "custom"} · deps ${contextLines.length} · tools ${(agent.tools || []).length}`, "wait");
    traceAdd(agent.name, `Timeout ${agent.timeout || 120}s · max tool rounds ${maxToolRounds} · model ${modelTraceLabel(agent.model)}`, "wait");

    // Failover state
    let activeModel      = agent.model;
    const triedModels    = [];
    let   failoverLog    = [];   // [{from, to, reason}] — passed to aggregator
    const RETRY_WAIT_MS  = 2000; // wait before same-provider retry (2 s)
    const providerRetries = {};   // provider → number of retries already done
    let attemptNo = 0;

    // outer loop: try each model in the failover chain
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      attemptNo++;
      traceAdd(agent.name, `Attempt ${attemptNo} using ${modelTraceLabel(activeModel)}`, "run");
      try {
        // Tool-calling loop: LLM → tool call → result → repeat
        for (let round = 0; round < maxToolRounds; round++) {
          traceAdd(agent.name, `LLM round ${round + 1}/${maxToolRounds} · sending ${messages.length} message(s)`, "run");
          const result = await Promise.race([
            callAgentLLM(activeModel, messages, signal, agent.temperature, { ...agent, model: activeModel }),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`Agent timeout after ${agent.timeout}s`)), timeoutMs))
          ]);
          if (result.tool_calls && result.tool_calls.length) {
            traceAdd(agent.name, `LLM requested ${result.tool_calls.length} tool call(s)`, "wait");
            appendAssistantToolCallTurn(messages, result.content, result.tool_calls);
            for (const call of result.tool_calls) {
              if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
              traceAdd(agent.name, `Tool call: ${call.name}(${JSON.stringify(call.arguments || {}).slice(0, 80)})`, "wait");
              const toolResult = await runOneTool(call.name, call.arguments, null, null);
              traceAdd(agent.name, `${call.name} returned`, "ok");
              // Announce any generated file downloads in the trace
              if (call.name === "execute_python") {
                try {
                  const tr = typeof toolResult === "string" ? JSON.parse(toolResult) : toolResult;
                  if (tr?.files?.length) {
                    tr.files.forEach(f => traceAdd(agent.name, `File ready: ${f.filename} (${(f.bytes/1024).toFixed(1)} KB) — check your Downloads`, "ok"));
                  }
                } catch {}
              }
              appendToolResult(messages, call, toolResult);
              traceAdd(agent.name, `Tool result appended · transcript now ${messages.length} message(s)`, "wait");
            }
          } else {
            traceAdd(agent.name, `LLM returned final text · ${(result.content || "").length} chars`, "ok");
            // ── Auto-execute safety net (same as regular chat mode) ───────
            // Weaker models sometimes write Python in a markdown fence and
            // claim they ran it — but never call execute_python. Detect and
            // run it so file downloads actually happen.
            const candidateText = result.content || "";
            const hasPyTool = (agent.tools || []).includes("code_interpreter");
            if (hasPyTool && candidateText && round < maxToolRounds - 1) {
              const pyCode = extractPythonFence(candidateText);
              const claimsRan = /\b(downloaded|saved|created|generated|exported|wrote)\b/i.test(candidateText) && /\/output\//.test(candidateText + pyCode);
              if (pyCode && (claimsRan || /\/output\//.test(pyCode))) {
                traceAdd(agent.name, "Model wrote code without calling tool — auto-executing…", "wait");
                const synth = { id: `call_auto_${Date.now()}`, name: "execute_python", arguments: { code: pyCode } };
                appendAssistantToolCallTurn(messages, candidateText, [synth]);
                const autoResult = await runOneTool("execute_python", synth.arguments, null, null);
                // Surface any downloads in the trace
                try {
                  const parsed = typeof autoResult === "string" ? JSON.parse(autoResult) : autoResult;
                  if (parsed?.files?.length) {
                    parsed.files.forEach(f => traceAdd(agent.name, `File ready: ${f.filename} (${(f.bytes/1024).toFixed(1)} KB) — check your Downloads`, "ok"));
                  }
                } catch {}
                appendToolResult(messages, synth, autoResult);
                messages.push({ role: "system", content: "The Python code was executed automatically. Use the result above to write your final answer. Mention the actual filenames from the result. Do not show the code again." });
                traceAdd(agent.name, `Auto-execution result appended · continuing to final round`, "wait");
                continue;
              }
            }
            traceAdd(agent.name, "Normalising final output", "wait");
            const out = normaliseAgentOutput(candidateText || "(no output)");
            // Annotate output with failover info so aggregator can weigh it
            if (failoverLog.length) {
              const note = `\n\n[Note: this agent switched providers during execution — ${failoverLog.map(f=>`${f.from}→${f.to}`).join(", ")}]`;
              traceAdd(agent.name, `Returning output with ${failoverLog.length} failover note(s)`, "ok");
              return out + note;
            }
            traceAdd(agent.name, "Returning output to orchestrator", "ok");
            return out;
          }
        }
        // Fallback if max tool rounds hit
        traceAdd(agent.name, `Max tool rounds reached · using last assistant output`, "warn");
        const rawLast = messages.filter(m => m.role === "assistant").map(m => m.content).filter(Boolean).pop() || "(no output)";
        const last = normaliseAgentOutput(rawLast);
        return failoverLog.length ? last + `\n\n[Failover: ${failoverLog.map(f=>`${f.from}→${f.to}`).join(", ")}]` : last;

      } catch (err) {
        if (err.name === "AbortError" || signal?.aborted) throw err;
        traceAdd(agent.name, `Attempt ${attemptNo} error · ${err.message.slice(0, 120)}`, "warn");

        if (isRateLimitError(err)) {
          const failedProv = activeModel?.startsWith("cloud:") ? activeModel.split(":")[1] : activeModel;

          // Opt. 3 — retry same provider once after short wait if it's a transient rate-limit
          const isQuota = /quota|free.?tier|insufficient.?credits|billing|exceeded/i.test(err.message || "");
          const isTransient = !isQuota && /rate.?limit|429|too many|capacity|overloaded|temporar|try again/i.test(err.message || "");
          providerRetries[failedProv] = (providerRetries[failedProv] || 0);
          if (isTransient && providerRetries[failedProv] < 1) {
            providerRetries[failedProv]++;
            traceAdd(agent.name, `Rate limit on ${failedProv} — waiting 2 s before retry…`, "wait");
            await new Promise(r => setTimeout(r, RETRY_WAIT_MS));
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            traceAdd(agent.name, `Retrying ${failedProv}…`, "wait");
            continue;
          }

          // Opt. 1 — summarise partial progress before switching
          triedModels.push(activeModel);
          const progressSummary = summariseProgress(messages);
          traceAdd(agent.name, progressSummary ? "Captured partial progress before failover" : "No partial progress captured before failover", "wait");

          // Opt. 2 — pick next model ranked by role priority
          const fallbacks = getFailoverModels(activeModel, triedModels, agent.role);
          traceAdd(agent.name, fallbacks.length ? `Failover candidates: ${fallbacks.map(modelTraceLabel).join(", ")}` : "No failover candidates available", fallbacks.length ? "wait" : "err");
          if (fallbacks.length) {
            const next     = fallbacks[0];
            const nextProv = next.startsWith("cloud:") ? next.split(":")[1] : next;
            failoverLog.push({ from: failedProv, to: nextProv, reason: err.message.slice(0, 80) });
            traceAdd(agent.name, `${failedProv} failed — switching to ${nextProv} (role priority)`, "wait");

            activeModel = next;
            // Reset message history to clean state, injecting progress summary so new model isn't cold
            const sysMsg  = messages.find(m => m.role === "system");
            const userMsg = messages.find(m => m.role === "user");
            messages.length = 0;
            if (sysMsg)  messages.push(sysMsg);
            if (progressSummary) messages.push({ role: "system", content: progressSummary });
            if (userMsg) messages.push(userMsg);
            traceAdd(agent.name, `Rebuilt transcript for ${nextProv} · ${messages.length} message(s)`, "wait");
            continue;
          }

          // All providers exhausted
          traceAdd(agent.name, "All providers exhausted — giving up", "err");
          throw new Error(`All providers failed for agent "${agent.name}". Last error: ${err.message}`);
        }

        // Hard provider incompatibility (tool calling not supported, model not found, etc.)
        // Don't retry the same provider — failover immediately like a rate-limit switch.
        if (isHardProviderError(err)) {
          const failedProv = activeModel?.startsWith("cloud:") ? activeModel.split(":")[1] : activeModel;
          triedModels.push(activeModel);
          const fallbacks = getFailoverModels(activeModel, triedModels, agent.role);
          traceAdd(agent.name, fallbacks.length ? `Compatibility failover candidates: ${fallbacks.map(modelTraceLabel).join(", ")}` : "No compatible failover candidates available", fallbacks.length ? "wait" : "err");
          if (fallbacks.length) {
            const next     = fallbacks[0];
            const nextProv = next.startsWith("cloud:") ? next.split(":")[1] : next;
            failoverLog.push({ from: failedProv, to: nextProv, reason: err.message.slice(0, 80) });
            traceAdd(agent.name, `${failedProv} incompatible (${err.message.slice(0,60)}) — switching to ${nextProv}`, "wait");
            activeModel = next;
            // Keep messages intact (no partial work to summarise — the model failed before producing anything)
            const sysMsg  = messages.find(m => m.role === "system");
            const userMsg = messages.find(m => m.role === "user");
            messages.length = 0;
            if (sysMsg)  messages.push(sysMsg);
            if (userMsg) messages.push(userMsg);
            traceAdd(agent.name, `Rebuilt transcript for compatible provider · ${messages.length} message(s)`, "wait");
            continue;
          }
          throw new Error(`No compatible provider found for agent "${agent.name}". Last error: ${err.message}`);
        }

        throw err; // truly unexpected error — propagate
      }
    }
  }

  // Remove back-edges from a cycle by DFS; returns a cycle-free edge list
  function breakCycles(agents, edges) {
    const visited = {}, onStack = {};
    const safe = new Set(edges);
    function dfs(id) {
      onStack[id] = visited[id] = true;
      for (const e of edges) {
        if (e.from !== id) continue;
        if (onStack[e.to]) { safe.delete(e); continue; }
        if (!visited[e.to]) dfs(e.to);
      }
      onStack[id] = false;
    }
    agents.forEach(a => { if (!visited[a.id]) dfs(a.id); });
    return [...safe];
  }

  // ── DAG execution engine (Promise.allSettled parallel lanes) ──────
  async function runDAG(bp, task, signal) {
    const agents = bp.agents || [];
    let   edges  = bp.dag?.edges || [];
    if (!agents.length) throw new Error("No agents in blueprint.");
    traceAdd("Orchestrator", `Loaded blueprint "${bp.name || "Untitled"}" with ${agents.length} agent(s)`, "boss");
    if (hasCycle(agents, edges)) {
      edges = breakCycles(agents, edges);
      bp.dag.edges = edges;
      saveBlueprints();
      traceAdd("Orchestrator", `Blueprint had a dependency cycle — auto-removed back-edge(s) and saved fix.`, "warn");
    }

    traceAdd("Orchestrator", `Topology: ${bp.topology || "pipeline"} · ${agents.length} agents · ${edges.length} edges`, "boss");
    const depMap = Object.fromEntries(agents.map(a => [a.id, []]));
    for (const e of edges) { if (depMap[e.to]) depMap[e.to].push(e.from); }
    agents.forEach(a => {
      const deps = depMap[a.id].map(id => agents.find(x => x.id === id)?.name || id);
      traceAdd("Orchestrator", `${a.name} dependencies: ${deps.length ? deps.join(", ") : "none"}`, "wait");
    });

    const results   = {};
    const completed = new Set();
    const failed    = new Set();
    let   stepCount = 0;
    const maxSteps  = bp.maxSteps || 80;
    const strictDependencies = bp.taskCategory === "code_build" || isCodeBuildTask(task);
    const execOptions = {
      dependencyCharLimit: bp.budgetControls?.maxContextCharsPerDependency || 2000,
      maxToolRounds: bp.budgetControls?.maxToolRounds || 8,
      finalOutputAgentId: bp.finalOutputAgentId || "",
    };

    while (completed.size + failed.size < agents.length && stepCount++ < maxSteps) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      traceAdd("Orchestrator", `Scheduler step ${stepCount}/${maxSteps} · complete ${completed.size}/${agents.length} · failed ${failed.size}`, "boss");

      if (strictDependencies) {
        const blockedByFailure = agents.filter(a =>
          !completed.has(a.id) &&
          !failed.has(a.id) &&
          depMap[a.id].some(d => failed.has(d))
        );
        blockedByFailure.forEach(a => {
          const failedDeps = depMap[a.id]
            .filter(d => failed.has(d))
            .map(id => agents.find(x => x.id === id)?.name || id);
          failed.add(a.id);
          results[a.id] = `Skipped: dependency failed (${failedDeps.join(", ")})`;
          updateNodeStatus(a.id, "error");
          traceAdd("Orchestrator", `${a.name} skipped because dependency failed: ${failedDeps.join(", ")}`, "err");
        });
        if (blockedByFailure.length) updateProgress(completed.size / agents.length);
      }

      const ready = agents.filter(a =>
        !completed.has(a.id) &&
        !failed.has(a.id) &&
        depMap[a.id].every(d => completed.has(d))
      );
      const blocked = agents.filter(a =>
        !completed.has(a.id) &&
        !failed.has(a.id) &&
        !ready.includes(a)
      );
      blocked.forEach(a => {
        const waiting = depMap[a.id]
          .filter(d => !completed.has(d) && !failed.has(d))
          .map(id => agents.find(x => x.id === id)?.name || id);
        traceAdd("Orchestrator", `${a.name} waiting on ${waiting.length ? waiting.join(", ") : "scheduler"}`, "wait");
      });
      if (!ready.length) {
        traceAdd("Orchestrator", "No runnable agents remain at this step", "warn");
        break;
      }

      traceAdd("Orchestrator", `Dispatching ${ready.length} agent(s) in parallel: ${ready.map(a => a.name).join(", ")}`, "boss");

      const settled = await Promise.allSettled(ready.map(agent => {
        const depResults = {};
        for (const depId of depMap[agent.id]) {
          const dep = agents.find(a => a.id === depId);
          if (dep && results[depId]) depResults[dep.name] = results[depId];
        }
        traceAdd("Orchestrator", `${agent.name} received ${Object.keys(depResults).length} dependency result(s)`, "wait");
        updateNodeStatus(agent.id, "running");
        const t0 = Date.now();
        traceAdd(agent.name, "Starting…", "run");

        return executeOneAgent(agent, task, depResults, signal, execOptions)
          .then(out => {
            results[agent.id] = out;
            completed.add(agent.id);
            updateNodeStatus(agent.id, "done");
            traceAdd(agent.name, `Done in ${((Date.now()-t0)/1000).toFixed(1)}s`, "ok", out.split(/\s+/).length + " words");
            updateProgress(completed.size / agents.length);
            return { id: agent.id, out };
          })
          .catch(err => {
            if (err.name === "AbortError" || signal?.aborted) throw err;
            failed.add(agent.id);
            results[agent.id] = `Error: ${err.message}`;
            updateNodeStatus(agent.id, "error");
            traceAdd(agent.name, `Failed: ${err.message}`, "err");
            updateProgress(completed.size / agents.length);
          });
      }));

      // If abort was thrown inside allSettled, propagate
      for (const s of settled) {
        if (s.status === "rejected" && (s.reason?.name === "AbortError" || signal?.aborted)) {
          throw new DOMException("Aborted", "AbortError");
        }
      }
      traceAdd("Orchestrator", `Scheduler step ${stepCount} settled · complete ${completed.size}/${agents.length} · failed ${failed.size}`, "boss");
    }
    traceAdd("Orchestrator", `DAG execution finished · results ${Object.keys(results).length}/${agents.length}`, "boss");
    return results;
  }

  // ── Result aggregation ─────────────────────────────────────────────
  async function aggregateResults(bp, results, task, signal) {
    const strategy  = bp.aggregation || "synthesis";
    const topology  = bp.topology    || "pipeline";
    const agents    = bp.agents || [];
    const outputs   = agents.filter(a => results[a.id]).map(a => ({ id: a.id, name: a.name, out: results[a.id] }));
    traceAdd("Aggregator", `Collected ${outputs.length}/${agents.length} agent output(s)`, "boss");
    if (!outputs.length) {
      traceAdd("Aggregator", "No outputs available · returning empty result", "warn");
      return "(no results)";
    }

    // concat — preserve all agent outputs verbatim, no synthesis LLM (best for code/files)
    if (strategy === "concat") {
      if (bp.finalOutputAgentId) {
        const finalOutput = outputs.find(o => o.id === bp.finalOutputAgentId);
        if (finalOutput) {
          traceAdd("Aggregator", `Aggregation strategy concat · returning final owner ${finalOutput.name}`, "boss");
          return finalOutput.out;
        }
        traceAdd("Aggregator", `Final owner ${bp.finalOutputAgentId} missing · preserving raw outputs`, "warn");
      }
      traceAdd("Aggregator", "Aggregation strategy concat · preserving raw outputs", "boss");
      return outputs.map(o => `### ${o.name}\n\n${o.out}`).join("\n\n---\n\n");
    }

    const combined     = outputs.map(o => `[${o.name}]:\n${o.out}`).join("\n\n---\n\n");
    const supervisorModel = bp.supervisorModel || document.getElementById("model")?.value || "llama3.2";
    traceAdd("Aggregator", `Topology: ${topology} · Aggregation: ${strategy} · combining ${outputs.length} outputs…`, "boss");
    traceAdd("Aggregator", `Supervisor model ${modelTraceLabel(supervisorModel)}`, "run");

    if (strategy === "best_of_n") {
      const valid = outputs.filter(o => !o.out.startsWith("Error:"));
      traceAdd("Aggregator", `Best-of-n has ${valid.length} non-error output(s)`, "boss");
      if (!valid.length) {
        traceAdd("Aggregator", "No valid outputs · returning combined errors", "warn");
        return combined;
      }
      // Pick the longest non-error output as a quality proxy
      const best = valid.reduce((best, o) => o.out.length > best.out.length ? o : best, valid[0]);
      traceAdd("Aggregator", `Selected ${best.name} by longest-output heuristic`, "ok");
      return best.out;
    }

    if (strategy === "voting") {
      // Ask the supervisor to act as a judge and pick the best answer
      try {
        traceAdd("Aggregator", "Sending voting judge prompt", "run");
        const r = await callAgentLLM(supervisorModel, [
          { role: "system", content: "You are an impartial judge. Multiple agents answered the same task. Read all answers and output ONLY the single best and most accurate one verbatim — do not summarize or modify it." },
          { role: "user",   content: `Task: ${task}\n\nAgent answers:\n${combined}\n\nWhich answer is best? Output it verbatim.` }
        ], signal, 0.2);
        traceAdd("Aggregator", `Voting judge returned ${(r.content || "").length} chars`, "ok");
        return r.content || combined;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        traceAdd("Aggregator", "Voting judge failed — returning all outputs", "err");
        return combined;
      }
    }

    if (strategy === "hierarchical") {
      // Supervisor structures and integrates outputs with explicit role assignments
      try {
        traceAdd("Aggregator", "Sending hierarchical synthesis prompt", "run");
        const r = await callAgentLLM(supervisorModel, [
          { role: "system", content: "You are a senior project manager and synthesis expert. Your team of specialist agents have completed their assigned subtasks. Integrate all their outputs into a single, well-structured, executive-level deliverable. Preserve important details, remove redundancy, and ensure the final result is actionable and complete." },
          { role: "user",   content: `Project task: ${task}\n\nTeam outputs:\n${combined}\n\nProduce the final integrated deliverable.` }
        ], signal, 0.5);
        traceAdd("Aggregator", `Hierarchical synthesis returned ${(r.content || "").length} chars`, "ok");
        return r.content || combined;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        traceAdd("Aggregator", "Hierarchical synthesis failed — returning raw outputs", "err");
        return combined;
      }
    }

    // synthesis (default) — LLM merges all outputs coherently
    const hasFailovers = outputs.some(o => o.out.includes("[Failover:") || o.out.includes("[Note: this agent switched"));
    traceAdd("Aggregator", hasFailovers ? "Failover notes detected · weighting outputs accordingly" : "No failover notes detected", "wait");
    try {
      traceAdd("Aggregator", "Sending synthesis prompt", "run");
      const r = await callAgentLLM(supervisorModel, [
        { role: "system", content: `You are a synthesis expert. Combine the agent outputs below into one coherent, well-structured final answer. Be comprehensive. Do not repeat yourself.${hasFailovers ? "\n\nNote: some agents switched providers mid-task — outputs marked [Note: ...] or [Failover: ...] may be less complete. Weight them accordingly and compensate for any gaps." : ""}` },
        { role: "user",   content: `Original task: ${task}\n\nAgent outputs:\n${combined}\n\nSynthesize into a final answer.` }
      ], signal, 0.5);
      traceAdd("Aggregator", `Synthesis returned ${(r.content || "").length} chars`, "ok");
      return r.content || combined;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      traceAdd("Aggregator", "Synthesis LLM failed — returning raw outputs", "err");
      return combined;
    }
  }

  // ── Main run entry point ───────────────────────────────────────────
  async function runSwarm() {
    const bp   = getActive();
    const task = document.getElementById("amkTaskInput")?.value?.trim();
    if (!bp)   { await amkAlert("Select or create a blueprint first."); return; }
    if (!task) { await amkAlert("Enter a task in the top bar before running."); return; }
    if (!bp.agents.length) { await amkAlert("Add at least one agent to the blueprint."); return; }

    swarmAbortCtrl = new AbortController();
    const signal   = swarmAbortCtrl.signal;
    traceRunCount++;

    setRunStatus("running", "Swarm running…");
    updateTraceDot("running");
    openTraceConsole();
    traceAdd("Orchestrator", `Starting swarm — "${task}"`, "boss");
    traceAdd("Orchestrator", `Run ${traceRunCount} · blueprint ${bp.name || "Untitled"} · aggregation ${bp.aggregation || "synthesis"}`, "boss");

    document.getElementById("amkRunBtn").style.display  = "none";
    document.getElementById("amkStopBtn").style.display = "";
    const progressBar = document.getElementById("amkProgressBar");
    if (progressBar) progressBar.style.display = "";
    updateProgress(0);

    if (isCodeBuildTask(task)) {
      hardenGodBlueprint(bp, task, []);
      saveBlueprints();
      renderDAG();
      traceAdd("Orchestrator", "Applied website/code quality hardening before execution", "wait");
    }

    // Reset all node statuses
    nodeStatuses = {};
    (bp.agents || []).forEach(a => updateNodeStatus(a.id, "idle"));
    traceAdd("Orchestrator", "Node statuses reset to idle", "wait");

    try {
      traceAdd("Orchestrator", "Entering DAG execution", "boss");
      const rawResults = await runDAG(bp, task, signal);
      traceAdd("Orchestrator", "DAG returned raw results · entering aggregation", "boss");
      const finalOutput = await aggregateResults(bp, rawResults, task, signal);
      traceAdd("Orchestrator", `Aggregation returned final output · ${String(finalOutput || "").length} chars`, "ok");

      traceAdd("Orchestrator", `Swarm complete — ${bp.agents.length} agents, task done`, "ok");
      setRunStatus("done", `Done · ${bp.agents.length} agents`);
      updateTraceDot("done");
      updateProgress(1);

      lastSwarmOutput = `**Swarm Result — ${bp.name}**\n\n*Task: ${task}*\n\n---\n\n${normaliseAgentOutput(finalOutput)}`;
      // Persist output with blueprint so it survives page refresh
      bp.lastOutput = lastSwarmOutput;
      bp.lastRun    = Date.now();
      saveBlueprints();
      traceAdd("Orchestrator", "Saved output to active blueprint", "ok");

      // Push result back to main chat as assistant message
      if (window._H?.state) {
        traceAdd("Orchestrator", "Publishing swarm result to chat history", "wait");
        window._H.state.messages.push({
          role: "assistant",
          content: lastSwarmOutput,
          id: Date.now().toString(36),
          ts: Date.now()
        });
        if (typeof render === "function") render();
        if (typeof persistCurrentChat === "function") persistCurrentChat();
        traceAdd("Orchestrator", "Chat history persisted", "ok");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        traceAdd("Orchestrator", `Fatal error: ${err.message}`, "err");
        setRunStatus("error", "Error");
        updateTraceDot("error");
      } else {
        traceAdd("Orchestrator", "Run stopped by user", "wait");
        setRunStatus("idle", "Stopped");
        updateTraceDot("idle");
      }
      (bp.agents || []).forEach(a => { if (nodeStatuses[a.id] === "running") updateNodeStatus(a.id, "idle"); });
    } finally {
      swarmAbortCtrl = null;
      document.getElementById("amkRunBtn").style.display  = "";
      document.getElementById("amkStopBtn").style.display = "none";
      setTimeout(() => {
        if (progressBar) progressBar.style.display = "none";
        updateProgress(0);
        (bp.agents || []).forEach(a => updateNodeStatus(a.id, "idle"));
        renderDAG();
      }, 3500);
    }
  }

  let _godAbortCtrl = null;

  // ── God Agent: auto-design blueprint from description ──────────────
  function isCodeBuildTask(desc) {
    return /\b(code only|website|web\s*site|webpage|web app|landing page|frontend|front-end|backend|back-end|html|css|javascript|full working|output code)\b/i.test(desc || "");
  }

  function isBigAssignment(desc) {
    return isCodeBuildTask(desc) || /\b(big|large|complex|production|full working|full-stack|full stack|complete|entire|multi-agent|swarm|polish|revise|enterprise|app|platform|system)\b/i.test(desc || "");
  }

  function modelSizeScore(text) {
    const matches = [...String(text || "").matchAll(/(\d+(?:\.\d+)?)\s*([bkmt])\b/gi)];
    if (!matches.length) return 0;
    return Math.max(...matches.map(([, n, unit]) => {
      const value = Number(n) || 0;
      const u = unit.toLowerCase();
      if (u === "t") return value * 1000;
      if (u === "b") return value;
      if (u === "m") return value / 1000;
      return value / 1000000;
    }));
  }

  function modelStrengthScore(value, label, bigTask) {
    const text = `${value || ""} ${label || ""}`.toLowerCase();
    let score = 0;
    const add = (re, points) => { if (re.test(text)) score += points; };

    add(/\bgpt-5|gpt5|o3|o4|gpt-4\.1|gpt-4o|claude-4|opus|sonnet/i, 160);
    add(/gemini-2\.5-pro|gemini.*pro/i, 150);
    add(/deepseek[-\s]?r1|deepseek[-\s]?v3/i, 135);
    add(/llama-4|maverick|scout/i, 128);
    add(/nemotron|hermes-3|qwen3|qwen-3|qwq/i, 118);
    add(/gpt-oss-120b|405b|235b|120b|70b/i, 105);
    add(/llama-3\.3|llama-3\.1/i, 65);

    score += Math.min(modelSizeScore(text), 500);
    if (bigTask) {
      add(/pro|opus|sonnet|r1|v3|405b|235b|120b|70b|maverick|nemotron|hermes/i, 60);
      add(/flash|lite|mini|small|fast|instant|8b|20b/i, -90);
    } else {
      add(/flash|fast|instant|lite/i, 25);
    }
    add(/embedding|rerank|moderation|vision|image|tts|whisper|guard/i, -1000);
    return score;
  }

  function bestModelForProvider(options, bigTask) {
    return [...options].sort((a, b) =>
      modelStrengthScore(b.value, b.label, bigTask) - modelStrengthScore(a.value, a.label, bigTask)
    )[0];
  }

  function recommendedAgentBounds(desc) {
    if (isCodeBuildTask(desc)) return { min: 5, target: 6, max: 7 };
    if (isBigAssignment(desc)) return { min: 4, target: 5, max: 7 };
    return { min: 3, target: 4, max: 5 };
  }

  function classifyTask(desc) {
    const d = String(desc || "").toLowerCase();
    if (isCodeBuildTask(d)) return "code_build";
    if (/debug|fix|bug|error|stack trace|broken/i.test(d)) return "debugging";
    if (/security|audit|malware|vulnerab|threat|sandbox/i.test(d)) return "security";
    if (/data|csv|spreadsheet|chart|analytics|analysis|dataset/i.test(d)) return "data_analysis";
    if (/research|find|compare|summar|report|paper|news/i.test(d)) return "research";
    if (/strategy|plan|business|market|launch|roadmap|decision/i.test(d)) return "strategy";
    if (/write|copy|brand|creative|story|content/i.test(d)) return "creative";
    return isBigAssignment(d) ? "complex_planning" : "general";
  }

  function taskRequiresBackend(desc) {
    return /\b(auth|login|signup|account|admin|dashboard|database|db|order\s+(submission|management|tracking|storage)|inventory|checkout|payment|stripe|api|cms|booking|server|backend|back-end)\b/i.test(desc || "");
  }

  function artifactContractsForTask(desc) {
    const category = classifyTask(desc);
    if (category === "code_build") {
      const artifacts = [
        { name: "implementation_brief.json", ownerRole: "planner", required: true, format: "compact JSON brief" },
        { name: "index.html", ownerRole: "coder", required: true, format: "complete fenced html file" },
        { name: "styles.css", ownerRole: "coder", required: true, format: "complete fenced css file" },
        { name: "app.js", ownerRole: "coder", required: true, format: "complete fenced javascript file" },
        { name: "visible_image_manifest.json", ownerRole: "coder", required: true, format: "remote https image URLs plus alt text and fallback behavior" },
        { name: "interaction_manifest.json", ownerRole: "coder", required: true, format: "cart, buttons, animations, and localStorage behavior" },
        { name: "validation_fixes.md", ownerRole: "validator", required: true, format: "patch list or corrected full code blocks" },
        { name: "final_code_bundle", ownerRole: "supervisor", required: true, format: "final complete code blocks only" },
      ];
      if (taskRequiresBackend(desc)) artifacts.splice(4, 0, { name: "server.js", ownerRole: "coder", required: true, format: "complete fenced backend file" });
      else artifacts.splice(4, 0, { name: "NO_BACKEND_NEEDED", ownerRole: "coder", required: true, format: "literal backend decision" });
      return artifacts;
    }
    if (category === "data_analysis") return [
      { name: "analysis_plan.json", ownerRole: "planner", required: true, format: "questions, metrics, assumptions" },
      { name: "findings.md", ownerRole: "analyst", required: true, format: "evidence-backed findings" },
      { name: "final_analysis.md", ownerRole: "supervisor", required: true, format: "single reconciled answer" },
    ];
    return [
      { name: "work_plan.json", ownerRole: "planner", required: true, format: "deliverables, assumptions, risks, acceptance criteria" },
      { name: "specialist_outputs", ownerRole: "specialist", required: true, format: "compact specialist findings" },
      { name: "final_answer", ownerRole: "supervisor", required: true, format: "single reconciled user-visible answer" },
    ];
  }

  function qualityGatesForTask(desc) {
    const gates = ["final output directly satisfies the user request", "no duplicated intermediate reports", "assumptions and risks are explicit when relevant"];
    if (isCodeBuildTask(desc)) gates.push(
      "code-only final output when requested",
      "all referenced files are present",
      "product/gallery images use visible https URLs or inline SVG/data URI fallbacks; no broken placeholder/local image paths",
      "cart interactions are wired end-to-end with add/remove/quantity/total/count and localStorage persistence when a cart is requested",
      "animations are implemented with CSS transitions/keyframes or requestAnimationFrame and respect reduced-motion",
      "final code is integrated; HTML references the exact CSS/JS filenames that are output",
      "no DOCX/PDF/report generation for website code",
      "responsive/mobile layout considered",
      "no placeholder content unless intentionally marked"
    );
    if (taskRequiresBackend(desc)) gates.push("backend need is justified and API/data flow is coherent");
    return gates;
  }

  function budgetControlsForTask(desc) {
    return {
      maxContextCharsPerDependency: isCodeBuildTask(desc) ? 6000 : 4000,
      maxIntermediateWords: isBigAssignment(desc) ? 900 : 650,
      maxToolRounds: 8,
      finalOutputOwnerOnly: true,
      allowToolUseByDefault: !isCodeBuildTask(desc),
    };
  }

  function parseBlueprintJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw.trim()); } catch {}
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) try { return JSON.parse(m[1].trim()); } catch {}
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1) try { return JSON.parse(raw.slice(s, e + 1)); } catch {}
    return null;
  }

  function deterministicBlueprint(desc, providerModels = []) {
    const codeTask = isCodeBuildTask(desc);
    const modelAt = (idx) => providerModels[idx % Math.max(providerModels.length, 1)]?.[1] || "";
    const base = {
      name: enforceTwoWordName(codeTask ? "Code Build" : "Smart Plan"),
      description: `Auto-generated fallback blueprint for: ${String(desc || "").slice(0, 120)}`,
      topology: "hierarchical",
      aggregation: "concat",
      supervisorModel: modelAt(0),
      agents: codeTask ? [
        { id: "a1", name: "Planner / Specifier", icon: "✦", role: "analyst", systemPrompt: "Create a compact implementation brief with deliverables, sections, files, assumptions, acceptance criteria, image URL strategy, animation strategy, and cart/interaction requirements.", tools: [], memory: "project", timeout: 120, retries: 1, temperature: 0.4, model: modelAt(3) },
        { id: "a2", name: "Frontend Developer", icon: "✦", role: "coder", systemPrompt: "Produce complete frontend files only with filename-tagged code fences. Use visible remote HTTPS images with inline fallback SVG/data URI behavior, polished responsive CSS, and working event hooks.", tools: [], memory: "project", timeout: 180, retries: 1, temperature: 0.35, model: modelAt(1) },
        { id: "a3", name: "Interaction Engineer", icon: "✦", role: "coder", systemPrompt: "Implement complete cart and UI interaction logic. If no backend is needed, output NO_BACKEND_NEEDED plus complete frontend JavaScript fixes for add/remove/quantity/count/total/empty-state/localStorage.", tools: [], memory: "project", timeout: 150, retries: 1, temperature: 0.25, model: modelAt(4) },
        { id: "a4", name: "Validator / Critic", icon: "✦", role: "validator", systemPrompt: "Validate files against the quality gates. Reject broken image paths, missing fallbacks, unwired buttons, non-persistent cart state, and unused animations. Output concrete fixes or corrected full code blocks only.", tools: [], memory: "project", timeout: 150, retries: 1, temperature: 0.25, model: modelAt(2) },
        { id: "a5", name: "Final Polisher / Supervisor", icon: "✦", role: "supervisor", systemPrompt: "Merge and polish all artifacts into final complete code blocks only. Ensure visible images, working cart, applied animations, responsive layout, and exact file references. Remove duplicated prose, specs, reports, and incomplete snippets.", tools: [], memory: "project", timeout: 180, retries: 1, temperature: 0.3, model: modelAt(0) },
      ] : [
        { id: "a1", name: "Lead Planner", icon: "✦", role: "analyst", systemPrompt: "Create the plan, assumptions, dependencies, risks, and acceptance criteria.", tools: ["memory"], memory: "project", timeout: 120, retries: 1, temperature: 0.45, model: modelAt(2) },
        { id: "a2", name: "Specialist Analyst", icon: "✦", role: "analyst", systemPrompt: "Handle the main specialist workstream and produce compact findings.", tools: ["memory"], memory: "project", timeout: 120, retries: 1, temperature: 0.55, model: modelAt(1) },
        { id: "a3", name: "Validator", icon: "✦", role: "validator", systemPrompt: "Validate the specialist output and list concrete corrections.", tools: [], memory: "project", timeout: 120, retries: 1, temperature: 0.25, model: modelAt(3) },
        { id: "a4", name: "Final Synthesizer", icon: "✦", role: "supervisor", systemPrompt: "Produce the final user-visible answer by reconciling all outputs.", tools: [], memory: "project", timeout: 150, retries: 1, temperature: 0.3, model: modelAt(0) },
      ],
      dag: codeTask ? {
        nodes: ["a1", "a2", "a3", "a4", "a5"],
        edges: [
          { from: "a1", to: "a2", reason: "Frontend uses planner brief" },
          { from: "a1", to: "a3", reason: "Interaction engineer uses planner brief" },
          { from: "a2", to: "a4", reason: "Validator reviews frontend artifacts" },
          { from: "a3", to: "a4", reason: "Validator reviews interaction/cart logic" },
          { from: "a2", to: "a5", reason: "Final supervisor receives frontend artifacts for final assembly" },
          { from: "a3", to: "a5", reason: "Final supervisor receives interaction/cart logic for final assembly" },
          { from: "a4", to: "a5", reason: "Final supervisor incorporates validation fixes" },
        ],
      } : {
        nodes: ["a1", "a2", "a3", "a4"],
        edges: [
          { from: "a1", to: "a2", reason: "Specialist uses planning brief" },
          { from: "a2", to: "a3", reason: "Validator reviews specialist output" },
          { from: "a2", to: "a4", reason: "Final supervisor receives specialist output" },
          { from: "a3", to: "a4", reason: "Final supervisor incorporates validation" },
        ],
      },
    };
    base.finalOutputAgentId = codeTask ? "a5" : "a4";
    attachPlanningMetadata(base, desc);
    return base;
  }

  function roleToolsForCodeAgent(agent) {
    return [];
  }

  function codeContractForAgent(agent) {
    const name = `${agent.name || ""} ${agent.role || ""}`.toLowerCase();
    const common = "\n\nSTRICT CODE-BUILD CONTRACT:\n- Do not create DOCX, PDF, reports, slide decks, or downloadable documents.\n- Do not call unrelated external URLs or fetch templates unless the user explicitly asks.\n- Keep prose minimal and only use it when your assigned output contract requires it.\n- Pass compact, structured output to downstream agents; avoid long essays.\n- For website tasks, visible images, working interactions, responsive layout, and polished motion are required implementation details, not optional decoration.";
    if (/research|planner|spec|designer|analyst/.test(name) && !/coder|front|back/.test(name)) {
      return common + "\n- Output a compact implementation brief only: brand direction, page sections, data/content needs, file list, image strategy, interaction strategy, and acceptance criteria.\n- For websites with product/gallery imagery, specify remote HTTPS image URLs and inline fallback behavior; do not leave image sourcing to downstream guessing.\n- Keep the brief under 900 words.";
    }
    if (/front|html|css|style|js|coder|developer/.test(name) && !/back/.test(name)) {
      return common + "\n- Output complete frontend code only, using fenced blocks with filenames: ```html index.html```, ```css styles.css```, ```javascript app.js```.\n- Use visible remote HTTPS images with alt text, stable aspect ratios, object-fit styling, and onerror inline SVG/data URI fallback.\n- If a cart is requested, implement add/remove/quantity/count/total/empty-state/localStorage behavior and wire all buttons.\n- Implement polished animations with CSS transitions/keyframes and reduced-motion support.\n- Do not output partial snippets. Do not write commentary outside code fences.";
    }
    if (/back|server|api/.test(name)) {
      return common + "\n- If the website does not need a backend, output exactly: NO_BACKEND_NEEDED.\n- If a backend is needed, output complete code only with filenames such as ```javascript server.js``` and no document-generation code.";
    }
    if (/critic|validator|qa|review/.test(name)) {
      return common + "\n- Validate the produced files. Output only concrete fixes or corrected full code blocks with filenames.\n- Explicitly reject broken/missing images, fake local image paths, unwired buttons, non-persistent cart state, missing totals, and animation CSS that is never applied.\n- Do not write a general review report.";
    }
    if (/boss|supervisor|polish|aggregator/.test(name)) {
      return common + "\n- Merge and polish concrete files into final code blocks only. Remove duplicate prose, specs, and reports.\n- Before final output, ensure image URLs are visible/fallback-safe, cart behavior is complete, animations are applied, and all files reference each other correctly.";
    }
    return common;
  }

  function ensureFinalPolisher(parsed, providerModels, usedProviders) {
    const hasFinalOwner = parsed.agents.some(a => /boss|supervisor|polish|aggregator/i.test(`${a.name || ""} ${a.role || ""}`));
    if (hasFinalOwner) return null;
    const idx = parsed.agents.length + 1;
    const model = (providerModels || []).map(([, v]) => v).find(v => {
      const p = v?.startsWith("cloud:") ? v.split(":")[1] : "local";
      return !usedProviders.has(p);
    }) || "";
    if (model) usedProviders.add(model.startsWith("cloud:") ? model.split(":")[1] : "local");
    const finalPolisher = {
      id: `a${idx}`,
      name: "Final Polisher",
      icon: "✦",
      role: "supervisor",
      systemPrompt: "You are the final polisher. Revise the team output into final, production-ready code only. Keep only complete files and remove duplicated reports/specs.",
      tools: [],
      memory: "project",
      timeout: 150,
      retries: 1,
      temperature: 0.3,
      model,
    };
    parsed.agents.push(finalPolisher);
    parsed.dag.nodes.push(finalPolisher.id);
    return finalPolisher;
  }

  function ensureSupervisorAgent(parsed, providerModels, usedProviders, codeTask) {
    const existing = parsed.agents.find(a => /boss|supervisor|polish|aggregator|synthes/i.test(`${a.name || ""} ${a.role || ""}`));
    if (existing) return existing;
    if (codeTask) return ensureFinalPolisher(parsed, providerModels, usedProviders);
    const idx = parsed.agents.length + 1;
    const model = (providerModels || []).map(([, v]) => v).find(v => {
      const p = v?.startsWith("cloud:") ? v.split(":")[1] : "local";
      return !usedProviders.has(p);
    }) || "";
    if (model) usedProviders.add(model.startsWith("cloud:") ? model.split(":")[1] : "local");
    const supervisor = {
      id: `a${idx}`,
      name: "Final Synthesizer",
      icon: "✦",
      role: "supervisor",
      systemPrompt: "You are the lead planning agent. Integrate specialist outputs into one final answer that directly satisfies the user's request, resolves conflicts, removes duplication, and states assumptions and residual risks.",
      tools: [],
      memory: "project",
      timeout: 150,
      retries: 1,
      temperature: 0.35,
      model,
    };
    parsed.agents.push(supervisor);
    parsed.dag.nodes.push(supervisor.id);
    return supervisor;
  }

  function prioritizeGodBlueprintModels(parsed, desc, providerModels) {
    if (!isBigAssignment(desc) || !Array.isArray(providerModels) || !providerModels.length) return;
    const bestByProvider = new Map(providerModels.map(([provider, value]) => [provider, value]));
    const roleProviderPreference = {
      supervisor: ["samba", "openrouter", "gemini", "groq", "cerebras", "local"],
      coder: ["openrouter", "samba", "cerebras", "groq", "gemini", "local"],
      validator: ["openrouter", "samba", "gemini", "cerebras", "groq", "local"],
      critic: ["openrouter", "samba", "gemini", "groq", "cerebras", "local"],
      analyst: ["samba", "openrouter", "gemini", "groq", "cerebras", "local"],
      researcher: ["groq", "openrouter", "gemini", "samba", "cerebras", "local"],
      writer: ["gemini", "openrouter", "samba", "groq", "cerebras", "local"],
      custom: ["openrouter", "samba", "gemini", "groq", "cerebras", "local"],
    };
    const riskRank = (agent) => {
      const name = `${agent.name || ""} ${agent.role || ""}`.toLowerCase();
      if (/boss|supervisor|polish|synthes/.test(name)) return 100;
      if (/coder|developer|front|back|validator|critic|qa|review/.test(name)) return 90;
      if (/planner|architect|spec|analyst/.test(name)) return 80;
      if (/research/.test(name)) return 55;
      return 40;
    };
    const used = new Set();
    [...parsed.agents].sort((a, b) => riskRank(b) - riskRank(a)).forEach(agent => {
      const current = agent.model || "";
      let provider = current.startsWith("cloud:") ? current.split(":")[1] : (current ? "local" : "");
      const role = roleProviderPreference[agent.role] ? agent.role : "custom";
      const preferred = roleProviderPreference[role];
      const replacement = preferred
        .map(p => providerModels.find(([providerName]) => providerName === p && !used.has(providerName)))
        .find(Boolean) || providerModels.find(([p]) => !used.has(p));
      if (!provider || used.has(provider) || replacement) {
        if (replacement) {
          provider = replacement[0];
          agent.model = replacement[1];
        } else if (provider && bestByProvider.has(provider)) {
          agent.model = bestByProvider.get(provider);
        }
      } else if (provider && bestByProvider.has(provider)) {
        agent.model = bestByProvider.get(provider);
      }
      if (provider) used.add(provider);
    });
  }

  function normalizeGodBlueprintEnums(parsed, desc) {
    const validTopologies = new Set(["pipeline", "parallel", "hierarchical", "debate", "reflexion", "router", "mesh", "sequential"]);
    const validAggregations = new Set(["synthesis", "voting", "best_of_n", "hierarchical", "concat"]);
    if (!validTopologies.has(parsed.topology)) {
      parsed.topology = isBigAssignment(desc) ? "hierarchical" : "pipeline";
    }
    if (!validAggregations.has(parsed.aggregation)) {
      parsed.aggregation = isCodeBuildTask(desc) ? "concat" : "synthesis";
    }
  }

  function attachPlanningMetadata(parsed, desc) {
    parsed.taskCategory = parsed.taskCategory || classifyTask(desc);
    parsed.requiresBackend = typeof parsed.requiresBackend === "boolean" ? parsed.requiresBackend : taskRequiresBackend(desc);
    parsed.artifactContracts = Array.isArray(parsed.artifactContracts) && parsed.artifactContracts.length
      ? parsed.artifactContracts
      : artifactContractsForTask(desc);
    parsed.qualityGates = Array.isArray(parsed.qualityGates) && parsed.qualityGates.length
      ? parsed.qualityGates
      : qualityGatesForTask(desc);
    parsed.budgetControls = { ...budgetControlsForTask(desc), ...(parsed.budgetControls || {}) };
  }

  function ensureEdgeReasons(parsed) {
    const byId = Object.fromEntries((parsed.agents || []).map(a => [a.id, a]));
    parsed.dag.edges = (parsed.dag.edges || []).map(e => {
      if (e.reason) return e;
      const from = byId[e.from]?.name || e.from;
      const to = byId[e.to]?.name || e.to;
      return { ...e, reason: `${to} depends on ${from} output` };
    });
  }

  function missingRoleTemplates(parsed, desc, usedProviders, providerModels) {
    const text = (agent) => `${agent.name || ""} ${agent.role || ""}`.toLowerCase();
    const has = (re) => (parsed.agents || []).some(a => re.test(text(a)));
    const pickModel = () => {
      const model = (providerModels || []).map(([, v]) => v).find(v => {
        const p = v?.startsWith("cloud:") ? v.split(":")[1] : "local";
        return !usedProviders.has(p);
      }) || "";
      if (model) usedProviders.add(model.startsWith("cloud:") ? model.split(":")[1] : "local");
      return model;
    };
    const out = [];
    if (!has(/planner|spec|architect|research|analyst/)) out.push({
      name: "Planner", role: "analyst", temperature: 0.4, tools: isCodeBuildTask(desc) ? [] : ["memory"],
      systemPrompt: "Create the compact plan, assumptions, deliverables, dependencies, and acceptance criteria for the task."
    });
    if (isCodeBuildTask(desc) && !has(/front|html|css|javascript|developer|coder/)) out.push({
      name: "Frontend Developer", role: "coder", temperature: 0.35, tools: [],
      systemPrompt: "Produce complete frontend files only, with filename-tagged code fences."
    });
    if (!has(/critic|validator|qa|review/)) out.push({
      name: "Validator", role: "validator", temperature: 0.25, tools: [],
      systemPrompt: "Validate the artifacts against the quality gates and output concrete fixes only."
    });
    if (!has(/boss|supervisor|polish|synthes/)) out.push({
      name: isCodeBuildTask(desc) ? "Final Polisher" : "Final Synthesizer", role: "supervisor", temperature: 0.3, tools: [],
      systemPrompt: "Produce the final user-visible output after reconciling all upstream artifacts."
    });
    return out.map((tpl, idx) => ({
      id: `a${(parsed.agents || []).length + idx + 1}`,
      icon: "✦",
      memory: "project",
      timeout: /coder|supervisor|validator/.test(tpl.role) ? 150 : 120,
      retries: 1,
      model: pickModel(),
      ...tpl,
    }));
  }

  function hardenGodBlueprint(parsed, desc, providerModels) {
    if (!parsed || !Array.isArray(parsed.agents)) return parsed;
    const codeTask = isCodeBuildTask(desc);
    const bigTask = isBigAssignment(desc);
    if (!parsed.dag) parsed.dag = { nodes: parsed.agents.map(a => a.id), edges: [] };
    parsed.dag.nodes = parsed.agents.map(a => a.id);
    parsed.dag.edges = Array.isArray(parsed.dag.edges) ? parsed.dag.edges : [];
    normalizeGodBlueprintEnums(parsed, desc);
    attachPlanningMetadata(parsed, desc);
    prioritizeGodBlueprintModels(parsed, desc, providerModels);
    if (!codeTask && !bigTask) return parsed;

    const usedProviders = new Set(parsed.agents.map(a => {
      if (!a.model) return "";
      return a.model.startsWith("cloud:") ? a.model.split(":")[1] : "local";
    }).filter(Boolean));
    const finalOwner = ensureSupervisorAgent(parsed, providerModels, usedProviders, codeTask);

    parsed.topology = "hierarchical";
    parsed.aggregation = "concat";

    parsed.agents.forEach(agent => {
      const nameRole = `${agent.name} ${agent.role}`;
      const planningContract = `\n\nORCHESTRATION CONTRACT:\n- Task category: ${parsed.taskCategory}.\n- Required artifacts: ${(parsed.artifactContracts || []).map(a => a.name).join(", ")}.\n- Quality gates: ${(parsed.qualityGates || []).join("; ")}.\n- Keep dependency context under ${parsed.budgetControls?.maxContextCharsPerDependency || 4000} chars and intermediate output under ${parsed.budgetControls?.maxIntermediateWords || 900} words unless producing final code files.`;
      if (codeTask) agent.tools = roleToolsForCodeAgent(agent);
      else if (/boss|supervisor|critic|validator|qa|review/i.test(nameRole)) agent.tools = [];
      agent.timeout = Math.max(agent.timeout || 120, /coder|developer|front|back|boss|supervisor|critic|validator/i.test(nameRole) ? 150 : 90);
      agent.temperature = /critic|validator|boss|supervisor|coder|developer/i.test(nameRole) ? Math.min(agent.temperature ?? 0.5, 0.4) : (agent.temperature ?? 0.6);
      if (codeTask && !/STRICT CODE-BUILD CONTRACT/.test(agent.systemPrompt || "")) {
        agent.systemPrompt = `${agent.systemPrompt || `You are ${agent.name}.`}${codeContractForAgent(agent)}`;
      } else if (!codeTask && /boss|supervisor|polish|aggregator|synthes/i.test(nameRole) && !/LEAD SYNTHESIS CONTRACT/.test(agent.systemPrompt || "")) {
        agent.systemPrompt = `${agent.systemPrompt || `You are ${agent.name}.`}\n\nLEAD SYNTHESIS CONTRACT:\n- Produce the final answer only after reconciling specialist outputs.\n- State key assumptions, tradeoffs, risks, and acceptance criteria when useful.\n- Remove duplicated intermediate reasoning and deliver one coherent result.`;
      }
      if (!/ORCHESTRATION CONTRACT/.test(agent.systemPrompt || "")) {
        agent.systemPrompt = `${agent.systemPrompt || `You are ${agent.name}.`}${planningContract}`;
      }
    });

    const idOf = (a) => a.id;
    const isPlanner = (a) => /research|planner|spec|designer|analyst/i.test(`${a.name} ${a.role}`) && !/coder|developer|validator|critic|boss|supervisor/i.test(`${a.name} ${a.role}`);
    const isProducer = (a) => /coder|developer|front|back|style|content|copy/i.test(`${a.name} ${a.role}`) && !/validator|critic|boss|supervisor/i.test(`${a.name} ${a.role}`);
    const isValidator = (a) => /critic|validator|qa|review/i.test(`${a.name} ${a.role}`);
    const isFinalOwner = (a) => /boss|supervisor|polish|aggregator/i.test(`${a.name} ${a.role}`);

    const planners = parsed.agents.filter(isPlanner);
    const producers = parsed.agents.filter(isProducer);
    const validators = parsed.agents.filter(isValidator);
    const finalOwners = parsed.agents.filter(isFinalOwner);
    const firstLayer = planners.length ? planners : parsed.agents.slice(0, 1);
    const workLayer = producers.length ? producers : parsed.agents.filter(a => !firstLayer.includes(a) && !validators.includes(a) && !finalOwners.includes(a));
    const reviewLayer = validators.length ? validators : [];
    const finalLayer = finalOwners.length ? finalOwners : (finalOwner ? [finalOwner] : []);
    if (finalLayer[0]) parsed.finalOutputAgentId = finalLayer[0].id;

    const edges = [];
    firstLayer.forEach(src => workLayer.forEach(dst => edges.push({ from: idOf(src), to: idOf(dst), reason: `${dst.name} uses ${src.name} planning output` })));
    if (reviewLayer.length) {
      workLayer.forEach(src => reviewLayer.forEach(dst => edges.push({ from: idOf(src), to: idOf(dst), reason: `${dst.name} validates ${src.name} output` })));
      workLayer.forEach(src => finalLayer.forEach(dst => edges.push({ from: idOf(src), to: idOf(dst), reason: `${dst.name} receives ${src.name} artifacts for final assembly` })));
      reviewLayer.forEach(src => finalLayer.forEach(dst => edges.push({ from: idOf(src), to: idOf(dst), reason: `${dst.name} incorporates ${src.name} validation` })));
    } else {
      workLayer.forEach(src => finalLayer.forEach(dst => edges.push({ from: idOf(src), to: idOf(dst), reason: `${dst.name} finalizes ${src.name} output` })));
    }
    parsed.dag.edges = edges.filter(e => e.from && e.to && e.from !== e.to);
    ensureEdgeReasons(parsed);
    return parsed;
  }

  async function runGodAgent() {
    const desc = document.getElementById("amkGodTextarea")?.value?.trim();
    if (!desc) return;

    const spinner    = document.getElementById("amkGodSpinner");
    const statusText = document.getElementById("amkGodStatusText");
    const genBtn     = document.getElementById("amkGodGenerateBtn");
    const cancelBtn  = document.getElementById("amkGodCancelBtn");
    if (spinner)    spinner.classList.add("visible");
    if (statusText) statusText.textContent = "Designing your swarm…";
    if (genBtn)     genBtn.disabled = true;
    if (cancelBtn)  cancelBtn.disabled = false;

    _godAbortCtrl = new AbortController();
    const signal = _godAbortCtrl.signal;

    const modelValue = document.getElementById("amkGodModelSelect")?.value
                    || document.getElementById("model")?.value || "llama3.2";

    // Build one strong representative model per provider for God Agent to assign.
    // For big assignments, choose frontier/famous/larger models instead of the first dropdown option.
    const bigTask = isBigAssignment(desc);
    const allOpts = Array.from(document.getElementById("model")?.options || [])
      .map(o => ({ value: o.value, label: o.textContent || o.label || o.value }))
      .filter(o => o.value && !o.disabled && !o.value.startsWith("─"));
    const providerOptions = {};   // provider → [{ value, label }]
    allOpts.forEach(o => {
      const provider = o.value.startsWith("cloud:") ? o.value.split(":")[1] : "local";
      if (!providerOptions[provider]) providerOptions[provider] = [];
      providerOptions[provider].push(o);
    });
    const providerModels = Object.entries(providerOptions)
      .map(([provider, options]) => {
        const best = bestModelForProvider(options, bigTask);
        return [provider, best?.value || options[0]?.value || "", best?.label || options[0]?.label || ""];
      })
      .filter(([, value]) => value)
      .sort((a, b) => modelStrengthScore(b[1], b[2], bigTask) - modelStrengthScore(a[1], a[2], bigTask));
    const numProviders = providerModels.length;
    const agentBounds = recommendedAgentBounds(desc);

    const modelListStr = providerModels.length
      ? `\nAvailable providers and their best representative model for this assignment:\n${providerModels.map(([p, v, label]) => `  Provider "${p}" → model value: "${v}" (${label})`).join("\n")}\n\nModel assignment guidance:\n- This request is ${bigTask ? "a BIG assignment: prioritize the strongest/frontier/famous/largest models listed above for planner, coder, validator, and final supervisor roles." : "a normal assignment: balance speed and quality."}\n- For large code/product builds, prefer Pro/R1/V3/Maverick/Nemotron/Hermes/Qwen3/405B/235B/120B/70B-class models over flash/lite/instant/small models.\n- groq → fast inference, good for researcher/analyst; use its largest available model for big tasks\n- gemini → long context, best when Pro is available; avoid Lite for big tasks\n- cerebras → ultra-fast; use its largest available model for coding/validation if available\n- samba → mega-scale, good for complex reasoning/supervisor/final synthesis roles\n- openrouter → diverse frontier/famous models, good for coder/critic/supervisor roles\n- local → fallback only unless it is clearly the strongest available local model\nUse different providers whenever possible. With ${numProviders} providers available, assign the strongest providers to the highest-risk roles first; provider count must not force extra agents.`
      : `\nLeave model as "" for all agents.`;

    const minAgents = agentBounds.min;

    const GOD_SYSTEM = `You are an Agent Architect AI. Design a multi-agent swarm blueprint for the user's request.

Think like a senior planning and orchestration agent before writing JSON:
- Define the concrete deliverables and the final owner who will produce the user-visible answer.
- Identify assumptions, dependencies, major risks, and acceptance criteria.
- Choose topology from real dependency structure, not habit. Parallelize independent work.
- Assign each agent a narrow responsibility, explicit output contract, and only the tools it truly needs.
- Budget context: upstream agents should pass compact artifacts, not long essays.
- Budget model strength: reserve the strongest models for planning, code generation, validation, and final synthesis.
- Include validation/revision whenever the task has meaningful quality risk.
- Avoid overstaffing. Add agents only when they reduce dependency risk or enable useful parallel work.

Return ONLY valid JSON in this exact format — no markdown, no explanation:
{
  "name": "Blueprint Name",
  "description": "One sentence description",
  "taskCategory": "code_build|research|strategy|data_analysis|creative|debugging|security|complex_planning|general",
  "requiresBackend": false,
  "topology": "CHOOSE_ONE_ALLOWED_TOPOLOGY",
  "aggregation": "CHOOSE_ONE_ALLOWED_AGGREGATION",
  "supervisorModel": "",
  "finalOutputAgentId": "aN",
  "artifactContracts": [
    {"name": "artifact.ext", "ownerRole": "coder", "required": true, "format": "complete file or compact artifact"}
  ],
  "qualityGates": ["gate the final supervisor must verify"],
  "budgetControls": {
    "maxContextCharsPerDependency": 4000,
    "maxIntermediateWords": 900,
    "finalOutputOwnerOnly": true,
    "allowToolUseByDefault": false
  },
  "agents": [
    {
      "id": "a1",
      "name": "Agent Name",
      "icon": "🔬",
      "role": "researcher",
      "systemPrompt": "You are a...",
      "tools": ["web_search","fetch_url","wikipedia"],
      "memory": "project",
      "timeout": 120,
      "retries": 1,
      "temperature": 0.7,
      "model": ""
    }
  ],
  "dag": {
    "nodes": ["a1","a2"],
    "edges": [{"from": "a1", "to": "a2", "reason": "a2 depends on a1 output"}]
  }
}

Rules:
- Use ${agentBounds.min}-${agentBounds.max} agents. Target ${agentBounds.target}; choose fewer only when the task is simple and choose more only when responsibilities are genuinely independent.
- Use different providers when enough providers are available; never add agents just to use more providers.
- Agents with no incoming edges run first in parallel
- Use sequential IDs: a1, a2, a3…
- Valid roles: researcher, writer, critic, coder, analyst, validator, supervisor, custom
- Replace CHOOSE_* placeholders with valid values from the allowed lists below.
- finalOutputAgentId MUST point to the final supervisor/validator agent whose output should be shown to the user.
- artifactContracts MUST list the concrete outputs expected from the swarm.
- qualityGates MUST list objective checks the final supervisor should apply.
- budgetControls MUST prevent context bloat and unnecessary tool use.
- Every DAG edge MUST include a reason.

TOPOLOGY — choose the one that best matches the task structure:
- "pipeline"      → sequential steps where each agent builds on the previous (research → draft → edit → publish)
- "parallel"      → independent agents all work simultaneously then results are merged (multi-source research, multi-angle analysis)
- "hierarchical"  → one supervisor breaks down the task and delegates to workers, then synthesizes (project management, complex planning)
- "debate"        → agents argue opposing sides then a moderator produces a final verdict (decision making, pros/cons, risk analysis)
- "reflexion"     → an agent produces output, a critic reviews it, then the first revises — iterative improvement (writing quality, code review loops)
- "router"        → first agent classifies/routes the request, then a specialist handles it (multi-domain Q&A, triage)
- "mesh"          → every agent can talk to every other agent — fully connected (creative brainstorming, open-ended exploration)

AGGREGATION — choose how final results are combined:
- "synthesis"     → an LLM merges all outputs into one coherent answer (best for pipeline, reflexion)
- "voting"        → agents vote and majority wins (best for parallel with same question, debate)
- "best_of_n"     → pick the single best output by quality score (best for parallel creative tasks)
- "hierarchical"  → supervisor agent explicitly orchestrates and combines (best for hierarchical topology)
- "concat"        → no extra LLM aggregation; use with finalOutputAgentId when the final owner already produced the deliverable

CODE / WEBSITE TASKS — mandatory rules when the user asks for a website, app, frontend/backend, HTML/CSS/JS, "full working", or "code only":
- Use "hierarchical" topology and "concat" aggregation.
- Include a Final Polisher / Supervisor as the final downstream agent.
- Do NOT make a simple linear pipeline where frontend waits on backend or backend waits on frontend.
- Use this DAG shape: Planner/Spec first → independent builders in parallel → Validator/Critic → Final Polisher.
- Coder agents must output complete files only in fenced code blocks with filenames.
- Backend agents must output NO_BACKEND_NEEDED when a static website is enough.
- Validator agents output concrete fixes or corrected code blocks, not long reports.
- Do not give code-building agents web/fetch tools unless the request explicitly requires external research.
- Never instruct any agent to create DOCX/PDF/report documents for a code-only website task.
- Keep intermediate specs compact so the final supervisor receives files, not essays.
- For professional websites, assign explicit ownership for visual polish, responsive layout, real visible images, animation behavior, and interaction wiring.
- If the request asks for images/products/gallery, require remote HTTPS image URLs, alt text, stable image dimensions/aspect ratios, object-fit CSS, and inline SVG/data URI fallbacks for failed image loads.
- If the request asks for a cart, require add/remove/quantity/count/total/empty-state/localStorage behavior and validation that every cart button works.
- If the request asks for hearts/SVGs/animations, require actual inline SVG icons and CSS transitions/keyframes with reduced-motion support.
- Set requiresBackend true only for auth, database, checkout/payment, admin, APIs, inventory, booking, order submission/storage, or server-side persistence. A simple cart/gift picker can be static with localStorage and does not require backend by itself.

BIG NON-CODE ASSIGNMENTS — mandatory rules for complex research, strategy, planning, analysis, or business tasks:
- Use hierarchical topology with a lead planner/supervisor as finalOutputAgentId.
- Use this DAG shape: Lead Planner → parallel specialists → Critic/Validator → Final Synthesizer.
- Give each specialist a distinct angle. Do not create generic "Agent 1" filler roles.
- The final supervisor must reconcile conflicts, state assumptions, call out risks, and produce the final answer.

For tools, pick from: memory, web_search, fetch_url, wikipedia, pubmed, datetime, calculate, code_interpreter
Return ONLY the JSON object, nothing else
${modelListStr}`;

    try {
      const r = await callAgentLLM(modelValue, [
        { role: "system", content: GOD_SYSTEM },
        { role: "user",   content: `Design a swarm for: ${desc}` }
      ], signal, 0.3);
      if (signal.aborted) return;

      const parsedRaw = parseBlueprintJson(r.content || "");
      let parsed = parsedRaw;

      if (!parsed || !Array.isArray(parsed.agents)) {
        if (statusText) statusText.textContent = "God output was invalid. Building fallback blueprint…";
        parsed = deterministicBlueprint(desc, providerModels);
      }
      if (statusText) statusText.textContent = "Hardening blueprint…";
      parsed = hardenGodBlueprint(parsed, desc, providerModels);
      const codeTask = isCodeBuildTask(desc);

      // Ensure required fields and normalize agents
      if (!parsed.dag) parsed.dag = { nodes: parsed.agents.map(a => a.id), edges: [] };
      parsed.agents = parsed.agents.map(a => ({
        ...a,
        tools: Array.isArray(a.tools) ? a.tools : (codeTask ? [] : [...ALL_TOOL_IDS]),
        model: a.model || "",
        memory: a.memory || "project",
        timeout: a.timeout || 120,
        retries: a.retries || 1,
        temperature: a.temperature ?? 0.7,
      }));

      // Enforce unique providers — if two agents share a provider, reassign from the unused pool
      const usedProviders = new Set();
      const unusedPool = providerModels.map(([, v]) => v); // all available models
      parsed.agents.forEach(a => {
        const provider = a.model?.startsWith("cloud:") ? a.model.split(":")[1] : (a.model ? "local" : "");
        if (!provider || usedProviders.has(provider)) {
          // Find a provider not yet used
          const replacement = unusedPool.find(v => {
            const p = v.startsWith("cloud:") ? v.split(":")[1] : "local";
            return !usedProviders.has(p);
          });
          if (replacement) {
            a.model = replacement;
            const p = replacement.startsWith("cloud:") ? replacement.split(":")[1] : "local";
            usedProviders.add(p);
          }
        } else {
          usedProviders.add(provider);
        }
      });

      // Add specific missing roles only; never create generic filler agents.
      if (parsed.agents.length < minAgents) {
        for (const agent of missingRoleTemplates(parsed, desc, usedProviders, providerModels)) {
          if (parsed.agents.length >= minAgents) break;
          parsed.agents.push(agent);
          if (!parsed.dag.nodes.includes(agent.id)) parsed.dag.nodes.push(agent.id);
        }
      }
      if (isBigAssignment(desc)) parsed = hardenGodBlueprint(parsed, desc, providerModels);
      else {
        attachPlanningMetadata(parsed, desc);
        ensureEdgeReasons(parsed);
      }
      const bp = createBlueprint(enforceTwoWordName(parsed.name || "God Swarm"), parsed);
      bp.description = parsed.description || desc;
      bp.task = desc;
      saveBlueprints();

      closeGodModal();
      setActive(bp.id);
      renderAll();
      // Load the description as the task input
      const taskEl = document.getElementById("amkTaskInput");
      if (taskEl) taskEl.value = desc;

      if (statusText) statusText.textContent = "";
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) {
        if (statusText) statusText.textContent = "";
      } else {
        if (statusText) statusText.textContent = "Error: " + err.message;
      }
    } finally {
      _godAbortCtrl = null;
      if (spinner)   spinner.classList.remove("visible");
      if (genBtn)    genBtn.disabled = false;
    }
  }

  // ── Inspector: read form → save to agent ──────────────────────────
  function saveAgentFromInspector() {
    const bp    = getActive();
    const agent = bp && bp.agents.find(a => a.id === selectedAgentId);
    if (!agent) return;

    const g = (id) => document.getElementById(id);
    agent.name        = g("amkFName")?.value.trim()   || agent.name;
    agent.icon        = g("amkFIcon")?.dataset.val     || agent.icon;
    agent.role        = g("amkFRole")?.value           || agent.role;
    agent.systemPrompt= g("amkFSystem")?.value.trim()  || agent.systemPrompt;
    agent.model       = g("amkFModel")?.value          || "";
    agent.memory      = g("amkFMemory")?.value         || "project";
    agent.temperature = parseFloat(g("amkFTemp")?.value) || 0.7;
    agent.timeout     = parseInt(g("amkFTimeout")?.value, 10) || 120;
    agent.retries     = parseInt(g("amkFRetries")?.value, 10) || 1;

    const checks = document.querySelectorAll(".amkToolCheck:checked");
    agent.tools = Array.from(checks).map(c => c.value);

    saveBlueprints();
    renderDAG();
  }

  // ── UI: Progress & Status ──────────────────────────────────────────
  function updateProgress(frac) {
    const fill = document.getElementById("amkProgressFill");
    if (fill) fill.style.width = Math.round(Math.min(1, frac) * 100) + "%";
  }

  function setRunStatus(cls, text) {
    const el = document.getElementById("amkRunStatus");
    if (!el) return;
    el.className = "amk-run-status" + (cls !== "idle" ? " " + cls : "");
    el.textContent = text;
  }

  // ── Trace console ──────────────────────────────────────────────────
  const traceStartTime = Date.now();

  const TRACE_SVGS = {
    boss: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5h10"/><path d="M4 10l2.5-6 1.5 3 1.5-3L12 10"/><path d="M4 10h8"/></svg>`,
    run:  `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 12.5 8 4 13.5Z"/></svg>`,
    ok:   `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.2 3.1 3.1L13 4.5"/></svg>`,
    wait: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.8V8l2.1 2.1"/></svg>`,
    warn: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14 13H2Z"/><path d="M8 6v3"/><path d="M8 11.5h.01"/></svg>`,
    err:  `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>`,
    tool: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5a3.3 3.3 0 0 0 4 4L7 13 3 13l.1-4Z"/></svg>`,
    file: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2.5H4.5A1.5 1.5 0 0 0 3 4v8a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V6.5Z"/><path d="M9 2.5v4h4"/><path d="M6 10h4"/></svg>`,
    retry:`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7a4 4 0 0 1 6.8-2.8L12 5.4"/><path d="M12 2.5v2.9H9.1"/><path d="M12 9a4 4 0 0 1-6.8 2.8L4 10.6"/><path d="M4 13.5v-2.9h2.9"/></svg>`,
  };

  function traceIconFor(message, statusCls) {
    if (/^Tool call:/.test(message)) return TRACE_SVGS.tool;
    if (/^File ready:/.test(message)) return TRACE_SVGS.file;
    if (/^Retrying\b|Rate limit\b/i.test(message)) return TRACE_SVGS.retry;
    return TRACE_SVGS[statusCls] || TRACE_SVGS.wait;
  }

  function traceAdd(agentName, message, statusCls, tokens) {
    const list = document.getElementById("amkTraceEntries");
    if (!list) return;
    const elapsed = ((Date.now() - traceStartTime) / 1000).toFixed(1);
    const el = document.createElement("div");
    el.className = "amk-trace-entry";
    const roleColor = Object.keys(ROLE_COLORS).reduce((acc, key) => {
      if (agentName.toLowerCase().includes(key)) return ROLE_COLORS[key];
      return acc;
    }, "#8899aa");
    el.innerHTML =
      `<span class="trace-time">[${elapsed}s]</span>` +
      `<span class="trace-agent trace-${statusCls}" style="color:${agentName === "Orchestrator" || agentName === "Aggregator" ? "var(--amk-amber)" : roleColor}">${escHtml(agentName)}</span>` +
      `<span class="trace-icon trace-${statusCls}">${traceIconFor(message, statusCls)}</span>` +
      `<span class="trace-msg trace-${statusCls}">${escHtml(message)}</span>` +
      (tokens ? `<span class="trace-tokens">${escHtml(String(tokens))}</span>` : "");
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    const summary = document.getElementById("amkTraceSummary");
    if (summary) summary.textContent = message.slice(0, 60);
  }

  function updateTraceDot(status) {
    const dot = document.getElementById("amkTraceDot");
    if (dot) dot.className = "amk-trace-dot" + (status !== "idle" ? " " + status : "");
  }

  function openTraceConsole() {
    const tc = document.getElementById("amkTraceConsole");
    if (tc) { tc.classList.remove("collapsed"); tc.classList.add("expanded"); }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── DAG rendering ──────────────────────────────────────────────────
  function updateNodeStatus(agentId, status) {
    nodeStatuses[agentId] = status;
    const g = document.querySelector(`#amkDagNodes [data-id="${agentId}"]`);
    if (!g) return;
    g.className.baseVal = `amk-node ${status}`;
    const dot = g.querySelector(".ns-dot");
    const dotColors = { idle: "rgba(255,255,255,0.2)", running: "#7c6af5", done: "#5fb88a", error: "#d98a85" };
    if (dot) dot.setAttribute("fill", dotColors[status] || dotColors.idle);
  }

  function renderDAG() {
    const bp = getActive();
    const nodesLayer = document.getElementById("amkDagNodes");
    const edgesLayer = document.getElementById("amkDagEdges");
    const emptyDag   = document.getElementById("amkEmptyDag");
    if (!nodesLayer || !edgesLayer) return;

    nodesLayer.innerHTML = "";
    edgesLayer.innerHTML = "";

    if (!bp || !bp.agents.length) {
      if (emptyDag) emptyDag.style.display = "";
      return;
    }
    if (emptyDag) emptyDag.style.display = "none";

    const agents = bp.agents;
    const edges  = bp.dag?.edges || [];
    _dagTransform(); // apply current pan/zoom to content group

    // Draw edges
    for (const e of edges) {
      const fromPos = nodePositions[e.from];
      const toPos   = nodePositions[e.to];
      if (!fromPos || !toPos) continue;

      const x1 = fromPos.x + NODE_W, y1 = fromPos.y + NODE_H / 2;
      const x2 = toPos.x,            y2 = toPos.y   + NODE_H / 2;
      const cx = (x1 + x2) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(124,106,245,0.5)");
      path.setAttribute("stroke-width", "1.8");
      path.setAttribute("marker-end", "url(#amk-arrow)");
      path.setAttribute("stroke-dasharray", nodeStatuses[e.from] === "running" ? "6,3" : "none");

      const gEdge = document.createElementNS("http://www.w3.org/2000/svg", "g");
      gEdge.className.baseVal = "amk-edge";
      gEdge.dataset.from = e.from;
      gEdge.dataset.to   = e.to;

      // Double-click to remove edge
      gEdge.addEventListener("dblclick", () => {
        const bp2 = getActive();
        if (bp2) { removeEdge(bp2, e.from, e.to); renderDAG(); }
      });

      // Click-area (invisible wider path for easier clicking)
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "12");
      hit.style.cursor = "pointer";
      hit.title = "Double-click to remove";

      gEdge.appendChild(hit);
      gEdge.appendChild(path);
      edgesLayer.appendChild(gEdge);
    }

    // Draw nodes
    for (const agent of agents) {
      const pos    = nodePositions[agent.id] || { x: 40, y: 40 };
      const status = nodeStatuses[agent.id]  || "idle";
      const color  = ROLE_COLORS[agent.role] || ROLE_COLORS.custom;
      const isSelected = agent.id === selectedAgentId;

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.className.baseVal = `amk-node ${status}`;
      g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
      g.dataset.id = agent.id;

      // Shadow
      const shadow = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      shadow.setAttribute("width", NODE_W); shadow.setAttribute("height", NODE_H);
      shadow.setAttribute("rx", 10); shadow.setAttribute("ry", 10);
      shadow.setAttribute("fill", "rgba(0,0,0,0.45)");
      shadow.setAttribute("transform", "translate(3,4)");
      g.appendChild(shadow);

      // Background
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.className.baseVal = "node-rect";
      rect.setAttribute("width", NODE_W); rect.setAttribute("height", NODE_H);
      rect.setAttribute("rx", 10); rect.setAttribute("ry", 10);
      rect.setAttribute("fill", "rgba(8,6,22,0.94)");
      rect.setAttribute("stroke", isSelected ? color : "rgba(255,255,255,0.12)");
      rect.setAttribute("stroke-width", isSelected ? "2.5" : "1.2");
      g.appendChild(rect);

      // Color accent left bar
      const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bar.setAttribute("width", 3); bar.setAttribute("height", NODE_H - 20);
      bar.setAttribute("x", 0); bar.setAttribute("y", 10);
      bar.setAttribute("rx", 2); bar.setAttribute("fill", color); bar.setAttribute("opacity", "0.9");
      g.appendChild(bar);

      // Icon — SVG foreignObject for role icon
      const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      fo.setAttribute("x", 8); fo.setAttribute("y", NODE_H / 2 - 10);
      fo.setAttribute("width", 22); fo.setAttribute("height", 20);
      fo.setAttribute("style", "pointer-events:none");
      const foDiv = document.createElement("div");
      foDiv.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      foDiv.style.cssText = `color:${color};display:flex;align-items:center;justify-content:center;width:22px;height:20px;`;
      const roleKey = (agent.role || agent.icon || "custom");
      foDiv.innerHTML = ROLE_SVGS[roleKey] || ROLE_SVGS.custom;
      fo.appendChild(foDiv);
      g.appendChild(fo);

      // Name
      const nameT = document.createElementNS("http://www.w3.org/2000/svg", "text");
      nameT.setAttribute("x", 38); nameT.setAttribute("y", 24);
      nameT.setAttribute("font-size", "12.5"); nameT.setAttribute("font-weight", "600");
      nameT.setAttribute("fill", "#ece7dc");
      nameT.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, sans-serif");
      nameT.textContent = agent.name.length > 15 ? agent.name.slice(0,13) + "…" : agent.name;
      g.appendChild(nameT);

      // Role
      const roleT = document.createElementNS("http://www.w3.org/2000/svg", "text");
      roleT.setAttribute("x", 38); roleT.setAttribute("y", 39);
      roleT.setAttribute("font-size", "9"); roleT.setAttribute("fill", color);
      roleT.setAttribute("font-family", "ui-monospace, monospace");
      roleT.setAttribute("opacity", "0.9");
      roleT.textContent = (agent.role || "custom").toUpperCase();
      g.appendChild(roleT);

      // Model label
      const rawMv = agent.model || "";
      const mvLabel = rawMv
        ? (typeof cloudModelLabel === "function" ? cloudModelLabel(rawMv) : rawMv).replace("cloud:","").split(":").pop().split("/").pop().slice(0,18)
        : "default";
      const modelT = document.createElementNS("http://www.w3.org/2000/svg", "text");
      modelT.setAttribute("x", 38); modelT.setAttribute("y", 55);
      modelT.setAttribute("font-size", "8.5"); modelT.setAttribute("fill", rawMv ? "rgba(96,165,250,0.65)" : "rgba(255,255,255,0.28)");
      modelT.setAttribute("font-family", "ui-monospace, monospace");
      modelT.textContent = mvLabel;
      g.appendChild(modelT);

      // Status dot
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.className.baseVal = "ns-dot";
      dot.setAttribute("cx", NODE_W - 12); dot.setAttribute("cy", 14); dot.setAttribute("r", 4);
      const dotColors = { idle: "rgba(255,255,255,0.2)", running: "#7c6af5", done: "#5fb88a", error: "#d98a85" };
      dot.setAttribute("fill", dotColors[status] || dotColors.idle);
      g.appendChild(dot);

      // Interactions
      g.style.cursor = "pointer";
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (ev.shiftKey && shiftSelectFrom && shiftSelectFrom !== agent.id) {
          const bp2 = getActive();
          if (bp2) {
            if (hasCycle(bp2.agents, [...bp2.dag.edges, { from: shiftSelectFrom, to: agent.id }])) {
              amkAlert("This connection would create a cycle — not allowed.");
            } else {
              addEdge(bp2, shiftSelectFrom, agent.id);
            }
          }
          shiftSelectFrom = null;
          renderDAG();
          return;
        }
        if (ev.shiftKey) { shiftSelectFrom = agent.id; return; }
        shiftSelectFrom = null;
        selectAgent(agent.id);
      });

      // Drag to reposition node
      let dragging = false, dragStart = null;
      g.addEventListener("mousedown", (ev) => {
        if (ev.button !== 0 || ev.shiftKey) return;
        ev.stopPropagation();
        dragging = true;
        dragStart = { mx: ev.clientX, my: ev.clientY, ox: pos.x, oy: pos.y };
      });
      document.addEventListener("mousemove", (ev) => {
        if (!dragging || !dragStart) return;
        const nx = Math.max(0, dragStart.ox + (ev.clientX - dragStart.mx) / dagZoom);
        const ny = Math.max(0, dragStart.oy + (ev.clientY - dragStart.my) / dagZoom);
        nodePositions[agent.id] = { x: nx, y: ny };
        g.setAttribute("transform", `translate(${nx}, ${ny})`);
        const bp2 = getActive();
        if (bp2) _redrawEdges(bp2);
      });
      document.addEventListener("mouseup", () => { dragging = false; dragStart = null; });

      nodesLayer.appendChild(g);
    }
  }

  function _redrawEdges(bp) {
    const layer = document.getElementById("amkDagEdges");
    if (!layer) return;
    layer.innerHTML = "";
    for (const e of (bp.dag?.edges || [])) {
      const fp = nodePositions[e.from], tp = nodePositions[e.to];
      if (!fp || !tp) continue;
      const x1 = fp.x + NODE_W, y1 = fp.y + NODE_H/2;
      const x2 = tp.x,          y2 = tp.y + NODE_H/2;
      const cx = (x1+x2)/2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      path.setAttribute("fill", "none"); path.setAttribute("stroke", "rgba(124,106,245,0.5)");
      path.setAttribute("stroke-width", "1.8"); path.setAttribute("marker-end", "url(#amk-arrow)");
      layer.appendChild(path);
    }
  }

  // ── Inspector panel ────────────────────────────────────────────────
  function selectAgent(agentId) {
    selectedAgentId = agentId;
    renderDAG();
    renderInspector();
  }

  const _s = (p) => `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">${p}</svg>`;
  const ALL_TOOLS = [
    { id: "memory",          label: "Memory",          icon: _s(`<ellipse cx="7" cy="5" rx="5" ry="3"/><path d="M2 5v4c0 1.7 2.2 3 5 3s5-1.3 5-3V5"/>`) },
    { id: "web_search",      label: "Web Search",       icon: _s(`<circle cx="7" cy="7" r="5"/><path d="M7 2a8 8 0 0 1 0 10M7 2a8 8 0 0 0 0 10M2 7h10"/>`) },
    { id: "fetch_url",       label: "Fetch URL",        icon: _s(`<path d="M5.5 8.5a3.5 3.5 0 0 0 5 0l1.5-1.5a3.5 3.5 0 0 0-5-5L5.5 3.5"/><path d="M8.5 5.5a3.5 3.5 0 0 0-5 0L2 7a3.5 3.5 0 0 0 5 5l1.5-1.5"/>`) },
    { id: "wikipedia",       label: "Wikipedia",        icon: _s(`<rect x="2" y="2" width="10" height="10" rx="1"/><path d="M4 5h6M4 7h4M4 9h5"/>`) },
    { id: "pubmed",          label: "PubMed",           icon: _s(`<circle cx="5.5" cy="5.5" r="3.5"/><path d="m12 12-2.8-2.8"/><path d="M5 3.5v4M3.5 5h3"/>`) },
    { id: "datetime",        label: "Date/Time",        icon: _s(`<circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 2"/>`) },
    { id: "calculate",       label: "Calculator",       icon: _s(`<rect x="2" y="2" width="10" height="10" rx="1.5"/><path d="M4 5h6M4 7h2M8 7h2M4 9h2M8 9h2"/>`) },
    { id: "code_interpreter",label: "Code Interpreter", icon: _s(`<path d="m4 5-2 2 2 2M10 5l2 2-2 2M8 3l-2 8"/>`) },
  ];

  // SVG paths for role icons (16×16 viewBox, stroke-based)
  const ROLE_SVGS = {
    researcher: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="6.5" cy="6.5" r="4.5"/><path d="m14 14-3.2-3.2"/></svg>`,
    writer:     `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M11 2.5a1.77 1.77 0 0 1 2.5 2.5L5 13.5 2 14l.5-3Z"/></svg>`,
    critic:     `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M14 2H2v9h5l3 3v-3h4Z"/><path d="M6 6h4M6 8.5h2"/></svg>`,
    coder:      `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="m5 4-3 4 3 4M11 4l3 4-3 4M9 2l-2 12"/></svg>`,
    analyst:    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="2" y="9" width="3" height="5" rx="1"/><rect x="6.5" y="6" width="3" height="8" rx="1"/><rect x="11" y="3" width="3" height="11" rx="1"/></svg>`,
    validator:  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M8 1 9.7 5.5H14l-3.8 2.8 1.5 4.5L8 10 4.3 12.8l1.5-4.5L2 5.5h4.3Z"/></svg>`,
    supervisor: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>`,
    custom:     `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>`,
    aggregator: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M4 4h8M4 8h8M4 12h8"/><circle cx="2" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`,
    planner:    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 7l2 2 4-4"/></svg>`,
  };
  const ROLE_SVG_ORDER = ["researcher","writer","critic","coder","analyst","validator","supervisor","planner","aggregator","custom"];

  function renderInspector() {
    const wrap   = document.getElementById("agent-maker-wrap");
    const body   = document.getElementById("amkInspectorBody");
    const footer = document.getElementById("amkInspectorFooter");
    const title  = document.getElementById("amkInspectorTitle");
    if (!body) return;

    const bp    = getActive();
    const agent = bp && bp.agents.find(a => a.id === selectedAgentId);

    // Open the inspector panel only when an agent is actively selected
    wrap?.classList.toggle("has-inspector", !!agent);

    if (!agent) {
      body.innerHTML = "";
      if (footer) footer.style.display = "none";
      if (title)  title.textContent = "—";
      return;
    }

    if (title)  title.textContent = agent.name;
    if (footer) footer.style.display = "";

    const modelOptions = (() => {
      const sel = document.getElementById("model");
      if (!sel) return `<option value="">${agent.model || "default"}</option>`;
      const defaultOpt = `<option value="" ${!agent.model ? "selected" : ""}>— Default (main model) —</option>`;
      const rest = Array.from(sel.options).map(o =>
        `<option value="${escHtml(o.value)}" ${o.value === agent.model ? "selected" : ""}>${escHtml(o.text)}</option>`
      ).join("");
      return defaultOpt + rest;
    })();

    const agentRoleIcon = agent.role || "custom";
    body.innerHTML = `
      <div class="amk-form-group">
        <label>Role Icon</label>
        <div class="amk-icon-row" id="amkIconRow" style="flex-wrap:wrap;gap:5px;">
          ${ROLE_SVG_ORDER.map(r => `<button class="amk-role-svg-btn${agentRoleIcon===r?" selected":""}" data-ic="${r}" title="${r.charAt(0).toUpperCase()+r.slice(1)}" onclick="this.parentElement.querySelectorAll('.amk-role-svg-btn').forEach(b=>b.classList.remove('selected'));this.classList.add('selected');document.getElementById('amkFIcon').dataset.val=this.dataset.ic;document.getElementById('amkFRole').value=this.dataset.ic;">${ROLE_SVGS[r]||ROLE_SVGS.custom}</button>`).join("")}
        </div>
        <input type="hidden" id="amkFIcon" data-val="${escHtml(agentRoleIcon)}">
      </div>
      <div class="amk-form-group">
        <label>Name</label>
        <input type="text" id="amkFName" value="${escHtml(agent.name)}" placeholder="Agent name">
      </div>
      <div class="amk-form-group">
        <label>Role</label>
        <select id="amkFRole">
          ${["researcher","writer","critic","coder","analyst","validator","supervisor","custom"].map(r =>
            `<option value="${r}" ${agent.role===r?"selected":""}>${r.charAt(0).toUpperCase()+r.slice(1)}</option>`
          ).join("")}
        </select>
      </div>
      <div class="amk-form-group">
        <label>Model</label>
        <select id="amkFModel">${modelOptions}</select>
      </div>
      <div class="amk-form-group">
        <label>System Prompt</label>
        <textarea id="amkFSystem" rows="5" placeholder="You are a…">${escHtml(agent.systemPrompt||"")}</textarea>
      </div>
      <div class="amk-form-group">
        <label>Memory</label>
        <select id="amkFMemory">
          ${["project","global","isolated"].map(m => `<option value="${m}" ${agent.memory===m?"selected":""}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="amk-form-group">
        <label>Temperature <span id="amkTempVal" style="color:var(--amk-bright)">${(agent.temperature||0.7).toFixed(1)}</span></label>
        <div class="amk-slider-row">
          <input type="range" id="amkFTemp" min="0" max="1" step="0.1" value="${agent.temperature||0.7}"
            oninput="document.getElementById('amkTempVal').textContent=parseFloat(this.value).toFixed(1)">
        </div>
      </div>
      <div class="amk-form-group">
        <label>Timeout (seconds)</label>
        <input type="number" id="amkFTimeout" value="${agent.timeout||120}" min="10" max="600">
      </div>
      <div class="amk-form-group">
        <label>Retries</label>
        <input type="number" id="amkFRetries" value="${agent.retries??1}" min="0" max="5">
      </div>
      <div class="amk-form-group">
        <label>Tools</label>
        <div class="amk-tools-grid">
          ${ALL_TOOLS.map(t => `
            <label class="amk-tool-check">
              <input type="checkbox" class="amkToolCheck" value="${t.id}" ${(agent.tools||[]).includes(t.id)?"checked":""}>
              <span class="tool-icon">${t.icon}</span> ${t.label}
            </label>`).join("")}
        </div>
      </div>
      <div class="amk-form-group" style="padding-bottom:4px">
        <label>Connections</label>
        <div style="font-size:11px;color:var(--muted);line-height:1.6">
          <b style="color:var(--text-dim)">Receives from:</b> ${(bp.dag.edges||[]).filter(e=>e.to===agent.id).map(e=>{const a=bp.agents.find(x=>x.id===e.from);return a?escHtml(a.name):e.from;}).join(", ")||"none"}<br>
          <b style="color:var(--text-dim)">Sends to:</b> ${(bp.dag.edges||[]).filter(e=>e.from===agent.id).map(e=>{const a=bp.agents.find(x=>x.id===e.to);return a?escHtml(a.name):e.to;}).join(", ")||"none"}<br>
          <span style="color:rgba(124,106,245,0.6);font-size:10px">Shift-click two nodes to connect them · dbl-click edge to remove</span>
        </div>
      </div>`;
  }

  // ── Blueprint list ─────────────────────────────────────────────────
  function renderBlueprintList() {
    const list = document.getElementById("amkBlueprintsList");
    if (!list) return;
    let html = "";

    if (blueprints.length) {
      html += `<div class="amk-section-label">MY BLUEPRINTS</div>`;
      html += blueprints.map(bp => `
        <div class="amk-blueprint-card${bp.id===activeBlueprintId?" active":""}" data-id="${bp.id}" data-bp-id="${bp.id}">
          <div class="bp-name">${escHtml(bp.name)}</div>
          <div class="bp-meta">
            <span class="bp-topology">${escHtml(bp.topology||"custom")}</span>
            <span>${bp.agents?.length||0} agents</span>
          </div>
          ${bp.task ? `<div class="bp-task">${escHtml(bp.task.length > 55 ? bp.task.slice(0,55)+"…" : bp.task)}</div>` : ""}
          <div class="bp-actions">
            <button class="bp-action-btn" data-bp-rename="${bp.id}" title="Rename">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M11 2.5a1.5 1.5 0 0 1 2.12 2.12L5 13H3v-2L11 2.5z"/></svg>
            </button>
            <button class="bp-action-btn bp-delete" data-bp-delete="${bp.id}" title="Delete">×</button>
          </div>
        </div>`).join("");
    }

    const chevron = tplPanelOpen
      ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="10" height="10"><path d="M4 10l4-4 4 4"/></svg>`
      : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="10" height="10"><path d="M4 6l4 4 4-4"/></svg>`;
    html += `<button class="amk-tpl-toggle" data-bp-tpl-toggle="1" style="margin-top:${blueprints.length?8:0}px">
      <span>STARTER TEMPLATES</span>${chevron}
    </button>`;

    if (tplPanelOpen) {
      const TPL_ROLE_MAP = { "Research Swarm":"researcher","Dev Squad":"coder","Debate Club":"critic","Data Analyst":"analyst","Security Audit":"validator","Content Factory":"writer","Website Builder":"custom" };
      html += TEMPLATES.map((t,i) => {
        const tplRole = TPL_ROLE_MAP[t.name] || t.topology || "custom";
        const tplSvg  = ROLE_SVGS[tplRole] || ROLE_SVGS.custom;
        return `
        <button class="amk-template-chip" data-bp-tpl-index="${i}">
          <span class="tpl-icon">${tplSvg}</span>
          <span class="tpl-info">
            <span class="tpl-name">${escHtml(t.name)}</span>
            <span class="tpl-desc">${escHtml(t.description)}</span>
          </span>
        </button>`;
      }).join("");
    }

    list.innerHTML = html;
  }

  function renderAll() {
    renderBlueprintList();
    renderDAG();
    renderInspector();
    syncTopologySelect();
  }

  function syncTopologySelect() {
    const bp = getActive();
    const tSel = document.getElementById("amkTopologySelect");
    const aSel = document.getElementById("amkAggregationSelect");
    if (tSel && bp) tSel.value = bp.topology || "pipeline";
    if (aSel && bp) aSel.value = bp.aggregation || "synthesis";
  }

  // ── God Modal ──────────────────────────────────────────────────────
  function openGodModal() {
    const m = document.getElementById("amkGodModal");
    if (m) m.classList.add("open");
    // Mirror main model dropdown into the God Agent model select.
    const src = document.getElementById("model");
    const godDst = document.getElementById("amkGodModelSelect");
    if (src && godDst) { godDst.innerHTML = src.innerHTML; godDst.value = src.value; }
  }
  function closeGodModal() {
    if (_godAbortCtrl) { _godAbortCtrl.abort(); _godAbortCtrl = null; }
    const m = document.getElementById("amkGodModal");
    if (m) m.classList.remove("open");
    const spinner    = document.getElementById("amkGodSpinner");
    const statusText = document.getElementById("amkGodStatusText");
    const genBtn     = document.getElementById("amkGodGenerateBtn");
    if (spinner)    spinner.classList.remove("visible");
    if (statusText) statusText.textContent = "";
    if (genBtn)     genBtn.disabled = false;
  }

  // ── Chat Peek Panel ────────────────────────────────────────────────

  // Code store — keeps raw code out of attributes (avoids quote/encoding bugs)
  const _peekCodeStore = {};

  // ── Web Project support ────────────────────────────────────────────
  let _projectFiles = null; // Map<filename, {lang, content}> | null

  function _guessLang(filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    return { html:"html", htm:"html", css:"css", js:"javascript", ts:"typescript",
             jsx:"javascript", tsx:"typescript", json:"json", py:"python",
             md:"markdown", svg:"svg", sh:"bash" }[ext] || "text";
  }

  function _fileTypeIcon(filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    const s = (p, extra="") => `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" ${extra}>${p}</svg>`;
    const icons = {
      html: s(`<path d="M2 3l1 8 4 1.5L11 11l1-8"/><path d="M4.5 6h5M5 9h4"/>`),
      htm:  s(`<path d="M2 3l1 8 4 1.5L11 11l1-8"/><path d="M4.5 6h5M5 9h4"/>`),
      css:  s(`<path d="M2.5 2.5l1 9 3.5 1 3.5-1 1-9z"/><path d="M4.5 6h5M5 9h4"/>`),
      js:   s(`<rect x="1.5" y="1.5" width="11" height="11" rx="2"/><path d="M5.5 9.5V5.5M8.5 5.5v3a1.5 1.5 0 0 1-3 0"/>`),
      ts:   s(`<rect x="1.5" y="1.5" width="11" height="11" rx="2"/><path d="M4.5 6h5M7 6v4"/>`),
      jsx:  s(`<rect x="1.5" y="1.5" width="11" height="11" rx="2"/><path d="M5.5 9.5V5.5M8.5 5.5v3a1.5 1.5 0 0 1-3 0"/>`),
      tsx:  s(`<rect x="1.5" y="1.5" width="11" height="11" rx="2"/><path d="M4.5 6h5M7 6v4"/>`),
      json: s(`<path d="M4.5 2C3 2 2.5 2.5 2.5 3.5v2c0 .7-.5 1-.5 1s.5.3.5 1v2c0 1 .5 1.5 2 1.5M9.5 2c1.5 0 2 .5 2 1.5v2c0 .7.5 1 .5 1s-.5.3-.5 1v2c0 1-.5 1.5-2 1.5"/>`),
      py:   s(`<path d="M5 2C3 2 2 3 2 4.5V6h5v1H3c-1 0-1.5.8-1.5 2.5S2 12 4 12h1v-1.5c0-1 .7-1.5 2-1.5H10c1 0 2-.8 2-2V4.5C12 3 11 2 9 2H5z"/><circle cx="5" cy="4" r=".7" fill="currentColor" stroke="none"/><circle cx="9" cy="10" r=".7" fill="currentColor" stroke="none"/>`),
      md:   s(`<rect x="1.5" y="2.5" width="11" height="9" rx="1.5"/><path d="M4 9.5V5l2 2.5L8 5v4.5M11 7H9.5"/>`),
      svg:  s(`<rect x="1.5" y="1.5" width="11" height="11" rx="1.5"/><circle cx="4.5" cy="4.5" r="1.2"/><path d="M1.5 10l3-3.5 2.5 3 2-2.5L12 11"/>`),
      sh:   s(`<rect x="1.5" y="2" width="11" height="10" rx="1.5"/><path d="M4 8.5l2-2.5-2-2M7.5 8.5h3"/>`),
    };
    return icons[ext] || s(`<path d="M8 1.5H3.5A1.5 1.5 0 0 0 2 3v8A1.5 1.5 0 0 0 3.5 12.5h7A1.5 1.5 0 0 0 12 11V5.5L8 1.5z"/><path d="M8 1.5V5.5H12"/><path d="M4.5 8h5M4.5 10h3"/>`);
  }

  // Extract named code blocks — supports ```lang:filename and ```lang filename.ext
  function _extractProjectFiles(text) {
    const files = new Map();
    // Primary: ```lang filename.ext  (space/tab separator)
    // Last-wins: QA agent corrections overwrite original agent outputs
    const re = /```([\w-]*)[ \t]+([^\s`'"`]+\.[\w]{1,8})\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const fname = m[2].replace(/^["']|["']$/g, "").toLowerCase();
      files.set(fname, { lang: m[1] || _guessLang(fname), content: m[3] });
    }
    // Secondary: ```lang:filename.ext  (last-wins)
    const re2 = /```([\w-]+):([\w./\-]+\.[\w]{1,8})\n([\s\S]*?)```/g;
    while ((m = re2.exec(text)) !== null) {
      const fname = m[2].toLowerCase();
      files.set(fname, { lang: m[1] || _guessLang(fname), content: m[3] });
    }
    // Tertiary: // file: comment  (last-wins)
    const re3 = /```(\w*)\n(?:(?:\/\/|#|<!--)\s*file:\s*([^\s\n*]+?)(?:\s*-->)?\n)([\s\S]*?)```/g;
    while ((m = re3.exec(text)) !== null) {
      const fname = m[2].toLowerCase();
      files.set(fname, { lang: m[1] || _guessLang(fname), content: m[3] });
    }
    // Fallback: plain ```html block → index.html
    if (!files.has("index.html")) {
      const h = /```html\n([\s\S]*?)```/.exec(text);
      if (h) files.set("index.html", { lang: "html", content: h[1] });
    }
    // Fallback: plain ```css block → styles.css
    if (!files.has("styles.css") && !files.has("style.css")) {
      const c = /```css\n([\s\S]*?)```/.exec(text);
      if (c) files.set("styles.css", { lang: "css", content: c[1] });
    }
    // Fallback: plain ```js / ```javascript block → app.js
    const hasJs = [...files.keys()].some(k => k.endsWith(".js"));
    if (!hasJs) {
      const j = /```(?:javascript|js)\n([\s\S]*?)```/.exec(text);
      if (j) files.set("app.js", { lang: "javascript", content: j[1] });
    }
    return files;
  }

  function _buildPreviewHTML(files) {
    const entry = files.get("index.html") || files.get("index.htm") ||
      [...files.values()].find(f => f.lang === "html");
    if (!entry) return null;
    let html = entry.content;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inlined = new Set();

    for (const [name, f] of files) {
      if (f === entry) continue;
      if (name.endsWith(".css")) {
        const before = html;
        html = html.replace(
          new RegExp(`<link[^>]+href=["'](?:\\./)?${esc(name)}["'][^>]*/?>`, "gi"),
          `<style>/* ${name} */\n${f.content}\n</style>`
        );
        if (html !== before) inlined.add(name);
      } else if (name.endsWith(".js")) {
        const before = html;
        html = html.replace(
          new RegExp(`<script[^>]+src=["'](?:\\./)?${esc(name)}["'][^>]*></script>`, "gi"),
          `<script>/* ${name} */\n${f.content}\n</script>`
        );
        if (html !== before) inlined.add(name);
      }
    }

    // Inject any CSS/JS that wasn't matched by a link/script tag — always inject, don't drop
    const extraCss = [], extraJs = [];
    for (const [name, f] of files) {
      if (f === entry || inlined.has(name)) continue;
      if (name.endsWith(".css")) extraCss.push(`/* ${name} */\n${f.content}`);
      else if (name.endsWith(".js")) extraJs.push(`/* ${name} */\n${f.content}`);
    }
    if (extraCss.length) {
      const tag = `<style>\n${extraCss.join("\n\n")}\n</style>`;
      html = /<\/head>/i.test(html)
        ? html.replace(/<\/head>/i, `${tag}\n</head>`)
        : tag + "\n" + html;
    }
    if (extraJs.length) {
      const tag = `<script>\n${extraJs.join("\n\n")}\n</script>`;
      html = /<\/body>/i.test(html)
        ? html.replace(/<\/body>/i, `${tag}\n</body>`)
        : html + "\n" + tag;
    }

    // Force-inject Tailwind CDN if Tailwind classes are present but CDN is missing
    const hasTailwindClasses = /class="[^"]*(?:bg-|text-|flex|grid|p-|m-|rounded|shadow|border|w-|h-|gap-|space-)[^"]*"/i.test(html);
    const hasTailwindScript = /cdn\.tailwindcss\.com|tailwind\.config/i.test(html);
    if (hasTailwindClasses && !hasTailwindScript) {
      const inject = '<script src="https://cdn.tailwindcss.com"></script>';
      html = /<\/head>/i.test(html)
        ? html.replace(/<\/head>/i, `${inject}\n</head>`)
        : inject + "\n" + html;
    }
    return html;
  }

  let _previewHtmlCache = "";

  // Build a compact code-only payload from raw swarm text.
function _polishToast(text, isError) {
    let t = document.getElementById("amkPolishToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "amkPolishToast";
      Object.assign(t.style, {
        position:"fixed", bottom:"28px", right:"28px", zIndex:"99999",
        background:"#1e1e2e", border:"1.5px solid #7c6af5", color:"#e2e2e9",
        padding:"11px 18px", borderRadius:"10px", fontSize:"13px",
        boxShadow:"0 6px 28px rgba(0,0,0,.45)", maxWidth:"340px",
        lineHeight:"1.5", pointerEvents:"none"
      });
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.borderColor = isError ? "#f38ba8" : "#7c6af5";
    clearTimeout(t._tmr);
    t._tmr = setTimeout(() => t.remove(), isError ? 6000 : 3000);
  }

  // Merge swarm output algorithmically (no LLM) and open in a new tab.
  function _polishAndPreview(rawContent) {
    const source = rawContent || lastSwarmOutput;

    const btn      = document.getElementById("amkPolishBtn");
    const statusEl = document.getElementById("amkPolisherStatus");
    const setStatus = (text, cls) => {
      if (statusEl) { statusEl.textContent = text; statusEl.className = "amk-polisher-status " + (cls || ""); }
    };

    if (!source) {
      _polishToast("Run an Agent Swarm first — the polisher merges swarm output into one HTML file.", true);
      return;
    }

    if (btn) btn.disabled = true;
    setStatus("Merging…", "running");
    _polishToast("Merging files…");

    try {
      const files  = _extractProjectFiles(source);
      const merged = files.size > 0 ? _buildPreviewHTML(files) : null;

      if (!merged) {
        throw new Error("No HTML file found in swarm output. Make sure your swarm produces an index.html file.");
      }

      _polishedHtmlCache = merged;
      setStatus("Done ✓", "done");
      _polishToast("Done — opening in new tab");

      const blob = new Blob([_polishedHtmlCache], { type: "text/html;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      setTimeout(() => setStatus("", ""), 4000);

    } catch (err) {
      setStatus(err.message, "error");
      _polishToast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function _polisherDownload() {
    // Build merged HTML fresh from swarm output every time
    const source = lastSwarmOutput;
    const statusEl = document.getElementById("amkPolisherStatus");
    const setStatus = (text, cls) => {
      if (statusEl) { statusEl.textContent = text; statusEl.className = "amk-polisher-status " + (cls || ""); }
    };

    if (!source) {
      _polishToast("Run an Agent Swarm first — nothing to download yet.", true);
      return;
    }

    try {
      const files  = _extractProjectFiles(source);
      const merged = files.size > 0 ? _buildPreviewHTML(files) : null;
      if (!merged) throw new Error("No HTML file found in swarm output.");
      _polishedHtmlCache = merged;
    } catch (err) {
      setStatus(err.message, "error");
      _polishToast(err.message, true);
      return;
    }

    setStatus("Downloading…", "running");
    const blob = new Blob([_polishedHtmlCache], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "site.html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus("Downloaded ✓", "done");
    setTimeout(() => setStatus("", ""), 3000);
  }


  function _showProjectFile(filename) {
    if (!_projectFiles) return;
    const file = _projectFiles.get(filename.toLowerCase());
    if (!file) return;
    document.querySelectorAll(".amk-peek-file-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.filename === filename));
    const el = document.getElementById("amkPeekFileContent");
    if (el) el.innerHTML = _peekCodeBlock("pf_" + filename.replace(/\W/g, "_"), file.lang, file.content);
  }

  // Detect raw unfenced code only when text has NO fences at all
  function _detectRawCode(text) {
    if (/```/.test(text)) return null; // already has fences — don't re-detect
    const t = text.trim();
    if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return "html";
    const lines = t.split("\n").filter(l => l.trim());
    if (lines.length > 4) {
      const tagLines = lines.filter(l => /^\s*</.test(l)).length;
      if (tagLines / lines.length > 0.55) return "html";
    }
    return null;
  }

  function _peekRenderContent(text) {
    if (!text) return "";

    // Only treat as raw block if there are zero fences in the text
    const rawLang = _detectRawCode(text);
    if (rawLang) {
      const idx = "raw_" + Date.now();
      return _peekCodeBlock(idx, rawLang, text);
    }

    // Split on fenced code blocks
    const parts = [];
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: "md", content: text.slice(last, m.index) });
      parts.push({ type: "code", lang: m[1] || "text", content: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: "md", content: text.slice(last) });

    return parts.map((p, i) => {
      if (p.type === "md") {
        const segLang = _detectRawCode(p.content);
        if (segLang) return _peekCodeBlock("seg_" + i, segLang, p.content);
        const trimmed = p.content.trim();
        if (!trimmed) return "";
        // Use marked directly (global CDN) so we're not dependent on formatContent scope
        let rendered;
        try {
          rendered = window.marked ? window.marked.parse(trimmed) : `<pre>${escHtml(trimmed)}</pre>`;
        } catch(e) {
          rendered = `<pre>${escHtml(trimmed)}</pre>`;
        }
        return `<div class="amk-peek-md-segment">${rendered}</div>`;
      }
      return _peekCodeBlock("blk_" + i, p.lang || "text", p.content);
    }).join("");
  }

  function _peekCodeBlock(idx, lang, code) {
    _peekCodeStore[idx] = code;
    const safeCode = escHtml(code);
    const safeLang = escHtml(lang || "text");
    return `<div class="amk-peek-code-block" data-peek-idx="${idx}">
      <div class="amk-peek-code-header">
        <span class="amk-peek-code-lang">${safeLang}</span>
        <div class="amk-peek-code-btns">
          <button class="amk-peek-code-btn" onclick="SwarmMaker._peekCopyCode('${idx}')">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" width="11" height="11"><rect x="4" y="4" width="8" height="8" rx="1.2"/><path d="M2 10V2h8"/></svg>
            Copy
          </button>
        </div>
      </div>
      <pre class="amk-peek-pre">${safeCode}</pre>
    </div>`;
  }

  function _renderPeekBody(body) {
    const bp = getActive();

    if (!lastSwarmOutput) {
      _projectFiles = null;
      const bpName = bp?.name || "this blueprint";
      body.innerHTML = `<div class="amk-peek-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="38" height="38" style="opacity:.4"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h6M9 13h4"/></svg>
        <p>No output for <b>${escHtml(bpName)}</b></p>
        <span>Run this swarm to see results here</span>
      </div>`;
      return;
    }

    const files = _extractProjectFiles(lastSwarmOutput);
    _projectFiles = files.size > 0 ? files : null;
    const hasHtml = files.has("index.html") || files.has("index.htm") ||
      [...files.values()].some(f => f.lang === "html");

    const runTime = bp?.lastRun
      ? new Date(bp.lastRun).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
      : "";

    const polisherBar = `
    <div class="amk-polisher-bar">
      <div class="amk-polisher-left">
        <svg class="amk-polisher-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14">
          <polygon points="8,1 10,6 15,6 11,9.5 12.5,14.5 8,11.5 3.5,14.5 5,9.5 1,6 6,6" fill="currentColor" opacity=".2"/>
          <polygon points="8,1 10,6 15,6 11,9.5 12.5,14.5 8,11.5 3.5,14.5 5,9.5 1,6 6,6"/>
        </svg>
        <span class="amk-polisher-label">Download Site</span>
      </div>
      <button class="amk-polish-btn" onclick="SwarmMaker._polisherDownload()">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
          <path d="M7 1v8M4 6l3 3 3-3M2 11h10"/>
        </svg>
        Download
      </button>
      <span id="amkPolisherStatus" class="amk-polisher-status"></span>
    </div>`;

    const hdr = `<div class="amk-peek-output-hdr">
      <span class="amk-peek-output-name">${escHtml(bp?.name || "Swarm")}</span>
      ${runTime ? `<span class="amk-peek-run-badge">${runTime}</span>` : ""}
    </div>${polisherBar}`;

    if (files.size > 1) {
      // ── Multi-file project view ──
      const sorted = [...files.entries()].sort(([a],[b]) => {
        const rank = n => n==="index.html"?0 : n.endsWith(".html")?1 : n.endsWith(".css")?2 : n.endsWith(".js")?3 : 4;
        return rank(a) - rank(b);
      });
      const tabs = `<div class="amk-peek-file-tabs">` +
        sorted.map(([name], i) =>
          `<button class="amk-peek-file-tab${i===0?" active":""}" data-filename="${escHtml(name)}"
            onclick="SwarmMaker._showProjectFile('${escHtml(name)}')">
            <span class="amk-peek-file-type-icon">${_fileTypeIcon(name)}</span>${escHtml(name)}
          </button>`
        ).join("") +
        `</div>`;
      const first = sorted[0];
      const firstBlock = _peekCodeBlock("pf_" + first[0].replace(/\W/g,"_"), first[1].lang, first[1].content);
      body.innerHTML = hdr + tabs + `<div id="amkPeekFileContent" class="amk-peek-file-content">${firstBlock}</div>`;
    } else {
      // ── Normal text / single-file output ──
      body.innerHTML = hdr + `<div class="amk-peek-output-body">${_peekRenderContent(lastSwarmOutput)}</div>`;
    }

    setTimeout(() => { body.scrollTop = 0; }, 20);
  }

  function openChatPeek() {
    const panel = document.getElementById("amkChatPeek");
    const body  = document.getElementById("amkChatPeekBody");
    if (!panel || !body) return;
    _renderPeekBody(body);
    panel.classList.add("open");
  }

  function closeChatPeek() {
    document.getElementById("amkChatPeek")?.classList.remove("open");
  }

  function _peekCopyCode(idx) {
    const code = _peekCodeStore[idx] || "";
    navigator.clipboard.writeText(code).catch(() => {});
  }


  // ── Public API (exposed on window for inline onclick) ──────────────
  function _selectBp(id) {
    setActive(id); renderAll();
    const bp = getActive();
    const taskEl = document.getElementById("amkTaskInput");
    if (taskEl) taskEl.value = bp?.task || "";
    lastSwarmOutput = bp?.lastOutput || "";
    // Live-refresh panel content if it's already open
    const panel = document.getElementById("amkChatPeek");
    const body  = document.getElementById("amkChatPeekBody");
    if (panel?.classList.contains("open") && body) _renderPeekBody(body);
  }
  async function _deleteBp(id)  { if (await amkConfirm("Delete this blueprint?")) { deleteBlueprint(id); renderAll(); } }
  function _toggleTpl() { tplPanelOpen = !tplPanelOpen; renderBlueprintList(); }

  async function _renameBp(id) {
    const bp = blueprints.find(b => b.id === id);
    if (!bp) return;
    const newName = await amkPrompt("Rename blueprint (2 words max):", bp.name);
    if (!newName) return;
    const enforced = enforceTwoWordName(newName);
    if (enforced === bp.name) return;
    bp.name = enforced;
    saveBlueprints();
    renderBlueprintList();
  }
  function _loadTemplate(i) {
    const t  = TEMPLATES[i];
    const bp = createBlueprint(t.name, t);
    setActive(bp.id);
    renderAll();
    const taskEl = document.getElementById("amkTaskInput");
    if (taskEl) taskEl.value = bp.task || "";
  }

  // ── Mount ──────────────────────────────────────────────────────────
  function mount() {
    if (mounted) { renderAll(); return; }
    mounted = true;
    loadBlueprints();

    // Back button
    const backBtn = document.getElementById("amkBackBtn");
    if (backBtn) backBtn.addEventListener("click", () => {
      const back = (window._H?.state?._preAgentMakerTab) || "chats";
      window._H?.setTab?.(back === "agent-maker" ? "chats" : back);
    });

    // New blueprint
    document.getElementById("amkNewBlueprintBtn")?.addEventListener("click", async () => {
      const name = await amkPrompt("Blueprint name:", "My Swarm");
      if (!name) return;
      const bp = createBlueprint(name);
      setActive(bp.id);
      renderAll();
    });

    // Add agent to canvas
    document.getElementById("amkAddAgentToCanvasBtn")?.addEventListener("click", async () => {
      let bp = getActive();
      if (!bp) {
        const name = await amkPrompt("Create a new blueprint first. Name:", "My Swarm");
        if (!name) return;
        bp = createBlueprint(name);
        setActive(bp.id);
      }
      const agent = addAgentToBlueprint(bp);
      autoLayoutBlueprint(bp);
      selectAgent(agent.id);
      renderAll();
    });

    // Auto-layout
    document.getElementById("amkAutoLayoutBtn")?.addEventListener("click", () => {
      const bp = getActive();
      if (bp) { autoLayoutBlueprint(bp); renderDAG(); }
    });

    // Zoom controls
    document.getElementById("amkZoomInBtn")?.addEventListener("click",    () => applyDagZoom(dagZoom + DAG_ZOOM_STEP));
    document.getElementById("amkZoomOutBtn")?.addEventListener("click",   () => applyDagZoom(dagZoom - DAG_ZOOM_STEP));
    document.getElementById("amkZoomResetBtn")?.addEventListener("click", () => { dagZoom = 1.0; dagPan = { x: 0, y: 0 }; _dagTransform(); });
    // Scroll-wheel zoom at cursor position
    document.getElementById("amkDagSvg")?.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = document.getElementById("amkDagSvg").getBoundingClientRect();
      applyDagZoom(dagZoom + (e.deltaY < 0 ? DAG_ZOOM_STEP : -DAG_ZOOM_STEP),
        { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    // Canvas pan (drag on background)
    const svgEl2 = document.getElementById("amkDagSvg");
    let panning = false, panStart = null;
    svgEl2?.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t.id === "amkDagSvg" || t.id === "amkDagContent" || t.id === "amkDagEdges") {
        panning = true;
        panStart = { mx: e.clientX, my: e.clientY, px: dagPan.x, py: dagPan.y };
        svgEl2.style.cursor = "grabbing";
        e.preventDefault();
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (!panning || !panStart) return;
      dagPan.x = panStart.px + (e.clientX - panStart.mx);
      dagPan.y = panStart.py + (e.clientY - panStart.my);
      _dagTransform();
    });
    document.addEventListener("mouseup", () => {
      if (panning) { panning = false; panStart = null; if (svgEl2) svgEl2.style.cursor = "grab"; }
    });

    // Topology/Aggregation selects
    document.getElementById("amkTopologySelect")?.addEventListener("change", (e) => {
      const bp = getActive();
      if (bp) { bp.topology = e.target.value; saveBlueprints(); }
    });
    document.getElementById("amkAggregationSelect")?.addEventListener("change", (e) => {
      const bp = getActive();
      if (bp) { bp.aggregation = e.target.value; saveBlueprints(); }
    });

    // Run swarm
    document.getElementById("amkRunBtn")?.addEventListener("click", runSwarm);

    // Stop swarm
    document.getElementById("amkStopBtn")?.addEventListener("click", () => {
      if (swarmAbortCtrl) swarmAbortCtrl.abort();
    });

    // Save agent from inspector
    document.getElementById("amkSaveAgentBtn")?.addEventListener("click", () => {
      saveAgentFromInspector();
      renderBlueprintList();
      renderInspector();
    });

    // Delete agent from inspector
    document.getElementById("amkDeleteAgentBtn")?.addEventListener("click", async () => {
      const bp    = getActive();
      const agent = bp && bp.agents.find(a => a.id === selectedAgentId);
      if (!agent) return;
      if (!await amkConfirm(`Remove "${agent.name}" from swarm?`)) return;
      removeAgentFromBlueprint(bp, agent.id);
      selectedAgentId = null;
      autoLayoutBlueprint(bp);
      renderAll();
    });

    // Close inspector on click anywhere outside an agent node or the inspector itself.
    // Keep it open for clicks on nodes (which select), the inspector panel, modals, and dialogs.
    document.addEventListener("click", (e) => {
      if (!selectedAgentId) return;
      if (!document.body.classList.contains("agent-maker-mode")) return;
      if (e.target.closest(".amk-node")) return;
      if (e.target.closest(".amk-inspector-panel")) return;
      if (e.target.closest(".amk-dialog")) return;
      if (e.target.closest(".amk-god-modal")) return;
      if (e.target.closest(".amk-chat-peek")) return;
      selectedAgentId = null;
      shiftSelectFrom = null;
      renderDAG();
      renderInspector();
    });

    // Auto-save inspector edits — no Save button needed.
    // `input` (typing) is debounced; `change` (commits) re-renders the DAG so node visuals stay in sync.
    let _inspectorSaveTimer = null;
    document.getElementById("amkInspectorBody")?.addEventListener("input", (e) => {
      if (!selectedAgentId) return;
      clearTimeout(_inspectorSaveTimer);
      _inspectorSaveTimer = setTimeout(() => {
        saveAgentFromInspector();
        if (e.target.id === "amkFName") {
          const t = document.getElementById("amkInspectorTitle");
          if (t) t.textContent = e.target.value || "—";
        }
      }, 180);
    });
    document.getElementById("amkInspectorBody")?.addEventListener("change", () => {
      if (!selectedAgentId) return;
      clearTimeout(_inspectorSaveTimer);
      saveAgentFromInspector();
      renderDAG();
      renderBlueprintList();
    });

    // Task autosave — persist typed task into active blueprint
    document.getElementById("amkTaskInput")?.addEventListener("input", () => {
      const bp = getActive();
      if (bp) { bp.task = document.getElementById("amkTaskInput").value; saveBlueprints(); renderBlueprintList(); }
    });

    // Chat peek
    document.getElementById("amkViewChatBtn")?.addEventListener("click", openChatPeek);
    document.getElementById("amkChatPeekClose")?.addEventListener("click", closeChatPeek);
    document.getElementById("amkPeekCopyBtn")?.addEventListener("click", () => {
      if (lastSwarmOutput) navigator.clipboard.writeText(lastSwarmOutput).catch(() => {});
    });
    document.getElementById("amkPeekExportBtn")?.addEventListener("click", () => {
      if (!lastSwarmOutput) return;
      const bp = getActive();
      const stem = (bp?.name || "swarm-output").replace(/\s+/g, "-").toLowerCase();
      const blob = new Blob([lastSwarmOutput], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${stem}-${Date.now()}.md`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });

    // Trace console toggle
    document.getElementById("amkTraceToggle")?.addEventListener("click", () => {
      const tc = document.getElementById("amkTraceConsole");
      if (!tc) return;
      const exp = tc.classList.contains("expanded");
      tc.classList.toggle("collapsed", exp);
      tc.classList.toggle("expanded", !exp);
    });

    // Trace clear
    document.getElementById("amkTraceClearBtn")?.addEventListener("click", () => {
      const entries = document.getElementById("amkTraceEntries");
      if (entries) entries.innerHTML = "";
      const summary = document.getElementById("amkTraceSummary");
      if (summary) summary.textContent = "Cleared";
      updateTraceDot("idle");
    });

    // Export blueprint
    document.getElementById("amkExportBlueprintBtn")?.addEventListener("click", async () => {
      const bp = getActive();
      if (!bp) { await amkAlert("No active blueprint to export."); return; }
      const json = JSON.stringify(bp, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = (bp.name || "blueprint").replace(/\s+/g,"_") + ".json";
      a.click(); URL.revokeObjectURL(url);
    });

    // God Agent modal
    document.getElementById("amkGodBtn")?.addEventListener("click", openGodModal);
    document.getElementById("amkGodCancelBtn")?.addEventListener("click", () => {
      if (_godAbortCtrl) { _godAbortCtrl.abort(); _godAbortCtrl = null; }
      closeGodModal();
    });
    document.getElementById("amkGodGenerateBtn")?.addEventListener("click", runGodAgent);

    // God example chips
    document.querySelectorAll(".amk-god-example").forEach(chip => {
      chip.addEventListener("click", () => {
        const ta = document.getElementById("amkGodTextarea");
        if (ta) ta.value = chip.dataset.ex || "";
      });
    });

    // Close god modal on backdrop
    document.getElementById("amkGodModal")?.addEventListener("click", (e) => {
      if (e.target.id === "amkGodModal") closeGodModal();
    });

    // Event delegation for blueprint list (defensive — works even if inline
    // onclick attributes are blocked by Tauri's strict CSP webview)
    document.getElementById("amkBlueprintsList")?.addEventListener("click", (e) => {
      const renameBtn = e.target.closest("[data-bp-rename]");
      if (renameBtn) { e.stopPropagation(); _renameBp(renameBtn.dataset.bpRename); return; }
      const deleteBtn = e.target.closest("[data-bp-delete]");
      if (deleteBtn) { e.stopPropagation(); _deleteBp(deleteBtn.dataset.bpDelete); return; }
      const tplToggle = e.target.closest("[data-bp-tpl-toggle]");
      if (tplToggle) { _toggleTpl(); return; }
      const tplChip = e.target.closest("[data-bp-tpl-index]");
      if (tplChip) { _loadTemplate(parseInt(tplChip.dataset.bpTplIndex, 10)); return; }
      const card = e.target.closest("[data-bp-id]");
      if (card) { _selectBp(card.dataset.bpId); }
    });

    renderAll();
    // Restore task input for the initially active blueprint
    const bp = getActive();
    const taskEl = document.getElementById("amkTaskInput");
    if (taskEl && bp?.task != null) taskEl.value = bp.task;
  }

  return {
    mount,
    render: renderAll,
    _selectBp, _deleteBp, _loadTemplate, _renameBp, _toggleTpl,
    _peekCopyCode, _showProjectFile,
    _polisherDownload
  };

})();

window.SwarmMaker = SwarmMaker;

(window._registeredModes = window._registeredModes || {})["agent-maker"] = {
  label:     "Swarm",
  bodyClass: "agent-maker-mode",
  appClass:  null,
  fullscreen: true,
  btnId:     "tabAgentMaker",
  mount:     () => window.SwarmMaker?.mount?.(),
  destroy:   () => {},
};
