import { adminClient, dbResult } from "../_shared/db.ts";
import {
  getMemberByPhone,
  isOfficer,
  normalizePhone,
  sendMessage,
  type Channel,
  type Profile,
} from "../_shared/africastalking.ts";
import { formatKenyanDate, formatKES, foundation, payment } from "../../../src/lib/foundation.ts";
import type { Database, Json } from "../../../src/integrations/supabase/types.ts";

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

type Session = Database["public"]["Tables"]["whatsapp_sessions"]["Row"];
type RequestedRole = "member" | "board_member" | "secretary" | "assistant_secretary";
type SessionData = {
  fullName?: string;
  role?: RequestedRole;
  email?: string | null;
  paused?: boolean;
};

const ROLES: Record<string, RequestedRole> = {
  "1": "member",
  "2": "board_member",
  "3": "secretary",
  "4": "assistant_secretary",
};
const COMMANDS = new Set(["BAL", "LOANS", "DEPOSIT", "SCHEDULE", "PENDING", "CONFIRM", "HELP"]);
const NOT_REGISTERED = "You are not registered.\nText JOIN to apply for membership.";
const APPLICATION_PENDING = `Your application is already pending review.\nYou will be notified once approved.\nQuestions? Call ${foundation.adminPhone}`;
const INTERRUPTED = "You have an incomplete registration.\nReply YES to continue or NO to cancel.";
const DEPOSIT_USAGE = `❌ Invalid format.\nCorrect format:\nDEPOSIT {amount} {mpesa_ref}\n\nExample:\nDEPOSIT 5000 QWE123456\n\nPaybill: ${payment.paybill}  Account: ${payment.account}`;
const HELP = `📱 Murage Foundation Bot
────────────────────────
Commands:
JOIN     - Register as a member
BAL      - Check your balance
LOANS    - View loan status
DEPOSIT  - Submit a payment
           e.g. DEPOSIT 5000 ABC123
SCHEDULE - Repayment schedule
HELP     - Show this menu
STOP     - Unsubscribe

Pay via M-Pesa:
Paybill: ${payment.paybill}
Account: ${payment.account}

Web App:
${foundation.webUrl}

Admin: ${foundation.adminPhone}
Murage Foundation 🌟`;

function sessionData(session: Session): SessionData {
  const value: Json = session.collected_data;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const role = value.role;
  return {
    fullName: typeof value.fullName === "string" ? value.fullName : undefined,
    role: typeof role === "string" && Object.values(ROLES).includes(role as RequestedRole)
      ? (role as RequestedRole)
      : undefined,
    email: typeof value.email === "string" || value.email === null ? value.email : undefined,
    paused: value.paused === true,
  };
}

function expiry(): string {
  return new Date(Date.now() + 30 * 60 * 1000).toISOString();
}

function dataToJson(data: SessionData): Record<string, Json | undefined> {
  return { fullName: data.fullName, role: data.role, email: data.email, paused: data.paused };
}

async function updateSession(session: Session, step: string, data: SessionData): Promise<void> {
  await dbResult(
    "save JOIN step",
    adminClient()
      .from("whatsapp_sessions")
      .update({ step, collected_data: dataToJson(data), last_message_at: new Date().toISOString(), expires_at: expiry() })
      .eq("id", session.id),
  );
}

async function removeSession(session: Session): Promise<void> {
  await dbResult("remove JOIN session", adminClient().from("whatsapp_sessions").delete().eq("id", session.id));
}

async function loadSession(phone: string, channel: Channel): Promise<Session | null> {
  const session = await dbResult(
    "read JOIN session",
    adminClient().from("whatsapp_sessions").select("*").eq("phone_number", phone).eq("channel", channel).maybeSingle(),
  );
  if (session && new Date(session.expires_at).getTime() <= Date.now()) {
    await removeSession(session);
    return null;
  }
  return session;
}

