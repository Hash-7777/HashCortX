// ==============================================================
// The memory store
//
// The facts the app remembers: reading and writing them, adding one with the
// project scope the user has chosen, ranking them for recall, and pulling them
// out of a message automatically.
//
// This is the store, not the UI. src/core/settings/memory-pane.js draws the
// list and the map and reads through here; the Coder agent's remember_fact and
// recall_facts tools reach the same four functions through the bridge in
// app.js. One source of truth for the facts was always the point — it just
// used to be a source of truth that lived in the middle of the agent-tool
// registry, because that is where the first caller happened to be.
//
// Ranking and extraction are somebody else's job: HCMemory in
// src/js/memory.js does the stemming, the synonyms and the scoring. This file
// stores and retrieves.
//
// Loaded before app.js in index.html.
// ==============================================================
(function () {
  'use strict';

  let deps = {
    state: {},
    uid: () => String(Date.now()),
    currentProject: () => null,
    DEFAULT_PROJECT_ID: 'project_personal',
  };

  function init(d) { deps = { ...deps, ...d }; }

    const MEM_KEY = "hashui_agent_memory_v1";
    const MEM_MAX_FACTS = 500;

    function memLoad() {
      try {
        const raw = localStorage.getItem(MEM_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(f => ({
          id: f.id || deps.uid(),
          key: String(f.key || "").slice(0, 120),
          value: String(f.value || "").slice(0, 1200),
          ts: Number(f.ts) || Date.now(),
          projectId: f.projectId || deps.DEFAULT_PROJECT_ID,
          scope: f.scope || (f.projectId && f.projectId !== deps.DEFAULT_PROJECT_ID ? "project" : "personal"),
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
      const projectOnly = deps.currentProject()?.memoryMode === "project";
      const projectId = projectOnly ? deps.state.currentProjectId : deps.DEFAULT_PROJECT_ID;
      // dedup by key — newest wins, but keep history
      const existing = arr.findIndex(f => f.key.toLowerCase() === k.toLowerCase() && (f.projectId || deps.DEFAULT_PROJECT_ID) === projectId);
      if (existing >= 0) arr.splice(existing, 1);
      arr.push({ id: deps.uid(), key: k, value: v, ts: Date.now(), projectId, scope: projectOnly ? "project" : "personal", confidence: 1, approved: true, source: "chat" });
      memSave(arr);
      return { ok: true, saved: { key: k, value: v, projectId } };
    }
    // Which facts the most recent recall actually returned.
    //
    // Recorded here because this is the one funnel every caller goes through —
    // chat, the Coder agent's recall_facts tool and the modes all reach
    // memRecall, so there is nowhere else a fact can be looked up from. The map
    // reads it to mark what the last reply used, which is the difference
    // between showing what is stored and showing what is working.
    let _lastRecalled = [];
    function lastRecalledIds() { return _lastRecalled.slice(); }

    // Synonym groups so semantically related queries hit the same facts.
    // E.g. asking "what do I love" matches a saved "likes" / "favorite".
    function memRecall(query, limit = 6) {
      const projectOnly = deps.currentProject()?.memoryMode === "project";
      const arr = memLoad().filter(f => {
        const pid = f.projectId || deps.DEFAULT_PROJECT_ID;
        return projectOnly ? pid === deps.state.currentProjectId : (pid === deps.DEFAULT_PROJECT_ID || pid === deps.state.currentProjectId);
      });
      // Which facts this project may see is decided here; the ordering is in
      // js/memory.js, where it can be checked against questions worded nothing
      // like the fact they are looking for.
      const ranked = HCMemory.rankMemories(arr, query, { limit });
      _lastRecalled = ranked.map(f => f.id).filter(Boolean);
      return ranked;
    }

    // Lightweight auto-extractor: catches the most common "I am / I like / I
    // work at / I live in / my name is" patterns from a user message and
    // saves them silently. Runs on every user turn so memory is reliable
    // even when the model forgets to call remember_fact.
    function memAutoExtract(text) {
      // The patterns are in js/memory.js and return what they found without
      // storing it, so they can be run over any text in a check. Deciding what
      // is kept stays here.
      const found = HCMemory.extractFacts(text);
      for (const f of found) memAdd(f.key, f.value);
      return found;
    }

    // Run extraction on assistant replies too. Catches facts the assistant
    // confirmed/echoed back ("Got it — I'll remember you live in Cairo")
    // and silently extracts inferred facts from the user side of the dialog.
    function memAutoExtractFromAssistant(text) {
      // Patterns in js/memory.js, for the same reason as the user-side ones:
      // they return what they found and the storing is decided here.
      const found = HCMemory.extractFactsFromAssistant(text);
      for (const f of found) memAdd(f.key, f.value);
      return found;
    }

    // Expose for other modes (coder, swarm) to call after their assistant turns
    try { window.memAutoExtractFromAssistant = memAutoExtractFromAssistant; } catch {}
    function memClear() { try { localStorage.removeItem(MEM_KEY); } catch {} }
  window.HCMemoryStore = {
    init,
    MEM_KEY,
    memLoad, memSave, memAdd, memRecall, memClear, lastRecalledIds,
    memAutoExtract, memAutoExtractFromAssistant,
  };
})();
