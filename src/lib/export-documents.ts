/**
 * Export document builders shared by the contributions report and the member
 * financial statement.
 *
 * Everything here is browser-native: CSV text is assembled by hand (no `xlsx`)
 * and the printable documents are plain HTML strings handed to the browser's
 * own print pipeline (no `jsPDF`). The module has no runtime imports so the
 * CSV/HTML output can be unit-tested in Node.
 */

import type { Tables } from "@/integrations/supabase/types";

/* ────────────────────────────────────────────────────────────────────────────
 * Foundation + payment details — printed on every export.
 * ──────────────────────────────────────────────────────────────────────── */

export const FOUNDATION_NAME = "Murage Foundation";
export const FOUNDATION_HEADING = "MURAGE FOUNDATION";
export const FOUNDATION_BANK = "KCB Bank Kenya";
export const FOUNDATION_PAYBILL = "522522";
export const FOUNDATION_ACCOUNT = "7989164";
export const FOUNDATION_PHONE = "+254182528510";

/* ────────────────────────────────────────────────────────────────────────────
 * Formatting helpers
 * ──────────────────────────────────────────────────────────────────────── */

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Cross-realm `Date` check (instances from another window still qualify). */
const isDate = (value: unknown): value is Date =>
  Object.prototype.toString.call(value) === "[object Date]";

