(function () {
  "use strict";

  const ROLE_COLORS = {
    structure: 0x4bd2be,
    surface: 0xf5c97a,
    detail: 0x8fb7ff,
    audit: 0xff8f8f,
  };

  const AGENTS = [
    { id: "god",      name: "Design",          role: "one call · designs the whole model", color: "#e7fbf7" },
    // Structure, Surface and Detail stood here, each appending parts to the
    // design the first call produced. Nothing owned the silhouette, so they
    // grew a pile rather than refining a model — and cost three more calls and
    // three more chances to hit a free-tier limit doing it. One design call,
    // then measurement, then Improve when a person asks for it.
    // There was an Audit Agent here, asked for clearance, balance and symmetry.
    // Those are measurements, so they moved to src/js/model-plan.js, which does
    // them on every run for no tokens and cannot be rate-limited. It was also
    // the stage that ADDED geometry — audit rings and marker planes — to a model
    // the user had asked for.
  ];

  let mounted = false;
  let initialized = false;
  let THREE = null;
  let OrbitControls = null;
  let TransformControls = null;
  let GLTFLoader = null;
  let GLTFExporter = null;
  let STLExporter = null;
  let OBJExporter = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let mountResizeObserver = null;
  let controls = null;
  let modelGroup = null;
  let particleGroup = null;
  let starField = null;
  let activePlan = null;
  let raf = 0;
  // True between the GPU taking the context away and giving it back. Nothing
  // may draw in between: the render target no longer exists.
  let contextLost = false;
  let flights = [];
  let revealMeshes = [];
  let logoMeshes = [];
  let logoBobT = 0;
  let scanMesh = null;
  let abortCtrl = null;
  let eventsWired = false;
  let traceStartTime = Date.now();
  let traceRunCount = 0;
  let raycaster = null;
  let pointer = null;
  let transformControls = null;
  let selectedMesh = null;
  let selectedObjectWhole = false;
  let selectionBox = null;
  let transformMode = "translate";
  let snapEnabled = false;
  let underfloorTick = 0;
  // Zero. The grid, the floor plane, "to floor" and the assembler in
  // src/js/model-plan.js all measure against this, and the assembler puts a
  // model's lowest point at zero — so any other value here would need every
  // generated model translated on its way into the scene, which is a
  // conversion nobody would remember to keep.
  const FLOOR_Y = 0;
  const MAX_FORGE_NODES = 96;
  const PROJECT_STORE_KEY = "hashui_forge_projects";
  const FORGE_BLOCKED_REFERENCE_DOMAINS = [
    "youtube.com",
    "youtu.be",
    "facebook.com",
    "instagram.com",
    "pinterest.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
  ];
  const FORGE_ALLOWED_MODEL_PROVIDERS = new Set(["groq", "gemini", "cerebras", "samba", "sambanova", "openrouter", "local"]);
  const FORGE_PROVIDER_COOLDOWNS = new Map();
  let forgeProjects = [];
  let activeProjectId = null;
  let projectSaveTimer = 0;
  let activeReferenceBrief = "";
  let activeForgeRoute = "parametric";

  const $ = (id) => document.getElementById(id);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  function loadForgeProjects() {
    try {
      const raw = localStorage.getItem(PROJECT_STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      forgeProjects = Array.isArray(parsed) ? parsed.filter((p) => p && Array.isArray(p.plan?.nodes)) : [];
    } catch {
      forgeProjects = [];
    }
  }

  function persistForgeProjects() {
    try { localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(forgeProjects.slice(0, 40))); } catch {}
  }

  function projectNameFromPrompt(prompt, plan) {
    const src = String(prompt || plan?.name || "Forge Project").trim().replace(/\s+/g, " ");
    return src.split(" ").slice(0, 4).join(" ") || "Forge Project";
  }

  function currentModelRoutes() {
    return AGENTS.map((agent) => ({
      id: agent.id,
      value: $(`frgModel_${agent.id}`)?.value || "",
      label: modelLabel($(`frgModel_${agent.id}`)?.value || ""),
    }));
  }

  function forgePrefs() {
    const style = $("frgStyle")?.value || "realistic";
    const detail = $("frgDetail")?.value || "balanced";
    const output = $("frgOutputTarget")?.value || "glb";
    return { style, detail, output };
  }

  function updateStage(stage, state, text) {
    document.querySelectorAll("[data-frg-stage]").forEach((el) => {
      const isTarget = el.dataset.frgStage === stage;
      if (isTarget) {
        el.classList.toggle("active", state !== "done");
        el.classList.toggle("done", state === "done");
        const label = el.querySelector("span");
        if (label) label.textContent = text || state || "waiting";
      } else if (state === "active") {
        el.classList.remove("active");
      }
    });
  }

  function resetStages() {
    ["input", "generate", "refine", "export"].forEach((stage, i) => {
      const el = document.querySelector(`[data-frg-stage="${stage}"]`);
      if (!el) return;
      el.classList.toggle("active", i === 0);
      el.classList.remove("done");
      const label = el.querySelector("span");
      if (label) label.textContent = i === 0 ? "prompt ready" : "waiting";
    });
  }

  function restoreModelRoutes(routes) {
    if (!Array.isArray(routes)) return;
    routes.forEach((route) => {
      const sel = $(`frgModel_${route.id}`);
      if (sel && Array.from(sel.options).some((o) => o.value === route.value)) sel.value = route.value || "";
    });
  }

  function renderForgeProjects() {
    const host = $("frgProjectsList");
    if (!host) return;
    if (!forgeProjects.length) {
      host.innerHTML = `<div class="frg-project-empty">Saved Forge projects will appear here.</div>`;
      return;
    }
    host.innerHTML = forgeProjects.map((project) => `
      <div class="frg-project-card${project.id === activeProjectId ? " active" : ""}" data-frg-project="${escapeHtml(project.id)}">
        <div class="frg-project-name">${escapeHtml(project.name || "Forge Project")}</div>
        <div class="frg-project-meta">${escapeHtml(project.route || project.plan?.route || "parametric")} · ${escapeHtml((project.plan?.nodes?.length || 0) + " mesh parts")} · ${escapeHtml(new Date(project.updatedAt || project.createdAt || Date.now()).toLocaleDateString())}</div>
        <div class="frg-project-prompt">${escapeHtml(project.prompt || project.plan?.name || "")}</div>
        <button class="frg-project-delete" data-frg-project-delete="${escapeHtml(project.id)}" title="Delete project">×</button>
      </div>
    `).join("");
  }

  function saveCurrentProject(manual) {
    if (!activePlan?.nodes?.length) {
      if (manual) log("Projects", "No Forge object to save yet", "warn");
      return null;
    }
    const now = Date.now();
    const prompt = ($("frgPrompt")?.value || activePlan.name || "").trim();
    let project = forgeProjects.find((p) => p.id === activeProjectId);
    if (!project) {
      project = {
        id: "forge_" + now.toString(36),
        name: projectNameFromPrompt(prompt, activePlan),
        createdAt: now,
      };
      forgeProjects.unshift(project);
      activeProjectId = project.id;
    }
    project.updatedAt = now;
    project.prompt = prompt;
    project.plan = cloneJson(activePlan);
    project.route = activePlan.route || activeForgeRoute || "parametric";
    project.routes = currentModelRoutes();
    project.name = project.name || projectNameFromPrompt(prompt, activePlan);
    persistForgeProjects();
    renderForgeProjects();
    if (manual) log("Projects", `Saved ${project.name}`, "ok", `${project.plan.nodes.length} mesh parts`);
    return project;
  }

  function queueProjectSave() {
    if (!activePlan?.nodes?.length) return;
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => saveCurrentProject(false), 450);
  }

  function newForgeProject() {
    activeProjectId = null;
    if ($("frgPrompt")) $("frgPrompt").value = "";
    clearScene();
    activePlan = null;
    updatePlanList(null);
    renderSelection();
    renderForgeProjects();
    setStatus("Idle");
    log("Projects", "New Forge project ready", "wait");
  }

  function openForgeProject(id) {
    const project = forgeProjects.find((p) => p.id === id);
    if (!project) return;
    activeProjectId = project.id;
    if ($("frgPrompt")) $("frgPrompt").value = project.prompt || project.plan?.name || "";
    restoreModelRoutes(project.routes);
    buildPlan(project.plan);
    renderForgeProjects();
    log("Projects", `Opened ${project.name || "Forge Project"}`, "ok", `${project.plan.nodes.length} mesh parts`);
  }

  function deleteForgeProject(id) {
    const project = forgeProjects.find((p) => p.id === id);
    if (!project) return;
    if (!confirm(`Delete "${project.name || "Forge Project"}"?`)) return;
    forgeProjects = forgeProjects.filter((p) => p.id !== id);
    if (activeProjectId === id) activeProjectId = null;
    persistForgeProjects();
    renderForgeProjects();
    log("Projects", "Deleted Forge project", "warn");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function setStatus(text) {
    const el = $("frgStatus");
    if (el) el.textContent = text || "Idle";
  }

  function traceKind(kind) {
    if (kind === "err") return "error";
    if (kind === "ok") return "done";
    if (kind === "boss" || kind === "run" || kind === "wait" || kind === "warn") return "running";
    return "";
  }

  function log(label, message, kind, tokens) {
    const host = $("frgTraceEntries");
    if (!host) return;
    const statusCls = kind || "wait";
    const elapsed = ((Date.now() - traceStartTime) / 1000).toFixed(1);
    const line = document.createElement("div");
    line.className = "frg-trace-entry";
    line.innerHTML =
      `<span class="trace-time">[${elapsed}s]</span>` +
      `<span class="trace-agent trace-${statusCls}">${escapeHtml(label)}</span>` +
      `<span class="trace-msg trace-${statusCls}">${escapeHtml(message)}</span>` +
      (tokens ? `<span class="trace-tokens">${escapeHtml(String(tokens))}</span>` : "");
    host.appendChild(line);
    host.scrollTop = host.scrollHeight;
    const summary = $("frgTraceSummary");
    if (summary) summary.textContent = `${label}: ${message}`;
    const dot = $("frgTraceDot");
    if (dot) dot.className = "frg-trace-dot " + traceKind(statusCls);
  }

  // The trace as plain text, in the order it happened. One reader for both the
  // clipboard and the file, so the two can never drift apart.
  function traceAsText() {
    const host = $("frgTraceEntries");
    if (!host) return "";
    const lines = Array.from(host.querySelectorAll(".frg-trace-entry")).map((row) => {
      const cell = (sel) => (row.querySelector(sel)?.textContent || "").trim();
      const tokens = cell(".trace-tokens");
      return [cell(".trace-time"), cell(".trace-agent"), cell(".trace-msg"), tokens]
        .filter(Boolean).join("  ");
    });
    if (!lines.length) return "";
    const header = `3D Forge trace  ·  ${new Date().toLocaleString()}`;
    return [header, "=".repeat(header.length), "", ...lines, ""].join("\n");
  }

  function setAgentState(id, state) {
    const el = document.querySelector(`[data-frg-agent="${id}"] .frg-agent-state`);
    if (el) el.textContent = state;
  }

  function renderAgents() {
    const host = $("frgAgents");
    if (!host) return;
    const options = modelOptionsHtml();
    host.innerHTML = AGENTS.map((agent) => `
      <div class="frg-agent" data-frg-agent="${agent.id}">
        <span class="frg-agent-dot" style="color:${agent.color};background:${agent.color}"></span>
        <span>
          <span class="frg-agent-name">${escapeHtml(agent.name)}</span>
          <span class="frg-agent-role">${escapeHtml(agent.role)}</span>
        </span>
        <span class="frg-agent-state">idle</span>
        <select class="frg-agent-model" id="frgModel_${agent.id}" title="${escapeHtml(agent.name)} model">
          ${options}
        </select>
      </div>
    `).join("");
  }

  function modelOptionsHtml() {
    const src = document.getElementById("model");
    const current = src?.value || "";
    const sourceOptions = Array.from(src?.options || []);
    if (!sourceOptions.length) return `<option value="">Main model</option>`;
    return [
      `<option value="">Main model (${escapeHtml(src.options[src.selectedIndex]?.textContent || current || "selected")})</option>`,
      ...sourceOptions.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.textContent || opt.value)}</option>`),
    ].join("");
  }

  function syncModelSelectors() {
    const old = {};
    AGENTS.forEach((agent) => {
      old[agent.id] = $(`frgModel_${agent.id}`)?.value || "";
    });
    renderAgents();
    AGENTS.forEach((agent) => {
      const sel = $(`frgModel_${agent.id}`);
      if (sel && old[agent.id] && Array.from(sel.options).some((o) => o.value === old[agent.id])) {
        sel.value = old[agent.id];
      }
    });
  }

  function isFreeModel(value, label) {
    return /:free|\bfree\b/.test(`${value || ""} ${label || ""}`.toLowerCase());
  }

  function modelSizeScore(value, label) {
    const s = `${value || ""} ${label || ""}`.toLowerCase();
    let best = 0;
    for (const match of s.matchAll(/(\d+(?:\.\d+)?)\s*b\b/g)) {
      best = Math.max(best, Number(match[1]) || 0);
    }
    if (/gpt[-_\s]?oss.*120|120.*gpt[-_\s]?oss/.test(s)) best = Math.max(best, 120);
    if (/405b|480b|671b/.test(s)) best = Math.max(best, Number((s.match(/(405|480|671)b/) || [0, 0])[1]) || 0);
    return best;
  }

  function modelStrengthScore(value, label, bigTask) {
    const s = `${value || ""} ${label || ""}`.toLowerCase();
    let score = 0;
    const size = modelSizeScore(value, label);
    if (/gpt[-_\s]?oss/.test(s)) score += 95;
    if (/pro|opus|sonnet|gpt-4|gpt-5|o3|o4|r1|v3|405b|235b|120b|70b|large|max|maverick|nemotron|hermes|qwen3|deepseek/.test(s)) score += 70;
    if (size >= 120) score += 52;
    else if (size >= 100) score += 38;
    else if (size >= 70) score += bigTask ? 12 : 18;
    if (size > 0 && size < 70) score -= bigTask ? 18 : 8;
    if (/coder|code|dev|reason|thinking|instruct|chat/.test(s)) score += 18;
    if (/vision|vl|multi/.test(s)) score += 10;
    if (/flash|lite|mini|small|tiny|1b|1.5b|3b|7b|8b|instant/.test(s)) score -= bigTask ? 35 : 12;
    if (isFreeModel(value, label)) score -= bigTask ? 28 : 10;
    if (/local/.test(s)) score -= bigTask ? 12 : 0;
    if (/nvidia|samba|openrouter|gemini|groq|cerebras/.test(s)) score += 8;
    return score;
  }

  function bestModelForProvider(options, bigTask) {
    return [...options].sort((a, b) =>
      modelStrengthScore(b.value, b.label, bigTask) - modelStrengthScore(a.value, a.label, bigTask)
    )[0] || null;
  }

  function providerFromValue(value) {
    return value && value.startsWith("cloud:") ? value.split(":")[1] : "local";
  }

  function providerDisplayName(provider) {
    const name = String(provider || "model").replace(/^sambanova$/i, "SambaNova");
    if (name === "SambaNova") return name;
    return name.replace(/(^|[-_\s])([a-z])/g, (_, sep, c) => `${sep}${c.toUpperCase()}`);
  }

  function forgeProviderCooldown(provider) {
    const key = String(provider || "");
    const entry = FORGE_PROVIDER_COOLDOWNS.get(key);
    if (!entry) return null;
    if (entry.until <= Date.now()) {
      FORGE_PROVIDER_COOLDOWNS.delete(key);
      return null;
    }
    return entry;
  }

  function isForgeRoutingError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return /rate.?limit|quota|429|too many|free.?tier|api.?key|unauthori[sz]ed|forbidden|billing|credit|capacity|overloaded|unavailable|service.?unavailable|timed?.?out|timeout|failed to fetch|network|model.{0,16}not.{0,16}found|not configured|invalid key|missing key/.test(msg)
      || err?.name === "AbortError";
  }

  function cooldownMsForForgeError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (/api.?key|invalid key|missing key|unauthori[sz]ed|forbidden|not configured/.test(msg)) return 10 * 60 * 1000;
    if (/rate.?limit|quota|429|too many|free.?tier|billing|credit/.test(msg)) return 90 * 1000;
    if (/timed?.?out|timeout|capacity|overloaded|unavailable|failed to fetch|network/.test(msg) || err?.name === "AbortError") return 45 * 1000;
    return 0;
  }

  function markForgeProviderFailure(provider, err) {
    if (!provider || !isForgeRoutingError(err)) return;
    const ms = cooldownMsForForgeError(err);
    if (!ms) return;
    const until = Date.now() + ms;
    const existing = forgeProviderCooldown(provider);
    if (existing && existing.until >= until) return;
    const reason = String(err?.message || err || "route failed").replace(/\s+/g, " ").slice(0, 82);
    FORGE_PROVIDER_COOLDOWNS.set(String(provider), { until, reason });
    log("Router", `Cooling down ${providerDisplayName(provider)} for ${Math.ceil(ms / 1000)}s`, "warn", reason);
  }

  function skipCoolingCandidate(candidate, candidates) {
    const healthyExists = candidates.some((route) => route?.provider && !forgeProviderCooldown(route.provider));
    const cooldown = candidate?.provider ? forgeProviderCooldown(candidate.provider) : null;
    if (!healthyExists || !cooldown) return false;
    const seconds = Math.max(1, Math.ceil((cooldown.until - Date.now()) / 1000));
    log("Router", `Skipping ${providerDisplayName(candidate.provider)} route (${seconds}s cooldown)`, "wait", cooldown.reason || "");
    return true;
  }

  function providerModelsForForge(bigTask, options = {}) {
    const includeCooling = !!options.includeCooling;
    const allOpts = Array.from(document.getElementById("model")?.options || [])
      .map((o) => ({ value: o.value, label: o.textContent || o.label || o.value }))
      .filter((o) => {
        const provider = providerFromValue(o.value);
        return o.value && !o.disabled && !o.value.startsWith("─") && (includeCooling || !forgeProviderCooldown(provider));
      });
    const providerOptions = {};
    allOpts.forEach((o) => {
      const provider = providerFromValue(o.value);
      if (!providerOptions[provider]) providerOptions[provider] = [];
      providerOptions[provider].push(o);
    });
    const ranked = Object.entries(providerOptions)
      .map(([provider, options]) => {
        const best = bestModelForProvider(options, bigTask);
        return [provider, best?.value || options[0]?.value || "", best?.label || options[0]?.label || ""];
      })
      .filter(([, value]) => value)
      .sort((a, b) => modelStrengthScore(b[1], b[2], bigTask) - modelStrengthScore(a[1], a[2], bigTask));
    if (!ranked.length && !includeCooling) return providerModelsForForge(bigTask, { includeCooling: true });
    return ranked;
  }

  function autoAssignForgeModels(prompt, force) {
    const providerModels = providerModelsForForge(true);
    const nonFreeProviderModels = providerModels.filter(([, value, label]) => !isFreeModel(value, label));
    if (!providerModels.length) {
      log("Parameter Agent", "No model options available for auto-routing", "warn");
      return;
    }
    const roleProviderPreference = {
      god: ["openrouter", "cerebras", "samba", "gemini", "groq", "local"],
      structure: ["openrouter", "cerebras", "samba", "gemini", "groq", "local"],
      surface: ["gemini", "openrouter", "samba", "groq", "cerebras", "local"],
      detail: ["openrouter", "cerebras", "gemini", "samba", "groq", "local"],
      audit: ["openrouter", "cerebras", "samba", "gemini", "groq", "local"],
    };
    const used = new Set();
    const usedValues = new Set();
    const assigned = [];
    for (const agent of AGENTS) {
      const sel = $(`frgModel_${agent.id}`);
      if (!sel) continue;
      const currentProvider = providerFromValue(sel.value);
      const currentLabel = sel.options[sel.selectedIndex]?.textContent || "";
      const currentCooling = forgeProviderCooldown(currentProvider);
      if (!force && sel.value && !used.has(currentProvider) && !isFreeModel(sel.value, currentLabel) && !currentCooling) {
        used.add(currentProvider);
        usedValues.add(sel.value);
        continue;
      }
      const preferred = roleProviderPreference[agent.id] || roleProviderPreference.god;
      const bigEnough = nonFreeProviderModels.filter(([, value, label]) => modelSizeScore(value, label) >= 120);
      const replacement =
        preferred.map((p) => bigEnough.find(([provider]) => provider === p && !used.has(provider))).find(Boolean) ||
        bigEnough.find(([provider]) => !used.has(provider)) ||
        preferred.map((p) => bigEnough.find(([provider, value]) => provider === p && !usedValues.has(value))).find(Boolean) ||
        bigEnough.find(([, value]) => !usedValues.has(value)) ||
        preferred.map((p) => nonFreeProviderModels.find(([provider]) => provider === p && !used.has(provider))).find(Boolean) ||
        nonFreeProviderModels.find(([provider]) => !used.has(provider)) ||
        preferred.map((p) => nonFreeProviderModels.find(([provider, value]) => provider === p && !usedValues.has(value))).find(Boolean) ||
        nonFreeProviderModels.find(([, value]) => !usedValues.has(value)) ||
        nonFreeProviderModels[0] ||
        preferred.map((p) => providerModels.find(([provider]) => provider === p && !used.has(provider))).find(Boolean) ||
        providerModels.find(([provider]) => !used.has(provider)) ||
        providerModels[0];
      if (replacement && Array.from(sel.options).some((o) => o.value === replacement[1])) {
        sel.value = replacement[1];
        used.add(replacement[0]);
        usedValues.add(replacement[1]);
        assigned.push(`${agent.name} → ${replacement[2] || replacement[1]}`);
      }
    }
    if (assigned.length) {
      log("Parameter Agent", `Auto-assigned ${assigned.length} model route(s)`, "boss");
      assigned.forEach((line) => log("Router", line, "wait"));
    }
  }

  function selectedModelFor(agentId) {
    return $(`frgModel_${agentId}`)?.value || window._H?.selectedModel?.() || document.getElementById("model")?.value || "";
  }

  function modelLabel(value) {
    if (!value) return "main model";
    const opt = Array.from(document.getElementById("model")?.options || []).find((o) => o.value === value);
    return (opt?.textContent || value).replace(/\s+/g, " ").slice(0, 42);
  }

  function updatePlanList(plan) {
    const host = $("frgPlanList");
    if (!host) return;
    const nodes = renderableNodes(plan?.nodes || []);
    host.innerHTML = nodes.length ? nodes.map((node) => `
      <div class="frg-plan-item${selectedMesh?.userData?.nodeId === node.id ? " selected" : ""}" data-node-id="${escapeHtml(node.id || "")}">
        <b>${escapeHtml(node.name || node.id || node.type)}</b>
        <span>${escapeHtml(node.role || "structure")} · ${escapeHtml(node.type || "box")}</span>
      </div>
    `).join("") : `<div class="frg-plan-item"><b>No mesh yet</b><span>Awaiting Parameter Agent</span></div>`;
    $("frgPlanName").textContent = plan?.name || "Void ready";
    $("frgNodeCount").textContent = `${nodes.length} mesh part${nodes.length === 1 ? "" : "s"}`;
  }

  function renderableNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : []).filter((node) => node && node.role !== "audit");
  }

  async function initThree() {
    if (initialized) return true;
    const mount = $("frgCanvasMount");
    if (!mount) return false;

    setStatus("Loading");
    log("SYSTEM", "Loading Three.js runtime...");
    try {
      // All four load from disk. They came from a CDN, which meant 3D Forge
      // did not work at all with the network off — while the README called the
      // app air-gapped capable — and it contradicted the rule in
      // ARCHITECTURE.md that libraries are vendored, never fetched at runtime.
      const threeMod = await import("/js/vendor/three/three.module.min.js");
      const controlsMod = await import("/js/vendor/three/examples/OrbitControls.js");
      const transformMod = await import("/js/vendor/three/examples/TransformControls.js");
      const roomEnvMod = await import("/js/vendor/three/examples/RoomEnvironment.js");
      THREE = threeMod;
      OrbitControls = controlsMod.OrbitControls;
      TransformControls = transformMod.TransformControls;
      window.__forgeRoomEnv = roomEnvMod.RoomEnvironment;
    } catch (err) {
      log("SYSTEM", "Could not load the 3D runtime: " + (err.message || err), "err");
      setStatus("3D error");
      return false;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.FogExp2(0x050505, 0.055);

    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
    camera.position.set(6, 4.2, 8);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    // PBR environment map — gives MeshStandardMaterial proper reflections + specular
    try {
      const pmremGen = new THREE.PMREMGenerator(renderer);
      pmremGen.compileEquirectangularShader();
      scene.environment = pmremGen.fromScene(new window.__forgeRoomEnv(), 0.04).texture;
      pmremGen.dispose();
    } catch (err) {
      log("SYSTEM", "Env map unavailable: " + (err.message || err), "warn");
    }

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    if ("zoomToCursor" in controls) controls.zoomToCursor = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.target.set(0, 0.55, 0);

    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode(transformMode);
    transformControls.setSize(0.82);
    setSnapEnabled(false);
    transformControls.addEventListener("dragging-changed", (event) => {
      if (controls) controls.enabled = !event.value;
    });
    transformControls.addEventListener("objectChange", () => {
      syncSelectedNodeFromMesh();
      renderSelection();
    });
    if (typeof transformControls.getHelper === "function") scene.add(transformControls.getHelper());
    else scene.add(transformControls);
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    renderer.domElement.addEventListener("click", handleCanvasClick);
    renderer.domElement.addEventListener("dblclick", handleCanvasDoubleClick);
    renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

    modelGroup = new THREE.Group();
    particleGroup = new THREE.Group();
    scene.add(modelGroup, particleGroup);

    const key = new THREE.DirectionalLight(0xdffbf5, 2.1);
    key.position.set(6, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 40;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4bd2be, 1.2);
    rim.position.set(-6, 3, -5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x6a8f8a, 0.45));
    scene.add(new THREE.HemisphereLight(0xb0d9d2, 0x1a1410, 0.5));

    const grid = new THREE.GridHelper(18, 36, 0xffffff, 0xffffff);
    grid.position.y = FLOOR_Y;
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18, 36, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y - 0.001;   // a hair under the grid, so the lines stay visible
    floor.receiveShadow = true;
    scene.add(floor);

    starField = makeStarField();
    scene.add(starField);

    window.addEventListener("resize", resize);

    // The window is not the only thing that changes this canvas's size. The
    // trace drawer animates from 32px to 200px, panels collapse, the inspector
    // opens — none of those raise a window resize, so the camera kept an aspect
    // ratio for a box it no longer occupied and the model came out stretched.
    // Watching the mount catches every one of them, including the frames of a
    // CSS transition, which is what keeps the picture honest while the drawer
    // slides rather than only once it lands.
    try {
      const mount = $("frgCanvasMount");
      if (mount && window.ResizeObserver) {
        mountResizeObserver?.disconnect();
        mountResizeObserver = new ResizeObserver(() => resize());
        mountResizeObserver.observe(mount);
      }
    } catch {}
    wireContextLoss();
    resize();
    initialized = true;
    startLoop();
    setStatus("Idle");
    log("SYSTEM", "Forge void is online.");
    return true;
  }

  /**
   * Survive the GPU taking the drawing context away.
   *
   * A WebGL context is not owned by the page. The system reclaims it when the
   * GPU comes under pressure or the app sits in the background, and this one
   * was built with `alpha: false` and no handler — so when that happened the
   * canvas went opaque white and stayed there. Nothing else broke: the panel
   * still counted parts, clicks still logged, the render loop still ran and
   * drew into a dead context. Only the picture was gone, permanently, until
   * the mode was rebuilt from scratch.
   *
   * That is what a Forge that stops previewing after being left alone looks
   * like, and it explains why the viewport can be blank while the trace says
   * a model was loaded.
   *
   * The browser only offers a restore if the default is prevented, so that
   * call is what makes recovery possible rather than a courtesy.
   */
  function wireContextLoss() {
    const canvas = renderer?.domElement;
    if (!canvas || canvas.dataset.frgContextWired) return;
    canvas.dataset.frgContextWired = "1";

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      stopLoop();
      setStatus("Paused");
      log("Viewport", "The system took the 3D context back — restoring", "warn");
    });

    canvas.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      try {
        // three.js rebuilds its own GPU state on the next frame, but every
        // texture and buffer it had is gone, so the scene is built again from
        // the plan rather than assumed to have survived.
        renderer.resetState?.();
        const plan = activePlan;
        if (plan) buildPlan(plan);
        resize();
        startLoop();
        log("Viewport", "3D context restored", "ok");
        setStatus("Ready");
      } catch (err) {
        log("Viewport", `Could not restore the 3D context: ${err.message || err}`, "err");
        setStatus("Failed");
      }
    });
  }

  function makeStarField() {
    const count = 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 18 + Math.random() * 38;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9ff4e7,
      size: 0.022,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  function resize() {
    const mount = $("frgCanvasMount");
    if (!renderer || !camera || !mount) return;
    const rect = mount.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  // Come back to life when the window does.
  try {
    window.HCPower?.onChange(({ visible }) => { if (visible && mounted) startLoop(); });
  } catch {}

  /** Start the render loop if it is not already running. */
  function startLoop() {
    // The context check belongs here rather than at each caller — the power
    // handler restarts the loop whenever the window becomes visible, and that
    // would otherwise resume drawing into a context that is gone.
    if (raf || contextLost) return;
    raf = requestAnimationFrame(animate);
  }

  /** Stop the render loop. Safe to call when it is already stopped. */
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function animate(now) {
    // The loop used to re-schedule itself here, unconditionally, and nothing
    // ever cancelled it — `raf` was assigned and never read. So once Forge had
    // been opened once, the app woke sixty times a second for the rest of its
    // life, on every other tab, doing nothing but scheduling itself again.
    //
    // Now the chain simply ends when there is nothing to draw, and startLoop()
    // restarts it. `raf = 0` marks it stopped so a restart cannot double up.
    if (!renderer || !scene || !camera || !mounted || contextLost || !window.HCPower?.isVisible()) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(animate);
    controls?.update();
    if (starField) starField.rotation.y += 0.00018;
    if (logoMeshes.length > 0) {
      logoBobT += 0.006;
      const bob  = Math.sin(logoBobT) * 0.16;
      const sway = Math.sin(logoBobT * 0.55) * 0.05;
      const pulse = 1 + Math.sin(logoBobT * 1.3) * 0.012;
      for (const m of logoMeshes) {
        m.position.y = m.userData.logoBaseY + bob;
        m.rotation.y = sway;
        m.scale.set(pulse, pulse, 1);
      }
    }
    if (selectionBox && selectedMesh) selectionBox.update();
    updateFlights(now || performance.now());
    updateReveal(now || performance.now());
    if (++underfloorTick % 8 === 0) updateUnderfloorHighlights();
    renderer.render(scene, camera);
  }

  function clearScene() {
    selectMesh(null);
    flights.forEach((f) => particleGroup.remove(f.mesh));
    flights = [];
    revealMeshes = [];
    logoMeshes = [];
    logoBobT = 0;
    if (scanMesh) {
      scene?.remove(scanMesh);
      scanMesh.geometry?.dispose();
      scanMesh.material?.dispose();
      scanMesh = null;
    }
    if (modelGroup) {
      while (modelGroup.children.length) {
        const obj = modelGroup.children.pop();
        obj.traverse?.((child) => {
          child.geometry?.dispose?.();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
          else child.material?.dispose?.();
        });
      }
    }
    if (particleGroup) {
      while (particleGroup.children.length) {
        const obj = particleGroup.children.pop();
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      }
    }
  }

  function primitiveGeometry(node) {
    const p = node.params || {};
    switch (node.type) {
      case "logo":
      case "logo_img":
        return new THREE.PlaneGeometry(p.width ?? 2.1, p.height ?? 2.1);
      case "mesh":
        return meshGeometryFromParams(p);
      case "cylinder":
        return new THREE.CylinderGeometry(p.radiusTop ?? p.radius ?? 0.35, p.radiusBottom ?? p.radius ?? 0.35, p.height ?? 1, p.segments ?? 48);
      case "capsule":
        return new THREE.CapsuleGeometry(p.radius ?? 0.12, p.length ?? p.height ?? 0.6, p.capSegments ?? 16, p.radialSegments ?? 32);
      case "sphere":
        return new THREE.SphereGeometry(p.radius ?? 0.45, p.widthSegments ?? 48, p.heightSegments ?? 32);
      case "cone":
        return new THREE.ConeGeometry(p.radius ?? 0.42, p.height ?? 1, p.segments ?? 48);
      case "torus":
        return new THREE.TorusGeometry(p.radius ?? 0.5, p.tube ?? 0.08, 24, 64);
      case "lathe": {
        const pts = Array.isArray(p.points) && p.points.length >= 2
          ? p.points.map((pt) => new THREE.Vector2(Number(pt[0]) || 0.1, Number(pt[1]) || 0))
          : [new THREE.Vector2(0.18, -0.55), new THREE.Vector2(0.42, -0.2), new THREE.Vector2(0.34, 0.42), new THREE.Vector2(0.08, 0.65)];
        return new THREE.LatheGeometry(pts, p.segments ?? 64);
      }
      case "extrude": {
        const pts = Array.isArray(p.points) && p.points.length >= 3
          ? p.points.map((pt) => [Number(pt[0]) || 0, Number(pt[1]) || 0])
          : [[-0.35, -0.25], [0.35, -0.25], [0.42, 0.2], [0, 0.45], [-0.42, 0.2]];
        const shape = new THREE.Shape();
        shape.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
        shape.closePath();
        return new THREE.ExtrudeGeometry(shape, { depth: p.depth ?? 0.18, bevelEnabled: true, bevelSize: p.bevelSize ?? 0.025, bevelThickness: p.bevelThickness ?? 0.025, bevelSegments: p.bevelSegments ?? 2 });
      }
      default:
        return new THREE.BoxGeometry(p.width ?? 1, p.height ?? 1, p.depth ?? 1);
    }
  }

  function meshGeometryFromParams(p) {
    const geo = new THREE.BufferGeometry();
    const positions = Array.isArray(p.positions) ? p.positions : [];
    if (positions.length < 9) return new THREE.BoxGeometry(0.4, 0.4, 0.4);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (Array.isArray(p.normals) && p.normals.length === positions.length) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(p.normals, 3));
    }
    if (Array.isArray(p.uvs) && p.uvs.length >= (positions.length / 3) * 2) {
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(p.uvs, 2));
    }
    if (Array.isArray(p.indices) && p.indices.length >= 3) {
      geo.setIndex(p.indices);
    }
    return finalizeGeometry(geo, p);
  }

  function finalizeGeometry(geometry, params) {
    if (!geometry) return geometry;
    const p = params || {};
    const subdivisions = Math.min(2, Math.max(0, Number(p.subdivisions) || 0));
    let geo = geometry;
    for (let i = 0; i < subdivisions; i++) geo = subdivideGeometry(geo);
    if (p.center) geo.center();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  function subdivideGeometry(source) {
    const base = source.index ? source.toNonIndexed() : source.clone();
    const pos = base.getAttribute("position");
    if (!pos || pos.count > 12000) return base;
    const next = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const bc = new THREE.Vector3();
    const ca = new THREE.Vector3();
    const push = (v) => next.push(v.x, v.y, v.z);
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      ab.copy(a).lerp(b, 0.5);
      bc.copy(b).lerp(c, 0.5);
      ca.copy(c).lerp(a, 0.5);
      push(a); push(ab); push(ca);
      push(ab); push(b); push(bc);
      push(ca); push(bc); push(c);
      push(ab); push(bc); push(ca);
    }
    base.dispose?.();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(next, 3));
    return geo;
  }

  function makeLogoMaterial(node) {
    const p = node.params || {};
    const size = 1536;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = p.text || "H";
    const family = `"Great Vibes", cursive`;
    let fontSize = p.fontSize || 860;
    let metrics = null;
    for (let i = 0; i < 18; i++) {
      ctx.font = `${fontSize}px ${family}`;
      metrics = ctx.measureText(text);
      const w = Math.abs(metrics.actualBoundingBoxLeft || 0) + Math.abs(metrics.actualBoundingBoxRight || metrics.width);
      const h = Math.abs(metrics.actualBoundingBoxAscent || fontSize * 0.8) + Math.abs(metrics.actualBoundingBoxDescent || fontSize * 0.25);
      if (w <= size * 0.72 && h <= size * 0.68) break;
      fontSize *= 0.92;
    }
    ctx.lineWidth = p.strokeWidth || 18;
    ctx.strokeStyle = p.stroke || "rgba(5,12,11,0.82)";
    ctx.fillStyle = p.fill || "#c9a96e";
    ctx.shadowColor = p.glow || "rgba(201,169,110,0.82)";
    ctx.shadowBlur = p.shadowBlur || 34;
    metrics = metrics || ctx.measureText(text);
    const glyphCenterOffsetX = ((metrics.actualBoundingBoxRight || metrics.width / 2) - (metrics.actualBoundingBoxLeft || metrics.width / 2)) / 2;
    const glyphCenterOffsetY = ((metrics.actualBoundingBoxDescent || fontSize * 0.2) - (metrics.actualBoundingBoxAscent || fontSize * 0.8)) / 2;
    const x = size * 0.5 - glyphCenterOffsetX;
    const y = size * 0.53 - glyphCenterOffsetY;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat.userData.logoTexture = texture;
    return mat;
  }

  function makeImageLogoMaterial(node) {
    const p = node.params || {};
    const loader = new THREE.TextureLoader();
    const texture = loader.load(p.src || "/assets/hashcortx-logo.png");
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: texture,
      color: new THREE.Color(node.color || "#ffffff"),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  function buildScanlineMesh(baseY) {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0,    "rgba(75,210,190,0)");
    grad.addColorStop(0.38, "rgba(75,210,190,0)");
    grad.addColorStop(0.5,  "rgba(75,210,190,0.85)");
    grad.addColorStop(0.62, "rgba(75,210,190,0)");
    grad.addColorStop(1,    "rgba(75,210,190,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(3.2, 0.22);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, baseY, 0.02);
    mesh.userData.scanBaseY = baseY;
    return mesh;
  }

  function addNodeMesh(node, index, total) {
    const color = node.color ? new THREE.Color(node.color) : new THREE.Color(ROLE_COLORS[node.role] || ROLE_COLORS.structure);
    const mat = node.type === "logo"
      ? makeLogoMaterial(node)
      : node.type === "logo_img"
      ? makeImageLogoMaterial(node)
      : new THREE.MeshStandardMaterial({
        color,
        roughness: 0.42,
        metalness: node.role === "detail" ? 0.55 : 0.28,
        transparent: true,
        opacity: 0,
        emissive: color,
        emissiveIntensity: 0.08,
      });
    if (mat.emissive) {
      mat.userData.baseEmissive = color.clone();
      mat.userData.baseEmissiveIntensity = 0.08;
    }
    // Tier 2: auto-subdivide surface-role organic primitives when AI didn't specify
    let geoParams = node.params || {};
    if (geoParams.subdivisions == null
        && node.role === "surface"
        && ["extrude", "lathe", "mesh", "capsule"].includes(node.type)) {
      geoParams = Object.assign({}, geoParams, { subdivisions: 1 });
    }
    const mesh = new THREE.Mesh(finalizeGeometry(primitiveGeometry(node), geoParams), mat);
    // Tier 4: shadows for all real meshes (skip flat logo planes)
    if (node.type !== "logo" && node.type !== "logo_img") {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    const pos = node.position || [0, 0, 0];
    const rot = node.rotation || [0, 0, 0];
    const scale = node.scale || [1, 1, 1];
    mesh.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    mesh.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
    mesh.userData.node = node;
    mesh.userData.nodeId = node.id;
    mesh.userData.selectable = true;
    mesh.userData.originalTransform = {
      position: mesh.position.clone(),
      rotation: mesh.rotation.clone(),
      scale: mesh.scale.clone(),
    };
    mesh.name = node.name || node.id || "Forge part";
    modelGroup.add(mesh);
    if (node.type === "logo_img") {
      mesh.userData.logoBaseY = mesh.position.y;
      logoMeshes.push(mesh);
    }
    revealMeshes.push({ mesh, start: performance.now() + index * 90, duration: 760, targetOpacity: node.opacity ?? (node.type === "mesh" ? 0.98 : 0.86) });
    spawnFlightsTo(mesh.position, node.role || "structure", Math.max(10, Math.floor(34 / Math.max(1, total / 8))));
  }

  function updateUnderfloorHighlights() {
    if (!THREE || !modelGroup) return;
    const box = new THREE.Box3();
    selectableMeshes().forEach((mesh) => {
      box.setFromObject(mesh);
      const under = !box.isEmpty() && box.min.y < FLOOR_Y - 0.01;
      const mat = mesh.material;
      if (!mat || Array.isArray(mat) || !mat.emissive) return;
      if (under) {
        mat.emissive.setHex(0xff6f6f);
        mat.emissiveIntensity = 0.32;
        mesh.userData.underFloor = true;
      } else if (mesh.userData.underFloor) {
        mat.emissive.copy(mat.userData.baseEmissive || new THREE.Color(ROLE_COLORS[mesh.userData.node?.role] || ROLE_COLORS.structure));
        mat.emissiveIntensity = mat.userData.baseEmissiveIntensity ?? 0.08;
        mesh.userData.underFloor = false;
      }
    });
  }

  function buildPlan(plan) {
    if (!THREE || !modelGroup) {
      log("Viewport", "Three.js not ready — cannot build plan. Check CDN connectivity.", "err");
      return;
    }
    clearScene();
    activePlan = normalizePlan(plan);
    const nodes = renderableNodes(activePlan.nodes);
    nodes.forEach((node, i) => addNodeMesh(node, i, nodes.length));
    groundBuiltModel();
    updatePlanList(activePlan);
    if (plan._introLogo && camera && controls) {
      // Intimate framing for the intro logo — skip auto-zoom so the brand reads big
      camera.position.set(0, 0.35, 4.8);
      controls.target.set(0, 0.2, 0);
      controls.update();
    } else {
      frameModel();
    }
    log("Viewport", `Loaded ${nodes.length} mesh part(s) in the void.`);
  }

  /**
   * Put the built model on the floor, measured from the geometry that exists.
   *
   * Everything before this point works from a part's declared parameters —
   * width, radius, a profile's points — which is an estimate, ignores rotation,
   * and cannot know what a mesh's vertices actually do. On a real run it lifted
   * a fish by 2.40 and left it hanging above the grid.
   *
   * Here the meshes are built, so THREE can measure them exactly. The nodes
   * move with them, or a save would store the ungrounded positions and the
   * model would jump the next time it was opened.
   */
  function groundBuiltModel() {
    if (!THREE || !modelGroup || !modelGroup.children.length) return;
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty() || !Number.isFinite(box.min.y)) return;
    const dy = FLOOR_Y - box.min.y;
    if (!Number.isFinite(dy) || Math.abs(dy) < 1e-4) return;
    modelGroup.children.forEach((child) => {
      child.position.y += dy;
      const node = child.userData?.node;
      if (node && Array.isArray(node.position)) node.position[1] += dy;
    });
    modelGroup.updateMatrixWorld(true);
    log("Assemble", `set on the floor from measured geometry · ${dy > 0 ? "+" : ""}${dy.toFixed(2)}`, "ok");
  }

  function selectableMeshes() {
    const out = [];
    if (!modelGroup) return out;
    modelGroup.traverse((obj) => {
      if (obj?.isMesh && obj.userData?.selectable) out.push(obj);
    });
    return out;
  }

  function handleCanvasClick(event) {
    if (!renderer || !camera || !raycaster || !pointer || !modelGroup) return;
    if (transformControls?.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(selectableMeshes(), true)[0];
    selectMesh(hit ? nearestSelectable(hit.object) : null);
  }

  function handleCanvasDoubleClick(event) {
    handleCanvasClick(event);
    focusCameraOnSelection();
  }

  function nearestSelectable(obj) {
    let cur = obj;
    while (cur && !cur.userData?.selectable) cur = cur.parent;
    return cur || null;
  }

  function selectMesh(mesh) {
    if (selectionBox) {
      scene?.remove(selectionBox);
      selectionBox.geometry?.dispose?.();
      selectionBox.material?.dispose?.();
      selectionBox = null;
    }
    selectedObjectWhole = false;
    selectedMesh = mesh || null;
    if (transformControls) {
      if (selectedMesh) {
        transformControls.attach(selectedMesh);
        transformControls.setMode(transformMode);
      } else {
        transformControls.detach();
      }
    }
    if (selectedMesh && THREE && scene) {
      selectionBox = new THREE.BoxHelper(selectedMesh, 0x9ff4e7);
      scene.add(selectionBox);
      log("Editor", `Selected ${selectedMesh.userData.node?.name || selectedMesh.name}`, "wait");
    }
    renderSelection();
    updatePlanList(activePlan);
  }

  function selectWholeObject() {
    if (!modelGroup || !modelGroup.children.length) return;
    if (selectionBox) {
      scene?.remove(selectionBox);
      selectionBox.geometry?.dispose?.();
      selectionBox.material?.dispose?.();
      selectionBox = null;
    }
    selectedMesh = modelGroup;
    selectedObjectWhole = true;
    if (transformControls) {
      transformControls.attach(modelGroup);
      transformControls.setMode(transformMode);
    }
    if (THREE && scene) {
      selectionBox = new THREE.BoxHelper(modelGroup, 0xffffff);
      scene.add(selectionBox);
    }
    renderSelection();
    renderCadToolbar();
    updatePlanList(activePlan);
    log("Editor", "Selected whole object", "wait");
  }

  function focusCameraOnSelection() {
    if (!camera || !controls || !THREE) return;
    const targetObj = selectedMesh || modelGroup;
    if (!targetObj) return;
    const box = new THREE.Box3().setFromObject(targetObj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const sizeVec = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.18, sizeVec.length() * 0.5);
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 0.0001) dir.set(4, 2.4, 5);
    dir.normalize();
    const distance = Math.max(radius * 2.2, 0.75);
    controls.target.copy(center);
    camera.position.copy(center).add(dir.multiplyScalar(distance));
    camera.near = Math.max(0.01, distance / 100);
    camera.updateProjectionMatrix();
    controls.update();
    log("Camera", `Focused ${selectedObjectWhole ? "whole object" : selectedMesh?.userData?.node?.name || "selection"}`, "wait");
  }

  function panCameraVertical(amount) {
    if (!camera || !controls || !THREE) return;
    const up = new THREE.Vector3(0, 1, 0).multiplyScalar(amount);
    camera.position.add(up);
    controls.target.add(up);
    controls.update();
    log("Camera", amount > 0 ? "Panned camera up" : "Panned camera down", "wait");
  }

  function renderSelection() {
    const card = $("frgSelectionCard");
    if (!card) return;
    if (!selectedMesh) {
      card.innerHTML = `<div class="frg-selection-empty">Click any part in the void to edit it.</div>`;
      return;
    }
    const node = selectedMesh.userData.node || {};
    const pos = selectedMesh.position;
    const scale = selectedMesh.scale;
    const rot = selectedMesh.rotation;
    card.innerHTML = `
      <div class="frg-selection-title">
        <b title="${escapeHtml(selectedObjectWhole ? "Whole object" : node.name || selectedMesh.name || "Part")}">${escapeHtml(selectedObjectWhole ? "Whole object" : node.name || selectedMesh.name || "Part")}</b>
        <span>${escapeHtml(selectedObjectWhole ? "object" : node.role || "part")}</span>
      </div>
      <div class="frg-edit-buttons">
        <button class="frg-edit-btn${transformMode === "translate" ? " active" : ""}" data-frg-edit="translate">Move</button>
        <button class="frg-edit-btn${transformMode === "rotate" ? " active" : ""}" data-frg-edit="rotate">Rotate</button>
        <button class="frg-edit-btn${transformMode === "scale" ? " active" : ""}" data-frg-edit="scale">Resize</button>
        <button class="frg-edit-btn danger" data-frg-edit="delete">Delete</button>
      </div>
      <div class="frg-edit-buttons">
        <button class="frg-edit-btn" data-frg-edit="duplicate">Duplicate</button>
        <button class="frg-edit-btn" data-frg-edit="floor">To floor</button>
        <button class="frg-edit-btn" data-frg-edit="reset">Reset</button>
        <button class="frg-edit-btn${snapEnabled ? " active" : ""}" data-frg-edit="snap">Snap</button>
      </div>
      <div class="frg-edit-grid" aria-label="Position">
        ${["x", "y", "z"].map((axis) => `<span class="frg-edit-field"><label>Pos ${axis.toUpperCase()}</label><input data-frg-pos="${axis}" type="number" step="0.05" value="${escapeHtml(pos[axis].toFixed(2))}"></span>`).join("")}
      </div>
      <div class="frg-edit-grid" aria-label="Scale" style="margin-top:6px">
        ${["x", "y", "z"].map((axis) => `<span class="frg-edit-field"><label>Scale ${axis.toUpperCase()}</label><input data-frg-scale="${axis}" type="number" step="0.05" min="0.02" value="${escapeHtml(scale[axis].toFixed(2))}"></span>`).join("")}
      </div>
      <div class="frg-edit-grid" aria-label="Rotation" style="margin-top:6px">
        ${["x", "y", "z"].map((axis) => `<span class="frg-edit-field"><label>Rot ${axis.toUpperCase()}</label><input data-frg-rot="${axis}" type="number" step="5" value="${escapeHtml(Math.round(THREE.MathUtils.radToDeg(rot[axis])))}"></span>`).join("")}
      </div>`;
  }

  function setTransformMode(mode) {
    transformMode = mode === "scale" ? "scale" : mode === "rotate" ? "rotate" : "translate";
    if (transformControls) transformControls.setMode(transformMode);
    renderCadToolbar();
    renderSelection();
  }

  function renderCadToolbar() {
    document.querySelectorAll("[data-frg-tool]").forEach((btn) => {
      const tool = btn.dataset.frgTool;
      btn.classList.toggle("active",
        tool === transformMode ||
        (tool === "selectObject" && selectedObjectWhole) ||
        (tool === "snap" && snapEnabled)
      );
    });
  }

  function setSnapEnabled(enabled) {
    snapEnabled = !!enabled;
    if (transformControls) {
      transformControls.setTranslationSnap?.(snapEnabled ? 0.1 : null);
      transformControls.setRotationSnap?.(snapEnabled && THREE ? THREE.MathUtils.degToRad(5) : null);
      transformControls.setScaleSnap?.(snapEnabled ? 0.05 : null);
    }
    renderCadToolbar();
    renderSelection();
    log("Editor", snapEnabled ? "Snapping enabled" : "Snapping disabled", "wait");
  }

  function syncSelectedNodeFromMesh() {
    if (!selectedMesh) return;
    if (selectedObjectWhole) {
      activePlan?.nodes?.forEach((node) => {
        const mesh = selectableMeshes().find((obj) => obj.userData.nodeId === node.id);
        if (!mesh) return;
        node.position = [mesh.position.x, mesh.position.y, mesh.position.z];
        node.rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
        node.scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
      });
      queueProjectSave();
      return;
    }
    const node = selectedMesh.userData.node;
    if (!node) return;
    node.position = [selectedMesh.position.x, selectedMesh.position.y, selectedMesh.position.z];
    node.rotation = [selectedMesh.rotation.x, selectedMesh.rotation.y, selectedMesh.rotation.z];
    node.scale = [selectedMesh.scale.x, selectedMesh.scale.y, selectedMesh.scale.z];
    queueProjectSave();
  }

  function updateSelectedScale(axis, value) {
    if (!selectedMesh) return;
    const n = Math.max(0.02, Number(value) || 0.02);
    selectedMesh.scale[axis] = n;
    syncSelectedNodeFromMesh();
    selectionBox?.update();
    updatePlanList(activePlan);
  }

  function updateSelectedPosition(axis, value) {
    if (!selectedMesh) return;
    selectedMesh.position[axis] = Number(value) || 0;
    syncSelectedNodeFromMesh();
    selectionBox?.update();
    updatePlanList(activePlan);
  }

  function updateSelectedRotation(axis, degrees) {
    if (!selectedMesh || !THREE) return;
    selectedMesh.rotation[axis] = THREE.MathUtils.degToRad(Number(degrees) || 0);
    syncSelectedNodeFromMesh();
    selectionBox?.update();
    updatePlanList(activePlan);
  }

  function deleteSelectedPart() {
    if (!selectedMesh || !modelGroup) return;
    if (selectedObjectWhole) {
      const count = activePlan?.nodes?.length || modelGroup.children.length;
      clearScene();
    activePlan = { ...(activePlan || { name: "Forge object" }), nodes: [] };
    updatePlanList(activePlan);
    renderSelection();
    queueProjectSave();
    log("Editor", `Deleted whole object · ${count} part(s)`, "warn");
    return;
    }
    const nodeId = selectedMesh.userData.nodeId;
    const label = selectedMesh.userData.node?.name || selectedMesh.name || "part";
    transformControls?.detach();
    if (selectionBox) {
      scene?.remove(selectionBox);
      selectionBox.geometry?.dispose?.();
      selectionBox.material?.dispose?.();
      selectionBox = null;
    }
    revealMeshes = revealMeshes.filter((item) => item.mesh !== selectedMesh);
    modelGroup.remove(selectedMesh);
    selectedMesh.geometry?.dispose?.();
    if (Array.isArray(selectedMesh.material)) selectedMesh.material.forEach((m) => m.dispose?.());
    else selectedMesh.material?.dispose?.();
    if (activePlan?.nodes) activePlan.nodes = activePlan.nodes.filter((node) => node.id !== nodeId);
    selectedMesh = null;
    updatePlanList(activePlan);
    renderSelection();
    queueProjectSave();
    log("Editor", `Deleted ${label}`, "warn");
  }

  function duplicateSelectedPart() {
    if (!selectedMesh || !activePlan || !modelGroup) return;
    if (selectedObjectWhole) {
      const sourceNodes = activePlan.nodes.map((node) => JSON.parse(JSON.stringify(node)));
      const suffix = Date.now().toString(36);
      const clones = sourceNodes.map((node) => ({
        ...node,
        id: `${node.id}_copy_${suffix}`,
        name: `${node.name || node.id || "Part"} copy`,
        position: [(node.position?.[0] || 0) + 0.38, node.position?.[1] || 0, (node.position?.[2] || 0) + 0.38],
      }));
      activePlan.nodes.push(...clones);
      clones.forEach((node, i) => addNodeMesh(node, activePlan.nodes.length - clones.length + i, activePlan.nodes.length));
      updatePlanList(activePlan);
      selectWholeObject();
      queueProjectSave();
      log("Editor", `Duplicated whole object · ${clones.length} part(s)`, "ok");
      return;
    }
    const sourceNode = selectedMesh.userData.node || {};
    const cloneNode = JSON.parse(JSON.stringify(sourceNode));
    cloneNode.id = `${sourceNode.id || "part"}_copy_${Date.now().toString(36)}`;
    cloneNode.name = `${sourceNode.name || selectedMesh.name || "Part"} copy`;
    cloneNode.position = [
      selectedMesh.position.x + 0.22,
      selectedMesh.position.y,
      selectedMesh.position.z + 0.22,
    ];
    cloneNode.rotation = [selectedMesh.rotation.x, selectedMesh.rotation.y, selectedMesh.rotation.z];
    cloneNode.scale = [selectedMesh.scale.x, selectedMesh.scale.y, selectedMesh.scale.z];
    activePlan.nodes.push(cloneNode);
    addNodeMesh(cloneNode, activePlan.nodes.length - 1, activePlan.nodes.length);
    const mesh = selectableMeshes().find((obj) => obj.userData.nodeId === cloneNode.id);
    updatePlanList(activePlan);
    selectMesh(mesh || null);
    queueProjectSave();
    log("Editor", `Duplicated ${sourceNode.name || selectedMesh.name || "part"}`, "ok");
  }

  function resetSelectedPart() {
    if (!selectedMesh) return;
    if (selectedObjectWhole) {
      modelGroup.position.set(0, 0, 0);
      modelGroup.rotation.set(0, 0, 0);
      modelGroup.scale.set(1, 1, 1);
      selectionBox?.update();
      renderSelection();
      queueProjectSave();
      log("Editor", "Reset whole object transform", "wait");
      return;
    }
    const original = selectedMesh.userData.originalTransform;
    if (!original) return;
    selectedMesh.position.copy(original.position);
    selectedMesh.rotation.copy(original.rotation);
    selectedMesh.scale.copy(original.scale);
    syncSelectedNodeFromMesh();
    selectionBox?.update();
    renderSelection();
    updatePlanList(activePlan);
    queueProjectSave();
    log("Editor", `Reset ${selectedMesh.userData.node?.name || selectedMesh.name || "part"}`, "wait");
  }

  /**
   * The deterministic stage — symmetry, floor contact and unrenderable parts.
   *
   * This is what the Audit Agent used to be asked to do. Doing it here costs
   * nothing, cannot rate-limit, and produces symmetry that is exact rather than
   * approximately what a model aimed for.
   *
   * Resizing is deliberately NOT requested. The camera, grid and lighting are
   * tuned to the size plans already come out at, and normalising every model to
   * a fixed size would be a change of appearance dressed as a correction. When
   * there is a measurement to justify a target, pass targetSize here.
   */
  function assembleDeterministically(plan) {
    const MP = window.HCModelPlan;
    if (!MP || !plan || !Array.isArray(plan.nodes) || !plan.nodes.length) return plan;
    let out;
    try {
      // Grounding is skipped here: buildPlan measures the meshes it actually
      // creates and sets the model on the floor from that, which is exact.
      out = MP.assemble(plan, { ground: false });
    } catch (err) {
      log("Assemble", `skipped: ${err?.message || err}`, "warn");
      return plan;
    }
    // Never hand back an empty scene. If every part failed to measure, the
    // original is still more useful than nothing, and the trace says so.
    if (!out.parts.length) {
      log("Assemble", "left the plan alone — nothing measurable to work with", "warn");
      return plan;
    }
    const s = out.stats;
    const notes = [];
    if (s.mirrored) notes.push(`${s.mirrored} part(s) mirrored exactly`);

    if (s.received !== s.kept) notes.push(`${s.received - s.kept} unrenderable part(s) dropped`);
    log("Assemble", notes.length ? notes.join(" · ") : "nothing to correct", "ok");
    for (const issue of out.issues) {
      if (issue.code === "detached") log("Assemble", `${issue.partId} does not connect to the main body`, "warn");
      else if (issue.code === "degenerate") log("Assemble", `${issue.partId} had no measurable size`, "warn");
    }
    return { ...plan, nodes: out.parts };
  }

  function alignSelectedToFloor() {
    if (!selectedMesh || !THREE) return;
    const box = new THREE.Box3().setFromObject(selectedMesh);
    if (box.isEmpty()) return;
    selectedMesh.position.y += FLOOR_Y - box.min.y;
    syncSelectedNodeFromMesh();
    selectionBox?.update();
    renderSelection();
    updatePlanList(activePlan);
    queueProjectSave();
    log("Editor", `Aligned ${selectedMesh.userData.node?.name || selectedMesh.name || "part"} to floor`, "ok");
  }

  async function ensurePipelineModule(kind) {
    if (kind === "gltfLoader" && !GLTFLoader) {
      ({ GLTFLoader } = await import("/js/vendor/three/examples/GLTFLoader.js"));
    } else if (kind === "gltfExporter" && !GLTFExporter) {
      ({ GLTFExporter } = await import("/js/vendor/three/examples/GLTFExporter.js"));
    } else if (kind === "stlExporter" && !STLExporter) {
      ({ STLExporter } = await import("/js/vendor/three/examples/STLExporter.js"));
    } else if (kind === "objExporter" && !OBJExporter) {
      ({ OBJExporter } = await import("/js/vendor/three/examples/OBJExporter.js"));
    }
  }

  function exportableObject() {
    if (!modelGroup || !modelGroup.children.length) return null;
    syncSelectedNodeFromMesh();
    const clone = modelGroup.clone(true);
    clone.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.visible = true;
      obj.material = Array.isArray(obj.material) ? obj.material.map((m) => m.clone()) : obj.material?.clone?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          mat.opacity = Math.max(mat.opacity || 1, 0.86);
          mat.transparent = false;
          mat.depthWrite = true;
        });
      }
    });
    return clone;
  }

  async function exportForgeAsset(kind) {
    if (!await initThree()) return;
    const object = exportableObject();
    if (!object) {
      log("Pipeline", "No model to export", "warn");
      return;
    }
    updateStage("export", "active", `writing ${kind.toUpperCase()}`);
    const base = safeFileName(activePlan?.name || $("frgPrompt")?.value || "3d-forge-model");
    let saved = false;
    try {
      if (kind === "glb") {
        if (activePlan?.glbUrl) {
          const asset = await fetch(activePlan.glbUrl).then(r => r.blob());
          if (!await downloadBlob(`${base}.glb`, asset)) {
            updateStage("export", "idle", "not saved");
            return;
          }
          log("Pipeline", "Saved kernel GLB asset", "ok");
          updateStage("export", "done", "GLB exported");
          return;
        }
        await ensurePipelineModule("gltfExporter");
        const exporter = new GLTFExporter();
        const result = await new Promise((resolve, reject) => {
          exporter.parse(object, resolve, reject, { binary: true, onlyVisible: true, trs: false });
        });
        saved = await downloadBlob(`${base}.glb`, new Blob([result], { type: "model/gltf-binary" }));
      } else if (kind === "obj") {
        await ensurePipelineModule("objExporter");
        const text = new OBJExporter().parse(object);
        saved = await downloadBlob(`${base}.obj`, new Blob([text], { type: "text/plain" }));
      } else if (kind === "stl") {
        await ensurePipelineModule("stlExporter");
        const result = new STLExporter().parse(object, { binary: true });
        saved = await downloadBlob(`${base}.stl`, new Blob([result], { type: "model/stl" }));
      }
      // Only claim it when it happened. The export used to be announced before
      // anything was written, and nothing ever was.
      if (!saved) { updateStage("export", "idle", "not saved"); return; }
      log("Pipeline", `Exported ${kind.toUpperCase()} asset`, "ok");
      updateStage("export", "done", `${kind.toUpperCase()} exported`);
    } catch (err) {
      log("Pipeline", `Export failed · ${err.message || err}`, "err");
      updateStage("export", "active", "export failed");
    }
  }

  async function importForgeAsset(file) {
    if (!file || !await initThree()) return;
    try {
      await ensurePipelineModule("gltfLoader");
      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      URL.revokeObjectURL(url);
      const nodes = meshNodesFromScene(gltf.scene, file.name);
      if (!nodes.length) {
        log("Pipeline", "Imported asset had no supported mesh parts", "warn");
        return;
      }
      const current = activePlan?.nodes?.length ? normalizePlan(activePlan) : { name: `Imported ${file.name.replace(/\.[^.]+$/, "")}`, nodes: [] };
      current.nodes = current.nodes.concat(nodes).slice(0, MAX_FORGE_NODES);
      current.name = current.name || `Imported ${file.name.replace(/\.[^.]+$/, "")}`;
      buildPlan(current);
      saveCurrentProject(false);
      log("Pipeline", `Imported ${nodes.length} mesh part(s) from ${file.name}`, "ok");
    } catch (err) {
      log("Pipeline", `Import failed · ${err.message || err}`, "err");
    }
  }

  function meshNodesFromScene(root, fileName) {
    const nodes = [];
    let totalVertices = 0;
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || nodes.length >= 32 || totalVertices > 60000) return;
      const geo = obj.geometry.clone();
      geo.applyMatrix4(obj.matrixWorld);
      const serialized = serializeGeometry(geo);
      geo.dispose?.();
      if (!serialized) return;
      totalVertices += serialized.positions.length / 3;
      const color = Array.isArray(obj.material)
        ? obj.material[0]?.color?.getHexString?.()
        : obj.material?.color?.getHexString?.();
      nodes.push({
        id: `asset_${Date.now().toString(36)}_${nodes.length}`,
        name: obj.name || `${fileName.replace(/\.[^.]+$/, "")} mesh ${nodes.length + 1}`,
        role: nodes.length ? "surface" : "structure",
        type: "mesh",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        params: { ...serialized, smooth: true },
        color: color ? `#${color}` : "#c9a96e",
      });
    });
    return nodes;
  }

  function serializeGeometry(geometry) {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3 || pos.count > 25000) return null;
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    return {
      positions: Array.from(pos.array),
      normals: normal && normal.array.length === pos.array.length ? Array.from(normal.array) : undefined,
      uvs: uv ? Array.from(uv.array) : undefined,
      indices: geometry.index ? Array.from(geometry.index.array) : undefined,
    };
  }

  function safeFileName(name) {
    return String(name || "3d-forge-model").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "3d-forge-model";
  }

  // Goes through HC.save. The old route was an <a download>, which this
  // webview cancels outright (see platform/tauri/save.js) — so every Forge
  // export logged success and wrote nothing.
  async function downloadBlob(name, blob) {
    try {
      const result = await window.HC.save.file(name, blob);
      if (!result.saved) {
        log("Pipeline", "Export cancelled", "warn");
        return false;
      }
      return true;
    } catch (e) {
      log("Pipeline", `Export failed: ${e?.message || e}`, "err");
      return false;
    }
  }

  function selectNodeById(nodeId) {
    const mesh = selectableMeshes().find((obj) => obj.userData.nodeId === nodeId);
    if (mesh) selectMesh(mesh);
  }

  function normalizePlan(plan) {
    const src = plan && typeof plan === "object" ? plan : { name: "Empty model", nodes: [] };
    const nodes = Array.isArray(src.nodes) ? src.nodes : [];
    return {
      name: src.name || "Forged model",
      glbUrl: typeof src.glbUrl === "string" ? src.glbUrl : "",
      constraints: Array.isArray(src.constraints) ? src.constraints : [],
      edges: Array.isArray(src.edges) ? src.edges : [],
      nodes: nodes.slice(0, MAX_FORGE_NODES).map((node, i) => ({
        id: String(node.id || `node_${i + 1}`),
        name: String(node.name || node.id || `Node ${i + 1}`),
        type: ["box", "cylinder", "capsule", "sphere", "cone", "torus", "lathe", "extrude", "logo", "logo_img", "mesh"].includes(node.type) ? node.type : "box",
        role: ["structure", "surface", "detail", "audit"].includes(node.role) ? node.role : "structure",
        position: vec3(node.position, [0, 0, 0]),
        rotation: vec3(node.rotation, [0, 0, 0]),
        scale: vec3(node.scale, [1, 1, 1]),
        params: node.params && typeof node.params === "object" ? node.params : {},
        color: node.color,
        opacity: Number.isFinite(node.opacity) ? node.opacity : undefined,
      })),
    };
  }

  function vec3(v, fallback) {
    return Array.isArray(v) && v.length >= 3
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : fallback.slice();
  }

  function randomSpherePoint(radius) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    return new THREE.Vector3(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  function spawnFlightsTo(target, role, count) {
    if (!THREE || !particleGroup) return;
    const color = ROLE_COLORS[role] || ROLE_COLORS.structure;
    const geo = new THREE.SphereGeometry(0.025, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const now = performance.now();
    const duration = role === "structure" ? 2800 : role === "surface" ? 2000 : role === "detail" ? 1400 : 3500;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      const p0 = randomSpherePoint(7.8 + Math.random() * 2.2);
      const p3 = target.clone();
      const lift = role === "structure" ? 2.4 : role === "surface" ? 0.9 : role === "detail" ? 0.35 : 3.2;
      const side = new THREE.Vector3(-p3.z, 0, p3.x).normalize().multiplyScalar(role === "surface" ? 1.5 : role === "audit" ? 2.7 : 0.7);
      const p1 = p0.clone().multiplyScalar(0.62).add(new THREE.Vector3(0, lift, 0)).add(side);
      const p2 = p3.clone().add(new THREE.Vector3(0, lift * 0.45, 0)).sub(side.multiplyScalar(0.55));
      const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
      mesh.position.copy(p0);
      particleGroup.add(mesh);
      flights.push({ mesh, curve, start: now + i * 18, duration: duration * (0.78 + Math.random() * 0.34) });
    }
    $("frgParticleCount").textContent = `${flights.length} particles`;
  }

  function updateFlights(now) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const t = Math.min(1, Math.max(0, (now - f.start) / f.duration));
      f.mesh.position.copy(f.curve.getPoint(t));
      f.mesh.material.opacity = 1 - Math.max(0, t - 0.72) / 0.28;
      if (t >= 1) {
        particleGroup.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        flights.splice(i, 1);
      }
    }
    const pc = $("frgParticleCount");
    if (pc) pc.textContent = `${flights.length} particles`;
  }

  function updateReveal(now) {
    for (const item of revealMeshes) {
      const t = Math.min(1, Math.max(0, (now - item.start) / item.duration));
      item.mesh.material.opacity = item.targetOpacity * easeOut(t);
    }
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function frameModel() {
    if (!modelGroup || !camera || !controls) return;
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(size * 0.62 + 3.2, size * 0.38 + 2.4, size * 0.78 + 4.2));
    camera.lookAt(center);
    controls.update();
  }

  function resetView() {
    if (!camera || !controls) return;
    camera.position.set(6, 4.2, 8);
    controls.target.set(0, 0.7, 0);
    controls.update();
  }

  function isSkeletonOnlyPrompt(prompt) {
    const q = String(prompt || "").toLowerCase();
    return /skeleton|bones|anatomy/.test(q) && !/person with|character with|with (skin|body|outer|muscle)/.test(q);
  }

  function isKnifeLikePrompt(prompt) {
    return /knife|dagger|scalpel/.test(String(prompt || "").toLowerCase());
  }

  function isSpoonLikePrompt(prompt) {
    return /\b(spoon|teaspoon|tablespoon|soup spoon|dessert spoon|serving spoon|ladle)\b/.test(String(prompt || "").toLowerCase());
  }

  function isSwordLikePrompt(prompt) {
    const q = String(prompt || "").toLowerCase();
    if (/sword|katana|saber|sabre|rapier/.test(q)) return true;
    return /\bblade\b/.test(q) && !/fan|propeller|rotor|turbine|drone|mower/.test(q);
  }

  function isDroneLikePrompt(prompt) {
    return /drone|quad\s?copter|quad\s?rotor|uav/.test(String(prompt || "").toLowerCase());
  }

  function classifyForgePrompt(prompt) {
    const q = String(prompt || "").toLowerCase();
    if (/\b(skull|skeleton|anatomy|anatomical|ribcage|rib cage|heart|brain|torso|hand bones?|femur|humerus|tibia|spine|vertebra|pelvis|mandible|cranium|organ|bones?)\b/.test(q)) {
      return {
        route: "anatomical",
        object: prompt,
        brief: "Anatomical structure requiring SDF composition with union, subtraction, smooth blends, and marching surface extraction.",
      };
    }
    if (/\b(tree|oak|cloud|smoke|creature|dragon|monster|abstract sculpture|amorphous|coral|moss|terrain|rock formation)\b/.test(q)) {
      return {
        route: "organic_diffusion",
        object: prompt,
        brief: "Irregular organic form better suited to image-to-3D diffusion.",
      };
    }
    return {
      route: "parametric",
      object: prompt,
      brief: "Manufactured or engineered object suitable for lathe, tube, extrude, box, sphere, and loft primitives.",
    };
  }

  async function runGodAgent(useSample) {
    if (!await initThree()) return;
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    traceRunCount += 1;
    traceStartTime = Date.now();
    const prompt = ($("frgPrompt")?.value || "").trim() || "a complex original 3D object";
    const prefs = forgePrefs();
    // Which refinement passes did not run. A run that lost one is not a run
    // that finished, and the difference has to reach the user.
    activeReferenceBrief = "";
    resetStages();
    updateStage("input", "done", "prompt locked");
    const traceEntries = $("frgTraceEntries");
    if (traceEntries) traceEntries.innerHTML = "";
    const consoleEl = $("frgTraceConsole");
    if (consoleEl) {
      consoleEl.classList.remove("collapsed");
      consoleEl.classList.add("expanded");
    }
    AGENTS.forEach((a) => setAgentState(a.id, "idle"));
    setStatus("Forging");
    setAgentState("god", "thinking");
    log("Orchestrator", `Run ${traceRunCount} started`, "boss");
    autoAssignForgeModels(prompt, false);
    let routeBrief = classifyForgePrompt(prompt);
    if (routeBrief.route === "organic_diffusion") {
      routeBrief = {
        ...routeBrief,
        route: "parametric",
        brief: "Organic mesh approximation routed through direct AI geometry because no diffusion backend is configured.",
      };
      log("Router", "Diffusion backend unavailable; routing organic prompt to direct mesh geometry", "warn");
    }
    activeForgeRoute = routeBrief.route;
    log("God Agent", `Route: ${routeBrief.route}`, "boss", routeBrief.brief);
    log("Parameter Agent", useSample ? "Loading sample geometry plan." : `Designing "${prompt}" with ${modelLabel(selectedModelFor("god"))}`, "run");

    let plan = null;
    if (useSample) {
      plan = hLogoPlan();
      plan.route = "parametric";
    } else {
      try {
        updateStage("generate", "active", "references");
        activeReferenceBrief = await gatherReferenceBrief(prompt, routeBrief.route, abortCtrl.signal);
        updateStage("generate", "active", "parameter agent");
        plan = await requestForgeKernelPlan(prompt, prefs, activeReferenceBrief, routeBrief, abortCtrl.signal);
        if (plan) {
          plan.route = routeBrief.route;
          log(routeBrief.route === "anatomical" ? "SDF Kernel" : "Geometry Kernel", `Executed ${routeBrief.route} mesh plan · ${plan.nodes.length} mesh part(s)`, "ok");
        }
      } catch (err) {
        failForgeRun("Parameter Agent", "Model generation failed: " + (err.message || err));
        return;
      }
    }
    updateStage("generate", "done", plan ? "plan ready" : "failed");
    if (!plan) {
      failForgeRun("Parameter Agent", "No model plan was produced.");
      return;
    }
    if (!useSample) {
      plan = enforceSingleMainModel(prompt, plan, prefs);
      plan.route = routeBrief.route;
    }

    setAgentState("god", "done");

    // ── One call designs the model ────────────────────────────────────
    //
    // There were three more here — Structure, Surface and Detail — each asked
    // to append parts to the plan the first call produced. Nothing owned the
    // silhouette, so they did not refine a model, they grew a pile: the run
    // that prompted this rewrite ended with eighteen disconnected shards that
    // did not read as a fish. Three extra calls, three more chances to hit a
    // free-tier limit, and a worse object at the end of them.
    //
    // The design is one answer now. What those passes were reaching for —
    // symmetry, contact, nothing floating — is measured in
    // src/js/model-plan.js, and Improve exists for the times a person looks at
    // the result and wants another pass.
    if (!useSample && routeBrief.route !== "organic_diffusion" && abortCtrl && !abortCtrl.signal.aborted) {
      updateStage("refine", "active", "assembling");

      // One subject, centred and grounded.
      plan = enforceSingleMainModel(prompt, plan, prefs);

      // There was a padding pass here, topping a sparse plan up to a minimum
      // node count — as many as forty parts — with pieces taken from the
      // built-in template for the subject. Its only caller had already
      // switched it off, so the body was unreachable while still reading like
      // a live feature. It is gone rather than left as something to switch
      // back on: the design prompt now asks for few parts that read
      // correctly, and padding a good twelve-part model up to forty is the
      // opposite of that.
      plan = normalizePlan(plan);
      plan.route = routeBrief.route;
    }
    updateStage("refine", "done", plan.route === "anatomical" ? "sdf smoothed" : "post-process done");

    plan = assembleDeterministically(plan);

    buildPlan(plan);
    saveCurrentProject(false);
    const partCount = renderableNodes(plan.nodes).length;
    const dot = $("frgTraceDot");
    // There was a partial-run branch here, reporting which of the three
    // appending passes had failed. With one call there is no partial run: the
    // design either arrived or the run stopped at it and said so.
    log("Orchestrator", `Forge complete · ${partCount} mesh part(s)`, "ok");
    if (dot) dot.className = "frg-trace-dot done";
    setStatus("Ready");
    updateStage("export", "active", `${(prefs.output || "glb").toUpperCase()} ready`);
  }

  function failForgeRun(label, message) {
    log(label || "Forge", message || "Generation failed", "err");
    setStatus("Failed");
    updateStage("generate", "active", "failed");
    updateStage("refine", "active", "blocked");
    updateStage("export", "active", "blocked");
    AGENTS.forEach((a) => setAgentState(a.id, a.id === "god" ? "failed" : "blocked"));
    const dot = $("frgTraceDot");
    if (dot) dot.className = "frg-trace-dot error";
  }

  async function askGodPlanWithFailover(prompt, referenceBrief, prefs, signal) {
    const sel = $("frgModel_god");
    const original = sel?.value || "";
    const current = selectedModelFor("god");
    const routes = providerModelsForForge(true)
      .map(([provider, value, label]) => ({ provider, value, label }))
      .filter((route) => route.value);
    const candidates = [
      current ? { provider: providerFromValue(current), value: current, label: modelLabel(current) } : null,
      ...routes.filter((route) => route.value !== current),
    ].filter((route, index, arr) => route?.value && arr.findIndex((r) => r?.value === route.value) === index);
    let lastError = null;
    for (let i = 0; i < Math.min(candidates.length, 5); i++) {
      const candidate = candidates[i];
      if (skipCoolingCandidate(candidate, candidates)) continue;
      if (sel && Array.from(sel.options).some((o) => o.value === candidate.value)) sel.value = candidate.value;
      if (i > 0) log("Router", `Retrying God Agent with ${candidate.label || modelLabel(candidate.value)}`, "warn");
      let routedSignal = null;
      try {
        const timeoutMs = candidate.provider === "local" ? 90_000 : 45_000;
        routedSignal = timeoutSignal(signal, timeoutMs);
        return await askModelForPlan(prompt, referenceBrief, prefs, routedSignal.signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err;
        markForgeProviderFailure(candidate.provider, err);
        log("God Agent", `${candidate.label || modelLabel(candidate.value)} failed · ${err.message || err}`, "warn");
      } finally {
        routedSignal?.cleanup();
      }
    }
    if (sel && original && Array.from(sel.options).some((o) => o.value === original)) sel.value = original;
    throw lastError || new Error("all Forge planner routes failed");
  }


  async function requestForgeKernelPlan(prompt, prefs, referenceBrief, routeBrief, signal) {
    const route = routeBrief?.route || "parametric";
    // Geometry is generated by asking a model directly. There used to be a
    // branch here that POSTed to /api/forge-kernel first and fell back to this
    // — but it ran only when NOT inside Tauri, and this app is only ever
    // inside Tauri, so the request was never made. No such server ships with
    // HashCortX, and none is planned.
    log("God Agent", "Direct AI geometry mode", "run");
    const plan = await askGodPlanWithFailover(prompt, referenceBrief, prefs, signal);
    if (plan) plan.route = route;
    return plan;
  }

  function timeoutSignal(parentSignal, ms) {
    const ctrl = new AbortController();
    let cleaned = false;
    const abort = () => {
      if (!ctrl.signal.aborted) ctrl.abort();
    };
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.max(5000, Number(ms) || 45_000));
    return {
      signal: ctrl.signal,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(timer);
        parentSignal?.removeEventListener?.("abort", abort);
      },
    };
  }

  async function gatherReferenceBrief(prompt, route, signal) {
    const api = window._H;
    if (!api?.runOneTool) {
      log("Reference", "Web tools unavailable; planning from prompt only", "warn");
      return "";
    }
    const queries = referenceSearchQueries(prompt, route);
    const answers = [];
    const resultMap = new Map();
    for (const query of queries) {
      log("Reference", `Searching reference objects: ${query.slice(0, 72)}`, "run");
      const raw = await api.runOneTool("web_search", { query }, (msg) => log("Reference", msg, "run"));
      const parsed = safeJson(raw);
      if (parsed?.answer) answers.push(parsed.answer);
      (Array.isArray(parsed?.results) ? parsed.results : []).forEach((result) => {
        const url = String(result.url || "");
        if (!url || !isUsefulReferenceUrl(url)) return;
        if (!resultMap.has(url)) resultMap.set(url, result);
      });
    }
    const results = Array.from(resultMap.values()).sort(referenceResultScore).slice(0, 5);
    if (!results.length && !answers.length) {
      log("Reference", "No usable web reference results; planning from prompt", "warn");
      return "";
    }
    const pages = [];
    const pinnedUrls = pinnedReferenceUrls(prompt);
    const pageTargets = [
      ...pinnedUrls.map((url) => ({ title: "Pinned anatomical reference", url })),
      ...results,
    ].filter((result, index, arr) => result.url && arr.findIndex((r) => r.url === result.url) === index);
    for (const result of pageTargets.slice(0, 2)) {
      try {
        const pageRaw = await api.runOneTool("fetch_url", { url: result.url }, (msg) => log("Reference", msg, "run"));
        const page = safeJson(pageRaw);
        if (page?.text) pages.push({ title: result.title || result.url, url: result.url, text: String(page.text).slice(0, 1800) });
      } catch {}
    }
    const sourceText = [
      answers.length ? `Search answers:\n${answers.slice(0, 2).join("\n")}` : "",
      ...results.map((r, i) => `${i + 1}. ${r.title || "Reference"} (${r.url || "no url"}): ${r.snippet || ""}`),
      ...pages.map((p, i) => `Page ${i + 1} ${p.title}: ${p.text}`),
    ].filter(Boolean).join("\n\n").slice(0, 7000);
    const brief = summarizeReferenceBrief(prompt, sourceText);
    if (brief) log("Reference", "Reference constraints ready", "ok", `${results.length} result(s)`);
    return brief;
  }

  /**
   * What to ask the web for: proportions, not products.
   *
   * These queries used to filter TO the model marketplaces — Sketchfab,
   * GrabCAD, Thingiverse and the rest — and ask for "3D model mesh CAD
   * Blender". A real run therefore spent twenty-two of its twenty-seven
   * seconds reading pages titled "top 10 websites to download free 3D models"
   * and "model libraries", which cannot tell anyone how long a fish is
   * relative to its depth. A marketplace listing is a place to buy a model,
   * not a description of one.
   *
   * Two queries, both about measurements, because the design call needs
   * numbers and names, and every extra query is seconds a person waits.
   */
  function referenceSearchQueries(prompt, route) {
    const blocked = "-youtube -facebook -instagram -pinterest -tiktok -download -\"for sale\" -buy";
    if (route === "anatomical") return [
      `${prompt} anatomy proportions dimensions labelled diagram ${blocked}`,
      `${prompt} average size length width height measurements ${blocked}`,
    ];
    return [
      `${prompt} typical proportions ratio length to height body parts named ${blocked}`,
      `${prompt} average dimensions size cm mm specification ${blocked}`,
    ];
  }

  function pinnedReferenceUrls(prompt) {
    if (isSkullPrompt(prompt)) {
      return ["https://sketchfab.com/3d-models/the-anatomy-of-the-human-skull-baf6ac7b781a46218dca2b59dee58817"];
    }
    return [];
  }

  function isUsefulReferenceUrl(url) {
    const s = String(url || "").toLowerCase();
    return !!s && !FORGE_BLOCKED_REFERENCE_DOMAINS.some((domain) => s.includes(domain));
  }

  function referenceResultScore(a, b) {
    return referenceUrlScore(b.url) - referenceUrlScore(a.url);
  }

  function referenceUrlScore(url) {
    const s = String(url || "").toLowerCase();
    let score = 0;
    // Wanted: a page that states measurements. Wikipedia, an encyclopaedia, a
    // species or spec page, a teaching site.
    if (/wikipedia|britannica|\.edu|\.gov|encyclopedia|species|anatomy|dimensions|specification|datasheet/.test(s)) score += 60;
    if (/proportion|ratio|measurement|size|length|weight/.test(s)) score += 25;
    // Unwanted: somewhere to obtain a model. This used to be rewarded — any
    // url containing "3d" or "model" scored — which is how a list of download
    // sites came to be treated as a reference on fish anatomy.
    if (/download|free-?3d|top-?\d|best-?\d|model-librar|marketplace|\/product\/|\/3d-models?\//.test(s)) score -= 80;
    if (/sketchfab|turbosquid|cgtrader|thingiverse|printables|grabcad|blendswap|renderfarm/.test(s)) score -= 60;
    return score;
  }


  function summarizeReferenceBrief(prompt, sourceText) {
    const source = String(sourceText || "");
    if (!source.trim()) return "";
    const dims = Array.from(source.matchAll(/\b(\d+(?:\.\d+)?)\s?(mm|millimeters?|cm|centimeters?|m|meters?|in|inch|inches|")\b/gi))
      .map((m) => `${m[1]} ${m[2].replace('"', "in")}`)
      .slice(0, 18);
    const ratioHints = Array.from(source.matchAll(/\b(?:ratio|proportion|length|height|width|depth|diameter|radius|handle|bowl|rim|shaft|head|base|stem|flange|cup|body|opening|thickness)[^.\n]{0,120}/gi))
      .map((m) => m[0].replace(/\s+/g, " ").trim())
      .filter((line, index, arr) => line.length > 18 && arr.indexOf(line) === index)
      .slice(0, 12);
    const sourceUrls = Array.from(source.matchAll(/https?:\/\/[^\s)]+/g))
      .map((m) => m[0].replace(/[.,;]+$/, ""))
      .filter((url, index, arr) => isUsefulReferenceUrl(url) && arr.indexOf(url) === index)
      .slice(0, 8);
    const q = String(prompt || "").toLowerCase();
    const primitiveHints = [];
    if (/cup|mug|glass|vase|bottle|bowl|spoon|plate|skull|head|wheel|knob/.test(q)) primitiveHints.push("Use lathe for revolved bowls/cups/rounded cavities and rim profiles.");
    if (/handle|limb|leg|arm|tail|stem|shaft|mace|branch|cable|spike|rib/.test(q)) primitiveHints.push("Use tube paths with variable radii for handles, limbs, shafts, spikes, stems, and ribs.");
    if (/blade|leaf|fin|flange|panel|shield|wing/.test(q)) primitiveHints.push("Use extrude for flat silhouettes such as blades, leaves, flanges, panels, and fins.");
    if (/organic|animal|human|skull|head|body|joint|cap/.test(q)) primitiveHints.push("Use sphere/loft combinations for organic masses and transitions.");
    const lines = [
      `Object prompt: ${prompt}`,
      "Reference extraction is deterministic; the next step is the only LLM call.",
      dims.length ? `Detected dimension tokens: ${dims.join(", ")}` : "No exact dimensions detected; infer real-world scale from source titles/snippets.",
      ratioHints.length ? `Reference proportion hints: ${ratioHints.join(" | ")}` : "Extract key ratios from the object type: overall length/height/width/depth plus major part ratios.",
      primitiveHints.length ? `Primitive constraints: ${primitiveHints.join(" ")}` : "Primitive constraints: combine lathe, tube, extrude, sphere, box, and loft numerically.",
      sourceUrls.length ? `Sources read: ${sourceUrls.join(" | ")}` : "",
      "Do not copy any source model. Use references only for proportions, silhouettes, materials, and part ratios.",
    ];
    return lines.join("\n").slice(0, 2600);
  }

  function safeJson(text) {
    try { return JSON.parse(String(text || "")); } catch { return null; }
  }

  async function askModelForPlan(prompt, referenceBrief, prefs, signal) {
    const api = window._H;
    const model = selectedModelFor("god");
    if (!api?.ollamaChat || !model) throw new Error("no model bridge");
    const system = `Return only JSON for a 3D Forge GeometryPlan. No markdown.
Schema:
{
  "name": "short model name",
  "nodes": [
    {
      "id": "stable_id",
      "name": "part name",
      "type": "mesh|lathe|extrude|capsule|sphere|cone|torus|box|cylinder",
      "role": "structure|surface|detail|audit",
      "position": [x,y,z],
      "rotation": [x,y,z],
      "scale": [x,y,z],
      "params": {"width":1,"height":1,"depth":1,"radius":0.5,"length":0.8,"tube":0.08,"points":[[0.2,-0.5],[0.5,0],[0.2,0.5]],"segments":64,"subdivisions":1},
      "color": "#4bd2be"
    }
  ],
  "edges": [],
  "constraints": []
}
Mesh node params for real smooth structures:
{"positions":[x,y,z,...],"indices":[a,b,c,...],"normals":[x,y,z,...],"uvs":[u,v,...],"subdivisions":1,"center":false}

How to build it:
- Design the object in the prompt. Decide its real proportions first, then place parts against them.
- FEW PARTS THAT READ CORRECTLY. A shape a person recognises beats a pile of pieces. Most objects
  are 6 to 16 parts. Add a part only when its absence would be noticed; never pad the count.
- Reach for the shape that describes the form in one part instead of approximating it with several:
  "extrude" for a silhouette with thickness (a fish body, a leaf, a bracket, a blade),
  "lathe" for anything turned around an axis (a bowl, a bottle, a limb, a head, a knob),
  "capsule" for rounded tubes (arms, legs, fingers, handles),
  "mesh" with positions+indices for a surface none of those describe.
  Boxes and cylinders are for genuinely boxy or cylindrical parts, not as a substitute for a curve.
- Set "subdivisions":1 on every smooth organic surface and "segments":64 on lathes, cylinders,
  cones and capsules. The defaults look faceted.
- Symmetry: build ONE side and set "mirror": true on it. The app mirrors it exactly across x=0.
  Do not hand-place a left and a right copy — they will never match, and the app will not fix it.
- Every part must touch or overlap another. One object, nothing floating beside it.
- Do not add audit markers, rings, reference planes, rulers or floor pads. The app measures
  clearance, balance and floor contact itself, and anything like that becomes an unwanted part.
- Axes: +Y is up, +X is right, +Z is towards the viewer. Orient the object the way it rests
  in life: a fish, a car, a plane and an animal lie along a HORIZONTAL axis with their length
  on X or Z, not standing on end. A bottle, a lamp or a person stands with its length on Y.
  If the object has a front, face it towards +Z.
- The app puts the model on the floor. Build it around the origin and do not compensate.
- Name each part for what it is ("body", "dorsal fin", "handle"), so it can be found in the outliner.
- Style target: ${prefs.style}. Detail target: ${prefs.detail}. Output target: ${prefs.output}.
- For 3D print, keep parts visibly connected and avoid tiny fragile details. For GLB, keep parts
  separate and named with clean pivots.
- Keep coordinates within roughly -3..3 unless needed.`;
    const user = `Design this as a complete 3D model, ready to preview and export.
Prompt: ${prompt}

Reference brief from web search:
${referenceBrief || "No external reference brief available; infer from general object knowledge."}`;
    const text = await api.ollamaChat(model, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], null, signal);
    try {
      return parsePlan(text);
    } catch (err) {
      log("God Agent", `JSON repair pass · ${err.message || err}`, "warn");
      const repaired = await repairForgeJson("object", prompt, text, signal, model);
      return parsePlan(repaired);
    }
  }


  function parsePlan(text) {
    const parsed = parseJsonPayload(text, "object");
    const plan = normalizePlan(parsed);
    if (plan.nodes.length < 2) throw new Error("plan had fewer than 2 nodes");
    return plan;
  }

  function isSkullPrompt(prompt) {
    return /\b(skull|cranium|human skull)\b/i.test(String(prompt || ""));
  }

  function isAnimalPrompt(prompt) {
    return /\b(cat|kitten|dog|puppy|horse|lion|tiger|wolf|fox|bear|rabbit|deer|cow|bull|goat|sheep|elephant|giraffe|zebra|animal)\b/i.test(String(prompt || ""));
  }

  function reconstructSpoonStructure(prompt, plan) {
    const normalized = normalizePlan(plan);
    if (!isSpoonLikePrompt(prompt)) return normalized;
    const text = normalized.nodes.map((n) => `${n.id} ${n.name} ${n.type}`).join(" ").toLowerCase();
    const hasSpoonMesh = /\b(concave .*bowl|spoon_bowl|tapered .*handle|spoon_handle)\b/.test(text);
    const meshCount = normalized.nodes.filter((n) => n.type === "mesh").length;
    if (hasSpoonMesh && meshCount >= 5 && normalized.nodes.length >= 12) return normalized;
    const steel = "#cfd8d4";
    const bright = "#f5fbf7";
    const shadow = "#7f8b87";
    const dark = "#424c49";
    const nodes = [
      spoonBowlMesh("spoon_bowl_concave", "Concave oval spoon bowl polished metal mesh", "structure", [0.82, 0.03, 0], 0.62, 0.38, 0.14, steel),
      torus("spoon_bowl_raised_rim", "Raised oval bowl rim lip polished metal", "surface", [0.82, 0.08, 0], 0.38, 0.018, bright, [Math.PI / 2, 0, 0]),
      spoonBowlMesh("spoon_inner_shadow", "Inner concave scoop shadow surface", "surface", [0.82, 0.018, 0], 0.48, 0.29, 0.09, shadow),
      taperedHandleMesh("spoon_handle_tapered", "Long tapered spoon handle polished metal mesh", "structure", [-0.58, 0.025, 0], 1.86, 0.22, 0.11, 0.045, steel),
      taperedHandleMesh("spoon_handle_top_highlight", "Raised handle center highlight ridge", "surface", [-0.58, 0.064, 0], 1.55, 0.085, 0.045, 0.012, bright),
      tubeMesh("spoon_neck_transition", "Curved neck transition from handle into bowl", "structure", [[0.12, 0.045, 0], [0.28, 0.056, 0], [0.43, 0.062, 0]], 0.07, steel),
      tubeMesh("spoon_left_shoulder", "Left bowl shoulder blend into neck", "surface", [[0.24, 0.06, -0.055], [0.43, 0.07, -0.19], [0.63, 0.075, -0.3]], 0.018, bright),
      tubeMesh("spoon_right_shoulder", "Right bowl shoulder blend into neck", "surface", [[0.24, 0.06, 0.055], [0.43, 0.07, 0.19], [0.63, 0.075, 0.3]], 0.018, bright),
      tubeMesh("spoon_left_handle_bevel", "Left handle rolled bevel edge", "detail", [[-1.5, 0.05, -0.055], [-0.85, 0.058, -0.082], [-0.02, 0.055, -0.108]], 0.011, bright),
      tubeMesh("spoon_right_handle_bevel", "Right handle rolled bevel edge", "detail", [[-1.5, 0.05, 0.055], [-0.85, 0.058, 0.082], [-0.02, 0.055, 0.108]], 0.011, bright),
      ellipsoidMesh("spoon_handle_rounded_end", "Rounded handle end cap polished metal", "surface", [-1.54, 0.032, 0], [0.075, 0.026, 0.105], steel),
      tubeMesh("spoon_bowl_left_specular_line", "Left bowl specular metal highlight", "detail", [[0.62, 0.096, -0.19], [0.85, 0.112, -0.24], [1.12, 0.09, -0.14]], 0.009, bright),
      tubeMesh("spoon_bowl_right_specular_line", "Right bowl specular metal highlight", "detail", [[0.62, 0.096, 0.19], [0.85, 0.112, 0.24], [1.12, 0.09, 0.14]], 0.009, bright),
      ellipsoidMesh("spoon_bowl_deep_scoop_center", "Deepest point of concave scoop", "detail", [0.88, -0.056, 0], [0.16, 0.018, 0.11], dark),
    ];
    nodes[1].scale = [1.55, 0.18, 1];
    log("Surface Agent", `Reconstructed spoon-specific CAD mesh · ${nodes.length} mesh node(s)`, "ok");
    return { ...normalized, name: "Polished metal spoon", nodes: nodes.slice(0, MAX_FORGE_NODES) };
  }

  function ellipsoidMesh(id, name, role, position, radii, color, rotation) {
    return { id, name, role, type: "mesh", position, rotation: rotation || [0, 0, 0], scale: [1, 1, 1], params: makeEllipsoidMeshParams(radii[0], radii[1], radii[2]), color, opacity: 0.98 };
  }

  function spoonBowlMesh(id, name, role, position, length, width, depth, color) {
    return { id, name, role, type: "mesh", position, rotation: [0, 0, 0], scale: [1, 1, 1], params: makeConcaveOvalBowlMeshParams(length, width, depth), color, opacity: 0.98 };
  }

  function taperedHandleMesh(id, name, role, position, length, wide, narrow, thickness, color) {
    return { id, name, role, type: "mesh", position, rotation: [0, 0, 0], scale: [1, 1, 1], params: makeTaperedHandleMeshParams(length, wide, narrow, thickness), color, opacity: 0.98 };
  }

  function coneMesh(id, name, role, position, radii, color, rotation) {
    return { id, name, role, type: "mesh", position, rotation: rotation || [0, 0, 0], scale: [1, 1, 1], params: makeConeMeshParams(radii[0], radii[1], radii[2]), color, opacity: 0.98 };
  }

  function makeConcaveOvalBowlMeshParams(length, width, depth, radial = 24, rings = 8) {
    const positions = [];
    const indices = [];
    for (let ring = 0; ring <= rings; ring++) {
      const r = ring / rings;
      const y = -depth * Math.pow(1 - r, 1.55) + (ring === rings ? depth * 0.18 : 0);
      for (let i = 0; i < radial; i++) {
        const a = i / radial * Math.PI * 2;
        const taper = 1 - 0.12 * Math.max(0, -Math.cos(a));
        positions.push(Math.cos(a) * length * 0.5 * r * taper, y, Math.sin(a) * width * 0.5 * r);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let i = 0; i < radial; i++) {
        const a = ring * radial + i;
        const b = ring * radial + ((i + 1) % radial);
        const c = (ring + 1) * radial + i;
        const d = (ring + 1) * radial + ((i + 1) % radial);
        indices.push(a, c, b, b, c, d);
      }
    }
    return { positions, indices, subdivisions: 1 };
  }

  function makeTaperedHandleMeshParams(length, wide, narrow, thickness, segments = 10) {
    const positions = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = -length / 2 + t * length;
      const halfW = (wide + (narrow - wide) * t) / 2;
      const crown = Math.sin(t * Math.PI) * thickness * 0.22;
      positions.push(x, thickness / 2 + crown, -halfW, x, thickness / 2 + crown, halfW, x, -thickness / 2, -halfW * 0.88, x, -thickness / 2, halfW * 0.88);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 4;
      const b = (i + 1) * 4;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
      indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      indices.push(a, a + 2, b, a + 2, b + 2, b);
      indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
    }
    indices.push(0, 1, 2, 1, 3, 2);
    const end = segments * 4;
    indices.push(end, end + 2, end + 1, end + 1, end + 2, end + 3);
    return { positions, indices, subdivisions: 1 };
  }

  function tubeMesh(id, name, role, points, radius, color) {
    const start = points[0] || [0, 0, 0];
    return { id, name, role, type: "mesh", position: start, rotation: [0, 0, 0], scale: [1, 1, 1], params: makeTubeMeshParams(points.map((p) => [p[0] - start[0], p[1] - start[1], p[2] - start[2]]), radius), color, opacity: 0.98 };
  }

  function makeEllipsoidMeshParams(rx, ry, rz, seg = 28, rings = 18) {
    const positions = [];
    const indices = [];
    for (let y = 0; y <= rings; y++) {
      const v = y / rings;
      const phi = v * Math.PI;
      for (let x = 0; x <= seg; x++) {
        const u = x / seg;
        const theta = u * Math.PI * 2;
        positions.push(rx * Math.sin(phi) * Math.cos(theta), ry * Math.cos(phi), rz * Math.sin(phi) * Math.sin(theta));
      }
    }
    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < seg; x++) {
        const a = y * (seg + 1) + x;
        const b = a + seg + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions, indices, subdivisions: 1 };
  }

  function makeConeMeshParams(rx, height, rz, seg = 14) {
    const positions = [0, height / 2, 0, 0, -height / 2, 0];
    const indices = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * Math.PI * 2;
      positions.push(rx * Math.cos(a), -height / 2, rz * Math.sin(a));
    }
    for (let i = 0; i < seg; i++) {
      const cur = 2 + i;
      const next = 2 + ((i + 1) % seg);
      indices.push(0, cur, next, 1, next, cur);
    }
    return { positions, indices, subdivisions: 1 };
  }

  function makeTubeMeshParams(points, radius, radial = 10) {
    const positions = [];
    const indices = [];
    const pts = points.length >= 2 ? points : [[0, 0, 0], [0, 1, 0]];
    pts.forEach((p, i) => {
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const prev = pts[Math.max(0, i - 1)];
      const tangent = normalize3([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]);
      const up = Math.abs(tangent[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
      const side = normalize3(cross3(tangent, up));
      const normal = normalize3(cross3(side, tangent));
      for (let r = 0; r < radial; r++) {
        const a = r / radial * Math.PI * 2;
        positions.push(p[0] + (side[0] * Math.cos(a) + normal[0] * Math.sin(a)) * radius, p[1] + (side[1] * Math.cos(a) + normal[1] * Math.sin(a)) * radius, p[2] + (side[2] * Math.cos(a) + normal[2] * Math.sin(a)) * radius);
      }
    });
    for (let i = 0; i < pts.length - 1; i++) {
      for (let r = 0; r < radial; r++) {
        const a = i * radial + r;
        const b = i * radial + ((r + 1) % radial);
        const c = (i + 1) * radial + r;
        const d = (i + 1) * radial + ((r + 1) % radial);
        indices.push(a, c, b, b, c, d);
      }
    }
    return { positions, indices, subdivisions: 1 };
  }

  function normalize3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function parseJsonPayload(text, expected) {
    const raw = String(text || "").trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const source = fenced ? fenced[1] : raw;
    const candidates = [];
    const primary = extractJsonSpan(source, expected);
    if (primary) candidates.push(primary);
    candidates.push(source);
    for (const candidate of candidates) {
      const cleaned = cleanJsonLike(candidate);
      try {
        const parsed = JSON.parse(cleaned);
        if (expected === "array" && !Array.isArray(parsed)) continue;
        if (expected === "object" && (!parsed || Array.isArray(parsed) || typeof parsed !== "object")) continue;
        return parsed;
      } catch {}
    }
    throw new Error("could not parse JSON " + expected);
  }

  async function repairForgeJson(expected, prompt, badText, signal, modelValue) {
    const api = window._H;
    const model = modelValue || selectedModelFor("god");
    if (!api?.ollamaChat || !model) throw new Error("no JSON repair model");
    const schema = expected === "array"
      ? `[{"id":"stable_unique_id","name":"part","type":"mesh|lathe|extrude|capsule|sphere|cone|torus|box|cylinder","role":"structure|surface|detail","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"params":{},"color":"#9b7a46"}]`
      : `{"name":"short model name","nodes":[{"id":"stable_id","name":"part name","type":"mesh|lathe|extrude|capsule|sphere|cone|torus|box|cylinder","role":"structure|surface|detail|audit","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"params":{},"color":"#9b7a46"}],"edges":[],"constraints":[]}`;
    return await api.ollamaChat(model, [
      {
        role: "system",
        content: `You are a strict JSON repair tool. Return only valid JSON, no markdown, no comments, no prose. The output must be a JSON ${expected}. Use double quotes for every key and string. Remove trailing commas. If the input is prose, infer the closest valid Forge geometry JSON. Schema example: ${schema}`,
      },
      {
        role: "user",
        content: `Prompt: ${prompt}\n\nMalformed model output to repair:\n${String(badText || "").slice(0, 9000)}`,
      },
    ], null, signal);
  }

  function extractJsonSpan(text, expected) {
    const open = expected === "array" ? "[" : "{";
    const close = expected === "array" ? "]" : "}";
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start < 0 || end <= start) return "";
    return text.slice(start, end + 1);
  }

  function cleanJsonLike(text) {
    return String(text || "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([}\]])/g, "$1")
      .trim();
  }

  function fallbackPlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    if ((/iphone|phone|smartphone|mobile/.test(q) || /laptop|macbook|notebook|computer/.test(q)) && /table|desk|workbench/.test(q)) return electronicsDeskScenePlan(prompt);
    if (isSpoonLikePrompt(q)) return spoonPlan(prompt);
    if (isKnifeLikePrompt(q)) return knifePlan(prompt);
    if (isSwordLikePrompt(q)) return swordPlan(prompt);
    if (/person|human|humanoid|character|man|woman|body|anatomy|skeleton/.test(q)) return personPlan(prompt);
    if (/iphone|phone|smartphone|mobile/.test(q)) return phonePlan(prompt);
    if (/laptop|macbook|notebook|computer/.test(q)) return laptopPlan(prompt);
    if (/table|desk|workbench|bench|dining/.test(q)) return tablePlan(prompt);
    if (/rover|car|vehicle|truck/.test(q)) return roverPlan();
    if (/house|building|cabin|villa|home/.test(q)) return housePlan();
    if (isDroneLikePrompt(q)) return dronePlan(prompt);
    if (/tower|skyscraper|castle/.test(q)) return towerPlan();
    if (/watch|clock|gear|mechanism/.test(q)) return mechanismPlan();
    return genericPlan(prompt);
  }

  /**
   * One subject, centred and grounded.
   *
   * Six branches used to sit here, each testing the generated plan against a
   * hand-written idea of what a phone, a laptop, a drone, a knife, an animal
   * or a skull should contain — and replacing it with built-in geometry when
   * it disagreed. So the app asked a model to design something, paid for the
   * answer, and then quietly served a template instead, logging it as a
   * rebuild. It also made the design prompt untestable: a good generation and
   * a substituted one looked the same on screen.
   *
   * The built-in plans still exist and are still reachable — Mock builds from
   * them deliberately. What has gone is their power to overrule a real answer.
   */
  function enforceSingleMainModel(prompt, plan) {
    return centerPlanOnAxis(keepLargestConnectedModel(prompt, normalizePlan(plan)));
  }

  function keepLargestConnectedModel(prompt, plan) {
    const normalized = normalizePlan(plan);
    if (allowsMultipleForgeSubjects(prompt)) return normalized;
    const nodes = renderableNodes(normalized.nodes);
    if (nodes.length < 4) return normalized;
    const stats = connectedModelStats(nodes);
    if (stats.clusterCount <= 1 || !stats.largestCluster.length) return normalized;
    if (stats.largestCount < Math.max(4, nodes.length * 0.45)) return normalized;
    const keepIds = new Set(stats.largestCluster.map((node) => node.id));
    const removed = nodes.length - keepIds.size;
    if (removed <= 0) return normalized;
    normalized.nodes = normalized.nodes.filter((node) => node.role === "audit" || keepIds.has(node.id));
    log("Audit Agent", `Removed ${removed} detached part(s) outside the main model`, "warn");
    return normalized;
  }

  function allowsMultipleForgeSubjects(prompt) {
    const q = String(prompt || "").toLowerCase();
    return /\b(two|three|four|five|pair|set of|collection|group|scene|diorama|room|city|street|landscape)\b/.test(q)
      || /\bon (a |the )?(table|desk|workbench|floor|shelf)\b/.test(q);
  }

  function connectedModelStats(nodes) {
    const items = (Array.isArray(nodes) ? nodes : [])
      .map((node, index) => {
        const extents = nodeApproxExtents(node);
        const radius = Math.max(0.035, Math.hypot(extents[0], extents[1], extents[2]));
        return {
          node,
          index,
          center: vec3(node.position, [0, 0, 0]),
          radius,
        };
      });
    if (!items.length) return { clusterCount: 0, largestCount: 0, largestCluster: [] };
    const box = boundsForNodes(items.map((item) => item.node));
    const size = box ? [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]] : [1, 1, 1];
    const diag = Math.max(0.5, Math.hypot(size[0], size[1], size[2]));
    const slack = Math.max(0.22, Math.min(0.75, diag * 0.14));
    const parent = items.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const unite = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
        if (d <= a.radius + b.radius + slack) unite(i, j);
      }
    }
    const groups = new Map();
    items.forEach((item, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(item.node);
    });
    const clusters = Array.from(groups.values()).sort((a, b) => b.length - a.length);
    return {
      clusterCount: clusters.length,
      largestCount: clusters[0]?.length || 0,
      largestCluster: clusters[0] || [],
    };
  }

  /**
   * Centre the model over the origin on X and Z. Height is deliberately not
   * touched.
   *
   * This used to ground the model too, to FLOOR_Y + 0.015, using its own
   * estimate of where the bottom is — and then the deterministic stage grounded
   * it again to zero using a different estimate. Two approximations of the same
   * quantity, both applied, the second silently winning: on the sample plan
   * they disagreed by 0.30, which is a third of a model. Grounding now happens
   * once, in src/js/model-plan.js, where it is the tested one.
   *
   * Both are still estimates from a part's declared parameters rather than its
   * rendered geometry, and neither accounts for rotation. Grounding from the
   * real bounds after the meshes exist is the honest fix and is not done yet.
   */
  function centerPlanOnAxis(plan) {
    const normalized = normalizePlan(plan);
    const nodes = renderableNodes(normalized.nodes);
    const box = boundsForNodes(nodes);
    if (!box) return normalized;
    const dx = -((box.min[0] + box.max[0]) / 2);
    const dz = -((box.min[2] + box.max[2]) / 2);
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return normalized;
    normalized.nodes = normalized.nodes.map((node) => ({
      ...node,
      position: [
        (node.position?.[0] || 0) + dx,
        (node.position?.[1] || 0),
        (node.position?.[2] || 0) + dz,
      ],
    }));
    return normalized;
  }

  function boundsForNodes(nodes) {
    if (!nodes.length) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    nodes.forEach((node) => {
      const p = node.position || [0, 0, 0];
      const e = nodeApproxExtents(node);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], (p[i] || 0) - e[i]);
        max[i] = Math.max(max[i], (p[i] || 0) + e[i]);
      }
    });
    return { min, max };
  }

  function nodeApproxExtents(node) {
    const p = node.params || {};
    const s = node.scale || [1, 1, 1];
    if (node.type === "mesh" && Array.isArray(p.positions) && p.positions.length >= 9) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
          const value = Number(p.positions[i + axis]) || 0;
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      return [
        Math.max(0.02, ((max[0] - min[0]) / 2) * Math.abs(s[0] || 1)),
        Math.max(0.02, ((max[1] - min[1]) / 2) * Math.abs(s[1] || 1)),
        Math.max(0.02, ((max[2] - min[2]) / 2) * Math.abs(s[2] || 1)),
      ];
    }
    if (node.type === "box" || node.type === "extrude") return [(p.width || 1) * (s[0] || 1) / 2, (p.height || p.depth || 1) * (s[1] || 1) / 2, (p.depth || 1) * (s[2] || 1) / 2];
    if (node.type === "cylinder" || node.type === "capsule" || node.type === "cone") return [(p.radius || 0.2) * (s[0] || 1), (p.height || p.length || 1) * (s[1] || 1) / 2, (p.radius || 0.2) * (s[2] || 1)];
    if (node.type === "sphere") return [(p.radius || 0.3) * (s[0] || 1), (p.radius || 0.3) * (s[1] || 1), (p.radius || 0.3) * (s[2] || 1)];
    if (node.type === "torus") return [(p.radius || 0.5) * (s[0] || 1), (p.tube || 0.05) * (s[1] || 1), (p.radius || 0.5) * (s[2] || 1)];
    return [0.3, 0.3, 0.3];
  }

  function localRoleAdditions(role, prompt, plan) {
    const fallback = fallbackPlan(prompt);
    const existing = new Set((plan.nodes || []).map((n) => `${n.name}`.toLowerCase()));
    return fallback.nodes
      .filter((node) => node.role === role && !existing.has(`${node.name}`.toLowerCase()))
      .map((node, i) => ({ ...node, id: `fallback_${role}_${Date.now().toString(36)}_${i}_${node.id}` }))
      .slice(0, role === "detail" ? 6 : 4);
  }

  function spoonPlan(prompt) {
    return reconstructSpoonStructure(prompt || "spoon", { name: "Polished metal spoon", nodes: [] });
  }

  function knifePlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const chef = /chef|kitchen/.test(q);
    const dagger = /dagger|combat|tactical/.test(q);
    const bladeLen = chef ? 2.25 : dagger ? 1.85 : 1.55;
    const bladeWidth = chef ? 0.36 : dagger ? 0.22 : 0.18;
    const nodes = [
      box("blade_core", chef ? "Chef knife blade body" : "Knife blade body", "structure", [0.42, 0.18, 0], [bladeLen, 0.08, bladeWidth], "#d9dee2"),
      box("blade_spine", "Straight blade spine", "surface", [0.36, 0.235, -bladeWidth * 0.42], [bladeLen * 0.92, 0.035, 0.035], "#f4f7f8"),
      box("blade_edge", "Sharpened cutting edge", "surface", [0.42, 0.13, bladeWidth * 0.46], [bladeLen * 0.95, 0.035, 0.045], "#f4f7f8", [0, 0, -0.018]),
      cone("blade_tip", "Pointed blade tip", "structure", [0.42 + bladeLen / 2 + 0.18, 0.18, 0], bladeWidth * 0.52, 0.36, "#eef3f5", [0, 0, -Math.PI / 2]),
      box("blade_fuller", "Central blade groove", "detail", [0.36, 0.245, 0.006], [bladeLen * 0.58, 0.022, 0.026], "#6f8794"),
      box("tang", "Full tang", "structure", [-0.78, 0.18, 0], [0.72, 0.055, 0.1], "#9aa4a8"),
      box("guard", "Finger guard bolster", "structure", [-0.42, 0.18, 0], [0.09, 0.22, 0.34], "#c9a96e"),
      box("handle_core", "Ergonomic handle", "structure", [-1.14, 0.18, 0], [0.8, 0.16, 0.26], "#4b3428"),
      box("left_handle_scale", "Left handle scale", "surface", [-1.14, 0.245, -0.08], [0.76, 0.045, 0.1], "#6d4328"),
      box("right_handle_scale", "Right handle scale", "surface", [-1.14, 0.115, 0.08], [0.76, 0.045, 0.1], "#6d4328"),
      sphere("rivet_front", "Front handle rivet", "detail", [-0.89, 0.285, 0.11], 0.035, "#f5c97a"),
      sphere("rivet_back", "Back handle rivet", "detail", [-1.35, 0.285, 0.11], 0.035, "#f5c97a"),
      box("pommel_cap", "Handle end cap", "detail", [-1.58, 0.18, 0], [0.08, 0.18, 0.28], "#c9a96e"),
    ];
    if (dagger) {
      nodes.push(box("upper_edge", "Upper sharpened edge", "surface", [0.36, 0.23, -bladeWidth * 0.46], [bladeLen * 0.82, 0.03, 0.04], "#f4f7f8"));
    }
    return { name: chef ? "Forged chef knife" : dagger ? "Forged dagger" : "Forged knife", nodes };
  }

  function swordPlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const longBlade = /long|great|claymore|two.hand|two-hand/.test(q);
    const curved = /katana|curved|saber|sabre/.test(q);
    const bladeLen = longBlade ? 4.2 : 3.15;
    const bladeY = 0.72;
    const nodes = [
      box("blade_core", "Long blade body", "structure", [0, bladeY, 0], [0.22, bladeLen, 0.055], "#d9dee2"),
      cone("blade_tip", "Piercing blade tip", "structure", [0, bladeY + bladeLen / 2 + 0.24, 0], 0.19, 0.52, "#eef3f5", [0, 0, Math.PI / 4]),
      box("blade_ridge", "Central fuller ridge", "detail", [0, bladeY + 0.2, 0.035], [0.035, bladeLen * 0.78, 0.018], "#9fb0ba"),
      box("left_edge", "Left sharpened bevel", "surface", [-0.14, bladeY + 0.12, 0.01], [0.055, bladeLen * 0.94, 0.035], "#f4f7f8", [0, 0, curved ? -0.035 : 0]),
      box("right_edge", "Right sharpened bevel", "surface", [0.14, bladeY + 0.12, 0.01], [0.055, bladeLen * 0.94, 0.035], "#f4f7f8", [0, 0, curved ? 0.035 : 0]),
      box("guard_bar", "Cross guard", "structure", [0, -1.05, 0], [1.18, 0.13, 0.16], "#c9a96e"),
      sphere("guard_left_cap", "Left guard cap", "detail", [-0.66, -1.05, 0], 0.12, "#f5c97a"),
      sphere("guard_right_cap", "Right guard cap", "detail", [0.66, -1.05, 0], 0.12, "#f5c97a"),
      cyl("grip_core", "Leather grip core", "structure", [0, -1.55, 0], 0.15, 0.78, "#4b3428"),
      torus("grip_ring_top", "Top grip ring", "detail", [0, -1.18, 0], 0.17, 0.025, "#8fb7ff"),
      torus("grip_ring_mid", "Middle grip ring", "detail", [0, -1.55, 0], 0.17, 0.022, "#8fb7ff"),
      torus("grip_ring_bottom", "Bottom grip ring", "detail", [0, -1.91, 0], 0.17, 0.025, "#8fb7ff"),
      sphere("pommel", "Weighted pommel", "structure", [0, -2.13, 0], 0.22, "#c9a96e"),
      cyl("pommel_pin", "Pommel pin", "detail", [0, -2.36, 0], 0.055, 0.22, "#f5c97a"),
      box("audit_balance", "Balance audit marker", "audit", [0, -0.55, 0.22], [0.08, 0.08, 0.08], "#ff8f8f"),
      torus("blade_profile_audit", "Blade profile audit ring", "audit", [0, 0.95, 0], 0.36, 0.012, "#ff8f8f", [0, 0, 0]),
      box("shadow_floor_ref", "Floor alignment reference", "audit", [0, -2.48, 0], [1.25, 0.035, 0.18], "#ff8f8f"),
      box("fuller_channel", "Recessed fuller channel", "detail", [0, bladeY + 0.05, 0.062], [0.09, bladeLen * 0.62, 0.014], "#6f8794"),
    ];
    if (curved) {
      nodes.find((n) => n.id === "blade_core").rotation = [0, 0, -0.055];
      nodes.push(box("curve_back_spine", "Curved back spine", "surface", [-0.08, bladeY + 0.42, -0.01], [0.08, bladeLen * 0.82, 0.04], "#d9dee2", [0, 0, -0.08]));
    }
    return { name: "Forged metal long sword", nodes };
  }

  function tablePlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const round = /round|circular|coffee/.test(q);
    const workbench = /workbench|work bench|industrial/.test(q);
    const topColor = workbench ? "#9aa4a8" : "#b88752";
    const edgeColor = workbench ? "#c5d0d3" : "#d4a064";
    const legColor = workbench ? "#5f7478" : "#6d4328";
    const nodes = [];

    if (round) {
      nodes.push(cyl("table_top", "Round tabletop slab", "structure", [0, 0.18, 0], 1.18, 0.16, topColor, [0, 0, 0]));
      nodes.push(torus("table_top_bevel", "Rounded tabletop bevel", "surface", [0, 0.27, 0], 1.18, 0.035, edgeColor));
      nodes.push(cyl("pedestal", "Central pedestal column", "structure", [0, -0.48, 0], 0.16, 1.28, legColor));
      nodes.push(cyl("pedestal_base", "Weighted circular base", "structure", [0, -1.05, 0], 0.54, 0.12, legColor));
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        nodes.push(box(`radial_support_${i}`, `Radial support ${i + 1}`, "surface", [Math.cos(a) * 0.43, -0.02, Math.sin(a) * 0.43], [0.72, 0.055, 0.055], edgeColor, [0, -a, 0]));
        nodes.push(sphere(`screw_${i}`, `Top screw cap ${i + 1}`, "detail", [Math.cos(a) * 0.74, 0.31, Math.sin(a) * 0.74], 0.035, "#8fb7ff"));
      }
      nodes.push(torus("audit_round_clearance", "Round clearance audit", "audit", [0, -1.13, 0], 1.24, 0.012, "#ff8f8f"));
      return { name: "Forged round table", nodes };
    }

    nodes.push(box("table_top", "Tabletop slab", "structure", [0, 0.15, 0], [2.65, 0.16, 1.45], topColor));
    nodes.push(box("front_bevel", "Front chamfered edge", "surface", [0, 0.25, 0.76], [2.72, 0.08, 0.07], edgeColor));
    nodes.push(box("back_bevel", "Back chamfered edge", "surface", [0, 0.25, -0.76], [2.72, 0.08, 0.07], edgeColor));
    nodes.push(box("left_bevel", "Left chamfered edge", "surface", [-1.36, 0.25, 0], [0.07, 0.08, 1.5], edgeColor));
    nodes.push(box("right_bevel", "Right chamfered edge", "surface", [1.36, 0.25, 0], [0.07, 0.08, 1.5], edgeColor));
    nodes.push(box("front_apron", "Front apron rail", "structure", [0, -0.08, 0.62], [2.25, 0.16, 0.08], legColor));
    nodes.push(box("back_apron", "Back apron rail", "structure", [0, -0.08, -0.62], [2.25, 0.16, 0.08], legColor));
    nodes.push(box("left_apron", "Left side apron rail", "structure", [-1.06, -0.08, 0], [0.08, 0.16, 1.05], legColor));
    nodes.push(box("right_apron", "Right side apron rail", "structure", [1.06, -0.08, 0], [0.08, 0.16, 1.05], legColor));

    [
      ["fl", -1.08, 0.52],
      ["fr", 1.08, 0.52],
      ["bl", -1.08, -0.52],
      ["br", 1.08, -0.52],
    ].forEach(([id, x, z]) => {
      nodes.push(cyl(`leg_${id}`, `${id.toUpperCase()} tapered leg`, "structure", [x, -0.56, z], 0.075, 1.18, legColor, [0.07 * Math.sign(x), 0, -0.05 * Math.sign(z)]));
      nodes.push(cyl(`foot_${id}`, `${id.toUpperCase()} leveling foot`, "detail", [x, -1.13, z], 0.115, 0.045, "#8fb7ff"));
      nodes.push(sphere(`bolt_${id}`, `${id.toUpperCase()} apron bolt`, "detail", [x, -0.05, z > 0 ? 0.68 : -0.68], 0.035, "#8fb7ff"));
    });

    nodes.push(box("front_cross_brace", "Front lower cross brace", "surface", [0, -0.83, 0.54], [2.08, 0.055, 0.055], edgeColor));
    nodes.push(box("back_cross_brace", "Back lower cross brace", "surface", [0, -0.83, -0.54], [2.08, 0.055, 0.055], edgeColor));
    nodes.push(box("left_side_brace", "Left side lower brace", "surface", [-1.05, -0.83, 0], [0.055, 0.055, 0.95], edgeColor));
    nodes.push(box("right_side_brace", "Right side lower brace", "surface", [1.05, -0.83, 0], [0.055, 0.055, 0.95], edgeColor));
    nodes.push(box("wood_grain_front", "Front wood grain line", "detail", [0, 0.335, 0.34], [2.28, 0.012, 0.025], "#8fb7ff"));
    nodes.push(box("wood_grain_back", "Back wood grain line", "detail", [0, 0.338, -0.22], [2.12, 0.012, 0.025], "#8fb7ff"));
    nodes.push(box("floor_contact_audit", "Floor contact audit plane", "audit", [0, FLOOR_Y + 0.012, 0], [2.55, 0.025, 1.26], "#ff8f8f"));
    nodes.push(torus("clearance_audit", "Knee clearance audit ring", "audit", [0, -0.44, 0], 0.68, 0.012, "#ff8f8f"));
    return { name: workbench ? "Forged workbench" : "Forged table", nodes };
  }

  function personPlan(prompt) {
    const skeletonOnly = isSkeletonOnlyPrompt(prompt);
    const skeleton = offsetNodes(humanSkeletonLibraryNodes(), [0, 1.02, 0]);
    if (skeletonOnly) return { name: "Anatomical human skeleton", nodes: skeleton };
    return { name: "Anatomical human model", nodes: humanBodyModelNodes(prompt) };
  }

  function humanBodyModelNodes(prompt) {
    const q = String(prompt || "").toLowerCase();
    const skin = /robot|android|cyborg/.test(q) ? "#8fb7ff" : "#c49a7a";
    const deepSkin = /robot|android|cyborg/.test(q) ? "#5f8fd8" : "#9d7358";
    const dark = "#2f2118";
    const nodes = [
      ellipsoid("head", "Anatomical head", "surface", [0, 1.82, 0.03], 0.24, [0.82, 1.08, 0.76], skin),
      capsule("neck", "Neck", "surface", [0, 1.47, 0], 0.105, 0.23, skin),
      ellipsoid("chest", "Ribcage chest mass", "structure", [0, 1.12, 0], 0.42, [1.0, 1.08, 0.58], skin),
      ellipsoid("abdomen", "Abdominal mass", "surface", [0, 0.66, 0.02], 0.34, [0.9, 1.02, 0.55], skin),
      ellipsoid("pelvis", "Pelvic mass", "structure", [0, 0.22, 0], 0.34, [1.12, 0.68, 0.62], deepSkin),
      ellipsoid("left_pectoralis", "Left pectoral plane", "detail", [-0.16, 1.2, 0.25], 0.16, [1.25, 0.45, 0.2], deepSkin),
      ellipsoid("right_pectoralis", "Right pectoral plane", "detail", [0.16, 1.2, 0.25], 0.16, [1.25, 0.45, 0.2], deepSkin),
      capsule("spine_pose_line", "Subtle spinal posture line", "detail", [0, 0.92, -0.27], 0.018, 0.86, "#d9dee2"),
      ellipsoid("left_shoulder", "Left deltoid", "surface", [-0.5, 1.3, 0], 0.15, [1.2, 0.86, 0.82], skin),
      ellipsoid("right_shoulder", "Right deltoid", "surface", [0.5, 1.3, 0], 0.15, [1.2, 0.86, 0.82], skin),
      capsule("left_upper_arm", "Left upper arm", "surface", [-0.69, 0.92, 0], 0.095, 0.52, skin, [0, 0, -0.22]),
      capsule("right_upper_arm", "Right upper arm", "surface", [0.69, 0.92, 0], 0.095, 0.52, skin, [0, 0, 0.22]),
      ellipsoid("left_elbow", "Left elbow", "detail", [-0.78, 0.55, 0], 0.075, [1, 0.85, 0.85], deepSkin),
      ellipsoid("right_elbow", "Right elbow", "detail", [0.78, 0.55, 0], 0.075, [1, 0.85, 0.85], deepSkin),
      capsule("left_forearm", "Left forearm", "surface", [-0.82, 0.2, 0], 0.075, 0.5, skin, [0, 0, -0.08]),
      capsule("right_forearm", "Right forearm", "surface", [0.82, 0.2, 0], 0.075, 0.5, skin, [0, 0, 0.08]),
      ellipsoid("left_hand", "Left hand", "detail", [-0.86, -0.12, 0.03], 0.095, [0.8, 0.42, 1.25], skin),
      ellipsoid("right_hand", "Right hand", "detail", [0.86, -0.12, 0.03], 0.095, [0.8, 0.42, 1.25], skin),
      capsule("left_thigh", "Left thigh", "surface", [-0.2, -0.38, 0], 0.13, 0.72, deepSkin, [0.03, 0, -0.05]),
      capsule("right_thigh", "Right thigh", "surface", [0.2, -0.38, 0], 0.13, 0.72, deepSkin, [0.03, 0, 0.05]),
      ellipsoid("left_knee", "Left knee", "detail", [-0.21, -0.84, 0.04], 0.1, [0.9, 0.72, 0.82], skin),
      ellipsoid("right_knee", "Right knee", "detail", [0.21, -0.84, 0.04], 0.1, [0.9, 0.72, 0.82], skin),
      capsule("left_lower_leg", "Left lower leg", "surface", [-0.21, -1.27, 0], 0.095, 0.7, skin),
      capsule("right_lower_leg", "Right lower leg", "surface", [0.21, -1.27, 0], 0.095, 0.7, skin),
      ellipsoid("left_foot", "Left foot", "detail", [-0.22, -1.72, 0.13], 0.12, [0.75, 0.34, 1.55], skin),
      ellipsoid("right_foot", "Right foot", "detail", [0.22, -1.72, 0.13], 0.12, [0.75, 0.34, 1.55], skin),
      ellipsoid("left_eye", "Left eye", "detail", [-0.075, 1.85, 0.2], 0.022, [1, 0.72, 0.32], "#050505"),
      ellipsoid("right_eye", "Right eye", "detail", [0.075, 1.85, 0.2], 0.022, [1, 0.72, 0.32], "#050505"),
      capsule("nose_bridge", "Nose bridge", "detail", [0, 1.78, 0.225], 0.018, 0.08, deepSkin, [Math.PI / 2, 0, 0]),
      box("mouth_line", "Mouth line", "detail", [0, 1.68, 0.205], [0.13, 0.012, 0.012], dark),
    ];
    if (/skeleton inside|visible skeleton|xray|x-ray|x ray/.test(q)) {
      nodes.push(...offsetNodes(humanSkeletonLibraryNodes().map((node) => ({ ...node, opacity: 0.32 })), [0, 1.02, -0.03]));
    }
    return offsetNodes(nodes, [0, 0.66, 0]);
  }

  function offsetNodes(nodes, offset) {
    return nodes.map((node) => ({
      ...node,
      position: [
        (node.position?.[0] || 0) + (offset?.[0] || 0),
        (node.position?.[1] || 0) + (offset?.[1] || 0),
        (node.position?.[2] || 0) + (offset?.[2] || 0),
      ],
    }));
  }

  function humanSkeletonLibraryNodes() {
    const bone = "#e9edf0";
    const joint = "#8fb7ff";
    const nodes = [
      sphere("skull_cranium", "Skull cranium", "structure", [0, 1.45, 0], 0.24, bone),
      box("mandible", "Mandible jaw bone", "structure", [0, 1.22, 0.04], [0.28, 0.11, 0.18], bone),
      cyl("cervical_spine", "Cervical vertebrae", "structure", [0, 1.06, 0], 0.032, 0.34, bone),
      cyl("thoracic_spine", "Thoracic vertebrae", "structure", [0, 0.55, 0], 0.038, 0.74, bone),
      cyl("lumbar_spine", "Lumbar vertebrae", "structure", [0, -0.12, 0], 0.044, 0.56, bone),
      box("sternum", "Sternum", "structure", [0, 0.46, 0.28], [0.08, 0.5, 0.035], bone),
      box("sacrum", "Sacrum", "structure", [0, -0.48, -0.02], [0.18, 0.22, 0.12], bone),
      box("left_pelvis", "Left pelvic ilium", "structure", [-0.22, -0.48, 0], [0.32, 0.17, 0.28], bone, [0, 0, -0.18]),
      box("right_pelvis", "Right pelvic ilium", "structure", [0.22, -0.48, 0], [0.32, 0.17, 0.28], bone, [0, 0, 0.18]),
      cyl("left_clavicle", "Left clavicle", "structure", [-0.31, 0.86, 0.03], 0.022, 0.58, bone, [0, 0, Math.PI / 2 - 0.18]),
      cyl("right_clavicle", "Right clavicle", "structure", [0.31, 0.86, 0.03], 0.022, 0.58, bone, [0, 0, Math.PI / 2 + 0.18]),
      box("left_scapula", "Left scapula", "structure", [-0.45, 0.58, -0.15], [0.24, 0.33, 0.045], bone, [0.15, 0.15, -0.18]),
      box("right_scapula", "Right scapula", "structure", [0.45, 0.58, -0.15], [0.24, 0.33, 0.045], bone, [0.15, -0.15, 0.18]),
    ];
    for (let i = 0; i < 6; i++) {
      const y = 0.72 - i * 0.1;
      const width = 0.34 + i * 0.035;
      nodes.push(cyl(`left_rib_${i + 1}`, `Left rib ${i + 1}`, "structure", [-width / 2, y, 0.16], 0.014, width, bone, [0.2, 0.35, Math.PI / 2 - 0.2]));
      nodes.push(cyl(`right_rib_${i + 1}`, `Right rib ${i + 1}`, "structure", [width / 2, y, 0.16], 0.014, width, bone, [0.2, -0.35, Math.PI / 2 + 0.2]));
    }
    [
      ["left_humerus", "Left humerus", -0.68, 0.44, 0, 0.036, 0.72, [0, 0, -0.28]],
      ["right_humerus", "Right humerus", 0.68, 0.44, 0, 0.036, 0.72, [0, 0, 0.28]],
      ["left_radius", "Left radius", -0.88, -0.16, 0.035, 0.022, 0.66, [0, 0, -0.08]],
      ["left_ulna", "Left ulna", -0.82, -0.16, -0.035, 0.022, 0.66, [0, 0, -0.08]],
      ["right_radius", "Right radius", 0.88, -0.16, 0.035, 0.022, 0.66, [0, 0, 0.08]],
      ["right_ulna", "Right ulna", 0.82, -0.16, -0.035, 0.022, 0.66, [0, 0, 0.08]],
      ["left_femur", "Left femur", -0.22, -0.88, 0, 0.044, 0.86, [0, 0, -0.08]],
      ["right_femur", "Right femur", 0.22, -0.88, 0, 0.044, 0.86, [0, 0, 0.08]],
      ["left_tibia", "Left tibia", -0.27, -1.63, 0.025, 0.032, 0.82, [0, 0, 0]],
      ["left_fibula", "Left fibula", -0.19, -1.63, -0.025, 0.022, 0.78, [0, 0, 0]],
      ["right_tibia", "Right tibia", 0.27, -1.63, 0.025, 0.032, 0.82, [0, 0, 0]],
      ["right_fibula", "Right fibula", 0.19, -1.63, -0.025, 0.022, 0.78, [0, 0, 0]],
    ].forEach(([id, name, x, y, z, radius, height, rotation]) => nodes.push(cyl(id, name, "structure", [x, y, z], radius, height, bone, rotation)));
    [
      ["left_shoulder_joint", "Left shoulder joint", -0.55, 0.82, 0],
      ["right_shoulder_joint", "Right shoulder joint", 0.55, 0.82, 0],
      ["left_elbow_joint", "Left elbow joint", -0.82, 0.1, 0],
      ["right_elbow_joint", "Right elbow joint", 0.82, 0.1, 0],
      ["left_wrist_joint", "Left wrist joint", -0.91, -0.48, 0],
      ["right_wrist_joint", "Right wrist joint", 0.91, -0.48, 0],
      ["left_hip_joint", "Left hip joint", -0.25, -0.54, 0],
      ["right_hip_joint", "Right hip joint", 0.25, -0.54, 0],
      ["left_knee_joint", "Left knee joint", -0.24, -1.29, 0],
      ["right_knee_joint", "Right knee joint", 0.24, -1.29, 0],
      ["left_ankle_joint", "Left ankle joint", -0.24, -1.99, 0],
      ["right_ankle_joint", "Right ankle joint", 0.24, -1.99, 0],
    ].forEach(([id, name, x, y, z]) => nodes.push(sphere(id, name, "detail", [x, y, z], 0.045, joint)));
    nodes.push(box("left_hand_carpals", "Left hand carpals", "detail", [-0.94, -0.62, 0.03], [0.18, 0.07, 0.12], bone));
    nodes.push(box("right_hand_carpals", "Right hand carpals", "detail", [0.94, -0.62, 0.03], [0.18, 0.07, 0.12], bone));
    nodes.push(box("left_foot_tarsals", "Left foot tarsals", "detail", [-0.25, -2.08, 0.12], [0.2, 0.06, 0.36], bone));
    nodes.push(box("right_foot_tarsals", "Right foot tarsals", "detail", [0.25, -2.08, 0.12], [0.2, 0.06, 0.36], bone));
    nodes.push(sphere("left_patella", "Left patella", "detail", [-0.24, -1.29, 0.08], 0.035, bone));
    nodes.push(sphere("right_patella", "Right patella", "detail", [0.24, -1.29, 0.08], 0.035, bone));
    return nodes;
  }

  function phonePlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const isIphone = /iphone/.test(q);
    const foldable = /fold|flip/.test(q);
    const body = isIphone ? "#1b1f24" : "#111719";
    const edge = isIphone ? "#d7dde0" : "#8fa2ad";
    const glass = "#050708";
    const glow = isIphone ? "#5eead4" : "#60a5fa";
    const nodes = [
      box("phone_frame_plate", isIphone ? "iPhone rounded metal frame plate" : "Smartphone rounded metal frame plate", "structure", [0, 0, 0], [0.68, 0.052, 1.34], edge),
      box("phone_body_inset", "Thin dark phone body inset", "structure", [0, 0.018, 0], [0.61, 0.045, 1.25], body),
      ellipsoid("corner_top_left", "Rounded top left corner cap", "surface", [-0.285, 0.032, -0.59], 0.07, [1, 0.18, 1], edge),
      ellipsoid("corner_top_right", "Rounded top right corner cap", "surface", [0.285, 0.032, -0.59], 0.07, [1, 0.18, 1], edge),
      ellipsoid("corner_bottom_left", "Rounded bottom left corner cap", "surface", [-0.285, 0.032, 0.59], 0.07, [1, 0.18, 1], edge),
      ellipsoid("corner_bottom_right", "Rounded bottom right corner cap", "surface", [0.285, 0.032, 0.59], 0.07, [1, 0.18, 1], edge),
      box("phone_screen_glass", "Black glass display panel", "surface", [0, 0.057, 0.03], [0.55, 0.018, 1.12], glass),
      box("phone_wallpaper_glow", "Display wallpaper glow layer", "surface", [0, 0.069, 0.05], [0.45, 0.006, 0.82], glow),
      box("phone_top_bezel", "Top display bezel", "surface", [0, 0.073, -0.53], [0.49, 0.012, 0.075], "#0b1012"),
      box("phone_bottom_bezel", "Bottom display bezel", "surface", [0, 0.073, 0.59], [0.47, 0.012, 0.055], "#0b1012"),
      box("phone_left_metal_rail", "Left polished metal rail", "surface", [-0.348, 0.034, 0], [0.025, 0.068, 1.12], edge),
      box("phone_right_metal_rail", "Right polished metal rail", "surface", [0.348, 0.034, 0], [0.025, 0.068, 1.12], edge),
      box("phone_dynamic_island", isIphone ? "Dynamic island camera sensor cutout" : "Camera notch sensor cutout", "detail", [0, 0.085, -0.43], [0.2, 0.012, 0.04], "#020303"),
      sphere("selfie_camera_dot", "Selfie camera dot", "detail", [0.11, 0.092, -0.43], 0.016, "#111827"),
      box("earpiece_slot", "Earpiece speaker slot", "detail", [0, 0.091, -0.49], [0.13, 0.008, 0.012], "#1f2937"),
      box("camera_bump", "Raised rear camera island bump", "structure", [-0.17, 0.096, -0.42], [0.25, 0.045, 0.28], isIphone ? "#20262c" : "#263238"),
      cyl("camera_main_ring", "Main camera metal lens ring", "detail", [-0.22, 0.13, -0.48], 0.052, 0.016, edge),
      cyl("camera_wide_ring", "Wide camera metal lens ring", "detail", [-0.11, 0.13, -0.48], 0.046, 0.016, edge),
      cyl("camera_tele_ring", "Telephoto camera metal lens ring", "detail", [-0.22, 0.13, -0.36], 0.044, 0.016, edge),
      cyl("camera_main_glass", "Main camera blue glass", "detail", [-0.22, 0.143, -0.48], 0.036, 0.008, "#8fb7ff"),
      cyl("camera_wide_glass", "Wide camera blue glass", "detail", [-0.11, 0.143, -0.48], 0.031, 0.008, "#8fb7ff"),
      cyl("camera_tele_glass", "Telephoto camera blue glass", "detail", [-0.22, 0.143, -0.36], 0.03, 0.008, "#8fb7ff"),
      cyl("camera_flash_disc", "Camera flash disc", "detail", [-0.1, 0.14, -0.36], 0.023, 0.008, "#f5c97a"),
      sphere("lidar_sensor", "Small LiDAR sensor dot", "detail", [-0.16, 0.142, -0.42], 0.016, "#050505"),
      box("volume_up_button", "Volume up side button", "detail", [-0.372, 0.065, -0.16], [0.014, 0.027, 0.16], edge),
      box("volume_down_button", "Volume down side button", "detail", [-0.372, 0.065, 0.04], [0.014, 0.027, 0.16], edge),
      box("mute_switch", "Mute switch", "detail", [-0.372, 0.066, -0.36], [0.014, 0.024, 0.09], "#f5c97a"),
      box("power_button", "Power button", "detail", [0.372, 0.065, -0.08], [0.014, 0.027, 0.28], edge),
      box("charge_port", "USB-C charging port", "detail", [0, 0.086, 0.67], [0.16, 0.012, 0.026], "#050505"),
      ...Array.from({ length: 6 }, (_, i) => box(`speaker_slot_${i + 1}`, `Bottom speaker slot ${i + 1}`, "detail", [-0.25 + i * 0.1, 0.089, 0.63], [0.045, 0.008, 0.015], "#050505")),
      ...Array.from({ length: 8 }, (_, i) => box(`app_tile_${i + 1}`, `Subtle app tile ${i + 1}`, "detail", [-0.18 + (i % 4) * 0.12, 0.078, -0.18 + Math.floor(i / 4) * 0.14], [0.07, 0.006, 0.07], i % 2 ? "#14b8a6" : "#2563eb")),
      box("home_indicator", "Home indicator pill", "detail", [0, 0.086, 0.49], [0.18, 0.006, 0.018], "#dce4e6"),
      ...(foldable ? [
        box("fold_hinge_line", "Foldable phone hinge line", "detail", [0, 0.093, 0], [0.58, 0.01, 0.018], "#d7dde0"),
      ] : []),
      torus("phone_clearance_audit", "Phone floor clearance audit", "audit", [0, -0.02, 0], 0.73, 0.01, "#ff8f8f"),
    ];
    return { name: isIphone ? "Forged iPhone" : "Forged smartphone", nodes };
  }

  function laptopPlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const isMac = /macbook|apple/.test(q);
    const metal = isMac ? "#b9c0c4" : "#69797d";
    const nodes = [
      box("laptop_base", isMac ? "MacBook aluminum base" : "Laptop base chassis", "structure", [0, 0, 0], [1.65, 0.08, 1.05], metal),
      box("laptop_lid", "Open display lid", "structure", [0, 0.58, -0.48], [1.62, 0.08, 1.02], metal, [-1.05, 0, 0]),
      box("display_panel", "Black display panel", "surface", [0, 0.61, -0.47], [1.44, 0.022, 0.82], "#050708", [-1.05, 0, 0]),
      box("display_glow", "Screen content glow", "detail", [0, 0.625, -0.45], [1.14, 0.014, 0.58], "#4bd2be", [-1.05, 0, 0]),
      cyl("left_hinge", "Left hinge barrel", "structure", [-0.56, 0.1, -0.55], 0.045, 0.28, metal, [0, 0, Math.PI / 2]),
      cyl("right_hinge", "Right hinge barrel", "structure", [0.56, 0.1, -0.55], 0.045, 0.28, metal, [0, 0, Math.PI / 2]),
      box("keyboard_deck", "Keyboard recessed deck", "surface", [0, 0.065, -0.06], [1.18, 0.016, 0.46], "#151b1d"),
      ...Array.from({ length: 12 }, (_, i) => box(`key_${i}`, `Keyboard key ${i + 1}`, "detail", [-0.48 + (i % 6) * 0.19, 0.088, -0.21 + Math.floor(i / 6) * 0.15], [0.13, 0.016, 0.08], "#dce4e6")),
      box("trackpad", "Glass trackpad", "detail", [0, 0.09, 0.34], [0.55, 0.018, 0.28], "#9aaeb2"),
      sphere("webcam", "Webcam dot", "detail", [0, 0.95, -0.82], 0.022, "#050505"),
      box("left_ports", "Left side ports", "detail", [-0.86, 0.04, -0.12], [0.022, 0.032, 0.24], "#050505"),
      box("right_ports", "Right side ports", "detail", [0.86, 0.04, -0.04], [0.022, 0.032, 0.2], "#050505"),
      box("laptop_shadow_audit", "Laptop table-contact audit", "audit", [0, -0.06, 0], [1.72, 0.025, 1.1], "#ff8f8f"),
    ];
    return { name: isMac ? "Forged MacBook" : "Forged laptop", nodes };
  }

  function electronicsDeskScenePlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const nodes = [];
    nodes.push(...prefixNodes(tablePlan(/desk|workbench/.test(q) ? "desk" : "table").nodes, "desk", [0, 0, 0]));
    nodes.push(...prefixNodes(laptopPlan(prompt).nodes.filter((node) => node.role !== "audit"), "laptop", [0.28, 0.37, -0.1]));
    if (/iphone|phone|smartphone|mobile/.test(q)) {
      nodes.push(...prefixNodes(phonePlan(prompt).nodes.filter((node) => node.role !== "audit"), "phone", [-0.82, 0.36, 0.32], [0, 0.02, -0.35]));
    }
    nodes.push(box("scene_clearance_audit", "Desktop scene clearance audit", "audit", [0, FLOOR_Y + 0.014, 0], [2.9, 0.028, 1.7], "#ff8f8f"));
    return { name: "Forged electronics desk scene", nodes: nodes.slice(0, MAX_FORGE_NODES) };
  }

  function prefixNodes(nodes, prefix, offset, extraRotation) {
    return nodes.map((node) => {
      const copy = cloneJson(node);
      copy.id = `${prefix}_${copy.id}`;
      copy.name = `${prefix === "desk" ? "" : prefix + " "}${copy.name || copy.id}`.trim();
      copy.position = [
        (copy.position?.[0] || 0) + (offset?.[0] || 0),
        (copy.position?.[1] || 0) + (offset?.[1] || 0),
        (copy.position?.[2] || 0) + (offset?.[2] || 0),
      ];
      if (extraRotation) {
        copy.rotation = [
          (copy.rotation?.[0] || 0) + (extraRotation[0] || 0),
          (copy.rotation?.[1] || 0) + (extraRotation[1] || 0),
          (copy.rotation?.[2] || 0) + (extraRotation[2] || 0),
        ];
      }
      return copy;
    });
  }

  function genericPlan(prompt) {
    const label = String(prompt || "object").trim().replace(/\s+/g, " ").slice(0, 48) || "object";
    const seed = hashString(label);
    const rand = mulberry32(seed);
    const wide = 1.15 + rand() * 0.65;
    const tall = 0.48 + rand() * 0.5;
    const deep = 0.72 + rand() * 0.55;
    const nodes = [
      box("main_chassis", "Main chassis volume", "structure", [0, 0.1, 0], [wide, tall, deep], "#4bd2be", [0, rand() * 0.16 - 0.08, 0]),
      box("front_face", "Front functional face", "surface", [0, 0.12, deep / 2 + 0.035], [wide * 0.78, tall * 0.62, 0.045], "#f5c97a"),
      box("rear_panel", "Rear service panel", "surface", [0, 0.08, -deep / 2 - 0.03], [wide * 0.62, tall * 0.5, 0.035], "#f5c97a"),
      box("top_module", "Raised top module", "structure", [0.14, 0.42 + tall * 0.35, -0.08], [wide * 0.55, 0.2, deep * 0.42], "#4bd2be"),
      box("base_footprint", "Stable base footprint", "structure", [0, -0.34, 0], [wide * 1.08, 0.12, deep * 1.05], "#4bd2be"),
      cyl("front_lens", "Front circular feature", "detail", [0, 0.16, deep / 2 + 0.07], 0.13, 0.05, "#8fb7ff", [Math.PI / 2, 0, 0]),
      box("left_side_rail", "Left side rail", "surface", [-wide / 2 - 0.055, 0.05, 0], [0.06, tall * 0.55, deep * 0.82], "#f5c97a"),
      box("right_side_rail", "Right side rail", "surface", [wide / 2 + 0.055, 0.05, 0], [0.06, tall * 0.55, deep * 0.82], "#f5c97a"),
      cyl("left_handle_post", "Left handle post", "detail", [-wide * 0.32, 0.55 + tall * 0.35, -0.08], 0.035, 0.42, "#8fb7ff"),
      cyl("right_handle_post", "Right handle post", "detail", [wide * 0.32, 0.55 + tall * 0.35, -0.08], 0.035, 0.42, "#8fb7ff"),
      cyl("top_handle", "Top handle bar", "detail", [0, 0.76 + tall * 0.35, -0.08], 0.035, wide * 0.62, "#8fb7ff", [0, 0, Math.PI / 2]),
      box("control_strip", "Control strip", "detail", [0, 0.34, deep / 2 + 0.086], [wide * 0.46, 0.045, 0.025], "#8fb7ff"),
      ...Array.from({ length: 4 }, (_, i) => sphere(`fastener_${i}`, `Fastener ${i + 1}`, "detail", [(i % 2 ? 1 : -1) * wide * 0.37, i > 1 ? 0.3 : -0.08, deep / 2 + 0.09], 0.035, "#8fb7ff")),
      ...Array.from({ length: 5 }, (_, i) => box(`vent_${i}`, `Vent slot ${i + 1}`, "detail", [-wide * 0.32 + i * wide * 0.16, -0.05, deep / 2 + 0.092], [0.07, 0.018, 0.02], "#050505")),
      box("floor_contact_audit", "Floor contact audit", "audit", [0, FLOOR_Y + 0.012, 0], [wide * 1.15, 0.025, deep * 1.12], "#ff8f8f"),
      torus("clearance_audit", "Object clearance audit", "audit", [0, 0.08, 0], Math.max(wide, deep) * 0.64, 0.012, "#ff8f8f"),
    ];
    return { name: `Forged ${label}`, nodes };
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hLogoPlan() {
    return {
      name: "HashCortx intro mark",
      _introLogo: true,
      nodes: [
        { id: "hcx_teal_halo", name: "Teal halo layer", role: "structure", type: "logo_img",
          position: [0.06, 0.2, -0.08], rotation: [0, 0, 0], scale: [1, 1, 1],
          params: { width: 4.4, height: 2.86, src: "/assets/hashcortx-logo.png" },
          color: "#4bd2be", opacity: 0.26 },
        { id: "hcx_main", name: "HashCortx logo", role: "surface", type: "logo_img",
          position: [0, 0.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
          params: { width: 4.0, height: 2.6, src: "/assets/hashcortx-logo.png" },
          color: "#ffffff", opacity: 0.98 },
        { id: "hcx_gold_sheen", name: "Gold sheen overlay", role: "detail", type: "logo_img",
          position: [-0.03, 0.22, 0.04], rotation: [0, 0, 0], scale: [1, 1, 1],
          params: { width: 4.05, height: 2.63, src: "/assets/hashcortx-logo.png" },
          color: "#c9a96e", opacity: 0.22 },
      ],
    };
  }

  function chairPlan() {
    return {
      name: "Forged ergonomic chair",
      nodes: [
        box("seat", "Seat slab", "structure", [0, 0, 0], [1.7, 0.18, 1.45], "#4bd2be"),
        box("back", "Curved back plane", "surface", [0, 0.92, -0.62], [1.75, 1.55, 0.18], "#f5c97a", [-0.28, 0, 0]),
        cyl("leg_fl", "Front left leg", "structure", [-0.68, -0.78, 0.48], 0.07, 1.45, "#4bd2be"),
        cyl("leg_fr", "Front right leg", "structure", [0.68, -0.78, 0.48], 0.07, 1.45, "#4bd2be"),
        cyl("leg_bl", "Back left leg", "structure", [-0.68, -0.76, -0.48], 0.07, 1.38, "#4bd2be"),
        cyl("leg_br", "Back right leg", "structure", [0.68, -0.76, -0.48], 0.07, 1.38, "#4bd2be"),
        box("arm_l", "Left arm rest", "surface", [-1.02, 0.34, 0], [0.16, 0.16, 1.35], "#f5c97a"),
        box("arm_r", "Right arm rest", "surface", [1.02, 0.34, 0], [0.16, 0.16, 1.35], "#f5c97a"),
        torus("lumbar", "Lumbar detail", "detail", [0, 0.86, -0.75], 0.58, 0.035, "#8fb7ff", [Math.PI / 2, 0, 0]),
        sphere("audit_marker", "Balance marker", "audit", [0, -1.46, 0], 0.09, "#ff8f8f"),
      ],
    };
  }

  function roverPlan() {
    return {
      name: "Forged lunar rover",
      nodes: [
        box("body", "Pressure body", "structure", [0, 0.22, 0], [2.2, 0.55, 1.25], "#4bd2be"),
        box("deck", "Instrument deck", "surface", [0, 0.64, -0.05], [1.55, 0.18, 0.92], "#f5c97a"),
        cyl("wheel_fl", "Wheel front left", "structure", [-0.88, -0.24, 0.72], 0.32, 0.22, "#4bd2be", [Math.PI / 2, 0, 0]),
        cyl("wheel_fr", "Wheel front right", "structure", [0.88, -0.24, 0.72], 0.32, 0.22, "#4bd2be", [Math.PI / 2, 0, 0]),
        cyl("wheel_bl", "Wheel back left", "structure", [-0.88, -0.24, -0.72], 0.32, 0.22, "#4bd2be", [Math.PI / 2, 0, 0]),
        cyl("wheel_br", "Wheel back right", "structure", [0.88, -0.24, -0.72], 0.32, 0.22, "#4bd2be", [Math.PI / 2, 0, 0]),
        cyl("mast", "Sensor mast", "detail", [0.48, 1.08, -0.25], 0.045, 1.05, "#8fb7ff"),
        sphere("camera", "Camera head", "detail", [0.48, 1.68, -0.25], 0.18, "#8fb7ff"),
        box("solar_l", "Left solar wing", "surface", [-1.42, 0.58, 0], [0.85, 0.06, 1.18], "#f5c97a"),
        box("solar_r", "Right solar wing", "surface", [1.42, 0.58, 0], [0.85, 0.06, 1.18], "#f5c97a"),
      ],
    };
  }

  function dronePlan(prompt) {
    const q = String(prompt || "").toLowerCase();
    const heavy = /cinema|camera|professional|heavy|large/.test(q);
    const arm = heavy ? 1.38 : 1.14;
    const gold = "#c9a96e";
    const bright = "#f5d77a";
    const dark = "#070a0d";
    const teal = "#4bd2be";
    const nodes = [
      ellipsoid("fuselage_shell", "Dark rounded avionics body", "structure", [0, 0.02, 0], 0.42, [1.55, 0.36, 0.9], dark, [0, 0, 0], 0.94),
      box("gold_body_frame", "Gold body frame", "surface", [0, 0.075, 0], [0.96, 0.09, 0.54], gold),
      box("front_sensor_panel", "Front sensor panel", "surface", [0, 0.04, 0.44], [0.38, 0.16, 0.055], "#181210"),
      cyl("main_camera_barrel", "Forward camera barrel", "detail", [0.18, 0.04, 0.51], 0.09, 0.09, gold, [Math.PI / 2, 0, 0]),
      cyl("glass_camera_lens", "Glowing camera lens", "detail", [0.18, 0.04, 0.565], 0.055, 0.025, teal, [Math.PI / 2, 0, 0]),
      sphere("status_led", "Pulsing gold status LED", "detail", [-0.18, 0.105, 0.48], 0.035, bright),
      capsule("left_front_arm", "Left front carbon arm", "structure", [-arm * 0.42, 0.03, arm * 0.42], 0.035, arm * 1.1, gold, [0, Math.PI / 4, Math.PI / 2]),
      capsule("right_front_arm", "Right front carbon arm", "structure", [arm * 0.42, 0.03, arm * 0.42], 0.035, arm * 1.1, gold, [0, -Math.PI / 4, Math.PI / 2]),
      capsule("left_rear_arm", "Left rear carbon arm", "structure", [-arm * 0.42, 0.03, -arm * 0.42], 0.035, arm * 1.1, gold, [0, -Math.PI / 4, Math.PI / 2]),
      capsule("right_rear_arm", "Right rear carbon arm", "structure", [arm * 0.42, 0.03, -arm * 0.42], 0.035, arm * 1.1, gold, [0, Math.PI / 4, Math.PI / 2]),
      capsule("left_landing_strut", "Left landing strut", "structure", [-0.34, -0.34, 0.1], 0.025, 0.68, gold, [0.22, 0, 0]),
      capsule("right_landing_strut", "Right landing strut", "structure", [0.34, -0.34, 0.1], 0.025, 0.68, gold, [-0.22, 0, 0]),
      capsule("landing_skid", "Gold landing skid", "structure", [0, -0.72, 0.14], 0.03, 1.08, gold, [0, 0, Math.PI / 2]),
    ];
    [
      ["front_left", -arm, arm, 1],
      ["front_right", arm, arm, -1],
      ["rear_left", -arm, -arm, -1],
      ["rear_right", arm, -arm, 1],
    ].forEach(([id, x, z, spin], i) => {
      nodes.push(cyl(`motor_${id}`, `${labelWords(id)} motor pod`, "structure", [x, 0.06, z], 0.13, 0.13, gold));
      nodes.push(torus(`rotor_guard_${id}`, `${labelWords(id)} rotor halo guard`, "surface", [x, 0.09, z], 0.38, 0.018, gold));
      nodes.push(cyl(`rotor_hub_${id}`, `${labelWords(id)} rotor hub`, "detail", [x, 0.12, z], 0.055, 0.045, bright));
      nodes.push(box(`propeller_a_${id}`, `${labelWords(id)} spinning propeller blade A`, "detail", [x, 0.145, z], [0.7, 0.018, 0.055], bright, [0, i * 0.42, 0]));
      nodes.push(box(`propeller_b_${id}`, `${labelWords(id)} spinning propeller blade B`, "detail", [x, 0.148, z], [0.055, 0.018, 0.7], bright, [0, spin * 0.32, 0]));
      nodes.push(sphere(`rotor_glow_${id}`, `${labelWords(id)} rotor glow core`, "detail", [x, 0.18, z], 0.035, "#fff8c0"));
    });
    nodes.push(box("top_gold_rail", "Top gold electronics rail", "surface", [0, 0.28, -0.04], [0.72, 0.045, 0.16], gold));
    nodes.push(box("battery_pack", "Rear battery pack", "structure", [0, 0.1, -0.42], [0.54, 0.18, 0.22], "#181210"));
    nodes.push(box("battery_gold_cap", "Battery gold cap", "detail", [0, 0.13, -0.55], [0.46, 0.13, 0.035], gold));
    return { name: heavy ? "Forged professional camera drone" : "Forged intro quad drone", nodes };
  }

  function labelWords(id) {
    return String(id).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function housePlan() {
    return {
      name: "Forged modular house",
      nodes: [
        box("base", "Main volume", "structure", [0, 0, 0], [2.5, 1.35, 1.75], "#4bd2be"),
        cone("roof", "Pitched roof", "surface", [0, 1.05, 0], 1.55, 0.95, "#f5c97a", [0, Math.PI / 4, 0]),
        box("door", "Recessed door", "detail", [0, -0.34, 0.9], [0.42, 0.78, 0.08], "#8fb7ff"),
        box("window_l", "Left window", "detail", [-0.72, 0.18, 0.91], [0.42, 0.35, 0.07], "#8fb7ff"),
        box("window_r", "Right window", "detail", [0.72, 0.18, 0.91], [0.42, 0.35, 0.07], "#8fb7ff"),
        cyl("chimney", "Chimney", "surface", [0.82, 1.58, -0.35], 0.12, 0.75, "#f5c97a"),
        box("audit_foundation", "Foundation audit plane", "audit", [0, -0.77, 0], [2.72, 0.06, 1.95], "#ff8f8f"),
      ],
    };
  }

  function towerPlan() {
    const nodes = [cyl("core", "Central tower core", "structure", [0, 0.75, 0], 0.55, 3.2, "#4bd2be")];
    for (let i = 0; i < 6; i++) {
      nodes.push(box(`floor_${i}`, `Cantilever floor ${i + 1}`, i % 2 ? "surface" : "structure", [0, -0.55 + i * 0.52, 0], [1.55 - i * 0.09, 0.08, 1.2 - i * 0.06], i % 2 ? "#f5c97a" : "#4bd2be", [0, i * 0.28, 0]));
    }
    nodes.push(cone("spire", "Signal spire", "detail", [0, 2.78, 0], 0.28, 0.9, "#8fb7ff"));
    nodes.push(torus("audit_ring", "Overhang audit ring", "audit", [0, 1.02, 0], 1.05, 0.02, "#ff8f8f"));
    return { name: "Forged tower study", nodes };
  }

  function mechanismPlan() {
    return {
      name: "Forged watch mechanism",
      nodes: [
        torus("outer", "Outer case ring", "structure", [0, 0, 0], 1.2, 0.08, "#4bd2be"),
        torus("inner", "Inner gear ring", "surface", [0, 0, 0], 0.78, 0.045, "#f5c97a"),
        cyl("hub", "Central hub", "structure", [0, 0, 0], 0.18, 0.16, "#4bd2be"),
        ...Array.from({ length: 12 }, (_, i) => {
          const a = i / 12 * Math.PI * 2;
          return box(`tooth_${i}`, `Gear tooth ${i + 1}`, "detail", [Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78], [0.12, 0.12, 0.26], "#8fb7ff", [0, -a, 0]);
        }),
        box("hand_h", "Hour hand", "surface", [0.25, 0.12, 0], [0.62, 0.04, 0.06], "#f5c97a", [0, 0, -0.3]),
        box("hand_m", "Minute hand", "surface", [0, 0.14, -0.42], [0.05, 0.04, 0.86], "#f5c97a", [0, 0.2, 0]),
      ],
    };
  }

  function box(id, name, role, position, size, color, rotation) {
    return { id, name, role, type: "box", position, rotation: rotation || [0, 0, 0], scale: [1, 1, 1], params: { width: size[0], height: size[1], depth: size[2] }, color };
  }

  function cyl(id, name, role, position, radius, height, color, rotation) {
    return { id, name, role, type: "cylinder", position, rotation: rotation || [0, 0, 0], scale: [1, 1, 1], params: { radius, height, segments: 36 }, color };
  }

  function capsule(id, name, role, position, radius, length, color, rotation, scale, opacity) {
    return { id, name, role, type: "capsule", position, rotation: rotation || [0, 0, 0], scale: scale || [1, 1, 1], params: { radius, length, capSegments: 10, radialSegments: 24 }, color, opacity };
  }

  function sphere(id, name, role, position, radius, color) {
    return { id, name, role, type: "sphere", position, rotation: [0, 0, 0], scale: [1, 1, 1], params: { radius }, color };
  }

  function ellipsoid(id, name, role, position, radius, scale, color, rotation, opacity) {
    return { id, name, role, type: "sphere", position, rotation: rotation || [0, 0, 0], scale: scale || [1, 1, 1], params: { radius, widthSegments: 32, heightSegments: 18 }, color, opacity };
  }

  function cone(id, name, role, position, radius, height, color, rotation) {
    return { id, name, role, type: "cone", position, rotation: rotation || [0, 0, 0], scale: [1, 1, 1], params: { radius, height, segments: 4 }, color };
  }

  function torus(id, name, role, position, radius, tube, color, rotation) {
    return { id, name, role, type: "torus", position, rotation: rotation || [Math.PI / 2, 0, 0], scale: [1, 1, 1], params: { radius, tube }, color };
  }

  function lathe(id, name, role, position, points, color, scale, rotation, opacity) {
    return { id, name, role, type: "lathe", position, rotation: rotation || [0, 0, 0], scale: scale || [1, 1, 1], params: { points, segments: 48 }, color, opacity };
  }

  function logo(id, name, role, position, width, height, style, opacity) {
    return { id, name, role, type: "logo", position, rotation: [0, 0, 0], scale: [1, 1, 1], params: { width, height, text: "H", fontSize: 860, ...(style || {}) }, color: style?.color || "#c9a96e", opacity };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function wireEvents() {
    if (eventsWired) return;
    eventsWired = true;
    $("frgGodBtn")?.addEventListener("click", () => runGodAgent(false));
    $("frgMockBtn")?.addEventListener("click", () => runGodAgent(true));
    $("frgResetViewBtn")?.addEventListener("click", resetView);
    $("frgBackBtn")?.addEventListener("click", () => {
      const back = window._H?.state?._preForgeTab || "chats";
      window._H?.setTab?.(back === "forge" ? "chats" : back);
    });
    $("frgPrompt")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        runGodAgent(false);
      }
    });
    $("frgTraceToggle")?.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const tc = $("frgTraceConsole");
      if (!tc) return;
      const open = !tc.classList.contains("expanded");
      tc.classList.toggle("expanded", open);
      tc.classList.toggle("collapsed", !open);
    });
    $("frgTraceCopyBtn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const text = traceAsText();
      const btn = e.currentTarget;
      if (!text) { btn.textContent = "Empty"; setTimeout(() => { btn.textContent = "Copy"; }, 1200); return; }
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        // No clipboard permission: select it instead, so the keyboard still works.
        const host = $("frgTraceEntries");
        if (host) {
          const range = document.createRange();
          range.selectNodeContents(host);
          const sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(range);
        }
        btn.textContent = "Selected";
      }
      setTimeout(() => { btn.textContent = "Copy"; }, 1400);
    });
    $("frgTraceExportBtn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const text = traceAsText();
      const btn = e.currentTarget;
      if (!text) { btn.textContent = "Empty"; setTimeout(() => { btn.textContent = "Export"; }, 1200); return; }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      let ok = false;
      try {
        const result = await window.HC.save.file(`forge-trace-${stamp}.txt`, new Blob([text], { type: "text/plain" }));
        ok = !!result.saved;
      } catch (err) {
        log("Trace", `could not save: ${err?.message || err}`, "warn");
      }
      btn.textContent = ok ? "Saved" : "Export";
      setTimeout(() => { btn.textContent = "Export"; }, 1400);
    });
    $("frgTraceClearBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const entries = $("frgTraceEntries");
      if (entries) entries.innerHTML = "";
      const summary = $("frgTraceSummary");
      if (summary) summary.textContent = "Trace cleared";
      const dot = $("frgTraceDot");
      if (dot) dot.className = "frg-trace-dot";
    });
    $("frgSelectionCard")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-frg-edit]");
      if (!btn) return;
      const action = btn.dataset.frgEdit;
      if (action === "delete") deleteSelectedPart();
      else if (action === "duplicate") duplicateSelectedPart();
      else if (action === "floor") alignSelectedToFloor();
      else if (action === "reset") resetSelectedPart();
      else if (action === "snap") setSnapEnabled(!snapEnabled);
      else setTransformMode(action);
    });
    $("frgSelectionCard")?.addEventListener("change", (e) => {
      const posAxis = e.target.dataset.frgPos;
      const scaleAxis = e.target.dataset.frgScale;
      const rotAxis = e.target.dataset.frgRot;
      if (posAxis) updateSelectedPosition(posAxis, e.target.value);
      if (scaleAxis) updateSelectedScale(scaleAxis, e.target.value);
      if (rotAxis) updateSelectedRotation(rotAxis, e.target.value);
    });
    $("frgCadToolbar")?.addEventListener("click", (e) => {
      const exportBtn = e.target.closest("[data-frg-export-kind]");
      if (exportBtn) {
        exportForgeAsset(exportBtn.dataset.frgExportKind);
        exportBtn.closest(".frg-export-wrap")?.classList.remove("open");
        return;
      }
      const btn = e.target.closest("[data-frg-tool]");
      if (!btn) return;
      const tool = btn.dataset.frgTool;
      if (tool === "selectObject") selectWholeObject();
      else if (tool === "delete") deleteSelectedPart();
      else if (tool === "duplicate") duplicateSelectedPart();
      else if (tool === "floor") alignSelectedToFloor();
      else if (tool === "snap") setSnapEnabled(!snapEnabled);
      else if (tool === "import") $("frgAssetImport")?.click();
      else if (tool === "focus") focusCameraOnSelection();
      else if (tool === "camUp") panCameraVertical(0.35);
      else if (tool === "camDown") panCameraVertical(-0.35);
      else if (tool === "exportMenu") btn.closest(".frg-export-wrap")?.classList.toggle("open");
      else setTransformMode(tool);
    });
    document.addEventListener("click", (e) => {
      const openExport = document.querySelector(".frg-export-wrap.open");
      if (openExport && !e.target.closest(".frg-export-wrap")) openExport.classList.remove("open");
    });
    $("frgAssetImport")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) importForgeAsset(file);
    });
    $("frgAutoRouteBtn")?.addEventListener("click", () => {
      traceStartTime = Date.now();
      const traceEntries = $("frgTraceEntries");
      if (traceEntries && !traceEntries.children.length) traceEntries.innerHTML = "";
      autoAssignForgeModels(($("frgPrompt")?.value || "").trim(), true);
    });
    $("frgNewProjectBtn")?.addEventListener("click", newForgeProject);
    $("frgSaveProjectBtn")?.addEventListener("click", () => saveCurrentProject(true));
    $("frgProjectsList")?.addEventListener("click", (e) => {
      const del = e.target.closest("[data-frg-project-delete]");
      if (del) {
        e.stopPropagation();
        deleteForgeProject(del.dataset.frgProjectDelete);
        return;
      }
      const item = e.target.closest("[data-frg-project]");
      if (item) openForgeProject(item.dataset.frgProject);
    });
    $("frgPlanList")?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-node-id]");
      if (item) selectNodeById(item.dataset.nodeId);
    });
    window.addEventListener("keydown", (e) => {
      if (!document.body.classList.contains("forge-studio-mode")) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedPart();
      } else if (e.key.toLowerCase() === "a") {
        selectWholeObject();
      } else if (e.key.toLowerCase() === "w") {
        setTransformMode("translate");
      } else if (e.key.toLowerCase() === "r") {
        setTransformMode("rotate");
      } else if (e.key.toLowerCase() === "s") {
        setTransformMode("scale");
      } else if (e.key.toLowerCase() === "d") {
        duplicateSelectedPart();
      } else if (e.key === "Escape") {
        selectMesh(null);
      }
    });
    const mainModel = document.getElementById("model");
    if (mainModel) {
      new MutationObserver(syncModelSelectors).observe(mainModel, { childList: true, subtree: true });
    }
  }

  async function mount() {
    mounted = true;
    loadForgeProjects();
    syncModelSelectors();
    renderForgeProjects();
    // Whatever is loaded, not nothing. Entering Forge a second time used to
    // reset the header to "Void ready · 0 mesh parts" while the model was
    // still in the scene and activePlan still held it — the panel disagreed
    // with the viewport until some later click happened to refresh it.
    updatePlanList(activePlan);
    wireEvents();
    const ok = await initThree();
    if (ok && !activePlan) buildPlan(hLogoPlan());
  }

  function destroy() {
    mounted = false;
    if (abortCtrl) abortCtrl.abort();
  }

  function debugState() {
    return {
      nodeCount: activePlan?.nodes?.length || 0,
      underfloorCount: selectableMeshes().filter((mesh) => mesh.userData?.underFloor).length,
      activeProjectId,
    };
  }

  window.ForgeMode = { mount, destroy, buildPlan, debugState };

  (window._registeredModes = window._registeredModes || {})["forge"] = {
    label:     "3D Forge",
    bodyClass: "forge-studio-mode",
    appClass:  null,
    fullscreen: true,
    btnId:     "tabForge",
    mount:     () => window.ForgeMode?.mount?.(),
    destroy:   () => window.ForgeMode?.destroy?.(),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      renderAgents();
      wireEvents();
    }, { once: true });
  } else {
    renderAgents();
    wireEvents();
  }
})();
