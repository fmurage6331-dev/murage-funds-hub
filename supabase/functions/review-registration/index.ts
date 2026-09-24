import type { Database } from "../../../src/integrations/supabase/types.ts";
import {
  getServiceClient,
  requireOfficer,
  corsHeaders,
  jsonResponse,
} from "../_shared/supabase.ts";
import { sendMessage, normalizePhone, type Channel } from "../_shared/africastalking.ts";
import { joinRoles, type JoinRole } from "../_shared/bot-utils.ts";

type Registration = Database["public"]["Tables"]["pending_registrations"]["Row"];
const WEB_URL = "https://murage-funds-hub.vercel.app";

function check(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function linkProfile(registrationId: string, profileId: string): Promise<void> {
  const { data, error } = await getServiceClient()
    .from("pending_registrations")
    .update({ profile_id: profileId })
    .eq("id", registrationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  check(error, "Link registration profile");
  if (!data) throw new Error("Application was already reviewed by another admin");
}

/** Only reuse an existing auth user created for this exact registration. */
async function ensureProfile(registration: Registration): Promise<string> {
  const client = getServiceClient();
  if (registration.profile_id) return registration.profile_id;

  if (registration.email) {
    const email = registration.email.toLowerCase();
    // The legacy signup trigger grants admin to this reserved email. Never
    // bootstrap an admin through a phone-only claim of that address.
    if (email === "francismurageweb@gmail.com") {
      throw new Error("The designated administrator email cannot be registered via the bot");
    }
    const { data: existing, error: lookupError } = await client
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    check(lookupError, "Check email account");
    let profileId: string;
    if (existing) {
      const { data: user, error: userError } = await client.auth.admin.getUserById(existing.id);
      check(userError, "Check existing auth user");
      if (user.user?.app_metadata?.bot_registration_id !== registration.id) {
        throw new Error(
          "Email already belongs to another account. Verify identity with the applicant before linking a phone.",
        );
      }
      profileId = existing.id;
    } else {
      const { data: created, error: createError } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: registration.full_name,
          consent_given: registration.consent_given,
          consent_version: "1.0",
        },
        app_metadata: { bot_registration_id: registration.id },
      });
      check(createError, "Create email auth user");
      if (!created.user) throw new Error("Auth did not return the new account");
      profileId = created.user.id;
    }

    // The existing auth trigger normally creates the profile; recover if that
    // trigger is absent without overwriting a different member's details.
    const { error: profileError } = await client.from("profiles").upsert(
      {
        id: profileId,
        full_name: registration.full_name,
        email,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    check(profileError, "Ensure email profile");
    await linkProfile(registration.id, profileId);
    return profileId;
  }

  // A phone-only profile is a plain UUID; do NOT create an auth.users row.
  const { data: existing, error: lookupError } = await client
    .from("profiles")
    .select("id")
    .eq("phone_number", registration.phone_number)
    .maybeSingle();
  check(lookupError, "Check phone-only profile");
  // Use this application's UUID so a retry can recover after profile creation
  // even if saving pending_registrations.profile_id failed.
  const profileId = registration.id;
  if (existing && existing.id !== profileId)
    throw new Error("This phone already belongs to another member");
  if (!existing) {
    const { error: createError } = await client.from("profiles").insert({
      id: profileId,
      full_name: registration.full_name,
      email: null,
      phone_number: registration.phone_number,
      phone_only_member: true,
      status: "pending",
      consent_given: registration.consent_given,
      consent_timestamp: registration.consent_given ? new Date().toISOString() : null,
    });
    check(createError, "Create phone-only profile");
  }
  await linkProfile(registration.id, profileId);
  return profileId;
}

async function approve(
  registration: Registration,
  adminId: string,
): Promise<{ sent: boolean; message: string }> {
  const client = getServiceClient();
  if (registration.status !== "pending" && registration.status !== "approved") {
    throw new Error("Only pending applications may be approved");
  }
  if (registration.status === "approved" && registration.invite_sent) {
    return { sent: true, message: "Already approved and notified" };
  }
  if (!registration.consent_given) {
    throw new Error("Applicant opted out. Ask them to text JOIN before sending an invitation.");
  }
  if (!Object.values(joinRoles).includes(registration.requested_role as JoinRole)) {
    throw new Error("Unsupported requested role");
  }
  const channel: Channel = registration.registration_channel === "sms" ? "sms" : "whatsapp";
  const phone = normalizePhone(registration.phone_number);
  const profileId = await ensureProfile(registration);

  // Claim this pending application BEFORE granting access. A concurrent
  // rejection cannot win after this point; a failed later step stays visible
  // as approved / invite_sent=false so the admin can retry safely.
  if (registration.status === "pending") {
    const { data, error: statusError } = await client
      .from("pending_registrations")
      .update({
        status: "approved",
        approved_by: adminId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", registration.id)
      .eq("status", "pending")
      .eq("consent_given", true)
      .select("id")
      .maybeSingle();
    check(statusError, "Mark registration approved");
    if (!data) throw new Error("Application was already reviewed by another admin");
  }

  const { error: profileError } = await client
    .from("profiles")
    .update({
      full_name: registration.full_name,
      email: registration.email?.toLowerCase() ?? null,
      phone_number: phone,
      phone_only_member: !registration.email,
      status: "approved",
      consent_given: registration.consent_given,
      consent_timestamp: registration.consent_given ? new Date().toISOString() : null,
      whatsapp_opt_in: registration.consent_given,
      whatsapp_opt_in_at: registration.consent_given ? new Date().toISOString() : null,
      whatsapp_verified: channel === "whatsapp",
      prefers_sms: channel === "sms",
    })
    .eq("id", profileId);
  check(profileError, "Approve profile");
  const { error: roleError } = await client.from("user_roles").upsert(
    {
      user_id: profileId,
      role: registration.requested_role,
    },
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );
  check(roleError, "Assign requested role");
  let message: string;
  if (registration.email) {
    const { data: link, error: linkError } = await client.auth.admin.generateLink({
      type: "magiclink",
      email: registration.email.toLowerCase(),
      options: { redirectTo: `${WEB_URL}/set-password` },
    });
    check(linkError, "Generate password setup link");
    if (!link.properties?.action_link) throw new Error("Auth did not return a password setup link");
    message = `✅ Welcome to Murage Foundation!
Your account has been approved! 🎉

Click to set your password:
${link.properties.action_link}

You can also use our bot: BAL, LOANS, DEPOSIT, SCHEDULE

Pay via M-Pesa (KCB Bank Kenya):
Paybill: 522522  Acc: 798164

Web: murage-funds-hub.vercel.app`;
  } else {
    message = `✅ Welcome to Murage Foundation!
Your membership is approved! 🎉

Use these commands:
BAL      - Check your balance
LOANS    - View loan status
DEPOSIT  - Submit payment
HELP     - All commands

Pay via M-Pesa (KCB Bank Kenya):
Paybill: 522522
Account: 798164

Admin: +254182528510 🌟`;
  }

  // A STOP may arrive while Auth is generating the link. Respect that newer
  // decision, including for a profile linked but not yet notified.
  const { data: latest, error: latestError } = await client
    .from("pending_registrations")
    .select("consent_given")
    .eq("id", registration.id)
    .single();
  check(latestError, "Check latest messaging consent");
  if (!latest) throw new Error("Application disappeared while sending invitation");
  if (!latest.consent_given) {
    const { error } = await client
      .from("profiles")
      .update({ whatsapp_opt_in: false })
      .eq("id", profileId);
    check(error, "Honor applicant opt-out");
    return { sent: false, message: "Applicant opted out; ask them to text JOIN before retrying." };
  }

  try {
    await sendMessage({ to: phone, message, channel });
  } catch (error) {
    // Approved and role assigned. Leave invite_sent=false so the admin can
    // retry delivery from /users without creating a second profile/auth user.
    console.error("[review-registration] Approval saved; invitation delivery failed:", error);
    return {
      sent: false,
      message: "Approved, but the invitation was not delivered. Retry from /users.",
    };
  }
  const { error: sentError } = await client
    .from("pending_registrations")
    .update({
      invite_sent: true,
      invite_sent_at: new Date().toISOString(),
    })
    .eq("id", registration.id);
  check(sentError, "Mark invitation delivered");
  return { sent: true, message: "Application approved and invitation sent" };
}

async function reject(
  registration: Registration,
  reason: string,
): Promise<{ sent: boolean; message: string }> {
  if (registration.status !== "pending")
    throw new Error("Only pending applications may be rejected");
  if (registration.profile_id) {
    throw new Error(
      "Approval already started. Finish the approval instead of rejecting an existing account.",
    );
  }
  const { data, error } = await getServiceClient()
    .from("pending_registrations")
    .update({ status: "rejected", admin_notes: reason })
    .eq("id", registration.id)
    .eq("status", "pending")
    .is("profile_id", null)
    .select("id")
    .maybeSingle();
  check(error, "Reject registration");
  if (!data) throw new Error("Application was already reviewed by another admin");
  try {
    await sendMessage({
      to: registration.phone_number,
      channel: registration.registration_channel === "sms" ? "sms" : "whatsapp",
      message: `❌ Murage Foundation
─────────────────────
Your registration was not approved.

Reason: ${reason}

For assistance contact: +254182528510
You may reapply by texting JOIN`,
    });
    return { sent: true, message: "Application rejected and applicant notified" };
  } catch (deliveryError) {
    console.error(
      "[review-registration] Rejection saved; applicant notification failed:",
      deliveryError,
    );
    return {
      sent: false,
      message: "Rejected, but delivery failed. Contact the applicant directly.",
    };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  let adminId: string;
  try {
    adminId = await requireOfficer(req, ["admin"]);
  } catch {
    return jsonResponse({ error: "Admin access required" }, 403);
  }
  try {
    const payload: unknown = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return jsonResponse({ error: "Invalid request" }, 400);
    const body = payload as Record<string, unknown>;
    if (
      typeof body.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.id) ||
      (body.action !== "approve" && body.action !== "reject")
    ) {
      return jsonResponse({ error: "Invalid application or action" }, 400);
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (body.action === "reject" && (reason.length < 3 || reason.length > 500)) {
      return jsonResponse({ error: "Give a reason (3-500 characters)" }, 400);
    }
    const { data: registration, error } = await getServiceClient()
      .from("pending_registrations")
      .select("*")
      .eq("id", body.id)
      .maybeSingle();
    check(error, "Load registration");
    if (!registration) return jsonResponse({ error: "Application not found" }, 404);
    const result =
      body.action === "approve"
        ? await approve(registration, adminId)
        : await reject(registration, reason);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    console.error("[review-registration] Review failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Review failed" }, 500);
  }
});
