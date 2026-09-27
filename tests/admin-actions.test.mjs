import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Execute the real Edge handler with a mocked Supabase boundary, without Deno or network access.
const source = readFileSync(
  new URL("../supabase/functions/admin-actions/index.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source.replace(/^import .*createClient.*\n/m, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const RESET_LINK =
  "https://project.supabase.co/auth/v1/verify?token=recovery-token&type=recovery&redirect_to=https%3A%2F%2Fapp";
function setup(options = {}) {
  let handler;
  const calls = [];
  const registration = {
    id: "22222222-2222-2222-2222-222222222222",
    status: "pending",
    email: null,
    phone_number: "254700000000",
    full_name: "Member",
    requested_role: "member",
    ...options.registration,
  };
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: options.invalidToken ? null : { id: "verified-admin" } },
        error: null,
      }),
      admin: {
        // inviteUserByEmail is intentionally absent: email confirmation is disabled, so any
        // invitation call would throw and fail the test instead of silently passing.
        createUser: async (args) => {
          calls.push(["create", args]);
          return { data: { user: { id: "created-user" } }, error: null };
        },
        generateLink: async (args) => {
          calls.push(["link", args]);
          return options.linkFailure
            ? { data: null, error: { message: "recovery link unavailable" } }
            : { data: { properties: { action_link: RESET_LINK } }, error: null };
        },
        deleteUser: async (id) => {
          calls.push(["delete", id]);
          return { error: null };
        },
      },
    },
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: (data) => {
          calls.push(["update", table, data]);
          return chain;
        },
        upsert: async (data, opts) => {
          calls.push(["upsert", table, data, opts]);
          return { error: null };
        },
        insert: async (data) => {
          calls.push(["insert", table, data]);
          return { error: null };
        },
        maybeSingle: async () => ({
          data:
            table === "user_roles"
              ? options.nonAdmin
                ? null
                : { id: "admin-role" }
              : table === "pending_registrations"
                ? registration
                : { id: "member" },
          error: null,
        }),
      };
      return chain;
    },
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return { error: options.rpcFailure ? new Error("database failure") : null };
    },
  };
  vm.runInNewContext(compiled, {
    exports: {},
    Request,
    Response,
    console: { error() {} },
    crypto: globalThis.crypto,
    fetch: async (url, init) => {
      calls.push(["email", url, JSON.parse(init.body)]);
      return { ok: !options.emailFailure };
    },
    createClient: () => db,
    Deno: {
      env: { get: () => "test" },
      serve: (fn) => {
        handler = fn;
      },
    },
  });
  const request = (body, { method = "POST", token = "valid", raw } = {}) =>
    handler(
      new Request("https://example.com/admin-actions", {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
      }),
    );
  return { request, calls, registration };
}
const userId = "11111111-1111-1111-1111-111111111111";
test("CORS preflight and unsupported methods", async () => {
  const { request } = setup();
  const preflight = await request(null, { method: "OPTIONS", token: null });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal((await request(null, { method: "GET" })).status, 405);
});
test("missing/invalid JWT and non-admin are denied without writes", async () => {
  for (const [options, token, expected] of [
    [{}, null, 401],
    [{ invalidToken: true }, "bad", 401],
    [{ nonAdmin: true }, "valid", 403],
  ]) {
    const { request, calls } = setup(options);
    assert.equal((await request({ action: "approve_member", userId }, { token })).status, expected);
    assert.equal(calls.length, 0);
  }
});
test("invalid JSON, action, UUID and role fail before writes", async () => {
  const { request, calls } = setup();
  assert.equal((await request(null, { raw: "{" })).status, 400);
  for (const body of [
    null,
    [],
    { action: "unknown" },
    { action: "approve_member", userId: "bad" },
    { action: "approve_member", userId, role: "owner" },
  ]) {
    assert.equal((await request(body)).status, 400);
  }
  const unknown = await request({ action: "nope" });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error, "Unknown action");
  assert.equal(calls.length, 0);
});
test("member approval uses atomic RPC; rejection updates status", async () => {
  const { request, calls } = setup();
  assert.equal((await request({ action: "approve_member", userId })).status, 200);
  assert.equal(calls[0][1], "complete_admin_approval");
  assert.equal(calls[0][2].assigned_role, "member");
  assert.equal((await request({ action: "reject_member", userId })).status, 200);
  assert.equal(calls[1][2].status, "rejected");
});
test("bot approvals use persisted identity/role and authenticated actor", async () => {
  for (const email of [null, "member@example.com"]) {
    const { request, calls, registration } = setup({ registration: { email } });
    const response = await request({
      action: "approve_bot_registration",
      registrationId: registration.id,
      adminUserId: "forged",
      requestedRole: "admin",
      phoneNumber: "forged",
      email: "forged",
    });
    assert.equal(response.status, 200);
    // Email confirmation is disabled: every approval creates an Auth user, never an invitation.
    const create = calls.find((call) => call[0] === "create");
    assert.equal(create[1].user_metadata.phone_number, registration.phone_number);
    assert.equal(create[1].user_metadata.full_name, registration.full_name);
    if (!email) {
      assert.equal(create[1].phone, registration.phone_number);
      assert.equal(create[1].email_confirm, undefined);
      assert.equal(
        calls.some((call) => call[0] === "link" || call[0] === "email"),
        false,
      );
    } else {
      assert.equal(create[1].email, email);
      assert.equal(create[1].email_confirm, true);
      assert.match(
        create[1].password,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      const link = calls.find((call) => call[0] === "link");
      assert.equal(link[1].type, "recovery");
      assert.equal(link[1].email, email);
    }
    const upsert = calls.find((call) => call[0] === "upsert");
    assert.equal(upsert[2].phone_only_member, !email);
    const rpc = calls.find((call) => call[0] === "rpc");
    assert.equal(rpc[2].assigned_role, "member");
    assert.equal(rpc[2].actor_id, "verified-admin");
  }
});
test("email approval sends the recovery link, never the temporary password", async () => {
  const { request, calls, registration } = setup({
    registration: { email: "member@example.com" },
  });
  const response = await request({
    action: "approve_bot_registration",
    registrationId: registration.id,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.warning, undefined);
  const sent = calls.find((call) => call[0] === "email");
  assert.match(sent[1], /\/functions\/v1\/send-email$/);
  assert.equal(sent[2].to, registration.email);
  assert.equal(sent[2].template, "password_reset");
  assert.equal(sent[2].data.resetLink, RESET_LINK);
  assert.equal(sent[2].data.memberName, registration.full_name);
  const temporaryPassword = calls.find((call) => call[0] === "create")[1].password;
  assert.equal(JSON.stringify(sent[2]).includes(temporaryPassword), false);
  // The email goes out only after the approval transaction has committed.
  assert.ok(calls.findIndex((call) => call[0] === "rpc") < calls.indexOf(sent));
});
test("a failed recovery link rolls the new Auth user back instead of stranding them", async () => {
  const { request, calls, registration } = setup({
    registration: { email: "member@example.com" },
    linkFailure: true,
  });
  const response = await request({
    action: "approve_bot_registration",
    registrationId: registration.id,
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).success, undefined);
  assert.equal(calls.at(-1)[0], "delete");
  assert.equal(calls.at(-1)[1], "created-user");
  assert.equal(
    calls.some((call) => call[0] === "rpc" || call[0] === "upsert" || call[0] === "email"),
    false,
  );
});
test("an undeliverable reset email still approves and warns the admin", async () => {
  const { request, calls, registration } = setup({
    registration: { email: "member@example.com" },
    emailFailure: true,
  });
  const response = await request({
    action: "approve_bot_registration",
    registrationId: registration.id,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.warning, /did not send/);
  assert.ok(calls.some((call) => call[0] === "rpc"));
});
test("already approved is idempotent; rejected cannot be approved", async () => {
  for (const [status, expected] of [
    ["approved", 200],
    ["rejected", 409],
  ]) {
    const { request, calls, registration } = setup({ registration: { status } });
    assert.equal(
      (await request({ action: "approve_bot_registration", registrationId: registration.id }))
        .status,
      expected,
    );
    assert.equal(calls.length, 0);
  }
});
test("failed finalization reports failure and cleans up the new Auth user", async () => {
  const { request, calls, registration } = setup({ rpcFailure: true });
  const response = await request({
    action: "approve_bot_registration",
    registrationId: registration.id,
  });
  assert.equal(response.status, 500);
  assert.equal(calls.at(-1)[0], "delete");
  assert.equal(calls.at(-1)[1], "created-user");
  assert.equal((await response.json()).success, undefined);
});
test("bot rejection records the reason and the authenticated actor", async () => {
  const { request, calls, registration } = setup({
    registration: { email: "member@example.com" },
  });
  const response = await request({
    action: "reject_bot_registration",
    registrationId: registration.id,
    reason: "  Duplicate registration  ",
    approvedBy: "forged",
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  const write = calls.find((call) => call[0] === "update");
  assert.equal(write[1], "pending_registrations");
  assert.equal(write[2].status, "rejected");
  assert.equal(write[2].admin_notes, "Duplicate registration");
  assert.equal(write[2].approved_by, "verified-admin");
  assert.ok(write[2].approved_at);
  assert.equal(
    calls.some((call) => call[0] === "create" || call[0] === "link"),
    false,
  );
});
test("bot rejection validates input and registration state before writing", async () => {
  for (const [options, body, expected] of [
    [{}, { action: "reject_bot_registration", registrationId: "bad", reason: "no" }, 400],
    [{}, { action: "reject_bot_registration", registrationId: userId }, 400],
    [{}, { action: "reject_bot_registration", registrationId: userId, reason: "   " }, 400],
    [
      {},
      { action: "reject_bot_registration", registrationId: userId, reason: "x".repeat(2001) },
      400,
    ],
    [
      { registration: { status: "approved" } },
      { action: "reject_bot_registration", registrationId: userId, reason: "no" },
      409,
    ],
  ]) {
    const { request, calls } = setup(options);
    assert.equal(
      (await request({ ...body, registrationId: body.registrationId ?? userId })).status,
      expected,
    );
    assert.equal(calls.length, 0);
  }
});
test("repeating a bot rejection is a no-op", async () => {
  const { request, calls, registration } = setup({ registration: { status: "rejected" } });
  const response = await request({
    action: "reject_bot_registration",
    registrationId: registration.id,
    reason: "Already handled",
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(calls.length, 0);
});

test("create_manual_member with email creates Auth user, profile, and role", async () => {
  const { request, calls } = setup();
  const response = await request({
    action: "create_manual_member",
    fullName: "Jane Doe",
    phoneNumber: "0712345678",
    email: "jane@example.com",
    role: "secretary",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.memberId, "created-user");

  const create = calls.find((call) => call[0] === "create");
  assert.equal(create[1].email, "jane@example.com");
  assert.equal(create[1].email_confirm, true);
  assert.equal(create[1].user_metadata.full_name, "Jane Doe");
  assert.equal(create[1].user_metadata.phone_number, "0712345678");

  const upsertProfile = calls.find((call) => call[0] === "upsert" && call[1] === "profiles");
  assert.equal(upsertProfile[2].id, "created-user");
  assert.equal(upsertProfile[2].full_name, "Jane Doe");
  assert.equal(upsertProfile[2].email, "jane@example.com");
  assert.equal(upsertProfile[2].phone_number, "0712345678");
  assert.equal(upsertProfile[2].phone_only_member, false);
  assert.equal(upsertProfile[2].status, "approved");
  assert.equal(upsertProfile[2].consent_given, true);
  assert.equal(upsertProfile[2].whatsapp_opt_in, true);

  const upsertRole = calls.find((call) => call[0] === "upsert" && call[1] === "user_roles");
  assert.equal(upsertRole[2].user_id, "created-user");
  assert.equal(upsertRole[2].role, "secretary");
});

test("create_manual_member without email creates direct profile and role", async () => {
  const { request, calls } = setup();
  const response = await request({
    action: "create_manual_member",
    fullName: "John Kamau",
    phoneNumber: "0722000000",
    email: null,
    role: "member",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(body.memberId);

  // No auth createUser call
  assert.equal(
    calls.some((call) => call[0] === "create"),
    false,
  );

  const insertProfile = calls.find((call) => call[0] === "insert" && call[1] === "profiles");
  assert.equal(insertProfile[2].id, body.memberId);
  assert.equal(insertProfile[2].full_name, "John Kamau");
  assert.equal(insertProfile[2].email, null);
  assert.equal(insertProfile[2].phone_number, "0722000000");
  assert.equal(insertProfile[2].phone_only_member, true);
  assert.equal(insertProfile[2].status, "approved");
  assert.equal(insertProfile[2].consent_given, true);
  assert.equal(insertProfile[2].whatsapp_opt_in, true);

  const upsertRole = calls.find((call) => call[0] === "upsert" && call[1] === "user_roles");
  assert.equal(upsertRole[2].user_id, body.memberId);
  assert.equal(upsertRole[2].role, "member");
});
