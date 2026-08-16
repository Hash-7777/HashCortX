// ==============================================================
// Settings — the Memory pane and the memory map
//
// Everything the user can see and do with what the app remembers: the list of
// facts, editing and deleting them, importing and exporting them, and the
// radial map that draws the facts around their categories with positions and
// zoom that survive a restart.
//
// This is the UI only. The store it reads and writes is
// src/core/memory/store.js, which the agent tools write through as well — one
// source of truth for the facts, now in one file rather than in the middle of
// the agent-tool registry.
//
// So the dependencies are passed in rather than reached for. There are nine of
// them and they are listed in one place, which is the point: the old
// arrangement had the same ones, it just never had to say so.
//
// init() is called by app.js at the moment this code used to run inline, so
// the buttons below are wired in the same order relative to everything else
// as they were before.
//
// Loaded before app.js in index.html.
// ==============================================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  // Both panes build markup from stored text, so escaping is not optional.
  // It comes from the shared sanitiser rather than a local copy — a second
  // implementation of this is how one of them ends up subtly weaker.
  const escapeHtml = (s) => window.HCMarkdown.escapeHtml(s);
  let _renderMemoryPane = () => {};

  function init(deps) {
    const {
      DEFAULT_PROJECT_ID, abort, currentProject, downloadBlob, input, state,
      themedAlert, themedConfirm, themedPrompt,
    } = deps;

    // The store is a module now, so the four functions that read and write the
    // facts are read from it rather than handed in. Thirteen dependencies down
    // to nine, and the pane and the agent tools demonstrably share one store
    // rather than being passed the same four names and trusted to.
    const { memAdd, memClear, memLoad, memSave } = window.HCMemoryStore;

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
    $("memExportBtn")?.addEventListener("click", async () => {
      const dt = new Date().toISOString().slice(0, 10);
      await downloadBlob(`hashcortx-memory-${dt}.json`, JSON.stringify(memLoad(), null, 2));
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
    // ── The map ─────────────────────────────────────────────────────────
    // Drawn by core/memory/map.js, which owns the layouts, the pointer
    // handling and the honesty about what the picture shows. It gets the four
    // things it cannot reach for itself, plus a way to tell this pane that the
    // facts changed — editing a fact on the map used to refresh the map alone,
    // so the list behind it went on showing the value that had been replaced.
    window.HCMemoryMap.init({
      DEFAULT_PROJECT_ID, currentProject, state, themedConfirm, themedPrompt,
      fmtRelative,
      onFactsChanged: () => renderMemoryPane(),
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
    _renderMemoryPane = renderMemoryPane;
  }

  window.HCSettingsMemory = {
    init,
    renderMemoryPane: (...args) => _renderMemoryPane(...args),
  };
})();
