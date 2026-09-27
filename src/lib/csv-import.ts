/**
 * Shared CSV helpers for officer bulk-import features.
 *
 * Used by the Contributions Review "Bulk Import CSV" dialog (8D) and by the
 * Data Import page (8F). No third-party parsing library: the CSV reader below
 * is a small RFC-4180-ish parser that handles quoted fields, escaped quotes and
 * both LF and CRLF line endings.
 */

export type MemberOption = {
  id: string;
  full_name: string | null;
  phone_number: string | null;
};

export type ContributionImportRow = {
  /** 1-based line number in the uploaded file, for error reporting. */
  line: number;
  member_phone: string;
  member_name: string;
  amount: string;
  mpesa_ref: string;
  date: string;
  method: string;
  notes: string;
  /** Resolved member id when the phone matched an approved member. */
  memberId: string | null;
  /** Blocking problems — the row will not be imported. */
  errors: string[];
  /** Non-blocking: the reference already exists so the row is skipped. */
  duplicate: boolean;
};

export const CONTRIBUTION_COLUMNS = [
  "member_phone",
  "member_name",
  "amount",
  "mpesa_ref",
  "date",
  "method",
  "notes",
] as const;

export const PAYMENT_METHODS = ["mpesa", "bank", "cash"] as const;

/** Kenyan phone numbers are compared on their last 9 digits (7XXXXXXXX). */
export const normPhone = (phone: string | null | undefined): string =>
  (phone ?? "").replace(/\D/g, "").slice(-9);

export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Parse CSV text into a matrix of raw cell values. */
export function parseCsvText(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (inQuotes) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Snapshot of a CSV ideally produced by our own template (keys lowercased). */
export type CsvRecord = { line: number; values: Record<string, string> };

export function parseCsvRecords(text: string): {
  headers: string[];
  records: CsvRecord[];
} {
  const matrix = parseCsvText(text);
  if (matrix.length === 0) return { headers: [], records: [] };
  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  const records = matrix.slice(1).map((cells, index) => ({
    line: index + 2,
    values: Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])),
  }));
  return { headers, records };
}

export const contributionTemplateCsv = (): string =>
  [
    CONTRIBUTION_COLUMNS.join(","),
    "0712345678,Jane Wanjiru,5000,QK12345678,2026-01-31,mpesa,January contribution",
    "0723456789,Peter Kamau,2500,BK99887766,2026-02-15,bank,February contribution",
  ].join("\n") + "\n";

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Validate parsed CSV records into import rows.
 *
 * Rules: phone must match an approved member, amount must be a positive number,
 * mpesa_ref is required (and skipped when it duplicates an existing or
 * earlier-in-file reference), date must be a valid YYYY-MM-DD, and method must
 * be one of mpesa|bank|cash (blank defaults to mpesa).
 */
export function validateContributionRows(
  records: CsvRecord[],
  members: MemberOption[],
  existingRefs: Iterable<string>,
): ContributionImportRow[] {
  const byPhone = new Map<string, MemberOption>();
  members.forEach((member) => {
    const key = normPhone(member.phone_number);
    if (key.length === 9 && !byPhone.has(key)) byPhone.set(key, member);
  });

  const seenRefs = new Set(
    Array.from(existingRefs, (ref) => ref.trim().toLowerCase()).filter((ref) => ref !== ""),
  );

  return records.map((record) => {
    const values = record.values;
    const phone = values.member_phone ?? "";
    const ref = values.mpesa_ref ?? "";
    const rawMethod = (values.method ?? "").toLowerCase();
    const errors: string[] = [];

    const member = byPhone.get(normPhone(phone));
    if (!phone) errors.push("member_phone is required");
    else if (!member) errors.push(`No approved member matches ${phone}`);

    const amount = Number(values.amount ?? "");
    if (!(values.amount ?? "").trim()) errors.push("amount is required");
    else if (Number.isNaN(amount) || amount <= 0) errors.push("amount must be a positive number");

    if (!ref) errors.push("mpesa_ref is required");

    const date = values.date ?? "";
    if (!date) errors.push("date is required");
    else if (!isValidIsoDate(date)) errors.push("date must be YYYY-MM-DD");

    if (rawMethod && !PAYMENT_METHODS.includes(rawMethod as (typeof PAYMENT_METHODS)[number]))
      errors.push("method must be mpesa, bank or cash");

    const refKey = ref.trim().toLowerCase();
    const duplicate = errors.length === 0 && refKey !== "" && seenRefs.has(refKey);
    // Only refs from otherwise-valid rows enter the seen set, so an invalid row
    // never blocks a later valid row that shares the same reference.
    if (errors.length === 0 && refKey !== "") seenRefs.add(refKey);

    return {
      line: record.line,
      member_phone: phone,
      member_name: values.member_name ?? "",
      amount: values.amount ?? "",
      mpesa_ref: ref,
      date,
      method: rawMethod || "mpesa",
      notes: values.notes ?? "",
      memberId: member ? member.id : null,
      errors,
      duplicate,
    };
  });
}

/* ───────────────────────────── Members (8F) ───────────────────────────── */

export const MEMBER_COLUMNS = ["full_name", "phone_number", "email", "role", "notes"] as const;

/** Roles an admin may assign from the Members import. */
export const IMPORTABLE_MEMBER_ROLES = [
  "member",
  "board_member",
  "secretary",
  "assistant_secretary",
] as const;

export type MemberImportRow = {
  line: number;
  full_name: string;
  phone_number: string;
  email: string;
  role: string;
  notes: string;
  errors: string[];
};

