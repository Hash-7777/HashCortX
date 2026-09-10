// ==============================================================
// How a generated business system shows its records
//
// Every screen of a generated system — the table, the board, the cards, the
// calendar, the detail panel, the charts — needs to name a record, show a
// figure, and sort records into columns. Each screen used to decide this for
// itself, and they disagreed: the chart beside the orders table labelled its
// bars "orders_1" and "orders_2", the detail panel was headed "invoice_1",
// money was shown as "56.5", and the board dropped any order whose status was
// not one of its columns, so a system could hold two orders and show one.
//
// Pure: takes an entity and records, returns plain values. No DOM, no storage.
//
// Loaded before the Systems mode and published as window.HCSystemsView.
// Checked by scripts/checks/systems-view.mjs.
// ==============================================================

(function () {
  'use strict';

  const OWN_NAME = /^(name|title|full_name|display_name|label)$/i;
  const IDENT_ID = /(^|_)(number|no|num|code|ref|reference|sku)$|^(code|ref|sku)(_|$)/i;
  const ANY_NAME = /_(name|title)$/i;
  const singular = (w) => String(w || '').toLowerCase().replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/s$/, '');

  /**
   * The field that names a record, in this order:
   *  - its own name: "name", or "product_name" on Products;
   *  - an identifier, such as an order or invoice number — unique, where a
   *    customer's name on an order is not;
   *  - someone else's name on it, such as a reservation's guest;
   *  - the first text field.
   * A record's internal id is never it.
   */
  function titleField(entity) {
    const fields = (entity && entity.fields) || [];
    const text = fields.filter((f) => f.type === 'text' || !f.type);
    const id = String((entity && (entity.id || entity.name)) || '').toLowerCase().replace(/\s+/g, '_');
    const own = new Set([singular(id), singular(id.split('_').pop())].flatMap((w) => [`${w}_name`, `${w}_title`]));
    return text.find((f) => OWN_NAME.test(f.id) || own.has(String(f.id).toLowerCase()))
      || text.find((f) => IDENT_ID.test(f.id))
      || text.find((f) => ANY_NAME.test(f.id))
      || text[0]
      || fields.find((f) => f.type !== 'number' && f.type !== 'date')
      || fields[0]
      || null;
  }

  /** What a record is called, for headings, chart labels and chips. */
  function recordLabel(record, entity) {
    const f = titleField(entity);
    const value = f && record ? record[f.id] : '';
    if (value != null && String(value).trim()) return String(value).trim();
    const noun = String((entity && entity.name) || 'record').replace(/s$/i, '').toLowerCase();
    return `Untitled ${noun}`;
  }

  const MONEY_WORDS = /price|amount|total|cost|revenue|salary|wage|fee|balance|subtotal|tax|profit|payment|paid|budget|income|expense|spend|debit|credit|cash|receivable|payable|invoiced|owed|due_amount/i;

  /** Whether a field holds money, from its name or a currency in its label. */
  function isMoneyField(field) {
    if (!field || field.type !== 'number') return false;
    const text = `${field.id || ''} ${field.label || ''}`;
    if (/\((usd|eur|gbp|egp|aed|sar|\$|€|£)\)/i.test(field.label || '')) return true;
    if (/percent|pct|rate|ratio|score|count|qty|quantity|units|stock|hours|minutes|days/i.test(field.id || '')) return false;
    return MONEY_WORDS.test(text);
  }

  /** A sum of money in the system's currency, with its cents. */
  function formatMoney(value, currency = 'USD') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  }

  /** A plain figure, grouped, with no more than two decimals. */
  function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  /** The currency a system counts in. */
  function currencyOf(spec) {
    const c = String((spec && (spec.financialModel && spec.financialModel.currency || spec.currency)) || 'USD').toUpperCase();
    return /^[A-Z]{3}$/.test(c) ? c : 'USD';
  }

  /**
   * The columns a board needs: the field's own options, then any status a
   * record actually has that is not among them, then one for records with
   * none — so every record is on the board somewhere.
   */
  function boardColumns(records, statusField) {
    const id = statusField && statusField.id;
    const options = (statusField && Array.isArray(statusField.options) ? statusField.options : []).map(String);
    const cols = [...options];
    let blank = false;
    for (const r of records || []) {
      const v = id ? r[id] : '';
      if (v == null || String(v).trim() === '') { blank = true; continue; }
      if (!cols.includes(String(v))) cols.push(String(v));
    }
    if (blank) cols.push(NO_STATUS);
    return cols;
  }

  const NO_STATUS = 'No status';

  /** Which column a record belongs in. */
  function boardColumnOf(record, statusField) {
    const v = statusField ? record[statusField.id] : '';
    return v == null || String(v).trim() === '' ? NO_STATUS : String(v);
  }

  /** The largest of some figures, or 0 when there are none — never -Infinity. */
  function safeMax(values) {
    const nums = (values || []).map(Number).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }

  window.HCSystemsView = {
    titleField, recordLabel, isMoneyField, formatMoney, formatNumber, currencyOf,
    boardColumns, boardColumnOf, safeMax, NO_STATUS,
  };
})();
