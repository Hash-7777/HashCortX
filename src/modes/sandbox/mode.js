// ========= SANDBOX SECURITY SCANNER =========
(function initSandbox() {
  let sbxAbort = null;
  let sbxScanCount = 0;
  const sbxHistory = [];
  // Active agent slots — each has { id, label, system } from AGENTS pool + assigned modelValue
  let sbxActiveAgents = [];

  const AGENTS = [
    {
      id: "STATIC",
      label: "STATIC",
      system: `You are an elite static malware analyst. Analyze the provided code ONLY for:
- Known malware signatures and trojan patterns
- Obfuscation and encoding (base64, hex, ROT, XOR, eval chains)
- Backdoors, reverse shells, bind shells, and remote access trojans
- Dropper and loader patterns (downloading and executing payloads)
- Persistence mechanisms (startup entries, cron jobs, registry keys, service installs)
- Anti-analysis techniques (VM/sandbox detection, debugger checks, sleep evasion)
- Suspicious hardcoded credentials or tokens

For EACH finding, output:
[SEVERITY: CRITICAL|HIGH|MEDIUM|LOW] [LOCATION: line/function/area] — description of what it does and why it is malicious.

If nothing suspicious found: output exactly "CLEAN — No static malware patterns detected."
Be precise and technical. No filler text.`,
    },
    {
      id: "NETWORK",
      label: "NETWORK",
      system: `You are an elite network threat analyst. Analyze the provided code ONLY for:
- Hardcoded IPs, domains, and suspicious URLs (especially non-HTTPS or TOR)
- Data exfiltration (sending files, keystrokes, clipboard, credentials, PII to remote hosts)
- C2 (command-and-control) communication patterns and beaconing
- DNS tunneling or covert channel usage
- Cryptomining pool connections (stratum+tcp, etc.)
- Unauthorized webhook or API abuse
- Port scanning, lateral movement, or network enumeration

For EACH finding, output:
[SEVERITY: CRITICAL|HIGH|MEDIUM|LOW] [LOCATION: line/function/area] — description of what it does and why it is suspicious.

If nothing suspicious found: output exactly "CLEAN — No suspicious network activity detected."
Be precise and technical. No filler text.`,
    },
    {
      id: "INJECT",
      label: "INJECT",
      system: `You are an elite injection and vulnerability analyst. Analyze the provided code ONLY for:
- Command injection (exec, system, subprocess, os.system, shell=True with user input)
- Code injection (eval, exec, __import__, compile() with external input)
- SQL injection vulnerabilities
- Path traversal and directory traversal (../../ patterns, user-controlled file paths)
- Deserialization vulnerabilities (pickle, unserialize, yaml.load without Loader)
- XSS and HTML injection in web-facing code
- Privilege escalation (sudo abuse, SUID bits, capability abuse)
- Buffer overflows or memory corruption patterns

For EACH finding, output:
[SEVERITY: CRITICAL|HIGH|MEDIUM|LOW] [LOCATION: line/function/area] — description of the vulnerability and how it could be exploited.

If nothing suspicious found: output exactly "CLEAN — No injection vulnerabilities detected."
Be precise and technical. No filler text.`,
    },
    {
      id: "STEALTH",
      label: "STEALTH",
      system: `You are an elite stealth and evasion threat analyst. Analyze the provided code ONLY for:
- Keyloggers and input capture (keyboard hooks, event listeners capturing keystrokes)
- Screen capture and webcam/microphone access
- Clipboard hijacking (especially crypto wallet address replacement)
- File system tampering (modifying system files, hosts file, browser settings)
- Log wiping and anti-forensics (deleting event logs, bash history, audit trails)
- Rootkit behavior (hiding processes, files, network connections)
- Browser extension injection or credential stealing from browsers
- Cryptocurrency wallet theft or transaction manipulation
- Ransomware behavior (file encryption, ransom note creation)

For EACH finding, output:
[SEVERITY: CRITICAL|HIGH|MEDIUM|LOW] [LOCATION: line/function/area] — description of what it does and why it is dangerous.

If nothing suspicious found: output exactly "CLEAN — No stealth or evasion behavior detected."
Be precise and technical. No filler text.`,
    },
  ];

  const BOSS_SYSTEM = `You are a senior cybersecurity analyst writing the final security report. You have received findings from 4 specialist scanners. Compile a clear, actionable report.

Format your response EXACTLY like this:

## SANDBOX SECURITY REPORT

**Overall Risk:** CRITICAL | HIGH | MEDIUM | LOW | CLEAN

### Findings
[List each real finding as: • [SEVERITY] Area — what it does]
[If all scanners returned CLEAN, write: • No threats detected across all scan domains.]

### Verdict
[2-3 sentences: What is this code? What does it actually do? Is it safe?]

### Recommended Action
**BLOCK** — Do not run. Contains confirmed malicious code.
OR **QUARANTINE** — High suspicion. Manual review required before use.
OR **REVIEW** — Moderate concerns. Understand these issues before running.
OR **SAFE** — No threats detected. Code appears benign.

Be direct. No hedging. No disclaimers about "consulting a professional".`;

  function stripThinkTags(text) {
    return String(text || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/^[\s\n]+/, "")
      .trim();
  }

  function sbxRealModelOptions() {
    const src = document.getElementById("model");
    if (!src) return [];
    return Array.from(src.options).filter(o =>
      o.value && !o.disabled &&
      !o.textContent.includes("Loading") &&
      !o.textContent.includes("offline")
    );
  }

  function sbxFillSelect(sel, keepValue) {
    if (!sel) return;
    const opts = sbxRealModelOptions();
    if (!opts.length) return;
    sel.innerHTML = "";
    opts.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.textContent;
      sel.appendChild(o);
    });
    if (keepValue && opts.find(o => o.value === keepValue)) sel.value = keepValue;
    else sel.value = document.getElementById("model")?.value || opts[0]?.value || "";
  }

  function sbxPopulateModels() {
    const bossEl = document.getElementById("sbxModelSelect");
    sbxFillSelect(bossEl, bossEl?.value);
    // Re-fill each agent slot's select too
    document.querySelectorAll(".sbx-agent-model-sel").forEach(s => {
      sbxFillSelect(s, s.value);
    });
    sbxUpdateAgentCountLabel();
  }

  function sbxUpdateAgentCountLabel() {
    const n = sbxActiveAgents.length;
    const countEl = document.getElementById("sbxAgentCountLabel");
    if (countEl) countEl.textContent = `${n} agent${n !== 1 ? "s" : ""}`;
    const btnLabel = document.getElementById("sbxSwarmLabel");
    if (btnLabel) btnLabel.textContent = `${n} AGENT${n !== 1 ? "S" : ""}`;
  }

  function sbxToggleSwarmPanel(force) {
    const panel   = document.getElementById("sbxSwarmPanel");
    const chevron = document.getElementById("sbxSwarmChevron");
    if (!panel) return;
    const open = force !== undefined ? force : panel.style.display === "none";
    panel.style.display = open ? "" : "none";
    if (chevron) chevron.style.transform = open ? "rotate(180deg)" : "";
  }

  function sbxRenderAgentSlots() {
    const container = document.getElementById("sbxAgentSlots");
    if (!container) return;
    container.innerHTML = "";
    sbxActiveAgents.forEach((agent, i) => {
      const row = document.createElement("div");
      row.className = "sbx-agent-row";
      const badge = document.createElement("span");
      badge.className = `sbx-agent-badge ${agent.id}`;
      badge.textContent = agent.label;
      const sel = document.createElement("select");
      sel.className = "sbx-model-select sbx-agent-model-sel";
      sel.dataset.agentIdx = i;
      sbxFillSelect(sel, agent.modelValue);
      sel.addEventListener("change", () => { sbxActiveAgents[i].modelValue = sel.value; });
      row.appendChild(badge);
      row.appendChild(sel);
      container.appendChild(row);
    });
    sbxUpdateAgentCountLabel();
  }

  function sbxAddAgentSlot() {
    const pool = AGENTS;
    // Cycle through agent types; if we have all 4 add a custom duplicate
    const nextAgent = pool[sbxActiveAgents.length % pool.length];
    const defaultModel = document.getElementById("sbxModelSelect")?.value ||
                         document.getElementById("model")?.value || "";
    sbxActiveAgents.push({ ...nextAgent, modelValue: defaultModel });
    sbxRenderAgentSlots();
  }

  function sbxRemoveAgentSlot() {
    if (sbxActiveAgents.length <= 1) return;
    sbxActiveAgents.pop();
    sbxRenderAgentSlots();
  }

  function sbxInitAgents() {
    const defaultModel = document.getElementById("model")?.value || "";
    sbxActiveAgents = AGENTS.map(a => ({ ...a, modelValue: defaultModel }));
    sbxRenderAgentSlots();
  }

  function sbxLog(agentLabel, text, status) {
    const logEl = document.getElementById("sbxLog");
    if (!logEl) return;
    const idle = logEl.querySelector(".sbx-log-idle");
    if (idle) idle.remove();
    const st = status || "info";
    const entry = document.createElement("div");
    entry.className = "sbx-log-entry " + st;
    entry.innerHTML = `<span class="sbx-agent-tag">${window._H.escapeHtml(agentLabel)}</span><span class="sbx-log-text">${window._H.escapeHtml(text)}</span>`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function sbxLogClear() {
    const logEl = document.getElementById("sbxLog");
    if (logEl) logEl.innerHTML = "";
  }

  function extractRiskLevel(report) {
    const m = report.match(/\*\*Overall Risk:\*\*\s*(CRITICAL|HIGH|MEDIUM|LOW|CLEAN)/i);
    if (m) return m[1].toUpperCase();
    if (/CRITICAL/i.test(report)) return "CRITICAL";
    if (/HIGH/i.test(report)) return "HIGH";
    if (/MEDIUM/i.test(report)) return "MEDIUM";
    if (/LOW/i.test(report)) return "LOW";
    return "CLEAN";
  }

  const SBX_ICONS = {
    critical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    high:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
    medium:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    low:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    clean:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
    fail:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="9" height="9"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  const VERDICT_META = {
    CRITICAL: { icon: SBX_ICONS.critical, label: "CRITICAL THREAT",  sub: "Do not run — malicious code confirmed" },
    HIGH:     { icon: SBX_ICONS.high,     label: "HIGH RISK",         sub: "Serious threats detected" },
    MEDIUM:   { icon: SBX_ICONS.medium,   label: "MEDIUM RISK",       sub: "Suspicious patterns — review before use" },
    LOW:      { icon: SBX_ICONS.low,      label: "LOW RISK",          sub: "Minor concerns — likely safe with caution" },
    CLEAN:    { icon: SBX_ICONS.clean,    label: "CLEAN",             sub: "No threats detected" },
  };

  function renderSbxHistory() {
    const el = document.getElementById("sbxHistory");
    if (!el) return;

    // Update header badge with latest scan
    const badge = document.getElementById("sbxVerdictBadge");
    if (badge) {
      if (!sbxHistory.length) {
        badge.style.display = "none";
      } else {
        const latest = sbxHistory[sbxHistory.length - 1];
        const risk = latest.risk || "CLEAN";
        const vm = VERDICT_META[risk] || VERDICT_META.CLEAN;
        badge.className = `sbx-verdict-badge ${risk}`;
        badge.style.display = "";
        badge.innerHTML = `<span class="sbx-verdict-icon">${vm.icon}</span>${vm.label}`;
      }
    }

    if (!sbxHistory.length) {
      el.innerHTML = '<div class="sbx-history-empty">No scans yet. Paste code and hit RUN SECURITY SCAN.</div>';
      return;
    }
    el.innerHTML = sbxHistory.slice().reverse().map(scan => {
      const risk = scan.risk || "CLEAN";
      const vm = VERDICT_META[risk] || VERDICT_META.CLEAN;
      const snippet = scan.codeSnippet || "";
      const modelBar = (() => {
        const tags = [];
        if (scan.boss) tags.push(`<span class="sbx-scan-model-tag boss">BOSS · ${window._H.escapeHtml(scan.boss)}</span>`);
        (scan.agents || []).forEach(a => {
          tags.push(`<span class="sbx-scan-model-tag ${a.agentId}${a.failed ? " err" : ""}">${window._H.escapeHtml(a.label)} · ${window._H.escapeHtml(a.model)}${a.failed ? " " + SBX_ICONS.fail : ""}</span>`);
        });
        return tags.length ? `<div class="sbx-scan-models">${tags.join("")}</div>` : "";
      })();
      return `<div class="sbx-report-card">
        <div class="sbx-verdict-strip ${risk}">
          <span class="sbx-big-icon">${vm.icon}</span>
          <div class="sbx-verdict-text">
            <div class="sbx-verdict-label">${vm.label}</div>
            <div class="sbx-verdict-sub">${vm.sub} · Scan #${scan.num} · ${scan.time}</div>
          </div>
          <span class="sbx-risk-badge ${risk}">${risk}</span>
        </div>
        ${modelBar}
        ${snippet ? `<div class="sbx-report-snippet">${window._H.escapeHtml(snippet)}</div>` : ""}
        <div class="sbx-report-body">${renderSbxMarkdown(scan.report)}</div>
      </div>`;
    }).join("");
  }

  function renderSbxMarkdown(text) {
    // Escape first so no raw HTML from LLM response can reach DOM
    const safe = window._H.escapeHtml(text);
    const html = safe
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
    // Sanitize through DOMPurify (available globally from purify.min.js)
    return (typeof DOMPurify !== "undefined")
      ? DOMPurify.sanitize(html, { ALLOWED_TAGS: ["h2","h3","strong","em","code","br"], ALLOWED_ATTR: [] })
      : html;
  }

  // ── Regex-based instant pattern scanner (no LLM, runs locally) ──
  const STATIC_PATTERNS = [
    { rx: /eval\s*\(/gi,                          sev: "HIGH",   msg: "eval() call — can execute arbitrary code" },
    { rx: /exec\s*\(/gi,                          sev: "HIGH",   msg: "exec() call — executes shell commands" },
    { rx: /subprocess\.call|subprocess\.Popen|os\.system/gi, sev: "HIGH", msg: "Shell execution via subprocess/os" },
    { rx: /child_process|\.exec\(|\.spawn\(/gi,   sev: "HIGH",   msg: "Node.js child_process shell execution" },
    { rx: /base64[_\-\s]?decode|atob\(|b64decode/gi, sev: "MEDIUM", msg: "Base64 decode — may hide payload" },
    { rx: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){6,}/gi, sev: "MEDIUM", msg: "Hex-encoded byte string — possible obfuscation" },
    { rx: /chr\(\d+\)\s*\+\s*chr\(\d+\)/gi,       sev: "MEDIUM", msg: "Character code concatenation — obfuscation pattern" },
    { rx: /import\s+socket|net\.connect|net\.createConnection/gi, sev: "MEDIUM", msg: "Raw socket connection" },
    { rx: /\/bin\/sh|\/bin\/bash|cmd\.exe|powershell/gi, sev: "HIGH", msg: "Shell reference — may be a shell command" },
    { rx: /stratum\+tcp|mining\.pool|xmrig|monero|cryptonight/gi, sev: "CRITICAL", msg: "Cryptomining indicator" },
    { rx: /reverse.?shell|bind.?shell|meterpreter|metasploit/gi, sev: "CRITICAL", msg: "Reverse/bind shell reference" },
    { rx: /keylog|keystroke|GetAsyncKeyState|SetWindowsHookEx/gi, sev: "CRITICAL", msg: "Keylogger indicator" },
    { rx: /HKEY_LOCAL_MACHINE|HKLM|RegSetValue|RegCreateKey/gi, sev: "HIGH", msg: "Windows registry modification" },
    { rx: /startup|autorun|\.lnk|currentversion\\run/gi, sev: "HIGH", msg: "Persistence mechanism — startup/autorun" },
    { rx: /wget\s+http|curl\s+-[sS].*http|urllib\.request|requests\.get/gi, sev: "MEDIUM", msg: "Remote file download" },
    { rx: /os\.remove|shutil\.rmtree|rm\s+-rf|del\s+\/[sqf]/gi, sev: "MEDIUM", msg: "Destructive file deletion" },
    { rx: /Encrypt|AES\.|Fernet\.|encrypt\s*\(/gi, sev: "LOW",  msg: "Encryption — possible ransomware if combined with file ops" },
    { rx: /\b(4444|31337|12345|6667|9050)\b/g,   sev: "MEDIUM", msg: "Known malware port number in code" },
  ];

  function runPatternScan(code) {
    const findings = [];
    for (const { rx, sev, msg } of STATIC_PATTERNS) {
      rx.lastIndex = 0;
      const m = rx.exec(code);
      if (m) {
        const lineNum = code.slice(0, m.index).split("\n").length;
        findings.push({ sev, msg, match: m[0], line: lineNum });
      }
    }
    return findings;
  }

  async function runPortScan() {
    try {
      const resp = await fetch("/api/backend/sandbox-hostscan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  async function runSandboxScan() {
    const codeInput = document.getElementById("sbxCodeInput");
    const scanBtn   = document.getElementById("sbxScanBtn");
    const stopBtn   = document.getElementById("sbxStopBtn");
    const code = codeInput ? codeInput.value.trim() : "";

    if (!code) {
      sbxLogClear();
      sbxLog("SYSTEM", "No code pasted. Paste something first.", "err");
      return;
    }

    sbxPopulateModels();
    const sbxModelEl = document.getElementById("sbxModelSelect");
    const currentModel = (sbxModelEl && sbxModelEl.value) || document.getElementById("model")?.value || "";
    if (!currentModel) {
      sbxLog("SYSTEM", "No model selected. Pick a model from the model dropdown.", "err");
      return;
    }

    if (sbxAbort) sbxAbort.abort();
    sbxAbort = new AbortController();
    const signal = sbxAbort.signal;

    if (scanBtn) scanBtn.disabled = true;
    if (stopBtn) stopBtn.style.display = "";

    sbxLogClear();
    sbxScanCount++;
    const scanNum = sbxScanCount;
    const scanTime = new Date().toLocaleTimeString();
    const codeSnippet = code.slice(0, 120).replace(/\s+/g, " ");

    sbxLog("SYSTEM", `Scan #${scanNum} — running pattern scanner + port probe + ${AGENTS.length} AI agents in parallel…`, "info");

    // ── Phase 1: instant local pattern scan (no LLM, no network) ──
    const patternFindings = runPatternScan(code);
    if (patternFindings.length) {
      sbxLog("PATTERNS", `${patternFindings.length} suspicious pattern(s) found instantly:`, "warn");
      patternFindings.forEach(f => sbxLog(`[${f.sev}]`, `Line ${f.line}: ${f.msg} (matched: ${f.match.slice(0,30)})`, f.sev === "CRITICAL" ? "err" : "warn"));
    } else {
      sbxLog("PATTERNS", "No instant-match patterns detected.", "done");
    }

    // ── Phase 2: port + process scan runs in parallel with LLM agents ──
    const portScanPromise = runPortScan().then(result => {
      if (!result || !result.ok) { sbxLog("PORTSCAN", "Port scan unavailable (server not running).", "warn"); return result; }
      const open = result.openMalwarePorts || [];
      const listeners = result.allListeners || [];
      if (open.length) {
        sbxLog("PORTSCAN", `[!] ${open.length} known malware port(s) OPEN on this machine:`, "err");
        open.forEach(p => sbxLog(`PORT:${p.port}`, `${p.note} — OPEN`, "err"));
      } else {
        sbxLog("PORTSCAN", "No known malware ports open.", "done");
      }
      sbxLog("PORTSCAN", `${listeners.length} total listening port(s) on machine.`, "info");
      return result;
    });

    const codeBlock = `\n\`\`\`\n${code.slice(0, 6000)}\n\`\`\``;

    let agentResults = [];
    try {
      const agentPromises = sbxActiveAgents.map(async (agent) => {
        const workerModel = agent.modelValue || currentModel;
        sbxLog(agent.label, `Scanning… (${workerModel.split(":").pop().slice(0,24)})`);
        let result = "";
        try {
          result = stripThinkTags(await window._H.ollamaChat(
            workerModel,
            [
              { role: "system", content: agent.system },
              { role: "user",   content: `Analyze this code:${codeBlock}` }
            ],
            null,
            signal
          ));
          sbxLog(agent.label, result.slice(0, 80) + (result.length > 80 ? "…" : ""), "done");
        } catch (e) {
          if (e.name === "AbortError") throw e;
          result = `[Scanner error: ${e.message}]`;
          sbxLog(agent.label, "Scanner failed: " + e.message, "err");
        }
        return { agent: agent.id, label: agent.label, model: workerModel, result };
      });

      agentResults = await Promise.all(agentPromises);
    } catch (e) {
      if (e.name === "AbortError") {
        sbxLog("SYSTEM", "Scan stopped by user.", "err");
        if (scanBtn) scanBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = "none";
        sbxAbort = null;
        return;
      }
      sbxLog("SYSTEM", "Unexpected error: " + e.message, "err");
      if (scanBtn) scanBtn.disabled = false;
      if (stopBtn) stopBtn.style.display = "none";
      sbxAbort = null;
      return;
    }

    const portScanResult = await portScanPromise;

    sbxLog("BOSS", "All agents done. Compiling final security report…");

    const patternSummary = patternFindings.length
      ? `=== INSTANT PATTERN SCANNER ===\n${patternFindings.map(f => `[${f.sev}] Line ${f.line}: ${f.msg}`).join("\n")}`
      : "=== INSTANT PATTERN SCANNER ===\nCLEAN — No patterns matched.";

    const portSummary = portScanResult && portScanResult.ok
      ? `=== PORT SCAN ===\nOpen malware ports: ${portScanResult.openMalwarePorts.length ? portScanResult.openMalwarePorts.map(p => `${p.port} (${p.note})`).join(", ") : "None"}\nAll listeners: ${(portScanResult.allListeners||[]).map(l => `${l.command}:${l.port}`).join(", ") || "None"}`
      : "=== PORT SCAN ===\nUnavailable";

    const agentSummaries = [patternSummary, portSummary, ...agentResults.map(r =>
      `=== ${r.label} SCANNER REPORT ===\n${r.result}`
    )].join("\n\n");

    let finalReport = "";
    try {
      finalReport = stripThinkTags(await window._H.ollamaChat(
        currentModel,
        [
          { role: "system", content: BOSS_SYSTEM },
          { role: "user",   content: `Code analyzed (first 200 chars): ${code.slice(0, 200)}\n\n${agentSummaries}` }
        ],
        null,
        signal
      ));
      sbxLog("BOSS", "Report ready.", "done");
    } catch (e) {
      if (e.name === "AbortError") {
        sbxLog("SYSTEM", "Scan stopped by user.", "err");
        if (scanBtn) scanBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = "none";
        sbxAbort = null;
        return;
      }
      finalReport = agentResults.map(r => `**${r.label}**\n${r.result}`).join("\n\n");
      sbxLog("BOSS", "Report synthesis failed, showing raw results.", "warn");
    }

    const risk = extractRiskLevel(finalReport);
    const bossLabel = (document.getElementById("sbxModelSelect")?.options[
      document.getElementById("sbxModelSelect")?.selectedIndex]?.textContent || currentModel).slice(0, 32);
    const agentAttribution = agentResults.map(r => ({
      agentId: r.agent, label: r.label,
      model: (r.model || currentModel).split("/").pop().slice(0, 28),
      failed: r.result.startsWith("[Scanner error")
    }));
    sbxHistory.push({ num: scanNum, time: scanTime, codeSnippet, risk, report: finalReport,
      boss: bossLabel, agents: agentAttribution });
    renderSbxHistory();

    const riskColors = { CRITICAL: "#ff4040", HIGH: "#ff9040", MEDIUM: "#ffe040", LOW: "#80e090", CLEAN: "#00ff41" };
    sbxLog("RESULT", `Risk: ${risk}`, risk === "CLEAN" ? "done" : risk === "LOW" ? "done" : "warn");

    if (scanBtn) scanBtn.disabled = false;
    if (stopBtn) stopBtn.style.display = "none";
    sbxAbort = null;
  }

  function initSandboxListeners() {
    const scanBtn       = document.getElementById("sbxScanBtn");
    const stopBtn       = document.getElementById("sbxStopBtn");
    const backBtn       = document.getElementById("sbxBackBtn");
    const addBtn        = document.getElementById("sbxAddAgent");
    const removeBtn     = document.getElementById("sbxRemoveAgent");
    const swarmCfgBtn   = document.getElementById("sbxSwarmConfigBtn");
    const swarmCloseBtn = document.getElementById("sbxSwarmPanelClose");

    if (scanBtn)       scanBtn.addEventListener("click", () => { sbxToggleSwarmPanel(false); runSandboxScan(); });

    if (stopBtn)       stopBtn.addEventListener("click", () => {
      if (sbxAbort) { sbxAbort.abort(); sbxAbort = null; }
      stopBtn.style.display = "none";
      const b = document.getElementById("sbxScanBtn");
      if (b) b.disabled = false;
    });

    if (backBtn)       backBtn.addEventListener("click", () => {
      const back = (window._H.state._preSandboxTab) || "chats";
      window._H.setTab(back === "sandbox" ? "chats" : back);
    });

    if (swarmCfgBtn)   swarmCfgBtn.addEventListener("click", (e) => { e.stopPropagation(); sbxToggleSwarmPanel(); });
    if (swarmCloseBtn) swarmCloseBtn.addEventListener("click", () => sbxToggleSwarmPanel(false));
    if (addBtn)        addBtn.addEventListener("click", sbxAddAgentSlot);
    if (removeBtn)     removeBtn.addEventListener("click", sbxRemoveAgentSlot);

    // Close panel when clicking outside
    document.addEventListener("click", (e) => {
      const panel = document.getElementById("sbxSwarmPanel");
      const btn   = document.getElementById("sbxSwarmConfigBtn");
      if (panel && panel.style.display !== "none" && !panel.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
        sbxToggleSwarmPanel(false);
      }
    });

    // Watch the main model dropdown — sync sandbox selects whenever models load/refresh
    const srcModel = document.getElementById("model");
    if (srcModel) {
      new MutationObserver(() => sbxPopulateModels())
        .observe(srcModel, { childList: true, subtree: true });
    }

    sbxInitAgents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSandboxListeners);
  } else {
    initSandboxListeners();
  }

  window.SandboxMode = {
    mount() { sbxPopulateModels(); if (!sbxActiveAgents.length) sbxInitAgents(); },
    destroy() {},
  };

  (window._registeredModes = window._registeredModes || {})["sandbox"] = {
    label:     "Sandbox",
    bodyClass: null,
    appClass:  "sandbox-mode",
    fullscreen: true,
    btnId:     "tabSandbox",
    mount:     () => window.SandboxMode.mount(),
    destroy:   () => {},
  };
})();
