// ==============================================================
// finance/figures.js — a report's numbers, worked out by the app
//
// A Finance report used to be a set of numbers the model wrote separately: the
// cards, each chart and the table, with nothing joining them. So a total could
// disagree with the lines it was the total of — models are poor at adding up —
// and a figure corrected by hand changed that one cell and nothing else, since
// nothing else was made from it.
//
// Now the model lists the figures it read — each item, its amount, which way
// the money went and a category — and does no sums. Everything else is made
// here from that one list: the cards (money in, money out, set aside, what is
// left, the saving rate), the charts (where the money goes; in and out by
// month when the figures are dated), and the table, which is the list itself.
// A change to the table is read back into the list and everything is made
// again, so the report cannot contradict itself.
//
// A measure that is not a sum of money in or out — a churn rate, runway in
// months — can still come from the model. It is kept after the app's cards and
// marked as the model's own estimate, because nothing here can check it.
//
// Pure: plain values in and out, no DOM. Published as window.HCFinanceFigures.
// Run the checks with: npm run check:finance-figures
// ==============================================================
(function () {
  'use strict';

  const MAX_FIGURES = 400;
  const TOP_CATEGORIES = 7;
  const FLOW_NAME = { in: 'In', out: 'Out', saved: 'Set aside' };
  const DEFAULT_LABELS = { in: 'Money in', out: 'Money out', saved: 'Set aside', net: 'Left over', rate: 'Saving rate' };
  // A model's own card that repeats one of these is dropped: the app's is right.
  // A ratio or a span of time built on them ("debt to income", "profit
  // margin", "months of runway") is not one of them, and is kept.
  const COMPUTED_LABEL = /\b(incomes?|revenues?|take.?home|salar(?:y|ies)|earnings?|money in|expenses?|spend|spending|costs?|money out|outflows?|savings?|saved|set aside|net|left over|surplus|profits?|balance|cash ?flow)\b/i;
  const NOT_A_SUM = /\b(ratio|to|per|months?|days?|runway|churn|margin|growth|score)\b|%/i;
  const repeatsASum = (label) => COMPUTED_LABEL.test(label) && !NOT_A_SUM.test(label);

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  function amountOf(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const A = typeof window !== 'undefined' && window.HCFinanceAmounts;
    if (A) return A.parseAmount(v);
    const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  /** Which way money went, read the way a person or a model writes it. */
  function flowOf(v, amount) {
    const s = String(v || '').toLowerCase().trim();
    if (/^(in|income|revenue|credit|cr|received|money in|inflow|deposit)\b/.test(s)) return 'in';
    if (/^(saved|saving|savings|set aside|invest|investment|transfer to savings)\b/.test(s)) return 'saved';
    if (/^(out|expense|spend|spent|cost|debit|dr|paid|payment|money out|outflow|debt)\b/.test(s)) return 'out';
    return 'out';   // unsaid: spending is what a list of figures is mostly made of
  }

  const DATE = /^\d{4}-\d{2}(?:-\d{2})?$/;

  /** The model's list, checked: every figure a positive amount with a way it went. */
  function read(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const f of list.slice(0, MAX_FIGURES)) {
      if (!f || typeof f !== 'object') continue;
      const raw = amountOf(f.amount);
      if (raw === null || raw === 0) continue;
      const date = clean(f.date, 10);
      out.push({
        item: clean(f.item || f.label || f.name, 80) || 'Item',
        category: clean(f.category, 40) || 'Other',
        flow: flowOf(f.flow || f.direction || f.type, raw),
        amount: Math.round(Math.abs(raw) * 100) / 100,
        ...(DATE.test(date) ? { date } : {}),
      });
    }
    return out;
  }

  /** The sums, each made once from the list. */
  function summarize(figures) {
    const s = { in: 0, out: 0, saved: 0, byCategory: [], byMonth: [] };
    const cats = new Map();
    const months = new Map();
    for (const f of figures || []) {
      s[f.flow] += f.amount;
      if (f.flow === 'out') cats.set(f.category, (cats.get(f.category) || 0) + f.amount);
      if (f.date) {
        const m = f.date.slice(0, 7);
        const row = months.get(m) || { month: m, in: 0, out: 0 };
        if (f.flow === 'in') row.in += f.amount;
        if (f.flow === 'out') row.out += f.amount;
        months.set(m, row);
      }
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    s.in = r2(s.in); s.out = r2(s.out); s.saved = r2(s.saved);
    s.net = r2(s.in - s.out - s.saved);
    s.rate = s.in > 0 ? Math.round((s.saved / s.in) * 1000) / 10 : null;
    const sorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, TOP_CATEGORIES);
    const rest = sorted.slice(TOP_CATEGORIES).reduce((n, [, v]) => n + v, 0);
    s.byCategory = [...top, ...(rest > 0 ? [['Other', rest]] : [])].map(([name, v]) => [name, r2(v)]);
    s.byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, in: r2(m.in), out: r2(m.out) }));
    return s;
  }

  /** Money as the cards show it: in the report's currency when it names one. */
  function money(n, currency) {
    const code = /^[A-Z]{3}$/.test(String(currency || '').trim().toUpperCase()) ? String(currency).trim().toUpperCase() : '';
    const digits = Math.abs(n) % 1 ? 2 : 0;
    if (code) {
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(n);
      } catch { /* a code Intl does not know: written plainly below */ }
    }
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  }

  const share = (part, whole, of) => (whole > 0 ? `${Math.round((part / whole) * 100)}% of ${of.toLowerCase()}` : '');

  function labelsOf(given) {
    const out = { ...DEFAULT_LABELS };
    if (given && typeof given === 'object') {
      for (const k of Object.keys(DEFAULT_LABELS)) { const v = clean(given[k], 24); if (v) out[k] = v; }
    }
    return out;
  }

  /** The cards the app works out. */
  function kpisOf(s, currency, labels) {
    const L = labelsOf(labels);
    const cards = [];
    if (s.in > 0) cards.push({ label: L.in, value: money(s.in, currency), change: '', positive: true, icon: 'revenue', computed: true });
    cards.push({ label: L.out, value: money(s.out, currency), change: share(s.out, s.in, L.in), positive: false, icon: 'cost', computed: true });
    if (s.saved > 0) cards.push({ label: L.saved, value: money(s.saved, currency), change: share(s.saved, s.in, L.in), positive: true, icon: 'cash', computed: true });
    if (s.in > 0) {
      cards.push({ label: L.net, value: money(s.net, currency), change: `${s.net < 0 ? '-' : ''}${share(Math.abs(s.net), s.in, L.in)}`, positive: s.net >= 0, icon: 'profit', computed: true });
      if (s.saved > 0) cards.push({ label: L.rate, value: `${s.rate}%`, change: '', positive: true, icon: 'growth', computed: true });
    }
    return cards;
  }

  /** The charts the app draws from the sums. */
  function chartsOf(s, labels) {
    const L = labelsOf(labels);
    const charts = [];
    if (s.byCategory.length) {
      charts.push({ id: 'figures-where', type: 'donut', title: L.out === DEFAULT_LABELS.out ? 'Where the money goes' : `Where the ${L.out.toLowerCase()} go`,
        labels: s.byCategory.map(([n]) => n), datasets: [{ label: L.out, values: s.byCategory.map(([, v]) => v) }] });
    }
    if (s.byMonth.length >= 2) {
      charts.push({ id: 'figures-months', type: 'bar', title: `${L.in} and ${L.out.toLowerCase()} by month`,
        labels: s.byMonth.map((m) => m.month), datasets: [
          { label: L.in, values: s.byMonth.map((m) => m.in) },
          { label: L.out, values: s.byMonth.map((m) => m.out) },
        ] });
    } else if (s.in > 0 || s.saved > 0) {
      const parts = [[L.in, s.in], [L.out, s.out], [L.saved, s.saved]].filter(([, v]) => v > 0);
      charts.push({ id: 'figures-split', type: 'bar', title: parts.map(([n], i) => (i ? n.toLowerCase() : n)).join(', ').replace(/, ([^,]*)$/, ' and $1'),
        labels: parts.map(([n]) => n), datasets: [{ label: 'Amount', values: parts.map(([, v]) => v) }] });
    }
    return charts;
  }

  /** The list as the editable table. */
  function tableOf(figures) {
    const dated = figures.some((f) => f.date);
    const headers = [...(dated ? ['Date'] : []), 'Item', 'Category', 'In / out', 'Amount'];
    const rows = figures.map((f) => [...(dated ? [f.date || ''] : []), f.item, f.category, FLOW_NAME[f.flow],
      f.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })]);
    return { title: 'Your figures', headers, rows, figures: true };
  }

  /** The table, as edited, read back into the list. A row with no amount is left out. */
  function fromTable(table) {
    const H = (table && table.headers || []).map((h) => String(h).toLowerCase());
    const col = (re) => H.findIndex((h) => re.test(h));
    const at = { date: col(/^date/), item: col(/^item/), category: col(/^categor/), flow: col(/in ?\/ ?out|^flow/), amount: col(/^amount/) };
    return read((table && table.rows || []).map((r) => ({
      date: at.date >= 0 ? r[at.date] : '', item: r[at.item], category: r[at.category], flow: r[at.flow], amount: r[at.amount],
    })));
  }

  /**
   * A report made whole from its figures: cards, charts and table from the
   * list, the model's own cards that are not sums kept after them and marked.
   * A report without figures is returned as it came.
   */
  function apply(report) {
    if (!report || !Array.isArray(report.figures) || !report.figures.length) return report;
    // The model's own cards: picked out the first time, and after that read
    // from the cards as they stand, so one edited by hand keeps its edit.
    report.modelKpis = report.modelKpis
      ? (report.kpis || []).filter((k) => k && k.byModel)
      : (report.kpis || []).filter((k) => k && !repeatsASum(String(k.label || '')))
        .map((k) => ({ ...k, estimated: true, byModel: true }));
    const s = summarize(report.figures);
    report.kpis = [...kpisOf(s, report.currency, report.figure_labels), ...report.modelKpis].slice(0, 8);
    report.charts = chartsOf(s, report.figure_labels);
    report.table = tableOf(report.figures);
    return report;
  }

  window.HCFinanceFigures = { read, flowOf, summarize, money, kpisOf, chartsOf, tableOf, fromTable, apply, DEFAULT_LABELS };
})();
