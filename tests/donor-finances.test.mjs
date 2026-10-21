import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/donor-finances.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, console });
const { donorLifetimeTotal, countActiveDonors } = module.exports;

test("donor lifetime total sums only that donor's income transactions", () => {
  const transactions = [
    { type: "income", donor_id: "st-fransis", amount: 269500 },
    { type: "income", donor_id: "st-fransis", amount: 12550 },
    { type: "expense", donor_id: "st-fransis", amount: 5000 },
    { type: "income", donor_id: "other-donor", amount: 10000 },
    { type: "income", donor_id: null, amount: 900 },
  ];

  assert.equal(donorLifetimeTotal(transactions, "st-fransis"), 282050);
});

test("active donors are distinct donors with a positive income transaction", () => {
  const transactions = [
    { type: "income", donor_id: "st-fransis", amount: 269500 },
    { type: "income", donor_id: "st-fransis", amount: 12550 },
    { type: "income", donor_id: "other-donor", amount: 1 },
    { type: "income", donor_id: "zero-donor", amount: 0 },
    { type: "expense", donor_id: "expense-only", amount: 100 },
    { type: "income", donor_id: null, amount: 500 },
  ];

  assert.equal(countActiveDonors(transactions), 2);
});
