// ==============================================================
// A whole working system, built here, without asking anything
//
// WHY THIS EXISTS. Generating a system meant asking a model to design a
// database from nothing — every table, every field, every screen — and return
// it as one large JSON document. That only works on a strong model, and on a
// free stack the strong models are exactly the ones that run out. One measured
// run: the first model was out of quota, the second and third out of credit,
// and the ladder ended on a nano model, which answered in two seconds with no
// name, three modules and two tables. The app then spent another round trip
// trying to repair an answer that was never going to be usable.
//
// The design was never the part a model was needed for. The app already knows
// what a restaurant keeps and what a clinic keeps — js/systems/domain.js is six
// hundred lines of exactly that, with the screens each module is drawn on, the
// figures worth showing and the stages work moves through. What it lacked was
// anything to assemble it.
//
// So a system is built HERE, in full, and it is built before a model is asked
// anything. It passes the app's own gate by construction rather than by luck,
// it is instant rather than two minutes, and it cannot fail because a provider
// is out of credit.
//
// WHAT A MODEL IS STILL FOR. Making it theirs: the business's own name, its
// own words for things, its own records. That is a job a small model can
// actually do, because it is filling in a structure rather than inventing one
// — and when it fails, there is still a working system underneath instead of
// an error.
//
// Pure: a description and the date go in, a complete spec comes out. No DOM,
// no storage, no network, no clock of its own.
//
// Loaded after js/systems/domain.js and js/systems/samples.js, before the
// Systems mode, and published as window.HCSystemsScaffold.
// Checked by scripts/checks/systems-scaffold.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How many records each table is given, so every screen has something on it. */
  const ROWS = 8;
  /** The gate wants at least five modules; the configs carry six or more. */
  const MIN_MODULES = 5;

  const slug = (raw, fallback) => String(raw || fallback || 'item')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || (fallback || 'item');

  /**
   * A name for the system taken from what was asked for.
   *
   * The request is the only thing here that is about this particular business,
   * so it is worth reading rather than falling back to the industry's name for
   * everything. "a system for Seif's bike shop" should not come out called
   * "Retail Operations".
   */
  function nameFrom(description, domainName) {
    const said = String(description || '').trim();
    // "a system for X", "an ERP for X", "manage X" — the thing after the word.
    const match = said.match(/\b(?:for|to manage|managing|of)\s+(.{3,60}?)(?:[.,;]|$)/i);
    const candidate = (match ? match[1] : said).replace(/\s+/g, ' ').trim();
    if (!candidate || candidate.length < 3) return domainName || 'Business System';
    const words = candidate.split(' ').slice(0, 5).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /**
   * Every table a set of modules needs, with the fields that industry's
   * records carry.
   *
   * Two modules can be drawn from one table — a Reports screen over the same
   * orders as the board — so tables are collected by id rather than per module.
   */
  function entitiesFor(modules, domain, D) {
    const out = {};
    for (const module of modules) {
      const id = slug(module.entity, 'records');
      if (out[id]) continue;
      // A part chosen in the setup brings fields of its own where the trade
      // has none for it — js/systems/setup.js.
      const fields = (Array.isArray(module.fields) && module.fields.length ? module.fields : D.defaultFields(module.entity, domain)) || [];
      out[id] = {
        id,
        name: module.name || id,
        fields: fields.map((f) => ({ ...f })),
      };
    }
    return out;
  }

  /**
   * A field the screen needs and the industry's own fields happen not to
   * carry, so that nothing is ever shown on a screen it cannot fill.
   *
   * The gate asks for a figure on a screen that draws figures, a date on one
   * laid out in time, and stages on a board. This is the only place a generic
   * field is added, and it is added because the screen genuinely needs one —
   * not as a blanket "Business Value" on every table, which is what the app
   * used to do to a staff list and a supplier list alike.
   */
  function completeFor(entity, screen, S) {
    const needs = S.SCREEN_NEEDS[screen] || {};
    const fields = entity.fields;
    const has = (test) => fields.some(test);
    if (needs.figure && !has((f) => f.type === 'number' || /amount|total|price|cost|revenue|salary|qty|quantity|balance|value/i.test(f.id || f.label || ''))) {
      fields.push({ id: 'amount', label: 'Amount', type: 'number' });
    }
    if (needs.date && !has((f) => f.type === 'date' || /date|time|due|created|updated/i.test(f.id || f.label || ''))) {
      fields.push({ id: 'date', label: 'Date', type: 'date' });
    }
    if (needs.stage && !has((f) => f.type === 'select' && Array.isArray(f.options) && f.options.length >= 2)) {
      fields.push({ id: 'status', label: 'Status', type: 'select', options: ['Open', 'In Progress', 'Done'] });
    }
    // Three fields is the floor, and an industry that names fewer gets the
    // plain ones any record has rather than being left unrenderable.
    const spare = [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'notes', label: 'Notes', type: 'textarea' },
      { id: 'date', label: 'Date', type: 'date' },
    ];
    for (const field of spare) {
      if (fields.length >= 3) break;
      if (!fields.some((f) => f.id === field.id)) fields.push({ ...field });
    }
    return entity;
  }

  /**
   * A complete, renderable system for this description, built without asking
   * anything.
   *
   * `today` is passed in so the records land in the months before it rather
   * than in a window that goes stale.
   */
  function build(description, today, deps = {}) {
    const D = deps.domain || window.HCSystemsDomain;
    const S = deps.spec || window.HCSystemsSpec;
    const Samples = deps.samples || window.HCSystemsSamples;
    if (!D || !S) return null;

    // What the owner chose in the setup, where there was one: the trade, the
    // parts, the name. Without it, all three are read from the request.
    const setup = deps.setup || null;
    const domain = (setup && D.DOMAIN_CONFIG[setup.domain]) ? setup.domain : D.detectDomain(description);
    const config = D.DOMAIN_CONFIG[domain] || D.DOMAIN_CONFIG.generic || Object.values(D.DOMAIN_CONFIG)[0];
    const chosen = setup && Array.isArray(setup.modules) && setup.modules.length ? setup.modules : config.modules || [];
    const listed = chosen.slice(0, 10).map((m) => ({
      name: m.name,
      entity: slug(m.entity, 'records'),
      screen: S.VALID_SCREENS.includes(m.screen) ? m.screen : 'list',
      fields: m.fields || null,
    }));
    if (listed.length < MIN_MODULES) return null;   // too thin to build from

    const entities = entitiesFor(listed, domain, D);
    const modules = listed.map(({ fields, ...m }) => m);
    // A table is completed for every screen it is drawn on, not just the first
    // — the same orders shown as a board and as a report needs stages AND a
    // figure.
    for (const module of modules) completeFor(entities[module.entity], module.screen, S);

    const mockData = {};
    for (const [id, entity] of Object.entries(entities)) {
      // js/systems/samples.js makes the stand-in values, so a record here is
      // filled the same way one from a model's answer is — neutral names, a
      // choice from the field's own options, a date in the months before
      // today, and never somebody else's menu.
      mockData[id] = Array.from({ length: ROWS }, (_, row) => (
        Samples ? Samples.sampleRecord(entity, row, today) : { id: `${id}_${row + 1}` }
      ));
    }

    return {
      name: (setup && setup.name) || nameFrom(description, config.name),
      ...(setup && setup.currency ? { currency: setup.currency } : {}),
      ...(setup && setup.place ? { place: setup.place } : {}),
      description: String(description || '').trim().slice(0, 400),
      domain,
      theme: { ...(config.theme || {}) },
      modules,
      entities: Object.values(entities),
      workflows: (config.workflows || []).map((w) => ({ ...w, stages: [...(w.stages || [])] })),
      kpis: JSON.parse(JSON.stringify(config.kpis || {})),
      mockData,
      builtWithoutAModel: true,
    };
  }

  window.HCSystemsScaffold = { build, nameFrom, entitiesFor, completeFor, ROWS, MIN_MODULES };
})();
