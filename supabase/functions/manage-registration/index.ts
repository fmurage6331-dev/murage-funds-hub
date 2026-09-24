import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { adminClient, dbResult } from "../_shared/db.ts";
import { sendMessage, type Channel } from "../_shared/africastalking.ts";
import { foundation, payment } from "../../../src/lib/foundation.ts";
import type { Database } from "../../../src/integrations/supabase/types.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

type Application = Database["public"]["Tables"]["pending_registrations"]["Row"];
type RequestAction = "approve" | "reject" | "retry";
type ReviewRequest = { action: RequestAction; registrationId: string; reason?: string };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(
  body: { success: boolean; error?: string; warning?: string },
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function parseBody(value: unknown): ReviewRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid request");
  const data: Record<string, unknown> = value as Record<string, unknown>;
  if (data.action !== "approve" && data.action !== "reject" && data.action !== "retry") {
    throw new Error("Invalid review action");
  }
  if (typeof data.registrationId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.registrationId)) {
    throw new Error("Invalid registration ID");
  }
  if (
    data.action === "reject" &&
    (typeof data.reason !== "string" ||
      data.reason.trim().length < 5 ||
      data.reason.trim().length > 500)
  ) {
    throw new Error("Please provide a rejection reason (5–500 characters)");
  }
  return {
    action: data.action,
    registrationId: data.registrationId,
    reason: typeof data.reason === "string" ? data.reason.trim() : undefined,
  };
}

async function verifiedAdmin(request: Request): Promise<string> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!token || !url || !anonKey) throw new Error("Unauthorized");
  // Always validate the JWT with Supabase Auth; never trust a userId sent by the browser.
  const auth = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await auth.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const profile = await dbResult(
    "admin profile",
    adminClient().from("profiles").select("status,is_anonymized").eq("id", user.id).single(),
  );
  const roles = await dbResult(
    "admin role",
    adminClient()
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .limit(1),
  );
  if (profile?.status !== "approved" || profile.is_anonymized || !roles?.length) {
    throw new Error("Admins only");
  }
  return user.id;
}

function channelFor(application: Application): Channel {
  return application.registration_channel === "sms" ? "sms" : "whatsapp";
}

async function deliverWelcome(application: Application): Promise<void> {
  let message: string;
  if (application.email) {
    // Recovery links are one-time, expiring password-setup links. The browser
    // never sees the link and the Edge logs never contain it.
    const { data, error } = await adminClient().auth.admin.generateLink({
      type: "recovery",
      email: application.email,
      options: { redirectTo: `${foundation.webUrl}/set-password` },
    });
    if (error || !data?.properties?.action_link)
      throw new Error("Unable to generate password setup link");
    message = `✅ Welcome to Murage Foundation!\nYour account has been approved! 🎉\n\nClick to set your password:\n${data.properties.action_link}\n\nYou can also use our bot:\nBAL, LOANS, DEPOSIT, SCHEDULE\n\nPay via M-Pesa:\nPaybill: ${payment.paybill} Acc: ${payment.account}\n\nWeb: ${foundation.webUrl}`;
  } else {
    message = `✅ Welcome to Murage Foundation!\nYour membership is approved! 🎉\n\nUse these commands:\nBAL      - Check your balance\nLOANS    - View loan status\nDEPOSIT  - Submit payment\nHELP     - All commands\n\nPay via M-Pesa:\nPaybill: ${payment.paybill}\nAccount: ${payment.account}\n\nAdmin: ${foundation.adminPhone} 🌟`;
  }
  await sendMessage({ to: application.phone_number, channel: channelFor(application), message });
  await dbResult(
    "mark invitation delivered",
    adminClient()
      .from("pending_registrations")
      .update({
        invite_sent: true,
        invite_sent_at: new Date().toISOString(),
      })
      .eq("id", application.id)
      .eq("status", "approved"),
  );
}

