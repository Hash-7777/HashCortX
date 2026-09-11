// ==============================================================
// Changing a generated system by asking
//
// A system could only be made, never changed: asking for a loyalty program
// meant a new system from nothing, with new records and a new look, and the
// one being worked on left behind. Now a request is applied to the system
// that is open. This is the part that can be checked without a model:
//
//  - what the model is shown of the system — its design and schema, and a
//    couple of records per entity rather than all of them;
//  - the design choices the request did not touch, kept as they were when
//    the model's answer leaves them out;
//  - what changed, said in words, so the person sees what their request did.
//
// Pure: specs in, plain values out. No DOM, no storage, no network.
//
// Loaded before the Systems mode and published as window.HCSystemsRevise.
// Checked by scripts/checks/systems-revise.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * The system as the model is shown it: everything but its records, its
   * history and its generated books, with two records of each entity so its
   * data's shape and style can be followed.
   */
  function compactSpec(spec, data) {
    const { mockData, revisionHistory, financialModel, ...rest } = spec || {};
    const samples = {};
    for (const id of Object.keys((spec && spec.entities) || {})) {
      const rows = ((data || {})[id] || []).slice(0, 2).map(({ id: _, ...row }) => row);
      if (rows.length) samples[id] = rows;
    }
    return { ...rest, sampleRecords: samples };
  }

  const THEME_KEYS = ['mode', 'primary', 'accent', 'radius', 'font', 'density', 'surface'];
  const LAYOUT_KEYS = ['shell', 'nav', 'dashboardStyle'];

  /**
   * The changed system, with every design choice its answer left out taken
   * from the system as it was — a request to add a module does not re-dress
   * the whole system.
   */
  function keepDesign(before, after) {
    const out = { ...after, theme: { ...((after && after.theme) || {}) }, layout: { ...((after && after.layout) || {}) } };
    for (const k of THEME_KEYS) if (out.theme[k] == null && before && before.theme && before.theme[k] != null) out.theme[k] = before.theme[k];
    for (const k of LAYOUT_KEYS) if (out.layout[k] == null && before && before.layout && before.layout[k] != null) out.layout[k] = before.layout[k];
    return out;
  }

  const names = (list) => list.map((x) => `"${x}"`).join(', ');

  /** What a change did, in words: modules, entities, fields and design. */
  function specChanges(before, after) {
    const out = [];
    const mods = (s) => new Map(((s && s.modules) || []).map((m) => [m.id, m]));
    const b = mods(before);
    const a = mods(after);
    const addedM = [...a.values()].filter((m) => !b.has(m.id)).map((m) => m.name);
    const goneM = [...b.values()].filter((m) => !a.has(m.id)).map((m) => m.name);
    if (addedM.length) out.push(`Added ${addedM.length === 1 ? 'module' : 'modules'} ${names(addedM)}`);
    if (goneM.length) out.push(`Removed ${goneM.length === 1 ? 'module' : 'modules'} ${names(goneM)}`);
    for (const [id, m] of a) {
      const old = b.get(id);
      if (old && old.screen !== m.screen) out.push(`"${m.name}" is now shown as ${m.screen}`);
    }
    const ents = (s) => (s && s.entities) || {};
    for (const [id, e] of Object.entries(ents(after))) {
      const old = ents(before)[id];
      if (!old) { out.push(`Added ${e.name || id}`); continue; }
      const had = new Set((old.fields || []).map((f) => f.id));
      const added = (e.fields || []).filter((f) => !had.has(f.id)).map((f) => f.label || f.id);
      if (added.length) out.push(`${e.name || id}: added ${names(added)}`);
      const now = new Set((e.fields || []).map((f) => f.id));
      const gone = (old.fields || []).filter((f) => !now.has(f.id)).map((f) => f.label || f.id);
      if (gone.length) out.push(`${e.name || id}: removed ${names(gone)}`);
    }
    for (const k of THEME_KEYS) {
      const x = before && before.theme && before.theme[k];
      const y = after && after.theme && after.theme[k];
      if (x != null && y != null && String(x) !== String(y)) out.push(`${k === 'mode' ? 'Theme' : k[0].toUpperCase() + k.slice(1)}: ${x} → ${y}`);
    }
    const sx = before && before.layout && before.layout.shell;
    const sy = after && after.layout && after.layout.shell;
    if (sx && sy && sx !== sy) out.push(`Layout: ${sx} → ${sy}`);
    return out;
  }

  window.HCSystemsRevise = { compactSpec, keepDesign, specChanges };
})();
