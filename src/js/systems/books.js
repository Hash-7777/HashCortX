// ==============================================================
// Where a generated system's books come from
//
// Every generated system used to be handed the same books: a Finance and an
// Invoices module and a year of invoices made up from a size profile for its
// kind of business, unconnected to anything it held. A 60-seat restaurant
// with two orders of $42 and $14 showed fifty invoices of around $10,000
// each.
//
// The books now come from the system's own sales: the records it keeps of
// what it sells — orders, bookings, appointments, jobs, subscriptions — each
// with an amount and a date. Each sale is one invoice for what it came to; a
// finished one is paid, a cancelled one is not billed, and one still to come
// is not billed yet. A system with no such records gets no books at all,
// rather than somebody else's.
//
// Pure: takes a spec and its records, returns the sales. No DOM, no storage.
// The ledger (js/systems/ledger.js) turns them into invoices, payments and
// journal entries that balance.
//
// Loaded after js/systems/view.js, figures.js and stages.js, before the
// Systems mode, and published as window.HCSystemsBooks.
// Checked by scripts/checks/systems-books.mjs.
// ==============================================================

(function () {
  'use strict';

  const VIEW = () => window.HCSystemsView;
  const FIG = () => window.HCSystemsFigures;
  const STAGES = () => window.HCSystemsStages;

  /** The words that mark records of what a business sells. */
  const SALE = /order|sale|booking|reservation|appointment|invoice|job|ticket|subscription|rental|enrol|membership|transaction|visit|session|deal|contract|consultation|stay|treatment|lesson|delivery|shipment|policy|engagement|work_order/i;
  /** What a business buys or pays out is never a sale, whatever it is called. */
  const NOT_SALE = /purchase|supplier|vendor|procure|expense|bill|payroll|salar|wage|cost|stock|inventory/i;
  const WHO = /customer|client|guest|patient|member|student|buyer|tenant|company|account|contact|patron/i;
  const WHAT = /(^|_)(items?|description|service|product|treatment|package|plan|summary|details?)(_|$)/i;

  /** The number in a field, or null when it has none. */
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  /**
   * The entity that records what the business sells, and how to read it — or
   * null when there is none. It must be named as a sale and carry an amount
   * of money and a date; a menu has prices and a supplier list has balances,
   * and neither is a sale. The books' own entities are never their own source.
   */
  function salesSource(spec, data, financeIds = []) {
    const skip = new Set(financeIds);
    let best = null;
    for (const e of Object.values((spec && spec.entities) || {})) {
      const said = `${e.id} ${e.name || ''}`;
      if (skip.has(e.id) || !SALE.test(said) || NOT_SALE.test(said)) continue;
      const fields = e.fields || [];
      const money = fields.filter((f) => VIEW().isMoneyField(f));
      const date = fields.find((f) => f.type === 'date');
      if (!money.length || !date) continue;
      const amount = money.find((f) => /total|amount|grand|due/i.test(f.id))
        || money.find((f) => /price|fee|charge|value|cost/i.test(f.id)) || money[0];
      const rows = ((data || {})[e.id] || []).filter((r) => num(r[amount.id]) != null && FIG().monthOf(r[date.id]));
      if (!rows.length) continue;
      if (best && rows.length <= best.count) continue;
      best = {
        entityId: e.id,
        name: e.name || e.id,
        count: rows.length,
        amountField: amount,
        dateField: date,
        customerField: fields.find((f) => f.type === 'link') || fields.find((f) => (f.type === 'text' || !f.type) && WHO.test(f.id)) || null,
        itemsField: fields.find((f) => (f.type === 'text' || f.type === 'textarea') && WHAT.test(f.id)) || null,
        stageField: STAGES().stageField(e),
      };
    }
    return best;
  }

  /**
   * The system's sales, oldest first, as the ledger bills them: who, when,
   * what it came to, what it was for, and whether it has been settled. A sale
   * with no amount, still to come or cancelled is left out.
   */
  function salesEvents(source, spec, data, today) {
    if (!source) return [];
    const entity = spec.entities[source.entityId];
    const out = [];
    for (const r of (data || {})[source.entityId] || []) {
      const total = num(r[source.amountField.id]);
      const date = String(r[source.dateField.id] || '').slice(0, 10);
      if (total == null || total <= 0 || !FIG().monthOf(date) || (today && date > today)) continue;
      const stage = source.stageField ? r[source.stageField.id] : null;
      if (stage && FIG().isDropped(stage)) continue;
      out.push({
        ref: VIEW().recordLabel(r, entity),
        recordId: r.id,
        customer: (source.customerField && String(r[source.customerField.id] || '').trim()) || '',
        date,
        total,
        description: (source.itemsField && String(r[source.itemsField.id] || '').trim()) || `${VIEW().singularName(entity)} ${VIEW().recordLabel(r, entity)}`,
        // A sale with no stage to say otherwise is taken as paid.
        settled: stage == null || stage === '' ? true : FIG().isFinished(stage),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.ref).localeCompare(String(b.ref)));
  }

  window.HCSystemsBooks = { salesSource, salesEvents, SALE };
})();
