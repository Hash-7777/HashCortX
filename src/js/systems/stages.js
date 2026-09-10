// ==============================================================
// The stages a generated system's records move through
//
// A generated system names its workflows — "Kitchen flow: New → Cooking →
// Served → Paid" — and draws boards of records by status. Neither did
// anything: a card could not leave its column, and a workflow's Run button
// wrote a line in the log and nothing else.
//
// This decides which field holds a record's stage, what comes before and
// after a stage, which records a workflow is about, and how many stand at
// each of its stages, so the screens can move records and show real counts.
//
// Pure: takes entities and records, returns plain values. No DOM, no storage.
//
// Loaded before the Systems mode and published as window.HCSystemsStages.
// Checked by scripts/checks/systems-stages.mjs.
// ==============================================================

(function () {
  'use strict';

  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

  /** The field that holds a record's stage: one called status, stage or state, else the first choice field. */
  function stageField(entity) {
    const fields = ((entity && entity.fields) || []).filter((f) => f.type === 'select' && Array.isArray(f.options) && f.options.length >= 2);
    return fields.find((f) => /^(status|stage|state|phase)$|_(status|stage|state)$/i.test(f.id)) || fields[0] || null;
  }

  /** The stage after this one, or null at the last. A value not among the stages moves to the first. */
  function nextStage(field, value) {
    const opts = (field && field.options) || [];
    const i = opts.findIndex((o) => norm(o) === norm(value));
    if (i === -1) return opts[0] == null ? null : opts[0];
    return i + 1 < opts.length ? opts[i + 1] : null;
  }

  /** The stage before this one, or null at the first or when it is not a stage. */
  function previousStage(field, value) {
    const opts = (field && field.options) || [];
    const i = opts.findIndex((o) => norm(o) === norm(value));
    return i > 0 ? opts[i - 1] : null;
  }

  /**
   * Which entity and field a workflow is about. A workflow may say so
   * (`entity`, `field`); otherwise it is the choice field whose options share
   * the most of its stages — at least two — or nothing.
   */
  function workflowTarget(workflow, entities) {
    const list = Object.values(entities || {});
    const stages = ((workflow && workflow.stages) || []).map(norm);
    if (workflow && workflow.entity) {
      const e = list.find((x) => x.id === workflow.entity);
      const f = e && (((e.fields || []).find((x) => x.id === workflow.field && x.type === 'select')) || stageField(e));
      if (e && f) return { entityId: e.id, field: f };
    }
    let best = null;
    for (const e of list) {
      for (const f of e.fields || []) {
        if (f.type !== 'select' || !Array.isArray(f.options)) continue;
        const shared = f.options.map(norm).filter((o) => stages.includes(o)).length;
        if (shared >= 2 && (!best || shared > best.shared)) best = { entityId: e.id, field: f, shared };
      }
    }
    return best ? { entityId: best.entityId, field: best.field } : null;
  }

  /** How many records stand at each stage, in the workflow's order. */
  function stageCounts(records, field, stages) {
    return (stages || []).map((stage) => ({
      stage,
      count: (records || []).filter((r) => norm(r && r[field.id]) === norm(stage)).length,
    }));
  }

  /**
   * The stage field of an entity whose records really move through stages —
   * one shown as a board, or the subject of a workflow — or null. An invoice's
   * Paid and Overdue are states, not steps, and a paid invoice was offered
   * "Move to Overdue".
   */
  function pipelineField(entityId, spec) {
    const entity = spec && spec.entities && spec.entities[entityId];
    const field = stageField(entity);
    if (!field) return null;
    const onBoard = ((spec && spec.modules) || []).some((m) => m.entity === entityId && m.screen === 'kanban');
    const inWorkflow = ((spec && spec.workflows) || []).some((w) => {
      const t = workflowTarget(w, spec.entities);
      return t && t.entityId === entityId && t.field.id === field.id;
    });
    return onBoard || inWorkflow ? field : null;
  }

  window.HCSystemsStages = { stageField, nextStage, previousStage, workflowTarget, stageCounts, pipelineField };
})();
