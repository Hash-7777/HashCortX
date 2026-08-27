// ============================================================
// finance/amounts.js — reading money, and adding it up
//
// This mode reads somebody's own bank statement or ledger, and everything it
// then shows them rests on two things: whether a figure in a cell was read
// correctly, and whether it was counted as money in or money out. Both lived
// in a two-thousand-line file where nothing could hand them a figure and ask
// what they made of it.
//
// TWO WAYS OF WRITING A NUMBER THAT WERE BEING READ WRONGLY, both found by
// asking:
//
//   Accounting writes a negative in PARENTHESES. Every ledger, every
//   statement, every export from every accounting package puts a debit as
//   (500). That was read as positive five hundred — so a debit was counted as
//   income, and the totals came out inverted for anybody whose file used the
//   convention their accountant does.
//
//   Half the world writes 1.234,56 for what the other half writes 1,234.56.
//   Stripping everything that is not a digit or a dot turned the first into
//   1.23456 — out by a factor of a thousand, and quietly, because the answer
//   is still a plausible-looking number.
//
// What is deliberately NOT guessed at is a lone comma. "1,234" is a thousand
// two hundred in one convention and one-point-two in another, with nothing in
// the string to say which. It is read the English way, because that is what
// the rest of this app is written in, and a guess dressed as a rule is worse
// than a consistent choice.
//
// Pure: cells and rows in, numbers out. No DOM, no storage, no network.
//
// Run the checks with: npm run check:finance-amounts
// ============================================================
(function () {
  "use strict";

  /**
   * The number in a cell, or null when there is not one.
   *
   * Null and zero are kept apart on purpose. A blank cell is not a transaction
   * of nothing, and counting one as such would put an extra row into every
   * total that reads its own emptiness as a figure.
   */
  function parseAmount(cell) {
    const raw = String(cell ?? "").trim();
    if (!raw) return null;

    // Accounting's own minus sign. Checked before anything is stripped,
    // because stripping punctuation is what loses it.
    const bracketed = /^\(.*\)$/.test(raw) || /^-?[^\d]*\(.*\)/.test(raw);

    let body = raw.replace(/[^0-9.,\-]/g, "");

    // Both separators present: the LAST one is the decimal point, whichever
    // way round the writer's country puts them. This is the only case where
    // the string itself says which convention is in use.
    const lastDot = body.lastIndexOf(".");
    const lastComma = body.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      const decimalAt = Math.max(lastDot, lastComma);
      const whole = body.slice(0, decimalAt).replace(/[.,]/g, "");
      const fraction = body.slice(decimalAt + 1).replace(/[.,]/g, "");
      body = `${whole}.${fraction}`;
    } else {
      // A lone comma is read the English way — see the note at the top.
      body = body.replace(/,/g, "");
    }

    const n = parseFloat(body);
    if (Number.isNaN(n)) return null;
    return bracketed ? -Math.abs(n) : n;
  }

  function fmtKpi(n, currency) {
    const sym = (currency || "").replace(/[a-z]/gi, "") || "$";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
    return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function fmtKpiLike(n, existingVal, currency) {
    const hasSym = /[$€£¥₹]|^[A-Z]{2,3}\s/.test(String(existingVal || ""));
    if (!hasSym) {
      /* plain format — no symbol, compact K/M suffix */
      const a = Math.abs(n), sign = n < 0 ? "-" : "";
      if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
      if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
      return `${sign}${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    }
    return fmtKpi(n, currency);
  }

  function recalcFromTable(report) {
    const t = report.table;
    if (!t?.headers?.length || !t?.rows?.length) return false;

    const H = t.headers.map(h => String(h).toLowerCase().trim());

    /* ── amount column ── */
    const amtIdx = (() => {
      let idx = H.findIndex(h => /\bamount\b|\btotal\b|\bsum\b|\bcost\b|\bprice\b|\bspend\b|\bvalue\b/i.test(h));
      if (idx >= 0) return idx;
      for (let ci = H.length - 1; ci >= 0; ci--) {
        if (t.rows.some(r => parseAmount(r[ci]) !== null)) return ci;
      }
      return -1;
    })();
    if (amtIdx === -1) return false;

    /* ── type column ── */
    const typeIdx = H.findIndex(h => /\btype\b|\bdirection\b|\bcr[\/.\\-]?dr\b/i.test(h));

    /* ── category column — with description/item as fallback ──
       This prevents everything collapsing to "Other" when the AI
       didn't generate a dedicated "Category" column. */
    const catIdx  = H.findIndex(h => /\bcat(egory)?\b/i.test(h));
    const descIdx = H.findIndex(h =>
      /\bdesc(ription)?\b|\bitem\b|\bname\b|\bmerchant\b|\bpayee\b|\bnote\b/i.test(h));
    /* effectiveCatIdx: category > description > nothing */
    const effectiveCatIdx = catIdx >= 0 ? catIdx : descIdx;

    let income = 0, expenses = 0;
    const catMap = {};

    t.rows.forEach(row => {
      const amt = parseAmount(row[amtIdx]);
      if (amt === null || amt === 0) return;

      const typeCell = String(row[typeIdx >= 0 ? typeIdx : -1] ?? "").toLowerCase();
      /* Also scan the description/name cell for income keywords */
      const descCell = String(row[descIdx >= 0 ? descIdx : -1] ?? "").toLowerCase();
      /* Use effectiveCatIdx so each item keeps its own label instead of "Other" */
      const cat = String(row[effectiveCatIdx >= 0 ? effectiveCatIdx : -1] ?? "").trim() || "Other";

      const absAmt = Math.abs(amt);

      /* Classify: explicit negative → expense; type/desc word match → income or expense */
      const isExp = amt < 0
        || /debit|expense|out\b|dr\b|spend|cost|purchase|fee/i.test(typeCell);
      const isInc = !isExp && amt > 0 && (
        /credit|income|in\b|cr\b/i.test(typeCell) ||
        /salary|payroll|wages|income|revenue|deposit|bonus|dividend|refund/i.test(descCell)
      );

      if (isInc) {
        income += absAmt;
      } else {
        expenses += absAmt;
        catMap[cat] = (catMap[cat] || 0) + absAmt;
      }
    });

    const netFlow  = income > 0 ? income - expenses : null;
    const savRate  = income > 0 ? ((income - expenses) / income) * 100 : null;
    const expRatio = income > 0 ? (expenses / income) * 100 : null;
    const cur      = report.currency || "";

    let changed = false;
    (report.kpis || []).forEach(kpi => {
      const lbl = kpi.label.toLowerCase();
      let newVal = null, newPos = kpi.positive;

      if (/total.*expense|expense.*total|\bspend(ing)?\b|\bexpenses\b/i.test(lbl) && expenses > 0)
        { newVal = fmtKpiLike(expenses, kpi.value, cur); newPos = false; }
      else if (income > 0 && /income|salary|revenue|earning/i.test(lbl))
        { newVal = fmtKpiLike(income, kpi.value, cur);   newPos = true; }
      else if (netFlow !== null && /net.*cash|cash.*flow|net.*income|net.*balance|net.*saving/i.test(lbl))
        { newVal = fmtKpiLike(netFlow, kpi.value, cur);  newPos = netFlow >= 0; }
      else if (savRate !== null && /saving.*rate|savings.*rate/i.test(lbl))
        { newVal = savRate.toFixed(1) + "%"; newPos = savRate >= 0; }
      else if (expRatio !== null && /ratio|expense.*income/i.test(lbl))
        { newVal = expRatio.toFixed(1) + "%"; newPos = expRatio <= 50; }

      if (newVal !== null && newVal !== kpi.value) {
        kpi.value = newVal; kpi.positive = newPos; kpi.estimated = false; changed = true;
      }
    });

    /* ── rebuild donut from category map ──
       Only replace if we have real per-item categories (i.e. effectiveCatIdx was
       found). If all we can produce is one big "Other" slice, keep the
       AI-generated donut untouched. */
    const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const hasRealCats = cats.length >= 2 || (cats.length === 1 && cats[0][0] !== "Other");
    if (hasRealCats) {
      const donut = (report.charts || []).find(c => c.type === "donut");
      if (donut) {
        donut.labels   = cats.map(([k]) => k);
        donut.datasets = [{ ...(donut.datasets?.[0] || {}), values: cats.map(([, v]) => v) }];
        changed = true;
      }
      /* Update category-style bar charts too */
      const catBar = (report.charts || []).find(c =>
        c.type === "bar" && c.datasets?.length === 1 &&
        /categor|spend|expense|breakdown/i.test(c.title || ""));
      if (catBar) {
        catBar.labels   = cats.map(([k]) => k);
        catBar.datasets = [{ ...(catBar.datasets?.[0] || {}), values: cats.map(([, v]) => v) }];
        changed = true;
      }
    }

    return changed;
  }

  window.HCFinanceAmounts = { parseAmount, fmtKpi, fmtKpiLike, recalcFromTable };
})();
