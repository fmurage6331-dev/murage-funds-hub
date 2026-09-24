import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, parseDeposit, joinRoles, kenyaToday } from "./bot-utils.ts";
import { advanceJoin, sessionExpired } from "./bot-flow.ts";

test("normalizes Kenyan phone formats and rejects invalid callers", () => {
  assert.equal(normalizePhone("+254712345678"), "254712345678");
  assert.equal(normalizePhone("0712345678"), "254712345678");
  assert.equal(normalizePhone("712345678"), "254712345678");
  assert.equal(normalizePhone("254 712 345 678"), "254712345678");
  assert.equal(normalizePhone("+254182528510"), "254182528510");
  assert.throws(() => normalizePhone("+256712345678"));
  assert.throws(() => normalizePhone("+254312345678")); // landline, not mobile
  assert.throws(() => normalizePhone("0712345678,254700000000"));
  assert.throws(() => normalizePhone("1234"));
});

test("DEPOSIT accepts only a positive amount and an alphanumeric reference", () => {
  assert.deepEqual(parseDeposit("deposit 5000 qwe123456"), { amount: 5000, ref: "QWE123456" });
  assert.deepEqual(parseDeposit("DEPOSIT 10.50 ABC123"), { amount: 10.5, ref: "ABC123" });
  for (const input of [
    "DEPOSIT",
    "DEPOSIT 0 ABC123",
    "DEPOSIT -50 ABC123",
    "DEPOSIT 1.001 ABC123",
    "DEPOSIT Infinity ABC123",
    "DEPOSIT 1 HI",
    "DEPOSIT 1 ABC!23",
    "DEPOSIT 999999999 ABC123",
  ]) {
    assert.equal(parseDeposit(input), null, input);
  }
});

test("JOIN collects name, one of four non-donor roles, email or SKIP and explicit consent", () => {
  assert.deepEqual(Object.values(joinRoles), [
    "member",
    "board_member",
    "secretary",
    "assistant_secretary",
  ]);
  let state = advanceJoin("name", {}, "Mary Njoki");
  assert.equal(state.step, "role");
  assert.equal(state.collected.name, "Mary Njoki");
  assert.equal(advanceJoin("role", state.collected, "5").action, "keep");
  state = advanceJoin("role", state.collected, "2");
  assert.equal(state.collected.role, "board_member");
  assert.equal(state.step, "email");
  assert.equal(advanceJoin("email", state.collected, "not-an-email").action, "keep");
  state = advanceJoin("email", state.collected, "SKIP");
  assert.equal(state.collected.email, null);
  assert.match(state.reply, /None - Phone Only/);
  assert.equal(advanceJoin("confirm", state.collected, "MAYBE").action, "keep");
  assert.equal(advanceJoin("confirm", state.collected, "YES").action, "complete");
  assert.equal(advanceJoin("confirm", state.collected, "NO").action, "cancel");
});

test("email registration and interrupted sessions cannot consume command text", () => {
  const name = advanceJoin("name", {}, "John Kamau");
  const role = advanceJoin("role", name.collected, "4");
  const email = advanceJoin("email", role.collected, "John@Example.com");
  assert.equal(email.collected.email, "john@example.com");
  assert.equal(email.collected.role, "assistant_secretary");
  assert.equal(advanceJoin("name", {}, "BAL").action, "keep");
  assert.match(advanceJoin("name", {}, "BAL").reply, /incomplete registration/);
  assert.equal(advanceJoin("email", role.collected, "DEPOSIT 5000 ABC123").action, "keep");
  const resume = advanceJoin("email", role.collected, "YES");
  assert.equal(resume.step, "email");
  assert.match(resume.reply, /SKIP/);
});

test("repayment dates use Kenya's calendar day, not the server's UTC date", () => {
  assert.equal(kenyaToday(new Date("2026-09-24T22:30:00Z")), "2026-09-25");
});

test("sessions expire after 30 minutes (UTC timestamps)", () => {
  const start = Date.parse("2026-09-24T12:00:00Z");
  const expires = new Date(start + 30 * 60 * 1000).toISOString();
  assert.equal(sessionExpired(expires, start + 29 * 60 * 1000), false);
  assert.equal(sessionExpired(expires, start + 30 * 60 * 1000), true);
});