async function approve(application: Application, adminId: string): Promise<{ warning?: string }> {
  if (application.status !== "pending") throw new Error("Registration is no longer pending");
  let authId: string | null = null;
  let newlyCreatedId: string | null = null;
  if (application.email) {
    // Never attach an applicant's phone to an existing web account just because
    // they typed its email (especially an administrator's email).
    if (application.email.toLowerCase() === "francismurageweb@gmail.com") {
      throw new Error("The administrator email cannot be used for bot registration");
    }
    const existing = await dbResult(
      "find existing email profile",
      adminClient().from("profiles").select("id").ilike("email", application.email).limit(1),
    );
    if (existing?.length)
      throw new Error("Email already registered. Contact the administrator to link your phone.");
    // Auth's signup trigger creates the initial (pending) web profile.
    const created = await adminClient().auth.admin.createUser({
      email: application.email,
      email_confirm: true,
      user_metadata: {
        full_name: application.full_name,
        consent_given: true,
        consent_version: "1.0",
      },
    });
    if (created.error || !created.data.user) {
      throw new Error("Could not create the email account. Check for an existing signup.");
    }
    authId = created.data.user.id;
    newlyCreatedId = authId;
  }
  try {
    await dbResult(
      "approve bot registration",
      adminClient().rpc("approve_bot_registration", {
        _registration_id: application.id,
        _approved_by: adminId,
        _auth_user_id: authId,
      }),
    );
  } catch (error) {
    // Only remove an auth user created by THIS invocation. Do not delete an
    // existing web signup when a concurrent reviewer approves first.
    if (newlyCreatedId) {
      const removed = await adminClient().auth.admin.deleteUser(newlyCreatedId);
      if (removed.error)
        console.error("[manage-registration] cleanup of unclaimed auth user failed", removed.error);
    }
    throw error;
  }
  try {
    await deliverWelcome(application);
    return {};
  } catch (error) {
    console.error("[manage-registration] approved but invitation not delivered", error);
    return { warning: "Approved, but welcome message not delivered. Retry from the Users page." };
  }
}

async function reject(
  application: Application,
  adminId: string,
  reason: string,
): Promise<{ warning?: string }> {
  if (application.status !== "pending") throw new Error("Registration is no longer pending");
  await dbResult(
    "reject bot registration",
    adminClient().rpc("reject_bot_registration", {
      _registration_id: application.id,
      _admin_id: adminId,
      _reason: reason,
    }),
  );
  try {
    await sendMessage({
      to: application.phone_number,
      channel: channelFor(application),
      message: `❌ Murage Foundation\n─────────────────────\nYour registration was not approved.\n\nReason: ${reason}\n\nFor assistance contact:\n${foundation.adminPhone}\n\nYou may reapply by texting JOIN`,
    });
    return {};
  } catch (error) {
    console.error("[manage-registration] rejected but applicant not notified", error);
    return { warning: "Rejected, but the applicant could not be notified. Contact them directly." };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ success: true }, 200);
  if (request.method !== "POST")
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  try {
    const adminId = await verifiedAdmin(request);
    const action = parseBody(await request.json());
    const application = await dbResult(
      "load application",
      adminClient()
        .from("pending_registrations")
        .select("*")
        .eq("id", action.registrationId)
        .single(),
    );
    if (!application) throw new Error("Application not found");
    let result: { warning?: string };
    if (action.action === "approve") result = await approve(application, adminId);
    else if (action.action === "reject")
      result = await reject(application, adminId, action.reason ?? "");
    else {
      if (application.status !== "approved" || application.invite_sent)
        throw new Error("Nothing to resend");
      try {
        await deliverWelcome(application);
        result = {};
      } catch (error) {
        console.error("[manage-registration] retry delivery failed", error);
        result = { warning: "Welcome message could not be delivered. Check provider settings." };
      }
    }
    return jsonResponse({ success: true, ...result }, 200);
  } catch (error) {
    // Avoid accidentally logging generated setup links or token values.
    console.error("[manage-registration] request failed", error);
    const message = error instanceof Error ? error.message : "Unable to review registration";
    return jsonResponse(
      { success: false, error: message },
      message === "Unauthorized" || message === "Admins only" ? 403 : 400,
    );
  }
});
