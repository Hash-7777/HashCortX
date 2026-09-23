// ==============================================================
// The ERP agent: what it is told, and what is done with what it says
//
// The ERP used to be a row of buttons around a text box: Generate, Change,
// Do it, each reading the same box and each doing one thing. A person had to
// know which button their sentence belonged to, and the system itself sat in
// a small window between two panels. Now the system fills the mode and the
// person talks to one agent that can see it.
//
// The agent is shown the system that is open — its tables, its fields, how
// many records each holds, their totals, and the most recent records — so it
// can answer about them. When a request needs the system to change, it says
// which of three things to do, and the app does it through the paths that
// already existed and are already checked:
//
//   build    a new system for a business       (the builder, js/systems/scaffold.js)
//   change   this system's design               (js/systems/revise.js)
//   records  its records: add, edit, delete     (js/systems/work.js, shown first)
//
// Before building it must know what the business does, what it is called and
// where it is, and it asks in the conversation for what it does not know,
// rather than a form. It never invents a business's name.
//
// NOTHING IT SAYS IS DONE AS IT ARRIVES. Its answer is read here into one of
// those three actions or none, with every value checked and cut to size; an
// answer that cannot be read is shown as words and does nothing. Changes to
// records are still put in front of the person before they are made.
//
// Also here: the empty starter system the mode opens on before any has been
// built — an overview, Customers, Products, Orders and Invoices, with no records.
//
// Pure: specs, records and text in, plain values out. No DOM, no storage.
// Loaded before the Systems mode and published as window.HCSystemsAgent.
// Checked by scripts/checks/systems-agent.mjs.
// ==============================================================

