// ==============================================================
// Settings — the Memory pane and the memory map
//
// Everything the user can see and do with what the app remembers: the list of
// facts, editing and deleting them, importing and exporting them, and the
// radial map that draws the facts around their categories with positions and
// zoom that survive a restart.
//
// This is the UI only. The store it reads and writes — memLoad, memSave,
// memAdd, memClear — stays in app.js because the agent layer writes through
// the same four functions, and one source of truth for the facts matters more
// than a tidy boundary here.
//
// So the dependencies are passed in rather than reached for. There are
// thirteen of them and they are listed in one place, which is the point: the
// old arrangement had the same thirteen, it just never had to say so.
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
  let _renderMemoryPane = () => {};

  function init(deps) {
    const {
      DEFAULT_PROJECT_ID, abort, currentProject, downloadBlob, input,
      memAdd, memClear, memLoad, memSave, state,
      themedAlert, themedConfirm, themedPrompt,
    } = deps;

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
    // ── Memory map (radial diagram) ─────────────────────────────────────
    // Center node = "You". Categories derived from key prefix (text before
    // the first underscore) or from key itself when no underscore. Facts
    // sit on the outer ring under their category. Click anything to see
    // the full value in the bottom strip.
    function memCategoryOf(key) {
      const k = String(key || "").toLowerCase();
      const i = k.indexOf("_");
      if (i > 0) return k.slice(0, i);
      // Common single-token keys → group by theme
      if (/^(name|age|birthday|location|origin|languages|allergies)$/.test(k)) return "identity";
      if (/^(likes|dislikes|preferred|favorite|favourite)$/.test(k)) return "preferences";
      if (/^(employer|role|job|career)$/.test(k)) return "work";
      if (/^note_/.test(k)) return "notes";
      return "other";
    }
    // ── Map state — persisted positions + view (pan/zoom) ───────────────────
    const MEM_MAP_POS_KEY = "hashui_memmap_pos_v1";
    const MEM_MAP_VIEW_KEY = "hashui_memmap_view_v1";
    function memMapLoadPos() { try { return JSON.parse(localStorage.getItem(MEM_MAP_POS_KEY) || "{}"); } catch { return {}; } }
    function memMapSavePos(p) { try { localStorage.setItem(MEM_MAP_POS_KEY, JSON.stringify(p)); } catch {} }
    function memMapLoadView() { try { return JSON.parse(localStorage.getItem(MEM_MAP_VIEW_KEY) || "null"); } catch { return null; } }
    function memMapSaveView(v) { try { localStorage.setItem(MEM_MAP_VIEW_KEY, JSON.stringify(v)); } catch {} }

    // Convert a pointer event into SVG-userspace coords.
    function mmSvgPoint(svg, ev) {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const ctm = svg.getScreenCTM();
      return ctm ? pt.matrixTransform(ctm.inverse()) : { x: ev.clientX, y: ev.clientY };
    }

    let _mmState = null;

    function renderMemoryMap() {
      const svg   = document.getElementById("memMapSvg");
      const world = document.getElementById("mmWorld");
      const grid  = document.getElementById("mmGridBg");
      const detail = document.getElementById("memMapDetail");
      if (!svg || !world) return;

      const projectOnly = currentProject()?.memoryMode === "project";
      const facts = (typeof memLoad === "function" ? memLoad() : [])
        .filter(f => {
          const pid = f.projectId || DEFAULT_PROJECT_ID;
          return projectOnly ? pid === state.currentProjectId : (pid === DEFAULT_PROJECT_ID || pid === state.currentProjectId);
        })
        .slice();
      if (!facts.length) {
        world.removeAttribute("transform");
        if (grid) grid.removeAttribute("transform");
        _mmState = null;
        world.innerHTML = `<text x="600" y="400" text-anchor="middle" style="fill:var(--text-dim);font-size:14px;font-family:ui-sans-serif,system-ui,sans-serif">No memories yet — chat with the agent to populate the map.</text>`;
        detail.innerHTML = `<span style="color:var(--text-dim)">Empty memory.</span>`;
        return;
      }
      // Group by category
      const cats = new Map();
      for (const f of facts) {
        const c = memCategoryOf(f.key);
        if (!cats.has(c)) cats.set(c, []);
        cats.get(c).push(f);
      }
      const catList = [...cats.entries()].sort((a, b) => b[1].length - a[1].length);

      // ---- Compute default layout (radial), then override with saved drags ----
      const cx0 = 600, cy0 = 400;
      const innerR = 180, outerR = 330;
      const savedPos = memMapLoadPos();
      const nodes = []; // {id, type, x, y, w, h, label, sub, fact?, parent?}

      nodes.push({ id: "_center", type: "center", x: cx0, y: cy0, w: 110, h: 110, label: "YOU", sub: `${facts.length} fact${facts.length === 1 ? "" : "s"}` });

      catList.forEach(([cat, items], ci) => {
        const angle = (ci / catList.length) * Math.PI * 2 - Math.PI / 2;
        const dx = cx0 + Math.cos(angle) * innerR;
        const dy = cy0 + Math.sin(angle) * innerR;
        const lbl = cat.toUpperCase();
        const w = Math.max(96, lbl.length * 8 + 36);
        nodes.push({ id: "cat:" + cat, type: "cat", x: dx, y: dy, w, h: 32, label: lbl, count: items.length, parent: "_center" });
        // Spread facts on an arc around the category
        const arcSpan = Math.min((Math.PI * 2) / catList.length * 0.95, 1.3);
        items.forEach((f, fi) => {
          const t = items.length === 1 ? 0 : (fi / (items.length - 1)) - 0.5;
          const fa = angle + t * arcSpan;
          const fx = cx0 + Math.cos(fa) * outerR;
          const fy = cy0 + Math.sin(fa) * outerR;
          const keyLabel = f.key.length > 18 ? f.key.slice(0, 17) + "…" : f.key;
          const valLabel = (f.value || "").length > 22 ? f.value.slice(0, 21) + "…" : (f.value || "");
          const w = Math.max(116, Math.min(170, Math.max(keyLabel.length, valLabel.length) * 5.6 + 24));
          nodes.push({ id: "fact:" + f.id, type: "fact", x: fx, y: fy, w, h: 40, label: keyLabel, sub: valLabel, fact: f, parent: "cat:" + cat });
        });
      });
      // Apply saved overrides
      nodes.forEach(n => {
        const p = savedPos[n.id];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { n.x = p.x; n.y = p.y; }
      });

      // ---- Render edges first (they sit beneath nodes) ----
      const edges = [];
      nodes.forEach(n => {
        if (!n.parent) return;
        const p = nodes.find(x => x.id === n.parent);
        if (!p) return;
        edges.push({ from: p, to: n, kind: n.type === "cat" ? "cat" : "fact" });
      });

      const svgEdges = edges.map((e, i) =>
        `<line class="mm-link ${e.kind === "cat" ? "cat" : ""}" data-edge="${i}" x1="${e.from.x.toFixed(1)}" y1="${e.from.y.toFixed(1)}" x2="${e.to.x.toFixed(1)}" y2="${e.to.y.toFixed(1)}"/>`
      ).join("");

      const svgNodes = nodes.map(n => {
        if (n.type === "center") {
          return `<g class="mm-node" data-id="${n.id}" data-type="center" transform="translate(${n.x} ${n.y})">
            <circle class="mm-center-halo" r="74"/>
            <circle class="mm-center-core" r="48"/>
            <text class="mm-center-text" y="-4">${escapeHtml(n.label)}</text>
            <text class="mm-center-sub"  y="13">${escapeHtml(n.sub)}</text>
          </g>`;
        }
        if (n.type === "cat") {
          return `<g class="mm-node" data-id="${escapeHtml(n.id)}" data-type="cat" transform="translate(${n.x} ${n.y})">
            <rect class="mm-cat-bg" x="${-n.w/2}" y="${-n.h/2}" width="${n.w}" height="${n.h}" rx="${n.h/2}"/>
            <text class="mm-cat-text" y="-1">${escapeHtml(n.label)}</text>
            <text class="mm-cat-count" x="${n.w/2 - 14}" y="0">·${n.count}</text>
          </g>`;
        }
        // fact
        return `<g class="mm-node" data-id="${escapeHtml(n.id)}" data-type="fact" transform="translate(${n.x} ${n.y})">
          <rect class="mm-fact-bg" x="${-n.w/2}" y="${-n.h/2}" width="${n.w}" height="${n.h}" rx="10"/>
          <text class="mm-fact-key" y="-7">${escapeHtml(n.label)}</text>
          <text class="mm-fact-val" y="9">${escapeHtml(n.sub)}</text>
        </g>`;
      }).join("");

      world.innerHTML = svgEdges + svgNodes;

      // ---- View transform (pan/zoom) ----
      const savedView = memMapLoadView() || { tx: 0, ty: 0, k: 1 };
      const view = {
        tx: Number.isFinite(savedView.tx) ? savedView.tx : 0,
        ty: Number.isFinite(savedView.ty) ? savedView.ty : 0,
        k: Number.isFinite(savedView.k) ? Math.max(0.25, Math.min(3.5, savedView.k)) : 1
      };
      function applyView() {
        world.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.k})`);
        if (grid) grid.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.k})`);
      }
      applyView();

      // ---- Stash state for handlers (zoom buttons read this) ----
      function fitView(persist = true) {
        if (!nodes.length) return;
        const pad = 120;
        const bounds = nodes.reduce((acc, n) => ({
          minX: Math.min(acc.minX, n.x - n.w / 2),
          minY: Math.min(acc.minY, n.y - n.h / 2),
          maxX: Math.max(acc.maxX, n.x + n.w / 2),
          maxY: Math.max(acc.maxY, n.y + n.h / 2)
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const vb = svg.viewBox.baseVal;
        const bw = Math.max(1, bounds.maxX - bounds.minX);
        const bh = Math.max(1, bounds.maxY - bounds.minY);
        const k = Math.max(0.45, Math.min(1.6, Math.min((vb.width - pad * 2) / bw, (vb.height - pad * 2) / bh)));
        view.k = k;
        view.tx = vb.x + vb.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k;
        view.ty = vb.y + vb.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k;
        applyView();
        if (persist) memMapSaveView(view);
      }

      _mmState = { svg, world, view, applyView, fitView, nodes, edges, savedPos };

      // ---- Drag a single node ----
      function attachDrag(g) {
        const id = g.getAttribute("data-id");
        const node = nodes.find(n => n.id === id);
        if (!node) return;
        let dragStart = null;
        g.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          g.setPointerCapture(e.pointerId);
          g.classList.add("dragging");
          const pt = mmSvgPoint(svg, e);
          // Convert to world coords
          const wx = (pt.x - view.tx) / view.k;
          const wy = (pt.y - view.ty) / view.k;
          dragStart = { wx, wy, nx: node.x, ny: node.y, moved: false };
        });
        g.addEventListener("pointermove", (e) => {
          if (!dragStart) return;
          const pt = mmSvgPoint(svg, e);
          const wx = (pt.x - view.tx) / view.k;
          const wy = (pt.y - view.ty) / view.k;
          const dx = wx - dragStart.wx;
          const dy = wy - dragStart.wy;
          if (Math.abs(dx) + Math.abs(dy) > 2) dragStart.moved = true;
          node.x = dragStart.nx + dx;
          node.y = dragStart.ny + dy;
          g.setAttribute("transform", `translate(${node.x} ${node.y})`);
          // Update incident edges
          edges.forEach((edge, i) => {
            if (edge.from.id === id || edge.to.id === id) {
              const line = world.querySelector(`line[data-edge="${i}"]`);
              if (!line) return;
              line.setAttribute("x1", edge.from.x.toFixed(1));
              line.setAttribute("y1", edge.from.y.toFixed(1));
              line.setAttribute("x2", edge.to.x.toFixed(1));
              line.setAttribute("y2", edge.to.y.toFixed(1));
            }
          });
        });
        const finish = (e) => {
          if (!dragStart) return;
          g.classList.remove("dragging");
          try { g.releasePointerCapture(e.pointerId); } catch {}
          if (dragStart.moved) {
            savedPos[id] = { x: node.x, y: node.y };
            memMapSavePos(savedPos);
          } else {
            // It was a click — show details
            if (node.type === "fact" && node.fact) {
              world.querySelectorAll(".mm-node").forEach(n => n.classList.remove("active"));
              g.classList.add("active");
              detail.innerHTML = `<span style="color:var(--gold-deep);font-family:ui-monospace,Menlo,monospace;font-size:11.5px">${escapeHtml(node.fact.key)}</span> &nbsp;<span style="color:var(--muted);font-size:10.5px">${fmtRelative(node.fact.ts)}</span><div style="margin-top:4px;color:var(--text)">${escapeHtml(node.fact.value)}</div><div style="margin-top:6px;font-size:10.5px;color:var(--muted)">Double-click the node to edit · drag to reposition</div>`;
            } else if (node.type === "cat") {
              detail.innerHTML = `<span style="color:var(--gold-deep)">Category:</span> ${escapeHtml(node.label)} <span style="color:var(--muted)">— ${node.count} fact(s). Drag to rearrange the cluster.</span>`;
            } else if (node.type === "center") {
              detail.innerHTML = `<span style="color:var(--gold)">YOU</span> — drag categories around to organize, double-click facts to edit.`;
            }
          }
          dragStart = null;
        };
        g.addEventListener("pointerup", finish);
        g.addEventListener("pointercancel", finish);

        // Edit on double-click (facts only)
        g.addEventListener("dblclick", async (e) => {
          if (node.type !== "fact" || !node.fact) return;
          e.stopPropagation();
          const next = await themedPrompt(`Edit "${node.fact.key}":`, node.fact.value, "Memory");
          if (next == null) return;
          const arr = memLoad();
          const i = arr.findIndex(x => x.id === node.fact.id);
          if (i < 0) return;
          if (!next.trim()) { arr.splice(i, 1); }
          else { arr[i].value = next.trim().slice(0, 1200); arr[i].ts = Date.now(); }
          memSave(arr);
          renderMemoryMap();
        });
      }
      world.querySelectorAll(".mm-node").forEach(attachDrag);

      // ---- Pan on background drag ----
      let panStart = null;
      svg.onpointerdown = (e) => {
        if (e.target.closest(".mm-node")) return; // node drag handled by attachDrag
        if (e.button !== 0) return;
        svg.setPointerCapture(e.pointerId);
        svg.classList.add("panning");
        panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      };
      svg.onpointermove = (e) => {
        if (!panStart) return;
        const ctm = svg.getScreenCTM();
        const scaleX = ctm ? 1 / ctm.a : 1;
        const scaleY = ctm ? 1 / ctm.d : 1;
        view.tx = panStart.tx + (e.clientX - panStart.x) * scaleX;
        view.ty = panStart.ty + (e.clientY - panStart.y) * scaleY;
        applyView();
      };
      const endPan = (e) => {
        if (!panStart) return;
        try { svg.releasePointerCapture(e.pointerId); } catch {}
        svg.classList.remove("panning");
        panStart = null;
        memMapSaveView(view);
      };
      svg.onpointerup = endPan;
      svg.onpointercancel = endPan;

      // ---- Zoom on wheel (around cursor) ----
      svg.onwheel = (e) => {
        e.preventDefault();
        const pt = mmSvgPoint(svg, e);
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newK = Math.max(0.25, Math.min(3.5, view.k * factor));
        // Keep cursor anchored: world coord under cursor stays put
        const wx = (pt.x - view.tx) / view.k;
        const wy = (pt.y - view.ty) / view.k;
        view.tx = pt.x - wx * newK;
        view.ty = pt.y - wy * newK;
        view.k = newK;
        applyView();
        memMapSaveView(view);
      };
    }

    // Zoom buttons + reset positions
    function memMapZoom(factor) {
      if (!_mmState) return;
      const { svg, view, applyView } = _mmState;
      const rect = svg.getBoundingClientRect();
      const fakeEv = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      const pt = mmSvgPoint(svg, fakeEv);
      const newK = Math.max(0.25, Math.min(3.5, view.k * factor));
      const wx = (pt.x - view.tx) / view.k;
      const wy = (pt.y - view.ty) / view.k;
      view.tx = pt.x - wx * newK;
      view.ty = pt.y - wy * newK;
      view.k = newK;
      applyView();
      memMapSaveView(view);
    }
    $("memMapBtn")?.addEventListener("click", () => {
      const ov = $("memMapOverlay");
      if (!ov) return;
      ov.classList.add("open");
      renderMemoryMap();
    });
    $("memMapClose")?.addEventListener("click", () => $("memMapOverlay")?.classList.remove("open"));
    $("memMapOverlay")?.addEventListener("click", (e) => { if (e.target.id === "memMapOverlay") e.currentTarget.classList.remove("open"); });
    $("memMapZoomIn")?.addEventListener("click",  () => memMapZoom(1.2));
    $("memMapZoomOut")?.addEventListener("click", () => memMapZoom(1 / 1.2));
    $("memMapFit")?.addEventListener("click", () => {
      if (!_mmState) return;
      _mmState.fitView();
    });
    $("memMapReset")?.addEventListener("click", async () => {
      const ok = await themedConfirm("Reset all node positions back to the default radial layout?", "Memory map");
      if (!ok) return;
      try { localStorage.removeItem(MEM_MAP_POS_KEY); } catch {}
      renderMemoryMap();
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
