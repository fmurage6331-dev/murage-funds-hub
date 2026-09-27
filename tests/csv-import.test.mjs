import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Transpile the real CSV import helper and exercise it without a browser.
const source = readFileSync(new URL("../src/lib/csv-import.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, console, Blob, URL });
const {
  parseCsvText,
  parseCsvRecords,
  validateContributionRows,
  contributionTemplateCsv,
  isValidIsoDate,
  normPhone,
} = module.exports;

const MEMBERS = [
  { id: "m1", full_name: "Jane Wanjiru", phone_number: "0712345678" },
  { id: "m2", full_name: "Peter Kamau", phone_number: "+254723456789" },
];

const header = "member_phone,member_name,amount,mpesa_ref,date,method,notes";

test("parseCsvText handles quoted fields with commas and CRLF", () => {
  const rows = [...parseCsvText('a,"b,1",c\r\nd,e,f\r\n')].map((cells) => [...cells]);
  assert.deepEqual(rows, [
    ["a", "b,1", "c"],
    ["d", "e", "f"],
  ]);
});

test("parseCsvText handles escaped quotes and drops blank lines", () => {
  const rows = [...parseCsvText('x,"say ""hi"""\n\n')].map((cells) => [...cells]);
  assert.deepEqual(rows, [["x", 'say "hi"']]);
});

test("parseCsvRecords keys rows by lowercased header", () => {
  const { headers, records } = parseCsvRecords(
    `${header}\n0712345678,Jane,5000,REF1,2026-01-31,mpesa,note\n`,
  );
  assert.deepEqual(
    [...headers],
    ["member_phone", "member_name", "amount", "mpesa_ref", "date", "method", "notes"],
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].line, 2);
  assert.equal(records[0].values.mpesa_ref, "REF1");
});

test("normPhone compares the last 9 digits across formats", () => {
  assert.equal(normPhone("0712345678"), "712345678");
  assert.equal(normPhone("+254 712 345 678"), "712345678");
  assert.equal(normPhone(null), "");
});

test("isValidIsoDate rejects malformed and impossible dates", () => {
  assert.equal(isValidIsoDate("2026-01-31"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("31/01/2026"), false);
});

test("validateContributionRows matches members, defaults method and flags errors", () => {
  const csv = [
    header,
    "0712345678,Jane Wanjiru,5000,QK1,2026-01-31,,January",
    "0723456789,Peter Kamau,2500,QK2,2026-02-15,bank,",
    "0799999999,Unknown Person,1000,QK3,2026-02-15,cash,",
    "0712345678,Jane Wanjiru,-5,QK4,2026-13-01,mpesa,",
  ].join("\n");
  const { records } = parseCsvRecords(csv);
  const rows = validateContributionRows(records, MEMBERS, []);

  assert.equal(rows[0].memberId, "m1");
  assert.equal(rows[0].method, "mpesa");
  assert.deepEqual([...rows[0].errors], []);

  assert.equal(rows[1].memberId, "m2");
  assert.deepEqual([...rows[1].errors], []);

  assert.equal(rows[2].memberId, null);
  assert.match(rows[2].errors.join("; "), /No approved member matches 0799999999/);

  assert.match(rows[3].errors.join("; "), /amount must be a positive number/);
  assert.match(rows[3].errors.join("; "), /date must be YYYY-MM-DD/);
});

test("validateContributionRows skips refs that already exist or repeat in-file", () => {
  const csv = [
    header,
    "0712345678,Jane,100,EXISTS,2026-01-01,mpesa,",
    "0712345678,Jane,100,EXISTS,2026-01-02,mpesa,",
    "0712345678,Jane,100,NEW,2026-01-03,mpesa,",
  ].join("\n");
  const { records } = parseCsvRecords(csv);
  const rows = validateContributionRows(records, MEMBERS, ["exists"]);

  assert.equal(rows[0].duplicate, true);
  assert.equal(rows[0].errors.length, 0);
  assert.equal(rows[1].duplicate, true);
  assert.equal(rows[2].duplicate, false);
});

test("template has the documented columns", () => {
  assert.match(
    contributionTemplateCsv(),
    /^member_phone,member_name,amount,mpesa_ref,date,method,notes\n/,
  );
});

const { validateMemberRows, validateLoanRows, memberTemplateCsv, loanTemplateCsv } = module.exports;

test("validateMemberRows requires name, unique phone and allowed role", () => {
  const csv = [
    "full_name,phone_number,email,role,notes",
    "Jane Wanjiru,0712345678,jane@example.com,member,",
    "Peter Kamau,0723456789,,treasurer,",
    "Peter Kamau,0712345678,,member,",
    ",0700000000,bad-email,member,",
  ].join("\n");
  const { records } = parseCsvRecords(csv);
  const rows = validateMemberRows(records, ["+254 723 456 789"]);

  assert.deepEqual([...rows[0].errors], []);
  assert.equal(rows[0].role, "member");
  assert.match(rows[1].errors.join("; "), /already exists or repeats in file/);
  assert.match(rows[1].errors.join("; "), /role must be one of/);
  assert.match(rows[2].errors.join("; "), /already exists or repeats in file/);
  assert.match(rows[3].errors.join("; "), /full_name is required/);
  assert.match(rows[3].errors.join("; "), /email looks invalid/);
});

test("validateMemberRows defaults a blank role to member", () => {
  const { records } = parseCsvRecords(
    "full_name,phone_number,email,role,notes\nAnn Njeri,0733000111,,,",
  );
  const rows = validateMemberRows(records, []);
  assert.equal(rows[0].role, "member");
  assert.deepEqual([...rows[0].errors], []);
});

test("validateLoanRows validates member, amount, type, months and status", () => {
  const csv = [
    "member_phone,amount,purpose,loan_type,repayment_months,disbursed_date,status,notes",
    "0712345678,30000,Stock purchase,project,6,2026-01-15,approved,",
    "0712345678,0,Purpose,project,6,2026-01-15,approved,",
    "0799999999,1000,Purpose,project,6,,submitted,",
    "0712345678,1000,,holiday,6,15/01/2026,paid,",
  ].join("\n");
  const { records } = parseCsvRecords(csv);
  const rows = validateLoanRows(records, MEMBERS);

  assert.equal(rows[0].memberId, "m1");
  assert.equal(rows[0].status, "approved");
  assert.deepEqual([...rows[0].errors], []);

  assert.match(rows[1].errors.join("; "), /amount must be a positive number/);
  assert.match(rows[2].errors.join("; "), /No approved member matches 0799999999/);
  assert.match(rows[3].errors.join("; "), /purpose is required/);
  assert.match(rows[3].errors.join("; "), /loan_type must be one of/);
  assert.match(rows[3].errors.join("; "), /disbursed_date must be YYYY-MM-DD/);
  assert.match(rows[3].errors.join("; "), /status must be one of/);
});

test("member and loan templates carry the documented columns", () => {
  assert.match(memberTemplateCsv(), /^full_name,phone_number,email,role,notes\n/);
  assert.match(
    loanTemplateCsv(),
    /^member_phone,amount,purpose,loan_type,repayment_months,disbursed_date,status,notes\n/,
  );
});