(function () {
  'use strict';

  const ACTIONS = ['none', 'build', 'change', 'records'];
  const MAX_TURNS = 12;          // the conversation the model is shown
  const MAX_TURN_CHARS = 1500;
  const RECENT_ROWS = 12;        // records shown per table, at most
  const ALL_ROWS = 48;           // records shown in all, however many tables: a
                                 // free account's per-minute budget is small
  const MAX_CELL = 80;

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  const SYSTEM = `You are the ERP agent in HashCortx. The person sees a business system full screen and talks to you in a small chat. You can see the system that is open, described below with its records.

What you can do, and how you say it:
- Answer a question about the system or its records, in "say", using the records shown. When a table has more records than you were shown, say your answer is from the ones shown or use the totals given. Never invent a record.
- "build": make a NEW system for a business. You must know three things first: what the business does, its name, and where it is (the currency follows from the place). When any is missing, ask for the missing ones in "say" with "do":"none" — one short message, at most three questions, each with a short example. Never invent a business name; if they say they have none, use a plain one such as "Bookshop". When you have all three, set "do":"build", fill "business", and put everything they told you in "request".
- "change": change THIS system's design — add, remove or rename modules, tables, fields, screens, or its layout. Put the whole change in "request".
- "records": add, edit or delete records, or record what happened ("Sara paid invoice 12"). Put it in "request" plainly; the app shows the person exactly what will change before it changes anything.
- Otherwise "do":"none".
Keep "say" short, plain and friendly: one to three sentences, no markdown headings, no emoji. Say what you are about to do when you do something — and never say you are building, changing or adding anything unless "do" is the action that does it.

Return ONLY JSON, no markdown:
{"say":"what you tell the person","do":"none|build|change|records","request":"the complete instruction for build, change or records","business":{"name":"","does":"","place":"","currency":""}}`;

  /** A value as the model is shown it: short, one line. */
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? v : '';
    return clean(typeof v === 'object' ? JSON.stringify(v) : v, MAX_CELL);
  };

  /**
   * The open system as the agent is shown it: what it is, each table with its
   * fields, how many records and the totals of its number fields, and the most
   * recent records. Never every record — a table can hold thousands.
   */
  function contextOf(spec, data, { today = '', starter = false } = {}) {
    if (!spec) return 'No system is open.';
    const lines = [];
    lines.push(`System: ${clean(spec.name, 80)}${starter ? ' (the empty starter system the ERP opens on — nothing has been built for this person yet)' : ''}`);
    if (spec.description && !starter) lines.push(`About it: ${clean(spec.description, 240)}`);
    if (spec.currency) lines.push(`Money is counted in ${clean(spec.currency, 3)}.`);
    if (today) lines.push(`Today is ${clean(today, 10)}.`);
    const modules = Array.isArray(spec.modules) ? spec.modules : [];
    lines.push(`Modules: ${modules.map((m) => `${clean(m.name, 32)} (${clean(m.screen, 12)} of ${clean(m.entity, 32)})`).join(', ') || 'none'}`);
    const entities = spec.entities && typeof spec.entities === 'object' ? spec.entities : {};
    const perTable = Math.max(3, Math.min(RECENT_ROWS, Math.floor(ALL_ROWS / Math.max(1, Object.keys(entities).length))));
    for (const [id, entity] of Object.entries(entities)) {
      const fields = Array.isArray(entity && entity.fields) ? entity.fields : [];
      const rows = Array.isArray(data && data[id]) ? data[id] : [];
      const numbers = fields.filter((f) => f.type === 'number');
      const totals = numbers.map((f) => {
        const sum = rows.reduce((n, r) => n + (Number(r && r[f.id]) || 0), 0);
        return `${clean(f.label || f.id, 30)} total ${Math.round(sum * 100) / 100}`;
      });
      lines.push('');
      lines.push(`Table "${clean(entity.name || id, 40)}" (id ${id}): ${rows.length} record${rows.length === 1 ? '' : 's'}${totals.length ? ` · ${totals.join(' · ')}` : ''}`);
      lines.push(`Fields: ${fields.map((f) => `${f.id} (${f.type}${Array.isArray(f.options) && f.options.length ? `: ${f.options.slice(0, 8).map((o) => clean(o, 20)).join('/')}` : ''}${f.type === 'link' && f.entity ? ` → ${f.entity}` : ''})`).join(', ')}`);
      const shown = rows.slice(-perTable);
      if (shown.length) {
        if (rows.length > shown.length) lines.push(`The ${shown.length} most recent of them:`);
        for (const r of shown) lines.push(JSON.stringify(Object.fromEntries([['id', cell(r.id)], ...fields.map((f) => [f.id, cell(r[f.id])])])));
      }
    }
    return lines.join('\n');
  }

  /** What the model is sent: the rules, the system, the conversation so far and the new message. */
  function messages({ spec, data, history, text, today, starter } = {}) {
    const past = (Array.isArray(history) ? history : [])
      .filter((t) => t && (t.role === 'user' || t.role === 'agent') && clean(t.text, 10))
      .slice(-MAX_TURNS)
      .map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', content: clean(t.text, MAX_TURN_CHARS) }));
    return [
      { role: 'system', content: `${SYSTEM}\n\nTHE SYSTEM THAT IS OPEN:\n${contextOf(spec, data, { today, starter })}` },
      ...past,
      { role: 'user', content: clean(text, 4000) },
    ];
  }

  /**
   * The agent's answer as something the app can act on, or as words alone.
   *
   * An answer that is not the JSON asked for is shown as it came and does
   * nothing. An action is only kept with an instruction to carry out, and a
   * build only with the business's own description.
   */
  function readReply(raw) {
    const text = String(raw || '').trim();
    const fenced = typeof window !== 'undefined' && window.HCFences ? window.HCFences.jsonBlock(text) : null;
    const body = fenced != null ? fenced : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    let parsed = null;
    if (start >= 0 && end > start) { try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { parsed = null; } }
    if (!parsed || typeof parsed !== 'object') {
      return { say: clean(text, 1200) || 'I could not put that into words. Try asking again.', do: 'none', request: '', business: null, readable: false };
    }
    let action = ACTIONS.includes(parsed.do) ? parsed.do : 'none';
    const request = clean(parsed.request, 3000);
    const b = parsed.business && typeof parsed.business === 'object' ? parsed.business : {};
    const business = {
      name: clean(b.name, 60),
      does: clean(b.does, 300),
      place: clean(b.place, 80),
      currency: /^[A-Za-z]{3}$/.test(clean(b.currency, 12)) ? clean(b.currency, 3).toUpperCase() : '',
    };
    if (action !== 'none' && !request && !(action === 'build' && business.does)) action = 'none';
    if (action === 'build' && !business.does) business.does = request.slice(0, 300);
    const say = clean(parsed.say, 1200) || (action === 'none' ? 'Done.' : '');
    // A business described alongside another action is kept aside, for
    // `settleBuild` below; only a build acts on one.
    const described = action !== 'build' && business.name && business.does ? business : null;
    return { say, do: action, request, business: action === 'build' ? business : null, described, readable: true };
  }

  /** The shape an answer must have, for a model that can be held to one (Ollama). */
  const REPLY_SCHEMA = {
    type: 'object',
    properties: {
      say: { type: 'string' },
      do: { type: 'string', enum: ACTIONS },
      request: { type: 'string' },
      business: { type: 'object', properties: { name: { type: 'string' }, does: { type: 'string' }, place: { type: 'string' }, currency: { type: 'string' } } },
    },
    required: ['say', 'do'],
  };

  // Words that say what kind of business it is, not what it is called.
  const TRADE_WORD = /^(?:the|and|of|shop|store|bookstore|bookshop|cafe|café|restaurant|bakery|clinic|salon|studio|company|co|ltd|llc|inc|business|services?|centre|center|market|group|workshop)$/i;
  const NO_NAME = /\b(?:no name|not named|don'?t have a name|doesn'?t have a name|hasn'?t got a name|no name yet|any name|you (?:choose|pick|decide)|pick (?:a|one)|name it (?:yourself|anything))\b/i;
  const wordsOf = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

  /**
   * What a build names that the person never said: 'name' and 'place'. The
   * agent is told never to invent them, and a small model does anyway — a
   * bookstore with no place given came back as in the USA. A name or place
   * counts as said when one of its own words is in something the person
   * wrote; a name also when they said they have none.
   */
  function unsaid(business, userTexts) {
    const said = (Array.isArray(userTexts) ? userTexts : [userTexts]).join('\n');
    const heard = new Set(wordsOf(said));
    const missing = [];
    const nameWords = wordsOf(business && business.name).filter((w) => !TRADE_WORD.test(w));
    if (!(nameWords.some((w) => heard.has(w)) || NO_NAME.test(said))) missing.push('name');
    if (!wordsOf(business && business.place).some((w) => heard.has(w))) missing.push('place');
    return missing;
  }

  const WANTS_A_SYSTEM = /\b(?:build|make|create|set ?up|start|need|want)\b[^.?!\n]{0,60}\b(?:erp|system|app|software)\b|\berp\b/i;

  /**
   * A build the model described and did not start. A small model asked for a
   * system, given the business's name, trade and place, fills in all of it
   * and still says "none", asking what to include — and asks again each turn.
   * Before anything is built (the starter is open), with a system asked for
   * and every fact the person's own, that is taken as the build it described.
   */
  function settleBuild(said, { starter, userTexts } = {}) {
    const b = said && said.described;
    if (!b || said.do !== 'none' || !starter) return said;
    const texts = Array.isArray(userTexts) ? userTexts : [userTexts];
    if (!texts.some((t) => WANTS_A_SYSTEM.test(String(t || ''))) || unsaid(b, texts).length) return said;
    const request = `A system for ${b.name}, which ${b.does}, in ${b.place}. ${texts.join(' ')}`.slice(0, 3000);
    return { ...said, do: 'build', request, business: b, described: null, say: `Building the system for ${b.name} now.` };
  }

  /**
   * What the agent says as it acts. Its own words are used only when it is
   * doing nothing: a model says "Customer added successfully" before anything
   * has run, and when the change then fails the person has been told it
   * happened. The steps written under the reply say what really did.
   */
  function leadIn(said, asked) {
    // The person's own words: a model's request can be SQL or its own shorthand.
    const req = clean(asked || (said && said.request), 160);
    if (!said || said.do === 'none') return (said && said.say) || '';
    if (said.do === 'build') return `Building the system for ${clean(said.business && said.business.name, 60) || 'your business'} now.`;
    if (said.do === 'change') return `Changing the design: ${req}`;
    return `Working out what to change in your records: ${req}. You will see the change before it is made.`;
  }

  const CLAIMS_DONE = /\b(?:added|created|updated|deleted|removed|recorded|changed|renamed|saved|marked|built|set up|moved|paid)\b/i;
  const ASKS_A_CHANGE = /\b(?:add|new|create|record|log|enter|put|delete|remove|update|change|edit|rename|mark|set|paid|pays|bought|sold|returned|cancel(?:led)?)\b/i;
  const ABOUT_DESIGN = /\b(?:fields?|columns?|modules?|screens?|tabs?|tables?|pages?|layout|sections?|dashboard|design|colou?rs?|theme|menu)\b/i;

  /**
   * An answer that says a change was made when none was asked of the app.
   * A small model answers "Customer added successfully" with "do":"none", so
   * nothing happens and the person believes it did. When their message asked
   * for a change, it is carried out — a design change when it names a field,
   * a table or a screen, a change to records otherwise; when it did not, the
   * claim is replaced by the truth.
   */
  function noFalseClaim(said, text) {
    if (!said || said.do !== 'none' || !CLAIMS_DONE.test(said.say || '')) return said;
    const asked = clean(text, 3000);
    if (ASKS_A_CHANGE.test(asked)) return { ...said, do: ABOUT_DESIGN.test(asked) ? 'change' : 'records', request: asked };
    return { ...said, say: 'Nothing was changed. Say what you would like changed, or pick a larger model at the top of this panel.' };
  }

  const DESIGN_REQUEST = /\b(?:add|remove|delete|rename|drop|create|new|hide)\b[^.\n]{0,40}\b(?:fields?|columns?|modules?|screens?|tabs?|pages?|sections?|charts?)\b/i;

  /**
   * What the app does with the agent's answer, before anything happens: a
   * build it described and did not start (settleBuild), a change it claimed
   * and did not ask for (noFalseClaim), and a change to the design — a field,
   * a column, a screen — sent down the records road, where it can only fail.
   */
  function settle(said, { starter, userTexts, text } = {}) {
    let s = noFalseClaim(settleBuild(said, { starter, userTexts }), text);
    if (s.do === 'records' && DESIGN_REQUEST.test(String(text || ''))) s = { ...s, do: 'change', request: clean(text, 3000) };
    return s;
  }

  /** The question asked instead of building, for what was not said. */
  function askFor(missing) {
    const want = [missing.includes('name') && 'what the business is called', missing.includes('place') && 'where it is (the city or country sets its currency)'].filter(Boolean);
    return `Before I build it, tell me ${want.join(' and ')}. For example: "a bookshop called Pages in Cairo". If it has no name yet, say so and I will use a plain one.`;
  }

  // ── The starter system ──────────────────────────────────────────────

  const STARTER_NAME = 'My business';

  /** What the empty starter is built from: the builder's options, not a spec. */
  function starterOptions(currency) {
    const status = (options) => ({ id: 'status', label: 'Status', type: 'select', options });
    const orders = [
      { id: 'order_number', label: 'Order', type: 'text', required: true },
      { id: 'customer', label: 'Customer', type: 'link', entity: 'customers' },
      { id: 'date', label: 'Date', type: 'date' },
      { id: 'total', label: 'Total', type: 'number' },
      status(['New', 'Paid', 'Shipped', 'Delivered', 'Cancelled']),
    ];
    return {
      name: STARTER_NAME,
      domain: 'generic',
      currency: /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'USD',
      // Five, because a system needs that many parts to be worth opening
      // (js/systems/spec.js); the first is a dashboard over the orders.
      modules: [
        // The builder takes a table's fields from the first module that names
        // it, so the dashboard carries the orders' own.
        { name: 'Overview', entity: 'orders', screen: 'dashboard', fields: orders },
        { name: 'Customers', entity: 'customers', screen: 'split', fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'email', label: 'Email', type: 'text' },
          { id: 'phone', label: 'Phone', type: 'text' },
          { id: 'city', label: 'City', type: 'text' },
          { id: 'since', label: 'Customer since', type: 'date' },
          status(['Active', 'Inactive']),
        ] },
        { name: 'Products', entity: 'products', screen: 'list', fields: [
          { id: 'name', label: 'Product', type: 'text', required: true },
          { id: 'sku', label: 'SKU', type: 'text' },
          { id: 'price', label: 'Price', type: 'number' },
          { id: 'stock', label: 'In stock', type: 'number' },
          status(['Available', 'Out of stock', 'Discontinued']),
        ] },
        { name: 'Orders', entity: 'orders', screen: 'kanban', fields: orders },
        { name: 'Invoices', entity: 'invoices', screen: 'list', fields: [
          { id: 'number', label: 'Invoice', type: 'text', required: true },
          { id: 'customer', label: 'Customer', type: 'link', entity: 'customers' },
          { id: 'issued', label: 'Issued', type: 'date' },
          { id: 'due', label: 'Due', type: 'date' },
          { id: 'amount', label: 'Amount', type: 'number' },
          status(['Draft', 'Sent', 'Paid', 'Overdue']),
        ] },
      ],
    };
  }

  /** A built system emptied of every record, for the starter. */
  function emptied(spec) {
    if (!spec || typeof spec !== 'object') return spec;
    const mockData = {};
    for (const id of Object.keys(spec.entities || {})) mockData[id] = [];
    return { ...spec, mockData, starter: true, description: 'An empty system to start from. Type into it, or ask the agent to build one for your business.' };
  }

  /** Whether a system is the untouched starter: nothing built, nothing kept in it. */
  function isUntouchedStarter(spec, data) {
    if (!spec || !spec.starter) return false;
    if (Array.isArray(spec.revisionHistory) && spec.revisionHistory.length) return false;
    return !Object.values(data || {}).some((rows) => Array.isArray(rows) && rows.length);
  }

  window.HCSystemsAgent = {
    ACTIONS, SYSTEM, STARTER_NAME, REPLY_SCHEMA, contextOf, messages, readReply, unsaid, askFor, settleBuild, noFalseClaim, settle, leadIn, starterOptions, emptied, isUntouchedStarter,
  };
})();
