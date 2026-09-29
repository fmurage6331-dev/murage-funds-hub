import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../../../src/integrations/supabase/types.ts";
import {
  DEFAULT_MEMBER_PASSWORD,
  isSyntheticEmail,
  phoneToSyntheticEmail,
} from "../_shared/phone.ts";

type Role = Database["public"]["Enums"]["app_role"];
type AdminDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      complete_admin_approval: {
        Args: {
          target_id: string;
          assigned_role: Role;
          registration_id?: string;
          actor_id?: string;
        };
        Returns: undefined;
      };
    };
  };
};
const roles: Role[] = [
  "admin",
  "chairman",
  "treasurer",
  "secretary",
  "assistant_secretary",
  "board_member",
  "member",
];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
/** M-Pesa details and support line quoted in member notifications. */
const PAYBILL_NUMBER = "522522";
const PAYBILL_ACCOUNT = "7989164";
const SUPPORT_PHONE = "+254182528510";
const json = (
  body: { success: true; memberId?: string; warning?: string } | { error: string },
  status = 200,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Best-effort delivery through the send-email function. Never logs the recovery link itself.
const dispatchEmail = async (payload: {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}): Promise<boolean> => {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey) return false;
  try {
    const response = await fetch(`${baseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (error) {
    console.error("Email dispatch failed", error);
    return false;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return json({ error: "Authentication required" }, 401);
    const db = createClient<AdminDatabase>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid or expired session" }, 401);
    const { data: admin, error: roleError } = await db
      .from("user_roles")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) throw roleError;
    if (!admin) return json({ error: "Administrator access required" }, 403);
    let body: Record<string, unknown>;
    try {
      const value: unknown = await req.json();
      if (!value || typeof value !== "object" || Array.isArray(value))
        return json({ error: "Invalid JSON body" }, 400);
      body = value as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    // Surface non-fatal delivery problems without failing an already committed approval.
    let warning: string | undefined;
    if (body.action === "approve_member" || body.action === "reject_member") {
      if (!uuid(body.userId)) return json({ error: "Valid userId required" }, 400);
      if (
        body.reason !== undefined &&
        (typeof body.reason !== "string" || body.reason.length > 2000)
      )
        return json({ error: "Invalid reason" }, 400);
      if (body.action === "reject_member") {
        const { data, error } = await db
          .from("profiles")
          .update({ status: "rejected" })
          .eq("id", body.userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "Member not found" }, 404);
      } else {
        const role = body.role ?? "member";
        if (!roles.includes(role as Role)) return json({ error: "Invalid role" }, 400);
        const { error } = await db.rpc("complete_admin_approval", {
          target_id: body.userId,
          assigned_role: role as Role,
        });
        if (error) throw error;
      }
    } else if (body.action === "approve_bot_registration") {
      if (!uuid(body.registrationId)) return json({ error: "Valid registrationId required" }, 400);
      // Never trust client-supplied phone, email, role or adminUserId.
      const { data: reg, error } = await db
        .from("pending_registrations")
        .select("*")
        .eq("id", body.registrationId)
        .maybeSingle();
      if (error) throw error;
      if (!reg) return json({ error: "Registration not found" }, 404);
      if (reg.status === "approved") return json({ success: true });
      if (reg.status !== "pending") return json({ error: "Registration is not pending" }, 409);
      if (!roles.includes(reg.requested_role))
        return json({ error: "Invalid requested role" }, 400);
      // Both profiles and user_roles reference auth.users, including phone-only members.
      const metadata = { full_name: reg.full_name, phone_number: reg.phone_number };
      // Email confirmation is disabled project-wide: create the Auth user already confirmed with
      // an unusable random password, then let the member choose their own via a recovery link.
      const created = await db.auth.admin.createUser(
        reg.email
          ? {
              email: reg.email,
              password: crypto.randomUUID(),
              email_confirm: true,
              user_metadata: metadata,
            }
          : {
              phone: reg.phone_number,
              phone_confirm: false,
              user_metadata: metadata,
            },
      );
      if (created.error) return json({ error: created.error.message }, 409);
      const memberId = created.data.user.id;
      // A recovery link lets the member SET a password instead of CONFIRMING an email address.
      let resetLink: string | null = null;
      if (reg.email) {
        const link = await db.auth.admin.generateLink({ type: "recovery", email: reg.email });
        const actionLink = link.data?.properties?.action_link;
        if (link.error || !actionLink) {
          const { error: cleanupError } = await db.auth.admin.deleteUser(memberId);
          if (cleanupError) console.error("Approval cleanup failed", cleanupError);
          console.error("Password reset link creation failed", link.error?.message);
          return json({ error: "Unable to create a password reset link for this member" }, 502);
        }
        resetLink = actionLink;
      }
      try {
        const { error: profileError } = await db.from("profiles").upsert({
          id: memberId,
          full_name: reg.full_name,
          email: reg.email,
          phone_number: reg.phone_number,
          phone_only_member: !reg.email,
        });
        if (profileError) throw profileError;
        const { error: approvalError } = await db.rpc("complete_admin_approval", {
          target_id: memberId,
          assigned_role: reg.requested_role,
          registration_id: reg.id,
          actor_id: auth.user.id,
        });
        if (approvalError) throw approvalError;
      } catch (error) {
        // Do not leave an orphaned Auth identity blocking a later retry.
        const { error: cleanupError } = await db.auth.admin.deleteUser(memberId);
        if (cleanupError) console.error("Approval cleanup failed", cleanupError);
        throw error;
      }
      // Delivery is best-effort: the approval is already committed, so report rather than roll back.
      if (reg.email && resetLink) {
        const sent = await dispatchEmail({
          to: reg.email,
          subject: "Murage Foundation — set your password to sign in",
          template: "password_reset",
          data: { memberName: reg.full_name, resetLink },
        });
        if (!sent)
          warning = `Approved, but the password reset email to ${reg.email} did not send. Resend it from Supabase Auth → Users.`;
      }
    } else if (body.action === "reject_bot_registration") {
      if (!uuid(body.registrationId)) return json({ error: "Valid registrationId required" }, 400);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason || reason.length > 2000)
        return json({ error: "A reason of 1-2000 characters is required" }, 400);
      // Never trust client-supplied identity or actor: re-read the persisted registration.
      const { data: reg, error } = await db
        .from("pending_registrations")
        .select("id, status")
        .eq("id", body.registrationId)
        .maybeSingle();
      if (error) throw error;
      if (!reg) return json({ error: "Registration not found" }, 404);
      if (reg.status === "rejected") return json({ success: true });
      if (reg.status !== "pending") return json({ error: "Registration is not pending" }, 409);
      const { data: rejected, error: rejectError } = await db
        .from("pending_registrations")
        .update({
          status: "rejected",
          admin_notes: reason,
          approved_by: auth.user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", body.registrationId)
        .select("id")
        .maybeSingle();
      if (rejectError) throw rejectError;
      if (!rejected) return json({ error: "Registration not found" }, 404);
    } else if (body.action === "create_manual_member") {
      const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
      const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
      const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
      const role = typeof body.role === "string" ? body.role.trim() : "member";

      if (!fullName) return json({ error: "Full Name is required" }, 400);
      if (!phoneNumber) return json({ error: "Phone Number is required" }, 400);
      if (!roles.includes(role as Role)) return json({ error: "Invalid role" }, 400);

      const retentionDate = new Date();
      retentionDate.setFullYear(retentionDate.getFullYear() + 7);
      const dataRetentionUntil = retentionDate.toISOString();

      // profiles.id and user_roles.user_id both reference auth.users, so every member needs an
      // Auth identity. Members sign in with a password — never an SMS code — so a member without
      // an email address is created under a synthetic email derived from their phone number
      // (254724344102@murage.foundation) and types that phone number at /auth. Both paths get the
      // default password, already confirmed because email verification is disabled project-wide.
      const metadata = { full_name: fullName, phone_number: phoneNumber };
      const created = await db.auth.admin.createUser({
        email: email ?? phoneToSyntheticEmail(phoneNumber),
        password: DEFAULT_MEMBER_PASSWORD,
        email_confirm: true,
        user_metadata: metadata,
      });
      if (created.error) return json({ error: created.error.message }, 409);
      const memberId = created.data.user.id;

      try {
        const { error: profileError } = await db.from("profiles").upsert({
          id: memberId,
          full_name: fullName,
          // The synthetic address is an Auth identifier only: never surface it on the profile.
          email: email,
          phone_number: phoneNumber,
          // Phone-only members can use the web app now, so nobody is bot-only any more.
          phone_only_member: false,
          is_default_password: true,
          status: "approved",
          consent_given: true,
          whatsapp_opt_in: true,
          data_retention_until: dataRetentionUntil,
        });
        if (profileError) throw profileError;

        const { error: roleInsertError } = await db.from("user_roles").upsert(
          {
            user_id: memberId,
            role: role as Role,
          },
          { onConflict: "user_id,role" },
        );
        if (roleInsertError) throw roleInsertError;
      } catch (error) {
        // Do not leave an orphaned Auth identity blocking a later retry.
        const { error: cleanupError } = await db.auth.admin.deleteUser(memberId);
        if (cleanupError) console.error("Manual member creation cleanup failed", cleanupError);
        throw error;
      }

      return json({ success: true, memberId });
    } else if (body.action === "resetMemberPassword") {
      if (!uuid(body.userId)) return json({ error: "Valid userId required" }, 400);

      // Never trust client-supplied identity details: re-read the member from the database.
      const { data: member, error: memberError } = await db
        .from("profiles")
        .select("id, full_name, email, phone_number")
        .eq("id", body.userId)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return json({ error: "Member not found" }, 404);

      const { data: authUser, error: authUserError } = await db.auth.admin.getUserById(body.userId);
      if (authUserError) return json({ error: authUserError.message }, 404);
      if (!authUser.user) return json({ error: "Member not found" }, 404);

      // Legacy phone-backed accounts (bot approvals created before phone sign-in existed) have no
      // email at all, so a new password alone would leave them unable to sign in. Provision the
      // same synthetic address the import flow uses, derived from the number on record.
      const loginPhone = authUser.user.phone ?? member.phone_number;
      const provisionedEmail =
        !authUser.user.email && loginPhone ? phoneToSyntheticEmail(loginPhone) : null;

      const { error: resetError } = await db.auth.admin.updateUserById(body.userId, {
        password: DEFAULT_MEMBER_PASSWORD,
        ...(provisionedEmail ? { email: provisionedEmail, email_confirm: true } : {}),
      });
      if (resetError) return json({ error: resetError.message }, 409);

      // Back on the issued password: warn them again at next sign-in, and they can use the web app.
      const { error: flagError } = await db
        .from("profiles")
        .update({ is_default_password: true, phone_only_member: false })
        .eq("id", body.userId);
      if (flagError) throw flagError;

      const resetWarnings: string[] = [];

      // Append-only audit trail for every reset. The password value itself is never recorded.
      const auditRow = {
        table_name: "auth.users",
        record_id: body.userId,
        performed_by: auth.user.id,
        performed_by_email: auth.user.email ?? null,
        changed_fields: ["password", "is_default_password"],
        new_values: {
          event: "password_reset_by_admin",
          member_name: member.full_name,
          is_default_password: true,
          synthetic_email_provisioned: provisionedEmail !== null,
        },
      };
      // audit_logs.action is CHECK-constrained to INSERT/UPDATE/DELETE in some deployments. Try the
      // semantic action first, then fall back to a constrained row that still names the event —
      // the table structure is never modified to make this write fit.
      const { error: auditError } = await db
        .from("audit_logs")
        .insert({ ...auditRow, action: "password_reset_by_admin" });
      if (auditError) {
        const fallback = await db.from("audit_logs").insert({ ...auditRow, action: "UPDATE" });
        if (fallback.error) {
          console.error("Password reset audit entry failed", fallback.error.message);
          resetWarnings.push(
            `The audit entry for this reset could not be written (${fallback.error.message}).`,
          );
        }
      }

      // Only a real mailbox can be told: synthetic addresses are internal and never emailed.
      const notifyEmail = isSyntheticEmail(member.email) ? null : member.email;
      if (notifyEmail) {
        const sent = await dispatchEmail({
          to: notifyEmail,
          subject: "Your Murage Foundation password has been reset",
          template: "admin_password_reset",
          data: {
            memberName: member.full_name,
            defaultPassword: DEFAULT_MEMBER_PASSWORD,
            login: notifyEmail,
            phoneNumber: member.phone_number,
            paybillNumber: PAYBILL_NUMBER,
            paybillAccount: PAYBILL_ACCOUNT,
            supportPhone: SUPPORT_PHONE,
          },
        });
        if (!sent)
          resetWarnings.push(
            `The notification email to ${notifyEmail} did not send. Tell ` +
              `${member.full_name ?? "the member"} their password is now ${DEFAULT_MEMBER_PASSWORD}.`,
          );
      }
      if (resetWarnings.length > 0) warning = resetWarnings.join(" ");
    } else {
      return json({ error: "Unknown action" }, 400);
    }
    return json(warning ? { success: true, warning } : { success: true });
  } catch (error) {
    console.error("Admin action failed", error);
    return json(
      { error: "Unable to complete admin action. Please retry or contact support." },
      500,
    );
  }
});
