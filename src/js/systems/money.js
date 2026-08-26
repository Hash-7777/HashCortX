// ============================================================
// systems/money.js — the arithmetic under a generated business system
//
// Every invoice total, every due date and every sample figure in the ERP mode
// comes out of a handful of small functions that lived in a four-thousand-line
// file with nothing able to check them. Small is not the same as obviously
// right, and one of them was not right at all: see the note on `addDays`.
//
// Pure: numbers and strings in, numbers and strings out. The clock is passed
// in rather than read, so "the last twelve months" can be asked about a month
// that is not this one.
//
// Run the checks with: npm run check:systems-money
// ============================================================
(function () {
  "use strict";

  /**
   * A number between 0 and 1 that is the same every time for the same seed.
   *
   * Sample data has to look varied and be identical on every reload — a table
   * whose figures change each time the page opens looks like the app losing
   * the data rather than like a demonstration.
   */
  function seededRand(seed, idx) {
    let h = 0;
    const text = String(seed ?? "");
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    h = (h + Math.trunc(Number(idx) || 0) * 2654435761) | 0;
    // Clamped below one so a caller multiplying by a list length can never
    // index past its end.
    return Math.min(0.999999, Math.abs(h) / 2147483647);
  }

  /** Money, to the penny. */
  function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /**
   * A date, some days later. Done entirely in UTC, and that is the fix.
   *
   * This used to read `new Date(iso + "T00:00:00")`, which is parsed as LOCAL
   * midnight, and then hand the result to `toISOString`, which converts to
   * UTC. For anyone east of Greenwich local midnight is the previous day in
   * UTC, so the date came back a day early — `addDays("2026-01-10", 0)`
   * returned the ninth in Cairo and in Tokyo, and the tenth in London.
   *
   * Every due date, invoice date and delivery date in every generated system
   * was a day out for most of the world, and consistently enough that it
   * looked deliberate. Reading a date, moving it and writing it back must
   * happen in one clock, and UTC is the only one that does not move.
   */
  function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return String(iso || "");
    d.setUTCDate(d.getUTCDate() + (Math.trunc(Number(days)) || 0));
    return d.toISOString().slice(0, 10);
  }

  /**
   * The months up to and including this one, oldest first.
   *
   * `today` is passed in so a check can ask about a month that is not the one
   * it happens to be run in — a function that consults the clock answers
   * differently in December than in January, and a check that only passes in
   * one of them is worse than none.
   *
   * Built from the calendar rather than by subtracting days, so a month is a
   * month whatever its length and whatever daylight saving did.
   */
  function recentMonths(count = 12, today = new Date()) {
    const out = [];
    // A count that is not a positive number means none was given, whether it
    // arrived as zero, as minus five or as a word. Treating minus five as one
    // month and zero as twelve is two answers to one situation.
    const asked = Math.trunc(Number(count));
    const n = Math.min(240, Number.isFinite(asked) && asked > 0 ? asked : 12);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n + 1, 1));
    for (let i = 0; i < n; i++) {
      const y = start.getUTCFullYear();
      const m = String(start.getUTCMonth() + 1).padStart(2, "0");
      // The fifteenth: a date inside every month whatever its length, so a
      // month's marker never lands in the one before or after it.
      out.push({ key: `${y}-${m}`, date: `${y}-${m}-15` });
      start.setUTCMonth(start.getUTCMonth() + 1);
    }
    return out;
  }

  /**
   * An identifier no other module in the system is already using.
   *
   * Takes the identifiers rather than the whole system, so what it needs is
   * what it is given.
   */
  function uniqueModuleId(taken, raw, slug) {
    const used = new Set(Array.isArray(taken) ? taken : []);
    const toId = typeof slug === "function" ? slug : (s) => String(s || "module");
    const base = toId(raw, "module");
    let id = base;
    let i = 2;
    while (used.has(id)) id = `${base}_${i++}`;
    return id;
  }

  window.HCSystemsMoney = { seededRand, roundMoney, addDays, recentMonths, uniqueModuleId };
})();
