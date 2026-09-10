// ==============================================================
// How a generated system's records refer to each other and add up
//
// A generated system's records stood alone. An order's customer was a word
// typed into a box, unconnected to the customer list; a line's total was a
// number somebody had to have worked out; and nothing changed when anything
// else did. That is a spreadsheet with a sidebar, not a business system.
//
// Two things fix the most of it:
//
//  - A "link" field points at a record of another entity — an order's
//    customer, a booking's room. It holds that record's name, as a model
//    writes it and as a person searches for it, and is resolved to the record
//    when shown, so it can be followed. Renaming the record renames the links.
//  - A "formula" on a number field works it out from the record's other
//    numbers — quantity * unit_price — through the same arithmetic-only
//    evaluator the Forge uses, which can reach nothing but the numbers given.
//
// Pure: takes entities and records, returns plain values. No DOM, no storage.
//
// Loaded after js/forge/expr.js, before the Systems mode, and published as
// window.HCSystemsRelations. Checked by scripts/checks/systems-relations.mjs.
// ==============================================================

(function () {
  'use strict';

  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const VIEW = () => window.HCSystemsView;

  /**
   * A field as it can be used: a link keeps its target only if that entity
   * exists, and otherwise is plain text — a link to nothing cannot be shown.
   */
  function usableField(field, entityIds) {
    if (!field || field.type !== 'link') return field;
    const target = String(field.entity || '').trim();
    if (target && (entityIds || []).includes(target)) return { ...field, entity: target };
    const { entity, ...rest } = field;
    return { ...rest, type: 'text' };
  }

  /** Every record of an entity, found by its id or by its name without regard to case. */
  function indexOf(records, entity) {
    const map = new Map();
    for (const r of records || []) {
      if (!r) continue;
      if (r.id != null) map.set(`#${r.id}`, r);
      const label = norm(VIEW().recordLabel(r, entity));
      if (label && !map.has(label)) map.set(label, r);
    }
    return map;
  }

  /** The record a link's value names, or null when none does. */
  function resolve(value, index) {
    if (value == null || value === '') return null;
    return index.get(`#${value}`) || index.get(norm(value)) || null;
  }

  /** What a link field can be set to: the names of the target's records, each once, in order. */
  function choices(records, entity) {
    const seen = new Set();
    const out = [];
    for (const r of records || []) {
      const label = VIEW().recordLabel(r, entity);
      if (seen.has(norm(label))) continue;
      seen.add(norm(label));
      out.push(label);
    }
    return out;
  }

  /**
   * After a record is renamed, the links that named it by its old name name
   * it by its new one. Returns how many were changed.
   */
  function renameLinks(data, entities, targetId, oldName, newName) {
    if (!oldName || norm(oldName) === norm(newName)) return 0;
    let changed = 0;
    for (const e of Object.values(entities || {})) {
      const links = (e.fields || []).filter((f) => f.type === 'link' && f.entity === targetId);
      if (!links.length) continue;
      for (const r of data[e.id] || []) {
        for (const f of links) {
          if (norm(r[f.id]) === norm(oldName)) { r[f.id] = newName; changed++; }
        }
      }
    }
    return changed;
  }

  /**
   * A record with its formula fields worked out from its other numbers, in
   * as many passes as it takes for one formula to use another. A formula that
   * cannot be worked out leaves its field as it was and says why.
   */
  function computeRecord(record, entity) {
    const fields = (entity && entity.fields) || [];
    const formulas = fields.filter((f) => f.type === 'number' && typeof f.formula === 'string' && f.formula.trim());
    if (!formulas.length) return { record, errors: [] };
    const out = { ...record };
    let errors = [];
    for (let pass = 0; pass < formulas.length; pass++) {
      const scope = {};
      for (const f of fields) {
        const n = Number(out[f.id]);
        if (f.type === 'number' && out[f.id] !== '' && out[f.id] != null && Number.isFinite(n)) scope[f.id] = n;
      }
      errors = [];
      for (const f of formulas) {
        const own = { ...scope };
        delete own[f.id];
        const res = window.HCForgeExpr.evaluate(f.formula, own);
        if (res.error) { errors.push(`${f.label || f.id}: ${res.error}`); continue; }
        out[f.id] = Math.round(res.value * 100) / 100;
      }
    }
    return { record: out, errors };
  }

  window.HCSystemsRelations = { usableField, indexOf, resolve, choices, renameLinks, computeRecord };
})();
