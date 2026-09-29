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

/** Load a dependency-free Edge Function module (transpiled to CommonJS) for the vm sandbox. */
function loadSharedModule(relativePath) {
  const shared = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(shared, { module, exports: module.exports, console: { error() {} } });
  return module.exports;
}
// The handler mints synthetic emails with the same helper the client uses.
const sharedPhone = loadSharedModule("../supabase/functions/_shared/phone.ts");
const DEFAULT_PASSWORD = sharedPhone.DEFAULT_MEMBER_PASSWORD;

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
  const profile = {
    id: "member",
    full_name: "Jane Doe",
    email: null,
    phone_number: "0712345678",
    ...options.profile,
  };
  // By default the Auth user carries the synthetic email the import flow mints for this phone
  // number, i.e. the common case of an imported phone-only member.
  const authUser = {
    id: "member",
    email: sharedPhone.phoneToSyntheticEmail(profile.phone_number),
    phone: undefined,
    ...options.authUser,
  };
  const db = {
    auth: {
      getUser: async () => ({
        data: {
          user: options.invalidToken ? null : { id: "verified-admin", email: "admin@example.com" },
        },
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
        getUserById: async (id) => {
          calls.push(["getUser", id]);
          return options.authUserMissing
            ? { data: null, error: { message: "User not found" } }
            : { data: { user: authUser }, error: null };
        },
        updateUserById: async (id, args) => {
          calls.push(["updateUser", id, args]);
          return options.passwordUpdateFailure
            ? { data: null, error: { message: "password should be at least 6 characters" } }
            : { data: { user: { id } }, error: null };
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
          return {
            error:
              options.profileFailure && table === "profiles"
                ? new Error("profile write failed")
                : null,
          };
        },
        insert: async (data) => {
          calls.push(["insert", table, data]);
          if (table !== "audit_logs") return { error: null };
          // audit_logs.action is CHECK-constrained to INSERT/UPDATE/DELETE in some deployments.
          if (options.auditCheckFailure && data.action === "password_reset_by_admin") {
            return {
              error: { message: 'violates check constraint "audit_logs_action_check"' },
            };
          }
          return {
            error: options.auditInsertFailure ? { message: "audit write failed" } : null,
          };
        },
        maybeSingle: async () => ({
          data:
            table === "user_roles"
              ? options.nonAdmin
                ? null
                : { id: "admin-role" }
              : table === "pending_registrations"
                ? registration
                : options.profileMissing
                  ? null
                  : profile,
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
    // The handler's only runtime dependency is the shared phone helper.
    require: (specifier) => {
      if (String(specifier).endsWith("_shared/phone.ts")) return sharedPhone;
      throw new Error(`Unexpected require in admin-actions test: ${String(specifier)}`);
    },
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
  // Members sign in with a password straight away: the issued default, not an unusable random one.
  assert.equal(create[1].password, DEFAULT_PASSWORD);
  assert.equal(create[1].user_metadata.full_name, "Jane Doe");
  assert.equal(create[1].user_metadata.phone_number, "0712345678");

  const upsertProfile = calls.find((call) => call[0] === "upsert" && call[1] === "profiles");
  assert.equal(upsertProfile[2].is_default_password, true);
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

test("create_manual_member without email mints a synthetic email so the member can sign in", async () => {
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
  assert.equal(body.memberId, "created-user");

  // profiles.id and user_roles.user_id reference auth.users, so a phone-only member still needs an
  // Auth identity. Members sign in with a password and never an SMS code, so the identity is an
  // email derived from their number: they type 0722000000 at /auth and reach this account.
  const create = calls.find((call) => call[0] === "create");
  assert.equal(create[1].email, "254722000000@murage.foundation");
  assert.equal(create[1].password, DEFAULT_PASSWORD);
  assert.equal(create[1].email_confirm, true);
  assert.equal(create[1].phone, undefined);
  assert.equal(create[1].phone_confirm, undefined);
  assert.equal(create[1].user_metadata.full_name, "John Kamau");
  assert.equal(create[1].user_metadata.phone_number, "0722000000");

  const upsertProfile = calls.find((call) => call[0] === "upsert" && call[1] === "profiles");
  assert.equal(upsertProfile[2].id, "created-user");
  assert.equal(upsertProfile[2].full_name, "John Kamau");
  // The synthetic address is an Auth-only identifier: it is never written to the profile.
  assert.equal(upsertProfile[2].email, null);
  assert.equal(upsertProfile[2].phone_number, "0722000000");
  // Phone login means these members can use the web app, so nobody is bot-only any more.
  assert.equal(upsertProfile[2].phone_only_member, false);
  assert.equal(upsertProfile[2].is_default_password, true);
  assert.equal(upsertProfile[2].status, "approved");
  assert.equal(upsertProfile[2].consent_given, true);
  assert.equal(upsertProfile[2].whatsapp_opt_in, true);

  const upsertRole = calls.find((call) => call[0] === "upsert" && call[1] === "user_roles");
  assert.equal(upsertRole[2].user_id, "created-user");
  assert.equal(upsertRole[2].role, "member");
});

test("a profile write failure deletes the new Auth user so a retry is not blocked", async () => {
  const { request, calls } = setup({ profileFailure: true });
  const response = await request({
    action: "create_manual_member",
    fullName: "John Kamau",
    phoneNumber: "0722000000",
    email: null,
    role: "member",
  });
  assert.equal(response.status, 500);
  assert.equal(
    calls.some((call) => call[0] === "delete" && call[1] === "created-user"),
    true,
  );
  assert.equal(
    calls.some((call) => call[0] === "upsert" && call[1] === "user_roles"),
    false,
  );
});

/* ── Admin password reset (resetMemberPassword) ─────────────────────────── */

const resetBody = { action: "resetMemberPassword", userId };

test("resetMemberPassword is admin-only and validates the user id", async () => {
  const denied = setup({ nonAdmin: true });
  assert.equal((await denied.request(resetBody)).status, 403);
  assert.equal(denied.calls.length, 0);

  const invalid = setup();
  assert.equal((await invalid.request({ action: "resetMemberPassword" })).status, 400);
  assert.equal(
    (await invalid.request({ action: "resetMemberPassword", userId: "bad" })).status,
    400,
  );
  assert.equal(invalid.calls.length, 0);
});

test("resetMemberPassword restores the default password and re-arms the warning flag", async () => {
  const { request, calls } = setup();
  const response = await request(resetBody);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);

  const update = calls.find((call) => call[0] === "updateUser");
  assert.equal(update[1], userId);
  assert.equal(update[2].password, DEFAULT_PASSWORD);
  // This member already signs in with their synthetic email, so no identity change is needed.
  assert.equal(update[2].email, undefined);

  const profileWrite = calls.find((call) => call[0] === "update" && call[1] === "profiles");
  assert.equal(profileWrite[2].is_default_password, true);
  assert.equal(profileWrite[2].phone_only_member, false);
});

test("every reset lands in the append-only audit log without recording the password", async () => {
  const { request, calls } = setup();
  assert.equal((await request(resetBody)).status, 200);
  const audit = calls.find((call) => call[0] === "insert" && call[1] === "audit_logs");
  assert.equal(audit[2].action, "password_reset_by_admin");
  assert.equal(audit[2].table_name, "auth.users");
  assert.equal(audit[2].record_id, userId);
  assert.equal(audit[2].performed_by, "verified-admin");
  assert.equal(audit[2].performed_by_email, "admin@example.com");
  assert.deepEqual([...audit[2].changed_fields], ["password", "is_default_password"]);
  assert.equal(audit[2].new_values.event, "password_reset_by_admin");
  assert.equal(audit[2].new_values.member_name, "Jane Doe");
  assert.equal(JSON.stringify(audit[2]).includes(DEFAULT_PASSWORD), false);
});

test("a CHECK-constrained audit action falls back to an UPDATE row naming the event", async () => {
  const { request, calls } = setup({ auditCheckFailure: true });
  const response = await request(resetBody);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).warning, undefined);
  const audits = calls.filter((call) => call[0] === "insert" && call[1] === "audit_logs");
  assert.equal(audits.length, 2);
  assert.equal(audits[0][2].action, "password_reset_by_admin");
  assert.equal(audits[1][2].action, "UPDATE");
  assert.equal(audits[1][2].new_values.event, "password_reset_by_admin");
  assert.equal(audits[1][2].record_id, userId);
});

test("an unwritable audit log still resets the password but warns the admin", async () => {
  const { request, calls } = setup({ auditCheckFailure: true, auditInsertFailure: true });
  const response = await request(resetBody);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.warning, /audit entry/i);
  assert.ok(calls.some((call) => call[0] === "updateUser"));
});

test("a member with a real email is told their password was reset", async () => {
  const { request, calls } = setup({
    profile: { email: "jane@example.com", full_name: "Jane Doe", phone_number: "0712345678" },
    authUser: { email: "jane@example.com" },
  });
  const response = await request(resetBody);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).warning, undefined);

  const sent = calls.find((call) => call[0] === "email");
  assert.match(sent[1], /\/functions\/v1\/send-email$/);
  assert.equal(sent[2].to, "jane@example.com");
  assert.equal(sent[2].subject, "Your Murage Foundation password has been reset");
  assert.equal(sent[2].template, "admin_password_reset");
  assert.equal(sent[2].data.memberName, "Jane Doe");
  assert.equal(sent[2].data.defaultPassword, DEFAULT_PASSWORD);
  assert.equal(sent[2].data.login, "jane@example.com");
  assert.equal(sent[2].data.phoneNumber, "0712345678");
  assert.equal(sent[2].data.paybillNumber, "522522");
  assert.equal(sent[2].data.paybillAccount, "7989164");
  assert.equal(sent[2].data.supportPhone, "+254182528510");
  // The email goes out only after the reset and the audit entry have been written.
  assert.ok(calls.findIndex((call) => call[0] === "updateUser") < calls.indexOf(sent));
});

