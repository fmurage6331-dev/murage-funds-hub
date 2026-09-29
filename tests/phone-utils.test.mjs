import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Transpile the real phone helpers and exercise them without a browser or Deno.
function loadModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console });
  return module.exports;
}

const client = loadModule("../src/lib/phoneUtils.ts");
const edge = loadModule("../supabase/functions/_shared/phone.ts");

const {
  normalizePhone,
  phoneToSyntheticEmail,
  isPhoneNumber,
  isEmailAddress,
  isSyntheticEmail,
  resolveSignInEmail,
  phoneFromMetadata,
  DEFAULT_MEMBER_PASSWORD,
  SYNTHETIC_EMAIL_DOMAIN,
} = client;

test("the phone helper module stays dependency-free", () => {
  const source = readFileSync(new URL("../src/lib/phoneUtils.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("import "), "phoneUtils.ts must not import anything at runtime");
});

test("normalizePhone converts every documented Kenyan format to E.164", () => {
  for (const [input, expected] of [
    ["0724344102", "+254724344102"],
    ["0712345678", "+254712345678"],
    ["254724344102", "+254724344102"],
    ["+254724344102", "+254724344102"],
    ["+254 724 344 102", "+254724344102"],
    ["0724-344-102", "+254724344102"],
    ["(0724) 344.102", "+254724344102"],
    ["724344102", "+254724344102"],
    ["  0724344102  ", "+254724344102"],
  ]) {
    assert.equal(normalizePhone(input), expected, `normalizePhone(${JSON.stringify(input)})`);
  }
});

test("normalizePhone keeps overseas country codes intact", () => {
  assert.equal(normalizePhone("+16038095008"), "+16038095008");
  assert.equal(normalizePhone("+1 (603) 809-5008"), "+16038095008");
  assert.equal(normalizePhone("16038095008"), "+16038095008");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
});

test("phoneToSyntheticEmail strips the + and appends the foundation domain", () => {
  assert.equal(SYNTHETIC_EMAIL_DOMAIN, "murage.foundation");
  assert.equal(phoneToSyntheticEmail("+254724344102"), "254724344102@murage.foundation");
  assert.equal(phoneToSyntheticEmail("0724344102"), "254724344102@murage.foundation");
  assert.equal(phoneToSyntheticEmail("254724344102"), "254724344102@murage.foundation");
  assert.equal(phoneToSyntheticEmail("+1 (603) 809-5008"), "16038095008@murage.foundation");
});

test("isPhoneNumber accepts digits and separators but never an email", () => {
  for (const value of ["0712345678", "+254724344102", "0724-344-102", "(0724) 344 102", "1"]) {
    assert.equal(isPhoneNumber(value), true, value);
  }
  for (const value of ["jane@example.com", "0712345678@murage.foundation", "", "   ", "abc123"]) {
    assert.equal(isPhoneNumber(value), false, JSON.stringify(value));
  }
});

test("isEmailAddress and isSyntheticEmail classify the sign-in identifier", () => {
  assert.equal(isEmailAddress("jane@example.com"), true);
  assert.equal(isEmailAddress("0712345678"), false);
  assert.equal(isSyntheticEmail("254724344102@murage.foundation"), true);
  assert.equal(isSyntheticEmail("254724344102@MURAGE.foundation"), true);
  assert.equal(isSyntheticEmail("jane@example.com"), false);
  assert.equal(isSyntheticEmail(null), false);
  assert.equal(isSyntheticEmail(undefined), false);
});

test("resolveSignInEmail maps a typed identifier onto the Auth email", () => {
  assert.equal(resolveSignInEmail("jane@example.com"), "jane@example.com");
  assert.equal(resolveSignInEmail("  Jane@Example.com "), "Jane@Example.com");
  assert.equal(resolveSignInEmail("0724344102"), "254724344102@murage.foundation");
  assert.equal(resolveSignInEmail("+1 (603) 809-5008"), "16038095008@murage.foundation");
});

test("phoneFromMetadata reads the number stored on the Auth user", () => {
  assert.equal(phoneFromMetadata({ phone_number: "0724344102" }), "0724344102");
  assert.equal(phoneFromMetadata({ phone_number: "  " }), null);
  assert.equal(phoneFromMetadata({ full_name: "Jane" }), null);
  assert.equal(phoneFromMetadata(null), null);
  assert.equal(phoneFromMetadata("nope"), null);
});

test("the default member password is the documented 8-digit value", () => {
  assert.equal(DEFAULT_MEMBER_PASSWORD, "12345678");
  assert.equal(edge.DEFAULT_MEMBER_PASSWORD, DEFAULT_MEMBER_PASSWORD);
});

test("the Edge Function mirror agrees with the client on every input", () => {
  const inputs = [
    "0724344102",
    "0712345678",
    "254724344102",
    "+254724344102",
    "+254 724 344 102",
    "0724-344-102",
    "724344102",
    "+1 (603) 809-5008",
    "16038095008",
    "+44 20 7946 0958",
    "0700000000",
  ];
  for (const input of inputs) {
    assert.equal(edge.normalizePhone(input), normalizePhone(input), `normalizePhone(${input})`);
    assert.equal(
      edge.phoneToSyntheticEmail(input),
      phoneToSyntheticEmail(input),
      `phoneToSyntheticEmail(${input})`,
    );
  }
  for (const email of [
    "254724344102@murage.foundation",
    "jane@example.com",
    null,
    undefined,
    "someone@murage.foundation.ke",
  ]) {
    assert.equal(edge.isSyntheticEmail(email), isSyntheticEmail(email), String(email));
  }
  assert.equal(edge.SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_EMAIL_DOMAIN);
});
