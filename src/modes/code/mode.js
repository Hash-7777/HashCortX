// =============================================================
// modes/code/mode.js — HashCoder Coder Mode (Full-screen God Agent)
//
// Loaded after app.js. Uses window._H bridge for API access.
// Exposes window.CoderMode for app.js lifecycle calls.
// Exposes window.HC_CODE for legacy hashcoder.js tool access.
// =============================================================

(function () {
  'use strict';

  const $ = id => document.getElementById(id);


  /**
   * What each tool did, as one short word.
   *
   * A run used to read as a list of function names — `read_file`, `grep_code`,
   * `fs_search_files` — which is the agent's vocabulary, not the user's. The
   * question being answered while a run scrolls past is "what is it doing",
   * and a verb answers that where an identifier does not.
   *
   * A tool with no entry falls back to its own name, so a new tool appears in
   * the run immediately rather than waiting for this table to catch up.
   */
  const TOOL_VERBS = {
    read_file: 'READ', write_file: 'WROTE', patch_file: 'EDIT',
    list_dir: 'LIST', delete_file: 'DELETE', move_file: 'MOVE',
    fuzzy_find: 'FIND', grep_code: 'GREP', search_files: 'FIND',
    shell_run: 'SHELL', web_search: 'SEARCH', fetch_url: 'FETCH',
    search_knowledge: 'KB', execute_python: 'PYTHON',
    current_datetime: 'TIME', calculate: 'CALC',
    remember_fact: 'REMEMBER', recall_facts: 'RECALL',
    placeholder_images: 'IMAGES', find_photos: 'PHOTOS', update_plan: 'PLAN', save_lesson: 'LESSON',
  };
  const toolVerb = (name) => TOOL_VERBS[name] || window.HCMcp?.stepOf(name)?.verb || String(name || '').toUpperCase();

  /** The one argument worth showing beside the verb. */
  function toolObject(name, args) {
    const a = args || {};
    if (name === 'update_plan') return window.HCCodePlan?.stepLine(a) || '';
    if (name === 'shell_run') {
      return [a.command, ...(Array.isArray(a.args) ? a.args : [])].join(' ').trim();
    }
    if (name === 'move_file') return `${shownPath(a.from)} → ${shownPath(a.to)}`;
    if (/^sys_/.test(name)) return window.HCMcp?.stepOf(name)?.object || '';   // a connected system's tool
    const place = a.path || a.dir || a.file;
    if (place) return shownPath(place);
    return String(a.query || a.subject || a.url || a.pattern || a.expression || a.key || '');
  }

  /** A path as a step shows it: from the project's folder, and the folder itself by its name. */
  function shownPath(p) {
    const raw = String(p || ''), root = String(sharedState.projectRoot || '').replace(/[\\/]+$/, '');
    if (root && raw.replace(/[\\/]+$/, '') === root) return `${root.split(/[\\/]/).pop()}/`;
    return window.HCCodePaths ? window.HCCodePaths.relativeFromRoot(raw, root) : raw;
  }

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

  // Names and places of files, with either separator: src/js/code/paths.js.
  function baseName(path) {
    return window.HCCodePaths.baseName(path);
  }

  function relativeFromRoot(path) {
    return window.HCCodePaths.relativeFromRoot(path, sharedState.projectRoot);
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

  // ── One step, rendered from a finished record ───────────────
  //
  // The same shape appendStep() builds live, for tool calls that arrive already
  // complete through the chat renderer. Two shapes for the same thing is what
  // made a run read as a pile of unrelated blocks.
  function toolBlockHtml(rec) {
    const { name, args, result, ms, ok } = rec;
    const resultText = String(result || '');
    const isErr = !ok || resultText.includes('"error"');
    const argsJson = esc(JSON.stringify(args || {}, null, 2).slice(0, 500));
    const resultPreview = esc(resultText.slice(0, 2000)) + (resultText.length > 2000 ? '\n…' : '');
    return `
<details class="cdr-step ${isErr ? 'cdr-step--err' : 'cdr-step--ok'}"${isErr ? ' open' : ''}>
  <summary class="cdr-step-head">
    <span class="cdr-step-verb">${esc(toolVerb(name))}</span>
    <span class="cdr-step-object">${esc(toolObject(name, args) || name)}</span>
    <span class="cdr-step-result">${isErr ? 'failed' : esc(String(ms)) + 'ms'}</span>
  </summary>
  <div class="cdr-step-body">
    ${argsJson !== '{}' ? `<pre>${argsJson}</pre>` : ''}
    <pre>${resultPreview}</pre>
  </div>
</details>`;
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
      bubble.insertBefore(wrapper, bubble.firstChild);
    });
  }

  // ── Legacy HC_CODE API (kept for hashcoder.js bridge compatibility) ──
  function buildMessages() {
    const H = window._H;
    const msgs = (H.buildOllamaMessages && H.buildOllamaMessages()) || [];
    const projectCtx = sharedState.projectRoot ? `\nProject root: ${sharedState.projectRoot}` : '';
    const sysMsgIdx = msgs.findIndex(m => m.role === 'system');
    const fullSys = (HC?.code?.SYSTEM_PROMPT || '') + projectCtx + (HC?.code?.platformLine?.(sharedState.platform) || '');
    if (sysMsgIdx >= 0) msgs[sysMsgIdx].content = fullSys + '\n\n' + msgs[sysMsgIdx].content;
    else msgs.unshift({ role: 'system', content: fullSys });
    return msgs;
  }

  /** Show the model any image view_image opened. Shape: agent-shape.js. */
  function attachPendingImages(messages) {
    const shown = HC?.code?.takePendingVision?.() || [];
    if (shown.length) messages.push(window._H.visionMessage(shown));
  }

  // The tools as a model is offered them — platform/tauri/hashcoder.js.
  const buildLegacyTools = () => HC?.code?.toolList?.() || [];

  // ── Routing ────────────────────────────────────────────────
  // One routing a run (js/code/router.js): the model chosen first, then the
  // ones the shared rules move it to when it cannot answer, each move said, and
  // the run stays on the one that took over. startRun clears it, so the next
  // run starts again from the model chosen.
  let routing = null;
  let routeNotice = () => {};   // set in the panel, where the conversation is

  function routerFor(selected) {
    if (routing && routing.selected === selected) return routing.router;
    const H = window._H;
    const router = window.HCCodeRouter.create({
      selected, send: H.runModelTurn,
      adapterOf: (v) => window.HCAgentShape.selectAgentAdapter(v, { parseCloudModel: H.parseCloudModel, providers: window.HCProviders }),
      available: () => H.getAvailableCloudModels(),
      readsImages: (v) => { const p = H.parseCloudModel(v); return !!window.HCProviders.readsImages(p.provider, p.modelId); },
      failover: window.HCChatFailover, routes: window.HCModelRoutes,
      say: (text) => routeNotice(text),
    });
    routing = { selected, router };
    return router;
  }

  function setRouterChip(label, state) {
    const chip = document.getElementById('cdrRouterChip');
    const lbl  = document.getElementById('cdrRouterLabel');
    if (!chip) return;
    chip.className = 'cdr-router-chip' + (state ? ' ' + state : '');
    chip.textContent = label || '';
    // "Auto" is the name of a setting, not a status, and it sat in the header
    // permanently saying nothing. The chip is for when routing has something to
    // report: which provider is answering, and when one has failed over.
    const idle = !label || label === 'Auto';
    chip.dataset.idle = idle ? '1' : '0';
    chip.style.display = idle ? 'none' : '';
    if (lbl) { lbl.textContent = label || ''; }
  }

  async function callWithRouter(messages, tools, temperature, signal, modelOverride, live) {
    const selected = modelOverride || window._H?.selectedModel?.() || '';
    if (!selected) throw new Error('No model available. Select a model from the dropdown or add an API key in Settings.');
    const router = routerFor(selected);
    const result = await router.turn({ messages, tools, temperature, signal, onText: live?.text, onThinking: live?.thinking, cache: true, reset: live?.reset });
    const moved = router.model !== selected;
    setRouterChip(moved ? router.label(router.model) : '', moved ? 'switched' : '');
    return result;
  }

  // Tier ordering — keep quality high during failover.

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
        for (const c of turn.tool_calls) if (!window.HCMcp?.systemOf?.(c.name)) c.arguments = window.HCCodePaths.argsFromRoot(c.arguments, sharedState.projectRoot);   // as in the agent loop below
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
        attachPendingImages(messages);
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
  // CoderMode — Full-screen chat agent overlay
  // ══════════════════════════════════════════════════════════════
  const CoderMode = (() => {
    let mounted            = false;
    let setUp              = false;   // wired once: HashCoder is mounted again each time it is opened
    let runAbort           = null;
    let conversationMsgs   = []; // persists across turns — full chat history
    let toolCallCounter    = 0;
    let _lastAgentCommand  = null;   // echo a command once, not once per line
    let coderModel         = null; // null = use main model picker
    let activeContentEl    = null; // current assistant bubble — for change pills
    let cdrTraceEntries    = [];
    const cdrTraceClock    = window.HCTraceTime.clock();
    const SESSIONS_KEY     = 'hc-coder-sessions';
    let welcomeHtml        = '';
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
          chatHistory: window.HCCodeAttach ? window.HCCodeAttach.forStorage(conversationMsgs) : conversationMsgs,   // pictures are not kept
          activeFile: sharedState.activeFile, run: sharedState.lastRun || null, trace: cdrTraceEntries,   // the last run's facts and trace, for an export (js/code/debug-export.js)
          changes: sharedState.changeIds || [],   // the changes this conversation made, shown with it when it is opened again
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
        // A new launch starts a new conversation: the last is kept in Sessions and the project stays open (leaving HashCoder and coming back never comes here).
        if (Array.isArray(state.chatHistory) && state.chatHistory.length) { sharedState.lastRun = state.run || null; cdrTraceEntries = Array.isArray(state.trace) ? state.trace : []; sharedState.changeIds = Array.isArray(state.changes) ? state.changes : []; sharedState.changesUpTo = Array.isArray(state.changes) ? 0 : Date.now(); conversationMsgs = state.chatHistory; saveCurrentSession(); conversationMsgs = []; sharedState.lastRun = null; cdrTraceEntries = []; sharedState.changeIds = []; sharedState.changesUpTo = 0; saveCoderState(); }
      } catch (e) { console.warn('[CoderMode] restore state failed:', e); }
    }
    function clearCoderState() {
      try { localStorage.removeItem(STATE_KEY); } catch {}
    }

    // ── Mount / destroy ───────────────────────────────────────
    function mount() {
      if (mounted) return;
      mounted = true;
      syncProjectLabel();
      setRouterChip('Auto', '');
      if (sharedState.projectRoot) HC?.guard?.setProjectRoot?.(sharedState.projectRoot);
      // Opened again: the panel and its conversation are as they were left, and
      // wiring them again would make every button answer twice.
      if (setUp) { syncTerminalPrompt(); updateCoderStatus(); return; }
      setUp = true;
      wireDom();
      // Discover home dir for system-prompt path hints. Bypasses HC.code.shellRun intentionally
      // — this is an internal app initialisation, not an AI agent action, so a permission
      // dialog would be jarring UX. The command is read-only and hardcoded.
      if (HC?.isTauri && !sharedState.homeDir) {
        // The home-directory probe and its shell are chosen in Rust — `sh` does
        // not exist on Windows, and hard-coding it here made every terminal
        // command and this probe fail there.
        HC.invoke('shell_platform')
          .then(info => { sharedState.platform = info; if (HC.code) HC.code.platform = info; return HC.invoke('shell_run_line', { line: info.homeProbe, cwd: null }); })
          .then(r => { if (r?.stdout?.trim()) sharedState.homeDir = r.stdout.trim(); })
          .catch(() => {});
      }
      // Everything the agent's commands print reaches the terminal as it
      // arrives, so a build or a test run reads live instead of appearing
      // whole once it has already finished.
      if (window.HC?.code) {
        HC.code.onShellChunk = (chunk, display) => {
          if (!chunk) return;
          if (_lastAgentCommand !== display) {
            _lastAgentCommand = display;
            terminalLog(`${terminalPrompt()} ${display}`, 'cdr-bash-preview');
          }
          terminalLog(chunk.data ?? '', chunk.kind === 'stderr' ? 'cdr-terminal-error' : '');
        };
      }
      // The knowledge base's own switch, shown in Settings under HashCoder.
      $('cdrKbState')?.addEventListener('change', (e) => {
        window._H?.ragSetOn?.(!!e.target.checked);
        updateCoderStatus();
      });
      // The empty screen, kept as the panel drew it, so a new conversation
      // brings back the same one.
      welcomeHtml = welcomeHtml || $('cdrMessages')?.querySelector('.cdr-welcome')?.outerHTML || '';
      wireWelcome();
      // Files and pictures attached to the next request — js/code/attach.js.
      window.HCCodeAttach?.mount({ panel: $('coder-mode-wrap'), input: $('cdrTaskInput'), button: $('cdrAttachBtn'), picker: $('cdrAttachInput'), list: $('cdrAttachList'), model: () => coderModel || window._H?.selectedModel?.() || '' });
      restoreCoderState();   // a change waiting to be kept or undone is shown with the session that made it (restoreSession), never in a new one
      syncTerminalPrompt();
      updateCoderStatus();
    }

    function remount() {
      populateModelPicker();
      renderSessions();
      warnIfSmall();
      // The terminal opens with HashCoder only when Settings say so.
      cdrShowTerminal(!!cdrPrefs().terminalOnOpen);
    }

    function destroy() {
      mounted = false;
      if (runAbort) { runAbort.abort(); runAbort = null; }
    }

    // ── DOM wiring ────────────────────────────────────────────
    function wireDom() {
      const runBtn            = $('cdrRunBtn');
      const stopBtn           = $('cdrStopBtn');
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
      if (clearBtn)          clearBtn.addEventListener('click', clearChat);
      if (leftAddFileBtn)    leftAddFileBtn.addEventListener('click', openFile);
      if (leftAddFolderBtn)  leftAddFolderBtn.addEventListener('click', openProject);
      if (clearFilesBtn)     clearFilesBtn.addEventListener('click', clearFilesPanel);
      if (auditBtn)          auditBtn.addEventListener('click', showAuditLog);
      if (resetPermsBtn)     resetPermsBtn.addEventListener('click', async () => {
        if (!(await window._H.themedConfirm('Revoke all session permissions you granted this session? The agent will ask again before any write or shell operation.', 'Session permissions'))) return;
        HC.guard.clearSession?.();
      });

      // The top bar. Everything used less often than these is in Settings,
      // under HashCoder, where the audit log, the trace, export, the number
      // of agents and resetting permissions now live.
      $('cdrProjectBtn')?.addEventListener('click', openProject);
      $('cdrSettingsBtn')?.addEventListener('click', () => {
        $('openSettings')?.click();
        $('stab-hashcoder')?.click();
      });
      const history = $('cdrSessionsPanel');
      const historyBtn = $('cdrSessionsBtn');
      const showHistory = (open) => {
        history?.classList.toggle('open', open);
        historyBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
        historyBtn?.classList.toggle('on', open);
        if (open) $('cdrSessionsSearch')?.focus();
      };
      historyBtn?.addEventListener('click', (e) => { e.stopPropagation(); showHistory(!history?.classList.contains('open')); });
      $('cdrDebugBtn')?.addEventListener('click', exportDebug);
      window.HCCodePermissionBar?.mount($('cdrPermMode'), HC.guard);
      $('cdrSessionsClose')?.addEventListener('click', () => showHistory(false));
      history?.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => { if (history?.classList.contains('open')) showHistory(false); });
      $('cdrTerminalBtn')?.addEventListener('click', () => cdrShowTerminal(!!cdrLayout.termHidden));

      const traceBtn   = $('cdrTraceBtn');
      const tracePanel = $('cdrTracePanel');
      const traceClear = $('cdrTraceClear');
      if (traceBtn && tracePanel) {
        traceBtn.addEventListener('click', e => {
          e.stopPropagation();
          // Asked for from Settings: close them and show the trace over HashCoder.
          $('closeSettings')?.click();
          if (!document.body.classList.contains('coder-mode')) window._H?.setTab?.('code');
          tracePanel.classList.add('open');
          renderCdrTrace();
        });
        tracePanel.addEventListener('click', e => e.stopPropagation());
      }
      if (traceClear) traceClear.addEventListener('click', () => cdrTraceReset('Trace cleared'));
      $('cdrTraceClose')?.addEventListener('click', () => tracePanel?.classList.remove('open'));
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

      renderSessions();

      // Settings, under HashCoder.
      const prefs = cdrPrefs();
      const lessonsEl = $('cdrSetLessons');
      if (lessonsEl) { lessonsEl.checked = prefs.lessons === true; lessonsEl.addEventListener('change', () => cdrSavePrefs({ lessons: lessonsEl.checked })); }
      const lightEl = $('cdrSetLight'); if (lightEl) { lightEl.value = ['auto', 'always', 'off'].includes(prefs.light) ? prefs.light : 'auto'; lightEl.addEventListener('change', () => { cdrSavePrefs({ light: lightEl.value }); warnIfSmall(); }); }   // which models get light mode (js/code/light.js)
      const memEl = $('cdrSetMemory'); if (memEl) { memEl.checked = prefs.memory === true; memEl.addEventListener('change', () => { cdrSavePrefs({ memory: memEl.checked }); if (conversationMsgs[0]?.role === 'system') conversationMsgs[0] = systemTurn(); }); }   // off by default: HashCoder neither saves nor sends long-term memory
      $('cdrForgetLessons')?.addEventListener('click', async () => { if (await window._H.themedConfirm('Forget every lesson HashCoder kept, for every project?', 'Lessons')) window.HCCodeLessons?.forgetAll(localStorage); });
      const proveEl = $('cdrSetProve');
      if (proveEl) {
        proveEl.checked = prefs.prove !== false;
        proveEl.addEventListener('change', () => cdrSavePrefs({ prove: proveEl.checked }));
      }
      const termEl = $('cdrSetTerminal');
      if (termEl) {
        termEl.checked = !!prefs.terminalOnOpen;
        termEl.addEventListener('change', () => cdrSavePrefs({ terminalOnOpen: termEl.checked }));
      }

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
          warnIfSmall(); window.HCCodeAttach?.refresh();   // the note about pictures follows the model
        });
      }
    }

    /** The chips and the Open project button of the empty screen. */
    function wireWelcome() {
      $('cdrMessages')?.querySelectorAll('.cdr-welcome-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const ti = $('cdrTaskInput');
          if (!ti || !chip.dataset.prompt) return;
          ti.value = chip.dataset.prompt;
          autoResize(ti);
          ti.focus();
        });
      });
      $('cdrWelcomeOpen')?.addEventListener('click', openProject);
    }

    // A local model below this many billion parameters is flagged as small
    // under the composer: on such a model the agent often stops early or skips
    // steps, and the person should know that before blaming the task.
    const SMALL_MODEL_WARN_BILLIONS = 7;
    async function warnIfSmall() {
      const el = $('cdrModelWarn');
      if (!el) return;
      const model = coderModel || window._H?.selectedModel?.() || '';
      const info = /^cloud:/.test(model) || !model ? null
        : await Promise.resolve(window.HCLocalContext?.infoOf(window.HashCortxRuntime?.getHost?.(), model)).catch(() => null);
      const billions = info?.billions ?? window.HCCodeLight?.billionsInName(model), light = !!window.HCCodeLight?.applies(HC?.code?.sizeOf?.(billions), cdrPrefs().light);
      const small = !!(billions && billions < SMALL_MODEL_WARN_BILLIONS);
      const spills = info ? await Promise.resolve(window.HCLocalFit?.describe(window.HashCortxRuntime?.getHost?.(), model)).catch(() => '') : '';   // part of it runs on the processor (js/local-fit.js)
      el.textContent = [light ? `${billions}B runs in light mode: it writes whole files and HashCortX does the tool work. 7B or larger handles bigger tasks better.` : small ? `${billions}B is a small model: it may stop early or skip steps. 7B or larger works better.` : '', spills].filter(Boolean).join(' ');
      el.hidden = !el.textContent;
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
      autoOpt.textContent = 'Auto';
      dest.appendChild(autoOpt);
      const gone = (opt) => !!window.HCModelRoutes?.isRetired(opt.value);
      if (coderModel && window.HCModelRoutes?.isRetired(coderModel)) coderModel = null;
      src.querySelectorAll('optgroup, option').forEach(node => {
        if (node.tagName === 'OPTGROUP') {
          const group = document.createElement('optgroup');
          group.label = node.label;
          node.querySelectorAll('option').forEach(opt => { if (!gone(opt)) group.appendChild(opt.cloneNode(true)); });
          if (group.childElementCount) dest.appendChild(group);
        } else if (node.tagName === 'OPTION' && !gone(node)) {
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


    function syncProjectLabel() {
      const sub = $('cdrProjectSub');
      $('coder-mode-wrap')?.classList.toggle('has-project', !!sharedState.projectRoot);
      if (!sub) return;
      const root = sharedState.projectRoot;
      sub.textContent = root ? baseName(root) : 'No project open';
      sub.title = root || '';
    }

    function setActiveFile(path) {
      sharedState.activeFile = path;
      const sub = $('cdrProjectSub');
      if (sub && path) {
        sub.textContent = baseName(path);
        sub.title = path;
      }
    }

    // ── Explorer ──────────────────────────────────────────────
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
      if (conversationMsgs[0]?.role === 'system') conversationMsgs[0] = systemTurn();   // the real project root, always
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

    // A new conversation, or one opened from Sessions, lists only the files it changes.
    function clearSessionFiles() { _aiSessionFiles.clear(); document.getElementById('cdrAISessionSection')?.remove(); }
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

    // ── What the files in the project's top folder define (js/code/codemap.js) ──
    async function scanProjectSymbols(root) {
      if (!window.HC?.isTauri || !root || !window.HCCodeMap) return;
      const symbols = {}; // path → [{name, kind, line}]
      try {
        for (const f of (await HC.code.listDir(root)) || []) {
          const lang = !f.is_dir && !f.name.startsWith('.') && window.HCCodeMap.langOf(f.name);
          if (!lang) continue;
          // Read whole and without asking: a file the project would need a question for is left out.
          try { const found = window.HCCodeMap.definitions(await HC.code.readQuietly(f.path), lang); if (found.length) symbols[f.path] = found.slice(0, 30); } catch {}
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
        const fileName = baseName(path);
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

    // A move to another model, or a model found gone, said in the conversation
    // and the trace; the picker stops offering one that is gone (js/code/router.js).
    routeNotice = (text) => {
      cdrTraceAdd('Model', text, 'warn');
      if (activeContentEl) window.HCCodeSteps.add(activeContentEl, { verb: 'MODEL', object: text });
      if (/\bgone\b/.test(text)) populateModelPicker();
    };

    // ── Status helpers ────────────────────────────────────────
    function setStatus(text, type) {
      const dot  = $('cdrStatusDot');
      const txt  = $('cdrStatusText');
      if (dot) dot.className = 'cdr-status-dot' + (type ? ' ' + type : '');
      if (txt) { txt.textContent = text || 'Ready'; txt.title = text || ''; }
    }

    // ── Chat rendering ────────────────────────────────────────
    // The answer is followed only while the reader is at the end, and a request just sent is always shown (js/code/follow.js).
    let follow = null;
    function scrollMessages(force) { follow = follow || window.HCCodeFollow.create(() => $('cdrMessages')); if (force === true) follow.toEnd(); else follow.keep(); }

    // A reply is model text, which a file or page the agent read can shape, so
    // it is drawn the way chat and the Swarm draw theirs: HTML in it is shown
    // rather than built, and links and images follow js/markdown-safe.js.
    function renderMarkdown(text) {
      if (!text) return '';
      if (window.HCMarkdown) return window.HCMarkdown.renderUntrusted(text, { marked: window.marked, purify: window.DOMPurify });
      return esc(text).replace(/\n/g, '<br>');
    }

    function appendUserMsg(text, pictures) {
      const msgs = $('cdrMessages');
      if (!msgs) return;
      msgs.querySelector('.cdr-welcome')?.remove();
      const el = document.createElement('div');
      el.className = 'cdr-msg user';
      const svgCopy = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      el.innerHTML = `
        <div class="cdr-user-bubble">${window.HCCodeAttach?.picturesHtml(pictures) || ''}${esc(text)}</div>
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
      scrollMessages(true);
    }

    function appendAssistantBubble(roleLabel) {
      const msgs = $('cdrMessages');
      if (!msgs) return null;
      const el = document.createElement('div');
      el.className = 'cdr-msg assistant' + (roleLabel && roleLabel !== 'HashCoder' ? ' boss' : '');

      const svgCopy  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      const svgReply = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
      const svgRegen = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.18"/></svg>`;

      el.innerHTML = `
        <div class="cdr-msg-role">${esc(roleLabel || 'HashCoder')}</div>
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
        runAbort = new AbortController(); sharedState.runBegan = Date.now();
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

    /** The live line while the model works: what it is doing, how long, and its words as they arrive (js/code/live.js). */
    function appendThinking(contentEl, now = {}) {   // `now`: the step that just ended, or that the answer is being checked (js/code/live.js)
      return contentEl ? window.HCCodeLive.start(contentEl, { render: renderMarkdown, scroll: scrollMessages, began: sharedState.runBegan, ...now }) : null;   // its clock counts from when the request was sent
    }

    /** One step of a run, a tool call or a file change alike, kept in view (js/code/steps.js). */
    function appendStep(contentEl, step) {
      const el = window.HCCodeSteps.add(contentEl, step);   // js/code/steps.js
      if (el) scrollMessages();
      return el;
    }

    /** A reply whose run has ended: its steps folded, its changes gathered under it (js/code/steps.js). */
    const settleSteps = (contentEl) => window.HCCodeSteps.settle(contentEl);

    function appendToolBlock(contentEl, name, args) {
      const id = ++toolCallCounter;
      const el = appendStep(contentEl, {
        verb: toolVerb(name),
        object: toolObject(name, args) || name,
        status: '<span class="cdr-step-running">running…</span>',
        statusClass: 'cdr-step--running',
        open: false,
      });
      if (el) el.dataset.id = String(id);
      return el;
    }

    function finalizeToolBlock(el, result, ok, ms) {
      if (!el) return;
      el.classList.remove('cdr-step--running');
      el.classList.add(ok ? 'cdr-step--ok' : 'cdr-step--err');
      const status = el.querySelector('.cdr-step-result');
      if (status) status.textContent = ok ? (ms == null ? '' : `${ms}ms`) : 'failed';   // no time is kept for a saved step
      const body = el.querySelector('.cdr-step-body');
      if (body) {
        const text = String(result || '');
        const pre = document.createElement('pre');
        pre.textContent = text.slice(0, 2000) + (text.length > 2000 ? '\n…' : '');
        body.innerHTML = '';
        body.appendChild(pre);
      }
      // A failure is the one result worth opening without being asked: it is
      // why the run did what it did next.
      if (!ok) el.open = true;
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
      const session = { id: Date.now(), title, date, msgs: window.HCCodeAttach ? window.HCCodeAttach.forStorage(conversationMsgs) : conversationMsgs.slice(), run: sharedState.lastRun || null, trace: cdrTraceEntries.slice(-300), changes: sharedState.changeIds || [], changesUpTo: sharedState.changesUpTo || 0 };
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

    async function renameSession(idx) {
      const sessions = loadSessions();
      const s = sessions[idx];
      if (!s) return;
      const next = await window._H.themedPrompt('Rename chat (3 words max):', s.title || '', 'Rename chat');
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
        list.innerHTML = `<div class="cdr-sessions-empty">${q ? 'No sessions match your search.' : 'Past sessions will appear here.'}</div>`;
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
        if (dl) dl.addEventListener('click', async (e) => { e.stopPropagation(); if (await window._H.themedConfirm('Delete this saved chat?', 'Delete chat')) deleteSession(idx); });
      });
    }

    function restoreSession(session) {
      if (!session?.msgs?.length) return;
      $('cdrSessionsPanel')?.classList.remove('open');
      conversationMsgs = session.msgs.slice(); sharedState.lastRun = session.run || null; cdrTraceEntries = Array.isArray(session.trace) ? session.trace : [];   // what an export says of it
      sharedState.changeIds = Array.isArray(session.changes) ? session.changes.slice() : []; sharedState.changesUpTo = session.changesUpTo || 0; clearSessionFiles();
      renderConversation();
      restorePendingChanges({ ids: sharedState.changeIds, upTo: sharedState.changesUpTo }).catch((e) => console.warn('[CoderMode] pending changes:', e));   // its changes still waiting, with it
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
        // The model's own context, from its provider's list (js/model-limits.js);
        // one honest number when the list does not say.
        const MAX = window.HCModelLimits?.infoOf(H.selectedModel?.() || '')?.ctx || 64000;
        const used = H.estimatePromptTokens(conversationMsgs) || 0;
        const pct = Math.min(100, Math.round((used / MAX) * 100));
        const pctEl = $('cdrContextPct'), fillEl = $('cdrContextFill'), cntEl = $('cdrContextCount');
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.setProperty('--pct', String(pct));
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
        kbState.checked = on;
        // Plain words. This said "search_knowledge will find nothing", which
        // names a tool the reader never sees and wrapped onto three lines in a
        // narrow panel, so the one strip meant to tell you the truth about the
        // knowledge base looked broken.
        kbRows.textContent = on
          ? (size.passages
            ? `On: ${size.passages.toLocaleString()} passages from ${size.sources} source${size.sources === 1 ? '' : 's'}.`
            : 'On, but empty. Add documents in Agents to use it.')
          : 'Off. Nothing of yours is searched.';
      }
    }

    /**
     * Draw a saved conversation as it ran: each request, then one reply
     * holding the steps taken and the answer. A reply the agent was sent back
     * from was not its answer, so it is drawn as the step that sent it back.
     */
    function renderConversation() {
      const msgs = $('cdrMessages');
      if (!msgs) return;
      msgs.innerHTML = '';
      const V = window.HCCodeVerify;
      const results = new Map(conversationMsgs.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, String(m.content ?? '')]));
      let reply = null;
      conversationMsgs.forEach((m, i) => {
        if (m.role === 'user' && V?.isAppNote(m.content)) { if (reply) appendStep(reply, { verb: 'CHECK', object: V.noteStep(m.content), status: '' }); return; }
        if (m.role === 'user' && !m.opened) { appendUserMsg(window.HCCodeAttach ? window.HCCodeAttach.shownRequest(m.content) : m.content, m.thumbs); reply = null; return; }
        if (m.role !== 'assistant' || !(reply = reply || appendAssistantBubble('HashCoder'))) return;
        if (m.content && m.tool_calls?.length && !window.HCCodeLive.looksLikeCalls(m.content)) appendTextToBubble(reply, m.content);   // what it said before the step
        for (const c of m.tool_calls || []) {
          const fn = c.function || c, result = results.get(c.id);
          let args = fn.arguments; try { args = typeof args === 'string' ? JSON.parse(args) : args; } catch { args = {}; }
          let failed = result == null; try { failed = failed || !!JSON.parse(result).error; } catch { /* a result that is not JSON is output */ }
          finalizeToolBlock(appendToolBlock(reply, fn.name, args || {}), result ?? 'No result was kept.', !failed, null);
        }
        if (m.content && !m.tool_calls?.length && !V?.isAppNote(conversationMsgs[i + 1]?.content)) { appendTextToBubble(reply, m.content); if (m.proven) appendTextToBubble(reply, `*${m.proven}*`); }
      });
      msgs.querySelectorAll('.cdr-msg.assistant .cdr-msg-content').forEach(settleSteps);   // drawn as a finished run reads
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
    /**
     * Terminal colour turned into HTML, in src/js/code/ansi.js.
     *
     * This is the output of a real command, so it is escaped there, and the
     * colours are tracked as a running style rather than nested tags — a
     * terminal's colours replace one another, and treating them as nesting
     * grew the markup without limit down a long build log.
     */
    function ansiToHtml(text) {
      return window.HCCodeAnsi.ansiToHtml(text);
    }

    // ── Execution trace ───────────────────────────────────────
    function cdrTraceReset(reason) {
      cdrTraceClock.reset();   // this run's first trace line is its zero
      cdrTraceEntries = [];
      cdrTraceAdd('Trace', reason || 'New run', 'wait');
    }

    function cdrTraceAdd(stage, message, status) {
      cdrTraceEntries.push({
        elapsed: cdrTraceClock.seconds(),
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
      // Stroked marks, not characters. A tick and a bang are drawn by the
      // text font at whatever weight it feels like, so they never matched the
      // icons beside them and an error and a warning were the same glyph.
      const mark = (d, extra = '') =>
        `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;
      const MARKS = {
        ok:   mark('<path d="m3.5 8.5 3 3 6-6"/>'),
        err:  mark('<circle cx="8" cy="8" r="6"/><path d="M8 5v4"/><path d="M8 11h.01"/>'),
        warn: mark('<path d="M8 2.5 14 13H2Z"/><path d="M8 7v2.5"/><path d="M8 11h.01"/>'),
        run:  mark('<path d="m6 4 4 4-4 4"/>'),
        wait: mark('<circle cx="8" cy="8" r="1.6"/>'),
      };
      function icon(s) { return MARKS[s] || MARKS.wait; }
      if (!cdrTraceEntries.length) {
        list.innerHTML = '<div class="cdr-trace-empty">No trace entries yet.</div>';
        return;
      }
      list.innerHTML = cdrTraceEntries.map(e => `<div class="cdr-trace-entry">
  <span class="cdr-trace-time">[${window.HCTraceTime.format(e.elapsed)}]</span>
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
          await HC.invoke('shell_run_line_stream', { line: cmd, cwd: sharedState.projectRoot || undefined, onChunk: channel });
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
      activeContentEl = null; sharedState.lastRun = null; cdrTraceEntries = []; sharedState.changeIds = []; sharedState.changesUpTo = 0; clearSessionFiles();
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
        msgs.innerHTML = welcomeHtml;
        wireWelcome();
      }
      setStatus('Ready', '');
      setRouterChip('Auto', '');
    }

    // ── Export — opens a small menu under the Export button with format choices.
    // Formats: txt (plain), code (only fenced code blocks extracted), pdf (rendered).
    function exportChat() {
      if (!conversationMsgs.length) { window._H.themedAlert('No conversation to export.', 'Export'); return; }
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
      const proj = window.HCCodeExport.exportBaseName(sharedState.projectRoot);

      if (fmt === 'txt') {
        const out = window.HCCodeExport.buildPlainText(conversationMsgs, exportOpts());
        await downloadBlob(out, 'text/plain', `hashcortx-${proj}-${ts}.txt`);
      } else if (fmt === 'md') {
        const out = window.HCCodeExport.buildMarkdown(conversationMsgs, exportOpts());
        await downloadBlob(out, 'text/markdown', `hashcortx-${proj}-${ts}.md`);
      } else if (fmt === 'code') {
        const out = window.HCCodeExport.buildCodeOnly(conversationMsgs);
        if (!out.trim()) { window._H.themedAlert('No fenced code blocks found in this conversation.', 'Export'); return; }
        await downloadBlob(out, 'text/plain', `hashcortx-${proj}-code-${ts}.txt`);
      } else if (fmt === 'pdf') {
        await exportAsPdf(`hashcortx-${proj}-${ts}.pdf`);
      }
    }

    // The export text is written by src/js/code/export.js, which reads code
    // fences the same way the chat's renderer does, so the code-only export
    // holds every block the person saw.
    const exportOpts = () => ({ projectRoot: sharedState.projectRoot });

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

    // The whole conversation as the model was sent it, with its trace (js/code/debug-export.js).
    const exportDebug = () => window.HCCodeDebug.exportRun({ messages: conversationMsgs, trace: cdrTraceEntries, run: sharedState.lastRun, sharedState, routing: routing?.router, coderModel, prefs: cdrPrefs(), H: window._H, save: downloadBlob, exportBaseName: window.HCCodeExport.exportBaseName });
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
        write('HashCoder — Chat Export', { size: 14, bold: true });
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
          // Prose and code, split by src/js/fences.js so a block's language
          // line is never printed as the first line of its code.
          for (const piece of window.HCFences.splitFences(text)) {
            if (piece.type === 'code') write(piece.code, { mono: true, size: 8.5, color: '#222' });
            else if (piece.text.trim()) write(piece.text.trim());
          }
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
<h1>HashCoder — Chat Export</h1>
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

    // Shared by the rows drawn as the agent works and those of a session opened again.
    const CHANGE_ICONS = {
      svgAccept: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      svgReject: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      svgView: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
      svgFile: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    };
    // Undo asks this when the file has changed since the agent's change (platform/tauri/undo.js).
    const askUndo = (message) => window._H.themedConfirm(message, 'Undo');

    /**
     * Draw the changes a conversation opened from Sessions left unanswered
     * (`session`: its change ids, or for an older one a time, HC.undo.ofSession).
     * The records on disk are the durable part, so the rows are rebuilt from
     * them. Summaries only; the contents are fetched if someone asks.
     */
    async function restorePendingChanges(session) {
      const msgs = $('cdrMessages');
      if (!msgs || !HC?.undo?.pending) return;
      // One row a file, however many times it was changed (platform/tauri/undo.js byFile).
      const pending = HC.undo.byFile(HC.undo.ofSession(await HC.undo.pending(), session));
      if (!pending.length) return;

      const { svgAccept, svgReject } = CHANGE_ICONS;
      const group = document.createElement('div');
      group.className = 'cdr-change-group';
      group.innerHTML = `<div class="cdr-change-group-title">${pending.length} file${pending.length === 1 ? '' : 's'} changed in this session and waiting \u2014 keep or undo</div>`;

      for (const summary of pending) {
        const name = baseName(summary.path);
        const canUndo = !summary.unrestorable, count = summary.records.length;
        // The same shape as a step in a live run. A change from last session is
        // the same kind of thing as one from this one, so it should not arrive
        // looking like a different feature.
        const el = appendStep(group, {
          flat: true,
          verb: summary.existed ? 'EDIT' : 'CREATE',
          object: name,
          status: `${count > 1 ? `${count} changes` : summary.existed ? esc(String(summary.records[0].bytes)) + ' bytes saved' : 'new file'}` +
            `<span class="cdr-step-actions">` +
            `<button class="cdr-step-btn keep">${svgAccept} Keep</button>` +
            `<button class="cdr-step-btn undo"${canUndo ? '' : ` disabled title="${esc(summary.unrestorable)}"`}>${svgReject} Undo</button>` +
            `</span>`,
          statusClass: 'cdr-step--change cdr-step--pending',
        });
        if (!el) continue;
        el.querySelector('.cdr-step-object').title = summary.path || '';

        const keepBtn = el.querySelector('.cdr-step-btn.keep');
        const undoBtn = el.querySelector('.cdr-step-btn.undo');
        const own = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };

        keepBtn.addEventListener('click', own(async () => {
          el.classList.remove('cdr-step--pending'); el.classList.add('cdr-step--accepted');
          keepBtn.innerHTML = `${svgAccept} Kept`;
          undoBtn.disabled = true;
          for (const r of summary.records) await HC.undo.drop(r);
        }));

        undoBtn.addEventListener('click', own(async () => {
          if (!canUndo || undoBtn.disabled) return;
          undoBtn.disabled = true;
          try {
            // restore() fetches the contents itself \u2014 the summary does not
            // carry them, and writing it as-is would empty the file. Newest first,
            // so each finds the file as the change after it left it.
            for (const r of summary.records) await HC.undo.restore(r, { ask: askUndo });
            el.classList.remove('cdr-step--pending'); el.classList.add('cdr-step--rejected');
            undoBtn.innerHTML = `${svgReject} Undone`;
            keepBtn.disabled = true;
            terminalLog(`[undo] restored ${summary.path}`, 'cdr-bash-preview');
            if (summary.existed) addAIFileToExplorer(summary.path, 'write');
          } catch (e) {
            undoBtn.disabled = false;
            if (e?.cancelled) return; // asked, and the answer was no
            undoBtn.innerHTML = `${svgReject} Undo failed`;
            undoBtn.title = String(e?.message || e);
            terminalLog(`[undo] could not restore ${summary.path}: ${e?.message || e}`, 'cdr-terminal-error');
          }
        }));

        // What Undo would put back, fetched the first time it is asked for.
        // Not a diff: nothing has asked for the file yet, so there is nothing
        // to compare it against.
        const body = el.querySelector('.cdr-step-body');
        body.textContent = 'Loading\u2026';
        el.addEventListener('toggle', async () => {
          if (!el.open || el.dataset.loaded) return;
          el.dataset.loaded = '1';
          const full = summary.existed ? await HC.undo.load(summary.id) : null;
          body.innerHTML = summary.existed
            ? `<div class="cdr-step-note">What Undo would put back</div><pre><code>${esc(full?.content ?? '')}</code></pre>`
            : '<pre><code>This change created the file. Undoing it deletes the file again.</code></pre>';
        });
      }
      msgs.appendChild(group);
      scrollMessages();
    }


    function addChangeEntry(name, path, kind, content) {
      // What the file held before this change. Captured by HC.code.undo at the
      // moment of the write, which is the only point where it still exists.
      const checkpoint = HC?.undo?.lastFor(path) || null;
      if (checkpoint?.id) (sharedState.changeIds = sharedState.changeIds || []).push(checkpoint.id);   // the conversation's own, shown with it when opened again
      const canUndo = !!HC?.undo?.canRestore(checkpoint);
      const target = activeContentEl || $('cdrMessages')?.querySelector('.cdr-msg.assistant:last-of-type .cdr-msg-content');
      if (!target) return;

      // The real before/after, not the length of whatever the tool echoed back.
      // For a patch there is no `content` argument at all, so the old count was
      // measuring the tool's JSON result.
      const before = checkpoint?.existed ? (checkpoint.content ?? '') : '';
      // `checkpoint.after` is what was actually written. Preferred over the
      // tool's arguments because patch_file has no content argument at all.
      const after = kind === 'delete' ? '' : String(checkpoint?.after ?? content ?? '');
      const rows = window.HCDiff ? window.HCDiff.diffLines(before, after) : [];
      const tally = window.HCDiff ? window.HCDiff.countChanges(rows) : { added: 0, removed: 0 };
      const isNew = !checkpoint?.existed && kind !== 'delete';

      const verb = kind === 'delete' ? 'DELETE' : isNew ? 'CREATE' : 'EDIT';
      const stat = kind === 'delete'
        ? 'deleted'
        : isNew
          ? 'new file'
          : `<span class="cdr-plus">+${tally.added}</span> <span class="cdr-minus">\u2212${tally.removed}</span>`;

      const { svgAccept, svgReject } = CHANGE_ICONS;
      // A change is a step in the run like any other, so it takes the same
      // shape. Keep and Undo sit in the row rather than inside the opened diff:
      // burying the answer behind a disclosure would make the common case —
      // "yes, keep it" — cost an extra click.
      const el = appendStep(target, {
        verb,
        object: name,
        status: `${stat}<span class="cdr-step-actions">` +
          `<button class="cdr-step-btn keep">${svgAccept} Keep</button>` +
          `<button class="cdr-step-btn undo"${canUndo ? '' : ' disabled title="The previous contents could not be saved, so this change cannot be undone."'}>${svgReject} Undo</button>` +
          `</span>`,
        statusClass: 'cdr-step--change cdr-step--pending',
      });
      if (!el) return;

      const keepBtn = el.querySelector('.cdr-step-btn.keep');
      const undoBtn = el.querySelector('.cdr-step-btn.undo');
      // The buttons live inside a <summary>, so a click would also toggle the
      // disclosure. Answering a change and looking at it are different actions.
      const own = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };

      keepBtn.addEventListener('click', own(() => {
        el.classList.remove('cdr-step--pending'); el.classList.add('cdr-step--accepted');
        keepBtn.innerHTML = `${svgAccept} Kept`;
        undoBtn.disabled = true;
        // The change is staying, so the saved copy is dead weight.
        HC?.undo?.drop(checkpoint);
      }));

      undoBtn.addEventListener('click', own(async () => {
        if (!canUndo || undoBtn.disabled) return;
        undoBtn.disabled = true;
        try {
          await HC.undo.restore(checkpoint, { ask: askUndo });
          el.classList.remove('cdr-step--pending'); el.classList.add('cdr-step--rejected');
          undoBtn.innerHTML = `${svgReject} Undone`;
          keepBtn.disabled = true;
          terminalLog(`[undo] restored ${path}`, 'cdr-bash-preview');
          if (checkpoint.existed) addAIFileToExplorer(path, 'write');
        } catch (e) {
          // Say so rather than showing "Undone" over a file that did not change.
          undoBtn.disabled = false;
          if (e?.cancelled) return; // asked, and the answer was no
          undoBtn.innerHTML = `${svgReject} Undo failed`;
          undoBtn.title = String(e?.message || e);
          terminalLog(`[undo] could not restore ${path}: ${e?.message || e}`, 'cdr-terminal-error');
        }
      }));

      // The diff, in the step body — what changed, not what the file now says.
      const body = el.querySelector('.cdr-step-body');
      if (!rows.length) {
        body.innerHTML = `<pre><code>${esc(content || '')}</code></pre>`;
      } else if (isNew) {
        body.innerHTML = `<pre><code>${esc(after)}</code></pre>`;
      } else {
        const shown = window.HCDiff.collapseUnchanged(rows, 3);
        body.innerHTML = '<pre class="cdr-diff-lines">' + shown.map((r) => {
          if (r.type === 'gap') {
            return `<span class="cdr-diff-gap">    \u22ef ${r.hidden} unchanged line${r.hidden === 1 ? '' : 's'}</span>`;
          }
          const sign = r.type === 'add' ? '+' : r.type === 'del' ? '\u2212' : ' ';
          const no = r.type === 'add' ? r.afterNo : r.beforeNo;
          return `<span class="cdr-diff-line ${r.type}">${String(no ?? '').padStart(4, ' ')} ${sign} ${esc(r.text)}</span>`;
        // Joined with nothing, not a newline. Each line is its own block
        // element inside a <pre>, so a newline between them renders as a blank
        // line and the diff came out double-spaced.
        }).join('') + '</pre>';
      }
      if (checkpoint?.unrestorable) {
        const why = document.createElement('div');
        why.className = 'cdr-step-note';
        why.textContent = `Cannot be undone \u2014 ${checkpoint.unrestorable}`;
        body.prepend(why);
      }
      scrollMessages();
    }


    // ── Build tools + system ──────────────────────────────────
    const buildTools = buildLegacyTools;

    // The same for every request of a conversation, so it can be reused; what belongs to one request goes with it (js/code/context.js).
    function sysPrompt(extra) {
      const root = sharedState.projectRoot;
      let homeDir = sharedState.homeDir || '';
      if (!homeDir && root) {
        const parts = root.split('/').filter(Boolean);
        if (parts[0] === 'Users' && parts[1]) homeDir = `/Users/${parts[1]}`;
        else if (parts[0] === 'home' && parts[1]) homeDir = `/home/${parts[1]}`;
      }

      const lines = [
        'You are HashCoder — a precise coding agent.',
        'Rules:',
        // A model on this computer under 15B told to write a sentence first often writes only the sentence.
        sharedState.size === 'small' || sharedState.size === 'mid' ? '1. One change at a time. Use tool calls for any file/shell action — do not narrate plans.'
          : '1. One change at a time. Before each tool call, say in one short sentence what you are doing and why; the person reads it as you work. Use tool calls for every file and shell action.',
        '2. Replies must be ≤3 short sentences unless the user asks for detail.',
        '3. Make code changes with the file tools; do not paste the code into the reply.',
        '4. Never call tools for greetings or conversational questions — answer in plain text.',
        '5. Blocked paths: /System, /etc, /private, /usr, /bin — refuse without asking.',
      ];
      if (root) {
        lines.push(`Project root: ${root}`);
        const known = sharedState.projectChecks?.root === root ? sharedState.projectChecks : null;   // read once a project (js/code/verify.js, js/code/context.js)
        for (const line of [known && window.HCCodeVerify?.checksLine(known.checks), known && window.HCCodeContext?.projectPicture(known.entries, sharedState.size)]) if (line) lines.push(line);
        lines.push(`6. If the project directory is empty or new, immediately start creating files — do NOT explore the filesystem first.`);
      } else {
        lines.push(`No project open. Home: ${homeDir || 'unknown'}. Ask user to open a folder for write ops.`);
      }

      // A model in light mode writes whole files in plain text, and is told that, where it runs and the project, not the tool rules (js/code/light.js).
      if (sharedState.light && window.HCCodeLight) return [window.HCCodeLight.SYSTEM, window.HCCodeLight.testHint(sharedState.codeMap?.whole), HC?.code?.platformLine?.(sharedState.platform), ...lines.filter((l) => !/^(?:\d\.|You are HashCoder|Rules:)/.test(l)), extra].filter(Boolean).join('\n');
      const richBase = (HC?.code?.promptFor?.(sharedState.size, cdrPrefs().memory === true) || '') + (HC?.code?.platformLine?.(sharedState.platform) || '');
      const out = (richBase ? richBase + '\n' : '') + lines.join('\n');
      return out + (extra ? '\n' + extra : '');
    }

    // The instructions, with the project's notes for the first request to carry (js/code/context.js).
    const systemTurn = () => window.HCCodeContext.systemTurn(sysPrompt(), sharedState.projectChecks?.root === sharedState.projectRoot ? sharedState.projectChecks : null, sharedState.size, window.HCSources?.mark,
      cdrPrefs().lessons === true && sharedState.size === 'full' && window.HCCodeLessons ? window.HCCodeLessons.notes(window.HCCodeLessons.forProject(localStorage, sharedState.projectRoot, { local: sharedState.local })) : '',   // js/code/lessons.js
      sharedState.codeMap?.root !== sharedState.projectRoot ? '' : sharedState.size === 'full' ? window.HCCodeMap.notes(sharedState.codeMap.ranked, { local: sharedState.local, drop: window.HCCodeLessons?.looksPrivate }) : sharedState.codeMap.whole || '');   // js/code/codemap.js, or a small project whole

    // What the model is shown of a long run, sized to the model: js/agent-context.js.
    const compressHistory = (msgs) => window.HCAgentContext.compressHistory(msgs, window.HCAgentContext.optionsFor(sharedState.size, sharedState.local));

    // ── Core agent loop — renders inline into a bubble ────────
    async function agentLoop(messages, tools, contentEl, label, signal) {
      const H = window._H;
      const temperature = window.HC.code.temperatureFor(sharedState.size, H?.selectedTemperature?.());
      activeContentEl = contentEl;
      const policy = window.HCAgentPolicy;
      let iter = 0;
      // A greeting to a small or mid-sized model is answered without the tools and instructions it would read first, and so is a request after it wrote its tools back as its reply (js/code/talk.js).
      let bare = (sharedState.size === 'small' || sharedState.size === 'mid') && !!window.HCCodeTalk?.onlySmallTalk(messages), echoed = false;
      if (bare) tools = [];
      // Progress tracking, so the loop can tell an agent that is working from
      // one that is going in circles. The old fixed cap could not: it stopped
      // both at the same number and reported both as "paused".
      const seenReadTargets = new Set();
      // What was changed and what proved it: js/code/verify.js.
      const proof = window.HCCodeVerify?.proofLog();
      const sent = { make: 0, plan: 0, prove: 0, review: 0, asks: 0, fresh: 0, site: 0, named: 0, undone: 0, facts: 0, light: 0, rename: 0, wiring: 0, example: 0, stall: 0 };   // how often this run was sent back, for each reason
      // What each file held before this run and holds now, for a second look at a larger change (js/code/review.js).
      const changes = new Map();
      const secondLook = async () => {
        const R = window.HCCodeReview, V = window.HCCodeVerify, shown = R && R.diffText(changes, window.HCDiff.diffLines);
        if (!shown || !R.worthReview({ size: sharedState.size, prove: cdrPrefs().prove !== false, files: shown.files, changed: shown.changed, reviewed: sent.fresh })) return null;
        cdrTraceAdd('Review', 'A second look at the changes', 'run');
        const wait = appendThinking(contentEl, { checking: true });   // a model call with nothing else on the screen
        try {
          const said = await callWithRouter(R.messages((window.HCCodeAttach?.shownRequest || String)(V.requestIn(messages)), V.proofLine(proof), shown.text), [], 0, signal, coderModel);
          const found = R.verdict(said?.content);
          appendStep(contentEl, { verb: 'REVIEW', object: found.ok ? 'looks right' : `${found.problems.length} to look at`, status: '' });
          return found.ok ? null : V.freshReviewNote(found.problems);
        } catch (e) { if (signal?.aborted) throw e; return null; } finally { wait?.remove(); }   // a second look that fails holds nothing up
      };
      // A site the run changed, read the way a browser would each time it would finish, and sent back once (js/code/site.js).
      const siteLook = async () => {
        const S = window.HCCodeSite, C = window.HCSwarmProjectCheck, root = sharedState.projectRoot;
        if (!S || !C || !proof || cdrPrefs().prove === false || !root || !S.worthChecking(proof.changed)) return null;
        const files = await S.gather(proof.changed, root, { list: (d) => HC.code.listQuietly(d), read: (f) => HC.code.readQuietly(f) }).catch(() => null);
        if (!files || !files.size) return null;
        const broken = C.inspect(files).filter((f) => f.level === 'broken' || f.level === 'standard').map((f) => f.what);
        proof.siteRead(broken.length);   // said under the answer (js/code/verify.js proofLine)
        cdrTraceAdd('Check', broken.length ? `Site: ${broken.length} to fix` : 'Site: nothing found to fix', broken.length ? 'warn' : 'ok');
        return broken.length && !sent.site ? window.HCCodeVerify.siteNote(broken) : null;
      };
      // The details its pages state as fact, looked for in what the run was told and read, and sent back once (js/code/facts.js); what is left is said under the answer.
      let unconfirmed = null;
      const factsLook = async () => {
        const F = window.HCCodeFacts, root = sharedState.projectRoot;
        if (!F || !proof || cdrPrefs().prove === false || !root) return null;
        const found = F.check({ files: await F.gather(proof.changed, root, (f) => HC.code.readQuietly(f)), messages });
        unconfirmed = found.total ? found : null;
        if (found.total) cdrTraceAdd('Check', `Details: ${found.unsourced.length} not confirmed, ${found.placeholders.length} unfinished`, 'warn');
        return found.total && !sent.facts ? window.HCCodeVerify.factsNote(found, root) : null;
      };
      // The project read before it finishes, a small one whole: a name the request changes still written (js/code/verify.js renameOf), and files the run changed not joined up (js/code/wiring.js), each twice at most.
      const projectLook = async () => { const V = window.HCCodeVerify, W = window.HCCodeWiring, root = sharedState.projectRoot, r = sent.rename < 2 && V.renameOf(V.requestIn(messages)), wire = sent.wiring < 2 && W && proof?.changed.length; if (!root || cdrPrefs().prove === false || (!r && !wire)) return null; const files = V.filesOfWhole(await window.HCCodeContext.wholeProject(root, { list: (d) => HC.code.listQuietly(d), read: (f) => HC.code.readQuietly(f) }, 'mid').catch(() => '')); return (r && V.renameNote(r, V.leftovers(r, files))) || (wire && W.note(W.gaps(files, proof.changed.map((p) => String(p).replace(/\\/g, '/').slice(String(root).replace(/\\/g, '/').replace(/\/+$/, '').length + 1))))) || null; };
      const namedLook = async (reply) => (cdrPrefs().prove === false || sent.named ? null : window.HCCodeVerify.namedNote(await HC.code.notThereOf(window.HCCodeVerify.namedPaths(reply, sharedState.projectRoot, proof?.changed)), sharedState.projectRoot));   // files an answer names that are not there
      let stalledIterations = 0, loopNote = '';   // loopNote: the same file changed again and again (js/agent-policy.js editLoop)
      const edited = new Map();
      let lastStop = null, forced = null;   // forced: a turn the app takes for a small model, running the test it was told to (verify.js stopCheck)
      let thinkEl = appendThinking(contentEl);

      for (;;) {
        const verdict = policy.shouldContinue({
          iteration: iter,
          stalledIterations,
          madeProgress: stalledIterations === 0,
          changed: proof ? proof.changed.length : 0,   // an agent that has made its change, or finished its plan, is told to finish
          planDone: !!HC?.code?.plan && !!window.HCCodePlan && !window.HCCodePlan.openSteps(HC.code.plan).length,
        });
        if (!verdict.continue) { const untested = verdict.reason === 'stalled' && !sent.stall++ && cdrPrefs().prove !== false && window.HCCodeVerify.stopCheck(proof, sharedState.projectChecks?.checks, '', 0, 1); if (!untested) { lastStop = verdict; break; } stalledIterations = 0; if (untested.run) forced = { content: '', tool_calls: [{ id: `ran_${Date.now()}_0`, name: 'shell_run', arguments: untested.run }] }; else messages.push({ role: 'user', content: untested.message, note: true }); }   // a run that stalls after changing code has its test run, or its failure said, once before it stops (js/code/verify.js stopCheck)
        iter++;

        setStatus(`${label ? label + ' · ' : ''}Running`, 'thinking');   // the reply shows what it is doing (js/code/live.js)
        if (signal?.aborted) { thinkEl?.remove(); throw new DOMException('Aborted', 'AbortError'); }   // stopped: the live line goes too

        // A nudge, and the plan read back while steps are open (js/code/plan.js), go on a COPY: never saved, so the next request starts the same.
        const told = [verdict.nudge, loopNote, window.HCCodePlan?.recite(HC?.code?.plan)].filter(Boolean).join('\n\n'); loopNote = '';
        const baseMsgs = told ? [...messages, { role: 'user', content: told, note: true }] : messages;
        const callMessages = bare ? [{ role: 'system', content: window.HCCodeTalk.SHORT_SYSTEM }, ...compressHistory(baseMsgs).filter((m) => m.role !== 'system')] : sharedState.light ? window.HCCodeLight.callMessages(compressHistory(baseMsgs)) : compressHistory(baseMsgs);

        cdrTraceAdd('Step', `Iter ${iter}${label ? ' · ' + label : ''} · calling model`, 'run');
        let turn;
        try {
          turn = forced || await callWithRouter(callMessages, tools, temperature, signal, coderModel, thinkEl); forced = null;
        } catch (e) {
          thinkEl?.remove(); thinkEl = null;
          cdrTraceAdd('Error', e?.message || String(e), 'err');
          // Show error inline in the bubble
          const errDiv = document.createElement('div');
          errDiv.className = 'cdr-msg-text';
          errDiv.style.color = 'var(--cdr-error)';
          errDiv.style.borderLeft = '2px solid var(--cdr-error)';
          errDiv.style.paddingLeft = '10px';
          errDiv.style.margin = '8px 0';
          const kept = signal?.aborted ? '' : window.HCCodeRouter.keptNote(proof ? proof.changed.map(baseName) : []);   // an error after the work was done says the work is there
          errDiv.innerHTML = `<b>Error</b><br>${esc(e?.message || String(e))}${kept ? `<br><br>${esc(kept)}` : ''}`;
          contentEl.appendChild(errDiv);
          scrollMessages();
          throw e;
        }
        // Light mode: the files in its answer become the calls a larger model makes, and a file not written whole is asked for again, twice at most (js/code/light.js).
        const lit = sharedState.light && !turn.tool_calls?.length && turn.content ? await window.HCCodeLight.turnOf(turn.content, (p) => HC.code.readWholeQuietly(window.HCCodePaths.argsFromRoot({ path: p }, sharedState.projectRoot).path), { known: window.HCCodeLight.knownFiles(sharedState.codeMap?.whole), hints: window.HCCodeLight.pathsIn(HC.code.request), rename: window.HCCodeVerify?.renameOf(window.HCCodeVerify.requestIn(messages)) }) : null;
        if (lit?.calls.length) turn = { ...turn, content: lit.said, tool_calls: lit.calls };
        if (lit?.note && sent.light++ < 2) {
          if (lit.calls.length) loopNote = lit.note;
          else { thinkEl?.finish(''); messages.push({ role: 'assistant', content: turn.content }, { role: 'user', content: lit.note, note: true }); appendStep(contentEl, { verb: 'CHECK', object: 'Asked to write a file again, whole', status: '' }); thinkEl = appendThinking(contentEl, { checking: true }); continue; }
        }
        // What the model said before a step stays in the reply, where it said it;
        // a call written as text does not, and an answer is drawn below instead.
        const said = turn.tool_calls?.length && turn.content && !window.HCCodeLive.looksLikeCalls(turn.content) ? turn.content : '';
        thinkEl?.finish(said); thinkEl = null;

        if (turn.tool_calls?.length) {
          for (const c of turn.tool_calls) if (!window.HCMcp?.systemOf?.(c.name)) c.arguments = window.HCCodePaths.argsFromRoot(c.arguments, sharedState.projectRoot);   // "src/a.js" is the project's, not a connected system's (js/code/paths.js)
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
          const checked = proof ? proof.checks.length : 0;   // checks before this turn's calls

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
            cdrTraceAdd('Tool', call.name + (pathHint ? ' · ' + baseName(pathHint) : ''), 'run');
            const t0 = performance.now();
            let resultStr, ok = true;
            try {
              const own = (HC?.code?.TOOL_DEFINITIONS || []).find(t => t.name === call.name), def = window.HCMcp ? window.HCMcp.toolFor(call.name, own) : own;   // connected tools — js/mcp/connections.js
              if (!def) throw new Error('Unknown tool: ' + call.name);
              const raw = await (def.fn ? def.fn(call.arguments || {}) : def.execute(call.arguments || {}));
              resultStr = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
              if (!def.fn && raw?.error) ok = false;
            } catch (e) {
              resultStr = JSON.stringify({ error: String(e?.message || e) }); ok = false;
            }
            const ms = Math.round(performance.now() - t0);
            cdrTraceAdd('Tool', call.name + ' · ' + ms + 'ms', ok ? 'ok' : 'err');
            finalizeToolBlock(toolEl, resultStr, ok, ms);
            if (!ok && /safety list|protected location/.test(resultStr)) HC.guard?.noteBlocked?.();   // a refused place counts toward Auto asking about everything

            // A row is offered only for a change that happened. A refused or
            // failed call has no record of its own, and the row would pick up
            // the file's previous one, so its Undo reversed an earlier change.
            if (proof && ok) {
              const a = call.arguments || {};
              const touched = { write_file: [a.path], patch_file: [a.path], delete_file: [a.path], move_file: [a.from, a.to] }[call.name];
              if (touched) touched.forEach((p) => { proof.edited(p); window.HCCodeReview?.track(changes, p, HC?.undo?.lastFor?.(p)); });
              else if (call.name === 'shell_run') { try { proof.ran(a.command, a.args, JSON.parse(resultStr)); } catch {} }
            }
            if (ok && ['write_file', 'patch_file', 'delete_file', 'move_file'].includes(call.name)) toolEl?.remove();   // its change row, with Keep and Undo, says it
            if (ok && (call.name === 'write_file' || call.name === 'patch_file')) {
              const fp = call.arguments?.path || '';
              addChangeEntry(baseName(fp), fp, 'write',
                call.arguments?.content || call.arguments?.patch || resultStr);
              if (fp) addAIFileToExplorer(fp, 'write');
            } else if (ok && call.name === 'delete_file') {
              const fp = call.arguments?.path || '';
              addChangeEntry(baseName(fp), fp, 'delete', '(file deleted)');
              if (fp) addAIFileToExplorer(fp, 'delete');
            } else if (ok && call.name === 'move_file') {
              // A move is two changes: the file leaves one path and arrives at
              // another. Undoing both puts it back.
              const { from = '', to = '' } = call.arguments || {};
              addChangeEntry(baseName(from), from, 'delete', '(file moved)');
              addChangeEntry(baseName(to), to, 'write', '');
              if (from) addAIFileToExplorer(from, 'delete');
              if (to) addAIFileToExplorer(to, 'write');
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

          loopNote = policy.editLoop(edited, turn.tool_calls, !!proof && proof.checks.slice(checked).some((c) => c.pass)) || loopNote;
          // Original order, so every result follows the call it answers.
          for (const call of turn.tool_calls) {
            H.appendToolResult(messages, call, results.get(call) ?? JSON.stringify({ error: 'no result' }));
          }
          attachPendingImages(messages);

          // Is this agent still getting somewhere, or reading the same files
          // round and round? The stall counter is what tells them apart.
          if (policy.iterationMadeProgress(turn.tool_calls, seenReadTargets)) stalledIterations = 0;
          else stalledIterations++;

          thinkEl = appendThinking(contentEl, { after: window.HCCodeLive.afterOf(turn.tool_calls, results, toolObject) });
          continue;
        }

        // Final answer — hide reasoning, show result
        const finalText = turn.content || '';
        if (!echoed && window.HCCodeTalk?.echoesTools(finalText, tools)) { echoed = bare = true; tools = []; thinkEl = appendThinking(contentEl); cdrTraceAdd('Check', 'The model wrote its tool list back as its reply: asking again without tools', 'warn'); continue; }
        // Sent back before finishing, for a change not made, its plan left open, not proven, or not checked against the request (js/code/verify.js), for files its answer names that are not there, or with what the site check or a second look found.
        const back = window.HCCodeVerify.sendBack(proof, messages, finalText,
          { checks: sharedState.projectChecks?.checks, prove: cdrPrefs().prove !== false, size: sharedState.size, sent, shown: window.HCCodeAttach?.shownRequest, plan: HC?.code?.plan, asks: HC?.code?.asks, light: !!sharedState.light })
          || (finalText.trim() ? (await namedLook(finalText)) || (await projectLook()) || (!sent.example && proof && cdrPrefs().prove !== false && window.HCCodeVerify.exampleNote(window.HCCodeVerify.examplesOf(window.HCCodeVerify.requestIn(messages), proof.changed.map((p) => String(p).replace(/\\/g, '/').slice(String(sharedState.projectRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').length + 1))))) || (await siteLook()) || (await factsLook()) || (await secondLook()) : null);
        if (back) {
          sent[back.kind]++;
          if (back.run && (sharedState.size === 'small' || sharedState.light || back.kind === 'example')) forced = { content: '', tool_calls: (back.runs || [back.run]).map((run, i) => ({ id: `ran_${Date.now()}_${i}`, name: 'shell_run', arguments: run })) };   // its word that the test passed is not kept
          else messages.push({ role: 'assistant', content: finalText }, { role: 'user', content: back.message, note: true });
          appendStep(contentEl, { verb: 'CHECK', object: forced ? window.HCCodeVerify.RAN_STEP : back.step, status: '' });
          cdrTraceAdd('Check', back.step, 'run');
          thinkEl = appendThinking(contentEl, { checking: true });
          continue;
        }
        if (!finalText.trim()) {
          cdrTraceAdd('Done', 'Empty response from model', 'warn');
          appendTextToBubble(contentEl, '*No response from model. Try again or check your model settings.*');
        } else {
          cdrTraceAdd('Done', (label || 'Agent') + ' · ' + finalText.length + ' chars', 'ok');
          appendTextToBubble(contentEl, finalText);
        }
        // What was proven, from the record rather than from the reply, and what is left of its plan; kept with the answer, so a saved conversation says it too.
        const proven = [proof && window.HCCodeVerify.proofLine(proof), window.HCCodeFacts?.leftLine(unconfirmed), window.HCCodePlan?.leftLine(HC?.code?.plan)].filter(Boolean).join(' ');
        sharedState.proven = proven || ''; if (proven) appendTextToBubble(contentEl, `*${proven}*`);
        return finalText;
      }
      // The budget ran out while the model was still calling tools. Strip any
      // dangling tool turns so the next user message does not produce an
      // invalid sequence like [tool, user], which most provider APIs reject.
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
      appendTextToBubble(contentEl, `*${[stop.message, window.HCCodePlan?.leftLine(HC?.code?.plan)].filter(Boolean).join(' ')}*`);
      return '';
    }

    // ── Main send ─────────────────────────────────────────────
    async function startRun() {
      const taskInput = $('cdrTaskInput');
      const task = taskInput?.value?.trim();
      if (!task) { taskInput?.focus(); return; }
      routing = null; sharedState.runBegan = Date.now();   // each run starts again from the model chosen (js/code/router.js), and its clock from now

      // Clear input and resize
      taskInput.value = '';
      autoResize(taskInput);

      // Show the request, with what is attached to it (js/code/attach.js).
      const request = window.HCCodeAttach ? window.HCCodeAttach.take(task) : { content: task, images: [] };
      appendUserMsg(window.HCCodeAttach ? window.HCCodeAttach.shownRequest(request.content) : task, request.pictures);

      // Auto-extract memory from user message
      if (cdrPrefs().memory === true) { try { window._H?.memAutoExtract?.(task); } catch {} }   // long-term memory only when HashCoder's own switch is on

      // The project's own test, lint and build commands, found once per project.
      const root = sharedState.projectRoot;
      if (root && sharedState.projectChecks?.root !== root && window.HCCodeVerify && HC?.code) {
        const io = { list: (d) => HC.code.listQuietly(d), read: (f) => HC.code.readQuietly(f), whole: (f) => HC.code.readWholeQuietly(f), drop: window.HCCodeLessons?.looksPrivate };   // whole, unasked (js/code/context.js)
        const checks = await window.HCCodeVerify.readProjectChecks(root, io);
        sharedState.projectChecks = { root, checks, ...(await window.HCCodeContext?.readProject(root, io)) };   // and its top folder and notes
        if (conversationMsgs[0]?.role === 'system') conversationMsgs[0] = systemTurn();
      }

      // A small or mid-sized local model gets fewer tools and shorter instructions (platform/tauri/hashcoder.js).
      const model = coderModel || window._H?.selectedModel?.() || '';
      const info = /^cloud:/.test(model) ? null : await Promise.resolve(window.HCLocalContext?.infoOf(window.HashCortxRuntime?.getHost?.(), model)).catch(() => null);
      const size = HC?.code?.sizeOf?.(info?.billions ?? window.HCCodeLight?.billionsInName(model)) || 'full', light = !!window.HCCodeLight?.applies(size, cdrPrefs().light);   // a size the model app does not report is read from the name
      const site = size === 'small' ? '' : (HC?.code?.siteBrief?.(task) || '');   // a site is held to the bar the Swarm's are
      const local = !/^cloud:/.test(model);   // output sized to the model (js/agent-context.js); lessons, when switched on, kept for this project (js/code/lessons.js)
      if (HC?.code) { HC.code.memoryOn = cdrPrefs().memory === true; HC.code.outputLimit = window.HCAgentContext.optionsFor(size, local).shellOutput; HC.code.lessonsFor = cdrPrefs().lessons === true && root && size === 'full' ? { root, local } : null; }
      // A larger model is given a map of the project's code, and a model on this computer a small project whole, made as a conversation begins and kept for it (js/code/codemap.js, js/code/context.js).
      const mapped = (size === 'full' ? !!window.HCCodeMap : local || light) && !!root && !!HC?.code?.readQuietly && (!conversationMsgs.length || sharedState.codeMap?.root !== root);
      if (mapped) {
        setStatus('Mapping the project…', 'thinking');
        const quiet = { list: (d) => HC.code.listQuietly(d), read: (f) => HC.code.readQuietly(f) };
        sharedState.codeMap = size === 'full' ? { root, ...(await window.HCCodeMap.forProject(root, quiet).catch(() => ({ ranked: [], read: 0 }))) } : { root, ranked: [], read: 0, whole: await window.HCCodeContext.wholeProject(root, quiet, light ? 'mid' : size).catch(() => '') };
        cdrTraceAdd('Map', sharedState.codeMap.whole ? 'the whole project, shown' : `${sharedState.codeMap.read} files read, ${sharedState.codeMap.ranked.length} with definitions`, 'ok');
      }
      if (size !== sharedState.size || local !== sharedState.local || light !== sharedState.light || mapped) {   // a cloud model is never given lessons a model on this computer kept
        sharedState.size = size; sharedState.local = local; sharedState.light = light;
        if (conversationMsgs[0]?.role === 'system') conversationMsgs[0] = systemTurn();
      }

      // Bootstrap conversation on first message
      if (!conversationMsgs.length) conversationMsgs = [systemTurn()];
      const asks = window.HCCodeAsks?.split(task) || [];   // a request of several asks, as a checklist (js/code/asks.js)
      const context = window.HCCodeTalk?.isSmallTalk(task) ? null : window.HCCodeContext?.forRequest({ site, activeFile: root && sharedState.activeFile, facts: cdrPrefs().memory !== true ? [] : (() => { try { return window._H?.memRecall?.(task, 4); } catch { return []; } })(), asks: window.HCCodeAsks?.checklist(asks) }) || '';
      conversationMsgs.push({ role: 'user', content: request.content, ...(request.images.length ? { images: request.images, thumbs: request.thumbs } : {}),
        ...(context ? { context } : {}), ...(site ? { site: true } : {}) });

      const runBtn  = $('cdrRunBtn');
      const stopBtn = $('cdrStopBtn');
      if (runBtn)  runBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = '';

      if (runAbort) runAbort.abort();
      runAbort = new AbortController();
      const { signal } = runAbort;
      // Every command this run starts carries its key, so Stop can end them.
      const stopKey = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (HC?.code) { HC.code.shellCancelKey = stopKey; HC.code.plan = null; HC.code.asks = asks; HC.code.request = task; }   // a plan, a checklist and the request's words are for one request

      setStatus('Running', 'thinking');
      cdrTraceReset('Run started');

      try {
        await runSingleTurn(signal);
      } catch (e) {
        // A stop or a failure between a tool call and its result leaves a
        // history the providers refuse; close the turn so the next one works.
        window.HCAgentShape.closeInterruptedTurn(conversationMsgs,
          e.name === 'AbortError' ? 'Stopped by the user before this finished.' : 'The run ended with an error before this finished.');
        saveCoderState();
        if (e.name === 'AbortError') {
          const c = appendAssistantBubble('HashCoder');
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
        if (HC?.code?.shellCancelKey === stopKey) HC.code.shellCancelKey = null;
        sharedState.lastRun = window.HCCodeDebug.runFacts({ routing, coderModel, sharedState, H: window._H, temperature: HC?.code?.temperatureFor?.(sharedState.size, window._H?.selectedTemperature?.()) }); saveCoderState(); setRouterChip('Auto', ''); warnIfSmall();   // the run's facts kept with the conversation, for an export; the model is loaded now, so where it runs can be read
        // Light up HashNotch. app.js fires this for a chat turn, but Coder
        // has its own loop and never reached that line — so the one kind of run
        // long enough that you would switch away from it was the one that never
        // told you it had finished. The title and nothing else.
        try { window.HC?.notch?.finished(); } catch {}
      }
    }

    async function runSingleTurn(signal) {
      // A connected system's tools when the request is about one, and nothing sent that it keeps from this model — js/mcp/connections.js.
      const run = window.HCMcp ? await window.HCMcp.forRun(coderModel || window._H?.selectedModel?.() || '', conversationMsgs) : { tools: [], refusal: '' };
      // Once a request in this conversation has built a site, its tools stay offered: a list that changes between requests is read again whole.
      const own = HC.code.toolsFor(sharedState.size, buildTools(), conversationMsgs.some((m) => m.site)).filter((t) => (t.function.name !== 'save_lesson' || !!HC.code.lessonsFor) && (HC.code.memoryOn || !/^(remember_fact|recall_facts)$/.test(t.function.name)));
      const tools = sharedState.light ? [] : [...own, ...run.tools];   // light mode: no tools; the app reads files out of the answer (js/code/light.js)
      const contentEl = appendAssistantBubble('HashCoder');
      const bubble = contentEl?.closest('.cdr-msg');
      bubble?.classList.add('running');   // copy, reply and regen wait for the answer
      HC.guard?.beginRun?.(); HC.guard?.setChecks?.(sharedState.projectChecks?.root === sharedState.projectRoot ? sharedState.projectChecks.checks : null);   // what may run unasked is judged for this run (js/code/permissions.js)
      try {
        if (run.refusal) { appendTextToBubble(contentEl, run.refusal); conversationMsgs.push({ role: 'assistant', content: run.refusal }); saveCoderState(); setStatus('Ready', ''); return; }
        const finalText = await agentLoop(conversationMsgs, tools, contentEl, '', signal);
        if (finalText) conversationMsgs.push({ role: 'assistant', content: finalText, ...(sharedState.proven ? { proven: sharedState.proven } : {}) });
        saveCoderState();
        setStatus('Ready', '');
      } finally {
        HC.guard?.endRun?.();
        settleSteps(contentEl);
        bubble?.classList.remove('running');
      }
    }

    function stopRun() {
      if (runAbort) { runAbort.abort(); runAbort = null; }
      HC?.guard?.denyWaiting?.();   // a question the run left waiting is answered no
      // A command still going would hold the run until it finished; end it,
      // and anything it started, now.
      const key = HC?.code?.shellCancelKey;
      if (key && HC.isTauri) HC.invoke('shell_cancel', { cancelKey: key }).catch(() => {});
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
  const CDR_LAYOUT_DEFAULTS = { sideW: 232, termH: 220, sideHidden: false, termHidden: true };
  // Floors, not suggestions. Dragging used to be able to squeeze a panel until
  // its own labels were clipped; these are the widths at which every panel
  // still shows what it is.
  const CDR_LIMITS = { sideMin: 208, sideMax: 460, termMin: 120, termMax: 640 };

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

  // HashCoder's choices in Settings: whether it proves a change before
  // finishing, and whether the terminal opens with it.
  const CDR_PREFS_KEY = 'hashcoder_prefs_v1';
  function cdrPrefs() {
    try { return JSON.parse(localStorage.getItem(CDR_PREFS_KEY) || '{}') || {}; } catch { return {}; }
  }
  function cdrSavePrefs(change) {
    try { localStorage.setItem(CDR_PREFS_KEY, JSON.stringify({ ...cdrPrefs(), ...change })); } catch {}
  }

  /** Show or hide the terminal, and say so on the bar's terminal button. */
  function cdrShowTerminal(show) {
    cdrLayout.termHidden = !show;
    cdrApplyLayout(); cdrSaveLayout();
  }

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
    const barBtn = $('cdrTerminalBtn');
    barBtn?.classList.toggle('on', !cdrLayout.termHidden);
    barBtn?.setAttribute('aria-expanded', cdrLayout.termHidden ? 'false' : 'true');
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

    // The terminal is hidden here and opened again from the bar.
    $('cdrTerminalCollapse')?.addEventListener('click', () => cdrShowTerminal(false));
    $('cdrTerminalExpand')?.addEventListener('click', () => {
      // Expand is a view state, not a size: leaving the dragged height alone
      // means Restore puts back exactly what the user had chosen.
      body.classList.toggle('cdr-term-full');
      cdrApplyLayout();
    });
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
    label:     "HashCoder",
    bodyClass: "coder-mode",
    appClass:  null,
    fullscreen: true,
    btnId:     "tabCode",
    mount:     () => { window.CoderMode?.mount?.(); window.CoderMode?.remount?.(); },
    destroy:   () => window.CoderMode?.destroy?.(),
  };

  // What app.js reaches in Coder: the one-shot run, the audit log and the
  // tool blocks drawn after a chat render.
  window.HC_CODE = {
    run: legacyRun,
    // Opens the modal AND fills it. This used to only add the open class, so
    // callers outside Coder got an empty dialog — the function that actually
    // reads the log sits inside the CoderMode closure, which is why it is
    // reached through CoderMode rather than named directly here.
    showAuditLog: () => CoderMode.showAuditLog(),
    afterRender: injectAllToolBlocks,
  };

})();
