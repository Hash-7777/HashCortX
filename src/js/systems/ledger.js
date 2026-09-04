// ==============================================================
// The books a generated business system is shown with
//
// A generated ERP is judged on whether its numbers hold together: anyone who
// knows accounting will add up the journal before they look at anything else.
// So this is not decoration. An invoice must equal its tax plus its subtotal,
// a payment must move the same amount out of receivables as it moves into
// cash, and every journal entry must balance.
//
// Pure: takes a spec, returns records. No DOM, no storage, no network. The
// figures are seeded from the spec, so the same system always gets the same
// books.
//
// Loaded before the Systems mode and published as window.HCSystemsLedger.
// Checked by scripts/checks/systems-ledger.mjs.
// ==============================================================

(function () {
  'use strict';

  const MONEY = () => window.HCSystemsMoney;
  const DOMAIN = () => window.HCSystemsDomain;
  const seededRand = (seed, idx) => MONEY().seededRand(seed, idx);
  const roundMoney = (n) => MONEY().roundMoney(n);
  const addDays = (iso, days) => MONEY().addDays(iso, days);
  const recentMonths = (count = 12) => MONEY().recentMonths(count);
  const financeProfile = (spec, desc) => DOMAIN().financeProfile(spec, desc);
  const financeFields = (currency) => DOMAIN().financeFields(currency);
  const FINANCE_ENTITY_IDS = () => DOMAIN().FINANCE_ENTITY_IDS;

  /** The most journal rows a generated system is shown with. */
  const MAX_JOURNAL_ROWS = 240;

  /** Journal rows gathered into the entries they belong to, in order. */
  function groupByEntry(rows) {
    const out = [];
    const at = new Map();
    for (const row of rows) {
      if (!at.has(row.journal_id)) { at.set(row.journal_id, out.length); out.push([]); }
      out[at.get(row.journal_id)].push(row);
    }
    return out;
  }

  function buildFinancialData(spec, desc, deps) {
    const collectBusinessNames = deps && deps.collectBusinessNames
      ? deps.collectBusinessNames
      : () => [];
    const ENTITY = FINANCE_ENTITY_IDS();
    const profile = financeProfile(spec, desc);
    const currency = /egp|egypt|cairo/i.test(`${desc} ${spec.description}`) ? "EGP" : /eur|euro/i.test(`${desc} ${spec.description}`) ? "EUR" : "USD";
    const seed = `${spec.id}|${spec.name}|${profile.domain}`;
    const customers = [...new Set([...collectBusinessNames(spec, /customer|client|guest|patient|member|student|company|name/i), ...profile.customers])].slice(0, 18);
    const vendors = [...new Set(profile.vendors)].slice(0, 12);
    const months = recentMonths(12);
    const items = ["Core service", "Premium package", "Implementation", "Monthly retainer", "Usage fees", "Support plan"];
    const invoices = [];
    const invoiceLines = [];
    const payments = [];
    const expenses = [];
    const journal = [];
    const bank = [];
    const summary = [];
    /** What the bank ledger stood at when each month closed. */
    const bankAtMonthEnd = {};
    const invoiceTotals = {};
    const paymentTotals = {};
    const expenseTotals = {};
    let runningBank = roundMoney(profile.baseRevenue * (0.38 + seededRand(seed, 1) * 0.32));

    // One entry per transaction, whatever it takes to record it.
    //
    // The entry number used to be worked out from the row count, as one entry
    // for every two rows. Most transactions are two rows, but an invoice that
    // carries tax is three — receivable, revenue, tax — so the numbering ran a
    // row behind from the first taxed invoice onwards, splitting entries in
    // half and joining each half to a neighbour. Ninety of a hundred and
    // twenty entries then had debits that did not equal their credits, which
    // is the first thing anyone reading a ledger checks.
    let entryCount = 0;
    const postEntry = (date, source, lines, status = "Posted") => {
      entryCount += 1;
      const journalId = `JE-${String(entryCount).padStart(5, "0")}`;
      for (const [account, debit, credit] of lines) {
        journal.push({
          id: `jrnl_${journal.length + 1}`,
          journal_id: journalId,
          entry_date: date,
          account,
          source,
          debit: roundMoney(debit),
          credit: roundMoney(credit),
          status,
        });
      }
    };

    months.forEach((month, mi) => {
      const season = 0.82 + seededRand(seed + "season", mi) * 0.44;
      const invoiceCount = 3 + Math.floor(seededRand(seed + "invoice-count", mi) * 3);
      invoiceTotals[month.key] = 0;
      paymentTotals[month.key] = 0;
      expenseTotals[month.key] = 0;

      for (let j = 0; j < invoiceCount; j++) {
        const idx = invoices.length;
        const issueDate = `${month.key}-${String(4 + j * 6).padStart(2, "0")}`;
        const invoiceNumber = `INV-${month.key.replace("-", "")}-${String(j + 1).padStart(3, "0")}`;
        const subtotal = roundMoney((profile.baseRevenue * season / invoiceCount) * (0.72 + seededRand(seed + "invoice", idx) * 0.68));
        const tax = roundMoney(subtotal * profile.taxRate);
        const total = roundMoney(subtotal + tax);
        // How much of this invoice has been collected, by how old it is.
        //
        // Every invoice used to draw from the same table whatever its age, and
        // a quarter of that table is never paid at all — so a quarter of a
        // year's billing stayed uncollected for ever while expenses went out
        // in full. The company then showed a profit every month and ran its
        // cash down to a large negative all the same, with receivables growing
        // without limit: a set of books that reads as broken to anyone who
        // knows what they are looking at. Older invoices now settle, and only
        // recent ones are still outstanding.
        const monthsAgo = months.length - 1 - mi;
        const paidRatio = monthsAgo >= 2
          ? 1
          : monthsAgo === 1
            ? [1, 1, 1, 0.65][Math.floor(seededRand(seed + "paid", idx) * 4)]
            : [1, 1, 0.65, 0][Math.floor(seededRand(seed + "paid", idx) * 4)];
        const paid = roundMoney(total * paidRatio);
        const balance = roundMoney(total - paid);
        const status = balance <= 0 ? "Paid" : paid > 0 ? "Partially Paid" : mi < months.length - 1 ? "Overdue" : "Sent";
        const customer = customers[idx % customers.length] || "Business Customer";
        invoices.push({
          id:`invoice_${idx + 1}`,
          invoice_number:invoiceNumber,
          customer,
          issue_date:issueDate,
          due_date:addDays(issueDate, 30),
          subtotal,
          tax,
          total,
          paid,
          balance,
          status,
        });
        invoiceTotals[month.key] += subtotal;

        const lineA = roundMoney(subtotal * (0.58 + seededRand(seed + "line-a", idx) * 0.14));
        const lineB = roundMoney(subtotal - lineA);
        [lineA, lineB].forEach((lineTotal, li) => {
          const quantity = 1 + Math.floor(seededRand(seed + "qty", idx + li) * 4);
          invoiceLines.push({
            id:`line_${invoiceLines.length + 1}`,
            invoice_number:invoiceNumber,
            item:items[(idx + li) % items.length],
            quantity,
            unit_price:roundMoney(lineTotal / quantity),
            line_total:lineTotal,
            status:"Billed",
            date:issueDate,
          });
        });

        postEntry(issueDate, invoiceNumber, [
          ["Accounts Receivable", total, 0],
          ["Revenue", 0, subtotal],
          ...(tax > 0 ? [["Sales Tax Payable", 0, tax]] : []),
        ]);

        if (paid > 0) {
          const paymentDate = addDays(issueDate, 8 + Math.floor(seededRand(seed + "paydate", idx) * 24));
          payments.push({
            id:`payment_${payments.length + 1}`,
            payment_number:`PAY-${month.key.replace("-", "")}-${String(payments.length + 1).padStart(3, "0")}`,
            invoice_number:invoiceNumber,
            customer,
            payment_date:paymentDate,
            method:["Bank Transfer","Card","ACH","Check"][Math.floor(seededRand(seed + "method", idx) * 4)],
            amount:paid,
            status:"Reconciled",
          });
          paymentTotals[month.key] += paid;
          runningBank = roundMoney(runningBank + paid);
          bank.push({
            id:`bank_${bank.length + 1}`,
            transaction_id:`BNK-${String(bank.length + 1).padStart(5, "0")}`,
            transaction_date:paymentDate,
            description:`Payment ${invoiceNumber}`,
            type:"Deposit",
            amount:paid,
            balance:runningBank,
            status:"Reconciled",
          });
          postEntry(paymentDate, `Payment ${invoiceNumber}`, [
            ["Cash", paid, 0],
            ["Accounts Receivable", 0, paid],
          ]);
        }
      }

      const revenue = invoiceTotals[month.key];
      const cogs = roundMoney(revenue * (1 - profile.grossMargin));
      const operating = [
        ["COGS", vendors[0] || "Supplier", cogs],
        ["Payroll", "Payroll Processor", revenue * (0.16 + seededRand(seed + "payroll", mi) * 0.06)],
        ["Rent", "Facilities Vendor", profile.baseRevenue * 0.055],
        ["Marketing", "Growth Channel", revenue * (0.035 + seededRand(seed + "mkt", mi) * 0.03)],
        ["Software", "Cloud Services", profile.baseRevenue * 0.025],
        ["Utilities", "Utility Provider", profile.baseRevenue * 0.018],
      ];
      operating.forEach(([category, vendor, rawAmount], ei) => {
        const amount = roundMoney(rawAmount);
        const expenseDate = `${month.key}-${String(6 + ei * 3).padStart(2, "0")}`;
        // Billed but not yet paid: the last month leaves a few open, so the
        // payables figure is not always zero. Named once because it decides
        // three separate things — how the expense reads, whether it leaves the
        // bank, and which account the entry credits.
        const accrued = ei % 5 === 0 && mi === months.length - 1;
        expenses.push({
          id:`expense_${expenses.length + 1}`,
          expense_number:`EXP-${month.key.replace("-", "")}-${String(ei + 1).padStart(3, "0")}`,
          vendor,
          category,
          expense_date:expenseDate,
          amount,
          payment_status:accrued ? "Accrued" : "Paid",
          status:accrued ? "Approved" : "Paid",
        });
        expenseTotals[month.key] += amount;
        if (!accrued) {
          runningBank = roundMoney(runningBank - amount);
          bank.push({
            id:`bank_${bank.length + 1}`,
            transaction_id:`BNK-${String(bank.length + 1).padStart(5, "0")}`,
            transaction_date:expenseDate,
            description:`${category} - ${vendor}`,
            type:"Withdrawal",
            amount:-amount,
            balance:runningBank,
            status:"Reconciled",
          });
        }
        postEntry(expenseDate, category, [
          [category === "COGS" ? "Cost of Sales" : `${category} Expense`, amount, 0],
          [accrued ? "Accounts Payable" : "Cash", 0, amount],
        ]);
      });
      bankAtMonthEnd[month.key] = runningBank;
    });

    // Cash comes from the bank ledger rather than being worked out a second
    // time.
    //
    // It used to be its own running total, opening at a different figure from
    // the bank's and subtracting every expense including the ones marked
    // unpaid, which the bank correctly leaves alone. So the statement and the
    // reported cash balance disagreed — on a sample company by more than forty
    // thousand — and an ERP whose bank statement contradicts its own summary
    // is not one anybody would trust with a real number.
    let cash = 0;
    months.forEach((month, mi) => {
      const revenue = roundMoney(invoiceTotals[month.key] || 0);
      const costOfSales = roundMoney(revenue * (1 - profile.grossMargin));
      const operatingExpenses = roundMoney((expenseTotals[month.key] || 0) - costOfSales);
      const grossProfit = roundMoney(revenue - costOfSales);
      const netProfit = roundMoney(grossProfit - operatingExpenses);
      const ar = roundMoney(invoices.filter(i => i.issue_date.startsWith(month.key)).reduce((s, i) => s + i.balance, 0));
      const ap = roundMoney(expenses.filter(e => e.expense_date.startsWith(month.key) && e.payment_status !== "Paid").reduce((s, e) => s + e.amount, 0));
      cash = roundMoney(bankAtMonthEnd[month.key] ?? cash);
      summary.push({
        id:`fin_${mi + 1}`,
        month:month.date,
        revenue,
        cost_of_sales:costOfSales,
        gross_profit:grossProfit,
        operating_expenses:operatingExpenses,
        net_profit:netProfit,
        cash_balance:cash,
        accounts_receivable:ar,
        accounts_payable:ap,
        status:mi < months.length - 1 ? "Closed" : "Review",
      });
    });

    // Only whole entries are shown. Cutting at a fixed row would take half of
    // one, and half an entry is an entry whose debits do not equal its
    // credits — the same fault as before, arriving by a different route.
    const journalShown = [];
    for (const rows of groupByEntry(journal)) {
      if (journalShown.length + rows.length > MAX_JOURNAL_ROWS) break;
      journalShown.push(...rows);
    }

    const last = summary[summary.length - 1] || {};
    const fields = financeFields(currency);
    const accounts = [
      ["1000","Cash","Asset",last.cash_balance || 0],
      ["1100","Accounts Receivable","Asset",last.accounts_receivable || 0],
      ["2000","Accounts Payable","Liability",last.accounts_payable || 0],
      ["2100","Sales Tax Payable","Liability",roundMoney(invoices.reduce((s, i) => s + i.tax, 0) * .08)],
      ["3000","Owner Equity","Equity",roundMoney((last.cash_balance || 0) * .45)],
      ["4000","Revenue","Revenue",roundMoney(summary.reduce((s, m) => s + m.revenue, 0))],
      ["5000","Cost of Sales","Cost of Sales",roundMoney(summary.reduce((s, m) => s + m.cost_of_sales, 0))],
      ["6100","Payroll Expense","Expense",roundMoney(expenses.filter(e => e.category === "Payroll").reduce((s, e) => s + e.amount, 0))],
      ["6200","Rent Expense","Expense",roundMoney(expenses.filter(e => e.category === "Rent").reduce((s, e) => s + e.amount, 0))],
      ["6300","Marketing Expense","Expense",roundMoney(expenses.filter(e => e.category === "Marketing").reduce((s, e) => s + e.amount, 0))],
    ].map(([code, name, type, balance], idx) => ({
      id:`acct_${code}`,
      account_code:code,
      name,
      type,
      balance:roundMoney(balance),
      status:"Active",
      updated:months[months.length - 1]?.date || new Date().toISOString().slice(0, 10),
    }));

    return {
      fields,
      data: {
        [ENTITY.accounts]: accounts,
        [ENTITY.invoices]: invoices,
        [ENTITY.invoiceLines]: invoiceLines,
        [ENTITY.payments]: payments,
        [ENTITY.expenses]: expenses,
        [ENTITY.journal]: journalShown,
        [ENTITY.bank]: bank.slice(0, 180),
        [ENTITY.summary]: summary,
      },
      currency,
    };
  }

  window.HCSystemsLedger = { buildFinancialData };
})();
