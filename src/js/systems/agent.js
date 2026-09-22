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
    return { say, do: action, request, business: action === 'build' ? business : null, readable: true };
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
    ACTIONS, SYSTEM, STARTER_NAME, contextOf, messages, readReply, starterOptions, emptied, isUntouchedStarter,
  };
})();
