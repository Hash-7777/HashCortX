// ==============================================================
// Working the system by asking, in words
//
// A generated system could be MADE by asking, and its design CHANGED by asking
// (js/systems/revise.js). What it could never do is the thing somebody
// actually has a business system for: "Seif paid his due expenses" — find the
// record, change the right field, and leave everything else alone. Every day's
// work meant opening a table and editing cells by hand, which is the part a
// person wanted help with.
//
// This is the half that can be checked without a model: what the model is
// shown, and — far more importantly — what is done with what it says back.
//
// NOTHING A MODEL SAYS IS APPLIED AS IT ARRIVES
// ---------------------------------------------
// These are somebody's business records. A model asked to mark one expense
// paid can answer with fifty deletions, a field that does not exist, a value
// of the wrong kind, or an id it invented, and any of those applied without
// checking is data loss nobody asked for. So every change is rebuilt from the
// system's own schema before it is allowed near anything:
//
//   · the table must be one the system has;
//   · a change to a record must name an id that is really there;
//   · every field must be declared on that table — a name the schema does not
//     carry is dropped, not guessed at;
//   · a value must fit its field's type, and a choice must be one of the
//     choices that field offers;
//   · a deletion is kept separate from an edit, and counted separately, so
//     "three changes" can never quietly mean "three rows gone";
//   · and everything is capped, because a loop is a plausible way for a model
//     to answer and an unbounded one would rewrite the whole system.
//
// What comes out is a plan a person reads BEFORE anything is written: which
// table, which record, which field, from what to what. It is refused, not
// applied, when nothing in it survives the checking.
//
// Pure: a spec, some records and a model's answer go in; a plan comes out. No
// DOM, no storage, no network.
//
// Loaded before the Systems mode and published as window.HCSystemsWork.
// Checked by scripts/checks/systems-work.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The most changes one request may make. A day's work is not fifty edits. */
  const MAX_CHANGES = 40;
  /** The most fields one change may set. */
  const MAX_FIELDS = 24;
  /** The most records of one table the model is shown. */
  const MAX_SHOWN = 40;
  /** How much of a value is kept. A cell is not a document. */
  const MAX_VALUE = 2000;

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  /** The tables a system has, by id. */
  function entitiesOf(spec) {
    const out = new Map();
    for (const entity of (spec && spec.entities) || []) {
      if (entity && entity.id) out.set(String(entity.id), entity);
    }
    return out;
  }

  /** The fields a table declares, by id. */
  function fieldsOf(entity) {
    const out = new Map();
    for (const field of (entity && entity.fields) || []) {
      if (field && field.id) out.set(String(field.id), field);
    }
    return out;
  }

  /**
   * A value made to fit the field it is going into, or `undefined` when it
   * cannot be.
   *
   * `undefined` matters: it is how a field is dropped rather than written with
   * something the table cannot hold. A number field given "soon" keeps what it
   * had, and the plan says the field was not understood.
   */
  function fit(field, value) {
    const type = (field && field.type) || 'text';
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'object') return undefined;   // a cell is not a structure
    const text = clean(value, MAX_VALUE);
    if (!text) return type === 'text' || type === 'textarea' ? '' : undefined;
    if (type === 'number') {
      // Written as money or with separators is still a number.
      const stripped = text.replace(/[^0-9.\-]/g, '');
      // A digit has to survive the stripping. Without this line "quite a lot"
      // strips to nothing, Number('') is 0, and an Amount field is silently
      // set to zero — somebody's money, gone, because a model was vague.
      if (!/[0-9]/.test(stripped)) return undefined;
      const value = Number(stripped);
      return Number.isFinite(value) ? value : undefined;
    }
    if (type === 'date') {
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) return undefined;
      return d.toISOString().slice(0, 10);
    }
    if (type === 'select') {
      const options = Array.isArray(field.options) ? field.options.map(String) : [];
      if (!options.length) return text;
      // Matched without regard to case or spacing, because a model writes
      // "paid" for an option spelled "Paid" and refusing that helps nobody.
      const want = text.toLowerCase().replace(/\s+/g, '');
      const found = options.find((o) => o.toLowerCase().replace(/\s+/g, '') === want);
      return found === undefined ? undefined : found;
    }
    return text;
  }

  /**
   * What the model is shown of the system: its tables and fields, and the
   * records most likely to be the ones meant.
   *
   * Not every record — a table can hold twenty thousand, and a request about
   * one of them does not need the other 19,999 in front of the model. Records
   * are picked by the words of the request, and the most recent ones are used
   * to fill the rest, so a request that names nothing still has something to
   * work from.
   */
  function shown(spec, data, request, limit = MAX_SHOWN) {
    const words = String(request || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
    const wanted = [...new Set(words)];
    const tables = [];
    for (const [id, entity] of entitiesOf(spec)) {
      const rows = Array.isArray(data && data[id]) ? data[id] : [];
      const scored = rows.map((row) => {
        const text = Object.values(row || {}).map((v) => String(v == null ? '' : v).toLowerCase()).join(' ');
        return { row, hits: wanted.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0) };
      });
      const matching = scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
      const rest = scored.filter((s) => s.hits === 0).slice(-Math.max(0, limit - matching.length));
      tables.push({
        id,
        name: clean(entity.name || id, 60),
        fields: [...fieldsOf(entity).values()].map((f) => ({
          id: String(f.id), label: clean(f.label || f.id, 60), type: f.type || 'text',
          ...(Array.isArray(f.options) && f.options.length ? { options: f.options.map((o) => clean(o, 40)).slice(0, 24) } : {}),
        })),
        total: rows.length,
        records: [...matching, ...rest].slice(0, limit).map((s) => s.row),
      });
    }
    return tables;
  }

  const SYSTEM = [
    'You are working inside somebody\'s business system, the way an employee would.',
    'They will tell you something that happened. Work out which records that changes, and change those.',
    '',
    'Return only JSON. No markdown, no prose.',
    '',
    '{',
    '  "understood": "what you took the request to mean, in one line",',
    '  "changes": [',
    '    {"action": "update", "entity": "expenses", "id": "r3", "set": {"status": "Paid"}, "why": "Seif\'s outstanding expense"},',
    '    {"action": "add", "entity": "payments", "set": {"amount": 120}, "why": "the payment itself"},',
    '    {"action": "delete", "entity": "drafts", "id": "r9", "why": "asked for it to be removed"}',
    '  ],',
    '  "unsure": "anything you could not work out, or empty"',
    '}',
    '',
    '- Use only the table ids and field ids given below. A name that is not there is not a field.',
    '- For "update" and "delete", "id" must be a record id you were actually shown.',
    '- A "select" field takes one of the choices listed for it, and nothing else.',
    '- Change only what the request asks for. A record that should keep its value is not a change.',
    '- If more than one record could be meant and you cannot tell, change none of them and say so in "unsure".',
    '- If the request changes nothing in this system, answer with no changes and say why in "unsure".',
    '- Delete only when the request plainly asks for something to be removed. Marking something done is an update.',
    '- "why" is one short line a person reads to decide whether to allow the change.',
  ].join('\n');

  function messages(spec, data, request, today) {
    const tables = shown(spec, data, request);
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Today is ${today || new Date().toISOString().slice(0, 10)}.\n`
          + `System: ${clean(spec && spec.name, 80) || 'this system'}\n\n`
          + `Tables and the records that might be meant:\n${JSON.stringify(tables)}\n\n`
          + `What happened: ${clean(request, 600)}`,
      },
    ];
  }

  /** A model's answer as an object, or null when it could not be read at all. */
  function readAnswer(text) {
    const raw = String(text || '');
    const fenced = window.HCFences ? window.HCFences.jsonBlock(raw) : null;
    const body = fenced != null ? fenced : raw;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(body.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  /**
   * The plan: every change rebuilt from the schema, and every one that could
   * not be is dropped with a reason.
   *
   * Returns `{ understood, edits, additions, removals, dropped, unsure }`.
   * Deletions are their own list on purpose — a count of "changes" that
   * silently includes them is how somebody allows three edits and loses three
   * rows.
   */
  function plan(answer, spec, data) {
    const entities = entitiesOf(spec);
    const edits = [];
    const additions = [];
    const removals = [];
    const dropped = [];
    const note = (why, at) => dropped.push({ why, at: clean(at, 80) });

    const list = Array.isArray(answer && answer.changes) ? answer.changes : [];
    for (const raw of list) {
      if (edits.length + additions.length + removals.length >= MAX_CHANGES) {
        note('more changes than one request is allowed to make', 'the rest');
        break;
      }
      if (!raw || typeof raw !== 'object') { note('not a change', ''); continue; }
      const entityId = clean(raw.entity, 60);
      const entity = entities.get(entityId);
      if (!entity) { note('there is no such table in this system', entityId); continue; }
      const fields = fieldsOf(entity);
      const rows = Array.isArray(data && data[entityId]) ? data[entityId] : [];
      const action = clean(raw.action, 20).toLowerCase();
      const why = clean(raw.why, 160);
      const label = clean(entity.name || entityId, 60);

      if (action === 'delete') {
        const id = clean(raw.id, 80);
        const row = rows.find((r) => r && String(r.id) === id);
        if (!row) { note('no record with that id to remove', `${label} ${id}`); continue; }
        removals.push({ entity: entityId, entityName: label, id, why, record: row });
        continue;
      }

      const wanted = raw.set && typeof raw.set === 'object' && !Array.isArray(raw.set) ? raw.set : null;
      if (!wanted) { note('a change with nothing to set', label); continue; }

      if (action === 'add') {
        const values = {};
        let taken = 0;
        for (const [key, value] of Object.entries(wanted)) {
          if (taken >= MAX_FIELDS) break;
          const field = fields.get(String(key));
          if (!field) { note('no such field on that table', `${label}.${clean(key, 40)}`); continue; }
          const fitted = fit(field, value);
          if (fitted === undefined) { note('that value does not fit the field', `${label}.${field.label || field.id}`); continue; }
          values[field.id] = fitted;
          taken += 1;
        }
        if (!taken) { note('nothing in it could be written', label); continue; }
        additions.push({ entity: entityId, entityName: label, values, why });
        continue;
      }

      if (action !== 'update') { note('not something that can be done to a record', action || '(nothing)'); continue; }
      const id = clean(raw.id, 80);
      const row = rows.find((r) => r && String(r.id) === id);
      if (!row) { note('no record with that id', `${label} ${id}`); continue; }
      const changes = [];
      for (const [key, value] of Object.entries(wanted)) {
        if (changes.length >= MAX_FIELDS) break;
        const field = fields.get(String(key));
        if (!field) { note('no such field on that table', `${label}.${clean(key, 40)}`); continue; }
        const fitted = fit(field, value);
        if (fitted === undefined) { note('that value does not fit the field', `${label}.${field.label || field.id}`); continue; }
        const before = row[field.id];
        // A field being set to what it already holds is not a change, and
        // listing it makes a plan look bigger than the work in it.
        if (String(before == null ? '' : before) === String(fitted)) continue;
        changes.push({ field: field.id, label: clean(field.label || field.id, 60), from: before == null ? '' : before, to: fitted });
      }
      if (!changes.length) { note('nothing in it would change anything', label); continue; }
      edits.push({ entity: entityId, entityName: label, id, record: row, changes, why });
    }

    return {
      understood: clean(answer && answer.understood, 240),
      unsure: clean(answer && answer.unsure, 400),
      edits, additions, removals, dropped,
    };
  }

  /** Whether a plan would do anything at all. */
  function isEmpty(p) {
    return !p || (!p.edits.length && !p.additions.length && !p.removals.length);
  }

  /** What a plan does, in one line a person reads before allowing it. */
  function summaryOf(p) {
    if (isEmpty(p)) return 'nothing to change';
    const bits = [];
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    if (p.edits.length) bits.push(n(p.edits.length, 'record changed', 'records changed'));
    if (p.additions.length) bits.push(n(p.additions.length, 'record added', 'records added'));
    // Named last and never folded into the others: a removal is the one that
    // cannot be taken back by looking at it again.
    if (p.removals.length) bits.push(n(p.removals.length, 'record REMOVED', 'records REMOVED'));
    return bits.join(', ');
  }

  /**
   * Apply a plan to a copy of the records, giving back the new records.
   *
   * A copy: the caller keeps what was there so an undo is a matter of putting
   * the old one back rather than working the changes out in reverse.
   */
  function apply(p, data, newId) {
    const out = {};
    for (const [key, rows] of Object.entries(data || {})) out[key] = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : rows;
    const nextId = typeof newId === 'function' ? newId : (() => `r_${Math.random().toString(36).slice(2, 10)}`);
    for (const edit of (p && p.edits) || []) {
      const rows = out[edit.entity] || (out[edit.entity] = []);
      const row = rows.find((r) => String(r.id) === String(edit.id));
      if (!row) continue;
      for (const change of edit.changes) row[change.field] = change.to;
    }
    for (const add of (p && p.additions) || []) {
      const rows = out[add.entity] || (out[add.entity] = []);
      rows.push({ id: nextId(add.entity), ...add.values });
    }
    for (const gone of (p && p.removals) || []) {
      const rows = out[gone.entity];
      if (!Array.isArray(rows)) continue;
      out[gone.entity] = rows.filter((r) => String(r.id) !== String(gone.id));
    }
    return out;
  }

  /**
   * What a plan would do, written out for the person to read BEFORE anything
   * is written.
   *
   * Here rather than in the mode because this is the last thing somebody sees
   * before their records change, and every line of it can then be read off in
   * a test instead of being trusted.
   */
  function previewOf(p) {
    const lines = [
      ...((p && p.edits) || []).map((e) => `${e.entityName}: ${e.changes.map((c) => `${c.label} ${c.from === '' || c.from === undefined ? '(empty)' : c.from} to ${c.to}`).join(', ')}`),
      ...((p && p.additions) || []).map((a) => `${a.entityName}: a new record`),
      // Spelled out, and last, so it is the thing left in the eye.
      ...((p && p.removals) || []).map((r) => `${r.entityName}: a record REMOVED, which cannot be looked at again`),
    ];
    return `${summaryOf(p)}.\n\n${lines.join('\n')}\n\n`
      + (p && p.unsure ? `It was unsure: ${p.unsure}\n\n` : '')
      + 'Nothing has been changed yet.';
  }

  /** What was done, one line each, for the run's trace. */
  function doneLines(p) {
    return [
      ...((p && p.edits) || []).map((e) => `${e.entityName} — ${e.changes.map((c) => `${c.label}: ${c.to}`).join(', ')}${e.why ? ` (${e.why})` : ''}`),
      ...((p && p.additions) || []).map((a) => `${a.entityName} — a record added${a.why ? ` (${a.why})` : ''}`),
      ...((p && p.removals) || []).map((r) => `${r.entityName} — a record removed${r.why ? ` (${r.why})` : ''}`),
    ];
  }

  window.HCSystemsWork = {
    MAX_CHANGES, MAX_FIELDS, MAX_SHOWN, MAX_VALUE, SYSTEM,
    entitiesOf, fieldsOf, fit, shown, messages, readAnswer, plan, isEmpty, summaryOf, previewOf, doneLines, apply,
  };
})();