function sessionPrompt(session: Session): string {
  const data = sessionData(session);
  if (session.step === "resubscribe") return "Reply YES to receive Murage Foundation WhatsApp/SMS messages again, or NO to cancel.";
  if (session.step === "start") return "Welcome to Murage Foundation! What is your full name?";
  if (session.step === "name") return "Choose the role you are applying for:\n1. Member\n2. Board member\n3. Secretary\n4. Assistant secretary\nReply with 1, 2, 3 or 4.";
  if (session.step === "role") return "What is your email address? Reply SKIP if you will use the bot only (no web account).";
  if (session.step === "email" || session.step === "confirm") {
    return `Please confirm your application:\nName: ${data.fullName ?? "—"}\nRole: ${(data.role ?? "member").replace(/_/g, " ")}\nPhone: ${session.phone_number}\nEmail: ${data.email ?? "None - Phone Only"}\n\nReply YES to consent to membership data processing and receive messages via this channel, or NO to cancel. Text STOP anytime to unsubscribe.`;
  }
  return "Text JOIN to start your application.";
}

async function respond(phone: string, channel: Channel, message: string): Promise<void> {
  await sendMessage({ to: phone, channel, message });
}

async function beginJoin(phone: string, channel: Channel): Promise<string> {
  const member = await getMemberByPhone(phone);
  if (member) {
    if (!member.whatsapp_opt_in && member.status === "approved" && !member.is_anonymized) {
      await dbResult(
        "start re-subscription",
        adminClient().from("whatsapp_sessions").upsert(
          {
            phone_number: phone,
            channel,
            step: "resubscribe",
            collected_data: {},
            last_message_at: new Date().toISOString(),
            expires_at: expiry(),
          },
          { onConflict: "phone_number,channel" },
        ),
      );
      return "You are already a member. Reply YES to re-subscribe to messages, or NO to cancel.";
    }
    return "You are already registered!\nText HELP to see available commands.";
  }
  const existing = await dbResult(
    "check pending application",
    adminClient().from("pending_registrations").select("id").eq("phone_number", phone).eq("status", "pending").limit(1),
  );
  if (existing && existing.length > 0) return APPLICATION_PENDING;

  await dbResult(
    "start JOIN session",
    adminClient().from("whatsapp_sessions").upsert(
      {
        phone_number: phone,
        channel,
        step: "start",
        collected_data: {},
        last_message_at: new Date().toISOString(),
        expires_at: expiry(),
      },
      { onConflict: "phone_number,channel" },
    ),
  );
  return "Welcome to Murage Foundation! What is your full name?";
}

