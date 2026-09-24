import type { Database } from "../../../src/integrations/supabase/types.ts";
import {
  getServiceClient,
  requireOfficer,
  corsHeaders,
  jsonResponse,
} from "../_shared/supabase.ts";
import { sendMessage } from "../_shared/africastalking.ts";
import { kenyaDate, money } from "../_shared/bot-utils.ts";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type EventType = "contribution_confirmed" | "loan_approved" | "loan_rejected" | "meeting_scheduled";
type DeliveryStats = { sent: number; skipped: number; failed: number };

function check(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

async function sendToMember(
  profile: Profile,
  type: EventType,
  recordId: string,
  message: string,
): Promise<DeliveryStats> {
  if (
    profile.status !== "approved" ||
    profile.is_anonymized ||
    !profile.phone_number ||
    !profile.whatsapp_opt_in
  ) {
    return { sent: 0, skipped: 1, failed: 0 }; // STOP/consent always wins
  }
  const client = getServiceClient();
  const { data: claimed, error: claimError } = await client.rpc("bot_claim_notification", {
    _event_type: type,
    _record_id: recordId,
    _profile_id: profile.id,
  });
  check(claimError, "Claim notification");
  if (!claimed) return { sent: 0, skipped: 1, failed: 0 };
  try {
    await sendMessage({
      to: profile.phone_number,
      message,
      channel: profile.prefers_sms ? "sms" : "whatsapp",
    });
    const { error } = await client
      .from("bot_notification_deliveries")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("event_type", type)
      .eq("record_id", recordId)
      .eq("profile_id", profile.id);
    check(error, "Mark notification sent");
    return { sent: 1, skipped: 0, failed: 0 };
  } catch (error) {
    console.error("[notify-event] Outbound delivery failed:", error);
    const { error: markError } = await client
      .from("bot_notification_deliveries")
      .update({ status: "failed" })
      .eq("event_type", type)
      .eq("record_id", recordId)
      .eq("profile_id", profile.id);
    if (markError) console.error("[notify-event] Failed to mark delivery for retry:", markError);
    return { sent: 0, skipped: 0, failed: 1 };
  }
}

async function memberProfile(memberId: string): Promise<Profile> {
  const { data, error } = await getServiceClient()
    .from("profiles")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  check(error, "Read notification recipient");
  if (!data) throw new Error("Member profile not found");
  return data;
}

async function contributionConfirmed(id: string): Promise<DeliveryStats> {
  const client = getServiceClient();
  const { data: contribution, error } = await client
    .from("contributions")
    .select("id,member_id,amount,status,mpesa_transaction_id,reference,confirmed_at")
    .eq("id", id)
    .maybeSingle();
  check(error, "Read contribution");
  if (!contribution || contribution.status !== "confirmed")
    throw new Error("Contribution is not confirmed");
  const member = await memberProfile(contribution.member_id);
  if (!member.phone_number || !member.whatsapp_opt_in) return { sent: 0, skipped: 1, failed: 0 };
  const { data: totals, error: totalError } = await client.rpc("bot_member_balance", {
    _member_id: contribution.member_id,
  });
  check(totalError, "Read confirmed balance");
  return sendToMember(
    member,
    "contribution_confirmed",
    id,
    `✅ Contribution Confirmed!
Amount: KES ${money(Number(contribution.amount))}
M-Pesa Ref: ${contribution.mpesa_transaction_id ?? contribution.reference ?? "—"}
New Total: KES ${money(Number(totals?.[0]?.total ?? 0))}
Date: ${kenyaDate(contribution.confirmed_at ?? new Date())}

Pay via M-Pesa: Paybill 522522 Account 798164
Thank you! 🙏
Murage Foundation`,
  );
}

async function loanDecision(
  id: string,
  type: "loan_approved" | "loan_rejected",
): Promise<DeliveryStats> {
  const { data: loan, error } = await getServiceClient()
    .from("loans")
    .select("id,member_id,amount,loan_type,status,rejection_reason")
    .eq("id", id)
    .maybeSingle();
  check(error, "Read loan decision");
  if (!loan || loan.status !== (type === "loan_approved" ? "approved" : "rejected")) {
    throw new Error("Loan decision is not final");
  }
  const member = await memberProfile(loan.member_id);
  const message =
    type === "loan_approved"
      ? `🎉 Loan Approved!
─────────────────
Amount: KES ${money(Number(loan.amount))}
Type: ${loan.loan_type}

Your repayment schedule is ready.
Text SCHEDULE to view installments.

Contributions: KCB M-Pesa Paybill 522522
Account: 798164
Murage Foundation`
      : `❌ Loan Application Update
──────────────────────────
Amount: KES ${money(Number(loan.amount))}
Status: Not Approved
Reason: ${loan.rejection_reason ?? "Board decision"}

Questions? Contact: +254182528510
Murage Foundation`;
  return sendToMember(member, type, id, message);
}

async function meetingNotice(id: string): Promise<DeliveryStats> {
  const client = getServiceClient();
  const { data: meeting, error } = await client
    .from("meetings")
    .select("id,title,scheduled_for,location,agenda")
    .eq("id", id)
    .maybeSingle();
  check(error, "Read meeting");
  if (!meeting) throw new Error("Meeting not found");
  const date = new Date(meeting.scheduled_for).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  });
  const message = `📅 Meeting Notice
─────────────────
${meeting.title}

Date: ${date}
Location: ${meeting.location || "To be announced"}
Agenda: ${meeting.agenda?.slice(0, 300) || "To be announced"}

Murage Foundation 🌟`;
  const total: DeliveryStats = { sent: 0, skipped: 0, failed: 0 };
  // Supabase REST caps queries at 1,000 rows. Page through EVERY eligible
  // profile; concurrency is bounded to avoid overwhelming AT.
  for (let offset = 0; ; offset += 100) {
    const { data: profiles, error: profileError } = await client
      .from("profiles")
      .select("*")
      .eq("status", "approved")
      .eq("whatsapp_opt_in", true)
      .eq("is_anonymized", false)
      .not("phone_number", "is", null)
      .order("id")
      .range(offset, offset + 99);
    check(profileError, "Read meeting recipients");
    for (let i = 0; i < (profiles?.length ?? 0); i += 10) {
      const results = await Promise.all(
        (profiles ?? []).slice(i, i + 10).map((profile) =>
          sendToMember(profile, "meeting_scheduled", id, message).catch((deliveryError) => {
            console.error("[notify-event] Could not queue meeting notice:", deliveryError);
            return { sent: 0, skipped: 0, failed: 1 } satisfies DeliveryStats;
          }),
        ),
      );
      for (const result of results) {
        total.sent += result.sent;
        total.failed += result.failed;
        total.skipped += result.skipped;
      }
    }
    if (!profiles || profiles.length < 100) break;
  }
  return total;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  try {
    const payload: unknown = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return jsonResponse({ error: "Invalid event" }, 400);
    const body = payload as Record<string, unknown>;
    if (
      typeof body.recordId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.recordId) ||
      !["contribution_confirmed", "loan_approved", "loan_rejected", "meeting_scheduled"].includes(
        String(body.type),
      )
    ) {
      return jsonResponse({ error: "Invalid notification request" }, 400);
    }
    const type = body.type as EventType;
    const roles =
      type === "contribution_confirmed"
        ? (["admin", "treasurer"] as const)
        : type === "meeting_scheduled"
          ? (["admin", "secretary", "assistant_secretary"] as const)
          : (["admin", "chairman", "treasurer", "board_member"] as const);
    try {
      await requireOfficer(req, [...roles]);
    } catch {
      return jsonResponse({ error: "Officer access required" }, 403);
    }
    const result =
      type === "contribution_confirmed"
        ? await contributionConfirmed(body.recordId)
        : type === "meeting_scheduled"
          ? await meetingNotice(body.recordId)
          : await loanDecision(body.recordId, type);
    return jsonResponse({ success: result.failed === 0, ...result });
  } catch (error) {
    console.error("[notify-event] Failed to process notification:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Notification failed" },
      500,
    );
  }
});
