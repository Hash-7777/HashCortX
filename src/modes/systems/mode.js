// ════════════════════════════════════════════════════════════════════
//  SYSTEM MAKER — interactive business app prototype builder
// ════════════════════════════════════════════════════════════════════

const SystemMaker = (() => {
  const STORE_KEY = "hashui_system_specs_v1";
  const DATA_KEY_PREFIX = "hashui_system_data_";
  const UI_STORE_KEY = "hashui_system_ui_v1";
  const MAX_HISTORY = 12;

  let mounted = false;
  let systems = [];
  let activeId = null;
  let activeModuleId = "";
  let selectedRecordId = "";
  let activeEntityId = "";
  let sortState = { field: "", dir: "asc" };
  let searchQuery = "";
  let runAbort = null;
  // Ceiling for one generation — see runBudgetExceeded in js/agent-policy.js.
  let runBudget = null;
  let traceStart = Date.now();
  let libraryCollapsed = false;
  let inspectorCollapsed = true;
  let filterRules = [];
  let filterPanelOpen = false;
  let selectedIds = new Set();
  let importState = null;
  let recordModalIsNew = false;
  let calendarMonth = "";

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  // Colours: a theme turned into CSS variables — js/systems/theme.js.
  const { themeVars } = window.HCSystemsTheme;



  // Creative directives injected randomly into AI prompts to force variety
  const CREATIVE_DIRECTIVES = [
    'Lead with a "metric" home screen — giant KPI tiles with sparklines, skip the generic table dashboard.',
    'Use a "feed" screen for live operational data instead of kanban — scrollable activity cards with avatars.',
    'Show the primary tracking module as "timeline" to emphasize date-ordered flow rather than status columns.',
    'Use "calendar" as the core scheduling module — put key records as chips on date cells.',
    'Use "cards" grid as the main browsing experience — visual, avatar-based, not a raw table.',
    'Use "split" view for the main entity module — rich detail panel on the right, list on the left.',
    'Keep only ONE "list" screen — replace the rest with kanban, cards, timeline, feed, and calendar.',
    'Make every module.color distinct — a different hex per module, making the nav a spectrum of colors.',
    'Choose shell "dock" — an ultra-narrow icon rail on the left, then fill the wide main area with rich screens.',
    'Choose shell "top" — horizontal tabs across the full width, giving a product/SaaS feel.',
    'Use "report" as the second module for immediate business intelligence — include meaningful kpis.',
    'Make the accent color dramatically different from primary (complementary, not analogous) for contrast.',
    'Choose shell "command" and use "feed" + "timeline" screens to give a developer-tool aesthetic.',
    'Use "cards" for people/products, "timeline" for activity, "metric" for KPIs — skip tables entirely.',
  ];

  // ── Reading and judging a generated spec ────────────────────────────────
  //
  // These decide whether a model's answer can be read at all and whether what
  // it says is complete enough to build from — everything below rests on
  // them. They live in src/js/systems/spec.js so they can be handed an input
  // and asked what they decide, which is not something a four-thousand-line
  // mode file allows. The wrappers here are what the rest of this file calls.
  const SPEC = () => window.HCSystemsSpec;
  const VALID_SCREENS = SPEC()
    ? SPEC().VALID_SCREENS
    : ["dashboard","list","kanban","report","split","cards","timeline","calendar","metric","feed"];

  const slug = (raw, fallback = "item") => SPEC().slug(raw, fallback);

  // ── The arithmetic under every generated record ─────────────────────────
  //
  // Totals, due dates and sample figures, in src/js/forge-sized pieces at
  // src/js/systems/money.js so each can be asked a question. Moving `addDays`
  // out is what found that it had been returning a date a day early for
  // everyone east of Greenwich.
  // ── What kind of business this is, and what it keeps ────────────────────
  //
  // Six hundred lines of the app's own opinion about business software: which
  // industry a description belongs to and what a record in it should have on
  // it. Both are guesses, and in src/js/systems/domain.js they are guesses
  // that can be read and questioned — including whether the fields they hand
  // out satisfy this mode's own validation gate.
  const DOMAIN = () => window.HCSystemsDomain;
  const FINANCE_ENTITY_IDS = new Proxy({}, {
    get: (_, key) => DOMAIN().FINANCE_ENTITY_IDS[key],
    has: (_, key) => key in DOMAIN().FINANCE_ENTITY_IDS,
  });
  const detectDomain = (desc) => DOMAIN().detectDomain(desc);
  // Read through a getter so the table is never captured before it loads.
  const DOMAIN_CONFIG = new Proxy({}, {
    get: (_, key) => DOMAIN().DOMAIN_CONFIG[key],
    has: (_, key) => key in DOMAIN().DOMAIN_CONFIG,
  });
  const defaultFields = (entityName, domain = "") => DOMAIN().defaultFields(entityName, domain);
  const financeProfile = (desc) => DOMAIN().financeProfile(desc);
  const financeFields = (currency) => DOMAIN().financeFields(currency);

  const MONEY = () => window.HCSystemsMoney;
  // How a record is named, a figure shown and a board divided — one answer
  // for every screen, in src/js/systems/view.js.
  const VIEW = () => window.HCSystemsView;
  let viewCurrency = "USD";
  const seededRand = (seed, idx) => MONEY().seededRand(seed, idx);
  const roundMoney = (n) => MONEY().roundMoney(n);
  const addDays = (iso, days) => MONEY().addDays(iso, days);
  const recentMonths = (count = 12) => MONEY().recentMonths(count);
  const uniqueModuleId = (spec, raw) =>
    MONEY().uniqueModuleId((spec?.modules || []).map((m) => m.id), raw, slug);
  const structuredCloneSafe = (obj) => SPEC().cloneSafe(obj);
  const rawEntityMap = (entities) => SPEC().entityMap(entities);
  const parseSpecJson = (raw) => SPEC().parseJson(raw);
  const validateRawGeneratedSpec = (raw) => SPEC().validate(raw);
  // The panel's own state is passed in rather than reached for, which is what
  // makes the searching, filtering and sorting checkable at all.
  const prepareRecords = (rows) => SPEC().prepareRecords(rows, {
    search: searchQuery,
    filters: filterRules,
    sort: sortState,
  });

  const FALLBACK_SCREENS = ["kanban","split","cards","report","timeline","list","feed","calendar","metric","list"];

  const ACCENT_PALETTE = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6","#8b5cf6","#f97316","#06b6d4","#84cc16"];


  // Icons: which one a module gets, and the drawings — js/systems/icons.js.
  const { KPI_ICONS, moduleIcon } = window.HCSystemsIcons;

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function _sysDialog({ msg, showInput, inputDefault, showCancel }) {
    return new Promise(resolve => {
      const overlay   = document.getElementById("amkDialog");
      const msgEl     = document.getElementById("amkDialogMsg");
      const inputEl   = document.getElementById("amkDialogInput");
      const okBtn     = document.getElementById("amkDialogOk");
      const cancelBtn = document.getElementById("amkDialogCancel");
      if (!overlay) { resolve(showInput ? inputDefault : (showCancel ? true : undefined)); return; }
      msgEl.textContent       = msg;
      inputEl.style.display   = showInput  ? "block" : "none";
      cancelBtn.style.display = showCancel ? ""      : "none";
      if (showInput) inputEl.value = inputDefault || "";
      overlay.classList.add("open");
      if (showInput) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 80);
      const cleanup = () => {
        overlay.classList.remove("open");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        inputEl.removeEventListener("keydown", onKey);
      };
      const onOk     = () => { cleanup(); resolve(showInput ? inputEl.value : true); };
      const onCancel = () => { cleanup(); resolve(showInput ? null : false); };
      const onKey    = (e) => { if (e.key === "Enter") onOk(); if (e.key === "Escape") onCancel(); };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      inputEl.addEventListener("keydown", onKey);
    });
  }
  const _sysPrompt  = (msg, def) => _sysDialog({ msg, showInput: true,  inputDefault: def, showCancel: true });
  const _sysConfirm = (msg)      => _sysDialog({ msg, showInput: false, showCancel: true });

  function uid(prefix = "sys") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function nowLabel(ts = Date.now()) {
    return new Date(ts).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
  }

  function setStatus(text, cls = "") {
    const el = $("sysRunStatus");
    if (!el) return;
    el.textContent = text;
    el.className = `sys-run-status ${cls}`.trim();
    const dot = $("sysTraceDot");
    if (dot) {
      if (cls === "running") dot.className = "sys-trace-dot running";
      else if (cls === "done") dot.className = "sys-trace-dot done";
      else if (cls === "error") dot.className = "sys-trace-dot error";
      else dot.className = "sys-trace-dot";
    }
  }

  const traceIcons = {
    run:  `<svg viewBox="0 0 16 16"><path d="M4 2.5 12.5 8 4 13.5z"/></svg>`,
    ok:   `<svg viewBox="0 0 16 16"><path d="m3 8.5 3 3L13 4"/></svg>`,
    plan: `<svg viewBox="0 0 16 16"><path d="M3 3h10v10H3z"/><path d="M5 6h6M5 9h4"/></svg>`,
    data: `<svg viewBox="0 0 16 16"><ellipse cx="8" cy="3.5" rx="5" ry="2"/><path d="M3 3.5v6c0 1.1 2.2 2 5 2s5-.9 5-2v-6"/><path d="M3 6.5c0 1.1 2.2 2 5 2s5-.9 5-2"/></svg>`,
    warn: `<svg viewBox="0 0 16 16"><path d="M8 2 14 13H2z"/><path d="M8 6v3M8 11h.01"/></svg>`,
    err:  `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>`,
  };

  const traceAgentLabel = {
    run:  "Agent",
    ok:   "Done",
    plan: "Architect",
    data: "Data Eng",
    warn: "Warning",
    err:  "Error",
  };

  function trace(msg, cls = "run") {
    const el = $("sysTrace");
    if (!el) return;

    // Auto-expand console on first entry
    const console_ = $("sysTraceConsole");
    if (console_ && console_.classList.contains("collapsed")) {
      console_.classList.remove("collapsed");
      console_.classList.add("expanded");
    }

    const t = ((Date.now() - traceStart) / 1000).toFixed(1);
    const row = document.createElement("div");
    row.className = "sys-trace-entry";
    const agentLabel = traceAgentLabel[cls] || "Agent";
    row.innerHTML =
      `<span class="sys-te-time">[${t}s]</span>` +
      `<span class="sys-te-agent sys-te-${cls}">${esc(agentLabel)}</span>` +
      `<span class="sys-te-icon sys-te-${cls}">${traceIcons[cls] || traceIcons.run}</span>` +
      `<span class="sys-te-msg sys-te-${cls}">${esc(msg)}</span>`;
    el.appendChild(row);
    el.scrollTop = el.scrollHeight;

    // Also mirror into bottom drawer so traces are always visible
    if (console_) {
      let entries = console_.querySelector(".sys-trace-entries");
      if (!entries) {
        entries = document.createElement("div");
        entries.className = "sys-trace-entries";
        console_.appendChild(entries);
      }
      entries.appendChild(row.cloneNode(true));
      entries.scrollTop = entries.scrollHeight;
    }

    // Update dot + summary
    const dot = $("sysTraceDot");
    if (dot) dot.className = "sys-trace-dot" + (cls === "err" ? " error" : cls === "ok" ? " done" : " running");
    const summary = $("sysTraceSummary");
    if (summary) summary.textContent = msg.slice(0, 70);
  }

  function clearTrace() {
    traceStart = Date.now();
    const el = $("sysTrace");
    if (el) el.innerHTML = "";
    const console_ = $("sysTraceConsole");
    const entries = console_?.querySelector(".sys-trace-entries");
    if (entries) entries.innerHTML = "";
    const dot = $("sysTraceDot");
    if (dot) dot.className = "sys-trace-dot";
    const summary = $("sysTraceSummary");
    if (summary) summary.textContent = "No run yet";
  }

  function updateCreateButtonState() {
    const btn = $("sysCreateBtn");
    if (!btn) return;
    const running = !!runAbort;
    const stopping = running && runAbort.signal?.aborted;
    btn.disabled = false;
    btn.textContent = stopping ? "Stopping" : running ? "Stop" : "Generate";
    btn.classList.toggle("primary", !running);
    btn.classList.toggle("danger", running);
    btn.setAttribute("aria-label", running ? "Stop system generation" : "Generate system");
    btn.title = running ? "Stop the current generation run" : "Generate a new system";
    const change = $("sysChangeBtn");
    if (change) change.disabled = running || !getActive();
  }

  function stopSystemGeneration() {
    if (!runAbort) return;
    if (!runAbort.signal?.aborted) {
      trace("Stop requested — aborting active generation", "warn");
      runAbort.abort();
    }
    setStatus("Stopping", "running");
    updateCreateButtonState();
  }

  function loadUiState() {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_STORE_KEY) || "{}");
      libraryCollapsed = false;
      inspectorCollapsed = true; // always start closed; opens on demand
    } catch {
      libraryCollapsed = false;
      inspectorCollapsed = true;
    }
  }

  function saveUiState() {
    try { localStorage.setItem(UI_STORE_KEY, JSON.stringify({ libraryCollapsed, inspectorCollapsed })); } catch {}
  }

  function applyPanelState() {
    const wrap = $("system-maker-wrap");
    if (!wrap) return;
    wrap.classList.toggle("library-collapsed", libraryCollapsed);
    wrap.classList.toggle("data-collapsed", inspectorCollapsed);
  }

  function setLibraryCollapsed(value) {
    libraryCollapsed = !!value;
    applyPanelState();
    saveUiState();
  }

  function setInspectorCollapsed(value) {
    inspectorCollapsed = !!value;
    applyPanelState();
    saveUiState();
  }

  function loadSystems() {
    try {
      systems = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      if (!Array.isArray(systems)) systems = [];
    } catch {
      systems = [];
    }
    systems = systems.map(s => normalizeSpec(s, s.description || "")).filter(Boolean);
    activeId = systems[0]?.id || null;
  }

  function saveSystems() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(systems)); } catch {}
  }

  function dataKey(id) {
    return DATA_KEY_PREFIX + id;
  }

  function getActive() {
    return systems.find(s => s.id === activeId) || null;
  }

  function getRuntimeData(spec) {
    if (!spec) return {};
    try {
      const saved = JSON.parse(localStorage.getItem(dataKey(spec.id)) || "null");
      if (saved && typeof saved === "object") return saved;
    } catch {}
    return structuredCloneSafe(spec.mockData || {});
  }

  function saveRuntimeData(spec, data) {
    if (!spec) return;
    try { localStorage.setItem(dataKey(spec.id), JSON.stringify(data || {})); } catch {}
  }

  function resetRuntimeData(spec) {
    if (!spec) return;
    try { localStorage.removeItem(dataKey(spec.id)); } catch {}
  }



  function threeWords(str) {
    return String(str || "").trim().split(/\s+/).slice(0, 3).join(" ");
  }

  function fieldType(value, name = "") {
    const n = String(name || "").toLowerCase();
    if (/date|time/.test(n)) return "date";
    if (/amount|total|price|cost|revenue|salary|qty|quantity|stock|count|score|rate|percent|balance|value/.test(n)) return "number";
    if (/status|stage|priority|type|category/.test(n)) return "select";
    if (typeof value === "number") return "number";
    return "text";
  }


  function normalizeSpec(raw, desc = "", previousSpec = null) {
    const spec = raw && typeof raw === "object" ? structuredCloneSafe(raw) : {};
    spec.id = spec.id || previousSpec?.id || uid("system");
    spec.name = threeWords(spec.name || previousSpec?.name || inferName(desc) || "Business System");
    spec.description = String(spec.description || desc || previousSpec?.description || "Interactive business system prototype").slice(0, 180);
    spec.createdAt = spec.createdAt || previousSpec?.createdAt || Date.now();
    spec.updatedAt = Date.now();
    spec.revisionHistory = Array.isArray(spec.revisionHistory) ? spec.revisionHistory.slice(0, MAX_HISTORY) : [];

    spec.theme = {
      mode: spec.theme?.mode === "dark" ? "dark" : "light",
      primary: spec.theme?.primary || "#2563eb",
      accent: spec.theme?.accent || "#10b981",
      density: ["compact","comfortable","spacious"].includes(spec.theme?.density) ? spec.theme.density : undefined,
      radius: Number(spec.theme?.radius || 10),
      font: window.HCSystemsTheme.DESIGN.font.includes(spec.theme?.font) ? spec.theme.font : undefined,
      surface: window.HCSystemsTheme.DESIGN.surface.includes(spec.theme?.surface) ? spec.theme.surface : undefined,
    };
    spec.domain = spec.domain || detectDomain(desc);
    spec.layout = {
      nav: spec.layout?.nav === "top" ? "top" : "sidebar",
      // A missing shell is picked, to suit the business, when the system is made.
      shell: window.HCSystemsTheme.DESIGN.shell.includes(spec.layout?.shell) ? spec.layout.shell : undefined,
      dashboardStyle: window.HCSystemsTheme.DASHBOARDS.includes(spec.layout?.dashboardStyle) ? spec.layout.dashboardStyle : undefined,
    };

    const moduleNames = Array.isArray(spec.modules) && spec.modules.length
      ? spec.modules.map(m => m.name || m.id)
      : ["Overview", "Sales", "Inventory", "Customers", "Finance", "Operations"];
    spec.modules = moduleNames.slice(0, 10).map((name, idx) => {
      const old = Array.isArray(spec.modules) ? spec.modules[idx] || {} : {};
      const id = old.id || slug(name, `module_${idx + 1}`);
      const entity = old.entity || (idx === 0 ? slug(moduleNames[1] || "sales") : slug(name));
      const fallbackScreen = idx === 0 ? "dashboard" : FALLBACK_SCREENS[idx % FALLBACK_SCREENS.length];
      const screen = VALID_SCREENS.includes(old.screen) ? old.screen : fallbackScreen;
      return {
        id,
        name: String(old.name || name || `Module ${idx + 1}`).slice(0, 32),
        icon: old.icon || moduleIcon(name),
        entity,
        screen,
        kpis: Array.isArray(old.kpis) ? old.kpis : null,
        color: old.color || null,
      };
    });

    spec.entities = normalizeEntities(spec.entities, spec.modules);
    // A link to an entity the system does not have is plain text.
    Object.values(spec.entities).forEach(e => { e.fields = e.fields.map(f => REL().usableField(f, Object.keys(spec.entities))); });
    // Which entities the model wrote no records for, so they can be asked for;
    // kept off the saved spec.
    const standIns = [];
    spec.mockData = normalizeData(spec.mockData, spec.entities, previousSpec, standIns);
    Object.defineProperty(spec, "standIns", { value: standIns, enumerable: false, configurable: true });
    spec.screens = Array.isArray(spec.screens) ? spec.screens : [];
    // Only the model's workflows; with none, every system got the same two.
    spec.workflows = (Array.isArray(spec.workflows) ? spec.workflows : [])
      .filter(w => w && String(w.name || "").trim() && Array.isArray(w.stages) && w.stages.filter(x => String(x || "").trim()).length >= 2)
      .map(w => ({ ...w, stages: w.stages.map(String).filter(x => x.trim()) }));
    spec.interactions = Array.isArray(spec.interactions) && spec.interactions.length ? spec.interactions : [
      "module navigation", "search", "sort", "row selection", "add record", "edit record", "delete record", "localStorage persistence"
    ];
    return spec;
  }

  function normalizeEntities(input, modules) {
    const map = {};
    if (input && typeof input === "object" && !Array.isArray(input)) {
      Object.entries(input).forEach(([id, e]) => {
        map[slug(id)] = {
          id: slug(e?.id || id),
          name: e?.name || titleCase(id),
          fields: Array.isArray(e?.fields) && e.fields.length ? e.fields.map(normalizeField) : defaultFields(e?.name || id),
        };
      });
    } else if (Array.isArray(input)) {
      input.forEach(e => {
        const id = slug(e?.id || e?.name);
        if (!id) return;
        map[id] = { id, name: e.name || titleCase(id), fields: Array.isArray(e.fields) && e.fields.length ? e.fields.map(normalizeField) : defaultFields(e.name || id) };
      });
    }
    modules.forEach(m => {
      const id = slug(m.entity || m.id);
      if (!map[id]) map[id] = { id, name: titleCase(id), fields: defaultFields(id) };
    });
    return map;
  }

  function normalizeField(f) {
    if (typeof f === "string") return { id: slug(f), label: titleCase(f), type: fieldType("", f) };
    const id = slug(f?.id || f?.name || f?.label, "field");
    return {
      id,
      label: f?.label || f?.name || titleCase(id),
      type: ["text","number","date","select","textarea","link"].includes(f?.type) ? f.type : fieldType("", id),
      options: Array.isArray(f?.options) && f.options.length ? f.options : undefined,
      required: !!f?.required,
      ...(f?.type === "link" && f?.entity ? { entity: slug(f.entity) } : {}),
      ...(typeof f?.formula === "string" && f.formula.trim() ? { formula: f.formula.trim() } : {}),
    };
  }

  function normalizeData(input, entities, previousSpec, standIns = []) {
    const data = {};
    const oldRuntime = previousSpec ? getRuntimeData(previousSpec) : null;
    Object.values(entities).forEach(entity => {
      // Try to find AI-provided data using multiple key formats
      let rows = oldRuntime?.[entity.id] || null;
      if (!rows && input && typeof input === "object") {
        const candidates = [
          entity.id,
          entity.name,
          slug(entity.name),
          entity.name.toLowerCase(),
          entity.id.replace(/_/g, ""),
        ];
        for (const key of candidates) {
          if (Array.isArray(input[key]) && input[key].length) { rows = input[key]; break; }
        }
        // Last resort: case-insensitive search over all keys
        if (!rows) {
          const lc = entity.id.toLowerCase();
          const match = Object.keys(input).find(k => k.toLowerCase() === lc || slug(k) === lc);
          if (match && Array.isArray(input[match])) rows = input[match];
        }
      }
      if (!(Array.isArray(rows) && rows.length)) standIns.push(entity.id);
      data[entity.id] = Array.isArray(rows) && rows.length
        ? rows.map((r, idx) => normalizeRecord(r, entity, idx))
        : Array.from({ length: 8 }, (_, idx) => normalizeRecord({}, entity, idx));
    });
    return data;
  }

  function normalizeRecord(row, entity, idx) {
    const out = { id: row?.id || `${entity.id}_${idx + 1}` };
    entity.fields.forEach(f => {
      // Try exact id, then label variants, then fuzzy slug match
      const val = row?.[f.id]
        ?? row?.[f.label]
        ?? row?.[f.label?.toLowerCase()]
        ?? row?.[slug(f.label)]
        ?? row?.[f.id.replace(/_/g,"")]
        ?? undefined;
      out[f.id] = val !== undefined ? val : window.HCSystemsSamples.sampleValue(f, idx, entity.id, todayIso());
    });
    return REL().computeRecord(out, entity).record;
  }

  function titleCase(raw) {
    return String(raw || "").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }



  function inferName(desc) {
    const m = String(desc || "").match(/(?:called|named)\s+["'"«]?([^"'"»,\.]+)/i);
    if (m) return threeWords(m[1].trim());
    const domain = detectDomain(desc);
    return DOMAIN_CONFIG[domain]?.name || "Business Operating System";
  }

  function systemPrompt() {
    return `You are a world-class ERP architect. Return ONLY valid JSON for a SystemSpec. No markdown, no prose, no code fences.

REQUIRED TOP-LEVEL KEYS:
id, name, description, theme, layout, modules, entities, screens, workflows, mockData, interactions, revisionHistory

SCREEN TYPES — use every generation differently. Never output the same combination twice:
• "dashboard"  — KPI cards + table + side charts. First module only.
• "list"       — Sortable table. Reference data only. MAX ONE per spec.
• "kanban"     — Status columns. Pipelines, orders, recruitment, tickets.
• "report"     — KPIs + bar charts. Analytics, revenue, performance.
• "split"      — List + detail panel. CRM, employees, suppliers, contacts.
• "cards"      — Grid of visual cards. Products, menu items, members, staff.
• "timeline"   — Date-ordered events. History, shipments, audit logs.
• "calendar"   — Monthly grid with chips. Appointments, bookings, schedules.
• "metric"     — Giant KPI tiles + sparklines. Executive view, pure analytics.
• "feed"       — Scrolling activity. Support, messages, notifications, logs.

LAYOUT:
• modules[].screen: MANDATORY — at least 5 DIFFERENT types per spec. Never "list" for more than one module.
• modules[].kpis: [{label, field, aggregate}] where aggregate is "sum"|"count"|"avg"|"max". Required for dashboard/report/metric.
• modules[].color: REQUIRED on every module — different hex per module (spectrum of colors in nav).
• layout.shell: choose boldly — vary by run, not just by domain default:
  - "sidebar"   — classic left panel. Finance, accounting, operations.
  - "top"       — horizontal tabs. SaaS, education, product tools.
  - "dock"      — icon-only 56px rail. Logistics, manufacturing, dense ops.
  - "cards-nav" — module card strip. Restaurant, retail, hotel, fitness.
  - "command"   — compact VS Code style. Healthcare, legal, HR, CRM.
• layout.nav: match the shell ("top" if shell is "top", "sidebar" otherwise).
• Follow the CREATIVE DIRECTIVE in the user message — it overrides domain defaults.

THEME (industry-appropriate colors — never use default blue for all domains):
• Restaurant/F&B      → primary "#92400e", accent "#f59e0b",  mode "light"  (warm amber/brown)
• Hotel/Hospitality   → primary "#1e3a5f", accent "#60a5fa",  mode "light"  (deep navy + sky)
• Healthcare          → primary "#0e7490", accent "#06b6d4",  mode "light"  (clinical teal/cyan)
• Education           → primary "#3730a3", accent "#818cf8",  mode "light"  (rich indigo)
• Fitness/Gym         → primary "#7c3aed", accent "#4ade80",  mode "dark"   (electric purple + neon green)
• Real Estate         → primary "#047857", accent "#10b981",  mode "light"  (forest green)
• Retail/E-commerce   → primary "#be185d", accent "#f472b6",  mode "light"  (hot pink/magenta)
• Logistics/Supply    → primary "#0369a1", accent "#38bdf8",  mode "dark"   (steel blue + cyan)
• Manufacturing       → primary "#1d4ed8", accent "#fb923c",  mode "dark"   (industrial blue + orange)
• HR/People Ops       → primary "#6d28d9", accent "#c4b5fd",  mode "light"  (deep violet + lavender)
• Legal/Law           → primary "#1c1917", accent "#d97706",  mode "light"  (charcoal + gold)
• Finance/Accounting  → primary "#0c4a6e", accent "#0ea5e9",  mode "light"  (dark navy + sky blue)
• Jewelry/Luxury      → primary "#b45309", accent "#fbbf24",  mode "dark"   (deep gold + amber)
• Tech/SaaS           → primary "#0f172a", accent "#38bdf8",  mode "dark"   (near-black + electric blue)
• theme.radius: 6-8 for corporate/legal, 10-12 for standard, 14-16 for retail/consumer-facing
• theme.font: "sans" | "serif" | "rounded" | "humanist" | "mono" — the character of the business (a law firm or a hotel may be serif, a gym rounded, a logistics desk mono)
• theme.density: "compact" for dense operations, "comfortable", "spacious" for calm consumer-facing work
• theme.surface: "flat" | "outlined" | "elevated" — how cards sit on the page

ENTITIES & FIELDS:
• Each entity: {id, name, fields[]}
• Fields: {id, label, type, required?, options?} — type: "text"|"number"|"date"|"select"|"textarea"
• Field ids must exactly match mockData record property names
• Give each entity the fields THIS business really keeps for it — not a generic set. A supplier list may have no date; a staff list may have no amount.
• What a screen needs: a "kanban" entity needs a select field of 3-6 real stages (with options); a "calendar" or "timeline" entity needs a date field; a "dashboard", "report" or "metric" entity needs a number field.
• A field that points at a record of another entity (an order's customer, a booking's room) is {"type":"link","entity":"<that entity's id>"}; its mockData value is that record's name exactly as written there.
• A number worked out from others on the same record carries "formula", e.g. {"id":"line_total","type":"number","formula":"quantity * unit_price"} — field ids, numbers and + - * / ( ) only.

MOCK DATA (realistic, not placeholder):
• 5-7 records per entity
• Use real-sounding names (not "John Doe"), actual company names, realistic amounts
• Dates in YYYY-MM-DD format, within the past 12 months
• Status values must match the field's options exactly
• Number fields: realistic ranges (salaries $45k-$200k, order amounts $50-$50000, etc.)

FINANCIAL MODEL:
• Every ERP must include finance as a first-class operating area, not a cosmetic report.
• Include at least one finance/accounting module using "metric", "report", or "split".
• Include entities for invoices or sales, payments or receipts, expenses or bills, and monthly financial summary.
• Include enough financial fields to support revenue, cost, gross profit, net profit, cash balance, AR, AP, and payment status.
• Data must feel linked and plausible for the business size; do not output isolated random numbers.

WORKFLOWS:
• 1-3 workflows, each {id, name, entity, stages}: the entity whose records move through it, and stages that are exactly that entity's status options, in order
• only real processes this business runs (an order being cooked and served, a booking being confirmed) — none for records that do not move

Build a complete, production-realistic system. Impress with depth and realism.`;
  }

  // Routing lives in app.js so every mode shapes a request the same way. This
  // used to send everything that was not Gemini to the OpenAI client —
  // including Anthropic, whose endpoint needs a different body and never
  // answers with `choices`. Every call with a Claude model selected therefore
  // failed, and because a failure here means failover, generation walked the
  // whole provider list twice before stopping.
  async function callModel(modelValue, messages, signal, temperature = 0.25) {
    // Every model call in a generation passes through here, so this is where
    // the ceiling belongs — one place rather than in each of the three retry
    // loops, which is how the total went unbounded.
    const stop = window.HCAgentPolicy.runBudgetExceeded(runBudget, Date.now());
    if (stop) {
      const err = new Error(stop);
      err.name = "BudgetExceeded";
      throw err;
    }
    window.HCAgentPolicy.chargeRunBudget(runBudget);
    const mv = modelValue || $("model")?.value || "llama3.2";
    return window._H.runModelTurn({ modelValue: mv, messages, tools: [], temperature, signal });
  }

  function modelTraceLabel(modelValue) {
    const mv = modelValue || "default";
    if (!mv.startsWith("cloud:")) return `local:${mv}`;
    const [, provider, model] = mv.split(":");
    return `${provider}:${model || "default"}`;
  }

  function isFailoverError(err) {
    // The budget is the thing that ends a run. Treating it as failover would
    // hand the run straight to the next provider, which is the behaviour it
    // exists to stop.
    if (err?.name === "BudgetExceeded" || err?.name === "AbortError") return false;
    return /rate.?limit|quota|429|too many|capacity|overloaded|unavailable|timeout|timed.?out|failed to fetch|jsondecodeerror|invalid_request_error|invalid ai systemspec|semantic repair|tool|function|model.{0,12}not.{0,12}found|context/i.test(err?.message || "");
  }

  function modelScore(value, label) {
    const t = `${value || ""} ${label || ""}`.toLowerCase();
    let score = 0;
    if (/gpt-5|gpt-4\.1|gpt-4o|claude|opus|sonnet/.test(t)) score += 160;
    if (/gemini-2\.5-pro|gemini.*pro/.test(t)) score += 145;
    if (/deepseek|r1|v3/.test(t)) score += 130;
    if (/405b|235b|120b|70b|maverick|nemotron|hermes|qwen/.test(t)) score += 115;
    if (/flash|lite|mini|small|instant|8b/.test(t)) score -= 45;
    if (/embedding|rerank|moderation|vision|image|tts|whisper/.test(t)) score -= 1000;
    return score;
  }

  function availableModels() {
    const src = $("model");
    if (!src) return [];
    return Array.from(src.options)
      .map(o => ({ value:o.value, label:o.textContent || o.label || o.value, disabled:o.disabled }))
      .filter(o => o.value && !o.disabled)
      .sort((a, b) => modelScore(b.value, b.label) - modelScore(a.value, a.label));
  }

  function failoverModels(active) {
    const activeProvider = active?.startsWith("cloud:") ? active.split(":")[1] : "local";
    const seen = new Set([activeProvider]);
    const out = [];
    for (const opt of availableModels()) {
      const provider = opt.value.startsWith("cloud:") ? opt.value.split(":")[1] : "local";
      if (seen.has(provider)) continue;
      seen.add(provider);
      out.push(opt.value);
    }
    return out;
  }

  function godAgentPrompt() {
    return `You are the God Agent — a senior ERP architect who assigns specialist agents.
Given a business description, produce a Domain Brief: a compact JSON object your specialist agents will build from.
Return ONLY valid JSON. No markdown, no prose, no code fences.

Required keys:
{
  "domain": "restaurant|hotel|healthcare|education|fitness|realestate|retail|logistics|manufacturing|hr|legal|saas|generic",
  "name": "Human-readable system name (≤48 chars)",
  "description": "One sentence about what this ERP manages",
  "theme": { "mode": "light|dark", "primary": "#hex", "accent": "#hex" },
  "layout": {
    "nav": "sidebar|top",
    "shell": "sidebar|top|dock|cards-nav|command"
  },
  "modules": [
    { "name": "Module Name", "entity": "entity_id", "screen": "dashboard|list|kanban|report|split|cards|timeline|calendar|metric|feed", "color": "#hex or null" }
  ],
  "agent_assignments": [
    "UX Agent: owns modules [name, name] with screen types [type, type] — rationale",
    "Data Agent: owns entities [entity, entity] — will generate realistic records",
    "Finance Agent: owns invoices, payments, expenses, and monthly financial summary — rationale",
    "Workflow Agent: designing [workflow name] for [entity] spanning N stages"
  ]
}

Rules:
- VARIETY IS MANDATORY. Each generation must feel different from the last. Do not default to the same screen types, shell, or color every time.
- modules array: 5-8 modules, MINIMUM 5 different screen types across them. Avoid repeating any type more than once unless 8+ modules.
- First module MUST be "dashboard" or "metric". Second module is never "list" — use kanban, split, or cards instead.
- layout.shell: choose boldly — a restaurant can use "top" or "sidebar" instead of always "cards-nav". Break domain stereotypes if the creative directive says so.
  "sidebar" → finance, accounting, generic; "top" → saas, education, lightweight;
  "dock" → logistics, manufacturing, dense ops; "cards-nav" → restaurant, retail, hotel, fitness;
  "command" → healthcare, legal, hr, CRM
- Theme: industry-specific, non-generic. Vary accent dramatically from primary (complementary, not analogous).
  restaurant→ "#92400e"/"#f59e0b" light; fitness→ "#7c3aed"/"#4ade80" dark; logistics→ "#0369a1"/"#38bdf8" dark;
  legal→ "#1c1917"/"#d97706" light; saas→ "#0f172a"/"#38bdf8" dark; retail→ "#be185d"/"#f472b6" light
- modules[].color: REQUIRED on every module — give each a distinct hex accent, making the nav a multi-color spectrum
- Include at least one finance/accounting module and the financial entities needed for revenue, expenses, cash, AR/AP, and margin
- agent_assignments: write 3 specific delegation lines reflecting actual screen and entity choices
- Follow the CREATIVE DIRECTIVE in the user message — it overrides defaults`;
  }

  function specialistPrompt(brief) {
    return `You are a specialist agent swarm executing a brief from the God Agent.
Return ONLY valid JSON for a complete SystemSpec. No markdown, no prose, no code fences.

GOD AGENT BRIEF:
${JSON.stringify(brief, null, 2)}

YOUR ASSIGNED ROLES:
① UX ARCHITECT — implement the exact modules and screen types from the brief. Keep nav and theme.
② DATA ENGINEER — for each entity in the modules, define realistic fields and 8-12 records of real data.
③ FINANCE AGENT — create realistic finance entities: invoices/sales, payments, expenses/bills, cash/bank, and monthly financial summary.
④ WORKFLOW DESIGNER — design 2-3 workflows with meaningful stage progressions.
⑤ VALIDATOR — verify all mockData keys match field ids exactly. No placeholder text.

REQUIRED TOP-LEVEL KEYS:
id, name, description, theme, layout, modules, entities, screens, workflows, mockData, interactions, revisionHistory

SCREEN TYPES (use exactly as specified in brief — implement all 10 types correctly):
• "dashboard"  — KPI summary cards + bar chart + top records table
• "list"       — Full-width sortable/filterable table
• "kanban"     — Cards grouped by status column
• "report"     — KPIs + bar charts + breakdowns
• "split"      — Table left + rich detail panel right
• "cards"      — Visual card grid: avatar, accent, stats. For people, products, menu items.
• "timeline"   — Date-ordered vertical timeline. For orders, events, bookings, history.
• "calendar"   — Monthly grid with record chips on dates. For appointments, schedules.
• "metric"     — Giant KPI tiles with sparklines. For pure analytics/exec dashboards.
• "feed"       — Scrolling feed with avatars. For messages, tickets, activity logs.

ENTITIES & FIELDS:
• Each entity matches a module's entity id from the brief
• Fields: {id, label, type, required?, options?} — type: "text"|"number"|"date"|"select"|"textarea"
• Field ids must exactly match mockData record property names
• Give each entity the fields THIS business really keeps for it — not a generic set. A supplier list may have no date; a staff list may have no amount.
• What a screen needs: a "kanban" entity needs a select field of 3-6 real stages (with options); a "calendar" or "timeline" entity needs a date field; a "dashboard", "report" or "metric" entity needs a number field.
• A field that points at a record of another entity (an order's customer, a booking's room) is {"type":"link","entity":"<that entity's id>"}; its mockData value is that record's name exactly as written there.
• A number worked out from others on the same record carries "formula", e.g. {"id":"line_total","type":"number","formula":"quantity * unit_price"} — field ids, numbers and + - * / ( ) only.

MOCK DATA (domain-realistic, not generic):
• 8-12 records per entity with real-sounding names, actual amounts, ISO dates (YYYY-MM-DD)
• Status values must exactly match the field's options array
• For restaurants: table numbers, dish names, prices; for hotels: room numbers, guest names; etc.
• Finance records must be internally plausible: invoices, payments, expenses, and summaries should support revenue, cost, profit, cash, AR, and AP.

WORKFLOWS:
• 1-3 workflows, each {id, name, entity, stages}: the entity whose records move through it, and stages that are exactly that entity's status options, in order

CRITICAL: Implement the exact modules and screen types from the God Agent brief. Do NOT substitute "list" for screens the brief specified. Preserve every layout.shell choice, every module.color, every screen type exactly as given. Be thorough, realistic, and domain-specific. No placeholder data.`;
  }

  /** Tells the model the last system's look, so it chooses another. */
  function lastDesignNote() {
    const d = window.HCSystemsTheme.designOf(systems[0]);
    return d && d.shell ? `The last system used a ${d.shell} layout, ${d.font || "sans"} type, ${d.density || "comfortable"} density and ${d.surface || "outlined"} cards — choose a different look.\n` : "";
  }

  async function generateWithModel(desc, signal) {
    let active = $("sysModelSelect")?.value || $("model")?.value || "";
    const tried = [];
    const creativeDirective = pickRandom(CREATIVE_DIRECTIVES);

    // ── PRIMARY: Single-shot direct generation (fastest & most reliable) ─
    trace("AI generating full SystemSpec…", "run");
    const messages = [
      { role:"system", content: systemPrompt() },
      { role:"user", content: `Create a complete SystemSpec for:\n${desc}\n\nToday is ${todayIso()}; date records in the months before it.\n${lastDesignNote()}CREATIVE DIRECTIVE: ${creativeDirective}\n[run-id:${Date.now().toString(36)}]` }
    ];
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      trace(`Direct generation attempt ${attempt} — ${modelTraceLabel(active)}`, "run");
      try {
        const result = await callModel(active, messages, signal, 0.35);
        let raw = result?.content || "";
        let parsed = parseSpecJson(raw);
        if (!parsed) {
          trace("JSON repair pass…", "warn");
          const repair = await callModel(active, [
            { role:"system", content: "You are a JSON repair tool. Return ONLY the cleaned valid JSON object. No markdown, no prose, no explanation. Fix any syntax errors (trailing commas, missing quotes, etc.). Preserve all data." },
            { role:"user", content: `Repair this into valid JSON:\n${raw.slice(0, 12000)}` }
          ], signal, 0.2);
          raw = repair?.content || "";
          parsed = parseSpecJson(raw);
        }
        if (!parsed) {
          trace(`Raw response preview: ${raw.slice(0, 120).replace(/\n/g, " ")}`, "warn");
          throw new Error("Model returned invalid SystemSpec JSON");
        }
        trace("SystemSpec JSON parsed", "ok");
        const spec = await writeMissingRecords(await finalizeOrRepairGeneratedSpec(active, parsed, raw, desc, signal, tried), desc, signal, active);
        trace("SystemSpec validated and finance model linked", "ok");
        return spec;
      } catch (err) {
        if (err.name === "AbortError" || err.name === "BudgetExceeded") throw err;
        trace(`${modelTraceLabel(active)} failed: ${String(err.message || err).slice(0, 90)}`, "warn");
        tried.push(active);
        if (!isFailoverError(err)) break;
        const next = failoverModels(active).find(m => !tried.includes(m));
        if (!next) break;
        active = next;
        trace(`Switching to ${modelTraceLabel(active)}`, "run");
      }
    }

    // ── FALLBACK: Multi-phase pipeline if direct generation fails ───────
    trace("Direct generation failed — trying multi-phase pipeline…", "warn");
    trace("① God Agent analysing domain…", "plan");
    let brief = null;
    const briefMessages = [
      { role:"system", content: godAgentPrompt() },
      { role:"user", content: `Business description: ${desc}\n\nCREATIVE DIRECTIVE (follow this): ${creativeDirective}\n[run-id:${Date.now().toString(36)}]` },
    ];
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const r = await callModel(active, briefMessages, signal, 0.92);
        brief = parseSpecJson(r?.content || "");
        if (brief && Array.isArray(brief.modules) && brief.modules.length) break;
        brief = null;
        throw new Error("Brief missing modules");
      } catch (err) {
        if (err.name === "AbortError" || err.name === "BudgetExceeded") throw err;
        trace(`God Agent brief attempt ${attempt} failed: ${String(err.message).slice(0,70)}`, "warn");
        const next = failoverModels(active).find(m => !tried.includes(m));
        if (next) { tried.push(active); active = next; trace(`→ switching to ${modelTraceLabel(active)}`, "run"); }
        else break;
      }
    }

    if (brief) {
      const assignments = Array.isArray(brief.agent_assignments) ? brief.agent_assignments : [];
      assignments.forEach(a => trace(`② ${a}`, "plan"));
      if (!assignments.length) {
        trace("② UX Agent shaping module layouts and theme", "plan");
        trace("② Data Agent generating domain-realistic records", "data");
        trace("② Workflow Agent modelling business process stages", "plan");
      }

      trace("③ Specialist agents building full SystemSpec…", "run");
      const specMessages = [
        { role:"system", content: specialistPrompt(brief) },
        { role:"user", content: `Build the complete SystemSpec now. Every module must have matching entity fields and mock data.\nToday is ${todayIso()}; date records in the months before it.\nCREATIVE DIRECTIVE: ${creativeDirective}` },
      ];
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          const r = await callModel(active, specMessages, signal, 0.35);
          let raw = r?.content || "";
          let parsed = parseSpecJson(raw);
          if (!parsed) {
            trace("Specialist JSON repair pass…", "warn");
            const repair = await callModel(active, [
              { role:"system", content: "You are a JSON repair tool. Return ONLY the cleaned valid JSON object. No markdown, no prose, no explanation. Fix any syntax errors." },
              { role:"user", content: `Repair this into valid JSON:\n${raw.slice(0, 12000)}` }
            ], signal, 0.2);
            parsed = parseSpecJson(repair?.content || "");
          }
          if (!parsed) throw new Error("Specialist agents returned invalid JSON");
          trace("④ Validator confirming field/data consistency", "ok");
          trace("SystemSpec ready", "ok");
          const spec = await writeMissingRecords(await finalizeOrRepairGeneratedSpec(active, parsed, raw, desc, signal, tried), desc, signal, active);
          trace("Finance model linked", "ok");
          return spec;
        } catch (err) {
          if (err.name === "AbortError" || err.name === "BudgetExceeded") throw err;
          trace(`Specialist attempt ${attempt} failed: ${String(err.message).slice(0,70)}`, "warn");
          tried.push(active);
          if (!isFailoverError(err)) break;
          const next = failoverModels(active).find(m => !tried.includes(m));
          if (!next) break;
          active = next;
          trace(`→ switching to ${modelTraceLabel(active)}`, "run");
        }
      }
      throw new Error("AI specialist agents could not produce a valid ERP SystemSpec. No template was inserted.");
    }

    // No silent deterministic fallback: the app should not show ready-made ERP templates as if AI designed them.
    throw new Error("AI generation failed before a valid ERP SystemSpec was created. No template was inserted; check the selected model or API key.");
  }

  function canonicalFinanceEntityForModule(module) {
    const text = `${module?.name || ""} ${module?.entity || ""}`.toLowerCase();
    if (!/finance|financial|account|invoice|billing|payment|revenue|cash|ledger|journal|expense|bill|receivable|payable|profit|margin|bank/.test(text)) return "";
    if (/invoice|billing|receivable/.test(text)) return FINANCE_ENTITY_IDS.invoices;
    if (/payment|receipt|collection/.test(text)) return FINANCE_ENTITY_IDS.payments;
    if (/expense|bill|payable|vendor/.test(text)) return FINANCE_ENTITY_IDS.expenses;
    if (/ledger|journal|entry/.test(text)) return FINANCE_ENTITY_IDS.journal;
    if (/bank|cash|transaction/.test(text)) return FINANCE_ENTITY_IDS.bank;
    if (/chart|account/.test(text) && !/summary|profit|revenue|finance|financial/.test(text)) return FINANCE_ENTITY_IDS.accounts;
    return FINANCE_ENTITY_IDS.summary;
  }

  function canonicalFinanceEntityForSchema(id, entity) {
    const text = `${id || ""} ${entity?.id || ""} ${entity?.name || ""}`.toLowerCase();
    if (/financial.?summary|finance.?summary|financialsummary|revenue.?summary|profit.?summary|cash.?summary/.test(text)) return FINANCE_ENTITY_IDS.summary;
    if (/\binvoices?\b|billing|receivable/.test(text)) return FINANCE_ENTITY_IDS.invoices;
    if (/\bpayments?\b|receipt|collection/.test(text)) return FINANCE_ENTITY_IDS.payments;
    if (/\bexpenses?\b|\bbills?\b|payable/.test(text)) return FINANCE_ENTITY_IDS.expenses;
    if (/journal|ledger|entries/.test(text)) return FINANCE_ENTITY_IDS.journal;
    if (/bank.?transaction|cash.?transaction|banking/.test(text)) return FINANCE_ENTITY_IDS.bank;
    if (/chart.?of.?accounts|chart_accounts|general.?ledger.?accounts/.test(text)) return FINANCE_ENTITY_IDS.accounts;
    return "";
  }

  function mergeGeneratedFields(base, additions) {
    const fields = Array.isArray(base) ? base.map(normalizeField) : [];
    const seen = new Set(fields.map(f => f.id));
    (additions || []).map(normalizeField).forEach(field => {
      if (!seen.has(field.id)) {
        fields.push(field);
        seen.add(field.id);
      }
    });
    return fields;
  }

  // The fields a model gives an entity are the entity. The app's template for
  // its kind of business used to be appended to every one — a model's menu
  // also got "Item Name", "Description", "Availability" and "Prep Time", which
  // it had no records for, so the app filled them from its own lists, and a
  // Lebanese restaurant's lamb chops were listed as "Dish: Cheesecake Slice" —
  // with "Business Value", "Updated" and "Status" added wherever one was
  // missing. The template now stands in only for an entity the model left
  // nearly empty; a finance entity still takes the fields its books need.
  function ensureGeneratedEntityFields(entity, entityId, desc) {
    const financeSchema = financeFields(/egp|egypt|cairo/i.test(desc || "") ? "EGP" : /eur|euro/i.test(desc || "") ? "EUR" : "USD")[entityId];
    if (financeSchema) entity.fields = mergeGeneratedFields(entity.fields, financeSchema);
    if ((entity.fields || []).length < 3) entity.fields = mergeGeneratedFields(entity.fields, defaultFields(entity.name || entityId, detectDomain(desc || "")));
    return entity;
  }

  function prepareRawGeneratedSpecForValidation(raw, desc) {
    const prepared = raw && typeof raw === "object" && !Array.isArray(raw) ? structuredCloneSafe(raw) : raw;
    if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) return prepared;
    const modules = Array.isArray(prepared.modules) ? prepared.modules : [];
    const existingEntities = rawEntityMap(prepared.entities);
    const entities = {};
    Object.entries(existingEntities).forEach(([id, entity]) => {
      const entityId = canonicalFinanceEntityForSchema(id, entity) || id;
      const current = entities[entityId] || { id: entityId, name: entity?.name || titleCase(entityId), fields: [] };
      current.name = current.name || entity?.name || titleCase(entityId);
      current.fields = mergeGeneratedFields(current.fields, Array.isArray(entity?.fields) ? entity.fields : []);
      entities[entityId] = current;
    });

    prepared.modules = modules.map((module, idx) => {
      const next = { ...(module || {}) };
      const canonicalFinance = canonicalFinanceEntityForModule(next);
      next.entity = canonicalFinance || slug(next.entity || next.name || `entity_${idx + 1}`);
      return next;
    });

    prepared.modules.forEach(module => {
      const entityId = slug(module?.entity || "");
      if (!entityId) return;
      const financeSchema = financeFields(/egp|egypt|cairo/i.test(`${desc} ${prepared.description}`) ? "EGP" : /eur|euro/i.test(`${desc} ${prepared.description}`) ? "EUR" : "USD")[entityId];
      const entity = entities[entityId] || { id: entityId, name: module?.name ? `${module.name} Records` : titleCase(entityId), fields: [] };
      entity.id = entityId;
      entity.name = entity.name || titleCase(entityId);
      if (financeSchema) entity.fields = mergeGeneratedFields(entity.fields, financeSchema);
      entities[entityId] = ensureGeneratedEntityFields(entity, entityId, `${desc} ${prepared.description || ""}`);
    });

    prepared.entities = entities;
    return prepared;
  }


  function semanticRepairPrompt() {
    return `You repair invalid ERP SystemSpec JSON.
Return ONLY one valid JSON object. No markdown, no prose, no code fences.

Repair requirements:
- Preserve the user's business idea, domain, theme direction, module intent, and visual variety.
- Do not replace the system with a generic ready-made template.
- Include 5-8 modules, at least 4 different screen types, and valid module.entity references.
- Every referenced entity must exist and include fields[].
- Give each entity the fields this business really keeps. A kanban entity needs a select field of stages; a calendar or timeline entity needs a date field; a dashboard, report or metric entity needs a number field. Add a field that fits the business, never a generic one such as "Business Value".
- Include real finance structure: invoices or sales, payments, expenses or bills, cash/bank, and monthly financial summary.
- mockData keys must match entity ids and record property names must match field ids.
- Use realistic business data, not placeholder rows.`;
  }

  /**
   * Ask the model for the records of entities it left empty. They used to be
   * filled from the app's own lists — a Lebanese restaurant's menu came out
   * as pizza and cheesecake. If this request fails, the stand-ins stay, and
   * the run says which entities they are.
   */
  async function writeMissingRecords(spec, desc, signal, model) {
    const finance = new Set(Object.values(DOMAIN().FINANCE_ENTITY_IDS));
    const ids = (spec.standIns || []).filter(id => !finance.has(id) && spec.entities[id]);
    if (!ids.length) return spec;
    const names = (list) => list.map(id => spec.entities[id].name).join(", ");
    trace(`Writing records for ${names(ids)}…`, "data");
    let got = null;
    try {
      // A link is written as the name of a record it points at; the names that
      // exist already are given, so what comes back can be followed.
      const namesOf = (eid) => spec.standIns?.includes(eid) ? [] : REL().choices(spec.mockData[eid] || [], spec.entities[eid]).slice(0, 30);
      const shapes = ids.map(id => ({ id, name: spec.entities[id].name, fields: spec.entities[id].fields.map(f => ({ id: f.id, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}), ...(f.type === "link" ? { entity: f.entity, names: namesOf(f.entity) } : {}), ...(f.formula ? { formula: f.formula } : {}) })) }));
      const r = await callModel(model, [
        { role:"system", content: `You write sample records for a business system. Return ONLY one JSON object: each key is an entity id, each value an array of 8 records. A record uses exactly the given field ids. Every value must fit this business and where it is: real-sounding names, the things this business really sells or handles, prices and quantities right for its size. A select value must be one of its options. A link value is the name of a record of its entity — one of its "names" when given. Leave a formula field out; it is worked out. Dates are YYYY-MM-DD between ${window.HCSystemsSamples.daysBefore(todayIso(), 180)} and ${todayIso()}. No placeholder text.` },
        { role:"user", content: `Business: ${desc}\nSystem: ${spec.name} — ${spec.description}\n\nEntities:\n${JSON.stringify(shapes)}` },
      ], signal, 0.7);
      got = parseSpecJson(r?.content || "");
    } catch (err) {
      if (err.name === "AbortError") throw err;
      trace(`Could not get records written: ${String(err.message || err).slice(0, 90)}`, "warn");
    }
    const left = ids.filter(id => {
      const rows = Array.isArray(got?.[id]) ? got[id].filter(r => r && typeof r === "object") : [];
      if (rows.length) spec.mockData[id] = rows.slice(0, 12).map((row, i) => normalizeRecord(row, spec.entities[id], i));
      return !rows.length;
    });
    if (left.length) trace(`Records for ${names(left)} are stand-ins made up by the app, not written for this business`, "warn");
    else trace(`Records written for ${names(ids)}`, "ok");
    return spec;
  }

  async function finalizeOrRepairGeneratedSpec(modelValue, parsed, rawText, desc, signal, tried = [], previousSpec = null) {
    try {
      return finalizeGeneratedSpec(parsed, desc, previousSpec);
    } catch (err) {
      if (!err.validationIssues) throw err;
      // What is actually wrong with it. The run used to announce a repair pass
      // and never say what it was repairing, so a run that ended without a
      // system gave no clue whether to change the description or the model.
      trace(`Spec is not renderable yet: ${err.validationIssues.slice(0, 3).join(" · ")}`, "warn");
      trace("Semantic SystemSpec repair pass...", "warn");

      // The repair fails over on its own, and this is the point of it. The
      // parsed spec is most of a run's work; when the repair call hit a
      // free-tier rate limit, the whole attempt was abandoned and the next
      // provider generated a brand new spec from nothing — throwing away a spec
      // that only needed fixing, and spending another provider's quota to
      // reach the same place. A refusal to answer one model is a reason to ask
      // another the same question, not to start again.
      const candidates = [modelValue, ...failoverModels(modelValue).filter(m => !tried.includes(m))];
      let lastErr = null;
      for (const model of candidates) {
        try {
          const repair = await callModel(model, [
            { role:"system", content: semanticRepairPrompt() },
            { role:"user", content: `Business request:\n${desc}\n\nValidation issues:\n- ${err.validationIssues.join("\n- ")}\n\nInvalid JSON to repair:\n${String(rawText || JSON.stringify(parsed || {})).slice(0, 18000)}` }
          ], signal, 0.25);
          const repaired = parseSpecJson(repair?.content || "");
          if (!repaired) throw new Error("Semantic repair returned invalid JSON.");
          return finalizeGeneratedSpec(repaired, desc, previousSpec);
        } catch (e) {
          // A stop is a stop, and the run budget is the whole point of having
          // one — neither is something to work around by asking again.
          if (e.name === "AbortError" || e.name === "BudgetExceeded") throw e;
          lastErr = e;
          if (!isFailoverError(e)) break;
          trace(`Repair on ${modelTraceLabel(model)} failed — asking another model to repair the same spec`, "warn");
        }
      }
      throw lastErr || new Error("Semantic repair failed");
    }
  }

  function finalizeGeneratedSpec(raw, desc, previousSpec = null) {
    const prepared = prepareRawGeneratedSpecForValidation(raw, desc);
    const issues = validateRawGeneratedSpec(prepared);
    if (issues.length) {
      const err = new Error(`Invalid AI SystemSpec: ${issues[0]}`);
      err.validationIssues = issues;
      throw err;
    }
    const spec = normalizeSpec(prepared, desc, previousSpec);
    reinforceGeneratedDesign(spec);
    enrichFinancialCore(spec, desc);
    reinforceGeneratedDesign(spec);
    assertRenderableSpec(spec);
    return spec;
  }

  function assertRenderableSpec(spec) {
    const issues = [];
    if (!Array.isArray(spec.modules) || spec.modules.length < 5) issues.push("Generated system has too few modules.");
    spec.modules.forEach(m => {
      if (!spec.entities?.[m.entity]) issues.push(`Module "${m.name}" points to missing entity "${m.entity}".`);
    });
    Object.values(spec.entities || {}).forEach(entity => {
      if (!Array.isArray(entity.fields) || !entity.fields.length) issues.push(`Entity "${entity.id}" has no fields.`);
      if (!Array.isArray(spec.mockData?.[entity.id])) issues.push(`Entity "${entity.id}" has no records.`);
    });
    if (issues.length) throw new Error(`Generated system could not be rendered: ${issues[0]}`);
  }

  function reinforceGeneratedDesign(spec) {
    if (!spec || !Array.isArray(spec.modules)) return spec;
    const used = new Set();
    spec.modules.forEach((module, idx) => {
      if (!VALID_SCREENS.includes(module.screen)) module.screen = idx === 0 ? "dashboard" : FALLBACK_SCREENS[idx % FALLBACK_SCREENS.length];
      if (idx === 0 && !["dashboard","metric"].includes(module.screen)) module.screen = "dashboard";
      if (module.screen === "list" && [...used].includes("list")) {
        module.screen = FALLBACK_SCREENS.find(s => s !== "list" && !used.has(s)) || "split";
      } else if (idx > 0 && used.has(module.screen) && used.size < Math.min(5, spec.modules.length)) {
        module.screen = FALLBACK_SCREENS.find(s => !used.has(s)) || module.screen;
      }
      used.add(module.screen);
      module.color = module.color || ACCENT_PALETTE[idx % ACCENT_PALETTE.length];
      module.icon = module.icon || moduleIcon(module.name);
    });
    if (spec.layout?.shell === "top") spec.layout.nav = "top";
    else if (spec.layout) spec.layout.nav = "sidebar";
    return spec;
  }






  function collectBusinessNames(spec, regex) {
    const out = [];
    Object.entries(spec.entities || {}).forEach(([entityId, entity]) => {
      const rows = spec.mockData?.[entityId] || [];
      const fields = (entity.fields || []).filter(f => regex.test(`${f.id} ${f.label}`));
      rows.slice(0, 20).forEach(row => {
        fields.forEach(f => {
          const value = String(row[f.id] || "").trim();
          if (value.length >= 3 && value.length <= 48 && !/^\d{4}-\d{2}-\d{2}$/.test(value)) out.push(value);
        });
      });
    });
    return [...new Set(out)].slice(0, 12);
  }

  function mergeFinanceEntity(spec, id, name, fields) {
    const current = spec.entities[id];
    if (!current) {
      spec.entities[id] = { id, name, fields: structuredCloneSafe(fields) };
      return;
    }
    current.id = id;
    current.name = current.name || name;
    current.fields = Array.isArray(current.fields) ? current.fields : [];
    const byId = new Set((current.fields || []).map(f => f.id));
    fields.forEach(field => {
      if (!byId.has(field.id)) current.fields.push(structuredCloneSafe(field));
    });
  }


  function ensureFinancialModules(spec) {
    const financeText = m => `${m.name || ""} ${m.entity || ""}`.toLowerCase();
    const hasFinance = spec.modules.some(m => /finance|account|billing|invoice|payment|revenue|cash|ledger|profit|expense/.test(financeText(m)));
    const hasInvoice = spec.modules.some(m => /invoice|billing|receivable/.test(financeText(m)));
    const financeKpis = [
      { label:"Revenue", field:"revenue", aggregate:"sum" },
      { label:"Net Profit", field:"net_profit", aggregate:"sum" },
      { label:"Cash", field:"cash_balance", aggregate:"max" },
      { label:"AR", field:"accounts_receivable", aggregate:"sum" },
    ];

    spec.modules.forEach(module => {
      if (/finance|account|revenue|profit|cash/.test(financeText(module)) && !Array.isArray(module.kpis)) {
        module.kpis = financeKpis;
        if (!["metric","report","dashboard"].includes(module.screen)) module.screen = "metric";
      }
    });

    if (!hasFinance && spec.modules.length < 10) {
      spec.modules.push({
        id: uniqueModuleId(spec, "finance"),
        name: "Finance",
        icon: "coin",
        entity: FINANCE_ENTITY_IDS.summary,
        screen: "metric",
        color: "#0ea5e9",
        kpis: financeKpis,
      });
    }
    if (!hasInvoice && spec.modules.length < 10) {
      spec.modules.push({
        id: uniqueModuleId(spec, "invoices"),
        name: "Invoices",
        icon: "docs",
        entity: FINANCE_ENTITY_IDS.invoices,
        screen: "split",
        color: "#14b8a6",
        kpis: null,
      });
    }
  }

  /**
   * The books a generated business system is shown with.
   *
   * In src/js/systems/ledger.js, where the figures can be generated and added
   * up: an invoice against its tax, a payment against the receivable it
   * clears, and every journal entry against itself.
   */
  function buildFinancialData(spec, desc) {
    return window.HCSystemsLedger.buildFinancialData(spec, desc, { collectBusinessNames });
  }

  function enrichFinancialCore(spec, desc) {
    if (!spec || !spec.entities) return spec;
    const pack = buildFinancialData(spec, desc);
    const names = {
      [FINANCE_ENTITY_IDS.accounts]: "Chart of Accounts",
      [FINANCE_ENTITY_IDS.invoices]: "Invoices",
      [FINANCE_ENTITY_IDS.invoiceLines]: "Invoice Lines",
      [FINANCE_ENTITY_IDS.payments]: "Payments",
      [FINANCE_ENTITY_IDS.expenses]: "Expenses",
      [FINANCE_ENTITY_IDS.journal]: "Journal Entries",
      [FINANCE_ENTITY_IDS.bank]: "Bank Transactions",
      [FINANCE_ENTITY_IDS.summary]: "Financial Summary",
    };
    Object.entries(pack.fields).forEach(([id, fields]) => mergeFinanceEntity(spec, id, names[id] || titleCase(id), fields));
    spec.mockData = spec.mockData || {};
    Object.entries(pack.data).forEach(([id, rows]) => { spec.mockData[id] = rows; });
    ensureFinancialModules(spec);
    spec.financialModel = {
      currency: pack.currency,
      basis: "generated-linked-ledger",
      generatedAt: new Date().toISOString(),
      entities: Object.values(FINANCE_ENTITY_IDS),
    };
    spec.interactions = [...new Set([...(spec.interactions || []), "financial dashboards", "linked invoices/payments/expenses", "ledger exports"])];
    return spec;
  }

  function snapshot(spec, label) {
    return {
      at: Date.now(),
      label: label || "Revision",
      // Its records as they stood, so going back to it brings them back too.
      spec: structuredCloneSafe({ ...spec, mockData: getRuntimeData(spec), revisionHistory: [] }),
    };
  }

  async function createSystem() {
    if (runAbort) {
      stopSystemGeneration();
      return;
    }
    const desc = $("sysPromptInput")?.value.trim() || "Create a professional ERP system for a growing business";
    clearTrace();
    setStatus("Running", "running");
    runAbort = new AbortController();
    runBudget = window.HCAgentPolicy.newRunBudget(Date.now());
    updateCreateButtonState();
    try {
      trace("Planning business modules", "plan");
      const spec = await generateWithModel(desc, runAbort.signal);
      if (runAbort.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      trace("Normalising modules, data, and interactions", "data");
      // Its design differs from the last system's on at least two of shell,
      // typeface, density and surface; its colours stay its industry's.
      const d = window.HCSystemsTheme.varyFrom(window.HCSystemsTheme.designOf(systems[0]), window.HCSystemsTheme.designOf(spec), pickRandom, spec.domain);
      Object.assign(spec.theme, { font: d.font, density: d.density, surface: d.surface });
      const home = spec.entities[spec.modules[0]?.entity];
      const dashboardStyle = window.HCSystemsTheme.dashboardFor(spec.layout?.dashboardStyle, systems[0]?.layout?.dashboardStyle, !!STAGES().stageField(home), pickRandom);
      spec.layout = { ...spec.layout, shell: d.shell, nav: d.shell === "top" ? "top" : "sidebar", dashboardStyle };
      trace(`Design: ${d.shell} layout · ${d.font} type · ${d.density} · ${d.surface} cards · ${dashboardStyle} dashboard`, "data");
      systems.unshift(spec);
      activeId = spec.id;
      activeModuleId = spec.modules[0]?.id || "";
      activeEntityId = spec.modules[0]?.entity || "";
      selectedRecordId = "";
      saveRuntimeData(spec, spec.mockData);
      saveSystems();
      renderAll();
      setStatus("Done", "done");
      trace("System ready", "ok");
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Stopped", "stopped");
        trace("Generation stopped before a new system was saved", "warn");
      } else if (err.name === "BudgetExceeded") {
        // Say what was spent. "Generation failed" after four silent minutes
        // tells the user nothing about whether to retry or change model.
        setStatus("Gave up", "error");
        trace(err.message, "err");
      } else {
        setStatus("Error", "error");
        trace(err.message || "System generation failed", "err");
      }
    } finally {
      runAbort = null;
      runBudget = null;
      updateCreateButtonState();
    }
  }

  /**
   * Apply a request to the system that is open: the model is shown it and
   * returns it changed. Records of entities that remain are kept, new
   * entities get records written for them, the design stays unless the
   * request is about it, and the system as it was is kept as a version.
   */
  async function reviseSystem() {
    const spec = getActive();
    const request = $("sysPromptInput")?.value.trim() || "";
    if (!spec || runAbort) return;
    if (!request) { trace("Type the change you want, then press Change", "warn"); return; }
    clearTrace();
    setStatus("Changing", "running");
    runAbort = new AbortController();
    runBudget = window.HCAgentPolicy.newRunBudget(Date.now());
    updateCreateButtonState();
    const signal = runAbort.signal;
    const R = window.HCSystemsRevise;
    try {
      const data = getRuntimeData(spec);
      const tried = [];
      let model = $("sysModelSelect")?.value || $("model")?.value || "";
      let next = null;
      for (let attempt = 1; attempt <= 3 && !next; attempt++) {
        trace(`Changing ${spec.name} — ${modelTraceLabel(model)}`, "run");
        try {
          const r = await callModel(model, [
            { role: "system", content: `${systemPrompt()}\n\nYou are CHANGING an existing system, not designing a new one. Return the complete updated SystemSpec. Keep every module, entity, field, workflow and design choice the request does not mention, with the same ids. For a new entity, include 6-10 mockData records for this business; do not repeat the existing records. Remove something only when asked.` },
            { role: "user", content: `The system now:\n${JSON.stringify(R.compactSpec(spec, data))}\n\nThe change: ${request}\nToday is ${todayIso()}.` },
          ], signal, 0.3);
          const raw = r?.content || "";
          const parsed = parseSpecJson(raw);
          if (!parsed) throw new Error("Model returned invalid SystemSpec JSON");
          const kept = R.keepDesign(spec, { ...parsed, id: spec.id, name: parsed.name || spec.name, domain: spec.domain });
          next = await writeMissingRecords(await finalizeOrRepairGeneratedSpec(model, kept, raw, `${spec.description} ${request}`, signal, tried, spec), request, signal, model);
        } catch (err) {
          if (err.name === "AbortError" || err.name === "BudgetExceeded") throw err;
          trace(`${modelTraceLabel(model)} could not make the change: ${String(err.message || err).slice(0, 90)}`, "warn");
          tried.push(model);
          const other = isFailoverError(err) && failoverModels(model).find(m => !tried.includes(m));
          if (!other) throw err;
          model = other;
        }
      }
      if (!next) throw new Error("No model could make the change");
      // The books the person already has stay theirs; the ledger would redraw them.
      for (const id of Object.values(DOMAIN().FINANCE_ENTITY_IDS)) if (data[id] && next.entities[id]) next.mockData[id] = data[id];
      next.revisionHistory = [snapshot(spec, request), ...(spec.revisionHistory || [])].slice(0, MAX_HISTORY);
      systems[systems.findIndex(s => s.id === spec.id)] = next;
      saveRuntimeData(next, next.mockData);
      saveSystems();
      renderAll();
      const changes = R.specChanges(spec, next);
      changes.forEach(c => trace(c, "ok"));
      trace(changes.length ? `Changed — the version before is in History` : "The model returned the system unchanged", changes.length ? "ok" : "warn");
      setStatus("Done", "done");
    } catch (err) {
      setStatus(err.name === "AbortError" ? "Stopped" : "Error", err.name === "AbortError" ? "stopped" : "error");
      trace(err.name === "AbortError" ? "Change stopped; the system is as it was" : `${err.message || err} — the system is as it was`, err.name === "AbortError" ? "warn" : "err");
    } finally {
      runAbort = null;
      runBudget = null;
      updateCreateButtonState();
    }
  }

  function renderAll() {
    updateCreateButtonState();
    renderSystemList();
    renderVersionList();
    renderPreview();
    renderDataEditor();
  }

  function renderSystemList() {
    const el = $("sysSystemList");
    if (!el) return;
    if (!systems.length) {
      el.innerHTML = `<div class="sys-card-meta">No systems yet. Describe one above and create it.</div>`;
      return;
    }
    el.innerHTML = systems.map(s => `
      <div class="sys-system-card ${s.id === activeId ? "active" : ""}" data-system-id="${esc(s.id)}">
        <div class="sys-card-name">${esc(s.name)}</div>
        <div class="sys-card-meta">${esc((s.modules || []).length)} modules · ${esc(nowLabel(s.updatedAt || s.createdAt))}</div>
        <div class="sys-card-actions">
          <button class="sys-card-btn" data-sys-rename="${esc(s.id)}" title="Rename">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M9.5 2.5a1.5 1.5 0 0 1 2.12 2.12L4 13H2v-2L9.5 2.5z"/></svg>
          </button>
          <button class="sys-card-btn sys-card-btn-del" data-sys-delete="${esc(s.id)}" title="Delete">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M2 4h10M5 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4M5 6v4M9 6v4M3 4l.7 7.3a.7.7 0 0 0 .7.7h5.2a.7.7 0 0 0 .7-.7L11 4"/></svg>
          </button>
        </div>
      </div>
    `).join("");
  }

  function renderVersionList() {
    const spec = getActive();
    const el = $("sysVersionList");
    if (!el) return;
    const history = spec?.revisionHistory || [];
    if (!spec || !history.length) {
      el.innerHTML = `<div class="sys-card-meta">No revisions yet.</div>`;
      return;
    }
    el.innerHTML = history.map((h, idx) => `
      <div class="sys-version-card" data-version-index="${idx}">
        <div class="sys-card-name">${esc(h.label || "Revision")}</div>
        <div class="sys-card-meta">${esc(nowLabel(h.at))}</div>
      </div>
    `).join("");
  }

  function renderPreview() {
    const spec = getActive();
    const host = $("sysAppHost");
    if (!host) return;
    $("sysPreviewName").textContent = spec?.name || "No system selected";
    $("sysPreviewDesc").textContent = spec?.description || "Create a system to start.";
    if (!spec) {
      host.innerHTML = `<div class="sys-empty"><div><h2>ERP Builder</h2><p>Describe your business system to generate a fully interactive prototype with modules, data, charts, and workflows.</p></div></div>`;
      return;
    }
    if (!activeModuleId || !spec.modules.some(m => m.id === activeModuleId)) activeModuleId = spec.modules[0]?.id || "";
    const module = spec.modules.find(m => m.id === activeModuleId) || spec.modules[0];
    const entity = spec.entities[module?.entity] || Object.values(spec.entities)[0];
    activeEntityId = entity?.id || "";
    viewCurrency = VIEW().currencyOf(spec);
    linkCache = new Map();
    const data = getRuntimeData(spec);
    const records = prepareRecords(data[activeEntityId] || [], entity);
    const selected = records.find(r => r.id === selectedRecordId) || records[0] || null;
    selectedRecordId = selected?.id || "";

    const screenHtml = (() => {
      switch (module.screen) {
        case "kanban":   return renderKanban(records, entity, spec);
        case "list":     return renderListOnly(records, entity);
        case "report":   return renderReport(records, entity, spec, module);
        case "split":    return renderSplit(records, entity, selected, spec);
        case "cards":    return renderCards(records, entity);
        case "timeline": return renderTimeline(records, entity);
        case "calendar": return renderCalendar(records, entity);
        case "metric":   return renderMetric(records, entity, module, spec);
        case "feed":     return renderFeed(records, entity);
        default:         return renderDashboard(records, entity, selected, spec, module);
      }
    })();

    const shell = spec.layout?.shell || "sidebar";
    const cls = `${spec.theme.mode === "dark" ? "dark" : ""} density-${esc(spec.theme.density || "comfortable")} surface-${esc(spec.theme.surface || "outlined")}`;
    const vars = themeVars(spec);
    const screen = module.screen || "dashboard";
    const searchInput = `<input class="sys-app-search" id="sysAppSearch" value="${esc(searchQuery)}" placeholder="Search ${esc(entity?.name || "")}…" />`;

    // A filter set from outside the table — a workflow's stage — is said on
    // screens with no filter panel, so records do not seem to have gone.
    const shown = filterRules.filter(r => r.field && r.value !== "");
    const filterNote = shown.length && !["dashboard", "list", "split"].includes(screen)
      ? `<div class="sys-filter-note">Showing only ${shown.map(r => `${esc(entity?.fields?.find(f => f.id === r.field)?.label || r.field)}: ${esc(r.value)}`).join(", ")} <button type="button" class="sys-action-btn" id="sysClearFilters">Show all</button></div>` : "";
    const screenDiv = `<div class="sys-screen sys-screen--${esc(screen)}">${filterNote}${screenHtml}</div>`;

    host.innerHTML = window.HCSystemsShells.shellHtml({ shell, spec, module, screen, screenDiv, searchInput, cls, vars, activeModuleId, esc });
  }




  // Every figure below is worked out from the records by src/js/systems/
  // figures.js. The tiles used to carry trends and sparklines nobody had
  // measured; a trend now compares two named months, or is not shown.
  const FIG = () => window.HCSystemsFigures;
  const STAGES = () => window.HCSystemsStages;
  const REL = () => window.HCSystemsRelations;
  // Each linked entity's records, indexed once per drawing of the screen.
  let linkCache = new Map();
  function linkedRecord(field, value) {
    const spec = getActive();
    const target = spec?.entities?.[field.entity];
    if (!target) return null;
    if (!linkCache.has(target.id)) linkCache.set(target.id, REL().indexOf(getRuntimeData(spec)[target.id] || [], target));
    return REL().resolve(value, linkCache.get(target.id));
  }

  /**
   * Put a record at a stage: from a board's drag or arrows, or the detail
   * panel's next-stage button. "No status" clears it.
   */
  function moveRecord(recordId, value) {
    const spec = getActive();
    const entity = spec?.entities?.[activeEntityId];
    const field = STAGES().stageField(entity) || entity?.fields?.find(f => f.type === "select");
    const data = getRuntimeData(spec);
    const rec = (data[activeEntityId] || []).find(r => r.id === recordId);
    if (!field || !rec || value == null) return;
    rec[field.id] = value === VIEW().NO_STATUS ? "" : value;
    saveRuntimeData(spec, data);
    trace(`${recordLabel(rec, entity)} moved to ${rec[field.id] || VIEW().NO_STATUS}`, "ok");
    selectedRecordId = recordId;
    renderPreview(); renderDataEditor();
  }
  const todayIso = () => window.HCSystemsSamples.localDay(new Date());

  function showFigure(value, field, short = false) {
    if (value == null) return "—";
    return VIEW().isMoneyField(field) ? VIEW().formatMoney(value, viewCurrency, { short }) : VIEW().formatNumber(value);
  }

  function renderKpis(records, entity, module = null) {
    const F = FIG();
    const fields = entity?.fields || [];
    const numField = fields.find(f => f.type === "number");
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const dateField = F.dateFieldOf(entity);

    const defs = Array.isArray(module?.kpis) && module.kpis.length
      ? module.kpis.map(d => F.kpiFrom(d, fields)).filter(Boolean)
      : [{ label: "Records", field: null, how: "count" }, ...(numField ? [{ label: `Total ${numField.label}`, field: numField, how: "sum" }] : [])];

    const kpis = defs.map((d) => {
      const value = F.aggregate(records, d.field?.id, d.how);
      return {
        label: d.label,
        ...(d.how === "count" ? { value: VIEW().formatNumber(value), exact: "" } : { value: showFigure(value, d.field, true), exact: showFigure(value, d.field) }),
        trend: F.monthTrend(records, dateField?.id, d.field?.id, d.how, todayIso()),
        series: F.monthlySeries(records, dateField?.id, d.field?.id, d.how, todayIso()),
      };
    });
    // Open and finished work, only where records say what state they are in.
    if (statusField && !module?.kpis?.length) {
      const live = records.filter(r => !F.isDropped(r[statusField.id]));
      const done = live.filter(r => F.isFinished(r[statusField.id])).length;
      kpis.push({ label: "Open", value: VIEW().formatNumber(live.length - done), trend: null, series: [] });
      kpis.push({ label: "Finished", value: live.length ? `${Math.round((done / live.length) * 100)}%` : "—", trend: null, series: [] });
    }

    return `<div class="sys-kpi-grid">${kpis.map((k, ki) => {
      const accent = ACCENT_PALETTE[ki % ACCENT_PALETTE.length];
      const top = VIEW().safeMax(k.series.map(p => p.value)) || 1;
      const bars = k.series.map((p, bi) => {
        const v = Math.max(1, Math.round((Math.max(0, p.value) / top) * 18));
        return `<rect x="${bi * 6}" y="${20 - v}" width="4" height="${v}" rx="1" fill="${accent}" opacity="${bi === k.series.length - 1 ? "1" : "0.4"}"><title>${esc(p.label)}</title></rect>`;
      }).join("");
      return `
      <div class="sys-kpi-card" style="--kpi-accent:${accent}">
        <div class="sys-kpi-icon" style="color:${accent};background:${accent}18">${KPI_ICONS[ki % KPI_ICONS.length]}</div>
        <div class="sys-kpi-body">
          <div class="sys-kpi-label">${esc(k.label)}</div>
          <div class="sys-kpi-value"${k.exact && k.exact !== k.value ? ` title="${esc(k.exact)}"` : ""}>${esc(String(k.value))}</div>
          ${bars ? `<svg class="sys-sparkline" viewBox="0 0 ${k.series.length * 6 - 2} 20" preserveAspectRatio="none" role="img" aria-label="${esc(k.label)} by month">${bars}</svg>` : ""}
        </div>
        ${k.trend ? `<div class="sys-kpi-trend ${k.trend.up ? "up" : "down"}" title="${esc(`${k.trend.current} compared with ${k.trend.previous}`)}">
          <svg viewBox="0 0 10 10" fill="currentColor" width="9" height="9"><polygon points="${k.trend.up ? "5,2 9,8 1,8" : "5,8 9,2 1,2"}"/></svg>
          ${esc(k.trend.text)} vs ${esc(k.trend.previous)}
        </div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function sortIcon(f) {
    if (sortState.field !== f.id) return `<svg viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="1.4" width="9" height="12" style="opacity:.3"><path d="M5 1v12M2 4l3-3 3 3M2 10l3 3 3-3"/></svg>`;
    return sortState.dir === "asc"
      ? `<svg viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="1.6" width="9" height="12"><path d="M5 2v10M2 5l3-3 3 3"/></svg>`
      : `<svg viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="1.6" width="9" height="12"><path d="M5 2v10M2 9l3 3 3-3"/></svg>`;
  }

  function renderFilterPanel(entity) {
    const fields = entity?.fields || [];
    const ops = [
      { v:"contains", l:"contains" }, { v:"eq", l:"= equals" }, { v:"neq", l:"≠ not" },
      { v:"starts", l:"starts with" }, { v:"gt", l:"> greater" }, { v:"lt", l:"< less" },
    ];
    return `<div class="sys-filter-panel">
      ${filterRules.map(rule => `
        <div class="sys-filter-rule">
          <select class="sys-filter-field" data-rule-id="${esc(rule.id)}" data-prop="field">
            ${fields.map(f => `<option value="${esc(f.id)}" ${rule.field === f.id ? "selected" : ""}>${esc(f.label)}</option>`).join("")}
          </select>
          <select class="sys-filter-op" data-rule-id="${esc(rule.id)}" data-prop="op">
            ${ops.map(o => `<option value="${o.v}" ${rule.op === o.v ? "selected" : ""}>${o.l}</option>`).join("")}
          </select>
          <input class="sys-filter-val" data-rule-id="${esc(rule.id)}" data-prop="value"
            value="${esc(rule.value)}" placeholder="Value…" />
          <button class="sys-filter-remove" data-rule-id="${esc(rule.id)}" title="Remove filter">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="10" height="10"><path d="M1 1l10 10M11 1L1 11"/></svg>
          </button>
        </div>`).join("")}
      <div class="sys-filter-actions">
        <button class="sys-action-btn" id="sysAddFilterRule">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M7 2v10M2 7h10"/></svg>
          Add Rule
        </button>
        ${filterRules.length ? `<button class="sys-action-btn" id="sysClearFilters">Clear All</button>` : ""}
      </div>
    </div>`;
  }

  function renderTable(records, entity) {
    const fields = (entity?.fields || []).slice(0, 6);
    const allChecked = records.length > 0 && records.every(r => selectedIds.has(r.id));
    const someChecked = selectedIds.size > 0;
    const activeFilters = filterRules.filter(r => r.field && r.value !== "");
    return `<div class="sys-widget sys-table-widget">
      <div class="sys-table-toolbar">
        <div class="sys-table-toolbar-left">
          <span class="sys-widget-title">${esc(entity?.name || "Records")}</span>
          <span class="sys-record-count">${records.length} record${records.length !== 1 ? "s" : ""}</span>
          ${someChecked ? `<span class="sys-bulk-badge">${selectedIds.size} selected</span>` : ""}
        </div>
        <div class="sys-table-toolbar-right">
          ${someChecked ? `
            <button class="sys-action-btn danger" id="sysBulkDeleteBtn">
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="12" height="12"><path d="M2 4h10M5 4V2.5h4V4M3 4l.7 7.3a.7.7 0 0 0 .7.7h5.2a.7.7 0 0 0 .7-.7L11 4"/></svg>
              Delete ${selectedIds.size}
            </button>` : ""}
          <button class="sys-action-btn ${filterPanelOpen || activeFilters.length ? "active" : ""}" id="sysFilterBtn">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" width="13" height="13"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
            Filters${activeFilters.length ? ` <span class="sys-filter-badge">${activeFilters.length}</span>` : ""}
          </button>
          <button class="sys-action-btn" id="sysImportBtn">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" width="13" height="13"><path d="M8 11V3M5 8l3 4 3-4"/><path d="M3 13h10"/></svg>
            Import
          </button>
          <div class="sys-export-wrap">
            <button type="button" class="sys-action-btn" id="sysExportBtn">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" width="13" height="13"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>
              Export
            </button>
            <div class="sys-export-menu" id="sysExportMenu" style="display:none">
              <button type="button" class="sys-export-item" id="sysExportCsvBtn">Export CSV (this entity)</button>
              <button type="button" class="sys-export-item" id="sysExportAllCsvBtn">Export all entities (CSV)</button>
              <button type="button" class="sys-export-item" id="sysExportJsonBtn">Backup full system (JSON)</button>
            </div>
          </div>
          <button class="sys-action-btn primary" id="sysAddRecordBtn2">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
            Add Record
          </button>
        </div>
      </div>
      ${filterPanelOpen ? renderFilterPanel(entity) : ""}
      <div class="sys-table-wrap"><table class="sys-table">
        <thead><tr>
          <th class="sys-th-check"><input type="checkbox" id="sysSelectAll" ${allChecked ? "checked" : ""} title="Select all"/></th>
          ${fields.map(f => `<th data-sort-field="${esc(f.id)}"><span class="sys-th-inner">${esc(f.label)}${sortIcon(f)}</span></th>`).join("")}
          <th class="sys-th-actions">Actions</th>
        </tr></thead>
        <tbody>${records.length ? records.map(r => `<tr data-record-id="${esc(r.id)}" class="${r.id === selectedRecordId ? "selected" : ""}${selectedIds.has(r.id) ? " bulk-selected" : ""}">
          <td class="sys-td-check"><input type="checkbox" class="sys-row-check" data-record-id="${esc(r.id)}" ${selectedIds.has(r.id) ? "checked" : ""}/></td>
          ${fields.map(f => `<td>${formatCell(r[f.id], f)}</td>`).join("")}
          <td class="sys-td-actions">
            <button class="sys-row-btn" data-action="edit" data-record-id="${esc(r.id)}" title="Edit">
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="12" height="12"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
            </button>
            <button class="sys-row-btn danger" data-action="delete" data-record-id="${esc(r.id)}" title="Delete">
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="12" height="12"><path d="M2 4h10M5 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4M5 6v4M9 6v4M3 4l.7 7.3a.7.7 0 0 0 .7.7h5.2a.7.7 0 0 0 .7-.7L11 4"/></svg>
            </button>
          </td>
        </tr>`).join("") : `<tr><td colspan="${fields.length + 2}" class="sys-empty-row">No records match the current filters</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }

  /**
   * One bar per record that has a figure in `field`, largest drawn full.
   * Records with no figure are left out rather than given one: a bar of 10,
   * 20, 30 for a blank used to sit among the real ones.
   */
  function figureBars(records, entity, field, limit, labelLength) {
    const barColors = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6","#8b5cf6","#f97316"];
    const rows = records.filter(r => r[field.id] !== "" && r[field.id] != null && Number.isFinite(Number(r[field.id]))).slice(0, limit);
    const top = VIEW().safeMax(rows.map(r => Math.abs(Number(r[field.id])))) || 1;
    return rows.map((r, idx) => {
      const value = Number(r[field.id]);
      const pct = Math.max(2, Math.round((Math.abs(value) / top) * 100));
      return `<div class="sys-bar-row">
        <span class="sys-bar-label">${esc(VIEW().recordLabel(r, entity).slice(0, labelLength))}</span>
        <div class="sys-bar-track"><div class="sys-bar-fill" style="width:${pct}%;background:${barColors[idx % barColors.length]}"></div></div>
        <span class="sys-bar-val">${showFigure(value, field)}</span>
      </div>`;
    }).join("");
  }

  /** "Move to Served" on a record's detail panel, where records move through stages. */
  function nextStageButton(record, entity) {
    const field = STAGES().pipelineField(entity?.id, getActive());
    const next = record && field ? STAGES().nextStage(field, record[field.id]) : null;
    return next == null ? "" : `<button type="button" class="sys-mini-btn sys-detail-next" data-action="stage-next" data-record-id="${esc(record.id)}">Move to ${esc(next)}</button>`;
  }

  /**
   * The opening dashboard, in the layout the system was given: the table
   * beside its charts, its records by stage, or one headline figure over the
   * months. Every system used to open on the first.
   */
  function renderDashboard(records, entity, selected, spec, module) {
    const style = spec.layout?.dashboardStyle || "operational";
    const F = FIG();
    const stage = STAGES().stageField(entity);
    const dateField = F.dateFieldOf(entity);
    if (style === "operational" || (style === "pipeline" && !stage)) {
      return `${renderKpis(records, entity, module)}<div class="sys-content-grid">${renderTable(records, entity)}${renderSideWidgets(records, entity, selected, spec)}</div>`;
    }
    const recent = F.latest(records, dateField?.id, todayIso(), 6);
    const recentPanel = `<div class="sys-widget"><div class="sys-widget-head"><span class="sys-widget-title">Latest</span></div>
      <div class="sys-widget-body sys-dash-list">${recent.length ? recent.map(r => `<button type="button" class="sys-dash-row" data-action="edit" data-record-id="${esc(r.id)}">
        <span>${esc(VIEW().recordLabel(r, entity))}</span>
        <span class="sys-dash-row-meta">${stage ? formatCell(r[stage.id], stage) : ""} ${dateField ? esc(String(r[dateField.id] || "")) : ""}</span></button>`).join("") : `<div class="sys-empty-hint"><span>No records yet.</span></div>`}</div></div>`;
    if (style === "pipeline") {
      const cols = VIEW().boardColumns(records, stage);
      return `${renderKpis(records, entity, module)}<div class="sys-dash-grid">
        <div class="sys-widget"><div class="sys-widget-head"><span class="sys-widget-title">By ${esc(stage.label)}</span></div>
          <div class="sys-widget-body sys-dash-stages">${cols.map(c => {
            const here = records.filter(r => VIEW().boardColumnOf(r, stage) === c);
            return `<div class="sys-dash-stage"><div class="sys-dash-stage-head"><span>${esc(c)}</span><b>${here.length}</b></div>
              ${here.slice(0, 3).map(r => `<button type="button" class="sys-dash-chip" data-action="edit" data-record-id="${esc(r.id)}">${esc(VIEW().recordLabel(r, entity))}</button>`).join("")}
              ${here.length > 3 ? `<span class="sys-dash-more">+${here.length - 3} more</span>` : ""}</div>`;
          }).join("")}</div></div>
        ${recentPanel}</div>`;
    }
    // focus: the first figure, large, month by month.
    const numField = entity?.fields?.find(f => f.type === "number");
    const def = (module?.kpis || []).map(k => F.kpiFrom(k, entity?.fields || [])).find(Boolean) || (numField ? { label: `Total ${numField.label}`, field: numField, how: "sum" } : { label: "Records", field: null, how: "count" });
    const value = F.aggregate(records, def.field?.id, def.how);
    const series = F.monthlySeries(records, dateField?.id, def.field?.id, def.how, todayIso(), 12);
    const top = VIEW().safeMax(series.map(p => p.value)) || 1;
    const trend = F.monthTrend(records, dateField?.id, def.field?.id, def.how, todayIso());
    return `<div class="sys-dash-hero sys-widget">
        <div class="sys-dash-hero-label">${esc(def.label)}</div>
        <div class="sys-dash-hero-value">${esc(def.how === "count" ? VIEW().formatNumber(value) : showFigure(value, def.field))}</div>
        ${trend ? `<div class="sys-dash-hero-trend ${trend.up ? "up" : "down"}">${esc(trend.text)} ${esc(trend.current)} vs ${esc(trend.previous)}</div>` : ""}
        ${series.length ? `<div class="sys-dash-hero-bars" role="img" aria-label="${esc(def.label)} by month">${series.map(p => `<div class="sys-dash-hero-bar"><span style="height:${Math.max(2, Math.round((Math.max(0, p.value) / top) * 100))}%" title="${esc(`${p.label}: ${def.how === "count" ? p.value : showFigure(p.value, def.field)}`)}"></span><em>${esc(p.label)}</em></div>`).join("")}</div>` : ""}
      </div>
      <div class="sys-dash-grid">${recentPanel}${renderSideWidgets(records, entity, selected, spec)}</div>`;
  }

  function renderSideWidgets(records, entity, selected, spec) {
    const numField = entity?.fields?.find(f => f.type === "number");
    const barColors = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6"];
    const bars = numField ? figureBars(records, entity, numField, 6, 16) : "";
    return `<div class="sys-side-col">
      ${bars ? `<div class="sys-widget">
        <div class="sys-widget-head">
          <div class="sys-widget-head-left">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14"><path d="M3 13V3M3 13h10"/><path d="M5.5 10V7M8 10V4M10.5 10V6"/></svg>
            <span class="sys-widget-title">${esc(numField.label)}</span>
          </div>
        </div>
        <div class="sys-widget-body"><div class="sys-bars">${bars}</div></div>
      </div>` : ""}

      <div class="sys-widget">
        <div class="sys-widget-head">
          <div class="sys-widget-head-left">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8h6M5 5h6M5 11h3"/></svg>
            <span class="sys-widget-title">Record Detail</span>
          </div>
          ${nextStageButton(selected, entity)}
          ${selected ? `<button class="sys-mini-btn" data-action="edit" data-record-id="${esc(selected.id)}">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="11" height="11"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
            Edit
          </button>` : ""}
        </div>
        <div class="sys-widget-body">
          ${selected
            ? `<div class="sys-detail-list">${(entity.fields || []).slice(0, 7).map(f => `
              <div class="sys-detail-row">
                <span class="sys-detail-label">${esc(f.label)}</span>
                <span class="sys-detail-val">${formatCell(selected[f.id], f)}</span>
              </div>`).join("")}</div>`
            : `<div class="sys-empty-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                <span>Select a row to inspect</span>
              </div>`}
        </div>
      </div>

      ${(spec.workflows || []).length ? `<div class="sys-widget">
        <div class="sys-widget-head">
          <div class="sys-widget-head-left">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14"><circle cx="3.5" cy="4" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="12.5" cy="8" r="1.5"/><path d="M5 4h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5M11 8H5"/></svg>
            <span class="sys-widget-title">Workflows</span>
          </div>
        </div>
        <div class="sys-widget-body">
          <div class="sys-activity">${(spec.workflows || []).slice(0, 4).map((w, i) => {
            // How many records stand at each stage, each a way into that list.
            // There used to be a Run button that only wrote to the log.
            const target = STAGES().workflowTarget(w, spec.entities);
            const rows = target ? getRuntimeData(spec)[target.entityId] || [] : [];
            const stages = target ? STAGES().stageCounts(rows, target.field, w.stages).map(c =>
              `<button type="button" class="sys-stage-chip" data-action="open-stage" data-entity="${esc(target.entityId)}" data-field="${esc(target.field.id)}" data-stage="${esc(c.stage)}">${esc(c.stage)} <b>${c.count}</b></button>`).join("")
              : `<span class="sys-activity-stages">${esc((w.stages || []).join(" → "))}</span>`;
            return `<div class="sys-activity-item">
              <div class="sys-activity-dot" style="background:${barColors[i % barColors.length]}"></div>
              <div class="sys-activity-content">
                <span class="sys-activity-name">${esc(w.name)}</span>
                <div class="sys-stage-chips">${stages}</div>
              </div>
            </div>`;
          }).join("")}
          </div>
        </div>
      </div>` : ""}
    </div>`;
  }

  // ── Alternate screen layouts ──────────────────────────────────────

  function renderListOnly(records, entity) {
    return `<div class="sys-list-wrap">${renderTable(records, entity)}</div>`;
  }

  function renderKanban(records, entity, spec) {
    const statusField = STAGES().stageField(entity) || entity?.fields?.find(f => f.type === "select");
    const nameField = VIEW().titleField(entity);
    const numField = entity?.fields?.find(f => f.type === "number");
    const colColors = ["#6366f1","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6"];

    // Every record is on the board: a status that is not one of the field's
    // options gets a column of its own instead of vanishing.
    const columns = VIEW().boardColumns(records, statusField);

    return `<div class="sys-kanban">
      <div class="sys-kanban-toolbar">
        <span class="sys-widget-title">${esc(entity?.name || "Board")}</span>
        <button class="sys-action-btn primary" id="sysAddRecordBtn2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
          Add Card
        </button>
      </div>
      <div class="sys-kanban-board">
        ${columns.map((col, ci) => {
          const colRecords = records.filter(r => VIEW().boardColumnOf(r, statusField) === col);
          return `<div class="sys-kanban-col" data-stage="${esc(col)}">
            <div class="sys-kanban-col-head" style="border-top-color:${colColors[ci % colColors.length]}">
              <span class="sys-kanban-col-name">${esc(col)}</span>
              <span class="sys-kanban-col-count">${colRecords.length}</span>
            </div>
            <div class="sys-kanban-cards">
              ${colRecords.map(r => `
                <div class="sys-kanban-card" data-record-id="${esc(r.id)}" draggable="true">
                  <div class="sys-kanban-card-name">${esc(VIEW().recordLabel(r, entity))}</div>
                  ${numField ? `<div class="sys-kanban-card-meta">${esc(numField.label)}: <b>${formatCell(r[numField.id], numField)}</b></div>` : ""}
                  ${entity?.fields?.filter(f => f.id !== nameField?.id && f.id !== statusField?.id && f.id !== numField?.id).slice(0, 2).map(f => `<div class="sys-kanban-card-meta">${esc(f.label)}: ${formatCell(r[f.id], f)}</div>`).join("")}
                  <div class="sys-kanban-card-actions">
                    ${STAGES().previousStage(statusField, r[statusField?.id]) != null ? `<button class="sys-row-btn" data-action="stage-prev" data-record-id="${esc(r.id)}" title="Back to ${esc(STAGES().previousStage(statusField, r[statusField.id]))}" aria-label="Back a stage">‹</button>` : ""}
                    ${STAGES().nextStage(statusField, r[statusField?.id]) != null ? `<button class="sys-row-btn" data-action="stage-next" data-record-id="${esc(r.id)}" title="On to ${esc(STAGES().nextStage(statusField, r[statusField.id]))}" aria-label="On a stage">›</button>` : ""}
                    <button class="sys-row-btn" data-action="edit" data-record-id="${esc(r.id)}" title="Edit">
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="11" height="11"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
                    </button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  }

  function renderReport(records, entity, spec, module) {
    const fields = entity?.fields || [];
    const numField = fields.find(f => f.type === "number");
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const barColors = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6","#8b5cf6","#f97316"];

    const bars = numField ? figureBars(records, entity, numField, 8, 20) : "";

    const breakdown = statusField ? (() => {
      const groups = {};
      records.forEach(r => { const k = String(r[statusField.id] || "Other"); groups[k] = (groups[k] || 0) + 1; });
      return Object.entries(groups).map(([k, v], i) => ({ label: k, count: v, pct: Math.round((v / records.length) * 100), color: barColors[i % barColors.length] }));
    })() : [];

    return `
      ${renderKpis(records, entity, module)}
      <div class="sys-report-grid">
        ${bars ? `<div class="sys-widget sys-report-chart">
          <div class="sys-widget-head">
            <div class="sys-widget-head-left">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14"><path d="M3 13V3M3 13h10"/><path d="M5.5 10V7M8 10V4M10.5 10V6"/></svg>
              <span class="sys-widget-title">${esc(numField.label)} by ${esc(VIEW().titleField(entity)?.label || "record")}</span>
            </div>
          </div>
          <div class="sys-widget-body"><div class="sys-bars sys-bars--report">${bars}</div></div>
        </div>` : ""}
        ${breakdown.length ? `<div class="sys-widget sys-report-breakdown">
          <div class="sys-widget-head">
            <div class="sys-widget-head-left">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5V8l3.5 3.5"/></svg>
              <span class="sys-widget-title">By ${esc(statusField?.label || "Status")}</span>
            </div>
          </div>
          <div class="sys-widget-body">
            ${breakdown.map(b => `<div class="sys-breakdown-row">
              <div class="sys-breakdown-dot" style="background:${b.color}"></div>
              <span class="sys-breakdown-label">${esc(b.label)}</span>
              <div class="sys-breakdown-bar-wrap"><div class="sys-breakdown-bar" style="width:${b.pct}%;background:${b.color}22;border-left:3px solid ${b.color}"></div></div>
              <span class="sys-breakdown-val">${b.count}</span>
            </div>`).join("")}
          </div>
        </div>` : ""}
      </div>
    `;
  }

  function renderSplit(records, entity, selected, spec) {
    const fields = (entity?.fields || []).slice(0, 5);
    return `<div class="sys-split-view">
      <div class="sys-split-table sys-widget">
        <div class="sys-table-toolbar">
          <div class="sys-table-toolbar-left">
            <span class="sys-widget-title">${esc(entity?.name || "Records")}</span>
            <span class="sys-record-count">${records.length} record${records.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="sys-table-toolbar-right">
            <button class="sys-action-btn primary" id="sysAddRecordBtn2">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
              Add
            </button>
          </div>
        </div>
        <div class="sys-table-wrap"><table class="sys-table">
          <thead><tr>
            ${fields.map(f => `<th data-sort-field="${esc(f.id)}"><span class="sys-th-inner">${esc(f.label)}${sortIcon(f)}</span></th>`).join("")}
          </tr></thead>
          <tbody>${records.map(r => `<tr data-record-id="${esc(r.id)}" class="${r.id === selectedRecordId ? "selected" : ""}">
            ${fields.map(f => `<td>${formatCell(r[f.id], f)}</td>`).join("")}
          </tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="sys-split-detail sys-widget">
        <div class="sys-widget-head">
          <div class="sys-widget-head-left">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8h6M5 5h6M5 11h3"/></svg>
            <span class="sys-widget-title">${selected ? esc(VIEW().recordLabel(selected, entity)) : "Record Detail"}</span>
          </div>
          ${nextStageButton(selected, entity)}
          ${selected ? `<button class="sys-mini-btn" data-action="edit" data-record-id="${esc(selected.id)}">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="11" height="11"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
            Edit
          </button>` : ""}
        </div>
        <div class="sys-widget-body">
          ${selected
            ? `<div class="sys-detail-list sys-detail-list--rich">${(entity?.fields || []).map(f => `
              <div class="sys-detail-row">
                <span class="sys-detail-label">${esc(f.label)}</span>
                <span class="sys-detail-val">${formatCell(selected[f.id], f)}</span>
              </div>`).join("")}</div>`
            : `<div class="sys-empty-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><path d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                <span>Select a row to inspect</span>
              </div>`}
        </div>
      </div>
    </div>`;
  }

  // ── Cards screen ─────────────────────────────────────────────────
  function renderCards(records, entity) {
    const fields = entity?.fields || [];
    const nameField = VIEW().titleField(entity);
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const numField = fields.find(f => f.type === "number");
    const dateField = fields.find(f => f.type === "date");
    const secondaryFields = fields.filter(f => f !== nameField && f !== statusField && f !== numField && f !== dateField).slice(0, 3);
    const palette = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6","#8b5cf6","#f97316","#06b6d4","#84cc16"];

    const initials = (val) => {
      const w = String(val || "?").trim().split(/\s+/);
      return (w[0]?.[0] || "") + (w[1]?.[0] || "");
    };

    return `<div class="sys-cards-screen">
      <div class="sys-cards-toolbar">
        <span class="sys-widget-title">${esc(entity?.name || "Records")}</span>
        <span class="sys-record-count">${records.length} record${records.length !== 1 ? "s" : ""}</span>
        <button class="sys-action-btn primary" id="sysAddRecordBtn2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
          Add
        </button>
      </div>
      <div class="sys-cards-grid">
        ${records.map((r, idx) => {
          const color = palette[idx % palette.length];
          const name = VIEW().recordLabel(r, entity);
          const status = statusField ? String(r[statusField.id] || "") : "";
          return `<div class="sys-card" data-record-id="${esc(r.id)}">
            <div class="sys-card-accent" style="background:${color}"></div>
            <div class="sys-card-body">
              <div class="sys-card-top">
                <div class="sys-card-avatar" style="background:${color}18;color:${color}">${esc(initials(name).toUpperCase())}</div>
                <div class="sys-card-header">
                  <div class="sys-card-name">${esc(name)}</div>
                  ${status ? `<span class="sys-pill" data-status="${esc(status.toLowerCase())}">${esc(status)}</span>` : ""}
                </div>
                <button class="sys-card-edit sys-row-btn" data-action="edit" data-record-id="${esc(r.id)}" title="Edit">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="11" height="11"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
                </button>
              </div>
              <div class="sys-card-fields">
                ${numField ? `<div class="sys-card-stat"><span class="sys-card-stat-val" style="color:${color}">${esc(VIEW().isMoneyField(numField) ? VIEW().formatMoney(r[numField.id], viewCurrency) : VIEW().formatNumber(r[numField.id]))}</span><span class="sys-card-stat-label">${esc(numField.label)}</span></div>` : ""}
                ${dateField ? `<div class="sys-card-field"><span class="sys-card-field-label">${esc(dateField.label)}</span><span>${esc(String(r[dateField.id] || "—"))}</span></div>` : ""}
                ${secondaryFields.map(f => `<div class="sys-card-field"><span class="sys-card-field-label">${esc(f.label)}</span><span>${formatCell(r[f.id], f)}</span></div>`).join("")}
              </div>
            </div>
          </div>`;
        }).join("")}
        ${records.length === 0 ? `<div class="sys-empty-hint" style="grid-column:1/-1"><span>No records yet. Add one to get started.</span></div>` : ""}
      </div>
    </div>`;
  }

  // ── Timeline screen ───────────────────────────────────────────────
  function renderTimeline(records, entity) {
    const fields = entity?.fields || [];
    const dateField = fields.find(f => f.type === "date");
    const nameField = VIEW().titleField(entity);
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const descField = fields.find(f => f.type === "textarea" || /note|comment|description|detail/i.test(f.id));
    const extraFields = fields.filter(f => f !== nameField && f !== dateField && f !== statusField && f !== descField).slice(0, 3);
    const statusColors = { active:"#10b981", completed:"#6366f1", done:"#6366f1", paid:"#10b981", closed:"#94a3b8", pending:"#f59e0b", preparing:"#f97316", cancelled:"#ef4444", "in progress":"#3b82f6", approved:"#10b981", rejected:"#ef4444" };
    const getStatusColor = (s) => statusColors[String(s || "").toLowerCase()] || "#6366f1";

    const sorted = [...records].sort((a, b) => String(b[dateField?.id] || "").localeCompare(String(a[dateField?.id] || "")));

    return `<div class="sys-timeline-screen">
      <div class="sys-timeline-toolbar">
        <span class="sys-widget-title">${esc(entity?.name || "Timeline")}</span>
        <span class="sys-record-count">${records.length} event${records.length !== 1 ? "s" : ""}</span>
        <button class="sys-action-btn primary" id="sysAddRecordBtn2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
          Add Event
        </button>
      </div>
      <div class="sys-timeline">
        ${sorted.map((r, idx) => {
          const status = String(r[statusField?.id] || "");
          const color = getStatusColor(status);
          const name = VIEW().recordLabel(r, entity);
          const date = String(r[dateField?.id] || "");
          const desc = descField ? String(r[descField.id] || "") : "";
          return `<div class="sys-tl-item" data-record-id="${esc(r.id)}">
            <div class="sys-tl-left">
              <span class="sys-tl-date">${esc(date)}</span>
            </div>
            <div class="sys-tl-spine">
              <div class="sys-tl-dot" style="background:${color};box-shadow:0 0 0 4px ${color}22"></div>
              ${idx < sorted.length - 1 ? `<div class="sys-tl-line"></div>` : ""}
            </div>
            <div class="sys-tl-card" style="border-left-color:${color}">
              <div class="sys-tl-card-head">
                <span class="sys-tl-name">${esc(name)}</span>
                ${status ? `<span class="sys-pill" data-status="${esc(status.toLowerCase())}">${esc(status)}</span>` : ""}
                <button class="sys-row-btn" data-action="edit" data-record-id="${esc(r.id)}" title="Edit" style="margin-left:auto">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="11" height="11"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
                </button>
              </div>
              ${desc ? `<p class="sys-tl-desc">${esc(desc)}</p>` : ""}
              <div class="sys-tl-meta">
                ${extraFields.map(f => `<span class="sys-tl-meta-item"><b>${esc(f.label)}:</b> ${formatCell(r[f.id], f)}</span>`).join("")}
              </div>
            </div>
          </div>`;
        }).join("")}
        ${sorted.length === 0 ? `<div class="sys-empty-hint"><span>No events yet.</span></div>` : ""}
      </div>
    </div>`;
  }

  // ── Calendar screen ───────────────────────────────────────────────
  function renderCalendar(records, entity) {
    const F = FIG();
    const fields = entity?.fields || [];
    const dateField = F.dateFieldOf(entity);
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const statusColors = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6","#8b5cf6","#f97316"];
    // A chip's colour says its status: the same status is the same colour.
    const statuses = statusField ? VIEW().boardColumns(records, statusField) : [];
    const colorOf = (r) => statusColors[Math.max(0, statuses.indexOf(VIEW().boardColumnOf(r, statusField))) % statusColors.length];
    const toolbar = (middle) => `<div class="sys-calendar-toolbar">
        <span class="sys-widget-title">${esc(entity?.name || "Calendar")}</span>
        ${middle}
        <button class="sys-action-btn primary" id="sysAddRecordBtn2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
          Add
        </button>
      </div>`;
    if (!dateField) {
      return `<div class="sys-calendar-screen">${toolbar("")}<div class="sys-empty-hint"><span>These records have no date to place on a calendar.</span></div></div>`;
    }

    const month = calendarMonth || F.calendarStart(records, dateField.id, todayIso());
    const [yr, mo] = month.split("-").map(Number);
    const firstDay = new Date(yr, mo - 1, 1).getDay();
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const monthName = new Date(yr, mo - 1).toLocaleString("en-US", { month:"long" });
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    const byDay = {};
    let here = 0;
    records.forEach(r => {
      const d = String(r[dateField.id] || "");
      if (F.monthOf(d) !== month) return;
      here++;
      const day = parseInt(d.slice(8,10), 10) || 1;
      (byDay[day] = byDay[day] || []).push(r);
    });
    const elsewhere = records.filter(r => F.monthOf(r[dateField.id])).length - here;

    const today = todayIso();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(`<div class="sys-cal-cell sys-cal-cell--empty"></div>`);
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today === `${month}-${String(d).padStart(2, "0")}`;
      const dayRecords = byDay[d] || [];
      cells.push(`<div class="sys-cal-cell${isToday ? " sys-cal-cell--today" : ""}">
        <span class="sys-cal-day-num${isToday ? " today" : ""}">${d}</span>
        <div class="sys-cal-chips">
          ${dayRecords.slice(0, 3).map(r => {
            const name = VIEW().recordLabel(r, entity);
            const color = colorOf(r);
            return `<button type="button" class="sys-cal-chip" style="background:${color}22;border-left:3px solid ${color}" data-action="edit" data-record-id="${esc(r.id)}" title="${esc(name)}">${esc(name.slice(0,16))}</button>`;
          }).join("")}
          ${dayRecords.length > 3 ? `<div class="sys-cal-chip-more" title="${esc(dayRecords.slice(3).map(r => VIEW().recordLabel(r, entity)).join(", "))}">+${dayRecords.length - 3} more</div>` : ""}
        </div>
      </div>`);
    }

    return `<div class="sys-calendar-screen">
      ${toolbar(`<div class="sys-cal-nav">
          <button type="button" class="sys-action-btn" data-cal-nav="-1" aria-label="Previous month">‹</button>
          <span class="sys-cal-month-label">${esc(monthName)} ${yr}</span>
          <button type="button" class="sys-action-btn" data-cal-nav="1" aria-label="Next month">›</button>
          <button type="button" class="sys-action-btn" data-cal-nav="today">Today</button>
          <span class="sys-record-count">${here} this month${elsewhere ? ` · ${elsewhere} in other months` : ""}</span>
        </div>`)}
      <div class="sys-calendar">
        <div class="sys-cal-header">
          ${dayNames.map(d => `<div class="sys-cal-day-name">${d}</div>`).join("")}
        </div>
        <div class="sys-cal-grid">
          ${cells.join("")}
        </div>
      </div>
    </div>`;
  }

  // ── Metric screen ─────────────────────────────────────────────────
  function renderMetric(records, entity, module, spec) {
    const fields = entity?.fields || [];
    const numFields = fields.filter(f => f.type === "number").slice(0, 4);
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const accent = spec?.theme?.accent || "#10b981";
    const primary = spec?.theme?.primary || "#2563eb";
    const tileColors = [primary, accent, "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];

    const F = FIG();
    const dateField = F.dateFieldOf(entity);
    const kpiDefs = (module?.kpis?.length ? module.kpis : numFields.map(f => ({ label: f.label, field: f.id, aggregate: "sum" })))
      .map(d => F.kpiFrom(d, fields)).filter(Boolean);

    // status breakdown donut-style
    const breakdown = statusField ? (() => {
      const groups = {};
      records.forEach(r => { const k = String(r[statusField.id] || "Other"); groups[k] = (groups[k]||0)+1; });
      return Object.entries(groups).sort((a,b) => b[1]-a[1]).slice(0,6);
    })() : [];

    // A line through the figure month by month — it used to follow the
    // records in whatever order the list was sorted, which is not a trend.
    const sparkSvg = (series, color) => {
      if (series.length < 2) return "";
      const mx = VIEW().safeMax(series.map(p => p.value)) || 1;
      const pts = series.map((p, i) => `${(i / (series.length - 1)) * 80},${20 - (Math.max(0, p.value) / mx) * 18}`).join(" ");
      return `<svg viewBox="0 0 80 20" width="80" height="20" class="sys-metric-spark" role="img" aria-label="${esc(`${series[0].label} to ${series[series.length - 1].label}`)}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    };

    const tiles = kpiDefs.slice(0, 6).map((def, idx) => {
      const val = F.aggregate(records, def.field?.id, def.how);
      const color = tileColors[idx % tileColors.length];
      const [formatted, exact] = def.how === "count" ? [VIEW().formatNumber(val), ""] : [showFigure(val, def.field, true), showFigure(val, def.field)];
      const trend = F.monthTrend(records, dateField?.id, def.field?.id, def.how, todayIso());
      return `<div class="sys-metric-tile" style="--tile-color:${color}">
        <div class="sys-metric-label">${esc(def.label)}</div>
        <div class="sys-metric-value" style="color:var(--tile-color)"${exact && exact !== formatted ? ` title="${esc(exact)}"` : ""}>${esc(formatted)}</div>
        ${sparkSvg(F.monthlySeries(records, dateField?.id, def.field?.id, def.how, todayIso()), color)}
        <div class="sys-metric-sub">${trend ? `${esc(trend.text)} ${esc(trend.current)} vs ${esc(trend.previous)} · ` : ""}${records.length} record${records.length !== 1 ? "s" : ""}</div>
      </div>`;
    });

    if (tiles.length < 3) {
      tiles.push(`<div class="sys-metric-tile sys-metric-tile--total" style="--tile-color:${accent}">
        <div class="sys-metric-label">Total Records</div>
        <div class="sys-metric-value" style="color:var(--tile-color)">${records.length}</div>
        <div class="sys-metric-sub">${entity?.name || "entries"}</div>
      </div>`);
    }

    return `<div class="sys-metric-screen">
      <div class="sys-metric-header">
        <span class="sys-widget-title">${esc(entity?.name || "Metrics")} Overview</span>
        <button class="sys-action-btn" id="sysAddRecordBtn2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
          Add Record
        </button>
      </div>
      <div class="sys-metric-grid">${tiles.join("")}</div>
      ${breakdown.length ? `<div class="sys-metric-breakdown">
        <div class="sys-metric-breakdown-title">Breakdown by ${esc(statusField?.label || "Status")}</div>
        <div class="sys-metric-breakdown-bars">
          ${breakdown.map(([label, count], i) => {
            const pct = Math.round((count / records.length) * 100);
            const color = tileColors[i % tileColors.length];
            return `<div class="sys-metric-brow">
              <span class="sys-metric-brow-label">${esc(label)}</span>
              <div class="sys-metric-brow-track"><div class="sys-metric-brow-fill" style="width:${pct}%;background:${color}"></div></div>
              <span class="sys-metric-brow-pct">${pct}%</span>
              <span class="sys-metric-brow-count">${count}</span>
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}
    </div>`;
  }

  // ── Feed screen ───────────────────────────────────────────────────
  function renderFeed(records, entity) {
    const fields = entity?.fields || [];
    const nameField = VIEW().titleField(entity);
    const statusField = fields.find(f => f.id === "status" || f.type === "select");
    const dateField = fields.find(f => f.type === "date");
    const bodyField = fields.find(f => f.type === "textarea" || /note|body|desc|message|detail|comment/i.test(f.id));
    const metaFields = fields.filter(f => f !== nameField && f !== statusField && f !== dateField && f !== bodyField).slice(0, 2);
    const avatarColors = ["#6366f1","#10b981","#f59e0b","#3b82f6","#ec4899","#14b8a6","#8b5cf6","#f97316","#06b6d4","#84cc16"];

    const sorted = [...records].sort((a,b) => String(b[dateField?.id] || "").localeCompare(String(a[dateField?.id] || "")));

    const initials = (val) => {
      const w = String(val || "?").trim().split(/\s+/);
      return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase() || "?";
    };

    return `<div class="sys-feed-screen">
      <div class="sys-feed-toolbar">
        <span class="sys-widget-title">${esc(entity?.name || "Feed")}</span>
        <span class="sys-record-count">${records.length} item${records.length !== 1 ? "s" : ""}</span>
        <button class="sys-action-btn primary" id="sysAddRecordBtn2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M8 3v10M3 8h10"/></svg>
          New
        </button>
      </div>
      <div class="sys-feed">
        ${sorted.map((r, idx) => {
          const name = VIEW().recordLabel(r, entity);
          const status = statusField ? String(r[statusField.id] || "") : "";
          const date = dateField ? String(r[dateField.id] || "") : "";
          const body = bodyField ? String(r[bodyField.id] || "") : "";
          const color = avatarColors[idx % avatarColors.length];
          return `<div class="sys-feed-item" data-record-id="${esc(r.id)}">
            <div class="sys-feed-avatar" style="background:${color}18;color:${color}">${esc(initials(name))}</div>
            <div class="sys-feed-content">
              <div class="sys-feed-row">
                <span class="sys-feed-name">${esc(name)}</span>
                ${status ? `<span class="sys-pill" data-status="${esc(status.toLowerCase())}">${esc(status)}</span>` : ""}
                <span class="sys-feed-date">${esc(date)}</span>
                <button class="sys-row-btn" data-action="edit" data-record-id="${esc(r.id)}" title="Edit" style="margin-left:auto">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="11" height="11"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
                </button>
              </div>
              ${body ? `<p class="sys-feed-body">${esc(body)}</p>` : ""}
              ${metaFields.length ? `<div class="sys-feed-meta">${metaFields.map(f => `<span class="sys-feed-meta-item"><b>${esc(f.label)}:</b> ${formatCell(r[f.id], f)}</span>`).join("")}</div>` : ""}
            </div>
          </div>`;
        }).join("")}
        ${sorted.length === 0 ? `<div class="sys-empty-hint"><span>Nothing in the feed yet.</span></div>` : ""}
      </div>
    </div>`;
  }

  // ── Record Modal ──────────────────────────────────────────────────

  function showRecordModal(record, entity, isNew) {
    if (!entity) return;
    recordModalIsNew = isNew;
    $("sysRecordModalTitle").textContent = isNew ? `New ${VIEW().singularName(entity)}` : `Edit ${VIEW().recordLabel(record, entity)}`;
    $("sysRecordModalForm").innerHTML = renderRecordFormModal(record || {}, entity);
    $("sysRecordModal").classList.add("open");
    setTimeout(() => $("sysRecordModalForm")?.querySelector("input,select,textarea")?.focus(), 60);
  }

  function closeRecordModal() {
    $("sysRecordModal")?.classList.remove("open");
  }

  // The form's controls: js/systems/forms.js. A link offers the target's records.
  function renderRecordFormModal(record, entity) {
    const spec = getActive();
    return window.HCSystemsForms.formHtml(record, entity, {
      linkNames: (f) => spec?.entities?.[f.entity] ? REL().choices(getRuntimeData(spec)[f.entity] || [], spec.entities[f.entity]) : [],
    });
  }


  function saveRecordFromModal() {
    const spec = getActive();
    const entity = spec?.entities?.[activeEntityId];
    if (!spec || !entity) return;
    const inputs = $("sysRecordModalForm").querySelectorAll("[data-sys-field]");
    let valid = true;
    inputs.forEach(inp => {
      const field = entity.fields.find(f => f.id === inp.dataset.sysField);
      if (field?.required && !inp.value.trim()) { inp.classList.add("input-error"); valid = false; }
      else inp.classList.remove("input-error");
    });
    if (!valid) return;
    const data = getRuntimeData(spec);
    data[activeEntityId] = data[activeEntityId] || [];
    // A blank number stays blank: it used to be saved as 0, and counted as one.
    const read = (inp) => {
      const field = entity.fields.find(f => f.id === inp.dataset.sysField);
      return field?.type === "number" ? (inp.value.trim() === "" || !Number.isFinite(Number(inp.value)) ? "" : Number(inp.value)) : inp.value;
    };
    if (recordModalIsNew) {
      let rec = { id: `${activeEntityId}_${Date.now().toString(36)}` };
      inputs.forEach(inp => { rec[inp.dataset.sysField] = read(inp); });
      rec = REL().computeRecord(rec, entity).record;
      data[activeEntityId].unshift(rec);
      selectedRecordId = rec.id;
      trace(`Added ${recordLabel(rec, entity)} to ${entity.name}`, "ok");
    } else {
      const idx = data[activeEntityId].findIndex(r => r.id === selectedRecordId);
      if (idx === -1) { closeRecordModal(); return; }
      const before = recordLabel(data[activeEntityId][idx], entity);
      const rec = { ...data[activeEntityId][idx] };
      inputs.forEach(inp => { rec[inp.dataset.sysField] = read(inp); });
      data[activeEntityId][idx] = REL().computeRecord(rec, entity).record;
      const renamed = REL().renameLinks(data, spec.entities, activeEntityId, before, recordLabel(rec, entity));
      trace(`Saved ${recordLabel(rec, entity)}${renamed ? ` · ${renamed} link${renamed === 1 ? "" : "s"} to it renamed` : ""}`, "ok");
    }
    saveRuntimeData(spec, data);
    closeRecordModal();
    renderPreview();
    renderDataEditor();
  }

  // ── CSV Import ────────────────────────────────────────────────────

  function showImportModal(entity) {
    if (!entity) return;
    importState = null;
    $("sysImportTitle").textContent = `Import CSV → ${entity.name}`;
    $("sysImportBody").innerHTML = renderImportDropZone();
    $("sysImportConfirm").disabled = true;
    $("sysImportCount").textContent = "";
    $("sysImportModal").classList.add("open");
    const fileInput = $("sysImportFile");
    if (fileInput) {
      fileInput.onchange = e => handleImportFile(e.target.files[0], entity);
    }
    const zone = $("sysDropZone");
    if (zone) {
      zone.ondragover = e => { e.preventDefault(); zone.classList.add("drag-over"); };
      zone.ondragleave = () => zone.classList.remove("drag-over");
      zone.ondrop = e => { e.preventDefault(); zone.classList.remove("drag-over"); handleImportFile(e.dataTransfer.files[0], entity); };
    }
  }

  function renderImportDropZone() {
    return `<div class="sys-drop-zone" id="sysDropZone">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44" style="opacity:.5">
        <path d="M24 32V16M14 24l10-10 10 10"/>
        <rect x="6" y="36" width="36" height="6" rx="3"/>
      </svg>
      <p class="sys-drop-title">Drop a CSV file here</p>
      <p class="sys-drop-sub">or <label class="sys-file-link" for="sysImportFile">browse files</label></p>
      <p class="sys-drop-hint">First row must be column headers · UTF-8 · comma-separated</p>
      <input type="file" id="sysImportFile" accept=".csv,.txt" />
    </div>`;
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { headers: [], rows: [] };
    const parseRow = line => {
      const out = []; let cur = ""; let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === ',' && !q) { out.push(cur.trim()); cur = ""; }
        else cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    return { headers: parseRow(lines[0]), rows: lines.slice(1).filter(l => l.trim()).map(parseRow) };
  }

  function handleImportFile(file, entity) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const { headers, rows } = parseCSV(e.target.result);
      if (!headers.length) { $("sysImportBody").innerHTML = `<p class="sys-import-error">Could not parse file — check it's a valid CSV with headers.</p>`; return; }
      const fields = entity?.fields || [];
      const autoMap = {};
      headers.forEach((h, i) => {
        const match = fields.find(f =>
          f.id === slug(h) || f.label.toLowerCase() === h.toLowerCase() ||
          f.id === h.toLowerCase().replace(/\s+/g,"_")
        );
        if (match) autoMap[i] = match.id;
      });
      importState = { headers, rows, mappings: autoMap };
      $("sysImportBody").innerHTML = renderImportMapping(entity);
      $("sysImportConfirm").disabled = false;
      $("sysImportCount").textContent = `${rows.length} row${rows.length !== 1 ? "s" : ""} ready`;
      $("sysImportBody").querySelectorAll("select[data-col-idx]").forEach(sel => {
        sel.onchange = () => { importState.mappings[Number(sel.dataset.colIdx)] = sel.value || undefined; };
      });
    };
    reader.readAsText(file);
  }

  function renderImportMapping(entity) {
    const { headers, rows } = importState;
    const fields = entity?.fields || [];
    return `<div class="sys-import-mapping">
      <div class="sys-import-info">
        <span class="sys-badge">${rows.length} rows</span>
        <span class="sys-badge">${headers.length} columns</span>
        <span class="sys-badge sys-badge--green">Auto-matched ${Object.keys(importState.mappings).length} fields</span>
      </div>
      <div class="sys-import-table-wrap">
        <table class="sys-import-table">
          <thead><tr><th>CSV Column</th><th>Maps To Field</th><th>Preview (first 3 rows)</th></tr></thead>
          <tbody>
            ${headers.map((h, i) => `<tr>
              <td class="sys-import-col-name">${esc(h)}</td>
              <td>
                <select class="sys-form-input sys-form-input--sm" data-col-idx="${i}">
                  <option value="">— Skip —</option>
                  ${fields.map(f => `<option value="${esc(f.id)}" ${importState.mappings[i] === f.id ? "selected" : ""}>${esc(f.label)}</option>`).join("")}
                </select>
              </td>
              <td class="sys-import-preview">${rows.slice(0,3).map(r => `<span>${esc(r[i] || "")}</span>`).join("")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function confirmImport() {
    const spec = getActive();
    const entity = spec?.entities?.[activeEntityId];
    if (!spec || !entity || !importState) return;
    const { rows } = importState;
    const data = getRuntimeData(spec);
    data[activeEntityId] = data[activeEntityId] || [];
    const imported = rows.map(row => {
      const rec = { id: `${activeEntityId}_imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}` };
      Object.entries(importState.mappings).forEach(([colIdx, fieldId]) => {
        if (!fieldId) return;
        const field = entity.fields.find(f => f.id === fieldId);
        const val = row[Number(colIdx)] || "";
        rec[fieldId] = field?.type === "number" ? (String(val).trim() === "" || !Number.isFinite(Number(val)) ? "" : Number(val)) : val;
      });
      return REL().computeRecord(rec, entity).record;
    });
    data[activeEntityId] = [...imported, ...data[activeEntityId]];
    saveRuntimeData(spec, data);
    closeImportModal();
    renderPreview();
    renderDataEditor();
    trace(`Imported ${imported.length} records into ${entity.name}`, "ok");
  }

  function closeImportModal() {
    $("sysImportModal")?.classList.remove("open");
    importState = null;
  }

  // ── Export ────────────────────────────────────────────────────────

  /**
   * Write one export, and answer whether it landed.
   *
   * Every export here used to be an <a download>, which this webview cancels
   * outright (see platform/tauri/save.js), so the trace logged "Exported" over
   * a file that was never written. A cancel is quiet; a failure is said out loud.
   */
  async function saveExport(filename, content, mime) {
    try {
      const result = await window.HC.save.file(filename, content, mime ? { mime } : undefined);
      if (!result.saved) { trace("Export cancelled", "warn"); return false; }
      return true;
    } catch (err) {
      trace(`Export failed: ${err?.message || err}`, "err");
      return false;
    }
  }

  async function exportCSV(spec, entityId) {
    const entity = spec?.entities?.[entityId];
    const data = getRuntimeData(spec);
    const rows = data[entityId] || [];
    const fields = entity?.fields || [];
    // Shared builder: formula-injection guard, BOM for Excel, CRLF, escaped
    // header. Records here are user data typed into a generated prototype.
    const csv = window.HCExport.csvDocument(
      fields.map(f => f.label),
      rows.map(r => fields.map(f => r[f.id]))
    );
    if (!await saveExport(`${slug(entity?.name || "export")}.csv`, csv)) return;
    trace(`Exported ${entity?.name} as CSV`, "ok");
  }

  async function exportAllEntitiesCSV(spec) {
    const data = getRuntimeData(spec);
    const entities = Object.values(spec.entities || {});
    if (!entities.length) { trace("There are no tables to export", "warn"); return; }
    // One folder for the whole set, so exporting eight tables asks once
    // rather than eight times.
    const folder = await window.HC.save.folder("Choose where to put the CSV files");
    if (!folder && window.HC.isTauri) { trace("Export cancelled", "warn"); return; }
    let written = 0;
    for (const entity of entities) {
      const rows = data[entity.id] || [];
      const fields = entity.fields || [];
      const csv = window.HCExport.csvDocument(
        fields.map(f => f.label),
        rows.map(r => fields.map(f => r[f.id]))
      );
      const name = `${slug(spec.name)}_${slug(entity.name)}.csv`;
      try {
        const result = await window.HC.save.fileInto(folder, name, csv, { mime: "text/csv;charset=utf-8" });
        if (result.saved) written++;
      } catch (err) {
        trace(`Could not save ${name}: ${err?.message || err}`, "err");
      }
    }
    trace(`Exported ${written} of ${entities.length} table(s) as CSV`, written ? "ok" : "warn");
  }

  async function exportJSON(spec) {
    const data = getRuntimeData(spec);
    const backup = {
      name: spec.name, description: spec.description,
      exportedAt: new Date().toISOString(),
      theme: spec.theme, layout: spec.layout,
      entities: Object.fromEntries(Object.entries(spec.entities || {}).map(([id, e]) => [
        id, { name: e.name, fields: e.fields, records: data[id] || [] }
      ])),
      workflows: spec.workflows || [],
    };
    if (!await saveExport(`${slug(spec.name || "erp-backup")}.json`, JSON.stringify(backup, null, 2))) return;
    trace(`Exported full system backup as JSON`, "ok");
  }

  // ─────────────────────────────────────────────────────────────────

  function formatValue(v) {
    if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v))) {
      const n = Number(v);
      return n >= 1000 ? n.toLocaleString() : String(n);
    }
    return String(v ?? "");
  }

  function formatCell(v, field) {
    if (field?.type === "link") {
      // A link that names a record can be followed; one that names nothing is shown as written.
      const rec = v === "" || v == null ? null : linkedRecord(field, v);
      return rec
        ? `<button type="button" class="sys-link" data-action="open-link" data-entity="${esc(field.entity)}" data-record-id="${esc(rec.id)}">${esc(String(v))}</button>`
        : `<span class="sys-link-missing" title="${v ? "No such record" : ""}">${esc(String(v ?? ""))}</span>`;
    }
    const value = formatValue(v);
    if (field?.type === "select" || /status|stage|priority/i.test(field?.id || "")) {
      const statusKey = String(value).toLowerCase();
      return `<span class="sys-pill" data-status="${esc(statusKey)}">${esc(value)}</span>`;
    }
    if (field?.type === "number" && v !== "" && v != null && Number.isFinite(Number(v))) {
      const shown = VIEW().isMoneyField(field) ? VIEW().formatMoney(v, viewCurrency) : VIEW().formatNumber(v);
      return `<span class="sys-num">${esc(shown)}</span>`;
    }
    return esc(value);
  }

  function renderDataEditor() {
    const spec = getActive();
    const el = $("sysDataEditor");
    if (!el) return;
    if (!spec) {
      el.innerHTML = `<div class="sys-card-meta">Create a system to edit its mock data.</div>`;
      return;
    }
    const data = getRuntimeData(spec);
    const entityIds = Object.keys(spec.entities || {});
    if (!activeEntityId || !spec.entities[activeEntityId]) activeEntityId = entityIds[0] || "";
    const entity = spec.entities[activeEntityId];
    const rows = data[activeEntityId] || [];
    if (!selectedRecordId || !rows.some(r => r.id === selectedRecordId)) selectedRecordId = rows[0]?.id || "";
    const record = rows.find(r => r.id === selectedRecordId) || null;

    el.innerHTML = `
      <label>Entity</label>
      <select id="sysEntitySelect">${entityIds.map(id => `<option value="${esc(id)}" ${id === activeEntityId ? "selected" : ""}>${esc(spec.entities[id].name)}</option>`).join("")}</select>
      <label>Record</label>
      <select id="sysRecordSelect">${rows.map(r => `<option value="${esc(r.id)}" ${r.id === selectedRecordId ? "selected" : ""}>${esc(recordLabel(r, entity))}</option>`).join("")}</select>
      <div class="sys-record-actions">
        <button class="sys-small-btn" id="sysAddRecordBtn">New Record</button>
        <button class="sys-small-btn danger" id="sysDeleteRecordBtn">Delete</button>
      </div>
      <div id="sysRecordForm">${record ? renderRecordForm(record, entity) : `<div class="sys-card-meta" style="margin-top:12px">No records yet.</div>`}</div>
      <div class="sys-form-actions">
        <button class="sys-small-btn" id="sysSaveRecordBtn">Save Changes</button>
      </div>
    `;
  }

  const recordLabel = (record, entity) => VIEW().recordLabel(record, entity);

  function renderRecordForm(record, entity) {
    return (entity.fields || []).map(f => {
      const value = record[f.id] ?? "";
      if (f.type === "select") {
        const opts = f.options || ["New","In Progress","Approved","Closed"];
        return `<label>${esc(f.label)}</label><select data-sys-field="${esc(f.id)}">${opts.map(o => `<option value="${esc(o)}" ${String(value) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      }
      if (f.type === "textarea") return `<label>${esc(f.label)}</label><textarea data-sys-field="${esc(f.id)}">${esc(value)}</textarea>`;
      return `<label>${esc(f.label)}</label><input data-sys-field="${esc(f.id)}" type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}" value="${esc(value)}" />`;
    }).join("");
  }

  function selectSystem(id) {
    activeId = id;
    const spec = getActive();
    activeModuleId = spec?.modules?.[0]?.id || "";
    activeEntityId = spec?.modules?.[0]?.entity || "";
    selectedRecordId = "";
    searchQuery = "";
    sortState = { field:"", dir:"asc" };
    filterRules = []; filterPanelOpen = false; selectedIds.clear();
    renderAll();
  }

  function restoreVersion(idx) {
    const spec = getActive();
    const snap = spec?.revisionHistory?.[idx];
    if (!spec || !snap?.spec) return;
    const current = snapshot(spec, "Before restore");
    const restored = normalizeSpec({ ...structuredCloneSafe(snap.spec), id: spec.id, revisionHistory: [current, ...(spec.revisionHistory || [])].slice(0, MAX_HISTORY) }, "restore", spec);
    systems[systems.findIndex(s => s.id === spec.id)] = restored;
    // Saved, so an entity only the restored version has shows its records.
    saveRuntimeData(restored, restored.mockData);
    saveSystems();
    renderAll();
    trace(`Restored "${snap.label}"`, "ok");
  }

  function addRecord() {
    const spec = getActive();
    const entity = spec?.entities?.[activeEntityId];
    if (!spec || !entity) return;
    const data = getRuntimeData(spec);
    data[activeEntityId] = data[activeEntityId] || [];
    const rec = normalizeRecord({ id:`${activeEntityId}_${Date.now().toString(36)}` }, entity, data[activeEntityId].length);
    data[activeEntityId].unshift(rec);
    selectedRecordId = rec.id;
    saveRuntimeData(spec, data);
    renderPreview();
    renderDataEditor();
  }

  function deleteRecord() {
    const spec = getActive();
    if (!spec || !activeEntityId || !selectedRecordId) return;
    const data = getRuntimeData(spec);
    data[activeEntityId] = (data[activeEntityId] || []).filter(r => r.id !== selectedRecordId);
    selectedRecordId = data[activeEntityId][0]?.id || "";
    saveRuntimeData(spec, data);
    renderPreview();
    renderDataEditor();
  }

  function saveRecord() {
    const spec = getActive();
    const entity = spec?.entities?.[activeEntityId];
    if (!spec || !entity || !selectedRecordId) return;
    const data = getRuntimeData(spec);
    const rows = data[activeEntityId] || [];
    const rec = rows.find(r => r.id === selectedRecordId);
    if (!rec) return;
    document.querySelectorAll("[data-sys-field]").forEach(input => {
      const field = entity.fields.find(f => f.id === input.dataset.sysField);
      rec[input.dataset.sysField] = field?.type === "number" ? Number(input.value || 0) : input.value;
    });
    saveRuntimeData(spec, data);
    renderPreview();
    renderDataEditor();
    trace("Mock data saved locally", "ok");
  }

  function syncModelSelect() {
    const src = $("model");
    const dst = $("sysModelSelect");
    if (src && dst) {
      dst.innerHTML = src.innerHTML;
      dst.value = src.value;
    }
  }

  function wireEvents() {
    // ── Header / nav ────────────────────────────────────────────────
    $("sysCreateBtn")?.addEventListener("click", createSystem);
    $("sysChangeBtn")?.addEventListener("click", reviseSystem);
    $("sysNewBtn")?.addEventListener("click", () => {
      activeId = null;
      activeModuleId = "";
      activeEntityId = "";
      selectedRecordId = "";
      searchQuery = "";
      sortState = { field:"", dir:"asc" };
      filterRules = [];
      filterPanelOpen = false;
      selectedIds.clear();
      const prompt = $("sysPromptInput");
      if (prompt) prompt.value = "";
      clearTrace();
      setStatus("Idle");
      renderAll();
    });
    $("sysBackBtn")?.addEventListener("click", () => window._H?.setTab?.("chats"));
    $("sysToggleInspectorBtn")?.addEventListener("click", () => setInspectorCollapsed(!inspectorCollapsed));
    $("sysToggleLibraryBtn")?.addEventListener("click", () => setLibraryCollapsed(!libraryCollapsed));
    $("sysCloseLibraryBtn")?.addEventListener("click", () => setLibraryCollapsed(true));
    $("sysCloseInspectorBtn")?.addEventListener("click", () => setInspectorCollapsed(true));
    $("sysInspectorCloseBtn")?.addEventListener("click", () => setInspectorCollapsed(true));
    $("sysTraceToggle")?.addEventListener("click", () => {
      const tc = $("sysTraceConsole");
      if (!tc) return;
      const isCollapsed = tc.classList.contains("collapsed");
      tc.classList.toggle("collapsed", !isCollapsed);
      tc.classList.toggle("expanded", isCollapsed);
    });
    $("sysTraceClearBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTrace();
      const tc = $("sysTraceConsole");
      if (tc) { tc.classList.add("collapsed"); tc.classList.remove("expanded"); }
    });
    $("sysResetDataBtn")?.addEventListener("click", () => {
      const spec = getActive();
      resetRuntimeData(spec);
      selectedIds.clear(); filterRules = []; filterPanelOpen = false;
      selectedRecordId = "";
      renderPreview(); renderDataEditor();
      trace("Mock data reset to original", "warn");
    });
    $("sysPromptInput")?.addEventListener("keydown", e => { if (e.key === "Enter") createSystem(); });
    $("sysPreviewImportBtn")?.addEventListener("click", () => {
      const spec = getActive();
      const entity = spec?.entities?.[activeEntityId];
      showImportModal(entity);
    });
    const setPreviewExportMenuOpen = (open) => {
      const menu = $("sysPreviewExportMenu");
      const btn = $("sysPreviewExportMenuBtn");
      if (!menu) return;
      menu.hidden = !open;
      menu.classList.toggle("is-open", open);
      menu.setAttribute("aria-hidden", String(!open));
      if (btn) btn.setAttribute("aria-expanded", String(open));
    };
    $("sysPreviewExportMenuBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("sysPreviewExportMenu");
      if (menu) setPreviewExportMenuOpen(menu.hidden);
    });
    $("sysPreviewExportMenu")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-preview-export]");
      if (!btn) return;
      const spec = getActive();
      if (spec && btn.dataset.previewExport === "json") exportJSON(spec);
      if (spec && btn.dataset.previewExport === "csv") exportCSV(spec, activeEntityId);
      setPreviewExportMenuOpen(false);
    });
    document.addEventListener("click", (e) => {
      const menu = $("sysPreviewExportMenu");
      if (!menu || menu.hidden) return;
      if (e.target.closest("#sysPreviewExportMenuBtn") || e.target.closest("#sysPreviewExportMenu")) return;
      setPreviewExportMenuOpen(false);
    });

    // ── ERP list ────────────────────────────────────────────────────
    $("sysSystemList")?.addEventListener("click", async e => {
      const renameBtn = e.target.closest("[data-sys-rename]");
      if (renameBtn) {
        e.stopPropagation();
        const sys = systems.find(s => s.id === renameBtn.dataset.sysRename);
        if (!sys) return;
        const newName = await _sysPrompt("Rename system:", sys.name);
        if (newName?.trim()) { sys.name = threeWords(newName.trim()); sys.updatedAt = Date.now(); saveSystems(); renderSystemList(); if (sys.id === activeId) $("sysPreviewName").textContent = sys.name; }
        return;
      }
      const deleteBtn = e.target.closest("[data-sys-delete]");
      if (deleteBtn) {
        e.stopPropagation();
        const sys = systems.find(s => s.id === deleteBtn.dataset.sysDelete);
        if (!sys) return;
        systems = systems.filter(s => s.id !== sys.id);
        if (activeId === sys.id) {
          activeId = systems[0]?.id || null;
          activeModuleId = "";
          activeEntityId = "";
          selectedRecordId = "";
        }
        saveSystems(); renderAll();
        trace(`Deleted "${sys.name}"`, "ok");
        return;
      }
      const card = e.target.closest("[data-system-id]");
      if (card) selectSystem(card.dataset.systemId);
    });
    $("sysVersionList")?.addEventListener("click", e => {
      const card = e.target.closest("[data-version-index]");
      if (card) restoreVersion(Number(card.dataset.versionIndex));
    });

    // ── Dragging a card to another stage ───────────────────────────
    const appHost = $("sysAppHost");
    const colOf = (e) => e.target.closest?.(".sys-kanban-col");
    appHost?.addEventListener("dragstart", e => {
      const card = e.target.closest?.(".sys-kanban-card");
      if (!card) return;
      e.dataTransfer.setData("text/plain", card.dataset.recordId);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    appHost?.addEventListener("dragend", e => e.target.closest?.(".sys-kanban-card")?.classList.remove("dragging"));
    appHost?.addEventListener("dragover", e => { const col = colOf(e); if (!col) return; e.preventDefault(); col.classList.add("drop-target"); });
    appHost?.addEventListener("dragleave", e => { const col = colOf(e); if (col && !col.contains(e.relatedTarget)) col.classList.remove("drop-target"); });
    appHost?.addEventListener("drop", e => {
      const col = colOf(e);
      if (!col || !e.dataTransfer.getData("text/plain")) return;
      e.preventDefault();
      moveRecord(e.dataTransfer.getData("text/plain"), col.dataset.stage);
    });

    // ── App host (delegated) ────────────────────────────────────────
    $("sysAppHost")?.addEventListener("click", e => {
      const spec = getActive();

      // Record modal actions (edit / delete)
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const rid = actionBtn.dataset.recordId;
        if (action === "edit") {
          selectedRecordId = rid;
          const entity = spec?.entities?.[activeEntityId];
          const data = getRuntimeData(spec);
          const record = (data[activeEntityId] || []).find(r => r.id === rid);
          showRecordModal(record, entity, false);
        } else if (action === "delete") {
          selectedRecordId = rid;
          deleteRecord();
        } else if (action === "stage-next" || action === "stage-prev") {
          const entity = spec?.entities?.[activeEntityId];
          const field = STAGES().stageField(entity) || entity?.fields?.find(f => f.type === "select");
          const rec = (getRuntimeData(spec)[activeEntityId] || []).find(r => r.id === rid);
          moveRecord(rid, action === "stage-next" ? STAGES().nextStage(field, rec?.[field?.id]) : STAGES().previousStage(field, rec?.[field?.id]));
        } else if (action === "open-link") {
          // Follow a link to its record, on the screen that lists that entity.
          const order = ["split", "list", "cards", "kanban", "timeline", "feed", "calendar", "dashboard", "report", "metric"];
          const target = (spec?.modules || []).filter(m => m.entity === actionBtn.dataset.entity)
            .sort((x, y) => order.indexOf(x.screen) - order.indexOf(y.screen))[0];
          if (target) {
            activeModuleId = target.id; selectedRecordId = rid; searchQuery = ""; filterRules = []; selectedIds.clear(); calendarMonth = "";
            renderPreview(); renderDataEditor();
          }
        } else if (action === "open-stage") {
          // A workflow's stage opens the list of records standing at it.
          const order = ["list", "split", "kanban", "cards", "timeline", "feed", "calendar", "dashboard", "report", "metric"];
          const target = (spec?.modules || []).filter(m => m.entity === actionBtn.dataset.entity)
            .sort((x, y) => order.indexOf(x.screen) - order.indexOf(y.screen))[0];
          if (target) {
            activeModuleId = target.id; selectedRecordId = ""; searchQuery = ""; selectedIds.clear(); calendarMonth = "";
            filterRules = [{ id: uid("f"), field: actionBtn.dataset.field, op: "eq", value: actionBtn.dataset.stage }];
            filterPanelOpen = true;
            renderPreview(); renderDataEditor();
          }
        }
        return;
      }

      // Calendar months
      const calNav = e.target.closest("[data-cal-nav]");
      if (calNav) {
        const entity = spec?.entities?.[activeEntityId];
        const dateField = FIG().dateFieldOf(entity);
        const current = calendarMonth || FIG().calendarStart(getRuntimeData(spec)[activeEntityId] || [], dateField?.id, todayIso());
        calendarMonth = calNav.dataset.calNav === "today" ? todayIso().slice(0, 7) : FIG().shiftMonth(current, Number(calNav.dataset.calNav));
        renderPreview();
        return;
      }

      // Add Record
      if (e.target.closest("#sysAddRecordBtn2")) {
        const entity = spec?.entities?.[activeEntityId];
        showRecordModal(null, entity, true);
        return;
      }

      // Import
      if (e.target.closest("#sysImportBtn")) {
        const entity = spec?.entities?.[activeEntityId];
        showImportModal(entity);
        return;
      }

      // Export dropdown toggle
      if (e.target.closest("#sysExportBtn")) {
        const menu = e.target.closest(".sys-export-wrap")?.querySelector(".sys-export-menu");
        if (menu) menu.style.display = menu.style.display === "none" ? "block" : "none";
        return;
      }
      // Export menu items
      if (e.target.closest("#sysExportCsvBtn")) {
        if (spec) exportCSV(spec, activeEntityId);
        const menu = e.target.closest(".sys-export-menu");
        if (menu) menu.style.display = "none";
        return;
      }
      if (e.target.closest("#sysExportAllCsvBtn")) {
        if (spec) exportAllEntitiesCSV(spec);
        const menu = e.target.closest(".sys-export-menu");
        if (menu) menu.style.display = "none";
        return;
      }
      if (e.target.closest("#sysExportJsonBtn")) {
        if (spec) exportJSON(spec);
        const menu = e.target.closest(".sys-export-menu");
        if (menu) menu.style.display = "none";
        return;
      }
      // Close export menu on outside click
      if (!e.target.closest(".sys-export-wrap")) {
        $("sysAppHost")?.querySelectorAll(".sys-export-menu").forEach(menu => { menu.style.display = "none"; });
      }

      // Bulk delete
      if (e.target.closest("#sysBulkDeleteBtn")) {
        if (!spec || selectedIds.size === 0) return;
        const data = getRuntimeData(spec);
        const count = selectedIds.size;
        data[activeEntityId] = (data[activeEntityId] || []).filter(r => !selectedIds.has(r.id));
        selectedIds.clear();
        selectedRecordId = data[activeEntityId][0]?.id || "";
        saveRuntimeData(spec, data);
        renderPreview(); renderDataEditor();
        trace(`Deleted ${count} record${count === 1 ? "" : "s"}`, "warn");
        return;
      }

      // Filter panel toggle
      if (e.target.closest("#sysFilterBtn")) {
        filterPanelOpen = !filterPanelOpen;
        if (!filterPanelOpen) { /* keep rules, just hide panel */ }
        renderPreview();
        return;
      }
      // Add filter rule
      if (e.target.closest("#sysAddFilterRule")) {
        const entity = spec?.entities?.[activeEntityId];
        const firstField = entity?.fields?.[0]?.id || "";
        filterRules.push({ id: uid("f"), field: firstField, op: "contains", value: "" });
        renderPreview();
        return;
      }
      // Clear all filters
      if (e.target.closest("#sysClearFilters")) {
        filterRules = [];
        renderPreview();
        return;
      }
      // Remove individual filter rule
      const removeBtn = e.target.closest(".sys-filter-remove");
      if (removeBtn) {
        filterRules = filterRules.filter(r => r.id !== removeBtn.dataset.ruleId);
        renderPreview();
        return;
      }

      // Kanban card row selection
      const kCard = e.target.closest(".sys-kanban-card");
      if (kCard && !e.target.closest("[data-action]")) {
        selectedRecordId = kCard.dataset.recordId;
        renderDataEditor();
        return;
      }

      // Select-all checkbox
      if (e.target.id === "sysSelectAll") {
        const entity = spec?.entities?.[activeEntityId];
        const data = getRuntimeData(spec);
        const records = prepareRecords(data[activeEntityId] || [], entity);
        if (e.target.checked) records.forEach(r => selectedIds.add(r.id));
        else selectedIds.clear();
        renderPreview();
        return;
      }
      // Individual row checkbox
      const rowCheck = e.target.closest(".sys-row-check");
      if (rowCheck) {
        const rid = rowCheck.dataset.recordId;
        if (rowCheck.checked) selectedIds.add(rid); else selectedIds.delete(rid);
        renderPreview();
        return;
      }

      // Module nav
      const mod = e.target.closest("[data-module-id]");
      if (mod) {
        activeModuleId = mod.dataset.moduleId;
        selectedRecordId = ""; searchQuery = ""; sortState = { field:"", dir:"asc" }; calendarMonth = "";
        filterRules = []; filterPanelOpen = false; selectedIds.clear();
        renderPreview(); renderDataEditor();
        return;
      }

      // Row selection: a detail panel follows the row, the list keeps its scroll.
      // `host` is named: bare, it was the settings' <input id="host">.
      const row = e.target.closest("tr[data-record-id]");
      if (row && !e.target.closest(".sys-td-actions") && !e.target.closest(".sys-td-check")) {
        const host = $("sysAppHost");
        selectedRecordId = row.dataset.recordId;
        const wrap = host.querySelector(".sys-table-wrap");
        const [top, left] = [wrap?.scrollTop || 0, wrap?.scrollLeft || 0];
        if (host.querySelector(".sys-detail-list")) {
          renderPreview();
          const again = host.querySelector(".sys-table-wrap");
          if (again) { again.scrollTop = top; again.scrollLeft = left; }
        } else host.querySelectorAll("tr[data-record-id]").forEach(r => r.classList.toggle("selected", r.dataset.recordId === selectedRecordId));
        renderDataEditor();
        return;
      }

      // Column sort
      const th = e.target.closest("[data-sort-field]");
      if (th) {
        const field = th.dataset.sortField;
        sortState = sortState.field === field ? { field, dir: sortState.dir === "asc" ? "desc" : "asc" } : { field, dir:"asc" };
        renderPreview();
      }
    });

    // Filter panel — change events (field / op / value inputs)
    $("sysAppHost")?.addEventListener("change", e => {
      const ruleId = e.target.dataset.ruleId;
      const prop = e.target.dataset.prop;
      if (ruleId && prop) {
        const rule = filterRules.find(r => r.id === ruleId);
        if (rule) { rule[prop] = e.target.value; renderPreview(); }
      }
    });
    $("sysAppHost")?.addEventListener("input", e => {
      if (e.target.id === "sysAppSearch") {
        searchQuery = e.target.value;
        const caretPos = e.target.selectionStart;
        renderPreview();
        const restored = $("sysAppSearch");
        if (restored) { restored.focus(); restored.setSelectionRange(caretPos, caretPos); }
        return;
      }
      const ruleId = e.target.dataset.ruleId;
      const prop = e.target.dataset.prop;
      if (ruleId && prop === "value") {
        const rule = filterRules.find(r => r.id === ruleId);
        if (rule) { rule.value = e.target.value; renderPreview(); }
      }
    });

    // ── Data Editor panel ────────────────────────────────────────────
    $("sysDataEditor")?.addEventListener("change", e => {
      if (e.target.id === "sysEntitySelect") {
        activeEntityId = e.target.value;
        const spec = getActive();
        const mod = spec?.modules.find(m => m.entity === activeEntityId);
        if (mod) activeModuleId = mod.id;
        selectedRecordId = "";
        renderPreview(); renderDataEditor();
      } else if (e.target.id === "sysRecordSelect") {
        selectedRecordId = e.target.value;
        renderPreview(); renderDataEditor();
      }
    });
    $("sysDataEditor")?.addEventListener("click", e => {
      if (e.target.id === "sysAddRecordBtn") {
        const spec = getActive();
        const entity = spec?.entities?.[activeEntityId];
        showRecordModal(null, entity, true);
      }
      if (e.target.id === "sysDeleteRecordBtn") deleteRecord();
      if (e.target.id === "sysSaveRecordBtn") saveRecord();
    });

    // ── Record modal ─────────────────────────────────────────────────
    $("sysRecordModalClose")?.addEventListener("click", closeRecordModal);
    $("sysRecordModalCancel")?.addEventListener("click", closeRecordModal);
    $("sysRecordModalSave")?.addEventListener("click", saveRecordFromModal);
    $("sysRecordModal")?.addEventListener("click", e => { if (e.target === $("sysRecordModal")) closeRecordModal(); });
    $("sysRecordModal")?.addEventListener("keydown", e => { if (e.key === "Escape") closeRecordModal(); if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); saveRecordFromModal(); } });

    // ── Import modal ─────────────────────────────────────────────────
    $("sysImportClose")?.addEventListener("click", closeImportModal);
    $("sysImportCancel")?.addEventListener("click", closeImportModal);
    $("sysImportConfirm")?.addEventListener("click", confirmImport);
    $("sysImportModal")?.addEventListener("click", e => { if (e.target === $("sysImportModal")) closeImportModal(); });
    $("sysImportModal")?.addEventListener("keydown", e => { if (e.key === "Escape") closeImportModal(); });
  }

  function mount() {
    syncModelSelect();
    if (!mounted) {
      mounted = true;
      loadUiState();
      loadSystems();
      wireEvents();
    }
    applyPanelState();
    updateCreateButtonState();
    renderAll();
  }

  return { mount };
})();

window.SystemMaker = SystemMaker;

(window._registeredModes = window._registeredModes || {})["systems"] = {
  label:     "Systems",
  bodyClass: "system-maker-mode",
  appClass:  "system-maker-mode",
  fullscreen: true,
  btnId:     "tabSystems",
  mount:     () => window.SystemMaker?.mount?.(),
  destroy:   () => {},
};