/** Normalise any date-ish value to a `YYYY-MM-DD` key, or null when unusable. */
export function isoDateKey(value: string | Date | null | undefined): string | null {
  if (isDate(value)) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** `DD/MM/YYYY` — the date format used on all printed treasury documents. */
export function formatDay(value: string | Date | null | undefined): string {
  const key = isoDateKey(value);
  if (!key) return "";
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

/** `DD/MM/YYYY HH:MM` for cells that carry a timestamp (e.g. confirmed at). */
export function formatDayTime(value: string | null | undefined): string {
  const day = formatDay(value);
  if (!day) return "";
  const time = /T(\d{2}:\d{2})/.exec(typeof value === "string" ? value : "");
  return time ? `${day} ${time[1]}` : day;
}

/** Today (or the supplied moment) as `YYYY-MM-DD`, used in file names. */
export function isoToday(now: Date = new Date()): string {
  return isoDateKey(now) ?? "";
}

/** Thousand-separated number for on-screen and printed amounts. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return decimals > 0 ? (0).toFixed(decimals) : "0";
  return amount.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Bare amount for CSV cells — numeric text that Excel can sum directly. */
export function plainAmount(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Capitalise the first letter of a value (e.g. `pending` → `Pending`). */
export function capitalise(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Readable payment method for documents (`mpesa` → `M-Pesa`). */
export function methodLabel(value: string | null | undefined): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "mpesa":
      return "M-Pesa";
    case "bank":
      return "Bank";
    case "bank_transfer":
      return "Bank Transfer";
    case "cash":
      return "Cash";
    default:
      return capitalise(value);
  }
}

/** Escape a value for safe interpolation into generated HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Empty cells instead of `null`/`undefined` in documents and CSV. */
export const text = (value: string | null | undefined): string => (value ?? "").trim();

/** `Yes`/`No` for booleans, blank when the value is unknown. */
export const yesNo = (value: boolean | null | undefined): string =>
  value === true ? "Yes" : value === false ? "No" : "";

/* ────────────────────────────────────────────────────────────────────────────
 * CSV helpers
 * ──────────────────────────────────────────────────────────────────────── */

export type CsvValue = string | number | boolean | null | undefined;

/** Quote a CSV cell only when it contains a delimiter, quote or newline. */
export function csvCell(value: CsvValue): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** Serialise a matrix of cells into CSV text with a trailing newline. */
export function csvText(rows: CsvValue[][]): string {
  return rows
    .map((row) => row.map(csvCell).join(","))
    .join("\n")
    .concat("\n");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reporting periods
 * ──────────────────────────────────────────────────────────────────────── */

export type PeriodKey = "all" | "this_year" | "last_year" | "q1" | "q2" | "q3" | "q4" | "custom";

export type PeriodSelection = {
  key: PeriodKey;
  /** `YYYY-MM-DD`, only used when `key` is `custom`. */
  from?: string;
  to?: string;
};

export type ResolvedPeriod = {
  key: PeriodKey;
  label: string;
  /** Inclusive `YYYY-MM-DD` bounds, null when unbounded. */
  from: string | null;
  to: string | null;
  /** True when the supplied date falls inside the period. */
  includes: (value: string | Date | null | undefined) => boolean;
};

const QUARTERS: Record<"q1" | "q2" | "q3" | "q4", [string, string, string]> = {
  q1: ["01-01", "03-31", "Q1 (Jan - Mar)"],
  q2: ["04-01", "06-30", "Q2 (Apr - Jun)"],
  q3: ["07-01", "09-30", "Q3 (Jul - Sep)"],
  q4: ["10-01", "12-31", "Q4 (Oct - Dec)"],
};

/** Turn a period selection into inclusive date bounds plus a display label. */
export function resolvePeriod(selection: PeriodSelection, now: Date = new Date()): ResolvedPeriod {
  const year = now.getFullYear();
  let from: string | null = null;
  let to: string | null = null;
  let label = "All Time";

  switch (selection.key) {
    case "this_year":
      from = `${year}-01-01`;
      to = `${year}-12-31`;
      label = `This Year (${year})`;
      break;
    case "last_year":
      from = `${year - 1}-01-01`;
      to = `${year - 1}-12-31`;
      label = `Last Year (${year - 1})`;
      break;
    case "q1":
    case "q2":
    case "q3":
    case "q4": {
      const [start, end, quarterLabel] = QUARTERS[selection.key];
      from = `${year}-${start}`;
      to = `${year}-${end}`;
      label = `${quarterLabel} ${year}`;
      break;
    }
    case "custom": {
      from = isoDateKey(selection.from);
      to = isoDateKey(selection.to);
      label = from && to ? `${formatDay(from)} – ${formatDay(to)}` : "Custom Range (incomplete)";
      break;
    }
    case "all":
    default:
      label = "All Time";
      break;
  }

  const includes = (value: string | Date | null | undefined): boolean => {
    const key = isoDateKey(value);
    if (!key) return false;
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  };

  return { key: selection.key, label, from, to, includes };
}

/** Validation message for a period selection, or null when it is usable. */
export function periodSelectionError(selection: PeriodSelection): string | null {
  if (selection.key !== "custom") return null;
  const from = isoDateKey(selection.from);
  const to = isoDateKey(selection.to);
  if (!from || !to) return "Choose both a start date and an end date for the custom range.";
  if (from > to) return "The start date must be on or before the end date.";
  return null;
}

export const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: "all", label: "All Time" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "q1", label: "Q1 (Jan - Mar)" },
  { value: "q2", label: "Q2 (Apr - Jun)" },
  { value: "q3", label: "Q3 (Jul - Sep)" },
  { value: "q4", label: "Q4 (Oct - Dec)" },
  { value: "custom", label: "Custom Range" },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Print window plumbing (browser only)
 * ──────────────────────────────────────────────────────────────────────── */

export type PrintOrientation = "portrait" | "landscape";

/** Styles for every printable export. A4 with 15mm margins, no browser UI. */
function printStyles(orientation: PrintOrientation): string {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      margin: 0;
      padding: 16px;
      font-size: 12px;
    }
    h1 { font-size: 22px; margin: 0; letter-spacing: 1px; }
    h2 { font-size: 14px; margin: 2px 0 0; letter-spacing: 3px; font-weight: normal; }
    h3 { font-size: 12px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 1px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #333333; padding: 6px 8px; font-size: 11px; text-align: left; }
    th { background: #1a472a; color: #ffffff; }
    .num { text-align: right; }
    .center { text-align: center; }
    .doc-header { border-bottom: 2px solid #1a472a; padding-bottom: 8px; margin-bottom: 12px; }
    .doc-header .meta { margin-top: 8px; text-align: right; font-size: 11px; line-height: 1.5; }
    .panels { display: flex; gap: 12px; margin-bottom: 12px; }
    .box { border: 1px solid #1a472a; padding: 8px 10px; margin-bottom: 12px; flex: 1; }
    .box p { margin: 3px 0; font-size: 11px; }
    .box .amount { font-weight: bold; }
    .section { margin-top: 16px; page-break-inside: avoid; }
    .totals-row td { font-weight: bold; background: #e5efe8; }
    .muted { color: #6b7280; font-size: 10px; }
    .notes { margin-top: 6px; font-size: 10px; color: #6b7280; }
    .footer { margin-top: 18px; border-top: 1px solid #333333; padding-top: 10px; font-size: 11px; }
    .signatures { margin-top: 26px; display: flex; justify-content: space-between; gap: 40px; }
    .signature-line { border-top: 1px solid #333333; padding-top: 4px; min-width: 240px; font-size: 11px; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    tr.pending-row { background: #fffbeb !important; }
    tr.rejected-row { background: #fef2f2 !important; }
    tr.partial-row { background: #fefce8 !important; }
    @media print {
      @page { size: A4 ${orientation}; margin: 15mm; }
      body { padding: 0; }
      .no-print { display: none; }
    }
  `;
}

/** Wrap body markup in a standalone printable document with auto-print. */
export function buildPrintDocument(
  title: string,
  bodyHtml: string,
  orientation: PrintOrientation = "landscape",
): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>${printStyles(orientation)}</style>
  </head>
  <body>
    ${bodyHtml}
    <script>
      (function () {
        function launch() {
          try {
            window.focus();
            window.onafterprint = function () { window.close(); };
            window.print();
          } catch (error) {
            /* printing is unavailable — leave the window open for review */
          }
        }
        if (document.readyState === "complete") {
          launch();
        } else {
          window.addEventListener("load", launch);
        }
      })();
    </script>
  </body>
</html>`;
}

/**
 * Open a new window with the report and trigger the browser's print dialog.
 * Returns false when the popup was blocked so callers can tell the user.
 */
export function openPrintWindow(
  title: string,
  bodyHtml: string,
  orientation: PrintOrientation = "landscape",
): boolean {
  if (typeof window === "undefined") return false;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.document.write(buildPrintDocument(title, bodyHtml, orientation));
  printWindow.document.close();
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * All-contributions report (treasurer / admin)
 * ──────────────────────────────────────────────────────────────────────── */

export type ContributionExportRow = {
  memberName: string;
  phone: string;
  email: string;
  amount: number;
  /** `YYYY-MM-DD` contribution date. */
  date: string;
  method: string;
  reference: string;
  status: string;
  confirmedBy: string;
  confirmedAt: string | null;
  officerEntry: boolean;
  notes: string;
};

export type ContributionReportOptions = {
  /** Description of the active status filter, e.g. "Pending only" or "All statuses". */
  scopeLabel: string;
  generatedAt?: Date;
  generatedBy?: string;
};

export type ContributionTotals = {
  count: number;
  confirmedCount: number;
  confirmedTotal: number;
  pendingCount: number;
  pendingTotal: number;
  rejectedCount: number;
  rejectedTotal: number;
  /** Confirmed + pending — the money the foundation actually expects. */
  expectedTotal: number;
};

export const CONTRIBUTION_CSV_HEADERS = [
  "No",
  "Member Name",
  "Phone Number",
  "Email",
  "Amount (KES)",
  "Date",
  "Method",
  "M-Pesa Reference",
  "Status",
  "Confirmed By",
  "Confirmed Date",
  "Officer Entry",
  "Notes",
];

export function summariseContributions(rows: ContributionExportRow[]): ContributionTotals {
  const sum = (list: ContributionExportRow[]) =>
    list.reduce((total, row) => total + Number(row.amount || 0), 0);
  const confirmed = rows.filter((row) => row.status === "confirmed");
  const pending = rows.filter((row) => row.status === "pending");
  const rejected = rows.filter((row) => row.status === "rejected");

  return {
    count: rows.length,
    confirmedCount: confirmed.length,
    confirmedTotal: sum(confirmed),
    pendingCount: pending.length,
    pendingTotal: sum(pending),
    rejectedCount: rejected.length,
    rejectedTotal: sum(rejected),
    expectedTotal: sum(confirmed) + sum(pending),
  };
}

export const contributionsFileName = (generatedAt: Date = new Date()): string =>
  `murage-foundation-contributions-${isoToday(generatedAt)}.csv`;

/** Build the CSV (opens directly in Excel) for the contributions report. */
export function buildContributionsCsv(
  rows: ContributionExportRow[],
  options: ContributionReportOptions,
): string {
  const generatedAt = options.generatedAt ?? new Date();
  const totals = summariseContributions(rows);

  const output: CsvValue[][] = [
    ["MURAGE FOUNDATION - CONTRIBUTIONS REPORT"],
    [`Generated: ${formatDay(generatedAt)}`],
    [`Paybill: ${FOUNDATION_PAYBILL} | Account: ${FOUNDATION_ACCOUNT}`],
    [],
  ];

  if (options.scopeLabel) output.push([`Filter: ${options.scopeLabel}`]);
  output.push(CONTRIBUTION_CSV_HEADERS);

  rows.forEach((row, index) => {
    output.push([
      index + 1,
      row.memberName,
      row.phone,
      row.email,
      plainAmount(row.amount),
      formatDay(row.date),
      methodLabel(row.method),
      row.reference,
      capitalise(row.status),
      row.confirmedBy,
      formatDay(row.confirmedAt),
      yesNo(row.officerEntry),
      row.notes,
    ]);
  });

  output.push(
    [],
    ["Total Confirmed Contributions", "", "", "", plainAmount(totals.confirmedTotal)],
    ["Total Pending", "", "", "", plainAmount(totals.pendingTotal)],
    ["Total Contributions", "", "", "", totals.count],
    ["Report generated by Murage Foundation Treasury"],
  );

  return csvText(output);
}

const rowClassAttribute = (className: string): string => (className ? ` class="${className}"` : "");

const contributionRowClass = (status: string): string =>
  status === "pending" ? "pending-row" : status === "rejected" ? "rejected-row" : "";

/** Build the printable contributions report (the "Export PDF" document). */
export function buildContributionsReportHtml(
  rows: ContributionExportRow[],
  options: ContributionReportOptions,
): string {
  const generatedAt = options.generatedAt ?? new Date();
  const totals = summariseContributions(rows);
  const generatedBy = options.generatedBy ?? "Treasurer";
  const scopeLabel = options.scopeLabel || "All statuses";

  const tableRows = rows
    .map(
      (row, index) => `
        <tr${rowClassAttribute(contributionRowClass(row.status))}>
          <td class="num">${index + 1}</td>
          <td>${escapeHtml(row.memberName || "Unknown member")}</td>
          <td class="num">${escapeHtml(formatNumber(row.amount))}</td>
          <td>${escapeHtml(formatDay(row.date))}</td>
          <td>${escapeHtml(methodLabel(row.method))}</td>
          <td>${escapeHtml(row.reference || "—")}</td>
          <td>${escapeHtml(capitalise(row.status))}</td>
        </tr>`,
    )
    .join("");

  return `
    <div class="doc-header">
      <h1 class="center">${FOUNDATION_HEADING}</h1>
      <h2 class="center">CONTRIBUTIONS REPORT</h2>
      <div class="meta">
        Date Generated: ${escapeHtml(formatDay(generatedAt))}<br />
        Period: ${escapeHtml(scopeLabel)}<br />
        Generated By: ${escapeHtml(generatedBy)}
      </div>
    </div>

    <div class="panels">
      <div class="box">
        <h3>Payment Details</h3>
        <p>M-Pesa Paybill: <strong>${FOUNDATION_PAYBILL}</strong></p>
        <p>Account No: <strong>${FOUNDATION_ACCOUNT}</strong></p>
        <p>Bank: ${FOUNDATION_BANK}</p>
      </div>
      <div class="box">
        <h3>Summary</h3>
        <p>Total Contributions: <span class="amount">${totals.count}</span></p>
        <p>Total Confirmed: <span class="amount">KES ${escapeHtml(
          formatNumber(totals.confirmedTotal),
        )}</span></p>
        <p>Total Pending: <span class="amount">KES ${escapeHtml(
          formatNumber(totals.pendingTotal),
        )}</span></p>
        <p>Reporting Period: ${escapeHtml(scopeLabel)}</p>
      </div>
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 36px">No</th>
          <th>Member</th>
          <th style="width: 110px" class="num">Amount (KES)</th>
          <th style="width: 90px">Date</th>
          <th style="width: 90px">Method</th>
          <th style="width: 120px">Reference</th>
          <th style="width: 90px">Status</th>
        </tr>
      </thead>
      <tbody>
        ${
          tableRows ||
          `<tr><td colspan="7" class="center">No contributions match this report.</td></tr>`
        }
        <tr class="totals-row">
          <td>TOTAL</td>
          <td></td>
          <td class="num">KES ${escapeHtml(formatNumber(totals.expectedTotal))}</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <p class="notes">
      TOTAL covers confirmed and pending contributions for the selected rows; rejected
      contributions are excluded.
    </p>

    <div class="footer">
      <p>
        This report was generated from the ${FOUNDATION_NAME} financial management system on
        ${escapeHtml(formatDay(generatedAt))}. All amounts are in Kenya Shillings.
      </p>
      <div class="signatures">
        <div class="signature-line">Treasurer: _________________ Date: _________</div>
        <div class="signature-line">For queries contact: ${FOUNDATION_PHONE}</div>
      </div>
    </div>
  `;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Member financial statement
 * ──────────────────────────────────────────────────────────────────────── */

export type ContributionRecord = Pick<
  Tables<"contributions">,
  | "amount"
  | "contributed_on"
  | "method"
  | "reference"
  | "mpesa_transaction_id"
  | "status"
  | "notes"
  | "on_behalf_of"
>;

export type LoanRecord = Pick<
  Tables<"loans">,
  "id" | "loan_type" | "amount" | "repayment_months" | "status" | "purpose" | "created_at"
>;

export type LoanRepaymentRecord = Pick<
  Tables<"loan_repayments">,
  | "loan_id"
  | "installment_number"
  | "due_date"
  | "amount_due"
  | "amount_paid"
  | "status"
  | "payment_status"
  | "paid_at"
>;

export type StatementMember = Pick<
  Tables<"profiles">,
  "full_name" | "email" | "phone_number" | "created_at" | "status"
>;

export type MemberStatementInput = {
  profile: StatementMember | null;
  contributions: ContributionRecord[];
  loans: LoanRecord[];
  repayments: LoanRepaymentRecord[];
};

export type StatementSections = {
  contributions: boolean;
  loans: boolean;
  repayments: boolean;
  balance: boolean;
};

export const ALL_STATEMENT_SECTIONS: StatementSections = {
  contributions: true,
  loans: true,
  repayments: true,
  balance: true,
};

export type MemberStatementOptions = {
  period: ResolvedPeriod;
  sections: StatementSections;
  generatedAt?: Date;
  /** Who requested the statement (Treasurer, or the member themselves). */
  generatedBy?: string;
};

/** The database values that count as live money owed to the foundation. */
const ACTIVE_LOAN_STATUSES = ["approved"];
const REPAID_LOAN_STATUSES = ["approved", "completed"];

/** Human readable installment status, derived from the payment columns. */
export function repaymentStatusLabel(
  repayment: LoanRepaymentRecord,
  today: string = isoToday(),
): string {
  if (repayment.payment_status === "confirmed" || repayment.status === "paid") return "Paid";
  if (repayment.payment_status === "rejected") return "Rejected";
  if (repayment.payment_status === "pending_confirmation") return "Pending Confirmation";
  const due = Number(repayment.amount_due ?? 0);
  const paid = Number(repayment.amount_paid ?? 0);
  const dueDate = isoDateKey(repayment.due_date);
  if (paid >= due && due > 0) return "Paid";
  if (dueDate && dueDate < today && paid < due) return "Overdue";
  return paid > 0 ? "Partially Paid" : "Pending";
}

export type StatementLoanLine = {
  loan: LoanRecord;
  repaid: number;
  outstanding: number;
};

export type StatementMetrics = {
  contributionRows: ContributionRecord[];
  contributionCount: number;
  confirmedTotal: number;
  pendingTotal: number;
  lifetimeTotal: number;
  periodTotal: number;
  periodCount: number;
  loanLines: StatementLoanLine[];
  activeLoanCount: number;
  completedLoanCount: number;
  totalBorrowed: number;
  totalRepaid: number;
  outstanding: number;
  repaymentSchedules: Array<{ loan: LoanRecord; installments: LoanRepaymentRecord[] }>;
  overdueCount: number;
  membershipStatus: string;
  paymentStatus: string;
  totalSaved: number;
  netPosition: number;
};

/** Derive every figure printed on the statement from the raw member records. */
export function computeStatementMetrics(
  data: MemberStatementInput,
  period: ResolvedPeriod,
  today: string = isoToday(),
): StatementMetrics {
  const { contributions, loans, repayments, profile } = data;

  // ── Contributions ──────────────────────────────────────────────────────
  const sum = (list: ContributionRecord[]) =>
    list.reduce((total, row) => total + Number(row.amount || 0), 0);

  const confirmed = contributions.filter((row) => row.status === "confirmed");
  const pending = contributions.filter((row) => row.status === "pending");
  const confirmedTotal = sum(confirmed);
  const pendingTotal = sum(pending);

  const contributionRows = contributions.filter((row) => period.includes(row.contributed_on));
  const periodConfirmed = contributionRows.filter((row) => row.status === "confirmed");

  // ── Loans ──────────────────────────────────────────────────────────────
  const repaymentsByLoan = new Map<string, LoanRepaymentRecord[]>();
  repayments.forEach((repayment) => {
    const list = repaymentsByLoan.get(repayment.loan_id) ?? [];
    list.push(repayment);
    repaymentsByLoan.set(repayment.loan_id, list);
  });

  const repaidFor = (loanId: string) =>
    (repaymentsByLoan.get(loanId) ?? []).reduce(
      (total, repayment) => total + Number(repayment.amount_paid ?? 0),
      0,
    );

  const loanLines: StatementLoanLine[] = loans.map((loan) => {
    const repaid = repaidFor(loan.id);
    const outstanding =
      loan.status === "completed"
        ? 0
        : ACTIVE_LOAN_STATUSES.includes(loan.status)
          ? Math.max(0, Number(loan.amount) - repaid)
          : 0;
    return { loan, repaid, outstanding };
  });

  const disbursedLines = loanLines.filter((line) =>
    REPAID_LOAN_STATUSES.includes(line.loan.status),
  );
  const totalBorrowed = disbursedLines.reduce((total, line) => total + Number(line.loan.amount), 0);
  const totalRepaid = disbursedLines.reduce((total, line) => total + line.repaid, 0);
  const outstanding = loanLines.reduce((total, line) => total + line.outstanding, 0);
  const activeLoanCount = loans.filter((loan) => ACTIVE_LOAN_STATUSES.includes(loan.status)).length;
  const completedLoanCount = loans.filter((loan) => loan.status === "completed").length;

  // ── Repayment schedule (active loans, in due-date order) ───────────────
  const repaymentSchedules = loanLines
    .filter((line) => ACTIVE_LOAN_STATUSES.includes(line.loan.status))
    .map((line) => ({
      loan: line.loan,
      installments: [...(repaymentsByLoan.get(line.loan.id) ?? [])].sort((a, b) =>
        (isoDateKey(a.due_date) ?? "").localeCompare(isoDateKey(b.due_date) ?? ""),
      ),
    }));

  const overdueCount = repayments.filter(
    (repayment) => repaymentStatusLabel(repayment, today) === "Overdue",
  ).length;

  // ── Account standing ───────────────────────────────────────────────────
  const membershipStatus =
    profile?.status === "approved" ? "Active" : capitalise(profile?.status ?? "pending");

  return {
    contributionRows,
    contributionCount: contributionRows.length,
    confirmedTotal,
    pendingTotal,
    lifetimeTotal: confirmedTotal + pendingTotal,
    periodTotal: sum(periodConfirmed),
    periodCount: periodConfirmed.length,
    loanLines,
    activeLoanCount,
    completedLoanCount,
    totalBorrowed,
    totalRepaid,
    outstanding,
    repaymentSchedules,
    overdueCount,
    membershipStatus,
    paymentStatus: overdueCount > 0 ? "Has Overdue Amount" : "Good Standing",
    totalSaved: confirmedTotal,
    netPosition: confirmedTotal - outstanding,
  };
}

/** File name for a member statement export. */
export function statementFileName(
  memberName: string | null | undefined,
  generatedAt: Date = new Date(),
): string {
  const slug =
    (memberName ?? "member")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "member";
  return `murage-foundation-statement-${slug}-${isoToday(generatedAt)}.csv`;
}

/** Build the CSV/Excel version of a member statement (summary + history). */
export function buildMemberStatementCsv(
  data: MemberStatementInput,
  options: MemberStatementOptions,
): string {
  const generatedAt = options.generatedAt ?? new Date();
  const metrics = computeStatementMetrics(data, options.period);
  const { profile, loans, contributions } = data;
  const { sections } = options;
  const memberName = profile?.full_name ?? "Member";

  const output: CsvValue[][] = [
    ["MURAGE FOUNDATION - MEMBER FINANCIAL STATEMENT"],
    [`Generated: ${formatDay(generatedAt)}`],
    [`Paybill: ${FOUNDATION_PAYBILL} | Account: ${FOUNDATION_ACCOUNT}`],
    [],
    ["Member Name", memberName],
    ["Phone Number", text(profile?.phone_number)],
    ["Email", text(profile?.email)],
    ["Member Since", formatDay(profile?.created_at)],
    ["Statement Period", options.period.label],
    [],
  ];

  if (sections.contributions) {
    output.push(
      ["SAVINGS & CONTRIBUTIONS"],
      ["Total Contributions (KES)", plainAmount(metrics.lifetimeTotal)],
      ["Confirmed (KES)", plainAmount(metrics.confirmedTotal)],
      ["Pending (KES)", plainAmount(metrics.pendingTotal)],
      ["Confirmed This Period (KES)", plainAmount(metrics.periodTotal)],
      [],
      ["CONTRIBUTION HISTORY"],
      ["No", "Date", "Amount (KES)", "Method", "Reference", "Status"],
    );

    metrics.contributionRows.forEach((row, index) => {
      output.push([
        index + 1,
        formatDay(row.contributed_on),
        plainAmount(Number(row.amount)),
        methodLabel(row.method),
        text(row.reference) || text(row.mpesa_transaction_id),
        capitalise(row.status),
      ]);
    });
    output.push([]);
  }

  if (sections.loans && loans.length > 0) {
    output.push(
      ["LOAN ACCOUNT"],
      ["Active Loans", metrics.activeLoanCount],
      ["Total Borrowed (KES)", plainAmount(metrics.totalBorrowed)],
      ["Total Repaid (KES)", plainAmount(metrics.totalRepaid)],
      ["Outstanding (KES)", plainAmount(metrics.outstanding)],
      ["Completed Loans", metrics.completedLoanCount],
      [],
      ["LOAN HISTORY"],
      ["Type", "Amount (KES)", "Date", "Status", "Outstanding (KES)"],
    );

    metrics.loanLines.forEach((line) => {
      output.push([
        capitalise(line.loan.loan_type),
        plainAmount(Number(line.loan.amount)),
        formatDay(line.loan.created_at),
        capitalise(line.loan.status),
        plainAmount(line.outstanding),
      ]);
    });
    output.push([]);
  }

  if (sections.repayments && metrics.repaymentSchedules.length > 0) {
    output.push(["REPAYMENT SCHEDULE"]);
    metrics.repaymentSchedules.forEach(({ loan, installments }) => {
      output.push([
        `Loan: ${capitalise(loan.loan_type)} - KES ${plainAmount(Number(loan.amount))} (${
          loan.repayment_months
        } months, ${capitalise(loan.status)})`,
      ]);
      output.push(["No", "Due Date", "Amount Due (KES)", "Paid (KES)", "Status"]);
      installments.forEach((installment, index) => {
        output.push([
          index + 1,
          formatDay(installment.due_date),
          plainAmount(Number(installment.amount_due)),
          plainAmount(Number(installment.amount_paid ?? 0)),
          repaymentStatusLabel(installment),
        ]);
      });
      output.push([]);
    });
  }

  if (sections.balance) {
    output.push(
      ["ACCOUNT STANDING"],
      ["Membership Status", metrics.membershipStatus],
      ["Payment Status", metrics.paymentStatus],
      ["Total Saved (KES)", plainAmount(metrics.totalSaved)],
      ["Net Position (KES)", plainAmount(metrics.netPosition)],
      [],
    );
  }

  output.push(
    ["PAYMENT DETAILS"],
    [
      `Make payments via M-Pesa Paybill: Business No: ${FOUNDATION_PAYBILL} | Account No: ${FOUNDATION_ACCOUNT}`,
    ],
    [`Bank: ${FOUNDATION_BANK}`, `Queries: ${FOUNDATION_PHONE}`],
    ["This statement is computer generated and does not require a signature."],
    [`Report generated by Murage Foundation Treasury on ${formatDay(generatedAt)}`],
    [
      `Total records: ${contributions.length} contributions, ${loans.length} loans - period: ${
        options.period.label
      }`,
    ],
  );

  return csvText(output);
}

/** Build the printable member statement ("Generate PDF" document). */
export function buildMemberStatementHtml(
  data: MemberStatementInput,
  options: MemberStatementOptions,
): string {
  const generatedAt = options.generatedAt ?? new Date();
  const metrics = computeStatementMetrics(data, options.period);
  const { profile, loans, contributions } = data;
  const { sections } = options;

  const contributionRows = metrics.contributionRows
    .map(
      (row, index) => `
        <tr${rowClassAttribute(contributionRowClass(row.status))}>
          <td class="num">${index + 1}</td>
          <td>${escapeHtml(formatDay(row.contributed_on))}</td>
          <td class="num">${escapeHtml(formatNumber(Number(row.amount)))}</td>
          <td>${escapeHtml(methodLabel(row.method))}</td>
          <td>${escapeHtml(text(row.reference) || text(row.mpesa_transaction_id) || "—")}</td>
          <td>${escapeHtml(capitalise(row.status))}</td>
        </tr>`,
    )
    .join("");

  const loanRows = metrics.loanLines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(capitalise(line.loan.loan_type))}</td>
          <td class="num">${escapeHtml(formatNumber(Number(line.loan.amount)))}</td>
          <td>${escapeHtml(formatDay(line.loan.created_at))}</td>
          <td>${escapeHtml(capitalise(line.loan.status))}</td>
          <td class="num">${escapeHtml(
            line.loan.status === "submitted" || line.loan.status === "rejected"
              ? "—"
              : formatNumber(line.outstanding),
          )}</td>
        </tr>`,
    )
    .join("");

  const scheduleHtml = metrics.repaymentSchedules
    .map(({ loan, installments }) => {
      const rows = installments
        .map((installment, index) => {
          const label = repaymentStatusLabel(installment);
          return `
            <tr${rowClassAttribute(label === "Overdue" ? "rejected-row" : label === "Partially Paid" ? "partial-row" : "")}>
              <td class="num">${index + 1}</td>
              <td>${escapeHtml(formatDay(installment.due_date))}</td>
              <td class="num">${escapeHtml(formatNumber(Number(installment.amount_due)))}</td>
              <td class="num">${escapeHtml(formatNumber(Number(installment.amount_paid ?? 0)))}</td>
              <td>${escapeHtml(label)}</td>
            </tr>`;
        })
        .join("");

      return `
        <h3 style="margin-top: 10px">
          ${escapeHtml(capitalise(loan.loan_type))} loan — KES
          ${escapeHtml(formatNumber(Number(loan.amount)))} over ${loan.repayment_months} months
        </h3>
        <table>
          <thead>
            <tr>
              <th style="width: 36px">No</th>
              <th style="width: 120px">Due Date</th>
              <th class="num">Amount Due (KES)</th>
              <th class="num">Paid (KES)</th>
              <th style="width: 140px">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5" class="center">No installments scheduled yet.</td></tr>`}
          </tbody>
        </table>`;
    })
    .join("");

  const contributionsSection = sections.contributions
    ? `
      <div class="section">
        <div class="box">
          <h3>Savings &amp; Contributions</h3>
          <p>Total Contributions: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.lifetimeTotal),
          )}</span></p>
          <p>Confirmed: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.confirmedTotal),
          )}</span></p>
          <p>Pending: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.pendingTotal),
          )}</span></p>
          <p>This Period: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.periodTotal),
          )}</span> (${metrics.periodCount} confirmed contributions)</p>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 36px">No</th>
              <th style="width: 100px">Date</th>
              <th class="num">Amount (KES)</th>
              <th style="width: 100px">Method</th>
              <th style="width: 140px">Reference</th>
              <th style="width: 100px">Status</th>
            </tr>
          </thead>
          <tbody>
            ${
              contributionRows ||
              `<tr><td colspan="6" class="center">No contributions in this period.</td></tr>`
            }
          </tbody>
        </table>
      </div>`
    : "";

  const loansSection =
    sections.loans && loans.length > 0
      ? `
      <div class="section">
        <div class="box">
          <h3>Loan Account</h3>
          <p>Active Loans: <span class="amount">${metrics.activeLoanCount}</span></p>
          <p>Total Borrowed: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.totalBorrowed),
          )}</span></p>
          <p>Total Repaid: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.totalRepaid),
          )}</span></p>
          <p>Outstanding: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.outstanding),
          )}</span></p>
          <p>Completed Loans: <span class="amount">${metrics.completedLoanCount}</span></p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th class="num">Amount (KES)</th>
              <th style="width: 100px">Date</th>
              <th style="width: 110px">Status</th>
              <th class="num">Outstanding (KES)</th>
            </tr>
          </thead>
          <tbody>${loanRows}</tbody>
        </table>
      </div>`
      : "";

  const scheduleSection =
    sections.repayments && scheduleHtml
      ? `
      <div class="section">
        <h3>Repayment Schedule — Active Loans</h3>
        ${scheduleHtml}
      </div>`
      : "";

  const balanceSection = sections.balance
    ? `
      <div class="section">
        <div class="box">
          <h3>Account Standing</h3>
          <p>Membership Status: <span class="amount">${escapeHtml(metrics.membershipStatus)}</span></p>
          <p>Payment Status: <span class="amount">${escapeHtml(metrics.paymentStatus)}</span></p>
          <p>Total Saved: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.totalSaved),
          )}</span></p>
          <p>Net Position: <span class="amount">KES ${escapeHtml(
            formatNumber(metrics.netPosition),
          )}</span></p>
        </div>
      </div>`
    : "";

  return `
    <div class="doc-header">
      <h1 class="center">${FOUNDATION_HEADING}</h1>
      <h2 class="center">MEMBER FINANCIAL STATEMENT</h2>
    </div>

    <div class="box">
      <p>Member: <strong>${escapeHtml(profile?.full_name ?? "Member")}</strong></p>
      <p>Phone: ${escapeHtml(text(profile?.phone_number) || "—")}</p>
      <p>Email: ${escapeHtml(text(profile?.email) || "—")}</p>
      <p>Member Since: ${escapeHtml(formatDay(profile?.created_at) || "—")}</p>
      <p>Statement Period: ${escapeHtml(options.period.label)}</p>
      <p>Generated: ${escapeHtml(formatDay(generatedAt))}</p>
      <p class="muted">Records on file: ${contributions.length} contributions, ${
        loans.length
      } loans.</p>
    </div>

    ${contributionsSection}
    ${loansSection}
    ${scheduleSection}
    ${balanceSection}

    <div class="footer">
      <p>
        Make payments via M-Pesa Paybill: Business No: <strong>${FOUNDATION_PAYBILL}</strong> |
        Account No: <strong>${FOUNDATION_ACCOUNT}</strong>
      </p>
      <p>This statement is computer generated and does not require a signature.</p>
      <p>For queries contact: ${FOUNDATION_PHONE}</p>
      <div class="signatures">
        <div class="signature-line">Certified by: _________________ Treasurer, ${FOUNDATION_NAME}</div>
        <div class="signature-line">Date: _________________________</div>
      </div>
    </div>
  `;
}
