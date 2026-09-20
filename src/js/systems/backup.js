// ==============================================================
// A system's backup file, written and read in one place
//
// The ERP could write a full backup of a system as JSON and had no way to read
// one back. An export with no import is a file that looks like insurance and
// is not: the only thing it could be used for was reading by hand.
//
// WHAT THE FILE HAS TO CARRY. The first version wrote the name, the theme, the
// layout, each entity's fields and its records. That is not a system. A system
// also has modules — the screens down its side, each naming the entity it
// shows — and restoring without them was worse than not restoring at all,
// because the spec gate fills a missing module list with a generic one
// (Overview, Sales, Inventory, Customers, Finance, Operations) and then
// creates an empty entity for every module whose entity is not there. A
// backup of three tables would have come back as three tables plus six empty
// ones nobody asked for.
//
// So the file carries what a system is made of, and this file is where both
// halves agree on that. Adding a field to a system means adding it here, in
// `make`, and reading it in `toSpec` — the two are next to each other so one
// cannot quietly drift from the other.
//
// READING ONE IS READING SOMETHING UNTRUSTED. A backup is a file off a disk.
// It is not a document this app wrote a moment ago, whatever its name says, so
// nothing here trusts a shape: every value is checked, every list is capped,
// and anything unreadable is refused with a reason rather than half-applied.
// What comes out still goes through the spec gate afterwards, which is what
// settles field types, colours and the rest.
//
// A restore never overwrites. It makes a new system beside the ones already
// there, so a backup opened by mistake costs a click to delete rather than the
// work it replaced.
//
// Pure: values in, values out. No DOM, no storage, no network.
//
// Loaded before the ERP and published as window.HCSystemsBackup.
// Checked by scripts/checks/systems-backup.mjs.
// ==============================================================

