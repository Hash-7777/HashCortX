// ==============================================================
// Stand-in values for a generated system's records
//
// A model writes the records of a generated system. Where it leaves a value
// out — or a whole entity empty and a second request for records fails —
// something has to stand in. What stood in was the app's own lists: menus of
// pizza and cheesecake, hotel suites, yoga classes, hydraulic valves. A
// Lebanese restaurant was given a club sandwich; every system met the same
// "Meridian Co." and "Sarah Chen".
//
// A stand-in now says what it is. A person, a company, an email or a phone
// number gets a neutral one; a dish, a room or a product gets "Dish 3", not
// somebody else's menu. A choice is one of the field's own options. A date
// falls in the six months before today, not in a fixed window that goes stale.
//
// Pure: the date of today is passed in. No DOM, no storage.
//
// Loaded after js/systems/money.js, before the Systems mode, and published as
// window.HCSystemsSamples. Checked by scripts/checks/systems-samples.mjs.
// ==============================================================

(function () {
  'use strict';

  const rand = (seed, idx) => window.HCSystemsMoney.seededRand(seed, idx);

  const FIRST = ['Sarah', 'Omar', 'Aisha', 'Carlos', 'Mei', 'James', 'Priya', 'Lucas', 'Fatima', 'David', 'Yuna', 'Ravi', 'Elena', 'Marcus', 'Layla', 'Kofi', 'Ana', 'Hana', 'Tariq', 'Nadia'];
  const LAST = ['Chen', 'Osei', 'Patel', 'Haddad', 'Santos', 'Kim', 'Reyes', 'Ali', 'Johnson', 'Okafor', 'Nakamura', 'Singh', 'Cohen', 'Mansour', 'Dubois', 'García', 'Yamamoto', 'Mensah', 'Brown', 'Andersen'];
  const COMPANY_A = ['North', 'Blue', 'Cedar', 'Silver', 'Harbor', 'Summit', 'Oak', 'River', 'Stone', 'Bright', 'Golden', 'Clear'];
  const COMPANY_B = ['Supply', 'Partners', 'Trading', 'Group', 'Works', 'Services', 'Co.', 'Holdings', 'Traders', 'Associates'];
  const CITIES = ['Cairo', 'London', 'Dubai', 'Singapore', 'Toronto', 'Berlin', 'Mumbai', 'São Paulo', 'Nairobi', 'Sydney', 'Madrid', 'Seoul'];

  const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  const pick = (list, r) => list[Math.floor(r * list.length)];

  /** `iso` minus a number of days, as YYYY-MM-DD, counted in UTC so no zone shifts it. */
  function daysBefore(iso, days) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const t = Date.UTC(y, (m || 1) - 1, d || 1) - days * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  /**
   * A stand-in for one field of one record. The same field, record and seed
   * always give the same value, so a system looks the same each time it opens.
   */
  function sampleValue(field, idx, seed, today) {
    const id = String((field && field.id) || '').toLowerCase();
    const r = rand(`${seed}|${id}`, idx);
    const r2 = rand(`${seed}|${id}|b`, idx);
    const type = field && field.type;

    if (type === 'select') {
      const opts = Array.isArray(field.options) && field.options.length ? field.options : ['Open', 'In progress', 'Done'];
      return opts[Math.floor(r * opts.length)];
    }
    if (type === 'date') return daysBefore(today, Math.floor(r * 180));
    if (type === 'number') {
      if (/qty|quantity|units|count|guests|seats|size|capacity|stock/.test(id)) return 1 + Math.floor(r * 40);
      if (/percent|pct|rate|score|rating/.test(id)) return Math.round(40 + r * 60);
      if (/price|fee/.test(id)) return Math.round((5 + r * 95) * 100) / 100;
      if (/salary|wage/.test(id)) return Math.round(2000 + r * 6000) * 12;
      return Math.round(r * 1000 * 100) / 100;
    }

    // Text. Only kinds of value that belong to any business get a real-looking
    // stand-in; anything particular to a business is named for what it is.
    const person = () => `${pick(FIRST, r)} ${pick(LAST, r2)}`;
    if (/email/.test(id)) return `${pick(FIRST, r).toLowerCase()}.${pick(LAST, r2).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@example.com`;
    if (/phone|mobile|tel/.test(id)) return `+1 555 ${String(100 + Math.floor(r * 900))} ${String(1000 + Math.floor(r2 * 9000))}`;
    if (/(^|_)(city|location|region)(_|$)/.test(id)) return pick(CITIES, r);
    if (/supplier|vendor|company|organi[sz]ation|client|customer_company|account_name/.test(id)) return `${pick(COMPANY_A, r)} ${pick(COMPANY_B, r2)}`;
    if (/(^|_)(name|full_name|contact|owner|assignee|assigned_to|manager|staff|employee|customer|guest|patient|student|member|driver|agent)(_|$)/.test(id)) return person();
    if (/(number|_no|_id|code|ref|sku)$/.test(id)) return `${id.replace(/_?(number|no|id|code|ref|sku)$/, '').slice(0, 3).toUpperCase() || 'REF'}-${String(1001 + idx)}`;
    return `${titleCase(field && (field.label || field.id)) || 'Item'} ${idx + 1}`;
  }

  /**
   * The date on the person's own calendar, as YYYY-MM-DD. toISOString() gives
   * UTC's, which east of Greenwich is still yesterday after midnight — the
   * same slip that once had every generated due date a day early there.
   */
  function localDay(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** A whole record of stand-ins. */
  function sampleRecord(entity, idx, today) {
    const out = { id: `${entity.id}_${idx + 1}` };
    for (const f of entity.fields || []) out[f.id] = sampleValue(f, idx, entity.id, today);
    return out;
  }

  window.HCSystemsSamples = { sampleValue, sampleRecord, daysBefore, localDay };
})();