async function completeJoin(session: Session): Promise<string> {
  const data = sessionData(session);
  if (!data.fullName || !data.role || data.email === undefined) {
    await removeSession(session);
    return "Your session expired. Text JOIN to try again.";
  }
  // Check again at submission time; the partial unique index closes concurrent
  // webhook races and allows a rejected applicant to re-apply.
  const existing = await dbResult(
    "check completed application",
    adminClient()
      .from("pending_registrations")
      .select("id")
      .eq("phone_number", session.phone_number)
      .eq("status", "pending")
      .limit(1),
  );
  if (existing && existing.length > 0) {
    await removeSession(session);
    return APPLICATION_PENDING;
  }
  try {
    await dbResult(
      "submit application",
      adminClient().from("pending_registrations").insert({
        phone_number: session.phone_number,
        full_name: data.fullName,
        requested_role: data.role,
        email: data.email,
        registration_channel: session.channel,
        status: "pending",
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate key")) {
      await removeSession(session);
      return APPLICATION_PENDING;
    }
    throw error;
  }
  await removeSession(session);
  try {
    const admin = normalizePhone(Deno.env.get("ADMIN_WHATSAPP_NUMBER") ?? foundation.adminPhone);
    await sendMessage({
      to: admin,
      channel: session.channel === "sms" ? "sms" : "whatsapp",
      message: `🔔 New Registration Request\n─────────────────────────\nName: ${data.fullName}\nRole: ${data.role}\nPhone: ${session.phone_number}\nEmail: ${data.email ?? "None - Phone Only"}\nChannel: ${session.channel}\n\nReview & approve at:\n${foundation.webUrl}/users`,
    });
  } catch (error) {
    // The application is saved: do not retry insertion just because delivery failed.
    console.error("[whatsapp-bot] admin registration alert failed", error);
  }
  return "✅ Your application has been submitted for review.\nWe will notify you once approved.\nText HELP for more information.";
}

async function handleSession(session: Session, input: string): Promise<string> {
  const text = input.trim();
  const data = sessionData(session);
  const upper = text.toUpperCase();
  if (upper === "NO") {
    await removeSession(session);
    return "Registration cancelled. Text JOIN anytime to apply again.";
  }
  if (upper === "JOIN") {
    await updateSession(session, session.step, { ...data, paused: false });
    return sessionPrompt(session);
  }
  if (data.paused) {
    if (upper !== "YES") return INTERRUPTED;
    await updateSession(session, session.step, { ...data, paused: false });
    return sessionPrompt(session);
  }
  const command = upper.split(/\s+/)[0];
  if (COMMANDS.has(command)) {
    await updateSession(session, session.step, { ...data, paused: true });
    return INTERRUPTED;
  }
  if (session.step === "resubscribe") {
    if (upper !== "YES") return sessionPrompt(session);
    await dbResult(
      "re-subscribe member",
      adminClient().from("profiles").update({
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: new Date().toISOString(),
        prefers_sms: session.channel === "sms",
      }).eq("phone_number", session.phone_number).eq("status", "approved"),
    );
    await removeSession(session);
    return "✅ You are subscribed again. Text HELP for commands, or STOP to unsubscribe.";
  }
  if (session.step === "start") {
    const name = text.replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(name)) {
      return "Please send your full name (2–80 letters).";
    }
    await updateSession(session, "name", { ...data, fullName: name });
    return sessionPrompt({ ...session, step: "name" });
  }
  if (session.step === "name") {
    const role = ROLES[text];
    if (!role) return "Reply with 1 (Member), 2 (Board member), 3 (Secretary) or 4 (Assistant secretary).";
    await updateSession(session, "role", { ...data, role });
    return sessionPrompt({ ...session, step: "role" });
  }
  if (session.step === "role") {
    const email = upper === "SKIP" ? null : text.toLowerCase();
    if (email !== null && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return "Please enter a valid email address or reply SKIP for bot-only access.";
    }
    const next = { ...data, email };
    await updateSession(session, "email", next);
    return sessionPrompt({ ...session, step: "email", collected_data: dataToJson(next) });
  }
  if (session.step === "email" || session.step === "confirm") {
    if (upper !== "YES") return "Reply YES to submit your application, or NO to cancel.";
    await updateSession(session, "confirm", data);
    return completeJoin(session);
  }
  await removeSession(session);
  return "Session expired. Text JOIN to start again.";
}

function approvedMember(member: Profile | null): member is Profile {
  return Boolean(member && member.status === "approved" && !member.is_anonymized);
}

async function balance(phone: string): Promise<string> {
  const member = await getMemberByPhone(phone);
  if (!approvedMember(member)) return NOT_REGISTERED;
  const total = await dbResult("confirmed balance", adminClient().rpc("bot_confirmed_total", { _member_id: member.id }));
  const last = await dbResult(
    "last confirmed contribution",
    adminClient().from("contributions")
      .select("amount,contributed_on")
      .eq("member_id", member.id).eq("status", "confirmed")
      .order("contributed_on", { ascending: false }).order("created_at", { ascending: false })
      .limit(1).maybeSingle(),
  );
  return `💰 Your Balance\n────────────────\nName: ${member.full_name ?? "Member"}\nTotal Contributions: KES ${formatKES(Number(total ?? 0))}\nLast Contribution: ${last ? `KES ${formatKES(Number(last.amount))} on ${formatKenyanDate(last.contributed_on)}` : "None yet"}\n\nPay via M-Pesa:\nPaybill: ${payment.paybill}\nAccount: ${payment.account}\n\nText HELP for all commands`;
}

async function activeLoan(phone: string) {
  const member = await getMemberByPhone(phone);
  if (!approvedMember(member)) return null;
  const loans = await dbResult(
    "active member loans",
    adminClient().from("loans").select("id,amount,loan_type,decision_at")
      .eq("member_id", member.id).in("status", ["approved", "disbursed"])
      .order("decision_at", { ascending: false }).limit(1),
  );
  return loans?.[0] ?? null;
}

async function repaymentRows(loanId: string) {
  return (await dbResult(
    "member repayment schedule",
    adminClient().from("loan_repayments")
      .select("installment_number,amount_due,amount_paid,due_date,status")
      .eq("loan_id", loanId).order("due_date"),
  )) ?? [];
}

async function loanSummary(phone: string): Promise<string> {
  const member = await getMemberByPhone(phone);
  if (!approvedMember(member)) return NOT_REGISTERED;
  const loan = await activeLoan(phone);
  if (!loan) return `You have no active loans.\nVisit ${foundation.webUrl}\nto apply for a loan.`;
  const rows = await repaymentRows(loan.id);
  const paid = rows.reduce((sum, row) => sum + Number(row.amount_paid), 0);
  const next = rows.find((row) => Number(row.amount_paid) < Number(row.amount_due));
  const risk = await dbResult(
    "loan risk tier",
    adminClient().from("loan_risk_flags").select("risk_tier").eq("loan_id", loan.id).maybeSingle(),
  );
  return `🏦 Your Loan Summary\n────────────────────\nLoan Amount:  KES ${formatKES(Number(loan.amount))}\nTotal Paid:   KES ${formatKES(paid)}\nRemaining:    KES ${formatKES(Math.max(0, Number(loan.amount) - paid))}\nNext Payment: ${next ? `KES ${formatKES(Math.max(0, Number(next.amount_due) - Number(next.amount_paid)))} due ${formatKenyanDate(next.due_date)}` : "All paid"}\nRisk Status:  ${(risk?.risk_tier ?? "healthy").replace(/_/g, " ")}\n\nText SCHEDULE for full schedule\nText HELP for all commands`;
}

async function schedule(phone: string): Promise<string> {
  const member = await getMemberByPhone(phone);
  if (!approvedMember(member)) return NOT_REGISTERED;
  const loan = await activeLoan(phone);
  if (!loan) return `You have no active loans.\nVisit ${foundation.webUrl}\nto apply for a loan.`;
  const rows = (await repaymentRows(loan.id))
    .filter((row) => Number(row.amount_paid) < Number(row.amount_due))
    .slice(0, 5);
  const lines = rows.length === 0
    ? "All installments are paid."
    : rows.map((row) => {
      const status = row.due_date < new Date().toISOString().slice(0, 10) ? "❌" : "⏳";
      return `${row.installment_number} ${formatKenyanDate(row.due_date)} KES ${formatKES(Number(row.amount_due) - Number(row.amount_paid))} ${status}`;
    }).join("\n");
  return `📅 Repayment Schedule\n────────────────────\nLoan Total: KES ${formatKES(Number(loan.amount))}\n\n${lines}\n\nStatus: ✅ Paid  ⏳ Pending  ❌ Overdue\n\nText LOANS for loan summary`;
}

async function deposit(phone: string, input: string, channel: Channel): Promise<string> {
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 3 || !/^\d+(?:\.\d{1,2})?$/.test(parts[1]) || !/^[A-Z0-9-]{5,30}$/i.test(parts[2])) {
    return DEPOSIT_USAGE;
  }
  const amount = Number(parts[1]);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return DEPOSIT_USAGE;
  const ref = parts[2].toUpperCase();
  const member = await getMemberByPhone(phone);
  if (!approvedMember(member)) return NOT_REGISTERED;
  const existing = await dbResult(
    "check M-Pesa reference",
    adminClient().from("contributions").select("id")
      .or(`mpesa_transaction_id.ilike.${ref},reference.ilike.${ref}`).limit(1),
  );
  if (existing && existing.length > 0) return "That M-Pesa reference has already been submitted. Contact the treasurer if you need help.";
  try {
    await dbResult(
      "submit M-Pesa contribution",
      adminClient().from("contributions").insert({
        member_id: member.id,
        amount,
        status: "pending",
        method: "mpesa",
        reference: ref,
        mpesa_transaction_id: ref,
        mpesa_sender_phone: phone,
        paybill_number: payment.paybill,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return "That M-Pesa reference has already been submitted. Contact the treasurer if you need help.";
    }
    throw error;
  }
  try {
    const admin = normalizePhone(Deno.env.get("ADMIN_WHATSAPP_NUMBER") ?? foundation.adminPhone);
    await sendMessage({
      to: admin,
      channel,
      message: `🔔 New Deposit Pending\n─────────────────────\nMember: ${member.full_name ?? "Member"}\nAmount: KES ${formatKES(amount)}\nM-Pesa Ref: ${ref}\nPhone: ${phone}\n\nConfirm at:\n${foundation.webUrl}/contributions-review`,
    });
  } catch (error) {
    console.error("[whatsapp-bot] admin deposit alert failed", error);
  }
  return `✅ Deposit Submitted\n──────────────────\nAmount: KES ${formatKES(amount)}\nM-Pesa Ref: ${ref}\nPaybill: ${payment.paybill}\nAccount: ${payment.account}\nStatus: Pending confirmation\n\nTreasurer will confirm within 24hrs.\nYou will be notified here. 🙏`;
}

async function pendingContributions(phone: string): Promise<string> {
  if (!(await isOfficer(phone))) return "⛔ This command is for officers only.\nText HELP for available commands.";
  const client = adminClient();
  let count: number;
  let rows: Array<{ amount: number; mpesa_transaction_id: string | null; reference: string | null; profiles: { full_name: string | null } | null }>;
  try {
    const response = await client.from("contributions")
      .select("amount,mpesa_transaction_id,reference,profiles:member_id(full_name)", { count: "exact" })
      .eq("status", "pending").order("created_at", { ascending: true }).limit(10);
    if (response.error) throw response.error;
    count = response.count ?? 0;
    rows = response.data ?? [];
  } catch (error) {
    console.error("[whatsapp-bot] pending contributions query failed", error);
    throw error;
  }
  const lines = rows.map((row, index) => `${index + 1}. ${row.profiles?.full_name ?? "Member"} KES ${formatKES(Number(row.amount))} Ref:${row.mpesa_transaction_id ?? row.reference ?? "—"}`).join("\n");
  return `📋 Pending Contributions (${count})\n──────────────────────────────────\n${lines || "None pending."}\n\nReply: CONFIRM {ref} to approve${count > rows.length ? "\nShowing first 10." : ""}`;
}

async function confirmContribution(phone: string, input: string, channel: Channel): Promise<string> {
  if (!(await isOfficer(phone))) return "⛔ This command is for officers only.\nText HELP for available commands.";
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 2 || !/^[A-Z0-9-]{5,30}$/i.test(parts[1])) return "Reply CONFIRM {mpesa_ref}, e.g. CONFIRM QWE123456.";
  const ref = parts[1].toUpperCase();
  const contribution = await dbResult(
    "find pending contribution",
    adminClient().from("contributions").select("id,amount,member_id,mpesa_transaction_id")
      .ilike("mpesa_transaction_id", ref).eq("status", "pending").maybeSingle(),
  );
  if (!contribution) return "No pending contribution has that M-Pesa reference.";
  const officer = await getMemberByPhone(phone);
  if (!officer) return "Officer profile not found.";
  const updated = await dbResult(
    "confirm pending contribution",
    adminClient().from("contributions").update({
      status: "confirmed",
      confirmed_by: officer.id,
      confirmed_at: new Date().toISOString(),
    }).eq("id", contribution.id).eq("status", "pending").select("id").maybeSingle(),
  );
  if (!updated) return "That contribution has already been reviewed.";
  const member = await dbResult(
    "confirmed contribution member",
    adminClient().from("profiles").select("*").eq("id", contribution.member_id).single(),
  );
  const total = await dbResult("new confirmed balance", adminClient().rpc("bot_confirmed_total", { _member_id: contribution.member_id }));
  if (member?.phone_number && member.whatsapp_opt_in && !member.is_anonymized) {
    try {
      await sendMessage({
        to: member.phone_number,
        channel: member.prefers_sms ? "sms" : "whatsapp",
        message: `✅ Contribution Confirmed!\n─────────────────────────\nAmount: KES ${formatKES(Number(contribution.amount))}\nM-Pesa Ref: ${ref}\nDate: ${formatKenyanDate(new Date().toISOString())}\nNew Total: KES ${formatKES(Number(total ?? 0))}\n\nThank you! 🙏\nMurage Foundation`,
      });
    } catch (error) {
      console.error("[whatsapp-bot] member confirmation delivery failed", error);
      return "Contribution confirmed, but the member message could not be delivered. Please contact them directly.";
    }
  }
  return `✅ Confirmed ${ref} for KES ${formatKES(Number(contribution.amount))}. Member notified where opted in. Text PENDING for more.`;
}

async function stop(phone: string, session: Session | null): Promise<string> {
  if (session) await removeSession(session);
  await dbResult(
    "unsubscribe phone",
    adminClient().from("profiles")
      .update({ whatsapp_opt_in: false, whatsapp_opt_in_at: null })
      .eq("phone_number", phone),
  );
  return `You have been unsubscribed from\nMurage Foundation messages.\n\nText JOIN to re-register anytime.\nAdmin: ${foundation.adminPhone}`;
}

async function handleMessage(phone: string, text: string, channel: Channel): Promise<string> {
  const input = text.trim();
  const command = input.split(/\s+/)[0].toUpperCase();
  const session = await loadSession(phone, channel);
  // STOP must always take effect immediately, even mid-JOIN.
  if (command === "STOP") return stop(phone, session);
  if (session) return handleSession(session, input);
  switch (command) {
    case "JOIN": return beginJoin(phone, channel);
    case "BAL": return balance(phone);
    case "LOANS": return loanSummary(phone);
    case "DEPOSIT": return deposit(phone, input, channel);
    case "SCHEDULE": return schedule(phone);
    case "PENDING": return pendingContributions(phone);
    case "CONFIRM": return confirmContribution(phone, input, channel);
    case "HELP": return HELP;
    default: return "❓ Command not recognized.\n\nText HELP to see all commands.\n\nMurage Foundation Bot 🌟";
  }
}

// AT does not supply a Supabase JWT or a documented signed SMS callback.
// Configure its callback URL with ?token=<AFRICASTALKING_WEBHOOK_SECRET>.
// A header is also accepted for callers that support one. Fail closed with 200.
function validSecret(provided: string | null): boolean {
  const expected = Deno.env.get("AFRICASTALKING_WEBHOOK_SECRET");
  if (!expected || !provided) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

Deno.serve(async (request) => {
  let phone: string | null = null;
  let channel: Channel = "sms";
  try {
    if (request.method !== "POST") return new Response("OK", { status: 200 });
    const url = new URL(request.url);
    if (!validSecret(request.headers.get("x-webhook-secret") ?? url.searchParams.get("token"))) {
      console.error("[whatsapp-bot] callback authentication failed or is not configured");
      return new Response("OK", { status: 200 });
    }
    if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      throw new Error("Expected form-encoded webhook");
    }
    const body = await request.text();
    if (body.length > 4_096) throw new Error("Webhook payload too large");
    const params = new URLSearchParams(body);
    phone = normalizePhone(params.get("from") ?? "");
    const incomingChannel = params.get("channel")?.toLowerCase() ?? "sms";
    if (incomingChannel !== "sms" && incomingChannel !== "whatsapp") throw new Error("Unsupported channel");
    channel = incomingChannel;
    const message = params.get("text")?.trim() ?? "";
    if (message.length > 1_000) throw new Error("Message too long");
    const reply = await handleMessage(phone, message, channel);
    await respond(phone, channel, reply);
  } catch (error) {
    console.error("[whatsapp-bot] webhook processing failed", error);
    if (phone) {
      try {
        await respond(phone, channel, "Sorry, we couldn't process that right now. Please try again later or call +254182528510.");
      } catch (sendError) {
        console.error("[whatsapp-bot] error reply failed", sendError);
      }
    }
  }
  // Never make AT retry even if a downstream API/database operation fails.
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
});