test("phone-only members are never emailed, not even at their synthetic address", async () => {
  const { request, calls } = setup();
  assert.equal((await request(resetBody)).status, 200);
  assert.equal(
    calls.some((call) => call[0] === "email"),
    false,
  );
});

test("a synthetic address stored on the profile counts as no email at all", async () => {
  const { request, calls } = setup({
    profile: { email: "254712345678@murage.foundation" },
    authUser: { email: "254712345678@murage.foundation" },
  });
  assert.equal((await request(resetBody)).status, 200);
  assert.equal(
    calls.some((call) => call[0] === "email"),
    false,
  );
});

test("an undeliverable reset email still succeeds and warns the admin", async () => {
  const { request } = setup({
    emailFailure: true,
    profile: { email: "jane@example.com", full_name: "Jane Doe" },
    authUser: { email: "jane@example.com" },
  });
  const response = await request(resetBody);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.warning, /did not send/);
  assert.match(body.warning, /12345678/);
});

test("a legacy phone-backed Auth user gains a synthetic email so the reset is usable", async () => {
  const { request, calls } = setup({
    profile: { email: null, phone_number: "0700000000" },
    authUser: { email: null, phone: "254700000000" },
  });
  assert.equal((await request(resetBody)).status, 200);
  const update = calls.find((call) => call[0] === "updateUser");
  assert.equal(update[2].password, DEFAULT_PASSWORD);
  assert.equal(update[2].email, "254700000000@murage.foundation");
  assert.equal(update[2].email_confirm, true);
  // The synthetic address stays out of the profile row.
  const profileWrite = calls.find((call) => call[0] === "update" && call[1] === "profiles");
  assert.equal(profileWrite[2].email, undefined);
  assert.equal(profileWrite[2].is_default_password, true);
  const audit = calls.find((call) => call[0] === "insert" && call[1] === "audit_logs");
  assert.equal(audit[2].new_values.synthetic_email_provisioned, true);
});

test("a missing member or Auth user is reported without any write", async () => {
  const noProfile = setup({ profileMissing: true });
  assert.equal((await noProfile.request(resetBody)).status, 404);
  assert.equal(
    noProfile.calls.some((call) => call[0] === "updateUser"),
    false,
  );

  const noAuthUser = setup({ authUserMissing: true });
  assert.equal((await noAuthUser.request(resetBody)).status, 404);
  assert.equal(
    noAuthUser.calls.some((call) => call[0] === "updateUser"),
    false,
  );
});

test("a rejected password update reports the Auth error and writes no flag or audit row", async () => {
  const { request, calls } = setup({ passwordUpdateFailure: true });
  const response = await request(resetBody);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /password/);
  assert.equal(
    calls.some((call) => call[0] === "update" && call[1] === "profiles"),
    false,
  );
  assert.equal(
    calls.some((call) => call[0] === "insert" && call[1] === "audit_logs"),
    false,
  );
});
