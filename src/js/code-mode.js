// =============================================================
// code-mode.js — HashCoder Coder Mode (Full-screen God Agent)
//
// Loaded after app.js. Uses window._H bridge for API access.
// Exposes window.CoderMode for app.js lifecycle calls.
// Exposes window.HC_CODE for legacy hashcoder.js tool access.
// =============================================================

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const TOOL_ICONS = {
    read_file:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    write_file:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    patch_file:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    list_dir:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    delete_file:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
    search_files: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    shell_run:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    fuzzy_find:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>`,
    grep_code:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><circle cx="18" cy="17" r="3"/><line x1="20.5" y1="19.5" x2="22" y2="21"/></svg>`,
  };
  const TOOL_ICON_DEFAULT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

  // ── Shared state ───────────────────────────────────────────
  const sharedState = { projectRoot: null, activeFile: null };

  // Whether the AppleScript picker fallbacks are worth attempting. osascript
  // does not exist on Windows or Linux, so trying it there produces a confusing
  // "command not found" rather than an honest "no picker available". The Rust
  // side reports the real platform; navigator is the fallback for the brief
  // window before that resolves, and for browser dev mode.
  function isMacOS() {
    const reported = sharedState?.platform?.os;
    if (reported) return reported === 'macos';
    return /mac/i.test(navigator.platform || navigator.userAgent || '');
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function baseName(path) {
    return String(path || '').split('/').filter(Boolean).pop() || String(path || '');
  }

  function relativeFromRoot(path) {
    const raw = String(path || '');
    const root = String(sharedState.projectRoot || '').replace(/\/$/, '');
    return root && raw.startsWith(root + '/') ? raw.slice(root.length + 1) : raw;
  }

  function setExplorerRootLabel(path) {
    const rootEl = $('cdrExplorerRoot');
    if (!rootEl) return;
    if (!path) {
      rootEl.textContent = 'No project open';
      rootEl.title = '';
      return;
    }
    rootEl.innerHTML = `<strong>${esc(baseName(path))}</strong><span>${esc(path)}</span>`;
    rootEl.title = path;
  }

  // ── Slim tool row renderer (v1.6 inline style) ─────────────
  function toolBlockHtml(rec) {
    const { name, args, result, ms, ok } = rec;
    const icon = TOOL_ICONS[name] || TOOL_ICON_DEFAULT;
    const pathArg = args?.path || args?.dir || args?.file || '';
    const resultText = String(result || '');
    const isErr = !ok || resultText.includes('"error"');
    const statusClass = isErr ? 'err' : ok ? 'ok' : '';
    const statusText  = isErr ? 'Failed' : `${ms}ms`;
    const safeId = 'tb_' + Math.random().toString(36).slice(2, 9);
    const argsJson = esc(JSON.stringify(args || {}, null, 2).slice(0, 500));
    const resultPreview = esc(resultText.slice(0, 600)) + (resultText.length > 600 ? '\n…' : '');
    return `
<div class="cdr-tool-row ${statusClass}" data-tool-toggle="${safeId}">
  ${icon}
  <span class="cdr-tool-name">${esc(name)}</span>
  <span class="cdr-tool-target">${esc(pathArg)}</span>
  <span class="cdr-tool-status">${esc(statusText)}</span>
</div>
<div class="cdr-tool-details" id="${safeId}">
  ${argsJson !== '{}' ? `<div style="margin-bottom:6px"><b>Args</b><pre>${argsJson}</pre></div>` : ''}
  <div><b>Result</b><pre>${resultPreview}</pre></div>
</div>`;
  }

  function injectAllToolBlocks() {
    const H = window._H;
    if (!H) return;
    const messages = H.state?.messages;
    if (!messages) return;
    document.querySelectorAll('#cdrMessages .cdr-msg.assistant').forEach(wrap => {
      const idx = parseInt(wrap.dataset.idx, 10);
      if (isNaN(idx)) return;
      const msg = messages[idx];
      if (!msg?._toolBlocks?.length) return;
      const bubble = wrap.querySelector('.bubble');
      if (!bubble) return;
      if (bubble.dataset.tbCount === String(msg._toolBlocks.length)) return;
      bubble.dataset.tbCount = String(msg._toolBlocks.length);
      bubble.querySelectorAll('.hc-tool-blocks-wrap').forEach(el => el.remove());
      const wrapper = document.createElement('div');
      wrapper.className = 'hc-tool-blocks-wrap';
      wrapper.innerHTML = msg._toolBlocks.map(toolBlockHtml).join('');
      // Wire click handlers for slim tool row expand/collapse
      wrapper.querySelectorAll('.cdr-tool-row[data-tool-toggle]').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.toolToggle;
          const details = document.getElementById(id);
          if (details) {
            const isOpen = details.style.display === 'block';
            details.style.display = isOpen ? 'none' : 'block';
            row.classList.toggle('open', !isOpen);
          }
        });
      });
      // Hide details by default
      wrapper.querySelectorAll('.cdr-tool-details').forEach(d => { d.style.display = 'none'; });
      bubble.insertBefore(wrapper, bubble.firstChild);
    });
  }

  // ── Legacy HC_CODE API (kept for hashcoder.js bridge compatibility) ──
  function buildMessages() {
    const H = window._H;
    const msgs = (H.buildOllamaMessages && H.buildOllamaMessages()) || [];
    const projectCtx = sharedState.projectRoot ? `\nProject root: ${sharedState.projectRoot}` : '';
    const sysMsgIdx = msgs.findIndex(m => m.role === 'system');
    const fullSys = (HC?.code?.SYSTEM_PROMPT || '') + projectCtx;
    if (sysMsgIdx >= 0) msgs[sysMsgIdx].content = fullSys + '\n\n' + msgs[sysMsgIdx].content;
    else msgs.unshift({ role: 'system', content: fullSys });
    return msgs;
  }

  function buildLegacyTools() {
    return (HC?.code?.TOOL_DEFINITIONS || []).map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([k, v]) =>
              [k, (v && typeof v === 'object' && v.type) ? v : { type: 'string', description: String(v) }]
            )
          ),
          required: Object.keys(t.parameters).filter(k => !['reason', 'cwd', 'file_ext'].includes(k)),
        }
      }
    }));
  }

  // ── Auto-router ────────────────────────────────────────────
  // Provider fallback order for coding tasks. Each entry is only added
  // if the matching API key is present in the Settings DOM.
  const ROUTER_FALLBACKS = [
    { keyId: 'groqKey',       provider: 'groq',       model: 'llama-3.3-70b-versatile',           label: 'Groq'      },
    { keyId: 'cerebrasKey',   provider: 'cerebras',   model: 'llama-3.3-70b',                     label: 'Cerebras'  },
    { keyId: 'sambaKey',      provider: 'samba',      model: 'Meta-Llama-3.3-70B-Instruct',       label: 'SambaNova' },
    { keyId: 'openRouterKey', provider: 'openrouter', model: 'meta-llama/llama-4-maverick:free',  label: 'OpenRouter'},
    { keyId: 'geminiKey',     provider: 'gemini',     model: 'gemini-2.5-flash',                  label: 'Gemini'    },
    { keyId: 'openaiKey',     provider: 'openai',     model: 'gpt-4o',                            label: 'OpenAI'    },
    { keyId: 'anthropicKey',  provider: 'anthropic',  model: 'claude-sonnet-4-20250514',          label: 'Anthropic' },
    { keyId: 'deepseekKey',   provider: 'deepseek',   model: 'deepseek-chat',                     label: 'DeepSeek'  },
    { keyId: 'moonshotKey',   provider: 'moonshot',   model: 'kimi-k2.6',                         label: 'Moonshot'  },
    { keyId: 'mistralKey',    provider: 'mistral',    model: 'mistral-large-latest',              label: 'Mistral'   },
  ];

  function getAdapter(modelValue) {
    const H = window._H;
    if (modelValue && modelValue.startsWith('cloud:')) {
      const parsed = (H?.parseCloudModel && H.parseCloudModel(modelValue)) || { provider: '', modelId: modelValue };
      if (parsed.provider === 'gemini')    return { kind: 'gemini',    model: parsed.modelId, label: 'Gemini' };
      if (parsed.provider === 'anthropic') return { kind: 'anthropic', model: parsed.modelId, label: 'Anthropic' };
      return { kind: 'openai', provider: parsed.provider, model: parsed.modelId, label: parsed.provider };
    }
    return { kind: 'ollama', model: modelValue || 'llama3.2', label: 'Local' };
  }

  function buildRouterChain(overrideModel) {
    const H = window._H;
    const selected = overrideModel || H?.selectedModel?.() || '';
    const primary = getAdapter(selected);
    const chain = [primary];

    // Fetch live available models so fallback IDs never go stale.
    const liveModels = (typeof H?.getAvailableCloudModels === 'function') ? H.getAvailableCloudModels() : [];

    for (const fb of ROUTER_FALLBACKS) {
      const key = (document.getElementById(fb.keyId)?.value || '').trim();
      if (!key) continue;
      if (primary.kind === 'openai' && primary.provider === fb.provider) continue;

      // Pick the best live model for this provider instead of a hardcoded ID.
      const providerModels = liveModels.filter(m => m.provider === fb.provider);
      let modelId = fb.model; // hardcoded safety fallback
      if (providerModels.length) {
        providerModels.sort((a, b) => (b.tier || 0) - (a.tier || 0));
        const parsed = H?.parseCloudModel ? H.parseCloudModel(providerModels[0].value) : null;
        if (parsed?.modelId) modelId = parsed.modelId;
      }

      const fbKind = fb.provider === 'gemini' ? 'gemini' : fb.provider === 'anthropic' ? 'anthropic' : 'openai';
      chain.push({ kind: fbKind, provider: fb.provider, model: modelId, label: fb.label });
    }
    return chain;
  }

  function isRoutableError(err) {
    const msg = String(err?.message || '');
    return /rate.?limit|429|quota.?exceed|too.?many.?request|overload|529|not.?found|renamed.?or.?retired|404|model.*unavailable|no.?such.?model|invalid.?model|key.?missing|key.?invalid|401|403/i.test(msg);
  }

  function setRouterChip(label, state) {
    const chip = document.getElementById('cdrRouterChip');
    const lbl  = document.getElementById('cdrRouterLabel');
    if (!chip) return;
    chip.className = 'cdr-router-chip' + (state ? ' ' + state : '');
    chip.textContent = label || '';
    chip.style.display = label ? '' : 'none';
    if (lbl) { lbl.textContent = label || ''; }
  }

  // ── Error classification for solid auto-routing ──
  // transient: retry SAME model (network / 5xx / timeout)
  // routable:  try NEXT model (quota / auth / 404 / unavailable)
  // fatal:     stop chain immediately (4xx bad request shape)
  function classifyRouterError(err) {
    if (!err) return 'fatal';
    const msg = String(err.message || err);
    if (err.name === 'AbortError') return 'fatal';
    if (/timeout|timed out|network|fetch failed|ECONN|socket|disconnected/i.test(msg)) return 'transient';
    if (/\b5\d\d\b|server error|overload|529|503|502/i.test(msg)) return 'transient';
    if (/rate.?limit|429|quota.?exceed|too.?many.?request|key.?invalid|key.?missing|401|403|404|not.?found|unavailable|no.?such.?model|invalid.?model|renamed|retired/i.test(msg)) return 'routable';
    return 'routable'; // default to try-next when unsure (safer than fatal)
  }

  // Session-scoped failure streak counter — models that fail 3x get demoted.
  const _routerStreaks = new Map();

  async function callWithRouter(messages, tools, temperature, signal, modelOverride) {
    const H = window._H;
    let chain = buildRouterChain(modelOverride);
    if (!chain.length) {
      throw new Error('No model available. Select a model from the dropdown or add an API key in Settings.');
    }
    // Sort: same-tier-or-higher first (preserves quality). Demote any model with ≥3 fails this session.
    chain = sortChainByQuality(chain);
    setRouterChip(chain[0].label || 'Auto', '');

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (let i = 0; i < chain.length; i++) {
      const adapter = chain[i];
      const key = adapter.label + ':' + adapter.model;
      if (i > 0) setRouterChip(`> ${adapter.label}`, 'routing');

      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {  // up to 2 retries for transient errors on SAME model
        try {
          // Routing lives in app.js — one copy of which client each provider
          // needs, shared by every mode.
          const result = await H.runModelTurn({ adapter, messages, tools, temperature, signal });
          // Success — reset streak, update chip, return
          _routerStreaks.set(key, 0);
          if (i > 0) setRouterChip(adapter.label, 'switched');
          return result;
        } catch (e) {
          if (signal?.aborted) throw e;
          lastErr = e;
          const cls = classifyRouterError(e);
          if (cls === 'transient' && attempt === 0) {
            setRouterChip(`${adapter.label} retry…`, 'routing');
            await sleep(900);
            continue;  // retry same model
          }
          if (cls === 'fatal') throw e;
          break; // routable → fall through to next adapter
        }
      }
      // Demote on streak
      const streak = (_routerStreaks.get(key) || 0) + 1;
      _routerStreaks.set(key, streak);
      if (i < chain.length - 1) {
        const reason = /\b401|403\b/.test(String(lastErr?.message)) ? 'key rejected'
                     : /\b429|rate|quota/i.test(String(lastErr?.message)) ? 'rate-limited'
                     : /\b404|unavailable|no.?such/i.test(String(lastErr?.message)) ? 'unavailable'
                     : 'failed';
        setRouterChip(`${adapter.label} ${reason} > ${chain[i + 1].label}`, 'routing');
        continue;
      }
      throw lastErr || new Error('All routes failed');
    }
  }

  // Tier ordering — keep quality high during failover.
  function sortChainByQuality(chain) {
    const TIER = { frontier: 4, large: 3, medium: 2, small: 1 };
    function tierFor(m) {
      const s = (m.model || '').toLowerCase();
      if (/gpt-4o|claude-(opus|4|5)|gemini-2\.5-pro|kimi-k2|deepseek-v3|llama-4|400b|405b/i.test(s)) return 'frontier';
      if (/70b|72b|sonnet|gemini-2\.5-flash|qwen2\.5/i.test(s)) return 'large';
      if (/8b|9b|13b|34b|haiku|mini|flash-lite|3\.2/i.test(s)) return 'medium';
      return 'small';
    }
    return chain
      .map((m, i) => ({ m, i, t: TIER[tierFor(m)] || 0, fails: _routerStreaks.get(m.label + ':' + m.model) || 0 }))
      .sort((a, b) => {
        // Primary (i===0) is the user's explicit choice — never demote it.
        if (a.i === 0) return -1;
        if (b.i === 0) return 1;
        // Among fallbacks, demote heavy-failers.
        if (a.fails >= 3 && b.fails < 3) return 1;
        if (b.fails >= 3 && a.fails < 3) return -1;
        return b.t - a.t;
      })
      .map(x => x.m);
  }

  async function legacyRun(assistant, { signal, onStatus }) {
    const H = window._H;
    if (!H) throw new Error('_H bridge not ready');
    assistant._toolBlocks = [];
    const tools    = buildLegacyTools();
    const messages = buildMessages();
    const temperature = H.selectedTemperature ? Math.min(H.selectedTemperature(), 0.4) : 0.2;
    const MAX_ITER = 8;
    let iter = 0, finalText = '';
    while (iter < MAX_ITER) {
      iter++;
      onStatus(`Thinking (step ${iter})…`, 'thinking');
      if (signal?.aborted) break;
      const turn = await callWithRouter(messages, tools, temperature, signal);
      if (turn && turn.tool_calls && turn.tool_calls.length) {
        H.appendAssistantToolCallTurn(messages, turn.content, turn.tool_calls);
        for (const call of turn.tool_calls) {
          if (signal?.aborted) return;
          onStatus(`${call.name}…`, 'running');
          const t0 = performance.now();
          let resultStr, ok = true;
          try {
            const def = (HC?.code?.TOOL_DEFINITIONS || []).find(t => t.name === call.name);
            if (!def) throw new Error('Unknown tool: ' + call.name);
            const raw = await def.fn(call.arguments || {});
            /* Guard against null return (Tauri commands often return null on success) —
               show {"ok":true} so the model/UI never sees the literal string "null" */
            if (raw == null) resultStr = '{"ok":true}';
            else resultStr = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
          } catch (e) { resultStr = JSON.stringify({ error: String(e?.message || e) }); ok = false; }
          const ms = Math.round(performance.now() - t0);
          assistant._toolBlocks.push({ name: call.name, args: call.arguments || {}, result: resultStr, ms, ok });
          const pathArg = call.arguments?.path || call.arguments?.dir;
          if (pathArg) sharedState.activeFile = pathArg;
          onStatus(`${call.name} done (${assistant._toolBlocks.length} tool${assistant._toolBlocks.length > 1 ? 's' : ''} used)`, 'done');
          H.appendToolResult(messages, call, resultStr);
        }
        continue;
      }
      finalText = turn.content || '';
      assistant.content = finalText;
      H.updateLastBubble && H.updateLastBubble(finalText);
      return finalText;
    }
    onStatus('Max iterations reached — finalizing', 'warn');
    assistant.content = finalText || '(Max iterations reached.)';
    H.updateLastBubble && H.updateLastBubble(assistant.content);
    return finalText;
  }

  // ══════════════════════════════════════════════════════════════
  // CoderMode — Full-screen chat agent overlay (Claude Code style)
  // ══════════════════════════════════════════════════════════════
  const CoderMode = (() => {
    let mounted            = false;
    let agentCount         = 1;
    let runAbort           = null;
    let conversationMsgs   = []; // persists across turns — full chat history
    let toolCallCounter    = 0;
    let coderModel         = null; // null = use main model picker
    let activeContentEl    = null; // current assistant bubble — for change pills
    let cdrTraceEntries    = [];
    let cdrTraceStartedAt  = Date.now();
    const SESSIONS_KEY     = 'hc-coder-sessions';
    const STATE_KEY        = 'hashui_coder_state';

    // ── State persistence ─────────────────────────────────────
    function saveCoderState() {
      // Saved on every turn, which is exactly when the context reading and the
      // change counts move.
      updateCoderStatus();
      try {
        // No file contents here. A log of every change, holding each file
        // before and after, used to be saved alongside this — megabytes of
        // duplicated text into localStorage, the same store the API keys live
        // in, with a quota that fails silently once full. Nothing ever read it
        // back. What has to survive a restart is the undo history, and that is
        // on disk in ~/.hashcortx/checkpoints/, which restorePendingChanges()
        // reads.
        const state = {
          projectRoot: sharedState.projectRoot,
          homeDir: sharedState.homeDir,
          chatHistory: conversationMsgs,
          activeFile: sharedState.activeFile,
          ts: Date.now(),
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch {}
    }
    function restoreCoderState() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state) return;
        if (state.projectRoot) {
          sharedState.projectRoot = state.projectRoot;
          sharedState.homeDir = state.homeDir || sharedState.homeDir;
          sharedState.activeFile = state.activeFile || null;
          syncProjectLabel();
          HC?.guard?.setProjectRoot?.(state.projectRoot);
          setExplorerRootLabel(state.projectRoot);
          renderExplorerTree(state.projectRoot).catch(() => {});
        }
        if (Array.isArray(state.chatHistory) && state.chatHistory.length) {
          conversationMsgs = state.chatHistory;
          renderConversation();
        }
      } catch (e) { console.warn('[CoderMode] restore state failed:', e); }
    }
    function clearCoderState() {
      try { localStorage.removeItem(STATE_KEY); } catch {}
    }

    // ── Mount / destroy ───────────────────────────────────────
    function mount() {
      if (mounted) return;
      mounted = true;
      wireDom();
      syncProjectLabel();
      setRouterChip('Auto', '');
      if (sharedState.projectRoot) HC?.guard?.setProjectRoot?.(sharedState.projectRoot);
      // Discover home dir for system-prompt path hints. Bypasses HC.code.shellRun intentionally
      // — this is an internal app initialisation, not an AI agent action, so a permission
      // dialog would be jarring UX. The command is read-only and hardcoded.
      if (HC?.isTauri && !sharedState.homeDir) {
        // The home-directory probe and its shell are chosen in Rust — `sh` does
        // not exist on Windows, and hard-coding it here made every terminal
        // command and this probe fail there.
        HC.invoke('shell_platform')
          .then(info => { sharedState.platform = info; return HC.invoke('shell_run_line', { line: info.homeProbe, cwd: null }); })
          .then(r => { if (r?.stdout?.trim()) sharedState.homeDir = r.stdout.trim(); })
          .catch(() => {});
      }
      restoreCoderState();
      // Deliberately NOT inside restoreCoderState: that returns early when there
      // is no saved session, and a change waiting to be kept or undone has
      // nothing to do with whether the last conversation was saved. Reading the
      // records is the whole point — they are the part that survives.
      restorePendingChanges().catch((e) => console.warn('[CoderMode] pending changes:', e));
      syncTerminalPrompt();
      updateCoderStatus();
    }

    function remount() {
      populateModelPicker();
      renderSessions();
    }

    function destroy() {
      mounted = false;
      if (runAbort) { runAbort.abort(); runAbort = null; }
    }

    // ── DOM wiring ────────────────────────────────────────────
    function wireDom() {
      const runBtn            = $('cdrRunBtn');
      const stopBtn           = $('cdrStopBtn');
      const backBtn           = $('cdrBackBtn');
      const auditBtn          = $('cdrAuditBtn');
      const resetPermsBtn     = $('cdrResetPermsBtn');
      const exportBtn         = $('cdrExportBtn');
      const clearBtn          = $('cdrClearChatBtn');
      const taskInput         = $('cdrTaskInput');
      const leftAddFileBtn    = $('cdrLeftAddFileBtn');
      const leftAddFolderBtn  = $('cdrLeftAddFolderBtn');
      const clearFilesBtn     = $('cdrClearFilesBtn');
      const sessionsClearAll  = $('cdrSessionsClearAllBtn');
      const sessionsSearchEl  = $('cdrSessionsSearch');

      if (runBtn)            runBtn.addEventListener('click', startRun);
      if (stopBtn)           stopBtn.addEventListener('click', stopRun);
      if (backBtn)           backBtn.addEventListener('click', goBack);
      if (clearBtn)          clearBtn.addEventListener('click', clearChat);
      if (leftAddFileBtn)    leftAddFileBtn.addEventListener('click', openFile);
      if (leftAddFolderBtn)  leftAddFolderBtn.addEventListener('click', openProject);
      if (clearFilesBtn)     clearFilesBtn.addEventListener('click', clearFilesPanel);
      if (auditBtn)          auditBtn.addEventListener('click', showAuditLog);
      if (resetPermsBtn)     resetPermsBtn.addEventListener('click', () => {
        if (!window.confirm('Revoke all session permissions you granted this session? The agent will ask again before any write or shell operation.')) return;
        HC.guard.clearSession?.();
      });

      const traceBtn   = $('cdrTraceBtn');
      const tracePanel = $('cdrTracePanel');
      const traceClear = $('cdrTraceClear');
      if (traceBtn && tracePanel) {
        traceBtn.addEventListener('click', e => {
          e.stopPropagation();
          tracePanel.classList.toggle('open');
          renderCdrTrace();
        });
        tracePanel.addEventListener('click', e => e.stopPropagation());
      }
      if (traceClear) traceClear.addEventListener('click', () => cdrTraceReset('Trace cleared'));
      document.addEventListener('click', () => $('cdrTracePanel')?.classList.remove('open'));
      if (exportBtn)         exportBtn.addEventListener('click', exportChat);
      if (sessionsClearAll)  sessionsClearAll.addEventListener('click', async () => {
        try { localStorage.removeItem(SESSIONS_KEY); } catch {}
        renderSessions();
      });
      if (sessionsSearchEl)  sessionsSearchEl.addEventListener('input', () => renderSessions(sessionsSearchEl.value));

      // Terminal wiring
      const termInput = $('cdrTerminalInput');
      const termClear = $('cdrTerminalClear');
      if (termInput) termInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { onTerminalKey(e); return; }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (_termHistIdx > 0) { _termHistIdx--; termInput.value = _termHistory[_termHistIdx] || ''; }
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (_termHistIdx < _termHistory.length - 1) { _termHistIdx++; termInput.value = _termHistory[_termHistIdx] || ''; }
          else { _termHistIdx = _termHistory.length; termInput.value = ''; }
          return;
        }
      });
      if (termClear) termClear.addEventListener('click', clearTerminal);

      const sessionsClearBtn = $('cdrSessionsClearBtn');
      if (sessionsClearBtn) sessionsClearBtn.addEventListener('click', () => {
        try { localStorage.removeItem(SESSIONS_KEY); } catch {}
        renderSessions();
      });


      renderSessions();

      // Quick-action chips on welcome screen
      document.querySelectorAll('.cdr-welcome-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const prompt = chip.dataset.prompt;
          if (!prompt || !taskInput) return;
          taskInput.value = prompt;
          autoResize(taskInput);
          taskInput.focus();
        });
      });

      document.querySelectorAll('.cdr-agent-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.cdr-agent-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          agentCount = parseInt(btn.dataset.agents, 10) || 1;
        });
      });

      if (taskInput) {
        taskInput.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startRun(); }
        });
        taskInput.addEventListener('input', () => autoResize(taskInput));
      }

      populateModelPicker();
      const modelPicker = $('cdrModelPicker');
      if (modelPicker) {
        modelPicker.addEventListener('change', () => {
          coderModel = modelPicker.value || null;
          const label = modelPicker.options[modelPicker.selectedIndex]?.text || 'Auto';
          setRouterChip(label.length > 22 ? label.slice(0, 20) + '…' : label, '');
        });
      }
    }

    // Models known to reliably support structured tool/function calling.
    // Providers not listed here are excluded from the coder mode picker.
    function populateModelPicker() {
      const src = document.getElementById('model');
      const dest = $('cdrModelPicker');
      if (!src || !dest) return;
      dest.innerHTML = '';
      const autoOpt = document.createElement('option');
      autoOpt.value = '';
      autoOpt.textContent = 'Auto (follow main picker)';
      dest.appendChild(autoOpt);
      src.querySelectorAll('optgroup, option').forEach(node => {
        if (node.tagName === 'OPTGROUP') {
          const group = document.createElement('optgroup');
          group.label = node.label;
          node.querySelectorAll('option').forEach(opt => group.appendChild(opt.cloneNode(true)));
          if (group.childElementCount) dest.appendChild(group);
        } else if (node.tagName === 'OPTION') {
          dest.appendChild(node.cloneNode(true));
        }
      });
      dest.value = coderModel || src.value || '';
    }

    function autoResize(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 320) + 'px';
    }


    function goBack() {
      const H = window._H;
      const prev = H?.state?._preCoderTab || 'chats';
      H?.setTab?.(prev);
    }

    function syncProjectLabel() {
      const sub = $('cdrProjectSub');
      if (!sub) return;
      const root = sharedState.projectRoot;
      sub.textContent = root ? root.split('/').slice(-1)[0] : 'No project open';
      sub.title = root || '';
    }

    function setActiveFile(path) {
      sharedState.activeFile = path;
      const sub = $('cdrProjectSub');
      if (sub && path) {
        sub.textContent = path.split('/').slice(-1)[0] || path;
        sub.title = path;
      }
    }

    // ── Explorer ──────────────────────────────────────────────
    function toggleExplorer() {
      const sidebar = $('cdrSidebar');
      const body = $('cdrBody');
      if (!sidebar) return;
      const opening = !sidebar.classList.contains('open');
      sidebar.classList.toggle('open', opening);
      if (opening && sharedState.projectRoot) {
        renderExplorerTree(sharedState.projectRoot);
      }
    }

    // Open native file/folder pickers. Order of preference:
    //   1. Tauri 2 plugin-dialog (requires dialog:default in capabilities + new build)
    //   2. macOS AppleScript fallback via shell_run (works in EVERY build)
    //   3. Web showDirectoryPicker / showOpenFilePicker (browser dev mode)
    //
    // CRITICAL: distinguish between "plugin errored" (fall back) and
    // "user pressed Cancel" (return null IMMEDIATELY, do NOT reopen picker).
    async function pickFolder() {
      if (window.HC?.isTauri && window.HC?.invoke) {
        // 1) Tauri plugin-dialog
        let pluginAvailable = true;
        try {
          const folder = await window.HC.invoke('plugin:dialog|open', {
            options: { directory: true, multiple: false, title: 'Open Project Folder' }
          });
          // Success path — user either picked or cancelled. Both end here.
          return (typeof folder === 'string' && folder) ? folder : null;
        } catch (e) {
          // Genuine plugin failure (e.g. capability missing). Fall through.
          pluginAvailable = false;
          console.warn('[CoderMode] dialog plugin unavailable, using AppleScript fallback:', e?.message || e);
        }
        // 2) AppleScript fallback
        if (!pluginAvailable && isMacOS()) {
          try {
            const out = await window.HC.invoke('shell_run', {
              command: 'osascript',
              args: ['-e', 'POSIX path of (choose folder with prompt "Open Project Folder")']
            });
            // osascript exits non-zero on user cancel → check `code` and stdout
            if (out?.code === 0) {
              const stdout = (out?.stdout || '').trim();
              return stdout ? stdout.replace(/\/$/, '') : null;
            }
            // Non-zero exit = user cancelled or osascript failed → return null
            return null;
          } catch (e) { console.warn('[CoderMode] osascript folder:', e); return null; }
        }
        return null;
      }
      // 3) Web fallback
      if (window.showDirectoryPicker) {
        try { const dirHandle = await window.showDirectoryPicker(); return dirHandle.name; }
        catch { return null; }
      }
      return null;
    }

    async function pickFile() {
      if (window.HC?.isTauri && window.HC?.invoke) {
        let pluginAvailable = true;
        try {
          const file = await window.HC.invoke('plugin:dialog|open', {
            options: { multiple: false, title: 'Open File' }
          });
          return (typeof file === 'string' && file) ? file : null;
        } catch (e) {
          pluginAvailable = false;
          console.warn('[CoderMode] dialog plugin unavailable, using AppleScript fallback:', e?.message || e);
        }
        if (!pluginAvailable && isMacOS()) {
          try {
            const out = await window.HC.invoke('shell_run', {
              command: 'osascript',
              args: ['-e', 'POSIX path of (choose file with prompt "Open File")']
            });
            if (out?.code === 0) {
              const stdout = (out?.stdout || '').trim();
              return stdout || null;
            }
            return null;
          } catch (e) { console.warn('[CoderMode] osascript file:', e); return null; }
        }
        return null;
      }
      if (window.showOpenFilePicker) {
        try { const [fh] = await window.showOpenFilePicker(); return fh.name; }
        catch { return null; }
      }
      return null;
    }

    async function openProject() {
      const folder = await pickFolder();
      if (!folder || typeof folder !== 'string') return;
      sharedState.projectRoot = folder;
      HC?.guard?.setProjectRoot?.(folder);
      // Keep system prompt current so the model always sees the real project root.
      if (conversationMsgs.length && conversationMsgs[0]?.role === 'system') {
        conversationMsgs[0].content = sysPrompt();
      }
      syncProjectLabel();
      syncTerminalPrompt();
      setExplorerRootLabel(folder);
      await renderExplorerTree(folder);
      scanProjectSymbols(folder);
      const sidebar = $('cdrSidebar');
      const body = $('cdrBody');
      if (sidebar) sidebar.classList.add('open');
      saveCoderState();
    }

    async function openFile() {
      const file = await pickFile();
      if (!file || typeof file !== 'string') return;
      setActiveFile(file);
      const ti = $('cdrTaskInput');
      if (ti && !ti.value.trim()) ti.value = `Read and summarize: ${file}`;
    }

    // ── AI session files — auto-add any file the AI creates/modifies to the left panel
    const _aiSessionFiles = new Set();
    function clearFilesPanel() {
      _aiSessionFiles.clear();
      sharedState.projectRoot = null;
      sharedState.activeFile = null;
      sharedState.projectSymbols = {};
      HC?.guard?.clearProjectRoot?.();
      syncProjectLabel();
      syncTerminalPrompt();
      setExplorerRootLabel(null);
      const body = $('cdrExplorerBody');
      if (body) body.innerHTML = '<div class="cdr-tree-empty">Open a project or file to start.</div>';
      saveCoderState();
      setStatus('Files cleared', 'ok');
    }

    function addAIFileToExplorer(filePath, kind) {
      if (!filePath || typeof filePath !== 'string') return;
      if (_aiSessionFiles.has(filePath)) return;
      _aiSessionFiles.add(filePath);
      const body = $('cdrExplorerBody');
      if (!body) return;
      // Find or create the "Session files" section at the top of the tree
      let section = document.getElementById('cdrAISessionSection');
      if (!section) {
        section = document.createElement('div');
        section.id = 'cdrAISessionSection';
        section.className = 'cdr-ai-session-section';
        section.innerHTML = `
          <div class="cdr-ai-session-hd">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>
            <span>SESSION FILES</span>
          </div>
          <div class="cdr-ai-session-list" id="cdrAISessionList"></div>`;
        body.prepend(section);
      }
      const list = document.getElementById('cdrAISessionList');
      if (!list) return;
      // Clear empty-state placeholder if present
      const empty = body.querySelector('.cdr-tree-empty');
      if (empty) empty.remove();
      const row = document.createElement('div');
      row.className = 'cdr-tree-entry cdr-ai-file' + (kind === 'delete' ? ' deleted' : '');
      const name = baseName(filePath);
      const displayPath = relativeFromRoot(filePath);
      const icon = kind === 'delete'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
      row.innerHTML = `${icon}<span class="cdr-tree-text"><span class="cdr-tree-name">${esc(name)}</span><span class="cdr-tree-path">${esc(displayPath)}</span></span>`;
      row.title = filePath;
      row.addEventListener('click', () => {
        setActiveFile(filePath);
        const ti = $('cdrTaskInput');
        if (ti && !ti.value.trim()) ti.value = `Review changes in: ${filePath}`;
      });
      list.appendChild(row);
    }

    async function renderExplorerTree(dir, parentEl, depth) {
      if (!window.HC?.isTauri) return;
      const container = parentEl || $('cdrExplorerBody');
      if (!container) return;
      if (!parentEl) container.innerHTML = '<div class="cdr-tree-empty">Loading…</div>';
      try {
        // Use HC.code.listDir so the guard can log the access in the audit trail.
        // The permission dialog is suppressed because the user explicitly opened this
        // project folder, so the guard treats it as session-trusted.
        const entries = await HC.code.listDir(dir);
        if (!parentEl) container.innerHTML = '';
        if (!entries?.length) {
          if (!parentEl) container.innerHTML = '<div class="cdr-tree-empty">Empty directory</div>';
          return;
        }
        const sorted = [...entries].sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const entry of sorted) {
          if (entry.name.startsWith('.') && !entry.name.match(/^\.env/)) continue;
          const item = document.createElement('div');
          item.className = 'cdr-tree-entry' + (entry.is_dir ? ' dir' : '');
          item.style.paddingLeft = `${7 + (depth || 0) * 12}px`;
          const fullPath = (dir.endsWith('/') ? dir : dir + '/') + entry.name;
          const en = esc(entry.name);
          item.innerHTML = entry.is_dir
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="cdr-tree-name">${en}</span>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg><span class="cdr-tree-name">${en}</span>`;
          item.title = fullPath;
          item.dataset.path = fullPath;
          item.addEventListener('click', async e => {
            e.stopPropagation();
            if (entry.is_dir) {
              const existing = item.nextElementSibling;
              if (existing?.classList.contains('cdr-tree-subtree')) {
                existing.remove(); item.classList.remove('open');
              } else {
                item.classList.add('open');
                const sub = document.createElement('div');
                sub.className = 'cdr-tree-subtree';
                item.after(sub);
                await renderExplorerTree(fullPath, sub, (depth || 0) + 1);
              }
            } else {
              document.querySelectorAll('.cdr-tree-entry').forEach(el => el.classList.remove('active'));
              item.classList.add('active');
              setActiveFile(fullPath);
              const ti = $('cdrTaskInput');
              if (ti && !ti.value.trim()) ti.value = `Read and summarize: ${fullPath}`;
            }
          });
          container.appendChild(item);
        }
      } catch (e) {
        if (!parentEl) container.innerHTML = `<div class="cdr-tree-empty">Error: ${esc(String(e?.message || e))}</div>`;
      }
    }

    // ── Project symbol index ──────────────────────────────────
    const SYMBOL_PATTERNS = {
      js:  /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)|(?:export\s+(?:default\s+)?)?class\s+(\w+)/g,
      ts:  /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)|(?:export\s+(?:default\s+)?)?class\s+(\w+)/g,
      py:  /^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/gm,
      rs:  /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)|(?:pub\s+)?struct\s+(\w+)|(?:pub\s+)?enum\s+(\w+)|(?:pub\s+)?trait\s+(\w+)|impl(?:\s+<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/g,
      go:  /^func\s+(?:\([^)]+\)\s+)?(\w+)|^type\s+(\w+)/gm,
      java:/(?:public|private|protected)\s+(?:static\s+)?(?:<[^>]+>\s+)?\w+(?:<[^>]+>)?(?:\[\])?\s+(\w+)\s*\(|^\s*(?:public\s+)?class\s+(\w+)/gm,
      c:   /^\s*(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm,
      cpp: /^\s*(?:\w+(?:\s*::\s*\w+)?\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{|^\s*class\s+(\w+)/gm,
      rb:  /^(?:def\s+(?:self\.)?(\w+)|class\s+(\w+)|module\s+(\w+))/gm,
    };
    const SYMBOL_EXT_MAP = {
      js:'js', ts:'ts', tsx:'ts', jsx:'js',
      py:'py', rs:'rs', go:'go',
      java:'java', c:'c', cpp:'cpp', h:'c', hpp:'cpp',
      rb:'rb', rake:'rb',
    };

    async function scanProjectSymbols(root) {
      if (!window.HC?.isTauri || !root) return;
      const symbols = {}; // path → [{name, kind}]
      try {
        const entries = await HC.code.listDir(root);
        if (!entries) return;
        const files = entries.filter(e => !e.is_dir && !e.name.startsWith('.') && !e.name.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|ttf|eot|mp3|mp4|pdf|zip|tar|gz|bin|exe|dll|so|dylib)$/i));
        for (const f of files) {
          const ext = f.name.split('.').pop()?.toLowerCase() || '';
          const lang = SYMBOL_EXT_MAP[ext];
          if (!lang) continue;
          try {
            const content = await HC.code.readFile(f.path);
            const text = typeof content === 'string' ? content : JSON.stringify(content);
            const pat = SYMBOL_PATTERNS[lang];
            if (!pat) continue;
            pat.lastIndex = 0;
            const matches = [];
            let m;
            while ((m = pat.exec(text)) !== null) {
              const name = m[1] || m[2] || m[3] || m[4] || m[5];
              if (name && name.length < 80 && !name.match(/^(if|else|for|while|switch|catch|return|throw|try|new|this|self|super)$/)) {
                const line = text.slice(0, m.index).split('\n').length;
                const kind = m[0].includes('class') ? 'class' : m[0].includes('struct') ? 'struct' : m[0].includes('enum') ? 'enum' : m[0].includes('interface') ? 'interface' : m[0].includes('trait') ? 'trait' : m[0].includes('type') ? 'type' : 'fn';
                matches.push({ name, kind, line });
              }
            }
            if (matches.length) symbols[f.path] = matches.slice(0, 30);
          } catch {}
        }
      } catch (e) { console.warn('[CoderMode] scan symbols:', e); }
      sharedState.projectSymbols = symbols;
      renderSymbolTree();
    }

    function renderSymbolTree() {
      const container = $('cdrExplorerBody');
      if (!container) return;
      const syms = sharedState.projectSymbols || {};
      const existing = container.querySelector('.cdr-symbols-section');
      if (existing) existing.remove();
      if (!Object.keys(syms).length) return;
      const section = document.createElement('div');
      section.className = 'cdr-symbols-section';
      section.innerHTML = `<div class="cdr-sidebar-title" style="margin:12px 6px 4px">Symbols</div>`;
      for (const [path, items] of Object.entries(syms)) {
        const fileName = path.split('/').pop();
        const fileDiv = document.createElement('div');
        fileDiv.style.margin = '2px 6px';
        fileDiv.innerHTML = `<div style="font-size:10px;color:var(--cdr-text-muted);margin-bottom:2px">${esc(fileName)}</div>`;
        const list = document.createElement('div');
        list.style.display = 'flex'; list.style.flexDirection = 'column'; list.style.gap = '1px';
        for (const s of items) {
          const el = document.createElement('div');
          el.className = 'cdr-tree-entry';
          el.style.paddingLeft = '14px';
          el.style.fontSize = '10px';
          const kindColor = { class:'var(--cdr-gold)', struct:'var(--cdr-gold)', enum:'var(--cdr-gold)', interface:'var(--cdr-gold)', trait:'var(--cdr-violet)', type:'var(--cdr-violet)', fn:'var(--cdr-cyan)' }[s.kind] || 'var(--cdr-text-dim)';
          el.innerHTML = `<span style="color:${kindColor};font-weight:600;margin-right:4px">${s.kind}</span>${esc(s.name)}`;
          el.title = `${s.kind} ${s.name} — line ${s.line}`;
          list.appendChild(el);
        }
        fileDiv.appendChild(list);
        section.appendChild(fileDiv);
      }
      container.appendChild(section);
    }

    // ── Status helpers ────────────────────────────────────────
    function setStatus(text, type) {
      const dot  = $('cdrStatusDot');
      const txt  = $('cdrStatusText');
      if (dot) dot.className = 'cdr-status-dot' + (type ? ' ' + type : '');
      if (txt) txt.textContent = text || 'Ready';
    }

    // ── Chat rendering ────────────────────────────────────────
    function scrollMessages() {
      const el = $('cdrMessages');
      if (el) el.scrollTop = el.scrollHeight;
    }

    function renderMarkdown(text) {
      if (!text) return '';
      if (window.marked) {
        try {
          const html = window.marked.parse(text, { breaks: true, gfm: true });
          if (window.DOMPurify) return window.DOMPurify.sanitize(html);
          // DOMPurify not available — fall through to safe plain-text render
        } catch {}
      }
      return esc(text).replace(/\n/g, '<br>');
    }

    function appendUserMsg(text) {
      const msgs = $('cdrMessages');
      if (!msgs) return;
      msgs.querySelector('.cdr-welcome')?.remove();
      const el = document.createElement('div');
      el.className = 'cdr-msg user';
      const svgCopy = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      el.innerHTML = `
        <div class="cdr-user-bubble">${esc(text)}</div>
        <div class="cdr-msg-actions">
          <button class="cdr-action-btn cdr-act-copy">${svgCopy} copy</button>
        </div>`;
      el.querySelector('.cdr-act-copy').addEventListener('click', function () {
        navigator.clipboard.writeText(text).then(() => {
          this.classList.add('flash');
          setTimeout(() => this.classList.remove('flash'), 1200);
        }).catch(() => {});
      });
      msgs.appendChild(el);
      scrollMessages();
    }

    function appendAssistantBubble(roleLabel) {
      const msgs = $('cdrMessages');
      if (!msgs) return null;
      const el = document.createElement('div');
      el.className = 'cdr-msg assistant' + (roleLabel && roleLabel !== 'HashCortX Coder' ? ' boss' : '');

      const svgCopy  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      const svgReply = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
      const svgRegen = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.18"/></svg>`;

      el.innerHTML = `
        <div class="cdr-msg-role">${esc(roleLabel || 'HashCortX Coder')}</div>
        <div class="cdr-msg-content"></div>
        <div class="cdr-msg-actions">
          <button class="cdr-action-btn cdr-act-copy">${svgCopy} copy</button>
          <button class="cdr-action-btn cdr-act-reply">${svgReply} reply</button>
          <button class="cdr-action-btn cdr-act-regen">${svgRegen} regen</button>
        </div>`;

      const contentEl = el.querySelector('.cdr-msg-content');

      el.querySelector('.cdr-act-copy').addEventListener('click', function () {
        const txt = contentEl.innerText || contentEl.textContent || '';
        navigator.clipboard.writeText(txt).then(() => {
          this.classList.add('flash');
          setTimeout(() => this.classList.remove('flash'), 1200);
        }).catch(() => {});
      });

      el.querySelector('.cdr-act-reply').addEventListener('click', () => {
        const ti = $('cdrTaskInput');
        if (!ti) return;
        const raw = (contentEl.innerText || contentEl.textContent || '').trim().slice(0, 300);
        const quoted = raw.split('\n').map(l => '> ' + l).join('\n');
        ti.value = quoted + '\n\n';
        autoResize(ti);
        ti.focus();
        ti.setSelectionRange(ti.value.length, ti.value.length);
      });

      el.querySelector('.cdr-act-regen').addEventListener('click', () => {
        if (runAbort) return;
        // Remove the last assistant message from history
        for (let i = conversationMsgs.length - 1; i >= 0; i--) {
          if (conversationMsgs[i].role === 'assistant') { conversationMsgs.splice(i, 1); break; }
        }
        el.remove();
        const runBtn  = $('cdrRunBtn');
        const stopBtn = $('cdrStopBtn');
        if (runBtn)  runBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = '';
        runAbort = new AbortController();
        runSingleTurn(runAbort.signal).catch(() => {}).finally(() => {
          if (runBtn)  runBtn.style.display = '';
          if (stopBtn) stopBtn.style.display = 'none';
          runAbort = null;
          setRouterChip('Auto', '');
        });
      });

      msgs.appendChild(el);
      scrollMessages();
      return contentEl;
    }

    function appendThinking(contentEl) {
      if (!contentEl) return null;
      const el = document.createElement('div');
      el.className = 'cdr-thinking';
      el.innerHTML = '<span></span><span></span><span></span>';
      contentEl.appendChild(el);
      scrollMessages();
      return el;
    }

    function appendToolBlock(contentEl, name, args) {
      if (!contentEl) return null;
      const id = ++toolCallCounter;
      const icon = TOOL_ICONS[name] || TOOL_ICON_DEFAULT;
      const argStr = Object.entries(args || {})
        .filter(([, v]) => v && String(v).length < 60)
        .slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 38)}`).join(', ');

      const el = document.createElement('details');
      el.className = 'cdr-tool-call running';
      el.open = true;
      el.dataset.id = String(id);
      el.innerHTML = `
        <summary class="cdr-tool-summary">
          <span class="cdr-tool-icon">${icon}</span>
          <span class="cdr-tool-name">${esc(name)}</span>
          ${argStr ? `<span class="cdr-tool-args">${esc(argStr)}</span>` : ''}
          <span class="cdr-tool-status running">running…</span>
        </summary>
        <div class="cdr-tool-body">
          <div class="cdr-tool-result">Working…</div>
        </div>`;
      contentEl.appendChild(el);
      scrollMessages();
      return el;
    }

    function finalizeToolBlock(el, result, ok, ms) {
      if (!el) return;
      el.classList.remove('running');
      el.classList.add(ok ? 'ok' : 'err');
      el.open = false;
      const status = el.querySelector('.cdr-tool-status');
      if (status) {
        status.className = 'cdr-tool-status ' + (ok ? 'ok' : 'err');
        const svgOk  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        const svgErr = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        status.innerHTML = ok ? `${svgOk} ${ms}ms` : `${svgErr} error`;
      }
      const resultEl = el.querySelector('.cdr-tool-result');
      if (resultEl) {
        resultEl.textContent = (result || '').slice(0, 600) + ((result || '').length > 600 ? '\n…' : '');
      }
      scrollMessages();
    }

    function appendTextToBubble(contentEl, text) {
      if (!contentEl || !text) return;
      const el = document.createElement('div');
      el.className = 'cdr-msg-text';
      el.innerHTML = renderMarkdown(text);
      contentEl.appendChild(el);
      scrollMessages();
    }

    // ── Sessions (past chats) ─────────────────────────────────
    function loadSessions() {
      try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch { return []; }
    }
    function saveSessions(sessions) {
      try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50))); } catch {}
    }

    // Cap session names to 3 words max (chat-mode pattern: enforceTwoWordName clone)
    function enforceThreeWordName(raw) {
      const words = String(raw || '').trim().split(/\s+/).filter(Boolean);
      return words.slice(0, 3).join(' ') || 'New Chat';
    }

    function saveCurrentSession() {
      const userMsgs = conversationMsgs.filter(m => m.role === 'user');
      if (!userMsgs.length) return;
      const title = enforceThreeWordName(userMsgs[0].content);
      const now = new Date();
      const date = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
                   now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const session = { id: Date.now(), title, date, msgs: conversationMsgs.slice() };
      const sessions = loadSessions();
      sessions.unshift(session);
      saveSessions(sessions);
      renderSessions();
    }

    function deleteSession(idx) {
      const sessions = loadSessions();
      if (!sessions[idx]) return;
      sessions.splice(idx, 1);
      saveSessions(sessions);
      renderSessions($('cdrSessionsSearch')?.value || '');
    }

    function renameSession(idx) {
      const sessions = loadSessions();
      const s = sessions[idx];
      if (!s) return;
      const next = window.prompt('Rename chat (3 words max):', s.title || '');
      if (next == null) return;
      const trimmed = enforceThreeWordName(next);
      if (!trimmed || trimmed === s.title) return;
      s.title = trimmed;
      saveSessions(sessions);
      renderSessions($('cdrSessionsSearch')?.value || '');
    }

    function renderSessions(filter) {
      const list = $('cdrSessionsList');
      if (!list) return;
      const all = loadSessions();
      const q = (filter || '').trim().toLowerCase();
      const sessions = q ? all.filter(s => (s.title || '').toLowerCase().includes(q)) : all;
      if (!sessions.length) {
        list.innerHTML = `<div class="cdr-sessions-empty">${q ? 'No chats match your search.' : 'Past conversations will appear here.'}</div>`;
        return;
      }
      // SVGs (no emoji — terminal-themed icons)
      const editSvg   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path d="M11 2.2a1.5 1.5 0 0 1 2.1 2.1L5 12.6 2 13.4 2.8 10.4z"/></svg>`;
      const deleteSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path d="M3 5h10M6 5V3.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V5M5 5l.7 8a.6.6 0 0 0 .6.5h3.4a.6.6 0 0 0 .6-.5L11 5"/></svg>`;
      list.innerHTML = sessions.map(s => {
        const realIdx = all.indexOf(s);
        const userCount = s.msgs.filter(m => m.role === 'user').length;
        return `
        <div class="cdr-session-item" data-idx="${realIdx}">
          <div class="cdr-session-row">
            <div class="cdr-session-title">${esc(s.title)}</div>
            <div class="cdr-session-actions">
              <button class="cdr-session-act" data-act="rename" title="Rename chat">${editSvg}</button>
              <button class="cdr-session-act cdr-session-del" data-act="delete" title="Delete chat">${deleteSvg}</button>
            </div>
          </div>
          <div class="cdr-session-meta">${esc(s.date)} &middot; ${userCount} msg${userCount !== 1 ? 's' : ''}</div>
        </div>`;
      }).join('');
      list.querySelectorAll('.cdr-session-item').forEach(item => {
        const idx = parseInt(item.dataset.idx, 10);
        item.addEventListener('click', (e) => {
          // Ignore clicks that originated on the action buttons
          if (e.target.closest('.cdr-session-actions')) return;
          const sessions = loadSessions();
          if (!sessions[idx]) return;
          restoreSession(sessions[idx]);
        });
        const rn = item.querySelector('[data-act="rename"]');
        const dl = item.querySelector('[data-act="delete"]');
        if (rn) rn.addEventListener('click', (e) => { e.stopPropagation(); renameSession(idx); });
        if (dl) dl.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('Delete this saved chat?')) deleteSession(idx); });
      });
    }

    function restoreSession(session) {
      if (!session?.msgs?.length) return;
      conversationMsgs = session.msgs.slice();
      renderConversation();
      setStatus('Ready', '');
    }

    /**
     * How full the model's context window is, and what the knowledge base holds.
     *
     * Chat has shown context usage all along. Coder — where a run reads files,
     * runs commands and accumulates tool results for minutes at a time — showed
     * nothing, so the first sign of a full window was a failure.
     *
     * The knowledge base beside it answers a different question: Coder can
     * search it now, and "off" and "empty" are not the same answer. Both used
     * to look like no results.
     */
    function updateCoderStatus() {
      const H = window._H;
      const box = $('cdrContext');
      if (box && H?.estimatePromptTokens) {
        // The window a model actually has is far larger than chat's own cap, and
        // a Coder run is long. Until the model list carries a real figure this
        // is one honest number rather than a guessed one per provider.
        const MAX = 64000;
        const used = H.estimatePromptTokens(conversationMsgs) || 0;
        const pct = Math.min(100, Math.round((used / MAX) * 100));
        const pctEl = $('cdrContextPct'), fillEl = $('cdrContextFill'), cntEl = $('cdrContextCount');
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
        const k = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
        if (cntEl) cntEl.textContent = `${k(used)}/${k(MAX)}`;
        box.classList.toggle('warn', pct >= 70 && pct < 90);
        box.classList.toggle('hot', pct >= 90);
        box.title = `Estimated context: ${used.toLocaleString()} of ~${MAX.toLocaleString()} tokens`;
      }

      const kb = $('cdrKb'), kbState = $('cdrKbState'), kbRows = $('cdrKbRows');
      if (kb && kbState && kbRows) {
        const on = !!H?.ragIsOn?.();
        const size = H?.ragSize?.() || { passages: 0, sources: 0 };
        kb.classList.toggle('on', on);
        kbState.textContent = on ? 'on' : 'off';
        kbRows.innerHTML = on
          ? (size.passages
            ? `<div class="cdr-kb-row"><span>passages</span><b>${size.passages.toLocaleString()}</b></div>
               <div class="cdr-kb-row"><span>sources</span><b>${size.sources}</b></div>`
            : '<div class="cdr-kb-row"><span>nothing ingested yet</span></div>')
          : '<div class="cdr-kb-row"><span>search_knowledge will find nothing</span></div>';
      }
    }

    function renderConversation() {
      const msgs = $('cdrMessages');
      if (!msgs) return;
      msgs.innerHTML = '';
      for (const m of conversationMsgs) {
        if (m.role === 'user') {
          appendUserMsg(m.content);
        } else if (m.role === 'assistant' && m.content) {
          const el = appendAssistantBubble('HashCortX Coder');
          if (el) {
            const div = document.createElement('div');
            div.className = 'cdr-msg-text';
            div.innerHTML = renderMarkdown(m.content);
            el.appendChild(div);
          }
        }
      }
    }

    // ── Terminal ──────────────────────────────────────────────
    function terminalPrompt() {
      const root = sharedState.projectRoot;
      return root ? `${baseName(root)} %` : '%';
    }

    function syncTerminalPrompt() {
      const promptEl = $('cdrTerminalPrompt');
      if (promptEl) promptEl.textContent = terminalPrompt();
    }

    // Simple ANSI-to-HTML: covers basic 8 colors + bold/dim/reset
    function ansiToHtml(text) {
      if (!text || !text.includes('\x1b[')) return esc(text);
      const colors = {
        '30': '#6b6b78', '31': '#d98a85', '32': '#5fb88a', '33': '#f5c97a',
        '34': '#6ab4ff', '35': '#c084fc', '36': '#4bd2be', '37': '#e8e8ec',
        '90': '#4a4a55', '91': '#ff8f8f', '92': '#7dd3a8', '93': '#fde68a',
        '94': '#93c5fd', '95': '#d8b4fe', '96': '#99f6e4', '97': '#ffffff',
      };
      let out = '';
      const re = /\x1b\[([0-9;]*)m/g;
      let last = 0;
      let m;
      const stack = [];
      while ((m = re.exec(text)) !== null) {
        out += esc(text.slice(last, m.index));
        const codes = m[1].split(';').filter(Boolean);
        for (const c of codes) {
          if (c === '0') { while (stack.length) out += '</span>'; stack.length = 0; }
          else if (c === '1') { out += '<span style="font-weight:600">'; stack.push('span'); }
          else if (c === '2') { out += '<span style="opacity:0.6">'; stack.push('span'); }
          else if (colors[c]) { out += `<span style="color:${colors[c]}">`; stack.push('span'); }
        }
        last = re.lastIndex;
      }
      out += esc(text.slice(last));
      while (stack.length) out += '</span>';
      return out;
    }

    // ── Execution trace ───────────────────────────────────────
    function cdrTraceReset(reason) {
      cdrTraceStartedAt = Date.now();
      cdrTraceEntries = [];
      cdrTraceAdd('Trace', reason || 'New run', 'wait');
    }

    function cdrTraceAdd(stage, message, status) {
      cdrTraceEntries.push({
        elapsed: Number(((Date.now() - cdrTraceStartedAt) / 1000).toFixed(1)),
        stage: String(stage || ''),
        message: String(message || ''),
        status: status || 'wait',
      });
      if (cdrTraceEntries.length > 300) cdrTraceEntries = cdrTraceEntries.slice(-300);
      renderCdrTrace();
    }

    function renderCdrTrace() {
      const list = $('cdrTraceEntries');
      if (!list) return;
      function icon(s) { return s === 'ok' ? '✓' : s === 'err' ? '!' : s === 'warn' ? '!' : s === 'run' ? '›' : '·'; }
      if (!cdrTraceEntries.length) {
        list.innerHTML = '<div class="cdr-trace-empty">No trace entries yet.</div>';
        return;
      }
      list.innerHTML = cdrTraceEntries.map(e => `<div class="cdr-trace-entry">
  <span class="cdr-trace-time">[${e.elapsed.toFixed(1)}s]</span>
  <span class="cdr-trace-stage ${e.status}">${esc(e.stage)}</span>
  <span class="cdr-trace-icon ${e.status}">${icon(e.status)}</span>
  <span class="cdr-trace-msg ${e.status}">${esc(e.message)}</span>
