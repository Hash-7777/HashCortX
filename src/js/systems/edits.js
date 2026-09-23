// ==============================================================
// systems/edits.js — a design change as a short list of edits
//
// A change to a system's design was asked for as the whole system written out
// again: every module, entity, field and design choice, to add one field. A
// small local model took many minutes to write that much, a cloud model could
// run out of time doing it, and whatever it wrote differently from the system
// as it was became part of the change.
//
// A change is now asked for as edits: add, rename, change or remove a field;
// add or remove a table; add, rename, re-show or remove a screen; rename the
// system; change its layout, typeface, density, surfaces or corners. The
// model is shown the system as names and types, and the edits it may make are
// held to a schema in which every table, field and screen it can name is one
// the system has, so a small model writes a few short lines and cannot point
// at something that is not there. The app makes each edit itself, and says
// which it made and which it could not, and why, in words the model can be
// sent back with.
//
// How the system looks and how a screen shows its table, when a request says
// so plainly, are read by the app itself (plainEdits) and need no model.
//
// A new field starts empty on the records the table already has; nothing is
// invented for them. A renamed field keeps its id, so its values stay. Colours
// are the app's own on every system and are not an edit.
//
// Pure: specs in, specs out. Published as window.HCSystemsEdits.
// Checked by scripts/checks/systems-edits.mjs.
// ==============================================================
(function () {
  'use strict';

  const FIELD_TYPES = ['text', 'number', 'date', 'select', 'textarea', 'link'];
  const MIN_SCREENS = 5;

  const Spec = () => window.HCSystemsSpec;
  const Theme = () => window.HCSystemsTheme;
  const slug = (v, fallback) => Spec().slug(v, fallback);
  const clean = (v, max = 60) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  /** The forms a name is written in: "customers" for a table called "Customer". */
  const formsOf = (v) => {
    const w = String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return new Set([w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')].filter(Boolean));
  };
  /** The one item whose id or name answers to `key`, or null when none or more than one do. */
  function find(items, key, nameOf) {
    const want = formsOf(key);
    if (!want.size) return null;
    const meets = (v) => [...formsOf(v)].some((f) => want.has(f));
    const hits = items.filter((it) => meets(it.id) || meets(nameOf(it)));
    return hits.length === 1 ? hits[0] : null;
  }

  const tablesOf = (spec) => Object.values((spec && spec.entities) || {});
  const screensOf = (spec) => (spec && Array.isArray(spec.modules) ? spec.modules : []);
  const fieldText = (f) => `${f.label || f.id} (${f.type}${f.type === 'select' && Array.isArray(f.options) ? `: ${f.options.join(', ')}` : ''}${f.type === 'link' && f.entity ? ` to ${f.entity}` : ''})`;

  /** The system as the model is shown it: names and types, no records. */
  function describe(spec) {
    const look = { ...((spec && spec.layout) || {}), ...((spec && spec.theme) || {}) };
    return [
      `System: "${(spec && spec.name) || 'Untitled'}"${spec && spec.description ? ` — ${clean(spec.description, 160)}` : ''}`,
      'Tables:',
      ...tablesOf(spec).map((e) => `- ${e.name || e.id}: ${(e.fields || []).map(fieldText).join('; ')}`),
      'Screens:',
      ...screensOf(spec).map((m) => `- ${m.name}: shows ${(spec.entities[m.entity] && spec.entities[m.entity].name) || m.entity} as ${m.screen}`),
      `Look: layout ${look.shell || 'sidebar'}, typeface ${look.font || 'sans'}, density ${look.density || 'comfortable'}, surfaces ${look.surface || 'flat'}, corners ${look.radius != null ? look.radius : 10}. Colours are the app's own on every system and cannot be changed.`,
    ].join('\n');
  }

  /** What each kind of screen shows, and what its table must have. */
  const SCREEN_GUIDE = 'list (a table of records), cards, split (a list beside the chosen record), kanban (a board by stage; its table needs a select field of stages), calendar and timeline (by date; need a date field), dashboard, report and metric (figures; need a number field), feed.';

  /**
   * The edits the model may make, as a schema: every table, field and screen
   * it can name is one the system has.
   */
  function schema(spec) {
    const tables = tablesOf(spec).map((e) => e.name || e.id);
    const fields = [...new Set(tablesOf(spec).flatMap((e) => (e.fields || []).map((f) => f.label || f.id)))];
    const screens = screensOf(spec).map((m) => m.name);
    const screenTypes = Spec().VALID_SCREENS;
    const D = Theme().DESIGN;
    const oneOf = (list) => (list.length ? { type: 'string', enum: list } : { type: 'string' });
    const edit = (op, props, required) => ({ type: 'object', properties: { op: { type: 'string', enum: [op] }, ...props }, required: ['op', ...required] });
    const fieldSpec = { type: 'object', properties: { label: { type: 'string' }, type: { type: 'string', enum: FIELD_TYPES }, options: { type: 'array', items: { type: 'string' } }, link_to: { type: 'string' }, formula: { type: 'string' } }, required: ['label', 'type'] };
    return {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            anyOf: [
              edit('add_field', { table: oneOf(tables), label: { type: 'string' }, type: { type: 'string', enum: FIELD_TYPES }, options: { type: 'array', items: { type: 'string' } }, link_to: oneOf(tables), formula: { type: 'string' } }, ['table', 'label', 'type']),
              edit('rename_field', { table: oneOf(tables), field: oneOf(fields), label: { type: 'string' } }, ['table', 'field', 'label']),
              edit('change_field', { table: oneOf(tables), field: oneOf(fields), type: { type: 'string', enum: FIELD_TYPES }, options: { type: 'array', items: { type: 'string' } } }, ['table', 'field']),
              edit('remove_field', { table: oneOf(tables), field: oneOf(fields) }, ['table', 'field']),
              edit('add_table', { name: { type: 'string' }, fields: { type: 'array', items: fieldSpec }, screen: { type: 'string', enum: screenTypes } }, ['name', 'fields']),
              edit('remove_table', { table: oneOf(tables) }, ['table']),
              edit('add_screen', { name: { type: 'string' }, table: oneOf(tables), screen: { type: 'string', enum: screenTypes } }, ['name', 'table', 'screen']),
              edit('rename_screen', { screen: oneOf(screens), name: { type: 'string' } }, ['screen', 'name']),
              edit('change_screen', { screen: oneOf(screens), to: { type: 'string', enum: screenTypes } }, ['screen', 'to']),
              edit('remove_screen', { screen: oneOf(screens) }, ['screen']),
              edit('rename_system', { name: { type: 'string' } }, ['name']),
              edit('set_look', { layout: { type: 'string', enum: D.shell }, typeface: { type: 'string', enum: D.font }, density: { type: 'string', enum: D.density }, surfaces: { type: 'string', enum: D.surface }, corners: { type: 'integer' } }, []),
            ],
          },
        },
      },
      required: ['changes'],
    };
  }

  /** Every edit, written the one way it is read. A cloud model is not held to the schema, so it is shown these. */
  const FORMS = [
    '{"op":"add_field","table":"<table>","label":"<new field>","type":"text|number|date|select|textarea|link","options":["<option>"],"link_to":"<table>","formula":"<field> * <field>"}',
    '{"op":"rename_field","table":"<table>","field":"<field>","label":"<new name>"}',
    '{"op":"change_field","table":"<table>","field":"<field>","type":"<type>","options":["<option>"]}',
    '{"op":"remove_field","table":"<table>","field":"<field>"}',
    '{"op":"add_table","name":"<new table>","fields":[{"label":"<field>","type":"<type>"}],"screen":"<screen type>"}',
    '{"op":"remove_table","table":"<table>"}',
    '{"op":"add_screen","name":"<new screen>","table":"<table>","screen":"<screen type>"}',
    '{"op":"rename_screen","screen":"<screen>","name":"<new name>"}',
    '{"op":"change_screen","screen":"<screen>","to":"<screen type>"}',
    '{"op":"remove_screen","screen":"<screen>"}',
    '{"op":"rename_system","name":"<new name>"}',
    '{"op":"set_look","layout":"sidebar|top|dock|cards-nav|command","typeface":"sans|serif|rounded|humanist|mono","density":"compact|comfortable|spacious","surfaces":"flat|outlined|elevated","corners":10}',
  ].map((f) => `  ${f}`);

  /** What the model is asked: the system as names, the edits it may make, and the change. */
  function messages(spec, request, problems, already) {
    const system = [
      'You change an existing business system by listing edits. Never rewrite the system: list only the edits the request asks for, in order, naming tables, fields and screens exactly as they are written below.',
      'Field types: text, number, date, select (give its options), textarea, link (give link_to, the table it points at). A number field can be worked out from the record\'s other number fields: give a formula using their names, such as "Quantity * Unit Price".',
      `Screen types: ${SCREEN_GUIDE}`,
      'A new table comes with its fields and, if it should be seen, the screen type to show it as. Remove something only when the request says to.',
      'Reply with JSON: {"changes": [ ...edits ]}, each edit one of these forms, "op" first:',
      ...FORMS,
      'If the request asks for nothing these edits can do, reply {"changes": []}.',
      '',
      describe(spec),
    ].join('\n');
    const again = problems && problems.length
      ? `\n\nYour last edits could not all be made:\n${problems.map((p) => `- ${p}`).join('\n')}\nList the edits again, correcting these.`
      : '';
    const done = already && already.length ? `\n\nAlready done by the app, so leave it out: ${already.join('; ')}.` : '';
    return [{ role: 'system', content: system }, { role: 'user', content: `The change: ${clean(request, 2000)}${done}${again}` }];
  }

  const isEdit = (c) => c && typeof c === 'object' && typeof c.op === 'string';

  /**
   * The edits in a model's answer, however it wrapped them. An answer cut off
   * part-way — a small model can go on adding to the list until its length
   * runs out — keeps every edit it finished.
   */
  function read(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const v = JSON.parse(raw.slice(start, end + 1));
        if (v && Array.isArray(v.changes)) return v.changes.filter(isEdit);
      } catch { /* cut off: read what was finished */ }
    }
    const list = raw.search(/"changes"\s*:\s*\[/);
    if (list < 0) return null;
    const out = [];
    let depth = 0;
    let from = -1;
    let quote = false;
    for (let i = raw.indexOf('[', list) + 1; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) { if (ch === '\\') i++; else if (ch === '"') quote = false; continue; }
      if (ch === '"') quote = true;
      else if (ch === '{') { if (depth++ === 0) from = i; }
      else if (ch === '}' && depth > 0 && --depth === 0) {
        try { const c = JSON.parse(raw.slice(from, i + 1)); if (isEdit(c)) out.push(c); } catch { /* not whole */ }
      } else if (ch === ']' && depth === 0) break;
    }
    return out;
  }

  const uniqueId = (base, taken) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    return id;
  };

  /**
   * A formula written with a table's field names, in the ids the system works
   * it out with, or a reason it cannot be read. Longer names first, so "Unit
   * Price" is not read as "Price".
   */
  function formulaOf(text, fields) {
    let f = String(text || '').trim();
    if (!f) return { formula: '' };
    const numbers = fields.filter((x) => x.type === 'number');
    for (const x of numbers.slice().sort((a, b) => String(b.label).length - String(a.label).length)) {
      const label = String(x.label || '').trim();
      if (label) f = f.replace(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), x.id);
    }
    const scope = Object.fromEntries(numbers.map((x) => [x.id, 1]));
    const tried = window.HCForgeExpr ? window.HCForgeExpr.evaluate(f, scope) : { value: 0 };
    return tried.error ? { problem: `the formula "${clean(text, 60)}" could not be read (${tried.error})` } : { formula: f };
  }

  /** A field as the system keeps it, from what the model wrote; or a reason it cannot be one. */
  function fieldOf(raw, spec, taken, siblings = []) {
    const written = clean(raw && (raw.label || raw.name), 40);
    if (!written) return { problem: 'a field needs a name' };
    const label = written[0].toUpperCase() + written.slice(1);
    const type = FIELD_TYPES.includes(raw.type) ? raw.type : 'text';
    const field = { id: uniqueId(slug(label, 'field'), taken), label, type, required: false };
    if (type === 'select') {
      const options = [...new Set((Array.isArray(raw.options) ? raw.options : []).map((o) => clean(o, 40)).filter(Boolean))];
      if (options.length < 2) return { problem: `"${label}" is a select field, so it needs at least two options` };
      field.options = options;
    }
    if (type === 'link') {
      const target = find(tablesOf(spec), raw.link_to, (e) => e.name);
      if (!target) return { problem: `"${label}" links to a table the system does not have (${clean(raw.link_to, 40) || 'none given'})` };
      field.entity = target.id;
    }
    if (type === 'number' && raw.formula) {
      const worked = formulaOf(raw.formula, siblings);
      if (worked.problem) return { problem: `"${label}": ${worked.problem}` };
      if (worked.formula) field.formula = worked.formula;
    }
    return { field };
  }

  /** Whether a table can be shown as a screen type, or why not. */
  function screenProblem(entity, screen) {
    const needs = Spec().SCREEN_NEEDS[screen] || {};
    const fields = (entity && entity.fields) || [];
    if (needs.figure && !fields.some((f) => f.type === 'number')) return `${entity.name} has no number field, which a ${screen} screen needs`;
    if (needs.date && !fields.some((f) => f.type === 'date')) return `${entity.name} has no date field, which a ${screen} screen needs`;
    if (needs.stage && !fields.some((f) => f.type === 'select' && Array.isArray(f.options) && f.options.length >= 2)) return `${entity.name} has no select field of stages, which a kanban screen needs`;
    return null;
  }

  /**
   * The system with the edits made. Returns `{ spec, done, problems,
   * newTables }`: what was done and what could not be, each in words, and the
   * ids of tables that are new, which have no records yet. `icon(name)` gives
   * a new screen its mark; `request` is the person's words, which must ask
   * for a removal before anything is removed.
   */
  /** What a field is never named for: how the system looks. */
  const LOOK_WORDS = /^\s*(?:(?:rounded|round|square|sharp)\s+)?(?:corners?|radius|typeface|font|density|compact|spacious|layout|sidebar|top bar|surfaces?|shadows?|dark mode|light mode|theme)\s*$|\b(?:rounded|square|sharp)\s+corners?\b|\b(?:serif|sans)\s+(?:font|typeface)\b/i;

  /** Words a request uses when it wants something taken away. */
  const ASKS_REMOVAL = /\b(?:remove|delete|drop|get rid of|take out|take away|without|no longer|don'?t need|do not need|not needed)\b/i;

  function apply(before, changes, { icon = () => null, request } = {}) {
    // Something is removed only when the request asks for that; a small model
    // otherwise reads "show X another way" as "remove X".
    const mayRemove = request === undefined || ASKS_REMOVAL.test(String(request));
    const spec = JSON.parse(JSON.stringify(before || {}));
    spec.entities = spec.entities || {};
    spec.modules = Array.isArray(spec.modules) ? spec.modules : [];
    const done = [];
    const problems = [];
    const unchanged = [];   // edits that asked for what is already so: not a fault to send back
    const newTables = [];
    const table = (key) => find(tablesOf(spec), key, (e) => e.name);
    const screen = (key) => find(screensOf(spec), key, (m) => m.name);
    const fieldIn = (entity, key) => find(entity.fields || [], key, (f) => f.label);
    const D = Theme().DESIGN;

    for (const c of Array.isArray(changes) ? changes : []) {
      const op = String(c.op || '');
      if (/^remove_/.test(op) && !mayRemove) { problems.push(`the request does not ask to remove anything, so "${op.replace('_', ' ')} ${clean(c.table || c.screen || c.field, 40)}" was not done`); continue; }
      if (op === 'add_field' || op === 'rename_field' || op === 'change_field' || op === 'remove_field') {
        const e = table(c.table);
        if (!e) { problems.push(`there is no table called "${clean(c.table, 40)}"`); continue; }
        if (op === 'add_field') {
          // A field named for the look is a look request misread; the look is its own edit.
          if (LOOK_WORDS.test(String(c.label || ''))) { unchanged.push(`"${clean(c.label, 40)}" is part of the look, not a field`); continue; }
          const made = fieldOf(c, spec, new Set((e.fields || []).map((f) => f.id)), e.fields || []);
          if (made.problem) { problems.push(made.problem); continue; }
          if (fieldIn(e, made.field.label)) { problems.push(`${e.name} already has "${made.field.label}"`); continue; }
          e.fields.push(made.field);
          done.push(`${e.name}: add "${made.field.label}" (${made.field.type}${made.field.options ? `: ${made.field.options.join(', ')}` : ''})${made.field.formula ? `, worked out as ${c.formula}` : ', empty on the records it already has'}`);
          continue;
        }
        const f = fieldIn(e, c.field);
        if (!f) { problems.push(`${e.name} has no field called "${clean(c.field, 40)}"`); continue; }
        if (op === 'rename_field') {
          const label = clean(c.label, 40);
          if (!label) { problems.push(`a new name for "${f.label}" is needed`); continue; }
          done.push(`${e.name}: rename "${f.label}" to "${label}", keeping its values`);
          f.label = label;
        } else if (op === 'change_field') {
          const type = FIELD_TYPES.includes(c.type) ? c.type : f.type;
          const options = Array.isArray(c.options) ? [...new Set(c.options.map((o) => clean(o, 40)).filter(Boolean))] : f.options;
          if (type === 'select' && !(Array.isArray(options) && options.length >= 2)) { problems.push(`"${f.label}" as a select field needs at least two options`); continue; }
          if (type === 'link') { problems.push(`"${f.label}" cannot become a link; add a new link field instead`); continue; }
          const said = [];
          if (type !== f.type) said.push(`make it ${type}`);
          if (type === 'select' && JSON.stringify(options) !== JSON.stringify(f.options)) said.push(`options ${options.join(', ')}`);
          if (!said.length) { unchanged.push(`"${f.label}" is already like that`); continue; }
          f.type = type;
          if (type === 'select') f.options = options; else delete f.options;
          done.push(`${e.name}: "${f.label}" — ${said.join(', ')}`);
        } else {
          if ((e.fields || []).length <= 1) { problems.push(`${e.name} would have no fields left`); continue; }
          e.fields = e.fields.filter((x) => x !== f);
          done.push(`${e.name}: remove "${f.label}" (its values are kept in the records, hidden)`);
        }
        continue;
      }
      if (op === 'add_table') {
        const name = clean(c.name, 40);
        if (!name) { problems.push('a new table needs a name'); continue; }
        if (table(name)) { problems.push(`there is already a table called "${name}"`); continue; }
        const id = uniqueId(slug(name, 'table'), new Set(Object.keys(spec.entities)));
        const taken = new Set();
        const fields = [];
        for (const raw of Array.isArray(c.fields) ? c.fields : []) {
          const made = fieldOf(raw, spec, taken, fields);
          if (made.problem) { problems.push(`${name}: ${made.problem}`); continue; }
          taken.add(made.field.id);
          fields.push(made.field);
        }
        // A record is named by a text field; one is given only when there is none.
        if (!fields.some((f) => f.type === 'text' || /name|title/i.test(f.label))) fields.unshift({ id: uniqueId('name', taken), label: 'Name', type: 'text', required: true });
        spec.entities[id] = { id, name, fields };
        newTables.push(id);
        const kind = Spec().VALID_SCREENS.includes(c.screen) ? c.screen : 'list';
        const why = screenProblem(spec.entities[id], kind);
        const shown = why ? 'list' : kind;
        spec.modules.push({ id: uniqueId(slug(name, 'screen'), new Set(spec.modules.map((m) => m.id))), name, icon: icon(name), entity: id, screen: shown, kpis: null, color: null });
        done.push(`add a table "${name}" (${fields.map((f) => f.label).join(', ')}) shown as ${shown}${why ? ` — not as ${kind}: ${why}` : ''}`);
        continue;
      }
      if (op === 'remove_table') {
        const e = table(c.table);
        if (!e) { problems.push(`there is no table called "${clean(c.table, 40)}"`); continue; }
        const left = spec.modules.filter((m) => m.entity !== e.id);
        if (left.length < MIN_SCREENS) { problems.push(`removing ${e.name} would leave fewer than ${MIN_SCREENS} screens`); continue; }
        spec.modules = left;
        delete spec.entities[e.id];
        for (const other of tablesOf(spec)) for (const f of other.fields || []) if (f.type === 'link' && f.entity === e.id) { f.type = 'text'; delete f.entity; }
        done.push(`remove the table "${e.name}" and its screens`);
        continue;
      }
      if (op === 'add_screen') {
        const e = table(c.table);
        if (!e) { problems.push(`there is no table called "${clean(c.table, 40)}"`); continue; }
        const kind = Spec().VALID_SCREENS.includes(c.screen) ? c.screen : 'list';
        const why = screenProblem(e, kind);
        if (why) { problems.push(why); continue; }
        const name = clean(c.name, 32) || e.name;
        if (screen(name)) { problems.push(`there is already a screen called "${name}"`); continue; }
        spec.modules.push({ id: uniqueId(slug(name, 'screen'), new Set(spec.modules.map((m) => m.id))), name, icon: icon(name), entity: e.id, screen: kind, kpis: null, color: null });
        done.push(`add a screen "${name}" showing ${e.name} as ${kind}`);
        continue;
      }
      if (op === 'rename_screen' || op === 'change_screen' || op === 'remove_screen') {
        const m = screen(c.screen);
        if (!m) { problems.push(`there is no screen called "${clean(c.screen, 40)}"`); continue; }
        if (op === 'rename_screen') {
          const name = clean(c.name, 32);
          if (!name) { problems.push(`a new name for "${m.name}" is needed`); continue; }
          done.push(`rename the screen "${m.name}" to "${name}"`);
          m.name = name;
        } else if (op === 'change_screen') {
          const kind = c.to;
          if (!Spec().VALID_SCREENS.includes(kind)) { problems.push(`"${clean(kind, 20)}" is not a kind of screen`); continue; }
          const why = screenProblem(spec.entities[m.entity], kind);
          if (why) { problems.push(why); continue; }
          if (kind === m.screen) { unchanged.push(`"${m.name}" is already shown as ${kind}`); continue; }
          done.push(`show "${m.name}" as ${kind} instead of ${m.screen}`);
          m.screen = kind;
        } else {
          if (spec.modules.length <= MIN_SCREENS) { problems.push(`a system keeps at least ${MIN_SCREENS} screens`); continue; }
          spec.modules = spec.modules.filter((x) => x !== m);
          done.push(`remove the screen "${m.name}" (its records are kept)`);
        }
        continue;
      }
      if (op === 'rename_system') {
        const name = clean(c.name, 60);
        if (!name) { problems.push('a new name for the system is needed'); continue; }
        done.push(`rename the system "${spec.name}" to "${name}"`);
        spec.name = name;
        continue;
      }
      if (op === 'set_look') {
        spec.layout = { ...(spec.layout || {}) };
        spec.theme = { ...(spec.theme || {}) };
        const said = [];
        if (D.shell.includes(c.layout) && c.layout !== spec.layout.shell) { spec.layout.shell = c.layout; spec.layout.nav = c.layout === 'top' ? 'top' : 'sidebar'; said.push(`layout ${c.layout}`); }
        if (D.font.includes(c.typeface) && c.typeface !== spec.theme.font) { spec.theme.font = c.typeface; said.push(`typeface ${c.typeface}`); }
        if (D.density.includes(c.density) && c.density !== spec.theme.density) { spec.theme.density = c.density; said.push(`density ${c.density}`); }
        if (D.surface.includes(c.surfaces) && c.surfaces !== spec.theme.surface) { spec.theme.surface = c.surfaces; said.push(`surfaces ${c.surfaces}`); }
        if (Number.isFinite(Number(c.corners)) && c.corners !== null && c.corners !== undefined) {
          const r = Math.max(0, Math.min(20, Math.round(Number(c.corners))));
          if (r !== Number(spec.theme.radius)) { spec.theme.radius = r; said.push(`corners ${r}`); }
        }
        const offered = ['layout', 'typeface', 'density', 'surfaces', 'corners'].some((k) => c[k] != null && c[k] !== '');
        if (said.length) done.push(`change the look: ${said.join(', ')}`);
        else if (offered && ((c.layout && !D.shell.includes(c.layout)) || (c.typeface && !D.font.includes(c.typeface)) || (c.density && !D.density.includes(c.density)) || (c.surfaces && !D.surface.includes(c.surfaces)))) problems.push('the look asked for is not one a system can take');
        else unchanged.push('the look asked for is the one it has');
        continue;
      }
      problems.push(`"${clean(op, 30)}" is not an edit that can be made`);
    }
    return { spec, done, problems: [...new Set(problems)], unchanged: [...new Set(unchanged)], newTables };
  }

  /**
   * The edits a request plainly asks for, read by the app without a model:
   * how the system looks ("a serif typeface", "compact density", "a top bar",
   * "rounded corners") and how a screen shows its table ("show Orders as a
   * board"). A small model asked for these wrote edits to fields instead.
   * `whole` says the request asks for nothing else, so no model is needed.
   */
  function plainEdits(spec, request) {
    const t = String(request || '');
    const changes = [];
    const look = {};
    const font = /\b(serif|sans(?:-serif)?|rounded|humanist|mono(?:space)?)\b[^.\n]{0,16}\b(?:typeface|font|type|text|lettering)\b|\b(?:typeface|font)\b[^.\n]{0,16}\b(serif|sans(?:-serif)?|rounded|humanist|mono(?:space)?)\b/i.exec(t);
    if (font) look.typeface = { 'sans-serif': 'sans', monospace: 'mono' }[(font[1] || font[2]).toLowerCase()] || (font[1] || font[2]).toLowerCase();
    const density = /\b(compact|comfortable|spacious|roomier|tighter|denser)\b/i.exec(t);
    if (density) look.density = { roomier: 'spacious', tighter: 'compact', denser: 'compact' }[density[1].toLowerCase()] || density[1].toLowerCase();
    const surface = /\b(flat|outlined|elevated)\b[^.\n]{0,12}\b(?:surfaces?|cards?|panels?|look)\b/i.exec(t) || (/\bshadows?\b/i.test(t) && ['elevated']) || (/\bborders?\b/i.test(t) && /\b(?:surfaces?|cards?|panels?)\b/i.test(t) && ['outlined']);
    if (surface) look.surfaces = String(surface[1] || surface[0]).toLowerCase();
    if (/\btop (?:bar|menu|navigation|nav)\b|\bmenu (?:at|on|along) the top\b/i.test(t)) look.layout = 'top';
    else if (/\b(?:side ?bar|side menu|menu (?:at|on|down) the (?:left|side))\b/i.test(t)) look.layout = 'sidebar';
    else if (/\bdock\b/i.test(t)) look.layout = 'dock';
    const corners = /\b(?:corners?|radius)\b[^.\n]{0,12}?(\d{1,2})\b|\b(\d{1,2})\s*(?:px|pixel)?\s*(?:corners?|radius)\b/i.exec(t);
    if (corners) look.corners = Number(corners[1] || corners[2]);
    else if (/\bround(?:ed|er)? corners\b|\bcorners?\b[^.\n]{0,15}\bround(?:ed|er)?\b/i.test(t)) look.corners = 16;
    else if (/\b(?:square|sharp)(?:er)? corners\b|\bcorners?\b[^.\n]{0,15}\b(?:square|sharp)(?:er)?\b/i.test(t)) look.corners = 2;
    if (Object.keys(look).length) changes.push({ op: 'set_look', ...look });

    const KINDS = { list: 'list', card: 'cards', cards: 'cards', board: 'kanban', kanban: 'kanban', calendar: 'calendar', timeline: 'timeline', report: 'report', dashboard: 'dashboard', metric: 'metric', metrics: 'metric', feed: 'feed', split: 'split' };
    for (const m of t.matchAll(/\bshow\s+(?:the\s+|my\s+)?(.{1,40}?)\s+(?:screen\s+|page\s+|tab\s+)?as\s+(?:a\s+|an\s+)?(list|cards?|board|kanban|calendar|timeline|report|dashboard|metrics?|feed|split)\b/gi)) {
      const name = m[1].replace(/\s+(?:screen|page|tab)$/i, '');
      const screen = find(screensOf(spec), name, (x) => x.name)
        || (() => { const e = find(tablesOf(spec), name, (x) => x.name); const on = e && screensOf(spec).filter((x) => x.entity === e.id); return on && on.length === 1 ? on[0] : null; })();
      if (screen) changes.push({ op: 'change_screen', screen: screen.name, to: KINDS[m[2].toLowerCase()] });
    }
    const whole = changes.length > 0 && !/\b(?:add|remove|delete|rename|drop|new|field|column|table|module|also|and then)\b/i.test(t);
    return { changes, whole };
  }

  window.HCSystemsEdits = { plainEdits, FIELD_TYPES, MIN_SCREENS, describe, schema, messages, read, apply, find, formsOf, screenProblem, formulaOf };
})();
