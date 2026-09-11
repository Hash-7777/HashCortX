// ==============================================================
// The books a generated business system is shown with
//
// A generated ERP is judged on whether its numbers hold together: anyone who
// knows accounting will add up the journal before they look at anything else.
// So this is not decoration. An invoice must equal its tax plus its subtotal,
// a payment must move the same amount out of receivables as it moves into
// cash, and every journal entry must balance.
//
// What is billed is the system's own sales (js/systems/books.js): each sale
// is one invoice for what it came to, tax included, and a settled one is paid.
// The invoices used to be made up from a size profile for the kind of
// business, so a restaurant with two small orders showed fifty invoices of
// ten thousand dollars. With no sales there are no books.
//
// Costs are the one thing the records do not say, so they are estimated from
// the revenue at the margins usual for the kind of business, and every cost
// row says it is an estimate.
//
// Pure: takes a spec and its sales, returns records. No DOM, no storage, no
// network. Anything not in the sales is seeded from the spec, so the same
// records always give the same books.
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

  /** Every month from the first to the last, as { key, date }, at most the last twelve. */
  function monthsBetween(first, last) {
    const out = [];
    let [y, m] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push({ key, date: `${key}-15` });
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out.slice(-12);
  }

  function buildFinancialData(spec, desc, deps) {
    const sales = (deps && Array.isArray(deps.sales) ? deps.sales : []).filter((e) => e && e.total > 0 && /^\d{4}-\d{2}/.test(e.date));
    if (!sales.length) return null;
    const today = (deps && deps.today) || "";
    const ENTITY = FINANCE_ENTITY_IDS();
    const profile = financeProfile(spec, desc);
    const currency = /egp|egypt|cairo/i.test(`${desc} ${spec.description}`) ? "EGP" : /eur|euro/i.test(`${desc} ${spec.description}`) ? "EUR" : "USD";
    const seed = `${spec.id}|${spec.name}|${profile.domain}`;
    const vendors = [...new Set(profile.vendors)].slice(0, 12);
    const months = monthsBetween(sales[0].date.slice(0, 7), sales[sales.length - 1].date.slice(0, 7));
    const billed = sales.filter((e) => e.date.slice(0, 7) >= months[0].key);
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
    // An opening balance, shown as the statement's first line so the running
    // balance can be followed from it: half a month's takings.
    const monthly = billed.reduce((s, e) => s + e.total, 0) / months.length;
    let runningBank = roundMoney(monthly * (0.4 + seededRand(seed, 1) * 0.2));
    bank.push({ id: "bank_1", transaction_id: "BNK-00001", transaction_date: `${months[0].key}-01`, description: "Opening balance", type: "Opening", amount: runningBank, balance: runningBank, status: "Reconciled" });

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
      invoiceTotals[month.key] = 0;
      paymentTotals[month.key] = 0;
      expenseTotals[month.key] = 0;

      billed.filter((e) => e.date.startsWith(month.key)).forEach((sale, j) => {
        const idx = invoices.length;
        const issueDate = sale.date;
        const invoiceNumber = `INV-${month.key.replace("-", "")}-${String(j + 1).padStart(3, "0")}`;
        // The sale's amount is what the customer pays, so it is the invoice's
        // total, and the tax is the part of it that is tax.
        const total = roundMoney(sale.total);
        const subtotal = roundMoney(total / (1 + profile.taxRate));
        const tax = roundMoney(total - subtotal);
        const dueDate = addDays(issueDate, 30);
        const paid = sale.settled ? total : 0;
        const balance = roundMoney(total - paid);
        const status = balance <= 0 ? "Paid" : today && dueDate < today ? "Overdue" : "Sent";
        const customer = sale.customer || "Walk-in customer";
        invoices.push({
          id:`invoice_${idx + 1}`,
          invoice_number:invoiceNumber,
          source:sale.ref,
          customer,
          issue_date:issueDate,
          due_date:dueDate,
          subtotal,
          tax,
          total,
          paid,
          balance,
          status,
        });
        invoiceTotals[month.key] += subtotal;
        invoiceLines.push({
          id:`line_${invoiceLines.length + 1}`,
          invoice_number:invoiceNumber,
          item:sale.description,
          quantity:1,
          unit_price:subtotal,
          line_total:subtotal,
          status:"Billed",
          date:issueDate,
        });

        postEntry(issueDate, invoiceNumber, [
          ["Accounts Receivable", total, 0],
          ["Revenue", 0, subtotal],
          ...(tax > 0 ? [["Sales Tax Payable", 0, tax]] : []),
        ]);

        if (paid > 0) {
          const later = addDays(issueDate, Math.floor(seededRand(seed + "paydate", idx) * 4));
          const paymentDate = today && later > today ? issueDate : later;
          payments.push({
            id:`payment_${payments.length + 1}`,
            payment_number:`PAY-${month.key.replace("-", "")}-${String(payments.length + 1).padStart(3, "0")}`,
            invoice_number:invoiceNumber,
            customer,
            payment_date:paymentDate,
            method:["Card","Cash","Bank Transfer","Card"][Math.floor(seededRand(seed + "method", idx) * 4)],
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
      });

      // Costs, estimated from the month's revenue at the margins usual for
      // the kind of business: the records say what was sold, not what it
      // cost. Every row says it is an estimate.
      const revenue = invoiceTotals[month.key];
      if (revenue <= 0) { bankAtMonthEnd[month.key] = runningBank; return; }
      const cogs = roundMoney(revenue * (1 - profile.grossMargin));
      const operating = [
        ["COGS", vendors[0] || "Supplier", cogs],
        ["Payroll", "Payroll", revenue * 0.2],
        ["Rent", vendors[3] || "Landlord", revenue * 0.07],
        ["Marketing", "Marketing", revenue * 0.04],
        ["Utilities", vendors[2] || "Utilities", revenue * 0.025],
      ];
      operating.forEach(([category, vendor, rawAmount], ei) => {
        const amount = roundMoney(rawAmount);
        if (amount <= 0) return;
        const expenseDate = `${month.key}-${String(6 + ei * 4).padStart(2, "0")}`;
        // Billed but not yet paid: the last month leaves one open, so the
        // payables figure is not always zero. Named once because it decides
        // three separate things — how the expense reads, whether it leaves the
        // bank, and which account the entry credits.
        const accrued = ei === 0 && mi === months.length - 1;
        expenses.push({
          id:`expense_${expenses.length + 1}`,
          expense_number:`EXP-${month.key.replace("-", "")}-${String(ei + 1).padStart(3, "0")}`,
          vendor,
          category,
          expense_date:expenseDate,
          amount,
          payment_status:accrued ? "Accrued" : "Paid",
          status:"Estimate",
        });
        expenseTotals[month.key] += amount;
        if (!accrued) {
          runningBank = roundMoney(runningBank - amount);
          bank.push({
            id:`bank_${bank.length + 1}`,
            transaction_id:`BNK-${String(bank.length + 1).padStart(5, "0")}`,
            transaction_date:expenseDate,
            description:`${category} - ${vendor} (estimate)`,
            type:"Withdrawal",
            amount:-amount,
            balance:runningBank,
            status:"Reconciled",
          });
        }
        postEntry(expenseDate, `${category} (estimate)`, [
          [category === "COGS" ? "Cost of Sales" : `${category} Expense`, amount, 0],
          [accrued ? "Accounts Payable" : "Cash", 0, amount],
        ], "Estimate");
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
      // The tax billed is owed until it is paid over, and the business began
      // with its opening balance. Both were made up: 8% of the tax, and 45%
      // of whatever cash happened to be left.
      ["2100","Sales Tax Payable","Liability",roundMoney(invoices.reduce((s, i) => s + i.tax, 0))],
      ["3000","Owner Equity","Equity",bank[0].balance],
      ["4000","Revenue","Revenue",roundMoney(summary.reduce((s, m) => s + m.revenue, 0))],
      ["5000","Cost of Sales","Cost of Sales",roundMoney(summary.reduce((s, m) => s + m.cost_of_sales, 0))],
      ["6100","Payroll Expense","Expense",roundMoney(expenses.filter(e => e.category === "Payroll").reduce((s, e) => s + e.amount, 0))],
      ["6200","Rent Expense","Expense",roundMoney(expenses.filter(e => e.category === "Rent").reduce((s, e) => s + e.amount, 0))],
      ["6300","Marketing Expense","Expense",roundMoney(expenses.filter(e => e.category === "Marketing").reduce((s, e) => s + e.amount, 0))],
      ["6400","Utilities Expense","Expense",roundMoney(expenses.filter(e => e.category === "Utilities").reduce((s, e) => s + e.amount, 0))],
    ].map(([code, name, type, balance], idx) => ({
      id:`acct_${code}`,
      account_code:code,
      name,
      type,
      balance:roundMoney(balance),
      status:"Active",
      updated:months[months.length - 1].date,
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
