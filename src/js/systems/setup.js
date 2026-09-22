// ==============================================================
// What a system is for, asked before it is built
//
// THE DEFECT. A system was built from one line typed into a box. "Book store
// called hashbooks in cairo" came back named "Book store called hashbooks in",
// with the six parts every shop gets, counting in whatever currency a regular
// expression guessed, and nothing about the business that the line did not
// already say. Everything else was invented — or, where the app had nothing
// to invent from, left generic.
//
// WHAT HAPPENS INSTEAD. The ERP agent (js/systems/agent.js) asks in the
// conversation for what it needs — what the business does, its name, where it
// is — and what it learns is read here into the business's trade, its parts
// and its currency, then composed into what the builder is given. Nothing the
// person did not say is invented; the owner's word is put back over a model's.
//
// This file reads and composes; it asks nothing and draws nothing. The build
// is js/systems/scaffold.js.
//
// Pure: text in, plain objects out. No DOM, no storage, no network.
//
// Loaded after js/systems/domain.js, before the Systems mode, and published as
// window.HCSystemsSetup. Checked by scripts/checks/systems-setup.mjs.
// ==============================================================

(function () {
  'use strict';

  /** A system needs this many parts to be worth opening; the gate asks for it. */
  const MIN_PARTS = 5;

  /**
   * Currencies offered, by the code every price is formatted with. Common
   * ones first; anything the person types that is a real three-letter code is
   * accepted as well.
   */
  const CURRENCIES = [
    ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'Pound sterling'], ['EGP', 'Egyptian pound'],
    ['SAR', 'Saudi riyal'], ['AED', 'UAE dirham'], ['KWD', 'Kuwaiti dinar'], ['QAR', 'Qatari riyal'],
    ['BHD', 'Bahraini dinar'], ['OMR', 'Omani rial'], ['JOD', 'Jordanian dinar'], ['MAD', 'Moroccan dirham'],
    ['TND', 'Tunisian dinar'], ['TRY', 'Turkish lira'], ['INR', 'Indian rupee'], ['PKR', 'Pakistani rupee'],
    ['NGN', 'Nigerian naira'], ['KES', 'Kenyan shilling'], ['ZAR', 'South African rand'], ['CAD', 'Canadian dollar'],
    ['AUD', 'Australian dollar'], ['JPY', 'Japanese yen'], ['CNY', 'Chinese yuan'], ['BRL', 'Brazilian real'],
    ['MXN', 'Mexican peso'], ['CHF', 'Swiss franc'], ['SEK', 'Swedish krona'], ['SGD', 'Singapore dollar'],
  ];

  /** Where a place name says which currency is meant. Country or major city. */
  const PLACE_CURRENCY = [
    [/egypt|cairo|alexandria|giza|mansoura|luxor|aswan|hurghada|sharm/i, 'EGP'],
    [/saudi|riyadh|jeddah|dammam|mecca|makkah|medina/i, 'SAR'],
    [/emirates|\buae\b|dubai|abu dhabi|sharjah|ajman/i, 'AED'],
    [/kuwait/i, 'KWD'], [/qatar|doha/i, 'QAR'], [/bahrain|manama/i, 'BHD'], [/oman|muscat/i, 'OMR'],
    [/jordan|amman/i, 'JOD'], [/morocco|casablanca|rabat|marrakesh|marrakech/i, 'MAD'], [/tunisia|tunis\b/i, 'TND'],
    [/turkey|türkiye|istanbul|ankara|izmir/i, 'TRY'],
    [/\buk\b|united kingdom|england|scotland|wales|london|manchester|birmingham|glasgow|edinburgh/i, 'GBP'],
    [/india|mumbai|delhi|bangalore|bengaluru|chennai|kolkata|hyderabad/i, 'INR'],
    [/pakistan|karachi|lahore|islamabad/i, 'PKR'], [/nigeria|lagos|abuja/i, 'NGN'], [/kenya|nairobi/i, 'KES'],
    [/south africa|johannesburg|cape town|durban|pretoria/i, 'ZAR'],
    [/canada|toronto|vancouver|montreal|ottawa|calgary/i, 'CAD'],
    [/australia|sydney|melbourne|brisbane|perth/i, 'AUD'], [/japan|tokyo|osaka|kyoto/i, 'JPY'],
    [/china|beijing|shanghai|shenzhen|guangzhou/i, 'CNY'], [/brazil|são paulo|sao paulo|rio de janeiro/i, 'BRL'],
    [/mexico|ciudad de m|guadalajara|monterrey/i, 'MXN'], [/switzerland|zurich|geneva|bern\b/i, 'CHF'],
    [/sweden|stockholm|gothenburg/i, 'SEK'], [/singapore/i, 'SGD'],
    [/germany|france|spain|italy|netherlands|belgium|austria|portugal|ireland|finland|greece|berlin|munich|paris|lyon|madrid|barcelona|rome|milan|amsterdam|brussels|vienna|lisbon|dublin|helsinki|athens/i, 'EUR'],
    [/\busa\b|united states|america|new york|los angeles|chicago|houston|miami|san francisco|seattle|boston/i, 'USD'],
  ];

  /**
   * Parts any business might keep, beyond its trade's own, each with fields
   * that belong to it. Offered because "what do you want to track" should not
   * be limited to one trade's list — and given their own fields because the
   * app's fallback for a table it does not know is a name, an owner, an amount
   * and a status, which is not what a supplier list or a task list holds.
   *
   * `same` is what the part is also called, so a trade that already keeps it
   * under another name — employees rather than staff — is not offered it twice.
   * Bills are not called expenses: the system's books already keep an
   * Expenses table, worked out from its sales, and two tables with one name,
   * one of which refuses to be edited, is a puzzle rather than a choice.
   */
  const EXTRAS = [
    { name: 'Suppliers', entity: 'suppliers', screen: 'split', same: ['supplier', 'vendor'], fields: [
      { id: 'name', label: 'Supplier', type: 'text', required: true },
      { id: 'contact', label: 'Contact person', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'email', label: 'Email', type: 'text' },
      { id: 'category', label: 'Supplies', type: 'text' },
      { id: 'status', label: 'Status', type: 'select', options: ['Active', 'On hold', 'Ended'] },
    ] },
    { name: 'Bills', entity: 'bills', screen: 'list', same: ['bill'], fields: [
      { id: 'description', label: 'What for', type: 'text', required: true },
      { id: 'category', label: 'Category', type: 'select', options: ['Rent', 'Salaries', 'Stock', 'Utilities', 'Marketing', 'Other'] },
      { id: 'amount', label: 'Amount', type: 'number', required: true },
      { id: 'due', label: 'Due', type: 'date' },
      { id: 'status', label: 'Status', type: 'select', options: ['Due', 'Paid'] },
    ] },
    { name: 'Staff', entity: 'staff', screen: 'split', same: ['staff', 'employee', 'team', 'personnel', 'people', 'trainer', 'teacher', 'doctor', 'agent'], fields: null },
    { name: 'Tasks', entity: 'tasks', screen: 'kanban', same: ['task', 'todo', 'job'], fields: [
      { id: 'title', label: 'Task', type: 'text', required: true },
      { id: 'assignee', label: 'Who', type: 'text' },
      { id: 'due', label: 'Due', type: 'date' },
      { id: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Normal', 'High'] },
      { id: 'status', label: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'] },
    ] },
    { name: 'Appointments', entity: 'appointments', screen: 'calendar', same: ['appointment', 'booking', 'reservation', 'session', 'schedule', 'class'], fields: [
      { id: 'customer', label: 'Who', type: 'text', required: true },
      { id: 'date', label: 'Date', type: 'date', required: true },
      { id: 'time', label: 'Time', type: 'text' },
      { id: 'purpose', label: 'What for', type: 'text' },
      { id: 'status', label: 'Status', type: 'select', options: ['Booked', 'Done', 'Cancelled'] },
    ] },
  ];

  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const titleOf = (v) => clean(v).replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  /** The business's own name, where the request gives one. */
  function nameIn(description) {
    const said = clean(description, 400);
    const m = said.match(/\b(?:called|named|name is|brand(?:ed)?(?: as)?)\s+["'“]?(.{2,40}?)["'”]?(?=\s+(?:in|at|for|based|located|that|which|with|selling|serving)\b|[,.;!?]|$)/i);
    return m ? titleOf(m[1]) : '';
  }

  /** Where it is, where the request says. */
  function placeIn(description) {
    const said = clean(description, 400);
    const m = said.match(/\b(?:based in|located in|in|at)\s+([A-Za-zÀ-ɏ][\wÀ-ɏ .'-]{1,40}?)\s*(?:[,.;!?]|$)/i);
    if (!m) return '';
    const place = m[1].replace(/\s+(?:and|with|for|that)\b.*$/i, '').trim();
    // "in stock", "in the shop" — words that follow "in" without being a place.
    if (/^(?:the|a|an|my|our|stock|store|shop|house|person|real time|time)\b/i.test(place)) return '';
    return titleOf(place);
  }

  /** The currency a place counts in, or '' when the place does not say. */
  function currencyForPlace(place) {
    const p = clean(place, 120);
    if (!p) return '';
    const hit = PLACE_CURRENCY.find(([re]) => re.test(p));
    return hit ? hit[1] : '';
  }

  /** A currency as a code prices can be formatted in, or '' when it is not one. */
  function currencyCode(value) {
    const v = clean(value, 12).toUpperCase();
    return /^[A-Z]{3}$/.test(v) ? v : '';
  }

  /** Every part on offer for a trade: its own, then the extras it does not already have. */
  function partsFor(trade, D) {
    const config = (D && D.DOMAIN_CONFIG && (D.DOMAIN_CONFIG[trade] || D.DOMAIN_CONFIG.generic)) || { modules: [] };
    const own = (config.modules || []).map((m) => ({ name: m.name, entity: m.entity, screen: m.screen, own: true, on: true }));
    // Every word the trade already names its parts and tables by.
    const words = new Set(own.flatMap((m) => `${m.name} ${m.entity}`.toLowerCase().split(/[^a-z]+/)).filter(Boolean).map((w) => w.replace(/s$/, '')));
    const extra = EXTRAS
      .filter((x) => ![x.entity, ...(x.same || [])].some((w) => words.has(String(w).replace(/s$/, ''))))
      .map((x) => ({ name: x.name, entity: x.entity, screen: x.screen, own: false, on: false }));
    return [...own, ...extra];
  }

  /** The fields an extra part is built with, where it brings its own. */
  function fieldsFor(entity) {
    const x = EXTRAS.find((e) => e.entity === entity);
    return x && x.fields ? x.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })) : null;
  }

  /**
   * The form, filled in from what was typed. Every field can be changed; this
   * is where it starts, not what it must be.
   */
  function suggest(description, D) {
    const does = clean(description, 400);
    const trade = D && D.detectDomain ? D.detectDomain(does) : 'generic';
    const place = placeIn(does);
    return {
      name: nameIn(does),
      does,
      trade,
      place,
      currency: currencyForPlace(place) || currencyForPlace(does) || 'USD',
      parts: partsFor(trade, D),
    };
  }

  /** What stops the form being built as it stands, in words; empty when nothing does. */
  function problemsOf(setup) {
    const out = [];
    if (!clean(setup && setup.does)) out.push('Say what the business does.');
    const on = ((setup && setup.parts) || []).filter((p) => p && p.on);
    if (on.length < MIN_PARTS) out.push(`Choose at least ${MIN_PARTS} things to keep track of — a system needs that many parts to work with (${on.length} chosen).`);
    if (setup && setup.currency && !currencyCode(setup.currency)) out.push('The currency must be a three-letter code, such as USD or EGP.');
    return out;
  }

  /** A plain account of the form, for the model and for the build. */
  function summaryOf(setup) {
    const s = setup || {};
    const on = (s.parts || []).filter((p) => p && p.on).map((p) => p.name);
    const lines = [];
    if (clean(s.name)) lines.push(`Business name: ${clean(s.name, 80)}`);
    lines.push(`What it does: ${clean(s.does, 400)}`);
    if (clean(s.place)) lines.push(`Where: ${clean(s.place, 80)}`);
    if (currencyCode(s.currency)) lines.push(`Money is counted in: ${currencyCode(s.currency)}`);
    if (on.length) lines.push(`It keeps track of: ${on.join(', ')}`);
    return lines.join('\n');
  }

  /**
   * What the system is built from: the form, then the owner's answers as
   * fact, then what they left blank as placeholders to fill in — never as
   * something to invent.
   */
  function describe(setup, answered) {
    const parts = [summaryOf(setup)];
    const list = (Array.isArray(answered) ? answered : []).filter((a) => a && clean(a.question));
    const given = list.filter((a) => clean(a.answer, 2000));
    const blank = list.filter((a) => !clean(a.answer, 2000));
    if (given.length) {
      parts.push(`Details from the owner. Use them exactly, and do not add to them:\n${given.map((a) => `- ${clean(a.question, 240)} ${clean(a.answer, 2000)}`).join('\n')}`);
    }
    if (blank.length) {
      parts.push(`Not given: ${blank.map((a) => clean(a.question, 240)).join(' ')} Where one of these is needed, write a clearly marked placeholder in square brackets for the owner to fill in. Never invent it.`);
    }
    return parts.join('\n\n');
  }

  /**
   * What the builder is handed: the parts chosen, in the order they were
   * listed, each with its own fields where it brings them.
   */
  function buildOptions(setup) {
    const s = setup || {};
    return {
      name: clean(s.name, 60),
      domain: clean(s.trade, 40) || 'generic',
      currency: currencyCode(s.currency) || 'USD',
      place: clean(s.place, 80),
      modules: (s.parts || []).filter((p) => p && p.on).map((p) => ({ name: clean(p.name, 32), entity: p.entity, screen: p.screen, fields: fieldsFor(p.entity) })),
    };
  }

  /**
   * What the owner said is kept on the system whoever built it — a model's
   * answer included, since a model may rename the business or pick its own
   * currency, and the owner's word is the one that stands.
   */
  function applyTo(spec, setup) {
    if (!spec || !setup) return spec;
    const opts = buildOptions(setup);
    if (opts.name) spec.name = opts.name;
    spec.currency = opts.currency;
    if (opts.place) spec.place = opts.place;
    if (spec.financialModel && typeof spec.financialModel === 'object') spec.financialModel.currency = opts.currency;
    // A column headed "Price ($)" over "EGP 42.26" says two things at once.
    // The app's own field lists write the dollar sign in, and a model often
    // does the same; the mark is what tells the app a figure is money, so it
    // is kept — and made to name the currency this system really counts in.
    const entities = spec.entities && typeof spec.entities === 'object' ? Object.values(spec.entities) : [];
    for (const entity of entities) {
      for (const f of (entity && Array.isArray(entity.fields) ? entity.fields : [])) {
        if (f && typeof f.label === 'string') f.label = f.label.replace(CURRENCY_MARK, `(${opts.currency})`);
      }
    }
    return spec;
  }

  /** "(USD)", "($)", "(€)" and the like, at the end of a column's name. */
  const CURRENCY_MARK = /\((?:[A-Z]{3}|\$|€|£|¥)\)(?=\s*$)/;

  window.HCSystemsSetup = {
    MIN_PARTS, CURRENCIES, EXTRAS,
    nameIn, placeIn, currencyForPlace, currencyCode, partsFor, fieldsFor,
    suggest, problemsOf, summaryOf, describe, buildOptions, applyTo, CURRENCY_MARK,
  };
})();
