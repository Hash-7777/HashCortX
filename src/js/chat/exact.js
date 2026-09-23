// ============================================================
// chat/exact.js — whole-number arithmetic, worked out exactly
//
// The calculate tool works in the numbers every script uses, which hold
// whole numbers exactly only up to about nine thousand million million. Past
// that the last digits are rounded, and the tool handed the rounding back as
// the answer: 2**61 - 1 came back ending in zeros, and a model read it out
// as fact.
//
// An expression made only of whole numbers is worked out here with numbers of
// any size, so it comes back exact: + - * ** %, division only where it comes
// out whole, factorial, brackets, and the days between two dates written
// days(2026-03-03, 2026-07-19). Anything else — a decimal, a function,
// a division with a remainder — is not answered here and goes to the ordinary
// arithmetic. A result too large to be worth printing is refused rather than
// computed for minutes.
//
// Pure. Published as window.HCExact. Checked by scripts/checks/exact.mjs.
// ============================================================
(function () {
  "use strict";

  const MAX_DIGITS = 4000;
  const MAX_FACTORIAL = 1000;

  /** The days from one date to another, each written year-month-day, or null for a date that does not exist. */
  function daysBetween(a, b) {
    const utc = ([y, m, d]) => {
      const t = Date.UTC(y, m - 1, d);
      const back = new Date(t);
      return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : null;
    };
    const ta = utc(a);
    const tb = utc(b);
    return ta === null || tb === null ? null : Math.round((tb - ta) / 86400000);
  }

  /** days(2026-03-03, 2026-07-19) replaced by the days between, so a date difference is exact too. */
  function withDays(text) {
    return String(text || "").replace(/\bdays\(\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*,\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*\)/gi, (m, y1, m1, d1, y2, m2, d2) => {
      const n = daysBetween([+y1, +m1, +d1], [+y2, +m2, +d2]);
      return n === null ? "(bad date)" : n < 0 ? `(0 - ${-n})` : String(n);
    });
  }

  function tokens(text) {
    const out = [];
    const rx = /\s*(\d+|\*\*|[-+*/%()!^])/y;
    let at = 0;
    const src = withDays(text).replace(/(\d)[_,](?=\d{3}\b)/g, "$1");
    while (at < src.length) {
      rx.lastIndex = at;
      const m = rx.exec(src);
      if (!m) return /^\s*$/.test(src.slice(at)) ? out : null;
      out.push(m[1] === "^" ? "**" : m[1]);
      at = rx.lastIndex;
    }
    return out;
  }

  const digits = (n) => (n < 0n ? -n : n).toString().length;

  /**
   * The exact value of a whole-number expression, as a string, or null when
   * it is not one this can answer exactly.
   */
  function integer(expression) {
    const list = tokens(expression);
    if (!list || !list.length || !list.some((t) => /^\d/.test(t))) return null;
    let i = 0;
    const peek = () => list[i];
    const take = () => list[i++];
    const fail = () => { throw new Error("not exact"); };

    function primary() {
      const t = take();
      if (t === undefined) fail();
      if (t === "(") { const v = sum(); if (take() !== ")") fail(); return postfix(v); }
      if (t === "-") return -power();
      if (t === "+") return power();
      if (/^\d+$/.test(t)) return postfix(BigInt(t));
      return fail();
    }
    function postfix(v) {
      while (peek() === "!") {
        take();
        if (v < 0n || v > BigInt(MAX_FACTORIAL)) fail();
        let r = 1n;
        for (let k = 2n; k <= v; k++) r *= k;
        v = r;
      }
      return v;
    }
    function power() {
      const base = primary();
      if (peek() !== "**") return base;
      take();
      const exp = power();
      if (exp < 0n) fail();
      if (base !== 0n && base !== 1n && base !== -1n && Number(exp) * digits(base) > MAX_DIGITS * 1.1) fail();
      return base ** exp;
    }
    function product() {
      let v = power();
      while (["*", "/", "%"].includes(peek())) {
        const op = take();
        const r = power();
        if (op === "*") v *= r;
        else if (r === 0n) fail();
        else if (op === "%") v %= r;
        else if (v % r !== 0n) fail();
        else v /= r;
        if (digits(v) > MAX_DIGITS) fail();
      }
      return v;
    }
    function sum() {
      let v = product();
      while (peek() === "+" || peek() === "-") v = take() === "+" ? v + product() : v - product();
      return v;
    }

    try {
      const v = sum();
      if (i !== list.length || digits(v) > MAX_DIGITS) return null;
      return v.toString();
    } catch {
      return null;
    }
  }

  window.HCExact = { integer, daysBetween, MAX_DIGITS };
})();
