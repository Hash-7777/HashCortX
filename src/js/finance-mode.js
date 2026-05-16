/* ═══════════════════════════════════════════════════════════════════
   FINANCE AI MODE — full-screen financial analysis studio
   ═══════════════════════════════════════════════════════════════════ */

const FinanceMode = (() => {
  "use strict";

  /* ── constants ─────────────────────────────────────────────────── */
  const STORAGE_KEY = "hashcortx_finance_sessions_v1";
  const COLORS = ["#10b981","#6366f1","#f59e0b","#f43f5e","#06b6d4","#a78bfa","#fb923c","#34d399"];
  const MAX_FILE_TEXT_CHARS = 240_000;
  const MAX_FILE_CONTEXT_CHARS = 80_000;
  const READY_PROMPTS = [
    {
      group: "Individuals",
      label: "Bank Statement Audit",
      prompt: "Analyze the attached bank statement, card statement, PDF, CSV, or file. Extract every income and expense transaction you can read, classify each item, calculate total income, total expenses, net cash flow, savings rate, recurring bills, unusual charges, and produce a clear personal finance report with charts, KPIs, transaction table, risks, and recommendations."
    },
    {
      group: "Individuals",
      label: "Monthly Budget",
      prompt: "Create a monthly personal budget from the attached transactions or my notes. Separate needs, wants, savings, debt payments, subscriptions, housing, transport, food, utilities, and discretionary spending. Show current spend, target spend, gaps, and practical cuts."
    },
    {
      group: "Individuals",
      label: "Expense Cleanup",
      prompt: "Review my spending and find where money is leaking. Identify subscriptions, repeated small charges, high-fee payments, avoidable expenses, lifestyle creep, cash withdrawals, and categories that are above normal. Give a prioritized action plan."
    },
    {
      group: "Individuals",
      label: "Debt Payoff Plan",
      prompt: "Analyze my debts, balances, minimum payments, interest rates, and income. Compare snowball and avalanche payoff strategies, estimate payoff time, interest saved, monthly cash-flow pressure, and the safest recommended plan."
    },
    {
      group: "Individuals",
      label: "Tax Prep Summary",
      prompt: "Extract tax-relevant income and expenses from the attached file. Group possible deductible expenses separately from personal expenses, flag missing information, and create a clean tax-prep summary. Do not invent tax rules; mark anything uncertain."
    },
    {
      group: "Individuals",
      label: "Investment Review",
      prompt: "Analyze my portfolio or investment statement. Summarize asset allocation, concentration risk, fees, performance, cash position, dividend/income flow, volatility signals, and rebalancing opportunities."
    },
    {
      group: "Business",
      label: "P&L Review",
      prompt: "Analyze the attached profit and loss, bank export, invoices, or accounting file. Extract revenue, COGS, operating expenses, gross margin, net margin, cash flow, major expense categories, anomalies, and produce a management report."
    },
    {
      group: "Business",
      label: "Cash Flow Forecast",
      prompt: "Build a cash-flow analysis from the attached transactions or notes. Identify starting cash, inflows, outflows, burn rate, runway, collection timing, payment timing, and short-term liquidity risks."
    },
    {
      group: "Business",
      label: "SaaS Metrics",
      prompt: "Analyze SaaS financial performance. Calculate ARR/MRR, growth, churn, gross margin, CAC, LTV, CAC payback, burn multiple, runway, expansion revenue, and provide founder-level recommendations."
    },
    {
      group: "Business",
      label: "Unit Economics",
      prompt: "Analyze unit economics for this business. Extract revenue per order/customer, variable costs, contribution margin, CAC, LTV, payback period, break-even volume, pricing risk, and operational levers."
    },
    {
      group: "Business",
      label: "Invoice/AP/AR Review",
      prompt: "Review invoices, accounts payable, and accounts receivable from the attached file. Extract vendors/customers, due dates, paid/unpaid amounts, aging buckets, overdue exposure, collection priorities, and cash impact."
    },
    {
      group: "Business",
      label: "Startup Runway",
      prompt: "Analyze startup runway and burn. Use cash balance, monthly revenue, payroll, tools, contractors, marketing, infra, and other operating costs. Estimate gross burn, net burn, runway months, and survival actions."
    },
  ];
  const DEFAULT_FILE_PROMPT = READY_PROMPTS[0].prompt;

  /* ── state ─────────────────────────────────────────────────────── */
  let sessions        = [];
  let activeSessionId = null;
  let chatHistory     = [];
  let currentReport   = null;
  let abortCtrl       = null;
  let mounted         = false;
  let pendingFiles    = [];
  let traceEntries    = [];
  let traceStartedAt  = Date.now();
  let traceRunCount   = 0;
  let reportEditMode  = false;
  let editPersistTimer = null;

  /* ── persistence ────────────────────────────────────────────────── */
  function loadSessions() {
    try { sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { sessions = []; }
  }
  function saveSessions() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
  }
  function activeSession() { return sessions.find(s => s.id === activeSessionId) || null; }
  function newSession(title) {
    const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: limitTitleWords(title), messages: [], report: null, trace: [], ts: Date.now() };
    sessions.unshift(s);
    saveSessions();
    return s;
  }

  function limitTitleWords(title, maxWords = 4) {
    const cleaned = String(title || "Untitled session").replace(/\s+/g, " ").trim();
    if (!cleaned) return "Untitled session";
    const words = cleaned.split(" ");
    return words.length > maxWords ? words.slice(0, maxWords).join(" ") + "…" : cleaned;
  }

  /* ── model routing ──────────────────────────────────────────────── */
  function getModel() {
    const local = document.getElementById("finModelPicker")?.value?.trim();
    if (local) return local;
    return document.getElementById("model")?.value?.trim() || "llama3.2";
  }

  function populateFinModelPicker() {
    const picker = document.getElementById("finModelPicker");
    if (!picker) return;
    const global = document.getElementById("model");
    const prev = picker.value;
    picker.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto (global model)";
    picker.appendChild(auto);
    if (global) {
      Array.from(global.options).forEach(opt => {
        const val = opt.value || "";
        if (!val || opt.disabled) return;
        const clone = document.createElement("option");
        clone.value = val;
        clone.textContent = opt.text || val;
        picker.appendChild(clone);
      });
    }
    if (prev && Array.from(picker.options).some(o => o.value === prev)) picker.value = prev;
  }

  async function callModel(messages, onChunk, signal) {
    const selected = getModel();
    const parsed   = window._H?.parseCloudModel?.(selected) || { provider: "", modelId: "" };
    const provider = parsed.provider || "ollama";
    const model    = parsed.modelId || selected;
    const payload  = {
      provider,
      model,
      messages,
      tools: [],
      temperature: window._H?.selectedTemperature?.() ?? 0.35,
      signal,
    };

    let result;
    traceAdd("Model", `Calling ${provider}:${model} · ${messages.length} message(s)`, "run");
    try {
      if (provider === "gemini" && window._H?.agentTurnGemini) {
        result = await window._H.agentTurnGemini(payload);
      } else if (provider === "anthropic" && window._H?.agentTurnAnthropic) {
        result = await window._H.agentTurnAnthropic(payload);
      } else if (provider !== "ollama" && window._H?.agentTurnOpenAI) {
        result = await window._H.agentTurnOpenAI(payload);
      } else if (window._H?.agentTurnOllama) {
        result = await window._H.agentTurnOllama(payload);
      }
    } catch (err) {
      traceAdd("Model", `Provider call failed · ${err?.message || err}`, "err");
      throw err;
    }

    const text = result?.content || "";
    if (text) onChunk?.(text);
    if (result) {
      traceAdd("Model", `Provider returned · ${text.length} content chars`, text.trim() ? "ok" : "warn");
      return result;
    }
    traceAdd("Model", "No provider adapter was available", "err");
    throw new Error("No LLM provider available.");
  }

  /* ── system prompt ──────────────────────────────────────────────── */
  function systemPrompt() {
    return `You are FinanceAI, an elite financial analyst operating as an intelligent agent inside HashCortX.

AGENT PHILOSOPHY:
You think before responding. You assess what data is actually present, calculate only what you can prove, and choose the right response mode. You NEVER invent, estimate, or hallucinate financial numbers to fill a schema.

━━━ RESPONSE FORMAT ━━━
Always return a single valid JSON object with a top-level "mode" field:

■ MODE "report" — ONLY when you have real, concrete financial data to analyze:
{
  "mode": "report",
  "title": string,
  "subtitle": string,
  "currency": string,
  "data_sources": [string],
  "kpis": [ { "label": string, "value": string, "change": string, "positive": boolean, "icon": "revenue"|"profit"|"cost"|"growth"|"cash"|"burn"|"margin"|"debt", "estimated": boolean } ],
  "charts": [ { "id": string, "type": "bar"|"line"|"donut", "title": string, "labels": [string], "datasets": [ { "label": string, "values": [number], "color": string } ] } ],
  "table": { "title": string, "headers": [string], "rows": [[string]] },
  "analysis": string,
  "recommendations": [string]
}

■ MODE "chat" — simple questions, follow-ups, advice, explanations:
{ "mode": "chat", "message": string (markdown OK) }

■ MODE "clarify" — data is missing or insufficient for real analysis:
{ "mode": "clarify", "message": string, "what_i_have": [string], "what_i_need": [string] }

━━━ HARD RULES — NEVER BREAK THESE ━━━
① NEVER invent numbers. Every value in a "report" must trace to the provided data.
② If income is not in the data → use mode "clarify", ask for it. DO NOT guess "$5,200".
③ If a KPI cannot be calculated from real data → set value to "N/A", estimated: false.
④ Text-only messages like "I have $X savings" or "I bought a $Y item" → use mode "chat" or "clarify", NOT a fabricated budget report.
⑤ File attachments: extract ONLY what is literally in the file. If file has 5 transactions → table has 5 rows, not 8 invented ones.
⑥ Multiple currencies → show each separately, never silently convert.
⑦ Follow-up questions that don't need a new report → use mode "chat".

━━━ WHEN YOU HAVE FILE DATA ━━━
1. Extract every transaction line: date, merchant, amount, currency, debit/credit.
2. Calculate totals ONLY from extracted rows.
3. If file has only expenses (no income shown) → report expenses, use "clarify" for income.
4. Flag: subscriptions, recurring charges, foreign-currency spend, unusually large amounts.
5. Build charts and KPIs from your own calculations — never from template values.
If the attachment includes a POSITIONAL PDF TABLE EXTRACTION block, use those coordinate rows as the source of truth for bank-statement transactions. Parse rows by Y position, then read cells left-to-right by X coordinate.

━━━ REPORT RULES (mode "report" only) ━━━
- KPIs: 4–6, only what you can actually calculate. Use "N/A" if unknown.
- Charts: 2–3, only real data. Best choices: expense donut + category bar/line over time.
- Table: real extracted transactions or category aggregates — exact rows from data, never invented.
- analysis: 5–7 sentences. MUST include: (a) the top 3 cost drivers with exact amounts, (b) any single transaction >15% of total spend flagged by name and amount, (c) recurring charges identified, (d) foreign-currency spend separated, (e) the biggest financial risk visible in the data.
- recommendations: 4–6 items. Each MUST be specific: cite the merchant/category, the amount, and the exact action (e.g. "Cancel Coursera subscription — saves $14.40/month = $172.80/year" not "reduce subscriptions").

━━━ DECISION-QUALITY STANDARD ━━━
This report must be good enough for the user to take to a bank, accountant, or financial advisor.
- Every number in the report must be traceable to a specific row in the source data.
- analysis must read like a senior financial analyst wrote it — not a summary, but an interpretation with specific figures cited inline.
- Flag anything a financial advisor would flag: overdrafts, duplicate charges, large single-vendor concentration, subscription creep, FX conversion cost, spending above income.
- Add a "data_quality" note in subtitle if data is incomplete (e.g. "Based on 14 of an estimated 30 monthly transactions").

━━━ CHART DATA RULES ━━━
- bar/line datasets.values → ACTUAL monetary amounts (e.g. 1826, 400). Never percentages.
- donut datasets.values → ACTUAL monetary amounts per category. Renderer auto-calculates %. NEVER percentages in a donut.
- All values must be derived from summing real transaction rows.

━━━ EXAMPLE / DEMO DATA EXCEPTION ━━━
If and only if the user explicitly asks for "example data", "sample data", "dummy data", "demo report", "fictional", "test data", "make up", or "show me how it looks" — you MAY produce mode "report" with entirely invented but realistic-looking data (plausible merchants, amounts, categories). Append " · Example Data" to the subtitle so the user knows it is fictional. This is the ONLY case where the no-inventing rules above are suspended.

━━━ OUTPUT SIZE RULES (CRITICAL — prevents truncation) ━━━
- analysis: max 4 sentences.
- recommendations: max 5 items, each max 15 words.
- table rows: max 15. If more transactions exist, show top 15 by amount.
- chart labels: max 8 per chart. Merge tiny categories into "Other".
- Keep the entire JSON response under 2000 tokens. Be concise.`;
  }

  function promptButtonsHtml(className) {
    return READY_PROMPTS.map(p => `
      <button class="${className}" data-prompt="${escHtml(p.prompt)}">
        <span>${escHtml(p.group)}</span>${escHtml(p.label)}
      </button>`).join("");
  }

  /* ── execution trace ────────────────────────────────────────────── */
  function traceReset(reason = "Trace reset") {
    traceStartedAt = Date.now();
    traceEntries = [];
    traceAdd("Trace", reason, "wait");
  }

  function traceAdd(stage, message, status = "wait", detail = "") {
    const entry = {
      ts: Date.now(),
      elapsed: Number(((Date.now() - traceStartedAt) / 1000).toFixed(1)),
      stage,
      message: String(message || ""),
      status,
      detail: String(detail || ""),
    };
    traceEntries.push(entry);
    if (traceEntries.length > 300) traceEntries = traceEntries.slice(-300);
    renderTraceEntries();
    persistTraceOnly();
    return entry;
  }

  function traceIcon(status) {
    if (status === "ok") return "✓";
    if (status === "err") return "!";
    if (status === "warn") return "!";
    if (status === "run") return "›";
    return "·";
  }

  function renderTraceEntries() {
    const list = document.getElementById("finTraceEntries");
    if (!list) return;
    if (!traceEntries.length) {
      list.innerHTML = `<div class="fin-trace-empty">No trace entries yet</div>`;
      return;
    }
    list.innerHTML = traceEntries.map(e => `
      <div class="fin-trace-entry">
        <span class="fin-trace-time">[${e.elapsed.toFixed(1)}s]</span>
        <span class="fin-trace-stage ${e.status}">${escHtml(e.stage)}</span>
        <span class="fin-trace-icon ${e.status}">${traceIcon(e.status)}</span>
        <span class="fin-trace-msg ${e.status}">${escHtml(e.message)}</span>
        ${e.detail ? `<span class="fin-trace-detail">${escHtml(e.detail)}</span>` : ""}
      </div>`).join("");
    list.scrollTop = list.scrollHeight;
  }

  function persistTraceOnly() {
    const s = activeSession();
    if (!s) return;
    s.trace = traceEntries.slice();
    s.ts = Date.now();
    saveSessions();
  }

  function closeTracePanel() {
    document.getElementById("finTracePanel")?.classList.remove("open");
  }

  /* ── HTML skeleton ──────────────────────────────────────────────── */
  function buildShell(wrap) {
    wrap.innerHTML = `
<header class="fin-header">
  <div class="fin-brand">
    <div class="fin-brand-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    </div>
    <span class="fin-brand-name">Finance<span style="color:var(--fin-primary)">AI</span></span>
    <span class="fin-brand-badge">STUDIO</span>
  </div>
  <div class="fin-header-center">
    <span class="fin-session-title" id="finSessionTitle"></span>
  </div>
  <div class="fin-header-right">
    <div class="fin-trace-wrap">
      <button class="fin-hdr-btn" id="finTraceBtn" title="Execution trace">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M4 19h16"/><path d="M4 15h10"/><path d="M4 11h16"/><path d="M4 7h10"/></svg>
        Trace
      </button>
      <div class="fin-trace-panel" id="finTracePanel">
        <div class="fin-trace-head">
          <span>Execution Trace</span>
          <button class="fin-trace-clear" id="finTraceClear" type="button">Clear</button>
        </div>
        <div class="fin-trace-entries" id="finTraceEntries"></div>
      </div>
    </div>
    <div class="fin-history-wrap">
      <button class="fin-hdr-btn" id="finHistoryBtn" title="Session history">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        History
      </button>
      <div class="fin-history-menu" id="finHistoryMenu"></div>
    </div>
    <select class="fin-model-select" id="finModelPicker" title="Model for this session">
      <option value="">Auto (global model)</option>
    </select>
    <button class="fin-hdr-btn" id="finCloseBtn" title="Exit Finance mode">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Exit
    </button>
  </div>
</header>

<div class="fin-body">

  <!-- ── Preview panel (2fr) ─────────────────────────────────────── -->
  <div class="fin-preview" id="finPreview">
      <div class="fin-empty" id="finEmpty">
        <div class="fin-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="52" height="52">
            <rect x="8" y="18" width="48" height="34" rx="4"/>
            <path d="M8 26h48"/>
            <path d="M20 18V12a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v6"/>
            <path d="M22 36l4 4 8-8"/>
            <path d="M38 34h8"/>
            <path d="M38 39h6"/>
          </svg>
        </div>
        <h2>Finance Analysis Studio</h2>
        <p>Describe your financial scenario or attach a statement file and I'll generate a full report with charts, KPIs, tables, and actionable insights.</p>
        <div class="fin-empty-chips">
          ${promptButtonsHtml("fin-empty-chip")}
        </div>
      </div>
      <div class="fin-report" id="finReport" style="display:none"></div>
  </div>

  <!-- ── Chat panel (1fr) ─────────────────────────────────────────── -->
  <div class="fin-chat">
    <div class="fin-chat-messages" id="finMessages"></div>
    <div class="fin-composer">
      <div class="fin-composer-box">
        <input id="finFileInput" type="file" multiple hidden
          accept=".pdf,.txt,.csv,.tsv,.json,.ofx,.qif,.xml,.md,.log,.rtf,.xlsx,.xls,.ods,text/*,application/pdf,application/json,text/csv,application/rtf,text/rtf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
        <div class="fin-file-list" id="finFileList"></div>
        <textarea id="finInput" rows="2" placeholder="Ask FinanceAI or attach a PDF/file…" maxlength="4000"></textarea>
        <div class="fin-composer-actions">
          <span class="fin-composer-hint">⏎ Send &nbsp;·&nbsp; Shift+⏎ newline</span>
          <div class="fin-composer-btns">
            <button class="fin-tool-btn" id="finAttachFile" type="button" title="Add PDF or file">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              PDF/File
            </button>
            <button class="fin-send-btn" id="finSend">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Analyze
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="fin-status" id="finStatus">
      <div class="fin-status-dot" id="finStatusDot"></div>
      <span class="fin-status-text" id="finStatusText">Ready</span>
    </div>
  </div>

</div>`;
  }

  /* ── wire events ────────────────────────────────────────────────── */
  function wireEvents(wrap) {
    wrap.querySelector("#finCloseBtn").addEventListener("click", () => {
      window._H?.setTab?.("chats");
    });

    const traceBtn = wrap.querySelector("#finTraceBtn");
    const tracePanel = wrap.querySelector("#finTracePanel");
    traceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("finHistoryMenu")?.classList.remove("open");
      tracePanel.classList.toggle("open");
      renderTraceEntries();
    });
    tracePanel.addEventListener("click", e => e.stopPropagation());
    wrap.querySelector("#finTraceClear")?.addEventListener("click", () => traceReset("Trace cleared"));

    const histBtn  = wrap.querySelector("#finHistoryBtn");
    const histMenu = wrap.querySelector("#finHistoryMenu");
    histBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTracePanel();
      const open = histMenu.classList.toggle("open");
      if (open) renderHistoryMenu();
    });
    document.addEventListener("click", closeHistoryMenu, false);
    document.addEventListener("click", closeTracePanel, false);

    wrap.querySelectorAll(".fin-empty-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const input = document.getElementById("finInput");
        if (input) { input.value = chip.dataset.prompt || ""; input.focus(); autosize(input); }
      });
    });

    const input = wrap.querySelector("#finInput");
    const send  = wrap.querySelector("#finSend");
    const fileInput = wrap.querySelector("#finFileInput");
    const attach = wrap.querySelector("#finAttachFile");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPrompt(); }
    });
    input.addEventListener("input", () => autosize(input));
    send.addEventListener("click", submitPrompt);
    attach.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => handleFinanceFiles(e.target.files));
    wrap.querySelector("#finFileList")?.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-file]");
      if (!remove) return;
      pendingFiles.splice(Number(remove.dataset.removeFile), 1);
      renderFileList();
    });
  }

  function closeHistoryMenu() {
    document.getElementById("finHistoryMenu")?.classList.remove("open");
  }

  function autosize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  /* ── history menu ───────────────────────────────────────────────── */
  function renderHistoryMenu() {
    const menu = document.getElementById("finHistoryMenu");
    if (!menu) return;
    if (!sessions.length) {
      menu.innerHTML = `<div class="fin-history-empty">No sessions yet</div>`;
      return;
    }
    menu.innerHTML = sessions.map(s => `
      <div class="fin-history-item${s.id === activeSessionId ? " active" : ""}" data-sid="${s.id}">
        <span class="fin-history-item-title" title="${escHtml(s.title)}">${escHtml(limitTitleWords(s.title))}</span>
        <span class="fin-history-item-date">${relTime(s.ts)}</span>
        <span class="fin-history-actions">
          <button class="fin-history-action" type="button" data-edit-sid="${s.id}" title="Rename session" aria-label="Rename ${escHtml(s.title)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="fin-history-action danger" type="button" data-delete-sid="${s.id}" title="Delete session" aria-label="Delete ${escHtml(s.title)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>
          </button>
        </span>
      </div>`).join("") +
      `<div class="fin-history-item" id="finHistoryNew" style="color:var(--fin-primary);font-weight:700;border-top:1px solid var(--fin-border);margin-top:4px;padding-top:10px">+ New session</div>`;

    menu.querySelectorAll(".fin-history-item[data-sid]").forEach(el => {
      el.addEventListener("click", () => { loadSession(el.dataset.sid); menu.classList.remove("open"); });
    });
    menu.querySelectorAll("[data-edit-sid]").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); renameSession(btn.dataset.editSid); });
    });
    menu.querySelectorAll("[data-delete-sid]").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); deleteSession(btn.dataset.deleteSid); });
    });
    menu.querySelector("#finHistoryNew")?.addEventListener("click", () => { startNewSession(); menu.classList.remove("open"); });
  }

  function renameSession(sid) {
    const s = sessions.find(x => x.id === sid);
    if (!s) return;

    /* Find the title span inside the matching history row */
    const menu      = document.getElementById("finHistoryMenu");
    const item      = menu?.querySelector(`.fin-history-item[data-sid="${sid}"]`);
    const titleSpan = item?.querySelector(".fin-history-item-title");
    if (!titleSpan) return;

    /* Swap span → input */
    const input = document.createElement("input");
    input.type      = "text";
    input.value     = s.title;
    input.maxLength = 80;
    input.className = "fin-history-rename-input";
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      const raw   = input.value.trim();
      const title = raw ? limitTitleWords(raw) : s.title;
      s.title = title;
      s.ts    = Date.now();
      saveSessions();
      if (sid === activeSessionId) {
        const header = document.getElementById("finSessionTitle");
        if (header) header.textContent = title;
        traceAdd("Session", `Renamed to "${title}"`, "ok");
      }
      renderHistoryMenu();
    }

    function cancel() {
      if (committed) return;
      committed = true;
      renderHistoryMenu();   // restore original title without saving
    }

    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); e.stopPropagation(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
      e.stopPropagation();   // don't bubble to the item's click listener
    });
    input.addEventListener("blur",  commit);
    input.addEventListener("click", e => e.stopPropagation());
  }

  function deleteSession(sid) {
    const s = sessions.find(x => x.id === sid);
    if (!s) return;
    if (!window.confirm(`Delete "${limitTitleWords(s.title)}"?`)) return;
    sessions = sessions.filter(x => x.id !== sid);
    saveSessions();
    if (sid === activeSessionId) startNewSession();
    renderHistoryMenu();
  }

  function loadSession(sid) {
    const s = sessions.find(x => x.id === sid);
    if (!s) return;
    activeSessionId = sid;
    chatHistory     = s.messages ? [...s.messages] : [];
    currentReport   = s.report   || null;
    traceEntries    = s.trace ? [...s.trace] : [];
    traceStartedAt  = traceEntries[0]?.ts || Date.now();
    reportEditMode  = false;
    renderMessages();
    renderTraceEntries();
    currentReport ? renderReport(currentReport) : hideReport();
    updateStatus("Ready");
    const title = document.getElementById("finSessionTitle");
    if (title) title.textContent = limitTitleWords(s.title);
    traceAdd("Session", `Loaded "${s.title}"`, "ok");
  }

  function startNewSession() {
    activeSessionId = null;
    chatHistory     = [];
    currentReport   = null;
    pendingFiles    = [];
    reportEditMode  = false;
    const msgs = document.getElementById("finMessages");
    if (msgs) msgs.innerHTML = "";
    const title = document.getElementById("finSessionTitle");
    if (title) title.textContent = "";
    renderFileList();
    traceReset("New Finance session");
    hideReport();
  }

  /* ── file ingestion ─────────────────────────────────────────────── */
  async function waitForPdfJs(timeoutMs = 6000) {
    if (window.pdfjsLib) {
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/vendor/pdf.worker.min.js";
      }
      traceAdd("PDF", "pdf.js ready", "ok");
      return window.pdfjsLib;
    }
    traceAdd("PDF", "Waiting for pdf.js to load", "wait");
    const started = Date.now();
    while (!window.pdfjsLib && Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    if (!window.pdfjsLib) throw new Error("PDF reader is not loaded. Reload the app and try again.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc ||= "/js/vendor/pdf.worker.min.js";
    traceAdd("PDF", "pdf.js loaded after wait", "ok");
    return window.pdfjsLib;
  }

  async function extractPdfText(file) {
    traceAdd("PDF", `Opening ${file.name}`, "run", sizeLabel(file.size));
    const pdfjs = await waitForPdfJs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    traceAdd("PDF", `Loaded ${doc.numPages} page(s)`, "ok");
    const meta = await readPdfMetadata(doc);
    const chunks = [];
    const positionedChunks = [];
    const maxPages = Math.min(doc.numPages, 120);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => ("str" in it ? it.str : "")).join(" ").trim();
      chunks.push(`--- Page ${i} ---\n${pageText}`);
      positionedChunks.push(`--- Page ${i} positioned rows ---\n${formatPdfPageRows(content.items)}`);
      if (i === 1 || i === maxPages || i % 10 === 0) {
        traceAdd("PDF", `Extracted page ${i}/${maxPages}`, "run", `${pageText.length} chars`);
      }
    }
    const text = chunks.join("\n\n").trim();
    const positionedText = positionedChunks.join("\n\n").trim();
    const trailing = doc.numPages > maxPages ? `\n\n[${doc.numPages - maxPages} more PDF pages were not sent because of the context limit.]` : "";
    const coordinateReason = pdfCoordinateReason(text, doc.numPages, meta);
    if (coordinateReason) {
      traceAdd("PDF", `${coordinateReason}; using coordinate table reconstruction`, "warn", `${text.length} chars`);
      if (!text) {
        return {
          text: `[PDF attached: ${file.name}. No selectable text was found. This file needs OCR or a text layer before FinanceAI can analyze it.]`,
          pages: doc.numPages,
          extracted: false,
          images: [],
        };
      }
      const coordinateGuide = [
        "[POSITIONAL PDF TABLE EXTRACTION]",
        "The rows below are reconstructed from pdf.js text coordinates, not OCR.",
        "Each cell is prefixed with its approximate X coordinate. Read each row left-to-right by X coordinate.",
        "For this statement family, the transaction grid is usually: reference/sequence, authorization, currency, credit, debit, description/merchant, posting date, transaction date.",
        positionedText,
        "[END POSITIONAL PDF TABLE EXTRACTION]",
      ].join("\n");
      return {
        text: text + trailing + "\n\n" + coordinateGuide,
        pages: doc.numPages,
        extracted: true,
        images: [],
      };
    }
    traceAdd("PDF", `Extracted readable text`, "ok", `${text.length} chars`);
    return { text: text + trailing, pages: doc.numPages, extracted: true, images: [] };
  }

  async function readPdfMetadata(doc) {
    try {
      const meta = await doc.getMetadata();
      const info = meta?.info || {};
      const label = [info.Creator, info.Producer].filter(Boolean).join(" · ");
      if (label) traceAdd("PDF", `Metadata: ${label.slice(0, 90)}`, "wait");
      return info;
    } catch (err) {
      traceAdd("PDF", "Metadata unavailable", "warn", err?.message || String(err));
      return {};
    }
  }

  function pdfCoordinateReason(text, pageCount, meta = {}) {
    const source = [meta.Creator, meta.Producer].filter(Boolean).join(" ");
    const compact = String(text || "").replace(/\s+/g, " ").trim();
    if (/Apache FOP/i.test(source)) return "Apache FOP statement layout detected";
    if (/[\u0600-\u06FF]/.test(compact) && /(?:كشف|حساب|بطاقات|البنك|الرصيد|تاريخ|مدين|دائن)/.test(compact)) {
      return "Arabic bank-statement layout detected";
    }
    if (!looksTransactionReadable(text, pageCount)) return "Selectable text is not transaction-readable";
    return "";
  }

  function formatPdfPageRows(items) {
    const cells = (items || [])
      .filter(it => it && typeof it.str === "string" && it.str.trim())
      .map(it => ({
        text: it.str.replace(/\s+/g, " ").trim(),
        x: Number(it.transform?.[4] || 0),
        y: Number(it.transform?.[5] || 0),
      }))
      .filter(c => c.text);
    const rows = [];
    const tolerance = 3.2;
    cells
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .forEach(cell => {
        let row = rows.find(r => Math.abs(r.y - cell.y) <= tolerance);
        if (!row) {
          row = { y: cell.y, cells: [] };
          rows.push(row);
        }
        row.cells.push(cell);
        row.y = (row.y * (row.cells.length - 1) + cell.y) / row.cells.length;
      });
    return rows
      .sort((a, b) => b.y - a.y)
      .map(row => {
        const merged = mergePdfRowCells(row.cells.sort((a, b) => a.x - b.x));
        return `y=${Math.round(row.y)} :: ` + merged.map(c => `[x=${Math.round(c.x)}] ${c.text}`).join(" | ");
      })
      .join("\n");
  }

  function mergePdfRowCells(cells) {
    const out = [];
    for (const cell of cells) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(cell.x - prev.lastX) < 9) {
        prev.text += " " + cell.text;
        prev.lastX = cell.x;
      } else {
        out.push({ x: cell.x, lastX: cell.x, text: cell.text });
      }
    }
    return out;
  }

  function looksTextLike(file) {
    if (file.type?.startsWith("text/")) return true;
    if (/^(application\/json|application\/xml|text\/csv)$/i.test(file.type || "")) return true;
    return /\.(txt|md|markdown|csv|tsv|json|ofx|qif|xml|log|ledger)$/i.test(file.name || "");
  }

  function sizeLabel(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function charLabel(chars) {
    const n = Number(chars) || 0;
    if (!n) return "no text";
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k chars` : `${n} chars`;
  }

  function looksTransactionReadable(text, pageCount) {
    const compact = String(text || "").replace(/--- Page \d+ ---/g, " ").replace(/\s+/g, " ").trim();
    const moneyLike = compact.match(/(?:[$€£]|EGP|USD|EUR|GBP|ج\.?م)?\s*-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})/gi) || [];
    const dateLike = compact.match(/\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/g) || [];
    const merchantLike = compact.match(/\b(?:AMAZON|APPLE|GOOGLE|UBER|PAYPAL|VISA|CARD|ATM|POS|TRANSFER|SALARY|CREDIT|DEBIT|MCDONALD|SPOTIFY|NETFLIX|ANTHROPIC|METRO|CARREFOUR)\b/gi) || [];
    if (compact.length < 900) return false;
    if (pageCount > 1 && compact.length < pageCount * 650) return false;
    return moneyLike.length >= 12 || (moneyLike.length >= 6 && (dateLike.length >= 2 || merchantLike.length >= 2));
  }

  /* Strip RTF markup and return plain text.
     Word RTF can embed images as >1 MB hex blobs inside {\pict...} groups;
     metadata groups (fonttbl, colortbl, stylesheet, info…) add another ~100 KB.
     We strip those groups by tracking brace depth, then clean up control words. */
  function _removeRtfGroups(s, tags) {
    // For each tag, remove ALL top-level occurrences of {<tag>...matching-brace...}
    for (const tag of tags) {
      const needle = tag; // e.g. "{\\pict" or "{\\"
      let out = "";
      let i = 0;
      while (i < s.length) {
        const idx = s.indexOf(needle, i);
        if (idx === -1) { out += s.slice(i); break; }
        out += s.slice(i, idx);
        // Walk forward tracking brace depth to find the closing }
        let depth = 0, j = idx;
        while (j < s.length) {
          if (s[j] === "{") depth++;
          else if (s[j] === "}") { depth--; if (depth === 0) { j++; break; } }
          j++;
        }
        i = j;
      }
      s = out;
    }
    return s;
  }

  function stripRtf(raw) {
    let s = String(raw || "");

    // ① Remove binary/image groups first — these are the 1 MB+ bloat.
    //   {\pict ...hex data...}, {\*\shppict ...}, {\object ...}
    s = _removeRtfGroups(s, ["{\\pict", "{\\*\\shppict", "{\\*\\objdata", "{\\object"]);

    // ② Remove ignorable destinations: {\* ...} — fonttbl, rsidtbl, xmlnstbl, themedata, etc.
    s = _removeRtfGroups(s, ["{\\*\\"]);

    // ③ Remove remaining metadata groups that are NOT flagged with {\*}
    s = _removeRtfGroups(s, [
      "{\\fonttbl", "{\\colortbl", "{\\stylesheet", "{\\info",
      "{\\rsidtbl", "{\\mmathPr", "{\\listtable", "{\\listoverride",
      "{\\pgdsc", "{\\revtbl", "{\\fldinst",
    ]);

    // ④ Convert whitespace control words before nuking everything else
    s = s.replace(/\\par\b\s?/gi, "\n")
         .replace(/\\pard\b[^\\{}\n]*/gi, "\n")
         .replace(/\\line\b\s?/gi, "\n")
         .replace(/\\tab\b\s?/gi, "\t")
         .replace(/\\sect\b\s?/gi, "\n\n")
         .replace(/\\bullet\b\s?/gi, "• ")
         .replace(/\\emdash\b\s?/gi, "—")
         .replace(/\\endash\b\s?/gi, "–");

    // ⑤ Hex-encoded characters: \'e9 → keep printable ASCII, drop extended
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => {
      const c = parseInt(h, 16);
      return (c >= 32 && c < 127) ? String.fromCharCode(c) : "";
    });

    // ⑥ Remove all remaining control words and brace delimiters
    s = s.replace(/\\[a-z*!]+\-?\d*\s?/gi, " ");
    s = s.replace(/[{}]/g, "");

    // ⑦ Clean up whitespace
    s = s.replace(/\r\n?/g, "\n")
         .replace(/[ \t]{2,}/g, " ")
         .replace(/\n[ \t]+/g, "\n")
         .replace(/\n{3,}/g, "\n\n")
         .trim();
    return s;
  }

  async function loadXlsxLib() {
    if (window.XLSX) return window.XLSX;
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      s.onload  = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error("SheetJS failed to load"));
      document.head.appendChild(s);
    });
  }

  async function readFinanceFile(file) {
    /* RTF: strip markup before treating as text — raw RTF can be 1 MB+ for a few hundred words */
    if (/\.rtf$/i.test(file.name || "") || /\brtf\b/i.test(file.type || "")) {
      traceAdd("File", `Stripping RTF markup from ${file.name}`, "run", sizeLabel(file.size));
      const raw = await file.text();
      const text = stripRtf(raw);
      traceAdd("File", `RTF stripped ${file.name}`, "ok", `${raw.length} raw → ${text.trim().length} chars`);
      return {
        name: file.name,
        kind: "text",
        size: file.size,
        pages: 0,
        extracted: true,
        chars: text.trim().length,
        images: [],
        text: text.slice(0, MAX_FILE_TEXT_CHARS),
      };
    }

    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) {
      const { text, pages, extracted, images } = await extractPdfText(file);
      return {
        name: file.name,
        kind: "pdf",
        size: file.size,
        pages,
        extracted,
        chars: text.trim().length,
        images: images || [],
        text: text.slice(0, MAX_FILE_TEXT_CHARS),
      };
    }

    /* XLSX / XLS: use SheetJS if available, convert to CSV text */
    if (/\.(xlsx|xls|ods)$/i.test(file.name || "") ||
        /spreadsheetml|ms-excel|opendocument\.spreadsheet/i.test(file.type || "")) {
      traceAdd("File", `Reading spreadsheet ${file.name}`, "run", sizeLabel(file.size));
      try {
        const XLSX = await loadXlsxLib();
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        const csvParts = wb.SheetNames.map(name => {
          const ws  = wb.Sheets[name];
          const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
          return `--- Sheet: ${name} ---\n${csv}`;
        });
        const text = csvParts.join("\n\n");
        traceAdd("File", `Spreadsheet converted ${file.name}`, "ok",
          `${wb.SheetNames.length} sheet(s) · ${text.trim().length} chars`);
        return {
          name: file.name, kind: "spreadsheet", size: file.size,
          pages: wb.SheetNames.length, extracted: true,
          chars: text.trim().length, images: [],
          text: text.slice(0, MAX_FILE_TEXT_CHARS),
        };
      } catch (err) {
        traceAdd("File", `Spreadsheet read failed ${file.name}`, "warn", err?.message);
        // Fall through to binary handler
      }
    }

    if (looksTextLike(file)) {
      traceAdd("File", `Reading text file ${file.name}`, "run", sizeLabel(file.size));
      const text = await file.text();
      traceAdd("File", `Read text file ${file.name}`, "ok", `${text.trim().length} chars`);
      return {
        name: file.name,
        kind: "text",
        size: file.size,
        pages: 0,
        extracted: true,
        chars: text.trim().length,
        images: [],
        text: text.slice(0, MAX_FILE_TEXT_CHARS),
      };
    }

    return {
      name: file.name,
      kind: "binary",
      size: file.size,
      pages: 0,
      extracted: false,
      chars: 0,
      images: [],
      text: `[Unsupported binary attachment: ${file.name} (${sizeLabel(file.size)}, ${file.type || "unknown type"}). Contents were not readable and were not sent as financial data.]`,
    };
  }

  async function handleFinanceFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    traceAdd("File", `Attachment picker returned ${files.length} file(s)`, "run");
    updateStatus(`Reading ${files.length} file${files.length > 1 ? "s" : ""}...`);
    setStatusDot("active");
    for (const file of files) {
      try {
        traceAdd("File", `Queue ${file.name}`, "wait", `${file.type || "unknown"} · ${sizeLabel(file.size)}`);
        const readFile = await readFinanceFile(file);
        pendingFiles.push(readFile);
        traceAdd("File", `Ready ${file.name}`, readFile.extracted ? "ok" : "warn", `${readFile.kind} · ${charLabel(readFile.chars)}`);
      } catch (err) {
        traceAdd("File", `Failed to read ${file.name}`, "err", err?.message || String(err));
        pendingFiles.push({
          name: file.name,
          kind: /\.pdf$/i.test(file.name || "") ? "pdf" : "file",
          size: file.size,
          pages: 0,
          extracted: false,
          chars: 0,
          images: [],
          text: `[Attachment read failed: ${file.name}. ${err?.message || err}]`,
        });
      }
    }
    renderFileList();
    const input = document.getElementById("finFileInput");
    if (input) input.value = "";
    setStatusDot("");
    updateStatus("Ready");
  }

  function renderFileList() {
    const list = document.getElementById("finFileList");
    if (!list) return;
    if (!pendingFiles.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = pendingFiles.map((f, i) => {
      const meta = [
        f.kind?.toUpperCase?.() || "FILE",
        f.pages ? `${f.pages} pages` : "",
        charLabel(f.chars),
        sizeLabel(f.size),
      ].filter(Boolean).join(" · ");
      return `
        <div class="fin-file-chip ${f.extracted || f.images?.length ? "" : "warning"}">
          <span class="fin-file-icon">${f.kind === "pdf" ? "PDF" : f.kind === "text" ? "TXT" : "FILE"}</span>
          <span class="fin-file-main">
            <span class="fin-file-name">${escHtml(f.name)}</span>
            <span class="fin-file-meta">${escHtml(meta)}</span>
          </span>
          <button class="fin-file-remove" type="button" data-remove-file="${i}" title="Remove file" aria-label="Remove ${escHtml(f.name)}">×</button>
        </div>`;
    }).join("");
  }

  function attachmentNames(files) {
    return files.map(f => f.name).join(", ");
  }

  function buildAttachedFilesContext(files, maxChars = MAX_FILE_CONTEXT_CHARS) {
    if (!files.length) return "";
    const readable = files.filter(f => f.text);
    const perFileBudget = Math.max(2500, Math.floor(maxChars / Math.max(readable.length, 1)));
    const sections = readable.map((f, i) => {
      const raw = String(f.text || "").trim() || "[No readable text was extracted from this attachment.]";
      const clipped = raw.length > perFileBudget;
      const text = clipped ? raw.slice(0, perFileBudget) + `\n\n[${raw.length - perFileBudget} more characters from this file were omitted.]` : raw;
      const meta = [
        `name=${f.name}`,
        `kind=${f.kind}`,
        f.pages ? `pages=${f.pages}` : "",
        `readable=${f.extracted ? "yes" : "no"}`,
        `chars=${raw.length}`,
      ].filter(Boolean).join(", ");
      return `--- Finance attachment ${i + 1}: ${meta} ---\n${text}`;
    });
    traceAdd("Prompt", `Built attachment context`, "ok", `${files.length} file(s) · ${sections.join("\n\n").length} chars`);
    return [
      "",
      "[FINANCE FILE ATTACHMENTS]",
      "Use the extracted text below as source data. Do not say you cannot read the files unless a specific attachment says no readable text was extracted.",
      "Extract all readable income and expense transactions, categorize them, calculate totals, and cite uncertainty when data is incomplete.",
      sections.join("\n\n"),
      "[END FINANCE FILE ATTACHMENTS]",
    ].join("\n");
  }

  /* ── submit ─────────────────────────────────────────────────────── */
  async function submitPrompt() {
    const input = document.getElementById("finInput");
    const send  = document.getElementById("finSend");
    const filesForPrompt = pendingFiles.slice();
    const hasFiles = filesForPrompt.length > 0;
    const text  = input?.value?.trim() || (hasFiles ? DEFAULT_FILE_PROMPT : "");
    if (!text) return;
    const attachedContext = buildAttachedFilesContext(filesForPrompt);
    const displayText = hasFiles ? `${text}\n\nAttached: ${attachmentNames(filesForPrompt)}` : text;
    const modelText = attachedContext ? `${text}\n${attachedContext}` : text;
    traceRunCount++;
    traceAdd("Run", `Starting Finance analysis #${traceRunCount}`, "run");
    traceAdd("Prompt", `User prompt ready`, "ok", `${text.length} chars`);
    traceAdd("Prompt", `Provider message prepared`, "ok", `${modelText.length} chars · ${filesForPrompt.length} attachment(s)`);

    if (!activeSessionId) {
      const titleBase = hasFiles ? `${filesForPrompt[0].name}: ${text}` : text;
      const s = newSession(titleBase.slice(0, 60) + (titleBase.length > 60 ? "…" : ""));
      activeSessionId = s.id;
      const title = document.getElementById("finSessionTitle");
      if (title) title.textContent = limitTitleWords(s.title);
      traceAdd("Session", `Created "${s.title}"`, "ok");
    }

    input.value = "";
    pendingFiles = [];
    renderFileList();
    autosize(input);
    send.disabled = true;
    hideEmpty();

    appendMessage("user", displayText);
    chatHistory.push({
      role: "user",
      content: modelText,
      displayContent: displayText,
      attachments: filesForPrompt.map(f => ({
        name: f.name,
        kind: f.kind,
        pages: f.pages || 0,
        chars: f.chars || 0,
        extracted: !!f.extracted,
      })),
    });

    const thinkId = appendThinking();
    setStatusDot("active");
    updateStatus("Generating analysis…");

    abortCtrl = new AbortController();
    let raw = "";

    /* Progressive file-budget retry — shrinks attached file context on 413 */
    const FILE_BUDGETS = [MAX_FILE_CONTEXT_CHARS, 40_000, 20_000, 8_000];
    let callOk = false;
    for (let bi = 0; bi < FILE_BUDGETS.length; bi++) {
      raw = "";
      if (bi > 0 && filesForPrompt.length) {
        const budget = FILE_BUDGETS[bi];
        traceAdd("Prompt", `Retrying with ${Math.round(budget / 1000)}K char file budget`, "warn");
        const trimmedCtx = buildAttachedFilesContext(filesForPrompt, budget);
        chatHistory[chatHistory.length - 1].content = trimmedCtx ? `${text}\n${trimmedCtx}` : text;
      }
      try {
        const msgs = [{ role: "system", content: systemPrompt() }, ...chatHistory.map(toProviderMessage)];
        traceAdd("Prompt", `Sending sanitized transcript`, "run", `${msgs.length} message(s)`);
        await callModel(msgs, (chunk) => { raw += chunk; }, abortCtrl.signal);
        callOk = true;
        break;
      } catch (err) {
        if (err?.name === "AbortError") {
          removeThinking(thinkId);
          traceAdd("Run", "Aborted by user", "warn");
          setStatusDot("");
          updateStatus("Ready");
          send.disabled = false;
          persistSession();
          return;
        }
        const is413 = /413|too large|request entity too large|context_length/i.test(err?.message || "");
        if (is413 && bi < FILE_BUDGETS.length - 1) {
          traceAdd("Model", `413 — shrinking file context and retrying (budget ${bi + 1}/${FILE_BUDGETS.length - 1})`, "warn", err?.message);
          continue;
        }
        removeThinking(thinkId);
        traceAdd("Run", `Failed during model call`, "err", err?.message || String(err));
        appendMessage("ai", "Error: " + (err?.message || err));
        setStatusDot("error");
        updateStatus("Analysis failed");
        send.disabled = false;
        persistSession();
        return;
      }
    }
    if (!callOk) {
      removeThinking(thinkId);
      traceAdd("Run", `All retry budgets exhausted`, "err", "413 persists at minimum context");
      appendMessage("ai", "Error: The attached file is too large even after maximum compression. Try splitting it into smaller sections.");
      setStatusDot("error");
      updateStatus("Analysis failed");
      send.disabled = false;
      persistSession();
      return;
    }

    setStatusDot("active");
    updateStatus("Parsing response...");
    handleAgentResponse(raw, thinkId, send);
  }

  /* Extract the JSON object from a raw model response.
     Uses proper bracket-depth tracking so trailing text after } is never included. */
  function extractJson(text) {
    /* 1 — try explicit markdown fence */
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      const candidate = fenceMatch[1].trim();
      try { JSON.parse(candidate); return candidate; } catch { /* fall through */ }
    }
    /* 2 — find first { then walk to matching } using bracket depth */
    const start = text.indexOf("{");
    if (start === -1) return text.trim();
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (esc)           { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true;  continue; }
      if (c === '"')     { inStr = !inStr; continue; }
      if (inStr)         continue;
      if (c === "{")     depth++;
      else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    /* 3 — truncated response: return everything from { onward (repairJson will fix it) */
    return text.slice(start);
  }

  /* Close any unclosed arrays/objects left by a truncated model response.
     Also strips trailing commas that would make JSON.parse reject otherwise-valid JSON. */
  function repairJson(text) {
    let s = text.trim();
    /* remove trailing commas before ] or } */
    s = s.replace(/,(\s*[}\]])/g, "$1");
    /* close any open string — scan character by character */
    let inStr = false, esc = false;
    const braces = [], brackets = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc)               { esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; continue; }
      if (c === '"')         { inStr = !inStr; continue; }
      if (inStr)             continue;
      if (c === "{")         braces.push(i);
      else if (c === "}")    braces.length && braces.pop();
      else if (c === "[")    brackets.push(i);
      else if (c === "]")    brackets.length && brackets.pop();
    }
    /* close unclosed string */
    if (inStr) s += '"';
    /* close unclosed arrays then objects (innermost first) — simple heuristic */
    /* walk the remaining open bracket/brace counts from last push */
    while (brackets.length) { s += "]"; brackets.pop(); }
    while (braces.length)   { s += "}"; braces.pop(); }
    return s;
  }

  /* ── agent response handler ─────────────────────────────────────── */
  function formatClarifyBubble(parsed) {
    let md = parsed.message || "I need more information to build a proper analysis.";
    if (parsed.what_i_have?.length) {
      md += "\n\n**What I have:**\n" + parsed.what_i_have.map(x => `• ${x}`).join("\n");
    }
    if (parsed.what_i_need?.length) {
      md += "\n\n**What I need:**\n" + parsed.what_i_need.map(x => `• ${x}`).join("\n");
    }
    return md;
  }

  function handleAgentResponse(raw, thinkId, send) {
    removeThinking(thinkId);
    traceAdd("Model", `Raw response collected`, raw.trim() ? "ok" : "err", `${raw.length} chars`);

    if (!raw.trim()) {
      appendMessage("ai", "FinanceAI returned an empty response. Check Trace for details.");
      setStatusDot("error"); updateStatus("Empty response");
      send.disabled = false; persistSession(); return false;
    }

    let parsed = null;
    const jsonCandidate = extractJson(raw);
    /* First try: parse as-is */
    try {
      parsed = JSON.parse(jsonCandidate);
      traceAdd("Parse", "JSON parsed successfully", "ok");
    } catch (firstErr) {
      /* Second try: repair truncated / trailing-comma JSON */
      try {
        const repaired = repairJson(jsonCandidate);
        parsed = JSON.parse(repaired);
        traceAdd("Parse", "JSON repaired and parsed (response was truncated)", "warn",
          `original ${jsonCandidate.length} chars → repaired ${repaired.length} chars`);
      } catch (secondErr) {
        traceAdd("Parse", "JSON parse failed after repair attempt", "warn",
          firstErr?.message);
        /* Last resort: show raw text as chat bubble */
        chatHistory.push({ role: "assistant", content: raw, displayContent: raw.slice(0, 600) });
        appendMessage("ai", raw.slice(0, 1200));
        setStatusDot("done"); updateStatus("Ready");
        send.disabled = false; persistSession(); return true;
      }
    }

    const mode = parsed?.mode || "report";

    if (mode === "chat") {
      const msg = parsed.message || "";
      traceAdd("Parse", "Agent chose mode: chat", "ok");
      chatHistory.push({ role: "assistant", content: raw, displayContent: msg });
      appendMessage("ai", msg);
      setStatusDot("done"); updateStatus("Ready");
      send.disabled = false; persistSession(); return true;
    }

    if (mode === "clarify") {
      const display = formatClarifyBubble(parsed);
      traceAdd("Parse", "Agent chose mode: clarify", "ok",
        `needs: ${(parsed.what_i_need || []).join(", ")}`);
      chatHistory.push({ role: "assistant", content: raw, displayContent: display });
      appendMessage("ai", display);
      setStatusDot("done"); updateStatus("More information needed");
      send.disabled = false; persistSession(); return true;
    }

    // mode === "report"
    const report = parsed;
    if (!report.title || !report.kpis) {
      traceAdd("Parse", "Report missing required fields", "warn");
    }
    currentReport = report;
    const summary = summarizeReport(report);
    chatHistory.push({ role: "assistant", content: raw, displayContent: summary });
    appendMessage("ai", summary);
    renderReport(report);
    traceAdd("Render", `Report rendered`, "ok",
      `${(report.kpis || []).length} KPI(s) · ${(report.charts || []).length} chart(s)`);
    setStatusDot("done"); updateStatus("Report generated");
    send.disabled = false; persistSession(); return true;
  }

  function toProviderMessage(message) {
    const msg = {
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || ""),
    };
    if (message.images?.length) msg.images = message.images.slice();
    return msg;
  }

  function summarizeReport(r) {
    const kpis = (r.kpis || []).slice(0, 3).map(k => `**${k.label}**: ${k.value}`).join(" · ");
    return `**${r.title}**\n\n${kpis}\n\n${r.analysis || ""}`;
  }

  function editAttr(path, multiline = false) {
    if (!reportEditMode) return "";
    return `contenteditable="true" spellcheck="false" data-edit-path="${escHtml(path)}"${multiline ? ' data-edit-multiline="true"' : ""}`;
  }

  /* ── live recalculation engine ──────────────────────────────────── */

  /* Parse a cell value to a number, stripping currency symbols / commas */
  function parseAmt(cell) {
    const s = String(cell ?? "").replace(/[^0-9.\-]/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /* Format a number as a KPI value string */
  function fmtKpi(n, currency) {
    const sym = (currency || "").replace(/[a-z]/gi, "") || "$";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
    return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  /* Format a KPI number matching the style of the existing value —
     if the existing value has no currency symbol we keep it plain,
     so edits never introduce a $ that wasn't there before. */
  function fmtKpiLike(n, existingVal, currency) {
    const hasSym = /[$€£¥₹]|^[A-Z]{2,3}\s/.test(String(existingVal || ""));
    if (!hasSym) {
      /* plain format — no symbol, compact K/M suffix */
      const a = Math.abs(n), sign = n < 0 ? "-" : "";
      if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
      if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
      return `${sign}${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    }
    return fmtKpi(n, currency);
  }

  /* Re-derive KPIs and chart data from the table rows.
     Returns true if any value was updated. */
  function recalcFromTable(report) {
    const t = report.table;
    if (!t?.headers?.length || !t?.rows?.length) return false;

    const H = t.headers.map(h => String(h).toLowerCase().trim());

    /* ── amount column ── */
    const amtIdx = (() => {
      let idx = H.findIndex(h => /\bamount\b|\btotal\b|\bsum\b|\bcost\b|\bprice\b|\bspend\b|\bvalue\b/i.test(h));
      if (idx >= 0) return idx;
      for (let ci = H.length - 1; ci >= 0; ci--) {
        if (t.rows.some(r => parseAmt(r[ci]) !== null)) return ci;
      }
      return -1;
    })();
    if (amtIdx === -1) return false;

    /* ── type column ── */
    const typeIdx = H.findIndex(h => /\btype\b|\bdirection\b|\bcr[\/.\\-]?dr\b/i.test(h));

    /* ── category column — with description/item as fallback ──
       This prevents everything collapsing to "Other" when the AI
       didn't generate a dedicated "Category" column. */
    const catIdx  = H.findIndex(h => /\bcat(egory)?\b/i.test(h));
    const descIdx = H.findIndex(h =>
      /\bdesc(ription)?\b|\bitem\b|\bname\b|\bmerchant\b|\bpayee\b|\bnote\b/i.test(h));
    /* effectiveCatIdx: category > description > nothing */
    const effectiveCatIdx = catIdx >= 0 ? catIdx : descIdx;

    let income = 0, expenses = 0;
    const catMap = {};

    t.rows.forEach(row => {
      const amt = parseAmt(row[amtIdx]);
      if (amt === null || amt === 0) return;

      const typeCell = String(row[typeIdx >= 0 ? typeIdx : -1] ?? "").toLowerCase();
      /* Also scan the description/name cell for income keywords */
      const descCell = String(row[descIdx >= 0 ? descIdx : -1] ?? "").toLowerCase();
      /* Use effectiveCatIdx so each item keeps its own label instead of "Other" */
      const cat = String(row[effectiveCatIdx >= 0 ? effectiveCatIdx : -1] ?? "").trim() || "Other";

      const absAmt = Math.abs(amt);

      /* Classify: explicit negative → expense; type/desc word match → income or expense */
      const isExp = amt < 0
        || /debit|expense|out\b|dr\b|spend|cost|purchase|fee/i.test(typeCell);
      const isInc = !isExp && amt > 0 && (
        /credit|income|in\b|cr\b/i.test(typeCell) ||
        /salary|payroll|wages|income|revenue|deposit|bonus|dividend|refund/i.test(descCell)
      );

      if (isInc) {
        income += absAmt;
      } else {
        expenses += absAmt;
        catMap[cat] = (catMap[cat] || 0) + absAmt;
      }
    });

    const netFlow  = income > 0 ? income - expenses : null;
    const savRate  = income > 0 ? ((income - expenses) / income) * 100 : null;
    const expRatio = income > 0 ? (expenses / income) * 100 : null;
    const cur      = report.currency || "";

    let changed = false;
    (report.kpis || []).forEach(kpi => {
      const lbl = kpi.label.toLowerCase();
      let newVal = null, newPos = kpi.positive;

      if (/total.*expense|expense.*total|\bspend(ing)?\b|\bexpenses\b/i.test(lbl) && expenses > 0)
        { newVal = fmtKpiLike(expenses, kpi.value, cur); newPos = false; }
      else if (income > 0 && /income|salary|revenue|earning/i.test(lbl))
        { newVal = fmtKpiLike(income, kpi.value, cur);   newPos = true; }
      else if (netFlow !== null && /net.*cash|cash.*flow|net.*income|net.*balance|net.*saving/i.test(lbl))
        { newVal = fmtKpiLike(netFlow, kpi.value, cur);  newPos = netFlow >= 0; }
      else if (savRate !== null && /saving.*rate|savings.*rate/i.test(lbl))
        { newVal = savRate.toFixed(1) + "%"; newPos = savRate >= 0; }
      else if (expRatio !== null && /ratio|expense.*income/i.test(lbl))
        { newVal = expRatio.toFixed(1) + "%"; newPos = expRatio <= 50; }

      if (newVal !== null && newVal !== kpi.value) {
        kpi.value = newVal; kpi.positive = newPos; kpi.estimated = false; changed = true;
      }
    });

    /* ── rebuild donut from category map ──
       Only replace if we have real per-item categories (i.e. effectiveCatIdx was
       found). If all we can produce is one big "Other" slice, keep the
       AI-generated donut untouched. */
    const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const hasRealCats = cats.length >= 2 || (cats.length === 1 && cats[0][0] !== "Other");
    if (hasRealCats) {
      const donut = (report.charts || []).find(c => c.type === "donut");
      if (donut) {
        donut.labels   = cats.map(([k]) => k);
        donut.datasets = [{ ...(donut.datasets?.[0] || {}), values: cats.map(([, v]) => v) }];
        changed = true;
      }
      /* Update category-style bar charts too */
      const catBar = (report.charts || []).find(c =>
        c.type === "bar" && c.datasets?.length === 1 &&
        /categor|spend|expense|breakdown/i.test(c.title || ""));
      if (catBar) {
        catBar.labels   = cats.map(([k]) => k);
        catBar.datasets = [{ ...(catBar.datasets?.[0] || {}), values: cats.map(([, v]) => v) }];
        changed = true;
      }
    }

    return changed;
  }

  /* Update KPI cards and chart SVGs in-place — no full re-render so the table
     keeps its cursor position while the user is typing. */
  function liveUpdateKpisAndCharts() {
    if (!currentReport) return;
    /* KPI cards */
    const cards = document.querySelectorAll("#finReport .fin-kpi-card");
    (currentReport.kpis || []).forEach((k, i) => {
      const card = cards[i];
      if (!card) return;
      const isNA = !k.value || k.value === "N/A" || k.value === "—";
      card.classList.toggle("fin-kpi-card--na", isNA);
      const valEl = card.querySelector(".fin-kpi-value");
      if (valEl && !valEl.isContentEditable) {
        const badge = k.estimated && !isNA
          ? `<span class="fin-kpi-estimated" title="Estimated">~</span>` : "";
        valEl.innerHTML = escHtml(k.value || "N/A") + badge;
      }
      /* update change arrow class */
      const chg = card.querySelector(".fin-kpi-change");
      if (chg) {
        chg.className = `fin-kpi-change ${isNA ? "na" : k.positive ? "up" : "down"}`;
      }
    });
    /* chart SVGs */
    (currentReport.charts || []).forEach(chart => {
      const svgId = "fin-svg-" + chart.id;
      const old   = document.getElementById(svgId);
      if (!old) return;
      let newSvgHtml = "";
      if      (chart.type === "bar")   newSvgHtml = renderBarChart(chart, svgId);
      else if (chart.type === "line")  newSvgHtml = renderLineChart(chart, svgId);
      else if (chart.type === "donut") newSvgHtml = renderDonutChart(chart, svgId);
      if (newSvgHtml) {
        const tmp = document.createElement("div");
        tmp.innerHTML = newSvgHtml;
        const newSvg = tmp.firstElementChild;
        if (newSvg) old.replaceWith(newSvg);
      }
    });
  }

  function setReportPath(path, value) {
    if (!currentReport || !path) return;
    const parts = path.split(".");
    let target = currentReport;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      if (target?.[key] == null) return;
      target = target[key];
    }
    const last = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
    if (target && last != null) target[last] = value;
  }

  function editedText(el) {
    return String(el.innerText || el.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function scheduleEditedReportPersist() {
    clearTimeout(editPersistTimer);
    editPersistTimer = setTimeout(() => {
      persistSession();
      updateStatus("Report edits saved");
    }, 250);
  }

  /* Wire editable cells in the table, including live recalc on input */
  function wireTableEditEvents(tableSection) {
    if (!tableSection || !reportEditMode) return;

    /* cell edits → recalc → live update */
    tableSection.querySelectorAll("td[data-edit-path]").forEach(td => {
      td.addEventListener("input", () => {
        setReportPath(td.dataset.editPath, editedText(td));
        /* reclassify this cell on the fly */
        if (Number(td.dataset.col) > 0) {
          td.className = classifyCell(editedText(td));
        }
        if (recalcFromTable(currentReport)) {
          liveUpdateKpisAndCharts();
        }
        scheduleEditedReportPersist();
      });
      td.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); td.blur(); }
        /* Tab → move to next cell */
        if (e.key === "Tab") {
          e.preventDefault();
          const cells = [...tableSection.querySelectorAll("td[data-edit-path]")];
          const idx = cells.indexOf(td);
          const next = cells[e.shiftKey ? idx - 1 : idx + 1];
          next?.focus();
        }
      });
      td.addEventListener("blur", () => {
        setReportPath(td.dataset.editPath, editedText(td));
        recalcFromTable(currentReport);
        liveUpdateKpisAndCharts();
        persistSession();
      });
    });

    /* header edits */
    tableSection.querySelectorAll("th[data-edit-path]").forEach(th => {
      th.addEventListener("input", () => setReportPath(th.dataset.editPath, editedText(th)));
      th.addEventListener("blur",  () => { setReportPath(th.dataset.editPath, editedText(th)); persistSession(); });
    });

    /* delete row buttons */
    tableSection.querySelectorAll(".fin-row-del-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const ri = Number(btn.dataset.delRow);
        if (!currentReport.table?.rows) return;
        currentReport.table.rows.splice(ri, 1);
        recalcFromTable(currentReport);
        refreshTableSection();
        liveUpdateKpisAndCharts();
        persistSession();
        updateStatus(`Row ${ri + 1} deleted · calculations updated`);
      });
    });

    /* add row button */
    tableSection.querySelector("#finTableAddRow")?.addEventListener("click", () => {
      const cols = currentReport.table?.headers?.length || 5;
      const empty = Array(cols).fill("");
      /* prefill first cell with today's date if first header looks like "date" */
      const firstH = (currentReport.table?.headers?.[0] || "").toLowerCase();
      if (/date/i.test(firstH)) {
        empty[0] = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      }
      currentReport.table.rows.push(empty);
      refreshTableSection();
      /* focus last row first editable cell */
      requestAnimationFrame(() => {
        const cells = document.querySelectorAll("#finTableSection td[data-edit-path]");
        const last = [...cells].slice(-cols)[0];
        last?.focus();
      });
      updateStatus("Row added · fill in details");
    });
  }

  function wireReportEditEvents(wrap) {
    wrap.querySelector("#finReportEditToggle")?.addEventListener("click", () => {
      const preview  = document.getElementById("finPreview");
      const scrollTop = preview?.scrollTop || 0;
      reportEditMode  = !reportEditMode;
      if (!reportEditMode) {
        persistSession();
        updateStatus("Edits saved · calculations locked");
      } else {
        updateStatus("Edit mode — changes recalculate live");
      }
      renderReport(currentReport);
      requestAnimationFrame(() => { if (preview) preview.scrollTop = scrollTop; });
    });
    if (!reportEditMode) return;

    /* non-table editables (title, subtitle, analysis, recs, KPI labels) */
    wrap.querySelectorAll("[data-edit-path]:not(#finTableSection [data-edit-path])").forEach(el => {
      el.addEventListener("input", () => {
        setReportPath(el.dataset.editPath, editedText(el));
        scheduleEditedReportPersist();
      });
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey && !el.dataset.editMultiline) {
          e.preventDefault(); el.blur();
        }
      });
      el.addEventListener("blur", () => {
        setReportPath(el.dataset.editPath, editedText(el));
        persistSession();
      });
    });

    /* table — separate handler with live recalc */
    wireTableEditEvents(wrap.querySelector("#finTableSection"));
  }

  function persistSession() {
    const s = activeSession();
    if (!s) return;
    s.messages = [...chatHistory];
    s.report   = currentReport;
    s.trace    = traceEntries.slice();
    s.ts       = Date.now();
    saveSessions();
  }

  /* ── chat messages ──────────────────────────────────────────────── */
  function renderMessages() {
    const el = document.getElementById("finMessages");
    if (!el) return;
    el.innerHTML = "";
    chatHistory.forEach(m => {
      if (m.role === "user") {
        appendMessage("user", m.displayContent || m.content);
      } else if (m.role === "assistant") {
        const display = m.displayContent || (() => {
          try {
            const p = JSON.parse(extractJson(m.content));
            if (p.mode === "chat") return p.message || "";
            if (p.mode === "clarify") return formatClarifyBubble(p);
            return summarizeReport(p);
          } catch { return "Response generated."; }
        })();
        appendMessage("ai", display);
      }
    });
  }

  async function regenerateLast(msgDiv) {
    const send = document.getElementById("finSend");
    if (send?.disabled) return;
    // Strip last assistant entry from history
    let lastAiIdx = -1;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === "assistant") { lastAiIdx = i; break; }
    }
    if (lastAiIdx >= 0) chatHistory.splice(lastAiIdx, 1);
    msgDiv?.remove();
    send.disabled = true;
    const thinkId = appendThinking();
    setStatusDot("active");
    updateStatus("Regenerating…");
    traceAdd("Run", "Regenerating last response", "run");
    abortCtrl = new AbortController();
    let raw = "";
    try {
      const msgs = [{ role: "system", content: systemPrompt() }, ...chatHistory.map(toProviderMessage)];
      await callModel(msgs, (chunk) => { raw += chunk; }, abortCtrl.signal);
    } catch (err) {
      removeThinking(thinkId);
      if (err?.name !== "AbortError") {
        traceAdd("Run", "Regeneration failed", "err", err?.message || String(err));
        appendMessage("ai", "Error: " + (err?.message || err));
        setStatusDot("error"); updateStatus("Regeneration failed");
      } else { setStatusDot(""); updateStatus("Ready"); }
      send.disabled = false; return;
    }
    handleAgentResponse(raw, thinkId, send);
    if (raw.trim()) updateStatus("Regenerated");
  }

  function appendMessage(role, text) {
    const el = document.getElementById("finMessages");
    if (!el) return null;
    const isUser = role === "user";
    const div = document.createElement("div");
    div.className = `fin-msg ${isUser ? "fin-msg--user" : "fin-msg--ai"}`;
    div.innerHTML = isUser
      ? `<div class="fin-msg-bubble">${escHtml(text)}</div>`
      : `<div class="fin-msg-bubble">${markdownToHtml(text)}</div>`;

    // ── action buttons ──
    const acts = document.createElement("div");
    acts.className = "fin-msg-actions";

    // Copy
    const copyBtn = document.createElement("button");
    copyBtn.className = "fin-msg-action";
    copyBtn.title = "Copy";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard?.writeText(text).catch(() => {});
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => { copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"/></svg>`; }, 1400);
    });
    acts.appendChild(copyBtn);

    if (isUser) {
      // Re-use prompt
      const reuseBtn = document.createElement("button");
      reuseBtn.className = "fin-msg-action";
      reuseBtn.title = "Edit & resend";
      reuseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
      reuseBtn.addEventListener("click", () => {
        const input = document.getElementById("finInput");
        if (!input) return;
        input.value = text;
        input.focus();
        autosize(input);
      });
      acts.appendChild(reuseBtn);
    } else {
      // Regenerate
      const regenBtn = document.createElement("button");
      regenBtn.className = "fin-msg-action fin-msg-action--regen";
      regenBtn.title = "Regenerate";
      regenBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.68"/></svg>`;
      regenBtn.addEventListener("click", () => regenerateLast(div));
      acts.appendChild(regenBtn);
    }

    div.appendChild(acts);
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function appendThinking() {
    const el = document.getElementById("finMessages");
    if (!el) return null;
    const id = "fin-think-" + Date.now();
    const div = document.createElement("div");
    div.className = "fin-msg fin-msg--ai";
    div.id = id;
    div.innerHTML = `<div class="fin-msg-bubble"><div class="fin-thinking-dots"><span></span><span></span><span></span></div></div>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return id;
  }

  function removeThinking(id) {
    if (id) document.getElementById(id)?.remove();
  }

  /* ── report rendering ───────────────────────────────────────────── */
  function renderReport(r) {
    const wrap = document.getElementById("finReport");
    if (!wrap) return;
    currentReport = r;
    hideEmpty();
    wrap.style.display = "";
    wrap.classList.toggle("editing", reportEditMode);

    wrap.innerHTML = `
      <div class="fin-report-header">
        <div class="fin-report-titles">
          <h2 class="fin-report-title" ${editAttr("title")}>${escHtml(r.title)}</h2>
          <div class="fin-report-subtitle">
            <span class="fin-report-sub-text" ${editAttr("subtitle")}>${escHtml(r.subtitle)}</span>
            ${r.currency ? `<span class="fin-report-pill" ${editAttr("currency")}>${escHtml(r.currency)}</span>` : ""}
          </div>
        </div>
        <div class="fin-report-actions">
          <button class="fin-report-edit-btn${reportEditMode ? " active" : ""}" id="finReportEditToggle" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            ${reportEditMode ? "Done" : "Edit Data"}
          </button>
        </div>
      </div>

      <div class="fin-kpi-grid">
        ${(r.kpis || []).map((k, i) => renderKpi(k, i)).join("")}
      </div>

      ${(r.charts || []).map(c => renderChart(c)).join("")}

      ${r.table ? renderTable(r.table) : ""}

      <div class="fin-analysis-section">
        <div class="fin-analysis-card">
          <div class="fin-analysis-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Analysis
          </div>
          <p class="fin-analysis-text" ${editAttr("analysis", true)}>${escHtml(r.analysis || "")}</p>
        </div>
      </div>

      ${r.recommendations?.length ? `
      <div class="fin-analysis-section">
        <div class="fin-analysis-card">
          <div class="fin-analysis-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Recommendations
          </div>
          <div class="fin-recos">
            ${r.recommendations.map((rec, i) => `
            <div class="fin-reco-item">
              <span class="fin-reco-num">${i + 1}</span>
              <span ${editAttr(`recommendations.${i}`, true)}>${escHtml(rec)}</span>
            </div>`).join("")}
          </div>
        </div>
      </div>` : ""}

      <div class="fin-export-bar">
        <span class="fin-export-label">Export</span>
        <button class="fin-export-btn fin-export-btn--pdf" id="finExportPdf">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3z"/><path d="M14 13h2"/><path d="M14 16h2"/></svg>
          PDF
        </button>
        <button class="fin-export-btn" id="finExportJson">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          JSON
        </button>
        <button class="fin-export-btn" id="finExportCsv">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
          CSV
        </button>
        ${(r.charts || []).map(c => `
        <button class="fin-export-btn" data-svgid="fin-svg-${c.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${escHtml(c.title.slice(0, 14))} PNG
        </button>`).join("")}
      </div>
    `;

    wireReportEditEvents(wrap);
    wrap.querySelector("#finExportPdf")?.addEventListener("click",  () => exportPdf(r));
    wrap.querySelector("#finExportJson")?.addEventListener("click", () => exportJson(r));
    wrap.querySelector("#finExportCsv")?.addEventListener("click",  () => exportCsv(r));
    wrap.querySelectorAll(".fin-export-btn[data-svgid]").forEach(btn => {
      btn.addEventListener("click", () => downloadChart(btn.dataset.svgid));
    });
    wrap.querySelectorAll(".fin-chart-dl").forEach(btn => {
      btn.addEventListener("click", () => downloadChart(btn.dataset.svgid));
    });

    document.getElementById("finPreview")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ── KPI card ───────────────────────────────────────────────────── */
  const KPI_ICONS = {
    revenue: `<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
    profit:  `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
    cost:    `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    growth:  `<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>`,
    cash:    `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/><circle cx="12" cy="14" r="2"/>`,
    burn:    `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
    margin:  `<path d="M12 2v20"/><path d="M2 12h20"/><path d="M2 6l10 6 10-6"/>`,
    users:   `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    orders:  `<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>`,
    debt:    `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
  };
  const KPI_COLORS = ["#10b981","#6366f1","#f59e0b","#f43f5e","#06b6d4","#a78bfa"];

  function renderKpi(k, i = 0) {
    const ki  = Object.keys(KPI_ICONS).indexOf(k.icon || "revenue");
    const col = KPI_COLORS[Math.max(ki, 0) % KPI_COLORS.length];
    const icon = KPI_ICONS[k.icon] || KPI_ICONS.revenue;
    const isNA = !k.value || k.value === "N/A" || k.value === "—";
    const estimatedBadge = k.estimated && !isNA
      ? `<span class="fin-kpi-estimated" title="Estimated value">~</span>` : "";
    const arrow = isNA ? "" : k.positive
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;
    const changeClass = isNA ? "na" : k.positive ? "up" : "down";
    const changeText = isNA ? "—" : (k.change || "");
    return `
      <div class="fin-kpi-card${isNA ? " fin-kpi-card--na" : ""}" style="--kpi-color:${col};--kpi-fade:${col}18">
        <div class="fin-kpi-top">
          <div class="fin-kpi-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">${icon}</svg>
          </div>
          <span class="fin-kpi-change ${changeClass}">${arrow}<span ${editAttr(`kpis.${i}.change`)}>${escHtml(changeText)}</span></span>
        </div>
        <span class="fin-kpi-label" ${editAttr(`kpis.${i}.label`)}>${escHtml(k.label)}</span>
        <span class="fin-kpi-value" ${editAttr(`kpis.${i}.value`)}>${escHtml(k.value || "N/A")}${estimatedBadge}</span>
      </div>`;
  }

  /* ── chart dispatcher ───────────────────────────────────────────── */
  function renderChart(c) {
    const svgId   = "fin-svg-" + c.id;
    let chartHtml = "";
    if      (c.type === "bar")   chartHtml = renderBarChart(c, svgId);
    else if (c.type === "line")  chartHtml = renderLineChart(c, svgId);
    else if (c.type === "donut") chartHtml = renderDonutChart(c, svgId);
    else                          chartHtml = renderBarChart(c, svgId);

    return `
      <div class="fin-chart-section">
        <div class="fin-chart-title" ${editAttr(`charts.${(currentReport?.charts || []).indexOf(c)}.title`)}>${escHtml(c.title)}</div>
        <div class="fin-chart-wrap">
          ${chartHtml}
          <button class="fin-chart-dl" data-svgid="${svgId}" title="Download PNG">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>`;
  }

  /* ── bar chart ──────────────────────────────────────────────────── */
  function renderBarChart(c, svgId) {
    const W = 600, H = 300, padL = 56, padR = 20, padT = 28, padB = 52;
    const labels   = c.labels   || [];
    const datasets = c.datasets || [];
    const n        = labels.length;
    if (!n) return "";

    const allVals = datasets.flatMap(d => d.values || []);
    const maxV    = Math.max(...allVals, 1);
    const minV    = Math.min(0, ...allVals);
    const range   = maxV - minV || 1;
    const plotW   = W - padL - padR;
    const plotH   = H - padT - padB;
    const groupW  = plotW / n;
    const barW    = Math.max(6, (groupW * 0.72) / datasets.length);
    const gapBetween = (groupW * 0.28) / (datasets.length + 1);

    /* grid + Y-axis labels */
    let gridLines = "", yLabels = "";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4);
      const y = padT + plotH - (plotH * (v - minV) / range);
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(100,116,139,.10)" stroke-width="1"/>`;
      yLabels   += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${formatNum(v)}</text>`;
    }
    const zeroY = padT + plotH - (plotH * (0 - minV) / range);
    gridLines += `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="rgba(100,116,139,.28)" stroke-width="1"/>`;

    /* bars + value labels on top */
    let bars = "", valLabels = "", legend = "";
    datasets.forEach((ds, di) => {
      const col = ds.color || COLORS[di % COLORS.length];
      (ds.values || []).forEach((v, vi) => {
        const x   = padL + vi * groupW + gapBetween * (di + 1) + di * barW;
        const bH  = Math.max(2, Math.abs(plotH * v / range));
        const y   = v >= 0 ? zeroY - bH : zeroY;
        const cx  = x + barW / 2;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" rx="3" fill="${col}" opacity=".88"/>`;
        /* value label — show if bar is wide enough (skip tiny bars) */
        if (barW >= 14) {
          const lbl  = formatNum(v);
          const ly   = v >= 0 ? y - 5 : y + bH + 13;
          valLabels += `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${escHtml(lbl)}</text>`;
        }
      });
      if (datasets.length > 1) {
        legend += `<g transform="translate(${padL + di * 130},${H - 12})">
          <rect x="0" y="-8" width="10" height="10" rx="2" fill="${col}"/>
          <text x="14" y="0" font-size="10" fill="#94a3b8">${escHtml(ds.label)}</text>
        </g>`;
      }
    });

    /* X-axis labels */
    let xLabels = "";
    labels.forEach((lbl, i) => {
      const x = padL + i * groupW + groupW / 2;
      /* truncate long labels */
      const short = lbl.length > 10 ? lbl.slice(0, 9) + "…" : lbl;
      xLabels += `<text x="${x.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${escHtml(short)}</text>`;
    });

    return `<svg id="${svgId}" class="fin-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0b0f1c" rx="10"/>
      ${gridLines}${yLabels}${bars}${valLabels}${xLabels}${legend}
    </svg>`;
  }

  /* ── line chart ─────────────────────────────────────────────────── */
  function renderLineChart(c, svgId) {
    const W = 600, H = 300, padL = 56, padR = 20, padT = 32, padB = 52;
    const labels   = c.labels   || [];
    const datasets = c.datasets || [];
    const n        = labels.length;
    if (!n) return "";

    const allVals = datasets.flatMap(d => d.values || []);
    const maxV    = Math.max(...allVals, 1);
    const minV    = Math.min(0, ...allVals);
    const range   = maxV - minV || 1;
    const plotW   = W - padL - padR;
    const plotH   = H - padT - padB;

    /* grid + Y-axis */
    let gridLines = "", yLabels = "";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4);
      const y = padT + plotH - (plotH * (v - minV) / range);
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(100,116,139,.10)" stroke-width="1"/>`;
      yLabels   += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${formatNum(v)}</text>`;
    }

    let paths = "", dots = "", dotLabels = "", legend = "", defs = "";
    datasets.forEach((ds, di) => {
      const col  = ds.color || COLORS[di % COLORS.length];
      const vals = ds.values || [];
      const pts  = vals.map((v, i) => ({
        v,
        x: padL + (i / (n - 1 || 1)) * plotW,
        y: padT + plotH - (plotH * (v - minV) / range),
      }));
      if (!pts.length) return;
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const mx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
        d += ` C ${mx} ${pts[i-1].y.toFixed(1)}, ${mx} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
      }
      const zeroY  = Math.min(padT + plotH, Math.max(padT, padT + plotH - (plotH * (0 - minV) / range)));
      const areaD  = d + ` L ${pts[pts.length-1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
      const gradId = `lg${di}${svgId.replace(/[^a-z0-9]/gi, "")}`;
      defs  += `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity=".20"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient>`;
      paths += `<path d="${areaD}" fill="url(#${gradId})"/><path d="${d}" stroke="${col}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

      /* dots + value labels — alternate above/below to reduce overlap */
      pts.forEach((pt, pi) => {
        dots += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="${col}" stroke="#0b0f1c" stroke-width="1.5"/>`;
        const above = pi % 2 === 0;
        const ly    = above ? pt.y - 10 : pt.y + 18;
        const lbl   = formatNum(pt.v);
        /* pill background */
        const lblW  = lbl.length * 5.5 + 6;
        dotLabels  += `<rect x="${(pt.x - lblW / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${lblW.toFixed(1)}" height="13" rx="3" fill="#0b0f1c" opacity=".72"/>`;
        dotLabels  += `<text x="${pt.x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${escHtml(lbl)}</text>`;
      });

      if (datasets.length > 1) {
        legend += `<g transform="translate(${padL + di * 130},${H - 12})"><line x1="0" y1="-4" x2="14" y2="-4" stroke="${col}" stroke-width="2.2"/><text x="18" y="0" font-size="10" fill="#94a3b8">${escHtml(ds.label)}</text></g>`;
      }
    });

    let xLabels = "";
    labels.forEach((lbl, i) => {
      const x     = padL + (i / (n - 1 || 1)) * plotW;
      const short = lbl.length > 10 ? lbl.slice(0, 9) + "…" : lbl;
      xLabels += `<text x="${x.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${escHtml(short)}</text>`;
    });

    return `<svg id="${svgId}" class="fin-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>${defs}</defs>
      <rect width="${W}" height="${H}" fill="#0b0f1c" rx="10"/>
      ${gridLines}${yLabels}${paths}${dots}${dotLabels}${xLabels}${legend}
    </svg>`;
  }

  /* ── donut chart ────────────────────────────────────────────────── */
  function renderDonutChart(c, svgId) {
    const W = 620, H = 300;
    const cx = 148, cy = 150, r = 96, sw = 36;
    const labels = c.labels || [];
    const vals   = (c.datasets?.[0]?.values || []).map(Number).filter(v => v > 0);
    if (!vals.length) return "";

    /* If values look like percentages treat as display-only %.
       Criteria: sum within 1% of 100 AND at least half the values have decimal parts
       (real money amounts are almost never all between 0-100 AND sum to exactly 100). */
    const sum         = vals.reduce((a, b) => a + b, 0);
    const nearHundred = sum > 99 && sum < 101;
    const hasDecimals = vals.filter(v => v % 1 !== 0).length >= vals.length / 2;
    const looksLikePct = nearHundred && (hasDecimals || vals.every(v => v < 100));
    const total        = looksLikePct ? sum : (sum || 1);
    const circ         = 2 * Math.PI * r;

    /* Sort by value descending so largest segment starts at top */
    const sorted = vals.map((v, i) => ({ v, label: labels[i] || "", idx: i }))
                       .sort((a, b) => b.v - a.v);

    let offset = 0, segments = "", legend = "";
    sorted.forEach(({ v, label, idx }, si) => {
      const col  = COLORS[idx % COLORS.length];
      const pct  = v / total;
      const dash = pct * circ;
      const gap  = circ - dash;
      const rot  = offset * 360 - 90;
      /* slightly separate segments with a tiny gap */
      const gapPx = Math.max(0.5, circ * 0.006);
      segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"
        stroke-dasharray="${Math.max(0, dash - gapPx).toFixed(2)} ${(gap + gapPx).toFixed(2)}"
        transform="rotate(${rot.toFixed(2)} ${cx} ${cy})" opacity=".92"/>`;
      offset += pct;

      /* legend row */
      const lx  = cx * 2 + 20;
      const ly  = 36 + si * 34;
      const amt = looksLikePct ? "" : ` · ${formatNum(v)}`;
      legend += `
        <rect x="${lx}" y="${ly - 10}" width="12" height="12" rx="3" fill="${col}"/>
        <text x="${lx + 18}" y="${ly}" font-size="11.5" fill="#e2e8f0">${escHtml(label)}</text>
        <text x="${W - 14}" y="${ly}" text-anchor="end" font-size="11.5" fill="${col}" font-weight="700">${(pct * 100).toFixed(1)}%${escHtml(amt)}</text>`;
    });

    /* center: show total amount (or % sum) */
    const centerTotal   = looksLikePct ? "100%" : formatNum(total);
    /* largest category label, truncated */
    const topLabel      = (sorted[0]?.label || "").slice(0, 10);
    const centerLabel   = `
      <text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="10.5" fill="#64748b" letter-spacing="0.5">TOTAL</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="22" fill="#f1f5f9" font-weight="800">${escHtml(centerTotal)}</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="9.5" fill="#64748b">${escHtml(topLabel)}</text>`;

    return `<svg id="${svgId}" class="fin-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0b0f1c" rx="10"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(100,116,139,.10)" stroke-width="${sw}"/>
      ${segments}${centerLabel}${legend}
    </svg>`;
  }

  /* ── data table ─────────────────────────────────────────────────── */
  function renderTable(t) {
    const cols = t.headers || [];
    const rows = t.rows    || [];
    const delCol = reportEditMode
      ? `<th class="fin-th-del" title="Remove row"></th>` : "";
    const addRowBtn = reportEditMode ? `
      <div class="fin-table-add-row">
        <button class="fin-table-add-btn" id="finTableAddRow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" width="11" height="11">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Row
        </button>
      </div>` : "";
    return `
      <div class="fin-table-section" id="finTableSection">
        <div class="fin-table-head">
          <span class="fin-table-title" ${editAttr("table.title")}>${escHtml(t.title)}</span>
          ${reportEditMode ? `<span class="fin-table-edit-hint">Edit cells · changes recalculate live</span>` : ""}
        </div>
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead><tr>
              ${cols.map((h, hi) => `<th ${editAttr(`table.headers.${hi}`)}>${escHtml(h)}</th>`).join("")}
              ${delCol}
            </tr></thead>
            <tbody>
              ${rows.map((row, ri) => `
              <tr data-row-idx="${ri}">
                ${row.map((cell, ci) => {
                  const cls = ci > 0 ? classifyCell(cell) : "";
                  return `<td class="${cls}" ${editAttr(`table.rows.${ri}.${ci}`)}
                    data-row="${ri}" data-col="${ci}">${escHtml(String(cell))}</td>`;
                }).join("")}
                ${reportEditMode ? `<td class="fin-td-del">
                  <button class="fin-row-del-btn" data-del-row="${ri}" title="Delete row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round" width="10" height="10">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </td>` : ""}
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        ${addRowBtn}
      </div>`;
  }

  /* Re-render only the table section and re-wire its events */
  function refreshTableSection() {
    const section = document.getElementById("finTableSection");
    if (!section || !currentReport?.table) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = renderTable(currentReport.table);
    section.replaceWith(tmp.firstElementChild);
    wireTableEditEvents(document.getElementById("finTableSection"));
  }

  function classifyCell(val) {
    const s = String(val).replace(/[%,$€£\s]/g, "");
    const n = parseFloat(s);
    if (isNaN(n)) return "";
    if (s.startsWith("-") || n < 0) return "fin-td-negative";
    if (n > 0) return "fin-td-positive";
    return "";
  }

  /* ── export ─────────────────────────────────────────────────────── */
  function exportJson(r) {
    downloadBlob(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
      (r.title || "finance").replace(/\s+/g, "-").toLowerCase() + ".json");
  }

  function exportCsv(r) {
    if (!r.table) return;
    const lines = [r.table.headers.join(","), ...r.table.rows.map(row =>
      row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(","))];
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }),
      (r.table.title || "table").replace(/\s+/g, "-").toLowerCase() + ".csv");
  }

  /* ── PDF export ─────────────────────────────────────────────────── */
  async function loadJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload  = () => resolve(window.jspdf?.jsPDF);
      s.onerror = () => reject(new Error("jsPDF failed to load"));
      document.head.appendChild(s);
    });
  }

  function svgToDataUrl(svgId) {
    const svg = document.getElementById(svgId);
    if (!svg) return Promise.resolve(null);
    const w = svg.viewBox?.baseVal?.width  || 620;
    const h = svg.viewBox?.baseVal?.height || 300;

    /* Clone and add required namespaces so the SVG is valid as a standalone doc */
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns",       "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width",  String(w));
    clone.setAttribute("height", String(h));
    const svgStr = new XMLSerializer().serializeToString(clone);

    return new Promise(resolve => {
      /* Use Blob URL — Tauri/WebKit blocks data:image/svg+xml as img src */
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image(w * 2, h * 2);
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = w * 2; c.height = h * 2;
        try {
          c.getContext("2d").drawImage(img, 0, 0, w * 2, h * 2);
          resolve({ dataUrl: c.toDataURL("image/png"), w, h });
        } catch (_) { resolve(null); }
        URL.revokeObjectURL(blobUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
      img.src = blobUrl;
    });
  }

  /* Sanitise text for jsPDF — removes chars outside WinAnsi to prevent
     the courier-font fallback that causes monospace / crumbled text */
  function pdfSafe(s) {
    return String(s || "")
      .replace(/[‘’‚‛]/g, "'")   // curly single quotes
      .replace(/[“”„‟]/g, '"')   // curly double quotes
      .replace(/[–—―]/g,       "-")   // en-dash / em-dash
      .replace(/…/g,                     "...") // ellipsis
      .replace(/ /g,                     " ")   // non-breaking space
      .replace(/[^\x00-\xFF]/g,               "");   // strip anything else outside Latin-1
  }

  async function exportPdf(r) {
    const btn = document.getElementById("finExportPdf");
    if (btn) { btn.textContent = "Building…"; btn.disabled = true; }

    let JsPDF;
    try { JsPDF = await loadJsPdf(); }
    catch {
      alert("Could not load PDF library. Check your internet connection.");
      if (btn) { btn.textContent = "PDF"; btn.disabled = false; }
      return;
    }

    const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const PW = 210, PH = 297;
    const ML = 16, MR = 16;          // left / right margin
    const CW = PW - ML - MR;         // content width  = 178 mm
    const FOOTER_H = 12;
    const BODY_BOTTOM = PH - FOOTER_H - 4;
    let y = 0;

    /* ── palette ── */
    const C = {
      bg:     [11,  15,  28],
      accent: [16,  185, 129],
      red:    [220, 38,  38],
      amber:  [217, 119, 6],
      text:   [15,  23,  42],
      sub:    [71,  85,  105],
      muted:  [148, 163, 184],
      white:  [255, 255, 255],
      stripe: [248, 250, 252],
      border: [226, 232, 240],
    };

    /* ── low-level helpers ── */
    const sf  = (sz, wt = "normal", col = C.text) => {
      doc.setFontSize(sz);
      doc.setFont("helvetica", wt);
      doc.setTextColor(...col);
    };
    const fc  = col => doc.setFillColor(...col);
    const sc  = (col, lw = 0.25) => { doc.setDrawColor(...col); doc.setLineWidth(lw); };

    /* Advance y if not enough room, adding a new page first */
    const need = h => {
      if (y + h > BODY_BOTTOM) { addFooter(); doc.addPage(); y = 20; }
    };

    /* Section header pill */
    const section = label => {
      need(14);
      fc(C.border); doc.rect(ML, y, CW, 6.5, "F");
      sf(7.5, "bold", C.sub);
      doc.text(pdfSafe(label.toUpperCase()), ML + 3, y + 4.5);
      y += 10;
    };

    /* Wrapped text block — respects page breaks line-by-line */
    const textBlock = (text, x, maxW, sz, wt, col, lineH = 5.4) => {
      sf(sz, wt, col);
      const lines = doc.splitTextToSize(pdfSafe(text), maxW);
      lines.forEach(line => {
        need(lineH + 1);
        doc.text(line, x, y, { maxWidth: maxW });
        y += lineH;
      });
    };

    /* ─────────────────────────────────────────────────
       PAGE 1 HEADER (dark navy banner)
    ───────────────────────────────────────────────── */
    fc(C.bg);     doc.rect(0,   0,   PW, 52, "F");
    fc(C.accent); doc.rect(0,   0,   4,  52, "F");   // left accent bar

    /* "Finance AI" brand */
    sf(18, "bold", C.white);
    doc.text("Finance", ML + 2, 20);
    doc.setTextColor(...C.accent);
    doc.text("AI", ML + 32, 20);

    /* Report title (capped to 1 line) */
    sf(12, "bold", C.white);
    const titleStr = pdfSafe(r.title || "Financial Report");
    doc.text(doc.splitTextToSize(titleStr, CW - 55)[0], ML + 2, 31);

    /* subtitle */
    sf(8, "normal", C.muted);
    doc.text(pdfSafe(r.subtitle || ""), ML + 2, 38, { maxWidth: CW - 55 });

    /* date + currency (right-aligned) */
    const dateStr = new Date().toLocaleDateString("en-US",
      { year: "numeric", month: "long", day: "numeric" });
    sf(7.5, "normal", C.muted);
    doc.text(pdfSafe("Generated " + dateStr),            PW - MR, 31, { align: "right" });
    doc.text(pdfSafe("Currency: " + (r.currency || "-")), PW - MR, 38, { align: "right" });

    y = 57;

    /* data sources */
    if (r.data_sources?.length) {
      sf(7, "italic", C.sub);
      const srcLine = pdfSafe("Sources: " + r.data_sources.join("  ·  "));
      doc.text(srcLine, ML, y, { maxWidth: CW });
      y += 7;
    }

    /* ─────────────────────────────────────────────────
       KPI GRID  (3 per row)
    ───────────────────────────────────────────────── */
    if (r.kpis?.length) {
      section("Key Performance Indicators");
      const COLS = Math.min(r.kpis.length, 3);
      const KW   = (CW - (COLS - 1) * 4) / COLS;
      const KH   = 22;
      const GAP  = 4;

      /* Calculate total rows first so we can checkY for the whole grid */
      const totalKpiRows = Math.ceil(r.kpis.length / COLS);
      need(totalKpiRows * (KH + GAP) + 4);

      r.kpis.forEach((k, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const kx  = ML + col * (KW + GAP);
        const ky  = y  + row * (KH + GAP);

        /* card background */
        fc(C.stripe); doc.roundedRect(kx, ky, KW, KH, 2, 2, "F");
        sc(C.border, 0.2); doc.roundedRect(kx, ky, KW, KH, 2, 2, "S");

        /* label */
        sf(6, "bold", C.sub);
        doc.text(pdfSafe((k.label || "").toUpperCase()), kx + 3, ky + 6.5, { maxWidth: KW - 6 });

        /* value */
        const isNA = !k.value || k.value === "N/A" || k.value === "-";
        sf(12, "bold", isNA ? C.sub : C.text);
        doc.text(pdfSafe(k.value || "N/A"), kx + 3, ky + 17, { maxWidth: KW - 6 });

        /* change badge (top-right) */
        if (!isNA && k.change && k.change !== "-") {
          sf(7, "bold", k.positive ? C.accent : C.red);
          doc.text(pdfSafe(k.change), kx + KW - 3, ky + 6.5, { align: "right" });
        }

        /* estimated marker */
        if (k.estimated && !isNA) {
          sf(6, "italic", C.amber);
          doc.text("~est.", kx + KW - 3, ky + 17, { align: "right" });
        }
      });
      y += totalKpiRows * (KH + GAP) + 6;
    }

    /* ─────────────────────────────────────────────────
       CHARTS
    ───────────────────────────────────────────────── */
    if ((r.charts || []).length) {
      section("Charts & Visualisations");
      for (const chart of r.charts) {
        const result = await svgToDataUrl("fin-svg-" + chart.id);
        if (!result) continue;
        const { dataUrl, w, h } = result;
        const aspect = h / w;
        const imgW   = CW;
        const imgH   = Math.min(imgW * aspect, 74);
        need(imgH + 16);
        sf(8.5, "bold", C.text);
        doc.text(pdfSafe(chart.title || ""), ML, y); y += 5;
        doc.addImage(dataUrl, "PNG", ML, y, imgW, imgH);
        y += imgH + 8;
      }
      y += 2;
    }

    /* ─────────────────────────────────────────────────
       TRANSACTIONS TABLE
    ───────────────────────────────────────────────── */
    if (r.table?.headers?.length && r.table?.rows?.length) {
      section(pdfSafe(r.table.title || "Transaction Detail"));
      const headers = r.table.headers;
      const rows    = r.table.rows;

      /* Column widths: amount col fixed 28mm, others share remainder */
      const AMT_W    = 28;
      const DATE_W   = 26;
      const nOther   = Math.max(headers.length - 2, 1);
      const otherW   = (CW - AMT_W - DATE_W) / nOther;
      const colWidths = headers.map((_, hi) => {
        if (hi === headers.length - 1) return AMT_W;
        if (hi === 0)                  return DATE_W;
        return otherW;
      });
      const ROW_H = 6.5;

      /* Table header */
      need(ROW_H + 2);
      fc([30, 41, 59]); doc.rect(ML, y, CW, ROW_H, "F");
      sf(6.5, "bold", C.white);
      let cx = ML;
      headers.forEach((h, hi) => {
        const isLast = hi === headers.length - 1;
        const tx     = isLast ? cx + colWidths[hi] - 2 : cx + 2;
        doc.text(pdfSafe(String(h)), tx, y + 4.3,
          { align: isLast ? "right" : "left", maxWidth: colWidths[hi] - 3 });
        cx += colWidths[hi];
      });
      y += ROW_H;

      /* Data rows */
      rows.forEach((row, ri) => {
        need(ROW_H + 1);
        if (ri % 2 === 0) { fc(C.stripe); doc.rect(ML, y, CW, ROW_H, "F"); }
        let rx = ML;
        row.forEach((cell, ci) => {
          const txt   = pdfSafe(String(cell ?? ""));
          const isAmt = ci === row.length - 1;
          const neg   = isAmt && (txt.startsWith("-") || /debit|expense/i.test(txt));
          const pos   = isAmt && (txt.startsWith("+") || /credit|income/i.test(txt));
          sf(6.5, isAmt ? "bold" : "normal", neg ? C.red : pos ? C.accent : C.text);
          const tx = isAmt ? rx + colWidths[ci] - 2 : rx + 2;
          doc.text(txt, tx, y + 4.3,
            { align: isAmt ? "right" : "left", maxWidth: colWidths[ci] - 3 });
          rx += colWidths[ci];
        });
        sc(C.border, 0.1); doc.line(ML, y + ROW_H, ML + CW, y + ROW_H);
        y += ROW_H;
      });
      y += 6;
    }

    /* ─────────────────────────────────────────────────
       ANALYSIS
    ───────────────────────────────────────────────── */
    if (r.analysis) {
      section("Analysis");
      textBlock(r.analysis, ML, CW - 2, 9, "normal", C.text, 5.5);
      y += 5;
    }

    /* ─────────────────────────────────────────────────
       RECOMMENDATIONS
    ───────────────────────────────────────────────── */
    if (r.recommendations?.length) {
      section("Recommendations");
      r.recommendations.forEach((rec, i) => {
        /* Estimate height needed for this rec */
        sf(9, "normal", C.text);
        const recLines = doc.splitTextToSize(pdfSafe(rec), CW - 14);
        const recH     = recLines.length * 5.5 + 7;
        need(recH);

        /* numbered circle */
        fc(C.accent); doc.circle(ML + 4, y + 3, 3.4, "F");
        sf(7, "bold", C.white);
        doc.text(String(i + 1), ML + 4, y + 3 + 2.6, { align: "center" });

        /* recommendation text */
        sf(9, "normal", C.text);
        recLines.forEach((line, li) => {
          doc.text(line, ML + 10, y + li * 5.5 + 1.5, { maxWidth: CW - 14 });
        });
        y += recH;
      });
    }

    /* ─────────────────────────────────────────────────
       FOOTER  (stamp every page)
    ───────────────────────────────────────────────── */
    function addFooter() {
      const pg = doc.internal.getCurrentPageInfo().pageNumber;
      fc(C.stripe);     doc.rect(0, PH - FOOTER_H, PW, FOOTER_H, "F");
      sc(C.border, 0.2); doc.line(0, PH - FOOTER_H, PW, PH - FOOTER_H);
      sf(6.5, "normal", C.sub);
      doc.text(
        "HashCortX FinanceAI  ·  For informational purposes only  ·  Not financial advice",
        ML, PH - 4, { maxWidth: CW - 20 }
      );
      doc.text("Page " + pg, PW - MR, PH - 4, { align: "right" });
    }

    /* Stamp footer on all pages */
    const nPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= nPages; p++) { doc.setPage(p); addFooter(); }

    /* ── save ── */
    const fname = pdfSafe(r.title || "finance-report")
      .replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "-").toLowerCase() + ".pdf";
    doc.save(fname || "finance-report.pdf");
    if (btn) { btn.textContent = "PDF"; btn.disabled = false; }
  }

  function downloadChart(svgId) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    const w = svg.viewBox?.baseVal?.width  || 600;
    const h = svg.viewBox?.baseVal?.height || 280;
    const img = new Image(w * 2, h * 2);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = w * 2; canvas.height = h * 2;
      canvas.getContext("2d").drawImage(img, 0, 0, w * 2, h * 2);
      canvas.toBlob(blob => { if (blob) downloadBlob(blob, svgId + ".png"); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ── helpers ────────────────────────────────────────────────────── */
  function hideEmpty() {
    const e = document.getElementById("finEmpty");
    if (e) e.style.display = "none";
  }
  function hideReport() {
    const r = document.getElementById("finReport");
    if (r) r.style.display = "none";
    const e = document.getElementById("finEmpty");
    if (e) e.style.display = "";
  }

  function updateStatus(msg) {
    const el = document.getElementById("finStatusText");
    if (el) el.textContent = msg;
  }
  function setStatusDot(state) {
    const dot = document.getElementById("finStatusDot");
    if (!dot) return;
    dot.className = "fin-status-dot" + (state ? " " + state : "");
  }

  function formatNum(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return v.toFixed(a < 1 ? 2 : 0);
  }

  function escHtml(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function markdownToHtml(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n\n/g, "<br><br>")
      .replace(/\n/g, "<br>");
  }

  function relTime(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60)    return "just now";
    if (d < 3600)  return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    return Math.floor(d / 86400) + "d ago";
  }

  /* ── public API ─────────────────────────────────────────────────── */
  function mount() {
    const wrap = document.getElementById("finance-wrap");
    if (!wrap) return;
    loadSessions();
    if (mounted) {
      populateFinModelPicker();
      return;
    }
    mounted = true;
    buildShell(wrap);
    wireEvents(wrap);
    if (!traceEntries.length) traceAdd("Mode", "Finance mode mounted", "ok");
    renderTraceEntries();
    populateFinModelPicker();
  }

  function destroy() {
    abortCtrl?.abort();
    abortCtrl = null;
    pendingFiles = [];
    document.removeEventListener("click", closeHistoryMenu, false);
    document.removeEventListener("click", closeTracePanel, false);
    mounted = false;
  }

  return { mount, destroy, _downloadChart: downloadChart };
})();

window.FinanceMode = FinanceMode;

/* Self-register with app.js mode registry so no changes to app.js are needed
   to add, rename, or remove this mode. */
(window._registeredModes = window._registeredModes || {})["finance"] = {
  label:     "Finance AI",
  bodyClass: "finance-mode",
  appClass:  null,
  fullscreen: true,
  btnId:     "tabFinance",
  mount:     () => FinanceMode.mount(),
  destroy:   () => FinanceMode.destroy(),
};
