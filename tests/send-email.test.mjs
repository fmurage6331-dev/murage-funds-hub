import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Execute the real send-email handler with a mocked Resend boundary, without Deno or network access.
const source = readFileSync(
  new URL("../supabase/functions/send-email/index.ts", import.meta.url),
  "utf8",
);
const compiled = ts
  .transpileModule(source.replace(/from "https:\/\/deno\.land[^"]*"/, 'from "__http_stub__"'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  .outputText.replace(/require\("__http_stub__"\)/g, "__httpStub");

const RESET_LINK =
  "https://project.supabase.co/auth/v1/verify?token=recovery-token&type=recovery&redirect_to=https%3A%2F%2Fapp";

function setup({ resendApiKey = "test-key" } = {}) {
  let handler;
  const sent = [];
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: { log() {}, error() {} },
    Request,
    Response,
    __httpStub: {
      serve: (fn) => {
        handler = fn;
      },
    },
    Deno: { env: { get: (key) => (key === "RESEND_API_KEY" ? resendApiKey : null) } },
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return { json: async () => ({ id: "email_1" }) };
    },
  };
  vm.runInNewContext(compiled, sandbox);
  const request = (payload) =>
    handler(
      new Request("https://example.com/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  return { request, sent };
}

const passwordReset = (data) => ({
  to: "member@example.com",
  subject: "Murage Foundation — set your password to sign in",
  template: "password_reset",
  data,
});

test("password_reset renders a set-password button with an escaped recovery link", async () => {
  const { request, sent } = setup();
  const response = await request(passwordReset({ memberName: "Jane Doe", resetLink: RESET_LINK }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.deepEqual(sent[0].body.to, ["member@example.com"]);
  const { html } = sent[0].body;
  assert.match(html, /Set my password<\/a>/);
  assert.ok(
    html.includes(
      'href="https://project.supabase.co/auth/v1/verify?token=recovery-token&amp;type=recovery&amp;redirect_to=https%3A%2F%2Fapp"',
    ),
  );
  assert.ok(html.includes("Jane Doe"));
  assert.ok(html.includes("+254182528510"), "admin contact is shown as a fallback");
});

test("member-supplied names and unsafe links cannot inject markup", async () => {
  const { request, sent } = setup();
  await request(
    passwordReset({
      memberName: '<script>alert("xss")</script> & Co',
      resetLink: "javascript:alert(1)",
    }),
  );
  const { html } = sent[0].body;
  assert.ok(!html.includes("<script>"), "raw script tag must not reach the email body");
  assert.ok(html.includes("&lt;script&gt;"), "the name is escaped instead");
  assert.ok(!/<a href="javascript/i.test(html), "a non-https link is never rendered as an anchor");
  assert.ok(html.includes("+254182528510"));
});

test("a missing link still renders a usable email pointing at the admin", async () => {
  const { request, sent } = setup();
  await request(passwordReset({ memberName: "Jane Doe" }));
  const { html } = sent[0].body;
  assert.ok(!/<a href=/i.test(html));
  assert.ok(html.includes("could not generate a password reset link"));
  assert.ok(html.includes("+254182528510"));
});

test("without RESEND_API_KEY the dispatch is simulated but still succeeds", async () => {
  const { request, sent } = setup({ resendApiKey: null });
  const response = await request(passwordReset({ memberName: "Jane", resetLink: RESET_LINK }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.result.simulated, true);
  assert.equal(sent.length, 0, "no provider call is made without an API key");
});

test("missing required fields are rejected before any dispatch", async () => {
  const { request, sent } = setup();
  const response = await request({ to: "member@example.com", template: "password_reset" });
  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});
