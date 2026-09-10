// ==============================================================
// The figures a generated business system shows, worked out from its records
//
// Every dashboard used to carry trends nobody had measured: "+12%", "+8%",
// "-3%" and "+5%" on the four default tiles, "+5%" on any the model defined,
// sparklines drawn from seven fixed numbers, a "Live" badge on data that never
// changes, and a bar of 10, 20, 30 for a record with no figure at all. A
// person deciding whether a prototype is worth building would have been
// reading numbers the app made up.
//
// Everything here is computed from the records. A trend compares the latest
// month the records reach with the month before it, and says which two months
// those are; where there is nothing to compare — no dates, or nothing in the
// earlier month — there is no trend, rather than a guess.
//
// Pure: takes records, returns numbers. No DOM, no storage. The present month
// is passed in, never read from the clock, so every answer can be checked.
//
// Loaded before the Systems mode and published as window.HCSystemsFigures.
// Checked by scripts/checks/systems-figures.mjs.
// ==============================================================

(function () {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** The numbers in a field, skipping blanks and words rather than counting them as 0. */
  function numbers(records, fieldId) {
    const out = [];
    for (const r of records || []) {
      const v = r ? r[fieldId] : undefined;
      if (v === '' || v == null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) out.push(n);
    }
    return out;
  }

  /**
   * One figure from some records. "count" is how many records there are; the
   * others work over the field's numbers, and are null when it has none —
   * the average of nothing is not 0.
   */
  function aggregate(records, fieldId, how = 'sum') {
    if (how === 'count' || !fieldId) return (records || []).length;
    const nums = numbers(records, fieldId);
    if (how === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (!nums.length) return null;
    if (how === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (how === 'max') return Math.max(...nums);
    if (how === 'min') return Math.min(...nums);
    return nums.reduce((a, b) => a + b, 0);
  }

  /** "2026-09" from a date written as 2026-09-11 or 2026-09. */
  function monthOf(value) {
    const m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : '';
  }

  function shiftMonth(month, by) {
    const [y, m] = month.split('-').map(Number);
    const d = y * 12 + (m - 1) + by;
    return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, '0')}`;
  }

  const monthName = (month) => MONTHS[Number(month.slice(5, 7)) - 1] || month;

  /** The field that dates a record, if it has one. */
  function dateFieldOf(entity) {
    const fields = (entity && entity.fields) || [];
    return fields.find((f) => f.type === 'date') || null;
  }

  /**
   * The latest month the records reach, not counting any after `today` — a
   * booking next month is not this month's business.
   */
  function latestMonth(records, dateFieldId, today) {
    const now = monthOf(today);
    let best = '';
    for (const r of records || []) {
      const m = monthOf(r && r[dateFieldId]);
      if (m && (!now || m <= now) && m > best) best = m;
    }
    return best || null;
  }

  function inMonth(records, dateFieldId, month) {
    return (records || []).filter((r) => monthOf(r && r[dateFieldId]) === month);
  }

  /**
   * The same figure month by month, oldest first, for the `count` months
   * ending at the latest month the records reach. Empty when the records
   * carry no dates.
   */
  function monthlySeries(records, dateFieldId, fieldId, how, today, count = 7) {
    if (!dateFieldId) return [];
    const end = latestMonth(records, dateFieldId, today);
    if (!end) return [];
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const month = shiftMonth(end, -i);
      const value = aggregate(inMonth(records, dateFieldId, month), fieldId, how);
      out.push({ month, label: monthName(month), value: value == null ? 0 : value });
    }
    return out;
  }

  /**
   * How the latest month compares with the one before, or null when that
   * cannot honestly be said: no dates, no earlier month, or an earlier figure
   * of 0, from which no percentage follows.
   */
  function monthTrend(records, dateFieldId, fieldId, how, today) {
    if (!dateFieldId) return null;
    const current = latestMonth(records, dateFieldId, today);
    if (!current) return null;
    const previous = shiftMonth(current, -1);
    const a = aggregate(inMonth(records, dateFieldId, current), fieldId, how);
    const b = aggregate(inMonth(records, dateFieldId, previous), fieldId, how);
    if (a == null || b == null || b === 0) return null;
    const pct = Math.round(((a - b) / Math.abs(b)) * 100);
    return {
      pct,
      up: pct >= 0,
      text: `${pct > 0 ? '+' : ''}${pct}%`,
      current: monthName(current),
      previous: monthName(previous),
    };
  }

  /**
   * The month a calendar opens on: this month if anything falls in it, else
   * the latest month the records reach, else the first month they have at
   * all — bookings can all lie ahead — else this month. It used to open on
   * whichever month held the most records, with no way to move from it.
   */
  function calendarStart(records, dateFieldId, today) {
    const now = monthOf(today);
    const months = (records || []).map((r) => monthOf(r && r[dateFieldId])).filter(Boolean);
    if (months.includes(now)) return now;
    return latestMonth(records, dateFieldId, today) || months.sort()[0] || now;
  }

  /**
   * A figure the model asked for — { label, field, aggregate } — read against
   * the entity's fields, or null when it names a field the entity does not
   * have. Such a figure used to be shown as 0.
   */
  function kpiFrom(def, fields) {
    const how = ['sum', 'avg', 'max', 'min', 'count'].includes(def && def.aggregate) ? def.aggregate : 'sum';
    const want = String((def && def.field) || '').toLowerCase();
    const field = (fields || []).find((f) => f.id === (def && def.field) || String(f.label || '').toLowerCase() === want) || null;
    if (how !== 'count' && !field) return null;
    return { label: (def && def.label) || (field && field.label) || 'Records', field, how };
  }

  const FINISHED = /\b(closed|done|approved|paid|complete|completed|delivered|served|resolved|shipped|won|fulfilled|checked.?out|finished|settled|posted)\b/i;
  const DROPPED = /\b(cancel+ed|lost|rejected|void|no.?show|declined)\b/i;

  /** Whether a status means the work is finished, and whether it was dropped. */
  const isFinished = (status) => FINISHED.test(String(status || ''));
  const isDropped = (status) => DROPPED.test(String(status || ''));

  window.HCSystemsFigures = {
    aggregate, numbers, monthOf, shiftMonth, dateFieldOf, latestMonth, monthlySeries, monthTrend,
    kpiFrom, isFinished, isDropped, calendarStart,
  };
})();
