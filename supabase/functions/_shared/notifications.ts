import { adminClient, dbResult } from "./db.ts";
import { sendMessage, type Channel, type Profile } from "./africastalking.ts";
import { formatKenyanDate, formatKES, foundation } from "../../../src/lib/foundation.ts";

function canNotify(member: Profile | null): member is Profile & { phone_number: string } {
  return Boolean(
    member?.phone_number &&
    member.status === "approved" &&
    !member.is_anonymized &&
    member.whatsapp_opt_in,
  );
}

function memberChannel(member: Profile): Channel {
  return member.prefers_sms ? "sms" : "whatsapp";
}

async function memberById(id: string): Promise<Profile | null> {
  return dbResult(
    "notification member",
    adminClient().from("profiles").select("*").eq("id", id).maybeSingle(),
  );
}

async function claimEvent(key: string): Promise<boolean> {
  try {
    const { error } = await adminClient()
      .from("bot_notification_events")
      .insert({ event_key: key });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("[bot notification] event claim failed", error);
    throw error;
  }
}

async function deliverOnce(
  key: string,
  member: Profile & { phone_number: string },
  message: string,
): Promise<boolean> {
  if (!(await claimEvent(key))) return false;
  try {
    await sendMessage({ to: member.phone_number, channel: memberChannel(member), message });
    return true;
  } catch (error) {
    // Allow an officer to retry a failed delivery; successful deliveries stay
    // claimed even if another browser tab invokes the same notification.
    try {
      await dbResult(
        "release failed notification",
        adminClient().from("bot_notification_events").delete().eq("event_key", key),
      );
    } catch (releaseError) {
      console.error("[bot notification] could not release failed event", releaseError);
    }
    throw error;
  }
}

export async function notifyContributionConfirmed(id: string): Promise<boolean> {
  const row = await dbResult(
    "confirmed contribution for delivery",
    adminClient()
      .from("contributions")
      .select("id,member_id,amount,status,reference,mpesa_transaction_id,confirmed_at")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!row || row.status !== "confirmed") return false;
  const member = await memberById(row.member_id);
  if (!canNotify(member)) return false;
  const total = await dbResult(
    "confirmed total for delivery",
    adminClient().rpc("bot_confirmed_total", { _member_id: member.id }),
  );
  const message = `✅ Contribution Confirmed!\n─────────────────────────\nAmount: KES ${formatKES(Number(row.amount))}\nM-Pesa Ref: ${row.mpesa_transaction_id ?? row.reference ?? "—"}\nNew Total: KES ${formatKES(Number(total ?? 0))}\nDate: ${formatKenyanDate(row.confirmed_at ?? new Date().toISOString())}\n\nThank you! 🙏\nMurage Foundation`;
  return deliverOnce(`contribution:${row.id}:confirmed`, member, message);
}

export async function notifyLoanDecision(id: string): Promise<boolean> {
  const loan = await dbResult(
    "loan decision for delivery",
    adminClient()
      .from("loans")
      .select("id,member_id,amount,loan_type,status,rejection_reason")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!loan || (loan.status !== "approved" && loan.status !== "rejected")) return false;
  const member = await memberById(loan.member_id);
  if (!canNotify(member)) return false;
  const message =
    loan.status === "approved"
      ? `🎉 Loan Approved!\n─────────────────\nAmount: KES ${formatKES(Number(loan.amount))}\nType: ${loan.loan_type}\n\nYour repayment schedule is ready.\nText SCHEDULE to view installments.\n\nMurage Foundation`
      : `❌ Loan Application Update\n──────────────────────────\nAmount: KES ${formatKES(Number(loan.amount))}\nStatus: Not Approved\nReason: ${loan.rejection_reason ?? "Board decision"}\n\nQuestions? Contact:\n${foundation.adminPhone}\n\nMurage Foundation`;
  return deliverOnce(`loan:${loan.id}:${loan.status}`, member, message);
}

export async function notifyMeetingScheduled(
  id: string,
): Promise<{ sent: number; failed: number }> {
  const meeting = await dbResult(
    "meeting for delivery",
    adminClient()
      .from("meetings")
      .select("id,title,scheduled_for,location,agenda")
      .eq("id", id)
      .single(),
  );
  if (!meeting) throw new Error("Meeting not found");
  const message = `📅 Meeting Notice\n─────────────────\n${meeting.title}\n\nDate: ${new Date(meeting.scheduled_for).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}\nLocation: ${meeting.location ?? "TBA"}\nAgenda: ${meeting.agenda ?? "TBA"}\n\nMurage Foundation 🌟`;
  let sent = 0;
  let failed = 0;
  // Page through members rather than letting PostgREST's default row limit
  // silently omit phone-only members. Cap each batch to avoid provider bursts.
  for (let offset = 0; ; offset += 100) {
    const members = await dbResult(
      "meeting phone recipients",
      adminClient()
        .from("profiles")
        .select("*")
        .eq("status", "approved")
        .eq("is_anonymized", false)
        .eq("whatsapp_opt_in", true)
        .not("phone_number", "is", null)
        .order("id")
        .range(offset, offset + 99),
    );
    if (!members?.length) break;
    for (let start = 0; start < members.length; start += 5) {
      const batch = members.slice(start, start + 5).filter(canNotify);
      const results = await Promise.allSettled(
        batch.map((member) => deliverOnce(`meeting:${meeting.id}:${member.id}`, member, message)),
      );
      results.forEach((result) => {
        if (result.status === "rejected") {
          console.error("[bot notification] meeting recipient delivery failed", result.reason);
          failed += 1;
        } else if (result.value) sent += 1;
      });
    }
    if (members.length < 100) break;
  }
  return { sent, failed };
}
