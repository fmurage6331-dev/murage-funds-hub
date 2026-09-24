import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.5.8";

// The 20260918103... files are overlapping schema snapshots, not sequential
// migrations: several recreate the loan_repayments table and its policies.
// Exercise the bot migration against the earlier, runnable migration path.
// This is a local PostgreSQL smoke test, not a substitute for checking the
// hosted project's migration ledger or applying the migration there.
const priorMigrations = [
  "20260713132944_66c05c5e-cfe5-426b-a2a3-b69928c61db9.sql",
  "20260713132957_1e71f26d-9277-476c-903c-c9f285dd6840.sql",
  "20260714071640_82f1f0ca-2e33-4304-967e-49b89610cb54.sql",
  "20260714071736_9a880851-3744-48ad-90f0-59327f754693.sql",
  "20260720080000_loan_type_split.sql",
  "20260918090000_priority_1_audit_logs.sql",
  "20260918091000_priority_2_loan_repayments.sql",
  "20260918092000_priority_3_kdpa_compliance.sql",
  "20260918093000_priority_5_loan_risk_flags.sql",
  "20260918094000_security_hardening.sql",
] as const;

async function queryRows<T extends object>(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

Deno.test(
  "bot membership migration runs, protects PII, and accepts phone-only members",
  async () => {
    const db = new PGlite();
    try {
      // A minimal stand-in for Supabase Auth's schemas, roles and JWT helpers.
      await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text,
        raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text
      $$;
      GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    `);
      for (const filename of priorMigrations) {
        await db.exec(
          await Deno.readTextFile(new URL(`../migrations/${filename}`, import.meta.url)),
        );
      }
      const botMigration = await Deno.readTextFile(
        new URL("../migrations/20260924090000_bot_membership.sql", import.meta.url),
      );
      await db.exec(botMigration);
      // Existing deployments may have overly broad application policies. A
      // second run must replace them rather than retaining an RLS bypass.
      await db.exec(`CREATE POLICY "legacy broad read" ON public.pending_registrations
        FOR SELECT TO authenticated USING (true)`);
      await db.exec(botMigration);

      const adminId = "11111111-1111-4111-8111-111111111111";
      const boardId = "22222222-2222-4222-8222-222222222222";
      const emailMemberId = "33333333-3333-4333-8333-333333333333";
      const phoneRegistrationId = "44444444-4444-4444-8444-444444444444";
      const emailRegistrationId = "55555555-5555-4555-8555-555555555555";
      const reservedRegistrationId = "66666666-6666-4666-8666-666666666666";
      await db.exec("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4),($5,$6)", [
        adminId,
        "francismurageweb@gmail.com",
        boardId,
        "board@example.com",
        emailMemberId,
        "email@example.com",
      ]);
      await db.query("UPDATE public.profiles SET status='approved' WHERE id IN ($1,$2)", [
        adminId,
        boardId,
      ]);
      await db.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'board_member')", [
        boardId,
      ]);

      await db.query(
        `INSERT INTO public.pending_registrations(id,phone_number,full_name,requested_role,registration_channel)
       VALUES ($1,'254712345678','Phone Member','board_member','sms')`,
        [phoneRegistrationId],
      );
      const [phoneApproval] = await queryRows<{ id: string }>(
        db,
        "SELECT public.approve_bot_registration($1::uuid,$2::uuid,NULL) AS id",
        [phoneRegistrationId, adminId],
      );
      const phoneMemberId = phoneApproval.id;
      assert.equal(
        (
          await queryRows<{ n: number }>(db, "SELECT count(*)::int n FROM auth.users WHERE id=$1", [
            phoneMemberId,
          ])
        )[0].n,
        0,
      );
      assert.deepEqual(
        (
          await queryRows<{
            phone_only_member: boolean;
            whatsapp_verified: boolean;
            prefers_sms: boolean;
            status: string;
          }>(
            db,
            "SELECT phone_only_member,whatsapp_verified,prefers_sms,status FROM public.profiles WHERE id=$1",
            [phoneMemberId],
          )
        )[0],
        { phone_only_member: true, whatsapp_verified: true, prefers_sms: true, status: "approved" },
      );
      assert.equal(
        (
          await queryRows<{ role: string }>(
            db,
            "SELECT role FROM public.user_roles WHERE user_id=$1",
            [phoneMemberId],
          )
        )[0].role,
        "board_member",
      );
      // A bot-only board role cannot cast a web vote and must not raise the quorum.
      assert.equal(
        (await queryRows<{ n: number }>(db, "SELECT public.board_majority_count() AS n"))[0].n,
        1,
      );

      await db.query(
        `INSERT INTO public.pending_registrations(id,phone_number,full_name,email,requested_role,registration_channel)
       VALUES ($1,'254723456789','Email Member','email@example.com','secretary','whatsapp')`,
        [emailRegistrationId],
      );
      assert.equal(
        (
          await queryRows<{ id: string }>(
            db,
            "SELECT public.approve_bot_registration($1::uuid,$2::uuid,$3::uuid) AS id",
            [emailRegistrationId, adminId, emailMemberId],
          )
        )[0].id,
        emailMemberId,
      );
      const [emailProfile] = await queryRows<{ phone_only_member: boolean; status: string }>(
        db,
        "SELECT phone_only_member,status FROM public.profiles WHERE id=$1",
        [emailMemberId],
      );
      assert.deepEqual(emailProfile, { phone_only_member: false, status: "approved" });

      await db.query(
        `INSERT INTO public.pending_registrations(id,phone_number,full_name,email,requested_role,registration_channel)
       VALUES ($1,'254734567890','Spoofed','francismurageweb@gmail.com','member','sms')`,
        [reservedRegistrationId],
      );
      await assert.rejects(
        db.query("SELECT public.approve_bot_registration($1::uuid,$2::uuid,$3::uuid)", [
          reservedRegistrationId,
          adminId,
          adminId,
        ]),
        /administrator email/,
      );

      // The admin can review applications; another logged-in board member cannot.
      // This also catches missing EXECUTE privileges on has_role in earlier SQL.
      await db.exec(
        "SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false)",
      );
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [boardId]);
      await assert.rejects(
        db.query("UPDATE public.profiles SET phone_number='254799999999' WHERE id=$1", [boardId]),
        /Only an administrator/,
      );
      await assert.rejects(
        db.query("SELECT public.approve_bot_registration($1::uuid,$2::uuid,NULL)", [
          reservedRegistrationId,
          boardId,
        ]),
        /permission denied/,
      );
      assert.equal(
        (
          await queryRows<{ n: number }>(
            db,
            "SELECT count(*)::int n FROM public.pending_registrations",
          )
        )[0].n,
        0,
      );
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [adminId]);
      assert.equal(
        (
          await queryRows<{ n: number }>(
            db,
            "SELECT count(*)::int n FROM public.pending_registrations",
          )
        )[0].n,
        3,
      );
      await db.exec("RESET ROLE");

      await db.query(
        "INSERT INTO public.contributions(member_id,amount,mpesa_transaction_id,status) VALUES ($1,5000,'ABCD12345','confirmed')",
        [phoneMemberId],
      );
      await assert.rejects(
        db.query(
          "INSERT INTO public.contributions(member_id,amount,mpesa_transaction_id,status) VALUES ($1,5000,'abcd12345','pending')",
          [phoneMemberId],
        ),
        /duplicate key/,
      );
      const [balance] = await queryRows<{ total: string }>(
        db,
        "SELECT public.bot_confirmed_total($1::uuid) AS total",
        [phoneMemberId],
      );
      assert.equal(Number(balance.total), 5000);
    } finally {
      await db.close();
    }
  },
);
