import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatKES, sendMessage } from "../_shared/africastalking.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_PHONE = Deno.env.get("ADMIN_WHATSAPP_NUMBER") ?? "254182528510";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type NotificationPayload =
  | {
      event: "submitted";
      memberName: string;
      amount: number;
      reference: string;
      installmentNumber: number;
      loanId: string;
    }
  | {
      event: "confirmed";
      memberId: string;
      memberName: string;
      memberPhone?: string;
      amount: number;
      reference?: string;
      installmentNumber: number;
      outstandingBalance?: number;
    }
  | {
      event: "rejected";
      memberId: string;
      memberName: string;
      memberPhone?: string;
      amount: number;
      reference?: string;
      installmentNumber: number;
      reason: string;
    };

type Profile = {
  phone_number: string | null;
  prefers_sms: boolean | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (!isRecord(value) || !hasString(value.event)) return false;
  if (value.event === "submitted") {
    return (
      hasString(value.memberName) &&
      typeof value.amount === "number" &&
      hasString(value.reference) &&
      typeof value.installmentNumber === "number" &&
      hasString(value.loanId)
    );
  }

  return (
    hasString(value.memberId) &&
    hasString(value.memberName) &&
    typeof value.amount === "number" &&
    typeof value.installmentNumber === "number" &&
    (value.event === "confirmed" || (value.event === "rejected" && hasString(value.reason)))
  );
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}

async function isFinanceOfficer(userId: string): Promise<boolean> {
  const { data } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "treasurer"]);
  return (data ?? []).length > 0;
}

async function memberProfile(memberId: string): Promise<Profile | null> {
  const { data } = await adminClient
    .from("profiles")
    .select("phone_number, prefers_sms")
    .eq("id", memberId)
    .maybeSingle();
  return data;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return response({ ok: true });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return response({ error: "Authentication required" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();
    if (userError || !user) return response({ error: "Authentication required" }, 401);

    const rawPayload: unknown = await request.json();
    if (!isNotificationPayload(rawPayload)) {
      return response({ error: "Invalid notification payload" }, 400);
    }

    if (rawPayload.event !== "submitted" && !(await isFinanceOfficer(user.id))) {
      return response({ error: "Only finance officers may send this notification" }, 403);
    }

    if (rawPayload.event === "submitted") {
      await sendMessage({
        to: ADMIN_PHONE,
        channel: "whatsapp",
        message:
          `🔔 Loan Payment Submitted\n` +
          `─────────────────────────\n` +
          `Member:      ${rawPayload.memberName}\n` +
          `Amount:      ${formatKES(rawPayload.amount)}\n` +
          `Installment: #${rawPayload.installmentNumber}\n` +
          `M-Pesa Ref:  ${rawPayload.reference}\n\n` +
          `Review at murage-funds-hub.vercel.app/loans-review`,
      });
      return response({ success: true });
    }

    const profile = await memberProfile(rawPayload.memberId);
    const phone = rawPayload.memberPhone ?? profile?.phone_number;
    if (!phone) return response({ success: true, delivered: false });

    const channel = profile?.prefers_sms ? "sms" : "whatsapp";
    if (rawPayload.event === "confirmed") {
      await sendMessage({
        to: phone,
        channel,
        message:
          `✅ Loan Payment Confirmed\n` +
          `─────────────────────────\n` +
          `Hello ${rawPayload.memberName},\n` +
          `Amount:      ${formatKES(rawPayload.amount)}\n` +
          `Installment: #${rawPayload.installmentNumber}\n` +
          `M-Pesa Ref:  ${rawPayload.reference ?? "—"}\n` +
          `Outstanding: ${formatKES(rawPayload.outstandingBalance ?? 0)}\n\n` +
          `Murage Foundation`,
      });
    } else {
      await sendMessage({
        to: phone,
        channel,
        message:
          `❌ Loan Payment Rejected\n` +
          `─────────────────────────\n` +
          `Hello ${rawPayload.memberName},\n` +
          `Installment: #${rawPayload.installmentNumber}\n` +
          `Reference:   ${rawPayload.reference ?? "—"}\n` +
          `Reason:      ${rawPayload.reason}\n\n` +
          `Please correct the details and resubmit in My Loans.\n` +
          `Help: +254182528510`,
      });
    }

    return response({ success: true, delivered: true });
  } catch (error) {
    console.error("[loan-payment-notifications]", error);
    return response({ error: "Could not send loan payment notification" }, 500);
  }
});