export const memberTemplateCsv = (): string =>
  [
    MEMBER_COLUMNS.join(","),
    "Jane Wanjiru,0712345678,jane@example.com,member,Joined 2024",
    "Peter Kamau,0723456789,,member,Phone only member",
  ].join("\n") + "\n";

const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Validate parsed member records: name required, phone required and unique
 * (against existing members and earlier rows), role from the allowed list.
 */
export function validateMemberRows(
  records: CsvRecord[],
  existingPhones: Iterable<string>,
): MemberImportRow[] {
  const seen = new Set<string>();
  Array.from(existingPhones).forEach((phone) => {
    const key = normPhone(phone);
    if (key.length === 9) seen.add(key);
  });

  return records.map((record) => {
    const values = record.values;
    const fullName = (values.full_name ?? "").trim();
    const phone = (values.phone_number ?? "").trim();
    const email = (values.email ?? "").trim();
    const rawRole = (values.role ?? "").trim().toLowerCase();
    const role = rawRole || "member";
    const errors: string[] = [];

    if (!fullName) errors.push("full_name is required");

    const phoneKey = normPhone(phone);
    if (!phone) errors.push("phone_number is required");
    else if (phoneKey.length !== 9) errors.push("phone_number looks invalid");
    else if (seen.has(phoneKey)) errors.push(`Phone ${phone} already exists or repeats in file`);

    if (email && !looksLikeEmail(email)) errors.push("email looks invalid");

    if (!IMPORTABLE_MEMBER_ROLES.includes(role as (typeof IMPORTABLE_MEMBER_ROLES)[number]))
      errors.push(`role must be one of ${IMPORTABLE_MEMBER_ROLES.join(", ")}`);

    if (errors.length === 0 && phoneKey.length === 9) seen.add(phoneKey);

    return {
      line: record.line,
      full_name: fullName,
      phone_number: phone,
      email,
      role,
      notes: values.notes ?? "",
      errors,
    };
  });
}

/* ────────────────────────────── Loans (8F) ────────────────────────────── */

export const LOAN_COLUMNS = [
  "member_phone",
  "amount",
  "purpose",
  "loan_type",
  "repayment_months",
  "disbursed_date",
  "status",
  "notes",
] as const;

export const LOAN_TYPES = ["project", "emergency"] as const;
export const IMPORTABLE_LOAN_STATUSES = ["submitted", "approved"] as const;

export type LoanImportRow = {
  line: number;
  member_phone: string;
  amount: string;
  purpose: string;
  loan_type: string;
  repayment_months: string;
  disbursed_date: string;
  status: string;
  notes: string;
  memberId: string | null;
  errors: string[];
};

export const loanTemplateCsv = (): string =>
  [
    LOAN_COLUMNS.join(","),
    "0712345678,30000,Stock purchase,project,6,2026-01-15,approved,Imported historical loan",
    "0723456789,15000,Medical emergency,emergency,3,,submitted,",
  ].join("\n") + "\n";

/**
 * Validate parsed loan records. Approved rows rely on the existing database
 * trigger to generate the repayment schedule.
 */
export function validateLoanRows(records: CsvRecord[], members: MemberOption[]): LoanImportRow[] {
  const byPhone = new Map<string, MemberOption>();
  members.forEach((member) => {
    const key = normPhone(member.phone_number);
    if (key.length === 9 && !byPhone.has(key)) byPhone.set(key, member);
  });

  return records.map((record) => {
    const values = record.values;
    const phone = (values.member_phone ?? "").trim();
    const rawType = (values.loan_type ?? "").trim().toLowerCase();
    const loan_type = rawType || "project";
    const rawStatus = (values.status ?? "").trim().toLowerCase();
    const status = rawStatus || "submitted";
    const months = (values.repayment_months ?? "").trim();
    const disbursed = (values.disbursed_date ?? "").trim();
    const errors: string[] = [];

    const member = byPhone.get(normPhone(phone));
    if (!phone) errors.push("member_phone is required");
    else if (!member) errors.push(`No approved member matches ${phone}`);

    const amount = Number(values.amount ?? "");
    if (!(values.amount ?? "").trim()) errors.push("amount is required");
    else if (Number.isNaN(amount) || amount <= 0) errors.push("amount must be a positive number");

    if (!(values.purpose ?? "").trim()) errors.push("purpose is required");

    if (!LOAN_TYPES.includes(loan_type as (typeof LOAN_TYPES)[number]))
      errors.push(`loan_type must be one of ${LOAN_TYPES.join(", ")}`);

    const monthCount = Number(months);
    if (!months) errors.push("repayment_months is required");
    else if (Number.isNaN(monthCount) || monthCount <= 0 || !Number.isInteger(monthCount))
      errors.push("repayment_months must be a positive whole number");

    if (disbursed && !isValidIsoDate(disbursed)) errors.push("disbursed_date must be YYYY-MM-DD");

    if (!IMPORTABLE_LOAN_STATUSES.includes(status as (typeof IMPORTABLE_LOAN_STATUSES)[number]))
      errors.push(`status must be one of ${IMPORTABLE_LOAN_STATUSES.join(", ")}`);

    return {
      line: record.line,
      member_phone: phone,
      amount: values.amount ?? "",
      purpose: (values.purpose ?? "").trim(),
      loan_type,
      repayment_months: months,
      disbursed_date: disbursed,
      status,
      notes: values.notes ?? "",
      memberId: member ? member.id : null,
      errors,
    };
  });
}
