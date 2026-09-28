import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Transpile the real RBAC module and exercise it without a browser.
const source = readFileSync(new URL("../src/lib/rbac.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, console });
const { roleFlags, buildNavigation, OFFICER_ROLES } = module.exports;

// Arrays built inside the vm belong to another realm, so copy them into the
// host realm before deep-comparing.
/** Flatten a navigation tree into the URLs a role can reach. */
const urlsFor = (roles) => [
  ...buildNavigation(roles).flatMap((section) => section.items.map((i) => i.url)),
];

const sectionLabels = (roles) => [...buildNavigation(roles).map((section) => section.label)];

const itemsFor = (roles) => [...buildNavigation(roles).flatMap((s) => s.items)];

test("type-only imports are erased so the module runs standalone", () => {
  assert.ok(!compiled.includes("require("), "rbac.ts must stay dependency-free at runtime");
});

test("member sees only its own records", () => {
  const flags = roleFlags(["member"]);
  assert.equal(flags.isMember, true);
  assert.equal(flags.isOfficer, false);
  assert.equal(flags.isFinanceOfficer, false);
  assert.equal(flags.isSecretariat, false);
  assert.deepEqual(urlsFor(["member"]), [
    "/dashboard",
    "/my-contributions",
    "/my-loans",
    "/meetings",
    "/my-account",
  ]);
  assert.deepEqual(sectionLabels(["member"]), ["My Account"]);
});

test("meetings are read-only for everyone except the secretariat", () => {
  const memberMeetings = itemsFor(["member"]).find((item) => item.url === "/meetings");
  assert.equal(memberMeetings.hint, "view only");

  const secretaryMeetings = itemsFor(["secretary"]).find((item) => item.url === "/meetings");
  assert.equal(secretaryMeetings.hint, undefined);
});

test("treasurer gets the finance workspace but not administration", () => {
  const flags = roleFlags(["treasurer"]);
  assert.equal(flags.isFinanceOfficer, true);
  assert.equal(flags.isSecretariat, false);

  const urls = urlsFor(["treasurer"]);
  for (const url of [
    "/contributions-review",
    "/transactions",
    "/financial-statements",
    "/loans-review",
    "/audit-logs",
    "/member-profile",
  ]) {
    assert.ok(urls.includes(url), `treasurer should reach ${url}`);
  }
  for (const url of ["/users", "/loan-rules", "/data-import", "/donors", "/loan-votes"]) {
    assert.ok(!urls.includes(url), `treasurer should not reach ${url}`);
  }
  assert.deepEqual(sectionLabels(["treasurer"]), ["My Account", "Management"]);
});

test("chairman reviews loans and financials but not contributions", () => {
  const flags = roleFlags(["chairman"]);
  assert.equal(flags.isFinanceOfficer, true);
  assert.equal(flags.isChairman, true);

  const urls = urlsFor(["chairman"]);
  assert.ok(urls.includes("/loans-review"));
  assert.ok(urls.includes("/audit-logs"));
  assert.ok(urls.includes("/financial-statements"));
  assert.ok(urls.includes("/member-profile"));
  assert.ok(urls.includes("/loan-votes"));
  assert.ok(!urls.includes("/contributions-review"), "chairman must not review contributions");
  assert.ok(!urls.includes("/transactions"));
  assert.ok(!urls.includes("/donors"));
});

test("secretary and assistant secretary get identical navigation", () => {
  assert.deepEqual(urlsFor(["secretary"]), urlsFor(["assistant_secretary"]));
  const urls = urlsFor(["secretary"]);
  assert.ok(urls.includes("/donors"));
  assert.ok(urls.includes("/meetings"));
  assert.ok(!urls.includes("/contributions-review"));
  assert.ok(!urls.includes("/financial-statements"));
  assert.ok(!urls.includes("/audit-logs"));
});

test("board member only reaches loan votes", () => {
  const flags = roleFlags(["board_member"]);
  assert.equal(flags.isBoardMember, true);
  assert.equal(flags.isFinanceOfficer, false);

  const urls = urlsFor(["board_member"]);
  assert.ok(urls.includes("/loan-votes"));
  assert.ok(!urls.includes("/contributions-review"));
  assert.ok(!urls.includes("/loans-review"));
  assert.ok(!urls.includes("/donors"));
});

test("admin sees every section including administration", () => {
  const flags = roleFlags(["admin"]);
  assert.equal(flags.isOfficer, true);
  assert.equal(flags.isFinanceOfficer, true);
  assert.equal(flags.isSecretariat, true);

  assert.deepEqual(sectionLabels(["admin"]), ["My Account", "Management", "Administration"]);
  const urls = urlsFor(["admin"]);
  for (const url of [
    "/dashboard",
    "/my-account",
    "/contributions-review",
    "/transactions",
    "/financial-statements",
    "/loans-review",
    "/audit-logs",
    "/member-profile",
    "/donors",
    "/loan-votes",
    "/users",
    "/loan-rules",
    "/data-import",
  ]) {
    assert.ok(urls.includes(url), `admin should reach ${url}`);
  }
});

test("a user holding no roles still sees their own account", () => {
  assert.deepEqual(urlsFor([]), [
    "/dashboard",
    "/my-contributions",
    "/my-loans",
    "/meetings",
    "/my-account",
  ]);
});

test("an admin who is also a member keeps their own records", () => {
  const urls = urlsFor(["admin", "member"]);
  assert.ok(urls.includes("/my-contributions"));
  assert.ok(urls.includes("/my-loans"));
});

test("officers without the member role do not get my-contributions or my-loans", () => {
  const urls = urlsFor(["treasurer"]);
  assert.ok(!urls.includes("/my-contributions"));
  assert.ok(!urls.includes("/my-loans"));
});

test("every officer role is recognised", () => {
  assert.deepEqual(
    [...OFFICER_ROLES].sort(),
    ["admin", "assistant_secretary", "board_member", "chairman", "secretary", "treasurer"].sort(),
  );
  for (const role of OFFICER_ROLES) {
    assert.equal(roleFlags([role]).isOfficer, true, `${role} should count as an officer`);
  }
  assert.equal(roleFlags(["member"]).isOfficer, false);
});
