import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Transpile the real export-document builder and exercise it without a browser.
const source = readFileSync(new URL("../src/lib/export-documents.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, console });
const {
  buildContributionsCsv,
  buildContributionsReportHtml,
  buildMemberStatementCsv,
  buildMemberStatementHtml,
  computeStatementMetrics,
  csvCell,
  formatDay,
  periodSelectionError,
  repaymentStatusLabel,
  resolvePeriod,
  statementFileName,
  summariseContributions,
} = module.exports;

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const CONTRIBUTION_ROWS = [
  {
    memberName: "Jane Wanjiru",
    phone: "0712345678",
    email: "jane@example.com",
    amount: 5000,
    date: "2026-02-10",
    method: "mpesa",
    reference: "QK12345678",
    status: "confirmed",
    confirmedBy: "Treasurer Mary",
    confirmedAt: "2026-02-11T09:30:00.000Z",
    officerEntry: true,
    notes: 'February, "monthly" contribution',
  },
  {
    memberName: "Peter Kamau",
    phone: "0723456789",
    email: "",
    amount: 2500,
    date: "2026-03-01",
    method: "bank",
    reference: "",
    status: "pending",
    confirmedBy: "",
    confirmedAt: null,
    officerEntry: false,
    notes: "",
  },
];

const MEMBER_DATA = {
  profile: {
    full_name: "Jane Wanjiru",
    email: "jane@example.com",
    phone_number: "0712345678",
    created_at: "2024-05-06T10:00:00.000Z",
    status: "approved",
  },
  contributions: [
    {
      amount: 5000,
      contributed_on: "2026-02-10",
      method: "mpesa",
      reference: "QK12345678",
      mpesa_transaction_id: null,
      status: "confirmed",
      notes: null,
      on_behalf_of: false,
    },
    {
      amount: 2500,
      contributed_on: "2026-03-01",
      method: "mpesa",
      reference: "QK87654321",
      mpesa_transaction_id: null,
      status: "pending",
      notes: null,
      on_behalf_of: false,
    },
  ],
  loans: [
    {
      id: "loan-1",
      loan_type: "project",
      amount: 50000,
      repayment_months: 10,
      status: "approved",
      purpose: "Seed capital",
      created_at: "2025-11-01T08:00:00.000Z",
    },
    {
      id: "loan-2",
      loan_type: "emergency",
      amount: 10000,
      repayment_months: 5,
      status: "submitted",
      purpose: "Medical",
      created_at: "2026-08-01T08:00:00.000Z",
    },
  ],
  repayments: [
    {
      loan_id: "loan-1",
      installment_number: 1,
      due_date: "2025-12-01",
      amount_due: 5000,
      amount_paid: 5000,
      status: "paid",
      payment_status: "confirmed",
      paid_at: "2025-11-28T09:00:00.000Z",
    },
    {
      loan_id: "loan-1",
      installment_number: 2,
      due_date: "2026-01-01",
      amount_due: 5000,
      amount_paid: 2000,
      status: "overdue",
      payment_status: "not_paid",
      paid_at: null,
    },
  ],
};

const ALL_TIME = resolvePeriod({ key: "all" }, new Date("2026-09-17T00:00:00Z"));
const ALL_SECTIONS = { contributions: true, loans: true, repayments: true, balance: true };

/* ── Formatting ───────────────────────────────────────────────────────── */

test("formatDay renders DD/MM/YYYY for dates and timestamps", () => {
  assert.equal(formatDay("2026-02-10"), "10/02/2026");
  assert.equal(formatDay("2026-02-10T09:30:00.000Z"), "10/02/2026");
  assert.equal(formatDay(null), "");
  assert.equal(formatDay("not-a-date"), "");
});

test("csvCell quotes only when the value needs it", () => {
  assert.equal(csvCell("Jane Wanjiru"), "Jane Wanjiru");
  assert.equal(csvCell('February, "monthly"'), '"February, ""monthly"""');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(5000), "5000");
});

/* ── Contributions report ─────────────────────────────────────────────── */

test("contributions CSV carries the foundation header, columns and totals", () => {
  const csv = buildContributionsCsv(CONTRIBUTION_ROWS, {
    scopeLabel: "All statuses",
    generatedAt: new Date("2026-09-17T00:00:00Z"),
  });
  const lines = csv.trimEnd().split("\n");

  assert.equal(lines[0], "MURAGE FOUNDATION - CONTRIBUTIONS REPORT");
  assert.equal(lines[1], "Generated: 17/09/2026");
  assert.equal(lines[2], "Paybill: 522522 | Account: 7989164");
  assert.equal(lines[3], "");
  assert.equal(lines[4], "Filter: All statuses");
  assert.equal(
    lines[5],
    "No,Member Name,Phone Number,Email,Amount (KES),Date,Method,M-Pesa Reference,Status,Confirmed By,Confirmed Date,Officer Entry,Notes",
  );

  // Data rows: numbers in the amount cell, DD/MM/YYYY dates, capitalised status.
  assert.match(lines[6], /^1,Jane Wanjiru,0712345678,jane@example\.com,5000,10\/02\/2026,M-Pesa,/);
  assert.match(lines[6], /,Confirmed,Treasurer Mary,11\/02\/2026,Yes,/);
  assert.match(lines[7], /,Pending,,,No,$/);

  assert.ok(csv.includes("Total Confirmed Contributions,,,,5000"));
  assert.ok(csv.includes("Total Pending,,,,2500"));
  assert.ok(csv.includes("Total Contributions,,,,2"));
  assert.ok(csv.includes("Report generated by Murage Foundation Treasury"));
});

test("contributions summary splits confirmed, pending and rejected", () => {
  const totals = summariseContributions([
    ...CONTRIBUTION_ROWS,
    { ...CONTRIBUTION_ROWS[0], status: "rejected", amount: 100 },
  ]);
  assert.equal(totals.count, 3);
  assert.equal(totals.confirmedTotal, 5000);
  assert.equal(totals.pendingTotal, 2500);
  assert.equal(totals.rejectedTotal, 100);
  assert.equal(totals.expectedTotal, 7500);
});

test("contributions PDF HTML highlights pending rows and totals confirmed + pending", () => {
  const html = buildContributionsReportHtml(CONTRIBUTION_ROWS, {
    scopeLabel: "Pending only",
    generatedAt: new Date("2026-09-17T00:00:00Z"),
    generatedBy: "Treasurer",
  });

  assert.ok(html.includes("MURAGE FOUNDATION"));
  assert.ok(html.includes("CONTRIBUTIONS REPORT"));
  assert.ok(html.includes("M-Pesa Paybill: <strong>522522</strong>"));
  assert.ok(html.includes("Account No: <strong>7989164</strong>"));
  assert.ok(html.includes("KCB Bank Kenya"));
  assert.ok(html.includes("Period: Pending only"));
  assert.ok(html.includes("Generated By: Treasurer"));
  assert.ok(html.includes('class="pending-row"'));
  assert.ok(html.includes('class="totals-row"'));
  assert.ok(html.includes("KES 7,500"));
  assert.ok(html.includes("Treasurer: _________________ Date: _________"));
  assert.ok(!html.includes("<script"), "body markup never carries scripts");
});

test("contributions PDF escapes member supplied text", () => {
  const html = buildContributionsReportHtml(
    [{ ...CONTRIBUTION_ROWS[0], memberName: '<img src=x onerror="alert(1)">' }],
    { scopeLabel: "All statuses" },
  );
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

/* ── Periods ──────────────────────────────────────────────────────────── */

test("resolvePeriod computes inclusive bounds for the built-in periods", () => {
  const now = new Date("2026-09-17T12:00:00");
  const thisYear = resolvePeriod({ key: "this_year" }, now);
  assert.equal(thisYear.from, "2026-01-01");
  assert.equal(thisYear.to, "2026-12-31");
  assert.ok(thisYear.includes("2026-01-01"));
  assert.ok(thisYear.includes("2026-12-31"));
  assert.ok(!thisYear.includes("2027-01-01"));

  const q2 = resolvePeriod({ key: "q2" }, now);
  assert.equal(q2.from, "2026-04-01");
  assert.equal(q2.to, "2026-06-30");
  assert.equal(q2.label, "Q2 (Apr - Jun) 2026");
  assert.ok(q2.includes("2026-06-30"));
  assert.ok(!q2.includes("2026-07-01"));

  const lastYear = resolvePeriod({ key: "last_year" }, now);
  assert.equal(lastYear.from, "2025-01-01");
  assert.equal(lastYear.label, "Last Year (2025)");

  const all = resolvePeriod({ key: "all" }, now);
  assert.equal(all.label, "All Time");
  assert.ok(all.includes("1999-01-01"));
  assert.ok(!all.includes(null));
});

test("custom ranges validate and filter on both ends", () => {
  const custom = resolvePeriod({ key: "custom", from: "2026-02-01", to: "2026-03-31" });
  assert.equal(custom.label, "01/02/2026 – 31/03/2026");
  assert.ok(custom.includes("2026-02-01"));
  assert.ok(custom.includes("2026-03-31"));
  assert.ok(!custom.includes("2026-04-01"));

  assert.equal(
    periodSelectionError({ key: "custom", from: "2026-02-01" }),
    "Choose both a start date and an end date for the custom range.",
  );
  assert.equal(
    periodSelectionError({ key: "custom", from: "2026-05-01", to: "2026-04-01" }),
    "The start date must be on or before the end date.",
  );
  assert.equal(periodSelectionError({ key: "custom", from: "2026-02-01", to: "2026-03-01" }), null);
  assert.equal(periodSelectionError({ key: "all" }), null);
});

/* ── Member statement ─────────────────────────────────────────────────── */

test("statement metrics value the loan book and account standing", () => {
  const metrics = computeStatementMetrics(MEMBER_DATA, ALL_TIME, "2026-09-17");

  assert.equal(metrics.confirmedTotal, 5000);
  assert.equal(metrics.pendingTotal, 2500);
  assert.equal(metrics.lifetimeTotal, 7500);
  assert.equal(metrics.activeLoanCount, 1);
  assert.equal(metrics.completedLoanCount, 0);
  assert.equal(metrics.totalBorrowed, 50000);
  assert.equal(metrics.totalRepaid, 7000);
  assert.equal(metrics.outstanding, 43000);
  assert.equal(metrics.overdueCount, 1);
  assert.equal(metrics.membershipStatus, "Active");
  assert.equal(metrics.paymentStatus, "Has Overdue Amount");
  assert.equal(metrics.totalSaved, 5000);
  assert.equal(metrics.netPosition, 5000 - 43000);
  assert.equal(metrics.repaymentSchedules.length, 1);
});

test("repaymentStatusLabel derives paid, overdue and partial states", () => {
  assert.equal(repaymentStatusLabel(MEMBER_DATA.repayments[0], "2026-09-17"), "Paid");
  assert.equal(repaymentStatusLabel(MEMBER_DATA.repayments[1], "2026-09-17"), "Overdue");
  assert.equal(
    repaymentStatusLabel({ ...MEMBER_DATA.repayments[1], due_date: "2026-12-01" }, "2026-09-17"),
    "Partially Paid",
  );
  assert.equal(
    repaymentStatusLabel(
      { ...MEMBER_DATA.repayments[1], due_date: "2026-12-01", amount_paid: 0 },
      "2026-09-17",
    ),
    "Pending",
  );
});

test("member statement CSV contains summary, history and footer blocks", () => {
  const csv = buildMemberStatementCsv(MEMBER_DATA, {
    period: ALL_TIME,
    sections: ALL_SECTIONS,
    generatedAt: new Date("2026-09-17T00:00:00Z"),
  });

  assert.ok(csv.startsWith("MURAGE FOUNDATION - MEMBER FINANCIAL STATEMENT\n"));
  assert.ok(csv.includes("Member Name,Jane Wanjiru"));
  assert.ok(csv.includes("Statement Period,All Time"));
  assert.ok(csv.includes("SAVINGS & CONTRIBUTIONS"));
  assert.ok(csv.includes("Confirmed (KES),5000"));
  assert.ok(csv.includes("Pending (KES),2500"));
  assert.ok(csv.includes("CONTRIBUTION HISTORY"));
  assert.ok(csv.includes("1,10/02/2026,5000,M-Pesa,QK12345678,Confirmed"));
  assert.ok(csv.includes("LOAN ACCOUNT"));
  assert.ok(csv.includes("Outstanding (KES),43000"));
  assert.ok(csv.includes("REPAYMENT SCHEDULE"));
  assert.ok(csv.includes("2,01/01/2026,5000,2000,Overdue"));
  assert.ok(csv.includes("ACCOUNT STANDING"));
  assert.ok(csv.includes("Payment Status,Has Overdue Amount"));
  assert.ok(
    csv.includes("Make payments via M-Pesa Paybill: Business No: 522522 | Account No: 7989164"),
  );
});

test("member statement CSV honours the section checkboxes", () => {
  const csv = buildMemberStatementCsv(MEMBER_DATA, {
    period: resolvePeriod({ key: "custom", from: "2026-02-01", to: "2026-02-28" }),
    sections: { contributions: true, loans: false, repayments: false, balance: false },
  });

  assert.ok(csv.includes("Statement Period,01/02/2026 – 28/02/2026"));
  assert.ok(csv.includes("CONTRIBUTION HISTORY"));
  assert.ok(!csv.includes("LOAN ACCOUNT"));
  assert.ok(!csv.includes("REPAYMENT SCHEDULE"));
  assert.ok(!csv.includes("ACCOUNT STANDING"));
  // Only the February contribution survives the period filter.
  assert.ok(!csv.includes("01/03/2026"));
});

test("member statement HTML renders every requested section", () => {
  const html = buildMemberStatementHtml(MEMBER_DATA, {
    period: ALL_TIME,
    sections: ALL_SECTIONS,
    generatedAt: new Date("2026-09-17T00:00:00Z"),
  });

  assert.ok(html.includes("MEMBER FINANCIAL STATEMENT"));
  assert.ok(html.includes("Member: <strong>Jane Wanjiru</strong>"));
  assert.ok(html.includes("Phone: 0712345678"));
  assert.ok(html.includes("Email: jane@example.com"));
  assert.ok(html.includes("Member Since: 06/05/2024"));
  assert.ok(html.includes("Statement Period: All Time"));
  assert.ok(html.includes("Generated: 17/09/2026"));
  assert.ok(html.includes("<h3>Savings &amp; Contributions</h3>"));
  assert.ok(html.includes("<h3>Loan Account</h3>"));
  assert.ok(html.includes('Outstanding: <span class="amount">KES 43,000</span>'));
  assert.ok(html.includes("<h3>Repayment Schedule — Active Loans</h3>"));
  assert.ok(html.includes("<h3>Account Standing</h3>"));
  assert.ok(html.includes('Payment Status: <span class="amount">Has Overdue Amount</span>'));
  assert.ok(html.includes("Business No: <strong>522522</strong>"));
  assert.ok(html.includes("does not require a signature"));
  assert.ok(html.includes("For queries contact: +254182528510"));
  assert.ok(html.includes("Certified by: _________________ Treasurer, Murage Foundation"));
  assert.ok(!html.includes("<script"), "body markup never carries scripts");
  assert.ok(!html.includes("&amp;amp;"), "escaped ampersands are not double escaped");
});

test("member statement HTML omits unchecked sections", () => {
  const html = buildMemberStatementHtml(MEMBER_DATA, {
    period: ALL_TIME,
    sections: { contributions: false, loans: false, repayments: false, balance: false },
  });

  assert.ok(!html.includes("Savings &amp; Contributions"));
  assert.ok(!html.includes("Loan Account"));
  assert.ok(!html.includes("Repayment Schedule"));
  assert.ok(!html.includes("Account Standing"));
  assert.ok(html.includes("Member Financial Statement".toUpperCase().charAt(0)));
});

test("statement file names are slugged and dated", () => {
  assert.equal(
    statementFileName("Jane Wanjiru", new Date("2026-09-17T00:00:00Z")),
    "murage-foundation-statement-jane-wanjiru-2026-09-17.csv",
  );
  assert.equal(
    statementFileName(null, new Date("2026-09-17T00:00:00Z")),
    "murage-foundation-statement-member-2026-09-17.csv",
  );
});