</div>`).join('');
      list.scrollTop = list.scrollHeight;
    }

    function terminalLog(text, className = '') {
      const body = $('cdrTerminalBody');
      if (!body) return;
      const line = document.createElement('div');
      line.className = 'cdr-terminal-line' + (className ? ' ' + className : '');
      line.innerHTML = ansiToHtml(text);
      body.appendChild(line);
      body.scrollTop = body.scrollHeight;
    }
    function clearTerminal() {
      const body = $('cdrTerminalBody');
      if (body) body.innerHTML = '';
    }
    async function onTerminalKey(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const input = $('cdrTerminalInput');
      if (!input) return;
      const cmd = input.value.trim();
      if (!cmd) return;
      input.value = '';
      terminalLog(`${terminalPrompt()} ${cmd}`, 'cdr-terminal-prompt');
      _pushTermHistory(cmd);
      if (!window.HC?.isTauri) {
        terminalLog('Terminal requires Tauri backend.', 'cdr-terminal-error');
        return;
      }
      // Try streaming first (v1.7), fall back to blocking shell_run
      const ChannelCtor = typeof Channel !== 'undefined' ? Channel : window.__TAURI__?.core?.Channel;
      const useStream = !!ChannelCtor;
      if (useStream) {
        try {
          const channel = new ChannelCtor();
          let exitCode = null;
          channel.onmessage = (chunk) => {
            if (chunk.kind === 'stdout') terminalLog(chunk.data);
            else if (chunk.kind === 'stderr') terminalLog(chunk.data, 'cdr-terminal-error');
            else if (chunk.kind === 'done') exitCode = chunk.code;
          };
          await HC.invoke('shell_run_line_stream', { line: cmd, cwd: sharedState.projectRoot || undefined, on_chunk: channel });
          if (exitCode !== 0 && exitCode !== null) {
            terminalLog(`(exit code: ${exitCode})`, 'cdr-terminal-error');
          }
        } catch (err) {
          terminalLog(String(err?.message || err), 'cdr-terminal-error');
        }
      } else {
        try {
          const result = await HC.invoke('shell_run_line', { line: cmd, cwd: sharedState.projectRoot || undefined });
          if (result?.stdout) result.stdout.split('\n').forEach(l => { if (l || result.stdout.endsWith('\n')) terminalLog(l); });
          if (result?.stderr) result.stderr.split('\n').forEach(l => { if (l) terminalLog(l, 'cdr-terminal-error'); });
          if (result?.code !== 0 && result?.code !== undefined) {
            terminalLog(`(exit code: ${result.code})`, 'cdr-terminal-error');
          }
        } catch (err) {
          terminalLog(String(err?.message || err), 'cdr-terminal-error');
        }
      }
    }

    // Terminal history (up/down arrows)
    const _termHistory = [];
    let _termHistIdx = -1;
    function _pushTermHistory(cmd) {
      if (!cmd) return;
      _termHistory.push(cmd);
      _termHistIdx = _termHistory.length;
      try {
        const saved = JSON.parse(localStorage.getItem('hc_term_history') || '[]');
        saved.push(cmd);
        if (saved.length > 200) saved.shift();
        localStorage.setItem('hc_term_history', JSON.stringify(saved));
      } catch {}
    }
    function _loadTermHistory() {
      try {
        const saved = JSON.parse(localStorage.getItem('hc_term_history') || '[]');
        _termHistory.push(...saved);
        _termHistIdx = _termHistory.length;
      } catch {}
    }
    _loadTermHistory();

    function clearChat() {
      saveCurrentSession();
      conversationMsgs = [];
      activeContentEl = null;
      // Clear what is on DISK too, not just what is in memory.
      //
      // Without this, "New chat" emptied the screen while localStorage still
      // held the old conversation, and restoreCoderState() put it straight
      // back on the next launch. Since the app's data directory is keyed by
      // bundle identifier rather than by the binary, a rebuild does not clear
      // it either — so the same conversation kept reappearing with no way to
      // get rid of it. clearCoderState() existed for exactly this and was
      // never called from anywhere.
      clearCoderState();
      const msgs = $('cdrMessages');
      if (msgs) {
        msgs.innerHTML = `<div class="cdr-welcome">
          <img src="/assets/hashcortx-logo.png" class="cdr-welcome-logo" draggable="false" alt="HashCortx"/>
          <div class="cdr-welcome-title">Coder Mode</div>
          <div class="cdr-welcome-sub">Surgical AI tasks &middot; auto-routed &middot; local-first</div>
          <div class="cdr-welcome-chips">
            <span class="cdr-welcome-chip" data-prompt="List all files in the project and give me a quick overview of the codebase structure">Explore codebase</span>
            <span class="cdr-welcome-chip" data-prompt="Find all TODO and FIXME comments in the project">Find TODOs</span>
            <span class="cdr-welcome-chip" data-prompt="Check for any obvious bugs or issues in the main source files">Debug &amp; audit</span>
            <span class="cdr-welcome-chip" data-prompt="Write unit tests for the core functionality">Write tests</span>
          </div>
        </div>`;
        msgs.querySelectorAll('.cdr-welcome-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const ti = $('cdrTaskInput');
            if (!ti || !chip.dataset.prompt) return;
            ti.value = chip.dataset.prompt;
            autoResize(ti);
            ti.focus();
          });
        });
      }
      setStatus('Ready', '');
      setRouterChip('Auto', '');
    }

    // ── Export — opens a small menu under the Export button with format choices.
    // Formats: txt (plain), code (only fenced code blocks extracted), pdf (rendered).
    function exportChat() {
      if (!conversationMsgs.length) { alert('No conversation to export.'); return; }
      // If a menu is already open, close it
      const existing = document.getElementById('cdrExportMenu');
      if (existing) { existing.remove(); return; }
      const btn = document.getElementById('cdrExportBtn');
      if (!btn) return;
      const menu = document.createElement('div');
      menu.id = 'cdrExportMenu';
      menu.className = 'cdr-export-menu';
      menu.innerHTML = `
        <button data-fmt="txt" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>
          Plain text (.txt)
        </button>
        <button data-fmt="code" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Code only (.txt)
        </button>
        <button data-fmt="md" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>
          Markdown (.md)
        </button>
        <button data-fmt="pdf" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          PDF (.pdf)
        </button>`;
      document.body.appendChild(menu);
      const rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.zIndex = '99999';
      // Click outside closes
      const closeOnOutside = (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
          menu.remove();
          document.removeEventListener('click', closeOnOutside, true);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
      // Format handlers
      menu.querySelectorAll('button[data-fmt]').forEach(b => {
        b.addEventListener('click', () => {
          const fmt = b.dataset.fmt;
          menu.remove();
          document.removeEventListener('click', closeOnOutside, true);
          doExport(fmt);
        });
      });
    }

    async function doExport(fmt) {
      const ts = Date.now();
      const proj = sharedState.projectRoot ? sharedState.projectRoot.split('/').slice(-1)[0] : 'chat';

      if (fmt === 'txt') {
        const out = buildPlainText();
        await downloadBlob(out, 'text/plain', `hashcortx-${proj}-${ts}.txt`);
      } else if (fmt === 'md') {
        const out = buildMarkdown();
        await downloadBlob(out, 'text/markdown', `hashcortx-${proj}-${ts}.md`);
      } else if (fmt === 'code') {
        const out = buildCodeOnly();
        if (!out.trim()) { alert('No fenced code blocks found in this conversation.'); return; }
        await downloadBlob(out, 'text/plain', `hashcortx-${proj}-code-${ts}.txt`);
      } else if (fmt === 'pdf') {
        await exportAsPdf(`hashcortx-${proj}-${ts}.pdf`);
      }
    }

    function buildMarkdown() {
      const lines = [];
      lines.push(`# HashCortx Coder — Chat Export`);
      lines.push(`Date: ${new Date().toLocaleString()}`);
      if (sharedState.projectRoot) lines.push(`Project: ${sharedState.projectRoot}`);
      lines.push('');
      for (const m of conversationMsgs) {
        if (m.role === 'system') continue;
        const role = m.role === 'user' ? '## User' : '## Agent';
        lines.push(role); lines.push('');
        lines.push(m.content || ''); lines.push('');
      }
      return lines.join('\n');
    }

    function buildPlainText() {
      const lines = [];
      lines.push(`HashCortx Coder — Chat Export`);
      lines.push(`Date: ${new Date().toLocaleString()}`);
      if (sharedState.projectRoot) lines.push(`Project: ${sharedState.projectRoot}`);
      lines.push('═'.repeat(60));
      for (const m of conversationMsgs) {
        if (m.role === 'system') continue;
        lines.push('');
        lines.push((m.role === 'user' ? '>>> USER' : '<<< AGENT') + ' ' + '─'.repeat(40));
        lines.push(m.content || '');
      }
      return lines.join('\n');
    }

    function buildCodeOnly() {
      const out = [];
      const fence = /```(\w*)\n([\s\S]*?)```/g;
      let n = 0;
      for (const m of conversationMsgs) {
        if (!m.content || m.role === 'system') continue;
        let match;
        while ((match = fence.exec(m.content)) !== null) {
          n++;
          const lang = match[1] || 'text';
          out.push(`/* ── block ${n} · ${lang} ── */`);
          out.push(match[2].trimEnd());
          out.push('');
        }
      }
      return out.join('\n');
    }

    // Goes through HC.save: the old <a download> is cancelled outright by
    // this webview (see platform/tauri/save.js), so this reported "Exported"
    // over a file that was never written.
    async function downloadBlob(content, mime, filename) {
      try {
        const result = await window.HC.save.file(filename, content, { mime });
        if (!result.saved) { setStatus('Ready', ''); return; }
        setStatus(`Exported · ${filename}`, 'ok');
      } catch (e) {
        setStatus(`Export failed · ${e?.message || e}`, 'err');
        return;
      }
      setTimeout(() => setStatus('Ready', ''), 2400);
    }

    async function exportAsPdf(filename) {
      // jsPDF is loaded as window.jspdf.jsPDF (UMD bundle, included in index.html)
      const jsPDFCtor = window.jspdf?.jsPDF || window.jsPDF;
      if (!jsPDFCtor) {
        // No jsPDF available — fall back to opening a printable HTML window
        return await exportAsPdfPrintFallback(filename);
      }
      try {
        const pdf = new jsPDFCtor({ unit: 'pt', format: 'a4' });
        const margin = 40;
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const lineH = 12;
        let y = margin;
        const write = (text, opts) => {
          opts = opts || {};
          pdf.setFont(opts.mono ? 'courier' : 'helvetica', opts.bold ? 'bold' : 'normal');
          pdf.setFontSize(opts.size || 9.5);
          pdf.setTextColor(opts.color || '#1a1a1a');
          const split = pdf.splitTextToSize(text || '', pageW - margin * 2);
          for (const line of split) {
            if (y + lineH > pageH - margin) { pdf.addPage(); y = margin; }
            pdf.text(line, margin, y);
            y += lineH;
          }
        };
        write('HashCortx Coder — Chat Export', { size: 14, bold: true });
        write(new Date().toLocaleString(), { size: 8, color: '#666' });
        if (sharedState.projectRoot) write('Project: ' + sharedState.projectRoot, { size: 8, color: '#666' });
        y += 6;
        for (const m of conversationMsgs) {
          if (m.role === 'system') continue;
          y += 4;
          write(m.role === 'user' ? '▸ USER' : '◂ AGENT', {
            size: 9, bold: true,
            color: m.role === 'user' ? '#1e7d4a' : '#1d6a99'
          });
          const text = m.content || '';
          // Split fenced code blocks vs prose so we render them mono
          const re = /```(?:\w*\n)?([\s\S]*?)```/g;
          let last = 0, match;
          while ((match = re.exec(text)) !== null) {
            if (match.index > last) write(text.slice(last, match.index).trim());
            write(match[1].replace(/\n$/, ''), { mono: true, size: 8.5, color: '#222' });
            last = match.index + match[0].length;
          }
          if (last < text.length) write(text.slice(last).trim());
        }
        // Not pdf.save() — jsPDF saves through <a download>, the route this
        // webview cancels, so the status said "Exported" over nothing.
        await downloadBlob(pdf.output('blob'), 'application/pdf', filename);
      } catch (e) {
        console.warn('[CoderMode] PDF export error:', e);
        await exportAsPdfPrintFallback(filename);
      }
    }

    async function exportAsPdfPrintFallback(filename) {
      // Build a styled HTML page and open print dialog — user picks "Save as PDF"
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(filename)}</title>
<style>
body{font:13px/1.55 -apple-system,sans-serif;max-width:780px;margin:32px auto;padding:0 24px;color:#222}
h1{font-size:18px;border-bottom:1px solid #ddd;padding-bottom:8px}
.role{font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-top:18px;margin-bottom:4px}
.user{color:#1e7d4a}.agent{color:#1d6a99}
pre{background:#f4f6f8;border:1px solid #e2e4e8;border-radius:5px;padding:10px;overflow:auto;font:11px/1.45 ui-monospace,Menlo,monospace}
.meta{color:#888;font-size:11px}
</style></head><body>
<h1>HashCortx Coder — Chat Export</h1>
<div class="meta">${esc(new Date().toLocaleString())}</div>
${sharedState.projectRoot ? `<div class="meta">Project: ${esc(sharedState.projectRoot)}</div>` : ''}
${conversationMsgs.filter(m => m.role !== 'system').map(m => `
  <div class="role ${m.role === 'user' ? 'user' : 'agent'}">${m.role === 'user' ? '▸ User' : '◂ Agent'}</div>
  <div>${renderMarkdown(m.content || '')}</div>
`).join('')}
<script>setTimeout(()=>window.print(),300)</script>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) {
        // No window to print from, so offer the page as a file instead.
        await downloadBlob(html, 'text/html', filename.replace(/\.pdf$/, '.html'));
        return;
      }
      w.document.open(); w.document.write(html); w.document.close();
      setStatus('Print dialog opened — choose Save as PDF', 'ok');
      setTimeout(() => setStatus('Ready', ''), 2400);
    }

    // Shared by the rows drawn as the agent works and the rows drawn for changes
    // left over from a previous session.
    const CHANGE_ICONS = {
      svgAccept: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      svgReject: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      svgView: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
      svgFile: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    };

    /**
     * Draw the changes left unanswered when the app last closed.
     *
     * Keep and Undo only ever existed for the run that made the change: the row
     * lives in the message list, and the record it acts on lived in a map in
     * memory. Both went at shutdown, while the saved copy of the file stayed on
     * disk — so a change the user had not answered became one they could no
     * longer undo, and the copy sat in the home directory for good.
     *
     * The records themselves are the durable part, so they are what the list is
     * rebuilt from. Summaries only; the contents are fetched if someone asks.
     */
    async function restorePendingChanges() {
      const msgs = $('cdrMessages');
      if (!msgs || !HC?.undo?.pending) return;
      const pending = await HC.undo.pending();
      if (!pending.length) return;

      const { svgAccept, svgReject, svgView, svgFile } = CHANGE_ICONS;
      const group = document.createElement('div');
      group.className = 'cdr-change-group';
      group.innerHTML = `<div class="cdr-change-group-title">${pending.length} change${pending.length === 1 ? '' : 's'} from your last session — keep or undo</div>`;

      for (const summary of pending) {
        const name = String(summary.path || '').split('/').pop() || summary.path;
        const canUndo = !summary.unrestorable;
        const row = document.createElement('div');
        row.className = 'cdr-change-row pending';
        const previewId = 'chp_' + String(summary.id).replace(/[^a-zA-Z0-9]/g, '');
        row.innerHTML = `
          ${svgFile}
          <span class="cdr-change-file" title="${esc(summary.path || '')}">${esc(name)}</span>
          <span class="cdr-change-stats">${summary.existed ? esc(String(summary.bytes) + ' bytes saved') : 'new file'}</span>
          <div class="cdr-change-actions">
            <button class="cdr-change-btn primary cdr-change-accept">${svgAccept} Keep</button>
            <button class="cdr-change-btn danger cdr-change-reject"${canUndo ? '' : ` disabled title="${esc(summary.unrestorable)}"`}>${svgReject} Undo</button>
            <button class="cdr-change-btn cdr-change-view">${svgView} View</button>
          </div>`;

        row.querySelector('.cdr-change-accept').addEventListener('click', async () => {
          row.classList.remove('pending'); row.classList.add('accepted');
          row.querySelector('.cdr-change-accept').innerHTML = `${svgAccept} Kept`;
          const rejectBtn = row.querySelector('.cdr-change-reject');
          if (rejectBtn) rejectBtn.disabled = true;
          await HC.undo.drop(summary);
        });

        row.querySelector('.cdr-change-reject').addEventListener('click', async () => {
          const btn = row.querySelector('.cdr-change-reject');
          if (!canUndo || btn.disabled) return;
          btn.disabled = true;
          try {
            // restore() fetches the contents itself — the summary does not
            // carry them, and writing it as-is would empty the file.
            await HC.undo.restore(summary);
            row.classList.remove('pending'); row.classList.add('rejected');
            btn.innerHTML = `${svgReject} Undone`;
            const acceptBtn = row.querySelector('.cdr-change-accept');
            if (acceptBtn) acceptBtn.disabled = true;
            terminalLog(`[undo] restored ${summary.path}`, 'cdr-bash-preview');
            if (summary.existed) addAIFileToExplorer(summary.path, 'write');
          } catch (e) {
            btn.disabled = false;
            btn.innerHTML = `${svgReject} Undo failed`;
            btn.title = String(e?.message || e);
            terminalLog(`[undo] could not restore ${summary.path}: ${e?.message || e}`, 'cdr-terminal-error');
          }
        });

        // What Undo would put back. Not a diff: the row is being drawn before
        // anyone has asked for the file, so there is nothing to compare against
        // until they do.
        const preview = document.createElement('div');
        preview.className = 'cdr-diff-preview';
        preview.id = previewId;
        preview.style.display = 'none';
        row.querySelector('.cdr-change-view').addEventListener('click', async () => {
          if (preview.style.display === 'block') { preview.style.display = 'none'; return; }
          preview.style.display = 'block';
          if (preview.dataset.loaded) return;
          preview.dataset.loaded = '1';
          const full = summary.existed ? await HC.undo.load(summary.id) : null;
          const body = summary.existed
            ? `<pre><code>${esc(full?.content ?? '')}</code></pre>`
            : '<pre><code>This change created the file. Undoing it deletes the file again.</code></pre>';
          preview.innerHTML = `
            <div class="cdr-diff-header">
              <span>${esc(summary.path || name)}</span>
              <span style="color:var(--cdr-text-muted)">what Undo would put back</span>
            </div>
            <div class="cdr-diff-body">${body}</div>`;
        });

        group.appendChild(row);
        group.appendChild(preview);
      }
      msgs.appendChild(group);
      scrollMessages();
    }

    function addChangeEntry(name, path, kind, content) {
      // What the file held before this change. Captured by HC.code.undo at the
      // moment of the write, which is the only point where it still exists.
      const checkpoint = HC?.undo?.lastFor(path) || null;
      const canUndo = !!HC?.undo?.canRestore(checkpoint);
      const target = activeContentEl || $('cdrMessages')?.querySelector('.cdr-msg.assistant:last-of-type .cdr-msg-content');
      if (!target) return;
      const safeId = 'ch_' + Math.random().toString(36).slice(2, 9);
      const row = document.createElement('div');
      row.className = 'cdr-change-row pending';

      // The real before/after, not the length of whatever the tool echoed back.
      // For a patch there is no `content` argument at all, so the old count was
      // measuring the tool's JSON result.
      const before = checkpoint?.existed ? (checkpoint.content ?? '') : '';
      // `checkpoint.after` is what was actually written. Preferred over the
      // tool's arguments because patch_file has no content argument at all.
      const after = kind === 'delete'
        ? ''
        : String(checkpoint?.after ?? content ?? '');
      const rows = window.HCDiff ? window.HCDiff.diffLines(before, after) : [];
      const tally = window.HCDiff ? window.HCDiff.countChanges(rows) : { added: 0, removed: 0 };
      const stats = rows.length
        ? `+${tally.added} −${tally.removed}`
        : '';
      const { svgAccept, svgReject, svgView } = CHANGE_ICONS;
      row.innerHTML = `
        ${CHANGE_ICONS.svgFile}
        <span class="cdr-change-file">${esc(name)}</span>
        <span class="cdr-change-stats">${esc(stats)}</span>
        <div class="cdr-change-actions">
          <button class="cdr-change-btn primary cdr-change-accept">${svgAccept} Keep</button>
          <button class="cdr-change-btn danger cdr-change-reject"${canUndo ? '' : ' disabled title="The previous contents could not be saved, so this change cannot be undone."'}>${svgReject} Undo</button>
          <button class="cdr-change-btn cdr-change-view">${svgView} View</button>
        </div>`;
      row.querySelector('.cdr-change-accept').addEventListener('click', () => {
        row.classList.remove('pending'); row.classList.add('accepted');
        const btn = row.querySelector('.cdr-change-accept');
        if (btn) btn.innerHTML = `${svgAccept} Kept`;
        const rejectBtn = row.querySelector('.cdr-change-reject');
        if (rejectBtn) rejectBtn.disabled = true;
        // The change is staying, so the saved copy is dead weight.
        HC?.undo?.drop(checkpoint);
      });
      row.querySelector('.cdr-change-reject').addEventListener('click', async () => {
        const btn = row.querySelector('.cdr-change-reject');
        if (!canUndo || btn?.disabled) return;
        btn.disabled = true;
        try {
          await HC.undo.restore(checkpoint);
          row.classList.remove('pending'); row.classList.add('rejected');
          btn.innerHTML = `${svgReject} Undone`;
          const acceptBtn = row.querySelector('.cdr-change-accept');
          if (acceptBtn) acceptBtn.disabled = true;
          terminalLog(`[undo] restored ${path}`, 'cdr-bash-preview');
          if (checkpoint.existed) addAIFileToExplorer(path, 'write');
        } catch (e) {
          // Say so rather than showing "Rejected" over a file that did not change.
          btn.disabled = false;
          btn.innerHTML = `${svgReject} Undo failed`;
          btn.title = String(e?.message || e);
          terminalLog(`[undo] could not restore ${path}: ${e?.message || e}`, 'cdr-terminal-error');
        }
      });
      row.querySelector('.cdr-change-view').addEventListener('click', () => {
        const preview = document.getElementById(safeId);
        if (preview) {
          const isOpen = preview.style.display === 'block';
          preview.style.display = isOpen ? 'none' : 'block';
        }
      });
      target.appendChild(row);

      // Inline diff — what changed, not what the file now says.
      const preview = document.createElement('div');
      preview.className = 'cdr-diff-preview';
      preview.id = safeId;
      preview.style.display = 'none';

      let body;
      if (!rows.length) {
        body = `<pre><code>${esc(content || '')}</code></pre>`;
      } else if (!checkpoint?.existed && kind !== 'delete') {
        // A new file has nothing to compare against; show it as written.
        body = `<pre><code>${esc(after)}</code></pre>`;
      } else {
        const shown = window.HCDiff.collapseUnchanged(rows, 3);
        body = '<pre class="cdr-diff-lines">' + shown.map((r) => {
          if (r.type === 'gap') {
            return `<span class="cdr-diff-gap">    ⋯ ${r.hidden} unchanged line${r.hidden === 1 ? '' : 's'}</span>`;
          }
          const sign = r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' ';
          const no = r.type === 'add' ? r.afterNo : r.beforeNo;
          return `<span class="cdr-diff-line ${r.type}">${String(no ?? '').padStart(4, ' ')} ${sign} ${esc(r.text)}</span>`;
        }).join('\n') + '</pre>';
      }

      const heading = checkpoint?.unrestorable
        ? `cannot be undone — ${esc(checkpoint.unrestorable)}`
        : (!checkpoint?.existed && kind !== 'delete') ? 'new file' : `+${tally.added} −${tally.removed}`;

      preview.innerHTML = `
        <div class="cdr-diff-header">
          <span>${esc(name)}</span>
          <span style="color:var(--cdr-text-muted)">${heading}</span>
        </div>
        <div class="cdr-diff-body">${body}</div>`;
      target.appendChild(preview);
      scrollMessages();
    }

    // ── Build tools + system ──────────────────────────────────
    function buildTools() {
      return (HC?.code?.TOOL_DEFINITIONS || []).map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(t.parameters).map(([k, v]) =>
                [k, (v && typeof v === 'object' && v.type) ? v : { type: 'string', description: String(v) }]
              )
            ),
            required: Object.keys(t.parameters).filter(k => !['reason', 'cwd', 'file_ext'].includes(k)),
          }
        }
      }));
    }

    function sysPrompt(extra) {
      // ── Surgical system prompt — Claude Code / Codex style ──
      // Terse. No prose. One change at a time. Prefer tool calls over speech.
      const root = sharedState.projectRoot;
      let homeDir = sharedState.homeDir || '';
      if (!homeDir && root) {
        const parts = root.split('/').filter(Boolean);
        if (parts[0] === 'Users' && parts[1]) homeDir = `/Users/${parts[1]}`;
        else if (parts[0] === 'home' && parts[1]) homeDir = `/home/${parts[1]}`;
      }

      const lines = [
        'You are HashCortx Coder — a precise coding agent.',
        'Rules:',
        '1. One change at a time. Use tool calls for any file/shell action — do not narrate plans.',
        '2. Replies must be ≤3 short sentences unless the user asks for detail.',
        '3. For code edits, return only the changed region. No surrounding context.',
        '4. Never call tools for greetings or conversational questions — answer in plain text.',
        '5. Blocked paths: /System, /etc, /private, /usr, /bin — refuse without asking.',
      ];
      if (root) {
        lines.push(`Project root: ${root}`);
        lines.push(`6. If the project directory is empty or new, immediately start creating files — do NOT explore the filesystem first.`);
        if (sharedState.activeFile) lines.push(`Active file: ${sharedState.activeFile}`);
      } else {
        lines.push(`No project open. Home: ${homeDir || 'unknown'}. Ask user to open a folder for write ops.`);
      }

      // Optional memory recall — kept terse, opt-in only
      try {
        const H = window._H;
        if (H?.memRecall) {
          const task = conversationMsgs.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
          const scored = H.memRecall(task, 4);
          if (scored && scored.length) {
            lines.push('Memory (silent context, do not recite):');
            scored.forEach(f => lines.push(`  - ${f.key}: ${String(f.value).slice(0, 120)}`));
          }
        }
      } catch {}

      const richBase = HC?.code?.SYSTEM_PROMPT || '';
      const out = (richBase ? richBase + '\n' : '') + lines.join('\n');
      return out + (extra ? '\n' + extra : '');
    }

    // History compression lives in js/agent-context.js so it can be tested.
    //
    // It used to cut EVERY tool result to 800 characters on every call — not
    // just old ones, but the file the agent had asked for one step earlier.
    // read_file returns up to 100 KB and the model saw the first 800 bytes of
    // it, which is why the agent so often "forgot" what it had just read. It
    // now spends a character budget newest-first, so recent results arrive
    // whole and only older ones give way.
    const compressHistory = (msgs) => window.HCAgentContext.compressHistory(msgs);

    // ── Core agent loop — renders inline into a bubble ────────
    async function agentLoop(messages, tools, contentEl, label, signal) {
      const H = window._H;
      const temperature = H?.selectedTemperature ? Math.min(H.selectedTemperature(), 0.35) : 0.15;
      activeContentEl = contentEl;
      const policy = window.HCAgentPolicy;
      let iter = 0;
      // Progress tracking, so the loop can tell an agent that is working from
      // one that is going in circles. The old fixed cap could not: it stopped
      // both at the same number and reported both as "paused".
      const seenReadTargets = new Set();
      let stalledIterations = 0;
      let lastStop = null;
      let thinkEl = appendThinking(contentEl);
      let reasoningEl = null; // real-time reasoning display

      for (;;) {
        const verdict = policy.shouldContinue({
          iteration: iter,
          stalledIterations,
          madeProgress: stalledIterations === 0,
        });
        if (!verdict.continue) { lastStop = verdict; break; }
        iter++;

        setStatus(`${label ? label + ' · ' : ''}Thinking…`, 'thinking');
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        // A nudge is passed on a COPY, so it never persists into
        // conversationMsgs and colour the next user turn.
        const baseMsgs = verdict.nudge
          ? [...messages, { role: 'user', content: verdict.nudge }]
          : messages;
        const callMessages = compressHistory(baseMsgs);

        cdrTraceAdd('Step', `Iter ${iter}${label ? ' · ' + label : ''} · calling model`, 'run');
        let turn;
        try {
          turn = await callWithRouter(callMessages, tools, temperature, signal, coderModel);
        } catch (e) {
          thinkEl?.remove(); thinkEl = null;
          reasoningEl?.remove(); reasoningEl = null;
          cdrTraceAdd('Error', e?.message || String(e), 'err');
          // Show error inline in the bubble
          const errDiv = document.createElement('div');
          errDiv.className = 'cdr-msg-text';
          errDiv.style.color = 'var(--cdr-error)';
          errDiv.style.borderLeft = '2px solid var(--cdr-error)';
          errDiv.style.paddingLeft = '10px';
          errDiv.style.margin = '8px 0';
          errDiv.innerHTML = `<b>Error</b><br>${esc(e?.message || String(e))}`;
          contentEl.appendChild(errDiv);
          scrollMessages();
          throw e;
        }
        thinkEl?.remove(); thinkEl = null;

        // Show reasoning content between iterations (model's thought process)
        if (turn.content && turn.tool_calls?.length) {
          if (!reasoningEl) {
            reasoningEl = document.createElement('div');
            reasoningEl.className = 'cdr-thinking-stream';
            contentEl.appendChild(reasoningEl);
          }
          reasoningEl.innerHTML = `<div class="cdr-thinking-hd">Reasoning</div>${esc(turn.content)}`;
          reasoningEl.classList.remove('empty');
          scrollMessages();
        }

        if (turn.tool_calls?.length) {
          H.appendAssistantToolCallTurn(messages, turn.content, turn.tool_calls); // always append to real history

          // Independent reads run together. A turn that opens six files used to
          // make six sequential round trips through Rust for no reason. Writes
          // and shell commands still run alone and in order — batching may only
          // ever merge ADJACENT reads, so a read that follows a write still
          // sees the write. The rules live in js/agent-policy.js and are tested.
          const batches = policy.planBatches(turn.tool_calls);

          // Results are collected per call and appended in the ORIGINAL order,
          // whatever order they finish in: the provider APIs require each tool
          // result to follow its call, and a shuffled history is rejected.
          const results = new Map();

          async function runOne(call) {
            // Shell preview goes to the terminal before the command runs.
            if (call.name === 'shell_run') {
              const cmd = call.arguments?.command || '';
              const args = (call.arguments?.args || []).join(' ');
              const cwd = call.arguments?.cwd || sharedState.projectRoot || '';
              const preview = cwd ? `cd ${cwd} && ${cmd} ${args}` : `${cmd} ${args}`;
              terminalLog('[' + call.name + ' preview] ' + preview, 'cdr-bash-preview');
            }

            const toolEl = appendToolBlock(contentEl, call.name, call.arguments);
            const pathHint = call.arguments?.path || call.arguments?.dir || call.arguments?.command || '';
            cdrTraceAdd('Tool', call.name + (pathHint ? ' · ' + String(pathHint).split('/').pop() : ''), 'run');
            const t0 = performance.now();
            let resultStr, ok = true;
            try {
              const def = (HC?.code?.TOOL_DEFINITIONS || []).find(t => t.name === call.name);
              if (!def) throw new Error('Unknown tool: ' + call.name);
              const raw = await def.fn(call.arguments || {});
              resultStr = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            } catch (e) {
              resultStr = JSON.stringify({ error: String(e?.message || e) }); ok = false;
            }
            const ms = Math.round(performance.now() - t0);
            cdrTraceAdd('Tool', call.name + ' · ' + ms + 'ms', ok ? 'ok' : 'err');
            finalizeToolBlock(toolEl, resultStr, ok, ms);

            if (call.name === 'write_file' || call.name === 'patch_file') {
              const fp = call.arguments?.path || '';
              addChangeEntry(fp.split('/').slice(-1)[0] || fp, fp, 'write',
                call.arguments?.content || call.arguments?.patch || resultStr);
              if (ok && fp) addAIFileToExplorer(fp, 'write');
            } else if (call.name === 'delete_file') {
              const fp = call.arguments?.path || '';
              addChangeEntry(fp.split('/').slice(-1)[0] || fp, fp, 'delete', '(file deleted)');
              if (ok && fp) addAIFileToExplorer(fp, 'delete');
            }
            results.set(call, resultStr);
          }

          for (const batch of batches) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            setStatus(batch.length > 1
              ? `${batch.length} tools…`
              : `${batch[0].name}…`, 'run');
            // A failure inside runOne is already turned into an error result,
            // so allSettled is belt-and-braces: one tool must never abort the
            // rest of its batch.
            await Promise.allSettled(batch.map(runOne));
          }

          // Original order, so every result follows the call it answers.
          for (const call of turn.tool_calls) {
            H.appendToolResult(messages, call, results.get(call) ?? JSON.stringify({ error: 'no result' }));
          }

          // Is this agent still getting somewhere, or reading the same files
          // round and round? The stall counter is what tells them apart.
          if (policy.iterationMadeProgress(turn.tool_calls, seenReadTargets)) stalledIterations = 0;
          else stalledIterations++;

          thinkEl = appendThinking(contentEl);
          continue;
        }

        // Final answer — hide reasoning, show result
        reasoningEl?.remove(); reasoningEl = null;
        const finalText = turn.content || '';
        if (!finalText.trim()) {
          cdrTraceAdd('Done', 'Empty response from model', 'warn');
          appendTextToBubble(contentEl, '*No response from model. Try again or check your model settings.*');
        } else {
          cdrTraceAdd('Done', (label || 'Agent') + ' · ' + finalText.length + ' chars', 'ok');
          appendTextToBubble(contentEl, finalText);
        }
        return finalText;
      }
      // The budget ran out while the model was still calling tools. Strip any
      // dangling tool turns so the next user message does not produce an
      // invalid sequence like [tool, user], which most provider APIs reject.
      reasoningEl?.remove(); reasoningEl = null;
      thinkEl?.remove(); thinkEl = null;
      while (messages.length && messages[messages.length - 1].role === 'tool') messages.pop();
      while (messages.length && messages[messages.length - 1].role === 'assistant' &&
             Array.isArray(messages[messages.length - 1].tool_calls)) messages.pop();

      // Say WHY it stopped. "Task paused" was shown whether the agent had run
      // out of budget or spent four turns re-reading the same file, and the
      // user could not tell which — so they could not tell whether replying
      // "continue" would help or repeat the same loop.
      const stop = lastStop || { reason: 'unknown', message: 'Stopped. Reply to continue.' };
      cdrTraceAdd('Done', `Stopped: ${stop.reason} after ${iter} steps`, 'warn');
      appendTextToBubble(contentEl, `*${stop.message}*`);
      return '';
    }

    // ── Main send ─────────────────────────────────────────────
    async function startRun() {
      const taskInput = $('cdrTaskInput');
      const task = taskInput?.value?.trim();
      if (!task) { taskInput?.focus(); return; }

      // Clear input and resize
      taskInput.value = '';
      autoResize(taskInput);

      // Show user message
      appendUserMsg(task);

      // Auto-extract memory from user message
      try { window._H?.memAutoExtract?.(task); } catch {}

      // Bootstrap conversation on first message
      if (!conversationMsgs.length) {
        conversationMsgs = [{ role: 'system', content: sysPrompt() }];
      }
      conversationMsgs.push({ role: 'user', content: task });

      const runBtn  = $('cdrRunBtn');
      const stopBtn = $('cdrStopBtn');
      if (runBtn)  runBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = '';

      if (runAbort) runAbort.abort();
      runAbort = new AbortController();
      const { signal } = runAbort;

      setStatus('Thinking…', 'thinking');
      cdrTraceReset('Run started');

      try {
        if (agentCount === 1) {
          await runSingleTurn(signal);
        } else {
          await runMultiTurn(task, agentCount, signal);
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          const c = appendAssistantBubble('HashCortX Coder');
          if (c) appendTextToBubble(c, '*Stopped.*');
          setStatus('Stopped', '');
        } else {
          // Error already shown in bubble by agentLoop, just update status
          setStatus(e?.message || 'Error', 'err');
          console.error('[CoderMode] run failed:', e);
        }
      } finally {
        if (runBtn)  runBtn.style.display = '';
        if (stopBtn) stopBtn.style.display = 'none';
        runAbort = null;
        setRouterChip('Auto', '');
        // Light up Hash D Island. app.js fires this for a chat turn, but Coder
        // has its own loop and never reached that line — so the one kind of run
        // long enough that you would switch away from it was the one that never
        // told you it had finished. Metadata only: a model label at most.
        try { window.HC?.notch?.finished((coderModel || '').split(':').pop() || 'Coder'); } catch {}
      }
    }

    async function runSingleTurn(signal) {
      const tools     = buildTools();
      const contentEl = appendAssistantBubble('HashCortX Coder');
      const finalText = await agentLoop(conversationMsgs, tools, contentEl, '', signal);
      if (finalText) conversationMsgs.push({ role: 'assistant', content: finalText });
      saveCoderState();
      setStatus('Ready', '');
    }

    async function runMultiTurn(task, count, signal) {
      const H = window._H;

      // Multi-agent tasks need a project root to be useful — bail early otherwise
      if (!sharedState.projectRoot) {
        const el = appendAssistantBubble('HashCortX Coder');
        appendTextToBubble(el, 'Multi-agent mode works best with a project open. Click **Open Project** to select your project folder, then try again.');
        setStatus('Ready', '');
        return;
      }

      // Boss: decompose
      const bossEl   = appendAssistantBubble('Boss');
      const thinkEl  = appendThinking(bossEl);
      const planMsgs = [
        { role: 'system', content: `You are a task planner. Split the user's request into exactly ${count - 1} independent coding sub-tasks. Reply ONLY with a valid JSON array:\n[{"id":"1","task":"..."},...]` },
        { role: 'user',   content: `Decompose for ${count - 1} parallel agents: ${task}` }
      ];
      let subTasks;
      try {
        const planTurn = await callWithRouter(planMsgs, [], 0.25, signal, coderModel);
        thinkEl?.remove();
        const m = (planTurn.content || '').match(/\[[\s\S]*?\]/);
        subTasks = m ? JSON.parse(m[0]) : null;
      } catch { thinkEl?.remove(); }

      if (!subTasks?.length) {
        subTasks = Array.from({ length: count - 1 }, (_, i) => ({
          id: String(i + 1), task: `Part ${i + 1}: ${task}`
        }));
      }
      appendTextToBubble(bossEl, `Coordinating **${count - 1} sub-agent${count - 1 > 1 ? 's' : ''}** for this task.`);
      setStatus('Agents running…', 'thinking');

      // Workers — each gets its own bubble and independent message history
      cdrTraceAdd('Boss', `Decomposed into ${subTasks.length} sub-task${subTasks.length !== 1 ? 's' : ''}`, 'ok');
      const results = await Promise.all(subTasks.map(async (st, i) => {
        cdrTraceAdd(`Agent ${i + 2}`, (st.task || task).slice(0, 60), 'run');
        const wEl   = appendAssistantBubble(`Agent ${i + 2}`);
        const wMsgs = [
          { role: 'system', content: sysPrompt(`You are sub-agent ${i + 2} of ${count}. Focus only on your assigned task.`) },
          { role: 'user',   content: st.task || task }
        ];
        try {
          const result = await agentLoop(wMsgs, buildTools(), wEl, `Agent ${i + 2}`, signal);
          cdrTraceAdd(`Agent ${i + 2}`, 'Finished', 'ok');
          return result;
        } catch (e) {
          cdrTraceAdd(`Agent ${i + 2}`, e?.message || 'Failed', 'err');
          appendTextToBubble(wEl, `**Error:** ${esc((e.message || '').slice(0, 80))}`);
          return '';
        }
      }));

      // Synthesis — boss combines all agent output into a final answer
      const synthEl   = appendAssistantBubble('Boss — Synthesis');
      const agentSummary = results
        .map((r, i) => `### Agent ${i + 2}\n${(r || '(no output)').slice(0, 1200)}`)
        .join('\n\n');
      const synthMsgs = [
        { role: 'system', content: sysPrompt('You are the synthesis boss. Your job is to combine the sub-agent results into one clear, complete final answer. Do NOT call any tools — write your synthesis directly.') },
        {
          role: 'user',
          content: `Original task: ${task}\n\nProject: ${sharedState.projectRoot}\n\nSub-agent results:\n${agentSummary}\n\nWrite a clear synthesis: what was done, what changed, and what (if anything) still needs attention.`
        }
      ];
      setStatus('Synthesizing…', 'thinking');
      const finalText = await agentLoop(synthMsgs, [], synthEl, 'Boss', signal);
      if (finalText) conversationMsgs.push({ role: 'assistant', content: finalText });
      saveCoderState();
      setStatus('Ready', '');
    }

    function stopRun() {
      if (runAbort) { runAbort.abort(); runAbort = null; }
      if ($('cdrRunBtn'))  $('cdrRunBtn').style.display  = '';
      if ($('cdrStopBtn')) $('cdrStopBtn').style.display = 'none';
      setStatus('Stopped', '');
    }

    // ── Audit log ─────────────────────────────────────────────
    async function showAuditLog() {
      const modal = $('hcAuditModal');
      if (!modal) return;
      modal.classList.add('open');
      const body = $('hcAuditBody');
      if (!body) return;
      body.innerHTML = '<div class="hc-audit-empty">Loading…</div>';
      try {
        if (!HC?.isTauri) {
          body.innerHTML = '<div class="hc-audit-empty">Audit log is only available in the desktop app.</div>';
          return;
        }
        const log = await HC.invoke('audit_log_read');
        if (!log?.trim()) {
          body.innerHTML = '<div class="hc-audit-empty">No audit entries yet.</div>';
        } else {
          const pre = document.createElement('pre');
          pre.className = 'hc-audit-log';
          pre.textContent = log;
          body.innerHTML = '';
          body.appendChild(pre);
          pre.scrollTop = pre.scrollHeight;
        }
      } catch (e) {
        body.innerHTML = `<div class="hc-audit-empty">Error: ${esc(String(e?.message || e))}</div>`;
      }
    }

    // showAuditLog goes out too: the audit dialog is shared chrome, opened
    // from the About panel as well as from Coder, and the About button was
    // reaching for a name that only exists inside this closure.
    return { mount, destroy, remount, showAuditLog };
  })();

  // ── Wire audit modal close (shared) ──────────────────────────
  function initSharedDom() {
    const auditClose = document.getElementById('hcAuditClose');
    const auditModal = document.getElementById('hcAuditModal');
    if (auditClose) auditClose.addEventListener('click', () => auditModal?.classList.remove('open'));
    if (auditModal) auditModal.addEventListener('click', e => { if (e.target === auditModal) auditModal.classList.remove('open'); });
  }


  // ══════════════════════════════════════════════════════════════
  // Coder layout: resizable, collapsible panels that stay put
  //
  // The panels were three fixed columns and a 140px terminal, none of them
  // adjustable. At the window's 960px minimum the two side columns took 480px
  // — half the app — and the terminal showed about six lines, which is not
  // enough to read a stack trace or the tail of a build.
  //
  // Sizes live in CSS custom properties on .cdr-body, so dragging is just
  // writing a number, and a collapsed panel is a width of zero. Everything is
  // remembered, because a layout you must rebuild on every launch is not one
  // you have chosen.
  // ══════════════════════════════════════════════════════════════
  const CDR_LAYOUT_KEY = 'hashcortx_coder_layout_v1';
  const CDR_LAYOUT_DEFAULTS = { sideW: 250, termH: 220, sideHidden: false, termHidden: false };
  const CDR_LIMITS = { sideMin: 170, sideMax: 460, termMin: 90, termMax: 640 };

  let cdrLayout = { ...CDR_LAYOUT_DEFAULTS };

  function cdrLoadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(CDR_LAYOUT_KEY) || '{}');
      cdrLayout = { ...CDR_LAYOUT_DEFAULTS, ...saved };
    } catch { cdrLayout = { ...CDR_LAYOUT_DEFAULTS }; }
  }
  function cdrSaveLayout() {
    try { localStorage.setItem(CDR_LAYOUT_KEY, JSON.stringify(cdrLayout)); } catch {}
  }

  const cdrClamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function cdrApplyLayout() {
    const body = $('cdrBody');
    if (!body) return;
    cdrLayout.sideW = cdrClamp(Number(cdrLayout.sideW) || CDR_LAYOUT_DEFAULTS.sideW,
                               CDR_LIMITS.sideMin, CDR_LIMITS.sideMax);
    cdrLayout.termH = cdrClamp(Number(cdrLayout.termH) || CDR_LAYOUT_DEFAULTS.termH,
                               CDR_LIMITS.termMin, CDR_LIMITS.termMax);
    body.style.setProperty('--cdr-side-w', cdrLayout.sideW + 'px');
    body.style.setProperty('--cdr-term-h', cdrLayout.termH + 'px');
    body.classList.toggle('cdr-side-hidden', !!cdrLayout.sideHidden);
    body.classList.toggle('cdr-term-hidden', !!cdrLayout.termHidden);
    if (cdrLayout.termHidden) body.classList.remove('cdr-term-full');

    const expandBtn = $('cdrTerminalExpand');
    if (expandBtn) expandBtn.textContent = body.classList.contains('cdr-term-full') ? 'Restore' : 'Expand';
  }

  /** Wire one split handle. `axis` is 'x' (side width) or 'y' (terminal height). */
  function cdrWireSplit(handleId, axis) {
    const handle = $(handleId);
    const body = $('cdrBody');
    if (!handle || !body) return;

    let startPos = 0, startVal = 0, dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      if (axis === 'x') {
        cdrLayout.sideW = cdrClamp(startVal + (e.clientX - startPos), CDR_LIMITS.sideMin, CDR_LIMITS.sideMax);
      } else {
        // The terminal grows as the pointer moves UP, so the delta is inverted.
        cdrLayout.termH = cdrClamp(startVal - (e.clientY - startPos), CDR_LIMITS.termMin, CDR_LIMITS.termMax);
      }
      cdrApplyLayout();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      body.classList.remove('cdr-dragging', 'cdr-dragging-x', 'cdr-dragging-y');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cdrSaveLayout();
    };

    handle.addEventListener('pointerdown', (e) => {
      // Dragging a hidden panel back open is confusing; use the rail instead.
      if (axis === 'x' && cdrLayout.sideHidden) return;
      if (axis === 'y' && cdrLayout.termHidden) return;
      dragging = true;
      startPos = axis === 'x' ? e.clientX : e.clientY;
      startVal = axis === 'x' ? cdrLayout.sideW : cdrLayout.termH;
      body.classList.add('cdr-dragging', axis === 'x' ? 'cdr-dragging-x' : 'cdr-dragging-y');
      body.classList.remove('cdr-term-full');
      // Listen on the window, not the handle: the pointer routinely outruns a
      // 6px target, and a drag that stops when you move too fast is worse than
      // no drag at all.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });

    handle.addEventListener('dblclick', () => {
      if (axis === 'x') cdrLayout.sideW = CDR_LAYOUT_DEFAULTS.sideW;
      else cdrLayout.termH = CDR_LAYOUT_DEFAULTS.termH;
      cdrApplyLayout(); cdrSaveLayout();
    });

    // Keyboard: a 6px drag target is unusable without a pointer.
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 12;
      const key = e.key;
      let handled = true;
      if (axis === 'x' && key === 'ArrowLeft') cdrLayout.sideW -= step;
      else if (axis === 'x' && key === 'ArrowRight') cdrLayout.sideW += step;
      else if (axis === 'y' && key === 'ArrowUp') cdrLayout.termH += step;
      else if (axis === 'y' && key === 'ArrowDown') cdrLayout.termH -= step;
      else handled = false;
      if (handled) { e.preventDefault(); cdrApplyLayout(); cdrSaveLayout(); }
    });
  }

  function cdrInitLayout() {
    const body = $('cdrBody');
    if (!body) return;
    cdrLoadLayout();
    cdrApplyLayout();

    cdrWireSplit('cdrSplitX', 'x');
    cdrWireSplit('cdrSplitY', 'y');

    const setSideHidden = (hidden) => {
      cdrLayout.sideHidden = hidden; cdrApplyLayout(); cdrSaveLayout();
    };
    $('cdrSideCollapse')?.addEventListener('click', () => setSideHidden(true));
    $('cdrSideRail')?.addEventListener('click', () => setSideHidden(false));

    $('cdrTerminalCollapse')?.addEventListener('click', () => {
      cdrLayout.termHidden = !cdrLayout.termHidden;
      cdrApplyLayout(); cdrSaveLayout();
    });
    $('cdrTerminalExpand')?.addEventListener('click', () => {
      // Expand is a view state, not a size: leaving the dragged height alone
      // means Restore puts back exactly what the user had chosen.
      if (cdrLayout.termHidden) { cdrLayout.termHidden = false; cdrApplyLayout(); cdrSaveLayout(); return; }
      body.classList.toggle('cdr-term-full');
      cdrApplyLayout();
    });

    // Files / Chats tabs.
    document.querySelectorAll('.cdr-side-tab[data-cdr-side-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const want = tab.getAttribute('data-cdr-side-tab');
        document.querySelectorAll('.cdr-side-tab[data-cdr-side-tab]').forEach((t) => {
          const on = t === tab;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.cdr-side-pane[data-cdr-side-pane]').forEach((pane) => {
          pane.classList.toggle('active', pane.getAttribute('data-cdr-side-pane') === want);
        });
        cdrLayout.sideTab = want; cdrSaveLayout();
      });
    });
    if (cdrLayout.sideTab) {
      document.querySelector(`.cdr-side-tab[data-cdr-side-tab="${cdrLayout.sideTab}"]`)?.click();
    }
  }

  function init() {
    if (!window._H) { setTimeout(init, 150); return; }
    initSharedDom();
    cdrInitLayout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public exports ─────────────────────────────────────────
  window.CoderMode = CoderMode;

  (window._registeredModes = window._registeredModes || {})["code"] = {
    label:     "Coder",
    bodyClass: "coder-mode",
    appClass:  null,
    fullscreen: true,
    btnId:     "tabCode",
    mount:     () => { window.CoderMode?.mount?.(); window.CoderMode?.remount?.(); },
    destroy:   () => window.CoderMode?.destroy?.(),
  };

  // Legacy HC_CODE kept for backward compat (used by hashcoder.js tools)
  window.HC_CODE = {
    run: legacyRun,
    pickProject: async () => {
      if (!window.HC?.isTauri) return;
      try {
        const folder = await HC.invoke('plugin:dialog|open', { directory: true, multiple: false, title: 'Open Project Folder' }).catch(() => null);
        if (folder && typeof folder === 'string') sharedState.projectRoot = folder;
      } catch {}
    },
    // Opens the modal AND fills it. This used to only add the open class, so
    // callers outside Coder got an empty dialog — the function that actually
    // reads the log sits inside the CoderMode closure, which is why it is
    // reached through CoderMode rather than named directly here.
    showAuditLog: () => CoderMode.showAuditLog(),
    afterRender: injectAllToolBlocks,
    get state() { return sharedState; },
  };

})();
