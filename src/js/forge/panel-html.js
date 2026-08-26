// ============================================================
// panel-html.js — the markup of the selection panel
//
// This is what a person reads and types into, and until now it was a hundred
// and thirty lines of template literal inside a three-thousand-line file that
// also owns the scene, the agent run and the exports. Nothing about it could be
// checked except by matching patterns against its own source, which tests that
// a line was written rather than that the panel says the right thing.
//
// Here it is a function from a plain description of the selection to a string,
// so a check can build a panel for a part that cuts, or a part with no
// dimensions of its own, or a model with no real size yet, and read what it
// actually says.
//
// EVERYTHING A PERSON MIGHT HAVE TYPED IS ESCAPED. A part's name comes from a
// prompt by way of a language model, and a model asked for a bracket will
// happily call it one. An unescaped name here would end the attribute it sits
// in.
//
// Pure: no THREE, no DOM, no network, no clock. It reads the units and shape
// tables off the window the way every other module in this folder does.
//
// Run the checks with: npm run check:forge-panel
// ============================================================
(function () {
  "use strict";

  const units = () => window.HCForgeUnits || null;
  const params = () => window.HCForgeParams || null;

  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const AXES = ["x", "y", "z"];

  /**
   * With nothing selected, the panel holds the one property the whole model
   * has. It used to be a sentence telling you to select something, and a model
   * whose size is a silent default is a model that prints at the wrong size.
   */
  function wholeModelCard(state) {
    const U = units();
    const nothing = `<div class="frg-selection-empty">Click any part in the void to edit it.</div>`;
    if (!state.plan || !U) return nothing;
    const sizeMm = state.plan.sizeMm ?? U.DEFAULT_SIZE_MM ?? 0;
    const measured = state.measured ? escapeHtml(state.measured.text) : "Nothing built yet";
    const stated = state.plan.sizeStated ? "" : " · this size is a default until you set it";
    return `<div class="frg-edit-grid" aria-label="Model size" style="grid-template-columns:1fr">
             <span class="frg-edit-field">
               <label>Longest side (mm)</label>
               <input data-frg-model-size type="number" min="${U.MIN_SIZE_MM}" max="${U.MAX_SIZE_MM}" step="1" value="${escapeHtml(String(Math.round(sizeMm)))}">
             </span>
           </div>
           <div class="frg-selection-empty">${measured}${stated}</div>
           ${nothing}`;
  }

  /** A row of three numbers, one per axis. */
  function axisGrid(label, cells, style = "") {
    return `<div class="frg-edit-grid" aria-label="${escapeHtml(label)}"${style ? ` style="${style}"` : ""}>
        ${cells.join("")}
      </div>`;
  }

  function field(label, attributes, value) {
    return `<span class="frg-edit-field"><label>${escapeHtml(label)}</label><input ${attributes} value="${escapeHtml(value)}"></span>`;
  }

  /**
   * What this part does to the material around it.
   *
   * The rounded join is offered only where the part ADDS: it is how far the
   * join with its neighbour is softened, and beside a cut it would be a number
   * that does nothing.
   */
  function materialRole(node, mmPerUnit) {
    const U = units();
    const op = node.op === "subtract" || node.op === "intersect" ? node.op : "union";
    const options = [
      ["union", "Adds material"],
      ["subtract", "Cuts away"],
      ["intersect", "Keeps only what overlaps"],
    ];
    const inMm = U && mmPerUnit;
    const blend = Number(node.blend) > 0 ? Number(node.blend) : 0;
    const blendShown = inMm ? U.formatMm(U.toMm(blend, mmPerUnit), { bare: true }) : blend.toFixed(3);
    return `
      <div class="frg-edit-grid" aria-label="What this part does" style="grid-template-columns:1fr; margin-top:6px">
        <span class="frg-edit-field">
          <label>What this part does</label>
          <select data-frg-op>
            ${options.map(([value, text]) => `<option value="${value}"${value === op ? " selected" : ""}>${text}</option>`).join("")}
          </select>
        </span>
        ${op === "union"
          ? field(`Rounded join${inMm ? " (mm)" : ""}`, `data-frg-blend type="number" min="0" step="${inMm ? 1 : 0.01}"`, blendShown)
          : ""}
      </div>`;
  }

  /**
   * The part's own dimensions.
   *
   * Resizing cannot stand in for these: scaling a cylinder on two axes gives an
   * oval prism, while changing its radius gives a wider cylinder. Lengths are
   * shown in millimetres through the same lens as a position; counts — how many
   * sides a curve is drawn with — stay whole numbers.
   */
  function shapeFields(node, mmPerUnit) {
    const P = params();
    if (!P) return "";
    const fields = P.valuesOf(node);
    if (!fields.length) {
      // Said rather than left blank. A mesh is somebody else's vertices and has
      // no radius to change; an empty space reads as a panel that failed.
      return `<div class="frg-selection-empty" style="margin-top:8px">A ${escapeHtml(node.type || "part")} has no dimensions of its own to change — move, turn and resize it instead.</div>`;
    }
    const U = units();
    const inMm = U && mmPerUnit;
    return axisGrid("Shape", fields.map((f) => {
      const isLength = f.kind === "length";
      const value = isLength && inMm
        ? U.formatMm(U.toMm(f.value, mmPerUnit), { bare: true })
        : isLength ? Number(f.value).toFixed(3) : String(f.value);
      const label = isLength && inMm ? `${f.label} (mm)` : f.label;
      const step = isLength ? (inMm ? 1 : 0.01) : 1;
      const min = isLength && inMm ? 0 : f.min;
      return field(label, `data-frg-param="${escapeHtml(f.key)}" type="number" step="${step}" min="${min}"`, value);
    }), "margin-top:6px");
  }

  /**
   * The whole card, for whatever is selected.
   *
   * `state` carries plain values only — arrays of numbers rather than scene
   * objects, degrees rather than radians — so that everything here can be
   * built and read in a check without a browser.
   *
   * `hasTwin` says this part is one half of a mirrored pair. It is said out
   * loud because a person editing one part and seeing two change should be
   * told why, and told how to stop it.
   */
  function card(state) {
    const s = state || {};
    if (!s.node) return wholeModelCard(s);

    const node = s.node;
    const U = units();
    const inMm = U && s.mmPerUnit;
    const title = s.wholeObject ? "Whole object" : node.name || s.fallbackName || "Part";
    const kind = s.wholeObject ? "object" : node.role || "part";
    const pos = Array.isArray(s.position) ? s.position : [0, 0, 0];
    const scale = Array.isArray(s.scale) ? s.scale : [1, 1, 1];
    const rot = Array.isArray(s.rotationDeg) ? s.rotationDeg : [0, 0, 0];

    return `
      <div class="frg-selection-title">
        <b title="${escapeHtml(title)}">${escapeHtml(title)}</b>
        <span>${escapeHtml(kind)}</span>
      </div>
      ${s.wholeObject ? "" : `<div class="frg-edit-grid" aria-label="Name" style="grid-template-columns:1fr">
        ${field("Name", `data-frg-name type="text" maxlength="60"`, node.name || node.id || "")}
      </div>`}
      <div class="frg-edit-buttons">
        <button class="frg-edit-btn${s.transformMode === "translate" ? " active" : ""}" data-frg-edit="translate">Move</button>
        <button class="frg-edit-btn${s.transformMode === "rotate" ? " active" : ""}" data-frg-edit="rotate">Rotate</button>
        <button class="frg-edit-btn${s.transformMode === "scale" ? " active" : ""}" data-frg-edit="scale">Resize</button>
        <button class="frg-edit-btn danger" data-frg-edit="delete">Delete</button>
      </div>
      <div class="frg-edit-buttons">
        <button class="frg-edit-btn" data-frg-edit="duplicate">Duplicate</button>
        <button class="frg-edit-btn" data-frg-edit="floor">To floor</button>
        <button class="frg-edit-btn" data-frg-edit="reset">Reset</button>
        <button class="frg-edit-btn${s.snapEnabled ? " active" : ""}" data-frg-edit="snap">Snap</button>
      </div>
      ${axisGrid("Position", AXES.map((axis, i) => {
        // Shown in millimetres when the model has a real size, because a
        // position in scene units is a number with no meaning outside this
        // window. The step follows: a millimetre, not a twentieth of nothing.
        const value = inMm ? U.formatMm(U.toMm(pos[i], s.mmPerUnit), { bare: true }) : Number(pos[i]).toFixed(2);
        return field(`${inMm ? "mm" : "Pos"} ${axis.toUpperCase()}`, `data-frg-pos="${axis}" type="number" step="${inMm ? 1 : 0.05}"`, value);
      }))}
      ${axisGrid("Scale", AXES.map((axis, i) =>
        field(`Scale ${axis.toUpperCase()}`, `data-frg-scale="${axis}" type="number" step="0.05" min="0.02"`, Number(scale[i]).toFixed(2))), "margin-top:6px")}
      ${axisGrid("Rotation", AXES.map((axis, i) =>
        field(`Rot ${axis.toUpperCase()}`, `data-frg-rot="${axis}" type="number" step="5"`, Math.round(Number(rot[i])))), "margin-top:6px")}
      ${s.wholeObject || !s.hasTwin ? "" : `
      <div class="frg-selection-empty" style="margin-top:8px">
        One of a mirrored pair — the other one follows everything you do here,
        mirrored: its size, what it does to the material, and where it sits.
        <button class="frg-edit-btn" data-frg-edit="unmirror" style="margin-top:6px">Make them separate</button>
      </div>`}
      ${s.wholeObject ? "" : materialRole(node, s.mmPerUnit)}
      ${s.wholeObject ? "" : shapeFields(node, s.mmPerUnit)}`;
  }

  window.HCForgePanelHtml = { card, escapeHtml };
})();