(function () {
  'use strict';

  // What this app writes today. A file without one is from before the format
  // carried its modules, and is read as best it can be — see `toSpec`.
  const VERSION = 2;

  const MAX_ENTITIES = 40;
  const MAX_FIELDS = 60;
  const MAX_RECORDS = 20000;
  const MAX_MODULES = 10;
  const MAX_WORKFLOWS = 40;

  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /**
   * The file to write for a system and the data it holds.
   *
   * `spec` is the system, `data` its records by entity id.
   */
  function make(spec, data) {
    const s = spec || {};
    const d = isObj(data) ? data : {};
    return {
      format: 'hashcortx.erp.backup',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      name: s.name,
      description: s.description,
      domain: s.domain,
      theme: s.theme,
      layout: s.layout,
      // Without these a restored system is a different system — see the header.
      modules: Array.isArray(s.modules) ? s.modules : [],
      financialModel: s.financialModel,
      screens: Array.isArray(s.screens) ? s.screens : [],
      entities: Object.fromEntries(Object.entries(s.entities || {}).map(([id, e]) => [
        id, { name: e && e.name, fields: (e && e.fields) || [], records: Array.isArray(d[id]) ? d[id] : [] },
      ])),
      workflows: Array.isArray(s.workflows) ? s.workflows : [],
    };
  }

  /**
   * A backup read from text, or a reason it could not be.
   *
   * The reason is shown to the person, so it says what is wrong with the file
   * rather than naming a property.
   */
  function read(text) {
    const raw = String(text == null ? '' : text);
    if (!raw.trim()) return { ok: false, reason: 'That file is empty.' };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'That file is not JSON this app can read.' }; }
    if (!isObj(parsed)) return { ok: false, reason: 'That file does not hold a system.' };
    if (!isObj(parsed.entities) || !Object.keys(parsed.entities).length) {
      return { ok: false, reason: 'That file has no tables in it, so there is nothing to restore.' };
    }
    return { ok: true, backup: parsed };
  }

  /** One record, with only the fields the entity declares, and each a value. */
  function cleanRecord(rec, fieldIds) {
    if (!isObj(rec)) return null;
    const out = {};
    for (const id of fieldIds) {
      const v = rec[id];
      if (v == null) continue;
      if (typeof v === 'string') out[id] = v.slice(0, 4000);
      else if (typeof v === 'number' || typeof v === 'boolean') out[id] = v;
      // Anything else — a nested object, a function-shaped thing — is written
      // as the text of what it was, so a record cannot smuggle a structure
      // through a field that is meant to hold a value.
      else out[id] = String(v).slice(0, 4000);
    }
    // An id the app assigned is kept so links between tables survive.
    if (rec.id != null && out.id === undefined) out.id = String(rec.id).slice(0, 200);
    return out;
  }

  /**
   * The spec to build and the records to store, from a backup.
   *
   * The spec is not finished here: it goes through the ERP's own gate after
   * this, which settles field types, colours, and everything else a system
   * needs. This is only the part that has to come from the file.
   */
  function toSpec(backup) {
    const b = isObj(backup) ? backup : {};
    const entities = {};
    const records = {};
    const entries = Object.entries(isObj(b.entities) ? b.entities : {}).slice(0, MAX_ENTITIES);

    for (const [rawId, rawEntity] of entries) {
      const id = str(rawId, 60);
      if (!id) continue;
      const e = isObj(rawEntity) ? rawEntity : {};
      const fields = (Array.isArray(e.fields) ? e.fields : []).slice(0, MAX_FIELDS)
        .map((f) => (typeof f === 'string' ? { id: str(f, 60) } : (isObj(f) ? f : null)))
        .filter((f) => f && str(f.id || f.name || f.label, 60));
      entities[id] = { id, name: str(e.name, 80) || id, fields };
      const fieldIds = fields.map((f) => str(f.id || f.name || f.label, 60)).filter(Boolean);
      records[id] = (Array.isArray(e.records) ? e.records : []).slice(0, MAX_RECORDS)
        .map((r) => cleanRecord(r, fieldIds)).filter(Boolean);
    }

    const ids = Object.keys(entities);
    // Modules as the file has them, keeping only those that name a table the
    // file actually carries — a module naming a missing one makes the gate
    // invent an empty table to go with it.
    let modules = (Array.isArray(b.modules) ? b.modules : [])
      .slice(0, MAX_MODULES)
      .filter((m) => isObj(m) && ids.includes(str(m.entity, 60)));
    // A file from before the format carried modules, or one whose modules all
    // named tables it does not have: one screen per table, which is a true
    // picture of what is in the file rather than a guess at what it was.
    if (!modules.length) {
      modules = ids.slice(0, MAX_MODULES).map((id, i) => ({
        id: `module_${i + 1}`, name: entities[id].name, entity: id, screen: i === 0 ? 'dashboard' : 'table',
      }));
    }

    const spec = {
      name: str(b.name, 80) || 'Restored system',
      description: str(b.description, 180),
      domain: str(b.domain, 60) || undefined,
      theme: isObj(b.theme) ? b.theme : undefined,
      layout: isObj(b.layout) ? b.layout : undefined,
      modules,
      entities,
      workflows: (Array.isArray(b.workflows) ? b.workflows : []).slice(0, MAX_WORKFLOWS).filter(isObj),
      screens: (Array.isArray(b.screens) ? b.screens : []).filter(isObj),
      financialModel: isObj(b.financialModel) ? b.financialModel : undefined,
    };
    return { spec, records };
  }

  /** What the file is, in one line, for the person about to restore it. */
  function describe(backup) {
    const b = isObj(backup) ? backup : {};
    const entities = isObj(b.entities) ? Object.values(b.entities) : [];
    const rows = entities.reduce((n, e) => n + (Array.isArray(e && e.records) ? e.records.length : 0), 0);
    const when = str(b.exportedAt, 40).slice(0, 10);
    const tables = `${entities.length} table${entities.length === 1 ? '' : 's'}`;
    const kept = `${rows} record${rows === 1 ? '' : 's'}`;
    return `${str(b.name, 80) || 'A system'} · ${tables} · ${kept}${when ? ` · saved ${when}` : ''}`;
  }

  window.HCSystemsBackup = { VERSION, MAX_ENTITIES, MAX_FIELDS, MAX_RECORDS, make, read, toSpec, describe };
})();
