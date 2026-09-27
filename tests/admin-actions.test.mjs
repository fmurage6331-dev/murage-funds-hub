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
        createUser: async (args) => {
          calls.push(["create", args]);
          return { data: { user: { id: "created-user" } }, error: null };
        },
        inviteUserByEmail: async (...args) => {
          calls.push(["invite", ...args]);
          return { data: { user: { id: "created-user" } }, error: null };
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
        upsert: async (data) => {
          calls.push(["upsert", table, data]);
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
    assert.equal(calls[0][0], email ? "invite" : "create");
    if (!email) assert.equal(calls[0][1].phone, registration.phone_number);
    else assert.equal(calls[0][1], email);
    assert.equal(calls[1][2].phone_only_member, !email);
    assert.equal(calls[2][2].assigned_role, "member");
    assert.equal(calls[2][2].actor_id, "verified-admin");
  }
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
