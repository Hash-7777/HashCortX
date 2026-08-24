(function () {
  "use strict";

  // A finished model is one object, and it is drawn as one.
  //
  // Parts used to be coloured by their role — bone, gold, a warm grey — on top
  // of whatever colour the design call had chosen for each of them. The result
  // was that the joins were the loudest thing on screen: a fish read as a beige
  // body next to a gold fin next to a grey tail, three objects standing
  // together rather than one animal. Nothing about a model is per-part, and
  // giving each part its own colour said the opposite.
  //
  // So every part is the same material, the way a piece off a 3D printer is one
  // filament: light neutral, matte, fully opaque, no glow of its own. What
  // separates one part from the next is the shading across the join, which is
  // what a person actually reads shape from. The plan's own "color" is ignored
  // for a real part, and no longer asked for.
  const PRINT_COLOR = 0xd7d2c8;

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
  let renderer = null;
  let scene = null;
  let camera = null;
  let mountResizeObserver = null;
  let controls = null;
  let modelGroup = null;
  let activePlan = null;
  let raf = 0;
  // True between the GPU taking the context away and giving it back. Nothing
  // may draw in between: the render target no longer exists.
  let contextLost = false;
  let revealMeshes = [];
  let logoMeshes = [];
  let logoBobT = 0;
  // How a model arrives: it fades up, whole, in a quarter of a second.
  //
  // Parts used to be assembled on screen. Each one waited its turn, a cloud of
  // motes gathered onto the spot it was going to occupy, and the part faded in
  // among them — about two seconds of ceremony for a twelve-part model, in
  // which the thing a person had asked for was the last thing to appear. It
  // also said the wrong thing about the result: parts arriving one at a time,
  // each trailing its own swarm, is a picture of an assembly of pieces, and the
  // model is one object. The design finished before any of it started.
  const REVEAL_MS = 260;

  let abortCtrl = null;
  // Hand edits are undoable, all the way back to the model as it was built.
  // Each entry is the whole part list before and after one edit: transforms,
  // deletions and duplications are then one mechanism rather than three, and
  // a step replays exactly instead of being approximated.
  const editHistory = window.HCEditHistory
    ? window.HCEditHistory.create({ limit: 60, same: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
    : null;
  let editBefore = null;
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
  // Read once, to carry anything saved before the move to a file. Nothing is
  // written here any more when the app is running as an app.
  const PROJECT_STORE_KEY = "hashui_forge_projects";
  const MAX_SAVED_PROJECTS = 40;
  // Only used if src/js/model-plan.js has not loaded, which would mean the whole
  // deterministic stage is missing. It is the same list that module holds.
  const SHAPE_NAMES = ["box", "cylinder", "capsule", "sphere", "cone", "torus", "lathe", "extrude", "logo", "logo_img", "mesh"];
  const FORGE_ALLOWED_MODEL_PROVIDERS = new Set(["groq", "gemini", "cerebras", "samba", "sambanova", "openrouter", "local"]);
  const FORGE_PROVIDER_COOLDOWNS = new Map();
  let forgeProjects = [];
  // False once a read has failed, so a save cannot write an empty list over a
  // store that may hold everything a person has made.
  let projectStoreWritable = true;
  let activeProjectId = null;
  let projectSaveTimer = 0;
  let activeForgeRoute = "parametric";
  // What one scene unit is worth in millimetres, measured from the model that
  // is actually on screen. Zero until something is built — a factor guessed
  // before there is geometry would be a wrong number shown with confidence.
  let mmPerUnit = 0;
  // The one fused mesh, when it has been asked for. Null the rest of the time,
  // because it is a snapshot: any edit to a part makes it out of date, and a
  // stale solid on screen is worse than no solid.
  let solidMesh = null;

  const $ = (id) => document.getElementById(id);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  /** Whatever is in a store, with anything that is not a project dropped. */
  function readProjects(text) {
    try {
      const parsed = text ? JSON.parse(text) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && Array.isArray(p.plan?.nodes)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Everything saved, from the file the app keeps them in — see
   * src-tauri/src/commands/forge_projects.rs for why it is a file.
   *
   * Anything in the old localStorage key is from before the move, so it is
   * carried across once and left there rather than deleted: a rolled-back
   * version still looks for it where it was.
   *
   * A read that FAILS is not a read that found nothing. Nothing found is an
   * ordinary first run; a failure means a store may exist and could not be
   * opened — so writing is switched off, and the next save refuses instead of
   * replacing a person's models with the empty list this was left holding.
   */
  async function loadForgeProjects() {
    projectStoreWritable = true;
    if (!window.HC?.isTauri) {
      forgeProjects = readProjects(localStorage.getItem(PROJECT_STORE_KEY));
      return;
    }
    try {
      const text = await window.HC.forgeProjects.read();
      if (text) { forgeProjects = readProjects(text); return; }
      const carried = readProjects(localStorage.getItem(PROJECT_STORE_KEY));
      forgeProjects = carried;
      if (carried.length) {
        const moved = await persistForgeProjects();
        log("Projects", moved ? "Saved projects moved into a file" : "Saved projects could not be moved into a file",
          moved ? "ok" : "warn", `${carried.length} project${carried.length === 1 ? "" : "s"}`);
      }
    } catch (err) {
      forgeProjects = [];
      projectStoreWritable = false;
      log("Projects", "Saved projects could not be read — saving is off until this is fixed", "warn",
        String(err?.message || err));
    }
  }

  /**
   * Write the store, and answer whether it was actually written.
   *
   * The old version ended in `catch {}`, so a full quota produced a panel
   * saying the project was saved and nothing on disk — the app confidently
   * wrong about the one thing a person cannot check for themselves. Every
   * caller now takes this answer and says what really happened.
   */
  async function persistForgeProjects() {
    const text = JSON.stringify(forgeProjects.slice(0, MAX_SAVED_PROJECTS));
    if (!window.HC?.isTauri) {
      try { localStorage.setItem(PROJECT_STORE_KEY, text); return true; } catch { return false; }
    }
    if (!projectStoreWritable) return false;
    try {
      await window.HC.forgeProjects.write(text);
      return true;
    } catch (err) {
      log("Projects", "Not saved", "warn", String(err?.message || err));
      return false;
    }
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

  async function saveCurrentProject(manual) {
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
    const written = await persistForgeProjects();
    renderForgeProjects();
    // Said only when it is true. An automatic save that failed is worth a word
    // too: the person is about to close a window believing the work is kept.
    if (written) {
      if (manual) log("Projects", `Saved ${project.name}`, "ok", `${project.plan.nodes.length} mesh parts`);
    } else {
      log("Projects", `${project.name} is NOT saved`, "warn", "the change is only on screen");
    }
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

  async function deleteForgeProject(id) {
    const project = forgeProjects.find((p) => p.id === id);
    if (!project) return;
    if (!confirm(`Delete "${project.name || "Forge Project"}"?`)) return;
    forgeProjects = forgeProjects.filter((p) => p.id !== id);
    if (activeProjectId === id) activeProjectId = null;
    const written = await persistForgeProjects();
    renderForgeProjects();
    log("Projects", written ? "Deleted Forge project" : "Deleted on screen only — the store was not written", "warn");
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
    // The part count alone answers a question nobody asked. How big the thing
    // is, is the first thing a person wants to know about an object they are
    // going to make.
    const measured = modelSizeMm();
    $("frgNodeCount").textContent = `${nodes.length} part${nodes.length === 1 ? "" : "s"}`
      + (measured ? ` · ${measured.text}` : "");
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
      // One drag is one step, however many frames it took. Recording each
      // frame would make undo walk back through the drag a pixel at a time.
      if (event.value) beginEdit();
      else commitEdit(`${transformMode === "translate" ? "move" : transformMode}`);
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
    scene.add(modelGroup);

    const key = new THREE.DirectionalLight(0xf6efe3, 2.1);
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
    const rim = new THREE.DirectionalLight(0xc9a96e, 1.2);
    rim.position.set(-6, 3, -5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x8a857e, 0.45));
    scene.add(new THREE.HemisphereLight(0xd6cfc2, 0x1a1410, 0.5));

    // The floor is a reference, not the subject. It was drawn in white at a
    // third opacity across eighteen units, which put a bright lattice behind
    // every model and left the two competing for attention. Gold, dimmer, and
    // with the centre lines the only ones carrying any weight — the fog the
    // scene already has takes the rest into the dark before the horizon.
    // White, and faint. A floor is a ruler: it should read as neutral against
    // whatever colour the model is, and tinting it gold made the whole scene
    // look lit through a filter.
    const grid = new THREE.GridHelper(18, 36, 0xffffff, 0xffffff);
    grid.position.y = FLOOR_Y;
    grid.material.transparent = true;
    grid.material.opacity = 0.16;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18, 36, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.02,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y - 0.001;   // a hair under the grid, so the lines stay visible
    floor.receiveShadow = true;
    scene.add(floor);

    // A field of 900 twinkling points used to sit behind the model. It said
    // nothing about the model, moved constantly in the corner of the eye, and
    // made a modelling tool look like a screensaver. The room is empty now,
    // which is what a workshop looks like.

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
    updateReveal(now || performance.now());
    if (++underfloorTick % 8 === 0) updateUnderfloorHighlights();
    renderer.render(scene, camera);
  }

  function clearScene() {
    selectMesh(null);
    revealMeshes = [];
    logoMeshes = [];
    logoBobT = 0;
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
  }

  /**
   * The shape itself, built from the numbers the part carries.
   *
   * Every fallback comes from src/js/forge/params.js rather than being written
   * here, because the panel shows those same numbers. Two copies of "how wide
   * is a box that did not say" is a field that reads as the truth and is not:
   * a person types back the number they were shown and the part changes shape.
   */
  function primitiveGeometry(node) {
    const p = node.params || {};
    // Falls back to reading the params directly when the table has not loaded,
    // so a shape is still built rather than the whole model going missing.
    const v = (key, whenAbsent) => {
      const P = window.HCForgeParams;
      const value = P ? P.valueOf(node, key) : undefined;
      return value === undefined ? whenAbsent : value;
    };
    switch (node.type) {
      case "logo":
      case "logo_img":
        return new THREE.PlaneGeometry(v("width", p.width ?? 2.1), v("height", p.height ?? 2.1));
      case "mesh":
        return meshGeometryFromParams(p);
      case "cylinder":
        return new THREE.CylinderGeometry(
          v("radiusTop", p.radiusTop ?? p.radius ?? 0.35),
          v("radiusBottom", p.radiusBottom ?? p.radius ?? 0.35),
          v("height", p.height ?? 1),
          v("segments", p.segments ?? 48));
      case "capsule":
        return new THREE.CapsuleGeometry(
          v("radius", p.radius ?? 0.12),
          v("length", p.length ?? p.height ?? 0.6),
          v("capSegments", p.capSegments ?? 16),
          v("radialSegments", p.radialSegments ?? 32));
      case "sphere":
        return new THREE.SphereGeometry(
          v("radius", p.radius ?? 0.45),
          v("widthSegments", p.widthSegments ?? 48),
          v("heightSegments", p.heightSegments ?? 32));
      case "cone":
        return new THREE.ConeGeometry(
          v("radius", p.radius ?? 0.42),
          v("height", p.height ?? 1),
          v("segments", p.segments ?? 48));
      case "torus":
        return new THREE.TorusGeometry(v("radius", p.radius ?? 0.5), v("tube", p.tube ?? 0.08), 24, 64);
      case "lathe": {
        const pts = Array.isArray(p.points) && p.points.length >= 2
          ? p.points.map((pt) => new THREE.Vector2(Number(pt[0]) || 0.1, Number(pt[1]) || 0))
          : [new THREE.Vector2(0.18, -0.55), new THREE.Vector2(0.42, -0.2), new THREE.Vector2(0.34, 0.42), new THREE.Vector2(0.08, 0.65)];
        return new THREE.LatheGeometry(pts, v("segments", p.segments ?? 64));
      }
      case "extrude": {
        const pts = Array.isArray(p.points) && p.points.length >= 3
          ? p.points.map((pt) => [Number(pt[0]) || 0, Number(pt[1]) || 0])
          : [[-0.35, -0.25], [0.35, -0.25], [0.42, 0.2], [0, 0.45], [-0.42, 0.2]];
        const shape = new THREE.Shape();
        shape.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
        shape.closePath();
        return new THREE.ExtrudeGeometry(shape, {
          depth: v("depth", p.depth ?? 0.18),
          bevelEnabled: true,
          bevelSize: v("bevelSize", p.bevelSize ?? 0.025),
          bevelThickness: v("bevelThickness", p.bevelThickness ?? 0.025),
          bevelSegments: v("bevelSegments", p.bevelSegments ?? 2),
        });
      }
      default:
        return new THREE.BoxGeometry(v("width", p.width ?? 1), v("height", p.height ?? 1), v("depth", p.depth ?? 1));
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
    let geo = subdivideGeometry(geometry, p.subdivisions);
    if (p.center) geo.center();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  /**
   * Denser triangles for the same shape, through src/js/forge/subdivide.js —
   * arithmetic on plain arrays, so the surface it produces can be measured
   * rather than assumed, which a scene needing a GPU cannot be.
   *
   * The result is INDEXED, and that is the point: loose triangles left the
   * normals computed a moment later with nothing to average across, so a shape
   * asked to be smoother came back faceted, and the texture coordinates went
   * with them. A mesh that was not split comes back exactly as it arrived.
   */
  function subdivideGeometry(source, times) {
    const lib = window.HCForgeSubdivide;
    const position = source?.getAttribute?.("position");
    if (!lib || !position) return source;
    const normal = source.getAttribute("normal");
    const uv = source.getAttribute("uv");
    const out = lib.subdivide({
      positions: position.array,
      normals: normal ? normal.array : null,
      uvs: uv ? uv.array : null,
      indices: source.index ? source.index.array : null,
    }, times);
    if (!out.applied) return source;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(out.positions, 3));
    if (out.normals) geo.setAttribute("normal", new THREE.Float32BufferAttribute(out.normals, 3));
    if (out.uvs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(out.uvs, 2));
    geo.setIndex(out.indices);
    source.dispose?.();
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

  function addNodeMesh(node, revealStart) {
    const color = new THREE.Color(PRINT_COLOR);
    const mat = node.type === "logo"
      ? makeLogoMaterial(node)
      : node.type === "logo_img"
      ? makeImageLogoMaterial(node)
      : new THREE.MeshStandardMaterial({
        color,
        // Matte and unpolished. A metallic sheen puts a bright reflection on
        // each part in a different place, which reads as different materials —
        // the pile again, in one colour.
        roughness: 0.72,
        metalness: 0.04,
        // Only so the model can fade in. It is turned off the moment the fade
        // finishes, because a transparent surface is sorted rather than depth
        // tested, and parts that overlap — which every part of a solid model
        // does — show each other through the join.
        transparent: true,
        opacity: 0,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
      });
    if (mat.emissive) {
      mat.userData.baseEmissive = new THREE.Color(0x000000);
      mat.userData.baseEmissiveIntensity = 0;
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
    revealMeshes.push({
      mesh,
      // Every part on the same clock. Staggering them was the last thing left
      // saying "these are separate pieces".
      start: revealStart,
      duration: REVEAL_MS,
      // Solid. Parts used to arrive at 0.86, so the model was slightly
      // see-through and every part behind another showed through it — which
      // makes a single object impossible to read as one.
      targetOpacity: node.type === "logo" || node.type === "logo_img" ? (node.opacity ?? 1) : 1,
    });
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
        mat.emissive.copy(mat.userData.baseEmissive || new THREE.Color(0x000000));
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
    dropSolid();
    activePlan = normalizePlan(plan);
    const nodes = renderableNodes(activePlan.nodes);
    const revealStart = performance.now();
    nodes.forEach((node) => addNodeMesh(node, revealStart));
    groundBuiltModel();
    // Before anything shows a dimension. The badge and the panel both read the
    // factor, so measuring after them labelled the first model with the scale
    // of whatever had been on screen before it.
    measureRealSize();
    updatePlanList(activePlan);
    // The panel holds the whole model's size, and clearing the scene redraws it
    // before the new plan exists — so without this it kept showing the size of
    // the model that had just been replaced.
    renderSelection();
    syncImproveAvailability();
    // A model that has just been built or opened is a new document. Undoing
    // past it would take a person back to a model they were finished with.
    editHistory?.clear();
    editBefore = null;
    syncEditHistoryButtons();
    if (plan._introLogo && camera && controls) {
      // Intimate framing for the intro logo — skip auto-zoom so the brand reads big
      camera.position.set(0, 0.35, 4.8);
      controls.target.set(0, 0.2, 0);
      controls.update();
    } else {
      frameModel();
    }
    reportShapeQuality(activePlan, nodes);
    log("Viewport", `Loaded ${nodes.length} mesh part(s) in the void.`);
  }

  /** The units module, if it loaded. Everything here degrades without it. */
  function U() {
    return window.HCForgeUnits || null;
  }

  /**
   * Fuse every part into one solid, and cut whatever was marked to be cut.
   *
   * The parts on screen are separate shells sitting inside each other, which is
   * why a join shows a seam and why nothing could ever be taken away. This asks
   * the whole model as one question — for any point, is it inside — and walks
   * the answer into a single skin. It is what makes a hole a hole.
   *
   * A snapshot rather than a mode: it is thrown away the moment anything is
   * edited or rebuilt, because a solid that no longer matches its parts is a
   * picture of a model that does not exist.
   *
   * Deliberately a button and not automatic. It takes about a second and a half
   * on the largest model measured, which is nothing to wait for when it is
   * asked for and far too much between every edit.
   */
  async function solidifyModel() {
    const FieldMod = window.HCForgeField;
    const SurfaceMod = window.HCForgeSurface;
    if (!await initThree()) return;
    if (!FieldMod || !SurfaceMod) { log("Solid", "the solid modeller did not load", "err"); return; }
    const nodes = renderableNodes(activePlan?.nodes || []);
    if (!nodes.length) { log("Solid", "there is no model to fuse", "warn"); return; }

    setStatus("Fusing");
    log("Solid", `Fusing ${nodes.length} part(s) into one`, "run");
    // Yielded to the browser first, or the button never draws its pressed state
    // and the window looks frozen for the whole walk.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const started = performance.now();
    let mesh;
    let field;
    try {
      field = FieldMod.buildField(nodes);
      for (const issue of field.issues) log("Solid", `${issue.partId || "plan"}: ${issue.detail}`, "warn");
      mesh = SurfaceMod.extract(field, {});
    } catch (err) {
      log("Solid", `could not fuse the model · ${err?.message || err}`, "err");
      setStatus("Ready");
      return;
    }
    if (!mesh.stats.triangles) {
      for (const issue of mesh.issues) log("Solid", issue.detail, "warn");
      log("Solid", "nothing came out of the fuse — the parts may be thinner than the grid", "err");
      setStatus("Ready");
      return;
    }

    showSolid(mesh);
    const info = SurfaceMod.inspect(mesh);
    const took = Math.round(performance.now() - started);
    // Volume in real units: a scene unit cubed is a millimetre cubed times the
    // factor cubed, and a millilitre is a thousand of those.
    const mm3 = mmPerUnit ? info.volume * mmPerUnit ** 3 : 0;
    log("Solid", `${info.triangles.toLocaleString()} triangles`, "ok",
      [
        mm3 ? `volume ${(mm3 / 1000).toFixed(1)} ml` : "",
        `walked in ${took} ms at ${mesh.stats.resolution} cells across`,
      ].filter(Boolean).join("\n"));
    // Said plainly, because a person is about to print this. A count of nothing
    // is the only reading that means watertight, and it is never assumed.
    if (info.boundaryEdges || info.nonManifoldEdges) {
      log("Solid", `${info.boundaryEdges + info.nonManifoldEdges} edge(s) are not a clean join — a feature is thinner than the grid`, "warn");
    } else {
      log("Solid", "watertight · every edge has exactly two faces", "ok");
    }
    reportPrintability(mesh, field);
    setStatus("Ready");
  }

  /**
   * Whether the thing could actually be made, in one line and then the detail.
   *
   * The summary is read at a glance before pressing export, so it is one line.
   * Everything behind it is a finding with the number it was judged against, so
   * a person can disagree with the limit rather than only with the verdict.
   */
  function reportPrintability(mesh, field) {
    const PrintMod = window.HCForgePrintable;
    if (!PrintMod) return;
    let out;
    try {
      out = PrintMod.assess(mesh, field, { mmPerUnit });
    } catch (err) {
      log("Print", `could not check it · ${err?.message || err}`, "warn");
      return;
    }
    log("Print", PrintMod.summarise(out), out.ok ? "ok" : "warn");
    for (const finding of out.findings) {
      if (finding.level === "note") continue;
      log("Print", finding.detail, finding.level === "stop" ? "err" : "warn");
    }
  }

  /** Put the fused mesh on screen in place of the parts. */
  function showSolid(mesh) {
    clearScene();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PRINT_COLOR),
      roughness: 0.72,
      metalness: 0.04,
    });
    const solid = new THREE.Mesh(geometry, material);
    solid.castShadow = true;
    solid.receiveShadow = true;
    solid.name = activePlan?.name || "Solid";
    // Not selectable: it is one body, and the parts it came from are still the
    // thing to edit. Selecting it would offer to move a snapshot.
    solid.userData.selectable = false;
    modelGroup.add(solid);
    solidMesh = mesh;
    frameModel();
  }

  /** Throw the snapshot away. Anything that changes the parts invalidates it. */
  function dropSolid() {
    solidMesh = null;
  }

  /**
   * Work out what a scene unit is worth, from the model that exists.
   *
   * Measured rather than assumed. Normalising works from each part's declared
   * width and radius — an estimate that ignores rotation and cannot know what a
   * mesh's vertices do — so a model asked to be two units across arrives near
   * two and not at it. Dividing the real size by the intended span instead of
   * the measured one would put that error into every dimension this app ever
   * showed or wrote, which is exactly the kind of wrongness nobody catches.
   */
  function measureRealSize() {
    const units = U();
    mmPerUnit = 0;
    if (!units || !THREE || !modelGroup || !modelGroup.children.length) return;
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    mmPerUnit = units.mmPerUnit(activePlan?.sizeMm ?? units.DEFAULT_SIZE_MM, span);
    if (!mmPerUnit) return;
    const stated = activePlan?.sizeStated;
    log("Measure", `${units.formatSize([size.x, size.y, size.z], mmPerUnit)}`, "ok",
      stated ? "longest side as the design asked" : `longest side defaulted to ${units.formatMm(units.DEFAULT_SIZE_MM)} — set it in Properties`);
  }

  /** The model's size in millimetres, for anything that needs to show it. */
  function modelSizeMm() {
    const units = U();
    if (!units || !THREE || !modelGroup || !modelGroup.children.length || !mmPerUnit) return null;
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return { size: [size.x, size.y, size.z], text: units.formatSize([size.x, size.y, size.z], mmPerUnit) };
  }

  /**
   * Change what the model is the size of, without touching the model.
   *
   * Nothing is rebuilt and no part moves: the geometry is at the working span
   * either way, and only the factor everything is read through changes. So
   * forty millimetres to four hundred is instant and cannot distort anything.
   */
  function setModelSizeMm(mm) {
    const units = U();
    if (!units || !activePlan) return;
    const asked = units.sizeMmOf({ sizeMm: mm });
    activePlan.sizeMm = asked.mm;
    activePlan.sizeStated = true;
    measureRealSize();
    updatePlanList(activePlan);
    renderSelection();
    queueProjectSave();
  }

  /**
   * What the design actually answered with, said plainly.
   *
   * Both of these were invisible before. A part whose shape the app could not
   * build was turned into a box in silence, and a design that answered every
   * part with a plain block or a ball rendered without comment — so a result
   * that was the model's doing looked like the app's.
   *
   * Neither is treated as an error. A crate really is boxes, and a substituted
   * shape is usually the right one. They are stated, so the person looking at
   * the screen knows which of the two they are looking at, and Improve is told
   * the same thing when it is asked to have another go.
   */
  function reportShapeQuality(plan, nodes) {
    const swapped = plan?.shapeSubstitutions || [];
    if (swapped.length) {
      log("Assemble", `${swapped.length} part(s) named a shape this app does not build — read as the nearest one`, "warn", swapped.join("\n"));
    }
    const plain = plainShapeCount(nodes);
    if (nodes.length >= 3 && plain / nodes.length >= 0.7) {
      log("Design", `${plain} of ${nodes.length} part(s) are plain boxes or balls. If the subject is not blocky, the model answered with stand-ins — press Improve, or design it with a stronger model.`, "warn");
    }
  }

  /** Parts that carry no shape of their own: a box or a ball, nothing turned. */
  function plainShapeCount(nodes) {
    return (nodes || []).filter((node) => node.type === "box" || node.type === "sphere").length;
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
    // The intro mark is a brand mark hanging in the middle of the shot, not an
    // object resting on a floor. Setting it down lifts it out of the framing
    // written for it, which is a view from below of something too close.
    if (activePlan?._introLogo) return;
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty() || !Number.isFinite(box.min.y)) return;
    const dy = FLOOR_Y - box.min.y;
    if (!Number.isFinite(dy) || Math.abs(dy) < 1e-4) return;
    modelGroup.children.forEach((child) => {
      child.position.y += dy;
      const node = child.userData?.node;
      if (node && Array.isArray(node.position)) node.position[1] += dy;
      // The floating mark bobs, and every frame it is written back to the
      // height it was given when its mesh was made — which is before this runs.
      // Moving the mesh without moving that height meant the bob dragged the
      // logo straight back down, through the floor it had just been set on.
      if (Number.isFinite(child.userData?.logoBaseY)) child.userData.logoBaseY += dy;
    });
    modelGroup.updateMatrixWorld(true);
    log("Assemble", `set on the floor from measured geometry · ${dy > 0 ? "+" : ""}${dy.toFixed(2)}`, "ok");
  }

  /**
   * What is measurably wrong with the model on screen, in words a model can act
   * on. Nothing here is an opinion: every line comes from the built geometry or
   * from the deterministic stage's own findings.
   */
  function describeBuiltModel() {
    const MP = window.HCModelPlan;
    const nodes = renderableNodes(activePlan?.nodes || []);
    if (!nodes.length) return null;
    const lines = [`The model currently has ${nodes.length} part(s): ${nodes.map((n) => n.name || n.id).join(", ")}.`];

    if (THREE && modelGroup && modelGroup.children.length) {
      const box = new THREE.Box3().setFromObject(modelGroup);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        lines.push(`Measured size: width ${size.x.toFixed(2)}, height ${size.y.toFixed(2)}, depth ${size.z.toFixed(2)}.`);
        const longest = Math.max(size.x, size.y, size.z);
        if (longest > 0 && size.y === longest && size.y > Math.max(size.x, size.z) * 1.6) {
          lines.push("The tallest axis is Y by a wide margin — if this object rests lengthwise in life, it is standing on end and should be laid down.");
        }
        const thinnest = Math.min(size.x, size.y, size.z);
        if (longest > 0 && thinnest / longest < 0.05) lines.push("The model is nearly flat in one axis; it needs depth.");
      }
    }
    const plain = plainShapeCount(nodes);
    if (nodes.length >= 3 && plain / nodes.length >= 0.7) {
      lines.push(`${plain} of ${nodes.length} parts are plain boxes or spheres. Unless the subject really is blocky, replace them with shapes that carry the form: extrude for a silhouette, lathe for anything turned, capsule for a rounded limb.`);
    }
    if (MP) {
      for (const issue of MP.findIssues(MP.normaliseParts(nodes).parts)) {
        if (issue.code === "detached") lines.push(`"${issue.partId}" does not touch the rest of the model; move it so it connects, or remove it.`);
      }
    }
    return lines.join("\n");
  }

  /**
   * The second call. It is given the plan and what the built model measures,
   * and asked for the smallest set of changes that fixes it — not a new design.
   * Regenerating from the prompt is what Generate is for, and it throws away
   * whatever was already right.
   */
  async function improveModel() {
    // A generation in progress owns the scene; improving on top of it would
    // apply a patch to a plan that is about to be replaced.
    if (abortCtrl && !abortCtrl.signal.aborted) { log("Improve", "wait for the run to finish", "warn"); return; }
    const api = window._H;
    const model = selectedModelFor("god");
    const observations = describeBuiltModel();
    if (!api?.ollamaChat || !model) { log("Improve", "no model bridge", "err"); return; }
    if (!observations) { log("Improve", "nothing built to improve yet", "warn"); return; }

    const btn = $("frgImproveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Improving…"; }
    setStatus("Improving");
    // Improve is a run too, so it takes the controller. That is what lets a
    // Generate started on top of it abort the call rather than race it.
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    try {
      log("Improve", `Sending the model back to ${modelLabel(model)} with what is measurably wrong`, "run");
      const system = `You are correcting an existing 3D model, not designing a new one.
Return only JSON: {"remove":["id",...],"replace":[node,...],"add":[node,...]}
A node has the same shape as the plan you are given: id, name, type, position, rotation, scale, params, color, mirror.
Rules:
- Change as little as possible. Keep every part that is not named as a problem.
- "replace" swaps a part with the same id. "add" introduces new ones. "remove" deletes by id.
- Do not restate parts you are not changing.
- The app mirrors, grounds and centres the model itself. Do not compensate for those.
- If nothing needs changing, return {"remove":[],"replace":[],"add":[]}.`;
      const user = `Prompt the model was built for: ${$("frgPrompt")?.value || activePlan?.name || "model"}

What the built model measures:
${observations}

The current plan:
${JSON.stringify({ name: activePlan?.name, nodes: renderableNodes(activePlan?.nodes || []) }).slice(0, 12000)}`;
      const text = await api.ollamaChat(model, [
        { role: "system", content: system },
        { role: "user", content: user },
      ], null, ctrl.signal);

      // A generation started while this was in flight owns the scene now.
      // Applying a patch built against the plan it replaced would overwrite a
      // model the person is currently watching being built.
      if (abortCtrl !== ctrl) { log("Improve", "superseded by a new run", "wait"); return; }

      const patch = parseJsonPayload(text, "object") || {};
      const removed = new Set((Array.isArray(patch.remove) ? patch.remove : []).map(String));
      const replacements = new Map((Array.isArray(patch.replace) ? patch.replace : [])
        .filter((n) => n && n.id).map((n) => [String(n.id), n]));
      const added = (Array.isArray(patch.add) ? patch.add : []).filter((n) => n && typeof n === "object");

      if (!removed.size && !replacements.size && !added.length) {
        log("Improve", "the model reported nothing to change", "wait");
        return;
      }
      const nodes = (activePlan?.nodes || [])
        .filter((n) => !removed.has(String(n.id)))
        .map((n) => (replacements.has(String(n.id)) ? { ...n, ...replacements.get(String(n.id)) } : n))
        .concat(added);
      log("Improve", `${replacements.size} changed · ${added.length} added · ${removed.size} removed`, "ok");

      let plan = enforceSingleMainModel($("frgPrompt")?.value || "", { ...activePlan, nodes });
      plan = assembleDeterministically(normalizePlan(plan));
      buildPlan(plan);
      saveCurrentProject(false);
      setStatus("Ready");
    } catch (err) {
      log("Improve", `failed: ${err?.message || err}`, "err");
      if (abortCtrl === ctrl) setStatus("Ready");
    } finally {
      if (abortCtrl === ctrl) abortCtrl = null;
      if (btn) { btn.textContent = "Improve this model"; btn.disabled = false; }
    }
  }

  /** Improve only means something once there is a model to improve. */
  function syncImproveAvailability() {
    const btn = $("frgImproveBtn");
    const note = $("frgImproveNote");
    const count = renderableNodes(activePlan?.nodes || []).length;
    if (btn) btn.disabled = !count;
    if (note) note.textContent = count
      ? "One more call. Sends what the model measures, and applies only the corrections that come back."
      : "Generate a model first.";
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
    const units = U();
    // With nothing selected the panel used to be a sentence telling you to
    // select something. It is the natural home for the one property the whole
    // model has, and a model whose size is a silent default is a model that
    // prints at the wrong size.
    if (!selectedMesh) {
      const measured = modelSizeMm();
      const sizeMm = activePlan?.sizeMm ?? units?.DEFAULT_SIZE_MM ?? 0;
      card.innerHTML = activePlan && units
        ? `<div class="frg-edit-grid" aria-label="Model size" style="grid-template-columns:1fr">
             <span class="frg-edit-field">
               <label>Longest side (mm)</label>
               <input data-frg-model-size type="number" min="${units.MIN_SIZE_MM}" max="${units.MAX_SIZE_MM}" step="1" value="${escapeHtml(String(Math.round(sizeMm)))}">
             </span>
           </div>
           <div class="frg-selection-empty">${measured ? escapeHtml(measured.text) : "Nothing built yet"}${activePlan?.sizeStated ? "" : " · this size is a default until you set it"}</div>
           <div class="frg-selection-empty">Click any part in the void to edit it.</div>`
        : `<div class="frg-selection-empty">Click any part in the void to edit it.</div>`;
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
        ${["x", "y", "z"].map((axis) => {
          // Shown in millimetres when the model has a real size, because a
          // position in scene units is a number with no meaning outside this
          // window. The step follows: a millimetre, not a twentieth of nothing.
          const mm = units && mmPerUnit;
          const value = mm ? units.formatMm(units.toMm(pos[axis], mmPerUnit), { bare: true }) : pos[axis].toFixed(2);
          return `<span class="frg-edit-field"><label>${mm ? "mm" : "Pos"} ${axis.toUpperCase()}</label><input data-frg-pos="${axis}" type="number" step="${mm ? 1 : 0.05}" value="${escapeHtml(value)}"></span>`;
        }).join("")}
      </div>
      <div class="frg-edit-grid" aria-label="Scale" style="margin-top:6px">
        ${["x", "y", "z"].map((axis) => `<span class="frg-edit-field"><label>Scale ${axis.toUpperCase()}</label><input data-frg-scale="${axis}" type="number" step="0.05" min="0.02" value="${escapeHtml(scale[axis].toFixed(2))}"></span>`).join("")}
      </div>
      <div class="frg-edit-grid" aria-label="Rotation" style="margin-top:6px">
        ${["x", "y", "z"].map((axis) => `<span class="frg-edit-field"><label>Rot ${axis.toUpperCase()}</label><input data-frg-rot="${axis}" type="number" step="5" value="${escapeHtml(Math.round(THREE.MathUtils.radToDeg(rot[axis])))}"></span>`).join("")}
      </div>
      ${shapeFieldsHtml(node)}`;
  }

  /**
   * The part's own dimensions, which until now could not be changed at all.
   *
   * Resizing is not the same edit and cannot stand in for this: scaling a
   * cylinder on two axes gives an oval prism, while changing its radius gives
   * a wider cylinder, and only one of those is the part somebody meant.
   *
   * Lengths are shown in millimetres, through the same lens as a position,
   * because a scene unit means nothing outside this window. Counts — how many
   * sides a curve is drawn with — are plain whole numbers and stay that way.
   */
  function shapeFieldsHtml(node) {
    const P = window.HCForgeParams;
    if (!P || selectedObjectWhole) return "";
    const fields = P.valuesOf(node);
    if (!fields.length) {
      // Said rather than left blank. A mesh is somebody else's vertices and has
      // no radius to change; an empty space reads as a panel that failed.
      return P.fieldsFor(node.type)
        ? `<div class="frg-selection-empty" style="margin-top:8px">A ${escapeHtml(node.type || "part")} has no dimensions of its own to change — move, turn and resize it instead.</div>`
        : "";
    }
    const units = U();
    const mm = units && mmPerUnit;
    return `
      <div class="frg-edit-grid" aria-label="Shape" style="margin-top:6px">
        ${fields.map((field) => {
          const isLength = field.kind === "length";
          const value = isLength && mm
            ? units.formatMm(units.toMm(field.value, mmPerUnit), { bare: true })
            : isLength ? Number(field.value).toFixed(3) : String(field.value);
          const label = isLength && mm ? `${field.label} (mm)` : field.label;
          const step = isLength ? (mm ? 1 : 0.01) : 1;
          const min = isLength && mm ? 0 : field.min;
          return `<span class="frg-edit-field"><label>${escapeHtml(label)}</label><input data-frg-param="${escapeHtml(field.key)}" type="number" step="${step}" min="${min}" value="${escapeHtml(value)}"></span>`;
        }).join("")}
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

  /** The part list as it stands, detached from the scene so it cannot drift. */
  function snapshotParts() {
    return JSON.parse(JSON.stringify(activePlan?.nodes || []));
  }

  /**
   * Take the "before" of an edit that is about to happen.
   *
   * Held rather than pushed, because a drag is not an edit until it ends —
   * and a drag that ends where it started is not one at all.
   */
  function beginEdit() {
    if (!editHistory) return;
    editBefore = snapshotParts();
  }

  /** Close an edit, recording it only if the model actually changed. */
  function commitEdit(label) {
    if (!editHistory) return;
    const before = editBefore || snapshotParts();
    editBefore = null;
    editHistory.push(label, before, snapshotParts());
    syncEditHistoryButtons();
  }

  /** One edit, taken and closed around a change that happens immediately. */
  function recordEdit(label, change) {
    beginEdit();
    const result = change();
    commitEdit(label);
    return result;
  }

  /**
   * Put the model back to a recorded state.
   *
   * Deliberately not buildPlan: that grounds the model and reframes the
   * camera, so undoing a nudge would also move everything onto the floor and
   * swing the view — a step back that does not look like a step back. The
   * meshes are rebuilt from the parts and nothing else is touched, and the
   * arrival animation is landed at once rather than replayed.
   */
  function restoreParts(parts) {
    if (!THREE || !modelGroup) return;
    clearScene();
    dropSolid();
    activePlan = { ...(activePlan || { name: "Forge object" }), nodes: JSON.parse(JSON.stringify(parts || [])) };
    const nodes = renderableNodes(activePlan.nodes);
    nodes.forEach((node) => addNodeMesh(node, performance.now()));
    revealMeshes.forEach((item) => {
      const mat = item.mesh?.material;
      if (mat && !Array.isArray(mat)) { mat.opacity = item.targetOpacity; mat.transparent = item.targetOpacity < 1; }
    });
    revealMeshes = [];
    updatePlanList(activePlan);
    renderSelection();
    syncImproveAvailability();
    queueProjectSave();
  }

  function undoEdit() {
    if (!editHistory?.canUndo()) { log("Editor", "nothing left to undo", "wait"); return; }
    const entry = editHistory.undo();
    restoreParts(entry.before);
    syncEditHistoryButtons();
    log("Editor", `Undid ${entry.label}`, "ok");
  }

  function redoEdit() {
    if (!editHistory?.canRedo()) { log("Editor", "nothing to redo", "wait"); return; }
    const entry = editHistory.redo();
    restoreParts(entry.after);
    syncEditHistoryButtons();
    log("Editor", `Redid ${entry.label}`, "ok");
  }

  /** A button that cannot do anything says so, rather than doing nothing. */
  function syncEditHistoryButtons() {
    const undoBtn = $("frgUndoBtn");
    const redoBtn = $("frgRedoBtn");
    if (undoBtn) {
      undoBtn.disabled = !editHistory?.canUndo();
      undoBtn.title = editHistory?.canUndo() ? `Undo (${editHistory.depth()} step(s) back)` : "Nothing to undo";
    }
    if (redoBtn) {
      redoBtn.disabled = !editHistory?.canRedo();
      redoBtn.title = editHistory?.canRedo() ? "Redo" : "Nothing to redo";
    }
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
    const units = U();
    // Read back through the same lens it was shown through, or a person typing
    // the number they were just shown would move the part somewhere else.
    selectedMesh.position[axis] = units && mmPerUnit
      ? units.fromMm(Number(value) || 0, mmPerUnit)
      : Number(value) || 0;
    syncSelectedNodeFromMesh();
    selectionBox?.update();
    updatePlanList(activePlan);
  }

  /**
   * Change one of the part's own numbers and rebuild just that part.
   *
   * Only the geometry is replaced — the mesh keeps its place, its turn, its
   * material and the selection — so changing a radius does not move anything
   * or lose what was selected.
   *
   * The fused solid is dropped, because it was a snapshot of parts that have
   * now changed shape and a stale solid on screen is worse than none. The
   * model is measured again for the same reason: the badge would otherwise
   * keep reporting the size the model was before the edit.
   */
  function updateSelectedParam(key, value) {
    const P = window.HCForgeParams;
    if (!selectedMesh || !P || selectedObjectWhole) return;
    const node = selectedMesh.userData.node;
    const field = P.fieldOf(node?.type, key);
    if (!node || !field) return;
    // Nothing typed yet is not an instruction. Clearing a field in order to
    // retype it would otherwise rebuild the part at its default on the way
    // past, which a person sees as the shape jumping while they type.
    if (String(value).trim() === "") return;
    const units = U();
    // Read back through the lens it was shown through, or a person typing the
    // number they were just shown would get a part of a different size.
    const raw = field.kind === "length" && units && mmPerUnit
      ? units.fromMm(Number(value) || 0, mmPerUnit)
      : Number(value);
    node.params = P.withValue(node, key, raw);

    const geoParams = node.params;
    const next = finalizeGeometry(primitiveGeometry(node), geoParams);
    if (!next) return;
    selectedMesh.geometry?.dispose?.();
    selectedMesh.geometry = next;
    dropSolid();
    selectionBox?.update();
    measureRealSize();
    updatePlanList(activePlan);
    queueProjectSave();
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
      //
      // The span is passed now. Every tolerance downstream — the contact gap,
      // the seating bite, the smallest part that can be drawn — is an absolute
      // number, and an absolute number is only correct at one scale. Models
      // were arriving anywhere between 1.2 and 4.8 units across, so the same
      // gap was 1% of one model and 5% of another and the assembler was
      // quietly stricter with the big ones.
      out = MP.assemble(plan, { ground: false, targetSize: U()?.WORKING_SPAN || 0 });
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
    if (s.connected) notes.push(`${s.connected} part(s) brought onto the body`);
    if (s.seated) notes.push(`${s.seated} seam(s) closed`);
    if (s.repeated) notes.push(`${s.repeated} part(s) made by repeating`);
    if (s.subtracted) notes.push(`${s.subtracted} part(s) cut away`);
    if (s.received !== s.kept) notes.push(`${s.received - s.kept} unrenderable part(s) dropped`);
    // "nothing to correct" used to be printed above a list of parts the same
    // step had just found adrift. It is only true when the list is empty.
    if (notes.length) {
      log("Assemble", notes.join(" · "), "ok", (out.moves || []).map((m) => `${m.partId} → ${m.to}`).join("\n"));
    } else if (!out.issues.length) {
      log("Assemble", "nothing to correct", "ok");
    }
    for (const issue of out.issues) {
      if (issue.code === "detached") log("Assemble", `${issue.partId} sits too far from the body to place — left where the design put it`, "warn");
      else if (issue.code === "degenerate") log("Assemble", `${issue.partId} had no measurable size`, "warn");
    }
    // The size may have been written as arithmetic, and the assembler is where
    // arithmetic is resolved, so the resolved value has to come back with it.
    return { ...plan, nodes: out.parts, sizeMm: out.sizeMm ?? plan.sizeMm };
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
    }
  }

  /**
   * Everything on screen as one triangle list, in whatever unit the object is
   * already in — which for an export is millimetres, because
   * `exportableObject` has applied the scale before this is called.
   *
   * Only the gathering happens here. The placing, the joining and the winding
   * of a mirrored part are done in src/js/forge/io/scene.js, where they are
   * arithmetic on plain numbers and can be measured.
   */
  function meshForExport(object, name) {
    const parts = [];
    object.updateMatrixWorld(true);
    object.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || obj.visible === false) return;
      const pos = obj.geometry.getAttribute("position");
      if (!pos) return;
      parts.push({
        positions: pos.array,
        indices: obj.geometry.index ? obj.geometry.index.array : null,
        matrix: obj.matrixWorld.elements,
      });
    });
    return window.HCForgeSceneIO.merge(parts, name || activePlan?.name || "model");
  }

  /**
   * The model as a file will see it: visible, opaque, and at its real size.
   *
   * The scene runs at a working span that has nothing to do with how big the
   * object is, so a file written straight from it carries no size at all —
   * which is why every export had to be rescaled by hand wherever it landed.
   * The factor is applied to a copy, so nothing on screen moves.
   */
  function exportableObject(kind) {
    if (!modelGroup || !modelGroup.children.length) return null;
    // When the model has been fused, that is the thing to write: one closed
    // body rather than the overlapping shells it was made from. Printing
    // formats care about the difference and so does anything that opens it.
    if (!solidMesh) syncSelectedNodeFromMesh();
    const clone = modelGroup.clone(true);
    const units = U();
    if (units && mmPerUnit) {
      const factor = units.exportScale(kind, mmPerUnit);
      if (factor > 0 && factor !== 1) clone.scale.multiplyScalar(factor);
      clone.updateMatrixWorld(true);
    }
    clone.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.visible = true;
      obj.material = Array.isArray(obj.material) ? obj.material.map((m) => m.clone()) : obj.material?.clone?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          // Fully opaque, and it has to be the number 1 rather than merely a
          // high one. `transparent = false` settles what the screen does and
          // nothing else: the GLB writer puts `opacity` straight into the
          // material's base colour as its alpha, so a part written while this
          // carried a leftover from the reveal animation was described to
          // every other program as not quite solid.
          mat.opacity = 1;
          mat.transparent = false;
          mat.depthWrite = true;
        });
      }
    });
    return clone;
  }

  async function exportForgeAsset(kind) {
    if (!await initThree()) return;
    const object = exportableObject(kind);
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
        const writer = window.HCForgeOBJ;
        if (!writer) throw new Error("the OBJ writer did not load");
        const text = writer.write(meshForExport(object, activePlan?.name));
        saved = await downloadBlob(`${base}.obj`, new Blob([text], { type: "text/plain" }));
      } else if (kind === "step") {
        const writer = window.HCForgeSTEP;
        if (!writer) throw new Error("the STEP writer did not load");
        const out = writer.write(meshForExport(object, activePlan?.name));
        if (!out) throw new Error("this model is too large to write as a solid");
        // Said every time, because the alternative is a person opening the file
        // expecting to fillet a curve and finding a many-sided prism.
        log("Pipeline", "STEP is written as a faceted solid", "wait",
          `${out.triangles} flat face${out.triangles === 1 ? "" : "s"} — curves arrive as flats, not as curves`);
        if (out.skipped) log("Pipeline", `${out.skipped} triangle(s) had no area and were left out`, "warn");
        saved = await downloadBlob(`${base}.step`, new Blob([out.text], { type: "model/step" }));
      } else if (kind === "3mf") {
        // The only format here that states its own unit, so a part arrives at
        // the size it was designed at without anyone typing a scale.
        const writer = window.HCForge3MF;
        if (!writer) throw new Error("the 3MF writer did not load");
        const bytes = writer.write(meshForExport(object, activePlan?.name));
        saved = await downloadBlob(`${base}.3mf`, new Blob([bytes], { type: "model/3mf" }));
      } else if (kind === "stl") {
        // Written here rather than by the generic mesh exporter, so the bytes
        // are ours to check: the same file this produces is read back and
        // measured by npm run check:forge-io.
        const writer = window.HCForgeSTL;
        if (!writer) throw new Error("the STL writer did not load");
        const bytes = writer.write(meshForExport(object, activePlan?.name));
        saved = await downloadBlob(`${base}.stl`, new Blob([bytes], { type: "model/stl" }));
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
    const MP = window.HCModelPlan;
    const src = plan && typeof plan === "object" ? plan : { name: "Empty model", nodes: [] };
    const nodes = Array.isArray(src.nodes) ? src.nodes : [];
    // A shape the app cannot build used to become a one-unit box here, without
    // a word. So a design that had written an egg, a pipe and a ring came back
    // as three identical cubes, and the app looked incapable of a curve it had
    // never been asked for. The nearest real shape is used instead, and every
    // substitution is carried on the plan so the run can say it happened.
    const substitutions = [];
    const shapeOf = (node, i) => {
      const resolved = MP?.resolveType
        ? MP.resolveType(node)
        : { type: SHAPE_NAMES.includes(node.type) ? node.type : "box", from: SHAPE_NAMES.includes(node.type) ? null : String(node.type || "") };
      if (resolved.from) {
        substitutions.push(`${String(node.name || node.id || `Node ${i + 1}`)}: "${resolved.from}" → ${resolved.type}`);
      }
      return resolved.type;
    };
    return {
      shapeSubstitutions: substitutions,
      name: src.name || "Forged model",
      // The intro mark floats and is framed by hand. Losing that flag here is
      // how it came to be set on the floor, out of the shot built for it.
      _introLogo: src._introLogo === true ? true : undefined,
      glbUrl: typeof src.glbUrl === "string" ? src.glbUrl : "",
      // How big the object is in life. Carried beside the geometry and never
      // inside it, so changing it re-labels the model rather than distorting it.
      sizeMm: window.HCForgeUnits ? window.HCForgeUnits.sizeMmOf(src).mm : undefined,
      sizeStated: window.HCForgeUnits ? window.HCForgeUnits.sizeMmOf(src).stated : false,
      // The named values a design's arithmetic is written in terms of. Dropped
      // here, every expression in the plan would resolve to nothing and the
      // whole model would fall back to defaults without a word.
      vars: src.vars && typeof src.vars === "object" && !Array.isArray(src.vars) ? src.vars : undefined,
      constraints: Array.isArray(src.constraints) ? src.constraints : [],
      edges: Array.isArray(src.edges) ? src.edges : [],
      nodes: nodes.slice(0, MAX_FORGE_NODES).map((node, i) => ({
        id: String(node.id || `node_${i + 1}`),
        name: String(node.name || node.id || `Node ${i + 1}`),
        type: shapeOf(node, i),
        role: ["structure", "surface", "detail", "audit"].includes(node.role) ? node.role : "structure",
        position: vec3(node.position, [0, 0, 0]),
        rotation: vec3(node.rotation, [0, 0, 0]),
        scale: vec3(node.scale, [1, 1, 1]),
        params: node.params && typeof node.params === "object" ? node.params : {},
        color: node.color,
        opacity: Number.isFinite(node.opacity) ? node.opacity : undefined,
        // Symmetry is asked of the model and made by the app: the design
        // prompt tells it to build one side and mark the part mirrored. This
        // function rebuilds every node from a fixed list of fields, and that
        // flag was not on the list — so it was dropped on the way to the
        // assembler and no generated model has ever been mirrored. What
        // arrived was the half that was asked for: one wing, one fin.
        //
        // The value may name its plane, and `true` still means x, so a plan
        // written before this reads exactly as it did.
        mirror: mirrorAxis(node.mirror) || false,
        // The pairing the assembler writes back, so a saved model reopens as
        // pairs rather than as parts that happen to face each other — and the
        // plane it was made across, without which a repair pass moves a twin
        // along the wrong axis and breaks the symmetry it is protecting.
        mirroredFrom: typeof node.mirroredFrom === "string" ? node.mirroredFrom : undefined,
        mirroredOn: mirrorAxis(node.mirroredOn) || undefined,
        hasMirror: node.hasMirror === true ? true : undefined,
        // A request to repeat, and the pairing repeating leaves behind. On the
        // same list for the same reason as the mirroring flag: a field missing
        // from it is dropped in silence and the feature simply stops happening.
        repeat: node.repeat && typeof node.repeat === "object" && !Array.isArray(node.repeat) ? node.repeat : undefined,
        repeatedFrom: typeof node.repeatedFrom === "string" ? node.repeatedFrom : undefined,
        // What this part does to the material already there. On the same list
        // for the same reason as every other flag: a field missing from it is
        // dropped in silence, and a hole that quietly stops being a hole is a
        // solid lump nobody asked for.
        op: node.op === "subtract" || node.op === "intersect" ? node.op : undefined,
        blend: Number.isFinite(Number(node.blend)) && Number(node.blend) > 0 ? Number(node.blend) : undefined,
      })),
    };
  }

  /**
   * The mirror plane a node names, read through the assembler's own reader so
   * the two cannot drift apart. Without model-plan loaded there is nothing to
   * mirror with anyway, and the older spelling is still honoured.
   */
  function mirrorAxis(value) {
    const P = window.HCModelPlan;
    if (P && typeof P.mirrorAxisOf === "function") return P.mirrorAxisOf(value);
    return value === true ? "x" : null;
  }

  function vec3(v, fallback) {
    return Array.isArray(v) && v.length >= 3
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : fallback.slice();
  }


  function updateReveal(now) {
    for (const item of revealMeshes) {
      const t = Math.min(1, Math.max(0, (now - item.start) / item.duration));
      const mat = item.mesh.material;
      mat.opacity = item.targetOpacity * easeOut(t);
      // Once it is fully there, stop treating it as glass. Left transparent, a
      // solid model draws its own far side through its near side.
      if (t >= 1 && mat.transparent && item.targetOpacity >= 1) {
        mat.transparent = false;
        mat.needsUpdate = true;
      }
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

  /**
   * A run owns the abort controller for exactly as long as it is in flight.
   * Everything asking "is a run happening?" reads it, and nothing used to put
   * it back — so a finished run answered yes for ever, and Improve refused
   * every time it was offered. Released on every way out, and only while it is
   * still ours: a second run replaces it before the first has unwound.
   */
  async function runGodAgent(useSample) {
    if (!await initThree()) return;
    if (abortCtrl) abortCtrl.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    try {
      await forgeRun(useSample, ctrl);
    } finally {
      if (abortCtrl === ctrl) abortCtrl = null;
    }
  }

  async function forgeRun(useSample, ctrl) {
    traceRunCount += 1;
    traceStartTime = Date.now();
    const prompt = ($("frgPrompt")?.value || "").trim() || "a complex original 3D object";
    const prefs = forgePrefs();
    resetStages();
    updateStage("input", "done", "prompt locked");
    const traceEntries = $("frgTraceEntries");
    if (traceEntries) traceEntries.innerHTML = "";
    // The trace used to open itself over a third of the window on every run.
    // Collapsed, its bar still names the latest line as the run makes it —
    // every log line writes the summary — so nothing is hidden, and the model
    // being built keeps the screen. It opens when it is asked to.

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
        updateStage("generate", "active", "parameter agent");
        plan = await requestForgeKernelPlan(prompt, prefs, routeBrief, ctrl.signal);
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
    if (!useSample && routeBrief.route !== "organic_diffusion" && !ctrl.signal.aborted) {
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

  async function askGodPlanWithFailover(prompt, prefs, signal) {
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
        return await askModelForPlan(prompt, prefs, routedSignal.signal);
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


  async function requestForgeKernelPlan(prompt, prefs, routeBrief, signal) {
    const route = routeBrief?.route || "parametric";
    // Geometry is generated by asking a model directly. There used to be a
    // branch here that POSTed to /api/forge-kernel first and fell back to this
    // — but it ran only when NOT inside Tauri, and this app is only ever
    // inside Tauri, so the request was never made. No such server ships with
    // HashCortX, and none is planned.
    log("God Agent", "Direct AI geometry mode", "run");
    const plan = await askGodPlanWithFailover(prompt, prefs, signal);
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

  /**
   * The one call that designs the model.
   *
   * It used to be preceded by a web step: two searches and two page reads,
   * scraped with regular expressions into a list of stray measurements and
   * sentence fragments. It cost four tool calls and most of the wait on every
   * run, and what it handed the design call was worse than what the design
   * call already knows — a length in millimetres lifted out of a page that may
   * have been about something else entirely. A model that cannot picture a
   * fish is not helped by being told "24 cm"; one that can does not need it.
   *
   * Forge is now offline again, which is what docs/SECURITY.md always said.
   */
  async function askModelForPlan(prompt, prefs, signal) {
    const api = window._H;
    const model = selectedModelFor("god");
    if (!api?.ollamaChat || !model) throw new Error("no model bridge");
    const system = `Return only JSON for a 3D Forge GeometryPlan. No markdown.
Schema:
{
  "name": "short model name",
  "sizeMm": 150,
  "vars": {"wall": 2, "bore": 30},
  "nodes": [
    {
      "id": "stable_id",
      "name": "part name",
      "type": "mesh|lathe|extrude|capsule|sphere|cone|torus|box|cylinder",
      "role": "structure|surface|detail|audit",
      "op": "union|subtract|intersect",
      "position": [x,y,z],
      "rotation": [x,y,z],
      "scale": [x,y,z],
      "params": {"width":1,"height":1,"depth":1,"radius":0.5,"length":0.8,"tube":0.08,"points":[[0.2,-0.5],[0.5,0],[0.2,0.5]],"segments":64,"subdivisions":1},
      "repeat": {"count": 8, "about": "y"}
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
- The largest part carries the silhouette, and it is an "extrude", a "lathe" or a "mesh" unless the
  object really is a crate or a pipe. A body, a head, a hull or a shell answered with a box or a
  sphere is a placeholder, not a design, and it is what makes a result unusable.
- Use only the type names in the schema. A name that is not one of them is read as the nearest shape
  the app can build, and a part that says nothing usable becomes a plain box.
- Set "subdivisions":1 on every smooth organic surface and "segments":64 on lathes, cylinders,
  cones and capsules. The defaults look faceted.
- HOLES. To take material away, write the part that IS the hole and set "op": "subtract" on it. A
  mug's bore is a cylinder subtracted from the body; a vent is a box subtracted; a screw hole is a
  cylinder; a hollow shell is the same shape a little smaller, subtracted. Put the cutting part where
  the hole goes and make it longer than the material it passes through, so it comes out the other
  side. "op": "intersect" keeps only what two parts share. Order matters — parts are applied in the
  order you write them, so put the material in before cutting it.
- "blend": 0.05 on a part rounds off the join where it meets what is already there. That is a fillet,
  and it is what makes a bracket look made rather than assembled.
- Arithmetic. Any number may be written as a sum instead of a literal: "bore / 2 + wall". Names come
  from "vars", which may themselves be written from each other. Available: + - * / % ^ ( ), and
  min max abs sqrt sin cos tan atan2 floor ceil round sign pow hypot clamp rad deg, and pi and tau.
  Angles are in radians, so use rad(30) when you are thinking in degrees.
- Repetition: NEVER write out a ring of teeth, a row of ribs, a grille or a bolt circle part by part.
  Write ONE part and give it "repeat". Around an axis: {"count": 24, "about": "y"} — a full turn, or
  add "angle" in degrees for part of one. Along a line: {"count": 5, "along": [0, 0.2, 0]}. The app
  places every copy exactly, and it will not nudge a pattern out of true afterwards — so put the one
  part where it already touches the body, because a pattern that does not reach is reported and left.
- Symmetry: build ONE side and set "mirror" on it, naming the plane the two halves sit either
  side of: "mirror": "x", "y" or "z". Pick it from how the object lies — one laid out along X
  has its two sides on Z, so that one wants "z". ("mirror": true still means "x".) The app
  mirrors it exactly, and moves a pair together afterwards so they stay matched.
  Do not hand-place a left and a right copy — they will never match, and the app will not fix it.
- Every part must touch or overlap another. One object, nothing floating beside it.
- Do not add audit markers, rings, reference planes, rulers or floor pads. The app measures
  clearance, balance and floor contact itself, and anything like that becomes an unwanted part.
- Axes: +Y is up, +X is right, +Z is towards the viewer. Orient the object the way it rests
  in life: a fish, a car, a plane and an animal lie along a HORIZONTAL axis with their length
  on X or Z, not standing on end. A bottle, a lamp or a person stands with its length on Y.
  If the object has a front, face it towards +Z.
- The app puts the model on the floor. Build it around the origin and do not compensate.
- Set "sizeMm" to how long the real object's LONGEST side is, in millimetres. A mug is about 95,
  a phone about 150, a chair about 900, a bolt about 40. This is what the exported file is measured
  in, so a wrong number here prints at the wrong size. Build the geometry at whatever scale suits
  the shape — the app resizes it — and only this number has to be true.
- Name each part for what it is ("body", "dorsal fin", "handle"), so it can be found in the outliner.
- Do not give parts colours. The model is shown as one printed piece in a single material, and
  shape is the only thing that describes it. Spend the answer on geometry.
- Style target: ${prefs.style}. Detail target: ${prefs.detail}. Output target: ${prefs.output}.
- For 3D print, keep parts visibly connected and avoid tiny fragile details. For GLB, keep parts
  separate and named with clean pivots.
- Keep coordinates within roughly -3..3 unless needed.`;
    const user = `Design this as a complete 3D model, ready to preview and export.
Prompt: ${prompt}`;
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

  function hLogoPlan() {
    return {
      name: "HashCortx intro mark",
      _introLogo: true,
      nodes: [
        // A third copy of the mark used to sit behind these two, scaled up,
        // offset and tinted teal, to give the logo a halo. It was the last
        // teal in the app and it read as a smudge behind the artwork.
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

  function box(id, name, role, position, size, color, rotation) {
    return { id, name, role, type: "box", position, rotation: rotation || [0, 0, 0], scale: [1, 1, 1], params: { width: size[0], height: size[1], depth: size[2] }, color };
  }

  function capsule(id, name, role, position, radius, length, color, rotation, scale, opacity) {
    return { id, name, role, type: "capsule", position, rotation: rotation || [0, 0, 0], scale: scale || [1, 1, 1], params: { radius, length, capSegments: 10, radialSegments: 24 }, color, opacity };
  }

  function sphere(id, name, role, position, radius, color) {
    return { id, name, role, type: "sphere", position, rotation: [0, 0, 0], scale: [1, 1, 1], params: { radius }, color };
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

  function wireEvents() {
    if (eventsWired) return;
    eventsWired = true;
    // Inspector tabs.
    document.querySelectorAll("[data-frg-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const want = tab.dataset.frgTab;
        document.querySelectorAll("[data-frg-tab]").forEach((t) => {
          const on = t === tab;
          t.classList.toggle("active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll("[data-frg-pane]").forEach((pane) => {
          pane.classList.toggle("active", pane.dataset.frgPane === want);
        });
      });
    });

    // The header menu, and a click anywhere else closes it.
    $("frgMoreBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("frgMoreMenu");
      if (!menu) return;
      const open = menu.hidden;
      menu.hidden = !open;
      $("frgMoreBtn")?.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      const menu = $("frgMoreMenu");
      if (!menu || menu.hidden) return;
      if (e.target.closest(".frg-more-wrap")) return;
      menu.hidden = true;
      $("frgMoreBtn")?.setAttribute("aria-expanded", "false");
    });

    $("frgGodBtn")?.addEventListener("click", () => runGodAgent(false));
    $("frgImproveBtn")?.addEventListener("click", () => void improveModel());
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
      if (e.target.dataset.frgModelSize !== undefined) { setModelSizeMm(e.target.value); return; }
      const posAxis = e.target.dataset.frgPos;
      const scaleAxis = e.target.dataset.frgScale;
      const rotAxis = e.target.dataset.frgRot;
      const paramKey = e.target.dataset.frgParam;
      if (posAxis) updateSelectedPosition(posAxis, e.target.value);
      if (scaleAxis) updateSelectedScale(scaleAxis, e.target.value);
      if (rotAxis) updateSelectedRotation(rotAxis, e.target.value);
      // Recorded, so a dimension typed by mistake can be taken back the same
      // way a move can. Every other edit on this panel already could be.
      if (paramKey) recordEdit(`change ${paramKey}`, () => updateSelectedParam(paramKey, e.target.value));
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
      else if (tool === "undo") undoEdit();
      else if (tool === "redo") redoEdit();
      else if (tool === "delete") recordEdit("delete", deleteSelectedPart);
      else if (tool === "duplicate") recordEdit("duplicate", duplicateSelectedPart);
      else if (tool === "floor") recordEdit("drop to floor", alignSelectedToFloor);
      else if (tool === "snap") setSnapEnabled(!snapEnabled);
      else if (tool === "import") $("frgAssetImport")?.click();
      else if (tool === "solidify") solidifyModel();
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
      // Undo and redo before the single-letter tools, so the modifier wins.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoEdit(); else undoEdit();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoEdit();
        return;
      }
      // Every other shortcut here is a bare letter, so a held modifier means
      // the press was meant for the browser or the app, not for the editor.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        recordEdit("delete", deleteSelectedPart);
      } else if (e.key.toLowerCase() === "a") {
        selectWholeObject();
      } else if (e.key.toLowerCase() === "w") {
        setTransformMode("translate");
      } else if (e.key.toLowerCase() === "r") {
        setTransformMode("rotate");
      } else if (e.key.toLowerCase() === "s") {
        setTransformMode("scale");
      } else if (e.key.toLowerCase() === "d") {
        recordEdit("duplicate", duplicateSelectedPart);
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
    await loadForgeProjects();
    syncModelSelectors();
    renderForgeProjects();
    // Whatever is loaded, not nothing. Entering Forge a second time used to
    // reset the header to "Void ready · 0 mesh parts" while the model was
    // still in the scene and activePlan still held it — the panel disagreed
    // with the viewport until some later click happened to refresh it.
    updatePlanList(activePlan);
    wireEvents();
    syncEditHistoryButtons();
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
      sizeMm: activePlan?.sizeMm ?? null,
      sizeStated: activePlan?.sizeStated === true,
      mmPerUnit,
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
