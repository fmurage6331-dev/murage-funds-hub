import type { Json, Database } from "../../../src/integrations/supabase/types.ts";
import { getServiceClient, jsonResponse } from "../_shared/supabase.ts";
import {
  getMemberByPhone,
  isOfficer,
  normalizePhone,
  sendMessage,
  type Channel,
  type Profile,
} from "../_shared/africastalking.ts";
import {
  joinRoles,
  kenyaDate,
  kenyaToday,
  money,
  parseDeposit,
  type JoinRole,
  type JoinStep,
} from "../_shared/bot-utils.ts";
import { advanceJoin, promptFor, sessionExpired, type Collected } from "../_shared/bot-flow.ts";
import { parseInbound } from "../_shared/inbound.ts";

type Session = Database["public"]["Tables"]["whatsapp_sessions"]["Row"];
type Installment = Pick<
  Database["public"]["Tables"]["loan_repayments"]["Row"],
  "loan_id" | "amount_due" | "amount_paid" | "installment_number" | "due_date" | "status"
>;
type Loan = Pick<Database["public"]["Tables"]["loans"]["Row"], "id" | "amount" | "status">;

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

Pay via M-Pesa (KCB Bank Kenya):
Paybill: 522522
Account: 798164

Web App: murage-funds-hub.vercel.app
Admin: +254182528510
Murage Foundation 🌟`;
const DEPOSIT_FORMAT = `❌ Invalid format.
Correct format: DEPOSIT {amount} {mpesa_ref}
Example: DEPOSIT 5000 QWE123456

Paybill: 522522  Account: 798164`;
const NOT_REGISTERED = "You are not registered.\nText JOIN to apply for membership.";
const ALREADY_PENDING =
  "Your application is already pending review.\nYou will be notified once approved.\nQuestions? Call +254182528510";
const ADMIN_PHONE = "254182528510";
const SESSION_MS = 30 * 60 * 1000;

function check(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

function sessionData(value: Json): Collected {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const role = value.role;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    role:
      typeof role === "string" && Object.values(joinRoles).includes(role as JoinRole)
        ? (role as JoinRole)
        : undefined,
    email: typeof value.email === "string" ? value.email : value.email === null ? null : undefined,
  };
}

async function readSession(phone: string, channel: Channel): Promise<Session | null> {
  const { data, error } = await getServiceClient()
    .from("whatsapp_sessions")
    .select("*")
    .eq("phone_number", phone)
    .eq("channel", channel)
    .maybeSingle();
  check(error, "Read JOIN session");
  if (data && sessionExpired(data.expires_at)) {
    await clearSession(phone, channel);
    return null;
  }
  return data;
}

async function saveSession(
  phone: string,
  channel: Channel,
  step: JoinStep,
  collected: Collected,
): Promise<void> {
  const { error } = await getServiceClient()
    .from("whatsapp_sessions")
    .upsert(
      {
        phone_number: phone,
        channel,
        step,
        collected_data: collected as Json,
        last_message_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + SESSION_MS).toISOString(),
      },
      { onConflict: "phone_number,channel" },
    );
  check(error, "Save JOIN session");
}

async function clearSession(phone: string, channel: Channel): Promise<void> {
  const { error } = await getServiceClient()
    .from("whatsapp_sessions")
    .delete()
    .eq("phone_number", phone)
    .eq("channel", channel);
  check(error, "Clear JOIN session");
}

async function notifyAdmin(message: string, channel: Channel): Promise<void> {
  try {
    await sendMessage({
      to: Deno.env.get("ADMIN_WHATSAPP_NUMBER") ?? ADMIN_PHONE,
      message,
      channel,
    });
  } catch (error) {
    // Applicant/payment has already been saved; never roll it back because AT
    // could not deliver the admin alert. The record remains in the web UI.
    console.error("[whatsapp-bot] Could not notify admin:", error);
  }
}

async function register(phone: string, channel: Channel, collected: Collected): Promise<string> {
  if (!collected.name || !collected.role || collected.email === undefined) {
    return "Registration is incomplete. Text JOIN to start again.";
  }
  const client = getServiceClient();
  const { data: existing, error: lookupError } = await client
    .from("pending_registrations")
    .select("id,status")
    .eq("phone_number", phone)
    .maybeSingle();
  check(lookupError, "Check registration");
  if (existing?.status === "pending") return ALREADY_PENDING;
  if (existing?.status === "approved")
    return "You are already registered!\nText HELP to see available commands.";

  const values = {
    phone_number: phone,
    full_name: collected.name,
    requested_role: collected.role,
    email: collected.email,
    registration_channel: channel,
    status: "pending",
    consent_given: true,
    admin_notes: null,
    approved_by: null,
    approved_at: null,
    invite_sent: false,
    invite_sent_at: null,
  };
  const result = existing
    ? await client
        .from("pending_registrations")
        .update(values)
        .eq("id", existing.id)
        .eq("status", "rejected")
        .select("id")
        .maybeSingle()
    : await client.from("pending_registrations").insert(values).select("id").maybeSingle();
  if (result.error?.code === "23505" || (!result.data && !result.error)) return ALREADY_PENDING;
  check(result.error, "Save registration");

  await clearSession(phone, channel);
  await notifyAdmin(
    `🔔 New Registration Request
─────────────────────────
Name: ${collected.name}
Role: ${collected.role}
Phone: ${phone}
Email: ${collected.email ?? "None - Phone Only"}
Channel: ${channel}

Review & approve at:
murage-funds-hub.vercel.app/users`,
    channel,
  );
  return `✅ Registration submitted for review!\nWe'll notify you once approved.\nQuestions? Call +254182528510`;
}

async function join(
  phone: string,
  channel: Channel,
  existingSession: Session | null,
): Promise<string> {
  if (existingSession) {
    const step = existingSession.step as JoinStep;
    const collected = sessionData(existingSession.collected_data);
    await saveSession(phone, channel, step, collected);
    return promptFor(step, collected);
  }
  const member = await getMemberByPhone(phone);
  if (member) {
    const { error: consentError } = await getServiceClient()
      .from("pending_registrations")
      .update({ consent_given: true, admin_notes: null })
      .eq("phone_number", phone)
      .eq("status", "approved");
    check(consentError, "Renew member messaging consent");
    if (!member.whatsapp_opt_in) {
      const { error } = await getServiceClient()
        .from("profiles")
        .update({
          whatsapp_opt_in: true,
          whatsapp_opt_in_at: new Date().toISOString(),
          prefers_sms: channel === "sms",
        })
        .eq("id", member.id);
      check(error, "Re-subscribe member");
      return "You are already registered! Messages are re-enabled.\nText HELP to see available commands.";
    }
    return "You are already registered!\nText HELP to see available commands.";
  }
  const { data: profile, error: profileError } = await getServiceClient()
    .from("profiles")
    .select("status")
    .eq("phone_number", phone)
    .maybeSingle();
  check(profileError, "Check existing profile");
  if (profile)
    return profile.status === "pending"
      ? ALREADY_PENDING
      : "Please contact the admin at +254182528510 about your account.";

  const { data: pending, error } = await getServiceClient()
    .from("pending_registrations")
    .select("status")
    .eq("phone_number", phone)
    .maybeSingle();
  check(error, "Check existing application");
  if (pending?.status === "pending") return ALREADY_PENDING;
  if (pending?.status === "approved")
    return "You are already registered!\nText HELP to see available commands.";
  await saveSession(phone, channel, "name", {});
  return promptFor("name", {});
}

async function continueJoin(
  phone: string,
  channel: Channel,
  session: Session,
  text: string,
): Promise<string> {
  const result = advanceJoin(session.step as JoinStep, sessionData(session.collected_data), text);
  if (result.action === "cancel") await clearSession(phone, channel);
  if (result.action === "save" || result.action === "keep")
    await saveSession(phone, channel, result.step, result.collected);
  if (result.action === "complete") return register(phone, channel, result.collected);
  return result.reply;
}

async function balance(member: Profile): Promise<string> {
  const { data, error } = await getServiceClient().rpc("bot_member_balance", {
    _member_id: member.id,
  });
  check(error, "Read member balance");
  const result = data?.[0];
  return `💰 Your Balance
────────────────
Name: ${member.full_name ?? "Member"}
Total Contributions: KES ${money(Number(result?.total ?? 0))}
Last Contribution: ${result?.last_amount == null ? "None yet" : `KES ${money(Number(result.last_amount))} on ${kenyaDate(result.last_date!)}`}

Pay via M-Pesa (KCB Bank Kenya):
Paybill: 522522
Account: 798164

Text HELP for all commands`;
}

async function approvedLoans(member: Profile): Promise<Loan[]> {
  const { data, error } = await getServiceClient()
    .from("loans")
    .select("id,amount,status")
    .eq("member_id", member.id)
    .in("status", ["approved", "disbursed"]);
  check(error, "Read approved loans");
  return data ?? [];
}

async function installments(loans: Loan[]): Promise<Installment[]> {
  if (!loans.length) return [];
  const rows: Installment[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getServiceClient()
      .from("loan_repayments")
      .select("loan_id,amount_due,amount_paid,installment_number,due_date,status")
      .in(
        "loan_id",
        loans.map((loan) => loan.id),
      )
      .order("due_date", { ascending: true })
      .range(offset, offset + 499);
    check(error, "Read loan installments");
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return rows;
}

function remaining(loan: Loan, rows: Installment[]): number {
  const schedule = rows.filter((row) => row.loan_id === loan.id);
  return schedule.length
    ? schedule.reduce(
        (total, row) => total + Math.max(0, Number(row.amount_due) - Number(row.amount_paid)),
        0,
      )
    : Number(loan.amount);
}

async function loanSummary(member: Profile): Promise<string> {
  const loans = await approvedLoans(member);
  const rows = await installments(loans);
  const active = loans.filter((loan) => remaining(loan, rows) > 0);
  if (!active.length)
    return "You have no active loans.\nVisit murage-funds-hub.vercel.app\nto apply for a loan.";
  const activeIds = new Set(active.map((loan) => loan.id));
  const unpaid = rows.filter(
    (row) => activeIds.has(row.loan_id) && Number(row.amount_paid) < Number(row.amount_due),
  );
  const next = unpaid[0];
  const { data: flags, error } = await getServiceClient()
    .from("loan_risk_flags")
    .select("loan_id,risk_tier")
    .in(
      "loan_id",
      active.map((loan) => loan.id),
    );
  check(error, "Read loan risk flags");
  const riskOrder = ["healthy", "early_overdue", "watch", "high_risk", "critical_defaulter"];
  const tier = (flags ?? []).reduce(
    (worst, flag) =>
      riskOrder.indexOf(flag.risk_tier ?? "healthy") > riskOrder.indexOf(worst)
        ? (flag.risk_tier ?? "healthy")
        : worst,
    "healthy",
  );
  const principal = active.reduce((sum, loan) => sum + Number(loan.amount), 0);
  const outstanding = active.reduce((sum, loan) => sum + remaining(loan, rows), 0);
  const paid = rows
    .filter((row) => activeIds.has(row.loan_id))
    .reduce((sum, row) => sum + Number(row.amount_paid), 0);
  return `🏦 Your Loan Summary
────────────────────
Loan Amount:  KES ${money(principal)}
Total Paid:   KES ${money(paid)}
Remaining:    KES ${money(outstanding)}
Next Payment: ${next ? `KES ${money(Math.max(0, Number(next.amount_due) - Number(next.amount_paid)))} due ${kenyaDate(next.due_date)}` : "Schedule not yet available"}
Risk Status:  ${tier.replace(/_/g, " ")}

Text SCHEDULE for full schedule
Text HELP for all commands`;
}

async function schedule(member: Profile): Promise<string> {
  const loans = await approvedLoans(member);
  const rows = await installments(loans);
  const active = loans.filter((loan) => remaining(loan, rows) > 0);
  if (!active.length)
    return "You have no active loans.\nVisit murage-funds-hub.vercel.app to apply for a loan.";
  const ids = new Set(active.map((loan) => loan.id));
  const today = kenyaToday();
  const upcoming = rows
    .filter(
      (row) =>
        ids.has(row.loan_id) &&
        (row.due_date >= today || Number(row.amount_paid) < Number(row.amount_due)),
    )
    .slice(0, 5);
  const lines = upcoming.map((row) => {
    const paid = Number(row.amount_paid) >= Number(row.amount_due);
    const emoji = paid ? "✅" : row.due_date < today ? "❌" : "⏳";
    const due = paid
      ? Number(row.amount_due)
      : Math.max(0, Number(row.amount_due) - Number(row.amount_paid));
    return `#${row.installment_number} ${kenyaDate(row.due_date)} KES ${money(due)} ${emoji}`;
  });
  return `📅 Repayment Schedule
────────────────────
Loan Total: KES ${money(active.reduce((sum, loan) => sum + Number(loan.amount), 0))}

${lines.length ? lines.join("\n") : "Your schedule is not yet available."}

Status: ✅ Paid  ⏳ Pending  ❌ Overdue
Text LOANS for loan summary`;
}

async function deposit(phone: string, channel: Channel, text: string): Promise<string> {
  const parsed = parseDeposit(text);
  if (!parsed) return DEPOSIT_FORMAT;
  const member = await getMemberByPhone(phone);
  if (!member) return NOT_REGISTERED;
  const client = getServiceClient();
  const { data: duplicate, error: lookupError } = await client
    .from("contributions")
    .select("id")
    .eq("mpesa_transaction_id", parsed.ref)
    .limit(1);
  check(lookupError, "Check M-Pesa reference");
  if (duplicate?.length)
    return "That M-Pesa reference has already been submitted. Contact +254182528510 if you need help.";
  const { error } = await client.from("contributions").insert({
    member_id: member.id,
    amount: parsed.amount,
    status: "pending",
    method: "mpesa",
    reference: parsed.ref,
    mpesa_transaction_id: parsed.ref,
    mpesa_sender_phone: phone,
    paybill_number: "522522",
    notes: `Submitted via ${channel} bot; awaiting treasury verification`,
  });
  if (error?.code === "23505")
    return "That M-Pesa reference has already been submitted. Contact +254182528510 if you need help.";
  check(error, "Save pending deposit");
  await notifyAdmin(
    `🔔 New Deposit Pending
─────────────────────
Member: ${member.full_name ?? "Member"}
Amount: KES ${money(parsed.amount)}
M-Pesa Ref: ${parsed.ref}
Phone: ${phone}

Confirm at:
murage-funds-hub.vercel.app/contributions-review`,
    channel,
  );
  return `✅ Deposit Submitted
──────────────────
Amount: KES ${money(parsed.amount)}
M-Pesa Ref: ${parsed.ref}
Paybill: 522522
Account: 798164
Status: Pending confirmation

Treasurer will confirm within 24hrs.
You will be notified here. 🙏`;
}

async function pendingContributions(): Promise<string> {
  const { data, count, error } = await getServiceClient()
    .from("contributions")
    .select("amount,mpesa_transaction_id,reference,profiles:member_id(full_name)", {
      count: "exact",
    })
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  check(error, "Read pending contributions");
  const lines = (data ?? []).map(
    (row, index) =>
      `${index + 1}. ${row.profiles?.full_name ?? "Member"} KES ${money(Number(row.amount))} ${row.mpesa_transaction_id ? `Ref:${row.mpesa_transaction_id}` : `Ref:${row.reference ?? "—"} (web review)`}`,
  );
  return `📋 Pending Contributions (${count ?? 0})
──────────────────────────────────
${lines.join("\n") || "No pending deposits."}${(count ?? 0) > 10 ? "\nMore in the web app." : ""}

Reply: CONFIRM {ref} to approve M-Pesa deposits\nOther contributions: review in the web app`;
}

async function confirmContribution(phone: string, text: string): Promise<string> {
  const match = /^CONFIRM\s+([A-Z0-9]{6,20})$/i.exec(text.trim());
  if (!match) return "Correct format: CONFIRM {mpesa_ref}\nExample: CONFIRM QWE123456";
  const ref = match[1].toUpperCase();
  const officer = await getMemberByPhone(phone);
  if (!officer) return "⛔ This command is for officers only.";
  const { data, error } = await getServiceClient()
    .from("contributions")
    .update({
      status: "confirmed",
      confirmed_by: officer.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("mpesa_transaction_id", ref)
    .eq("status", "pending")
    .select("member_id,amount")
    .maybeSingle();
  check(error, "Confirm contribution");
  if (!data)
    return "No pending contribution found for that reference. It may already be confirmed.";
  const { data: member, error: memberError } = await getServiceClient()
    .from("profiles")
    .select("*")
    .eq("id", data.member_id)
    .maybeSingle();
  check(memberError, "Read contribution member");
  const { data: balances, error: balanceError } = await getServiceClient().rpc(
    "bot_member_balance",
    { _member_id: data.member_id },
  );
  check(balanceError, "Read confirmed total");
  if (member?.phone_number && member.whatsapp_opt_in && !member.is_anonymized) {
    try {
      await sendMessage({
        to: member.phone_number,
        channel: member.prefers_sms ? "sms" : "whatsapp",
        message: `✅ Contribution Confirmed!
─────────────────────────
Amount: KES ${money(Number(data.amount))}
M-Pesa Ref: ${ref}
Date: ${kenyaDate(new Date())}
New Total: KES ${money(Number(balances?.[0]?.total ?? 0))}

Pay via M-Pesa:
Paybill: 522522  Account: 798164
Thank you! 🙏 Murage Foundation`,
      });
    } catch (notificationError) {
      console.error(
        "[whatsapp-bot] Confirmation saved, member notification failed:",
        notificationError,
      );
    }
  }
  return `✅ Contribution ${ref} confirmed.\nNew total: KES ${money(Number(balances?.[0]?.total ?? 0))}`;
}

async function stop(phone: string, channel: Channel): Promise<string> {
  await clearSession(phone, channel);
  const client = getServiceClient();
  // Record withdrawal even if an admin is currently approving an applicant:
  // a linked but not-yet-approved profile is invisible to getMemberByPhone.
  const { data: application, error: applicationError } = await client
    .from("pending_registrations")
    .update({ consent_given: false, admin_notes: "Applicant withdrew via STOP" })
    .eq("phone_number", phone)
    .in("status", ["pending", "approved"])
    .select("id,status,profile_id")
    .maybeSingle();
  check(applicationError, "Withdraw messaging consent");
  if (application?.status === "pending") {
    const { error } = await client
      .from("pending_registrations")
      .update({ status: "rejected" })
      .eq("id", application.id)
      .eq("status", "pending");
    check(error, "Withdraw pending application");
  }
  const member = await getMemberByPhone(phone);
  const profileId = member?.id ?? application?.profile_id;
  if (profileId) {
    const { error } = await client
      .from("profiles")
      .update({ whatsapp_opt_in: false })
      .eq("id", profileId);
    check(error, "Unsubscribe member");
  }
  return "You have been unsubscribed from\nMurage Foundation messages.\n\nText JOIN to re-register anytime.\nAdmin: +254182528510";
}

async function handleMessage(phone: string, channel: Channel, text: string): Promise<string> {
  try {
    const trimmed = text.trim();
    const command = trimmed.split(/\s+/)[0].toUpperCase();
    const session = await readSession(phone, channel);
    if (command === "STOP") return stop(phone, channel);
    if (command === "JOIN") return join(phone, channel, session);
    if (session) return continueJoin(phone, channel, session, trimmed);

    switch (command) {
      case "HELP":
        return HELP;
      case "BAL": {
        const member = await getMemberByPhone(phone);
        return member ? balance(member) : NOT_REGISTERED;
      }
      case "LOANS": {
        const member = await getMemberByPhone(phone);
        return member ? loanSummary(member) : NOT_REGISTERED;
      }
      case "SCHEDULE": {
        const member = await getMemberByPhone(phone);
        return member ? schedule(member) : NOT_REGISTERED;
      }
      case "DEPOSIT":
        return deposit(phone, channel, trimmed);
      case "PENDING":
        return (await isOfficer(phone))
          ? pendingContributions()
          : "⛔ This command is for officers only.\nText HELP for available commands.";
      case "CONFIRM":
        return (await isOfficer(phone))
          ? confirmContribution(phone, trimmed)
          : "⛔ This command is for officers only.\nText HELP for available commands.";
      default:
        return "❓ Command not recognized.\n\nText HELP to see all commands.\n\nMurage Foundation Bot 🌟";
    }
  } catch (error) {
    console.error("[whatsapp-bot] Could not process incoming message:", error);
    return "We couldn't process that request right now. Please try again later or contact +254182528510.";
  }
}

function sameSecret(expected: string, provided: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // AT retries anything but HTTP 200. Authentication, parse and DB failures
  // all return 200, but MUST NOT perform any mutations on unauthorized calls.
  try {
    if (req.method !== "POST") return jsonResponse({ received: true });
    const secret = Deno.env.get("AFRICASTALKING_WEBHOOK_SECRET");
    const provided =
      new URL(req.url).searchParams.get("token") ?? req.headers.get("x-at-webhook-secret") ?? "";
    if (!secret || !sameSecret(secret, provided)) {
      console.error("[whatsapp-bot] Webhook authentication missing or invalid");
      return jsonResponse({ received: true });
    }
    if (Number(req.headers.get("content-length") ?? 0) > 4096) {
      return jsonResponse({ received: true });
    }
    const inbound = parseInbound(
      await req.text(),
      (req.headers.get("content-type") ?? "").toLowerCase(),
    );
    if (!inbound) return jsonResponse({ received: true });
    const phone = normalizePhone(inbound.from);
    const channel = inbound.channel;
    const reply = await handleMessage(phone, channel, inbound.text);
    try {
      await sendMessage({ to: phone, message: reply, channel });
    } catch (error) {
      console.error("[whatsapp-bot] Reply delivery failed:", error);
    }
  } catch (error) {
    console.error("[whatsapp-bot] Webhook error (acknowledging AT):", error);
  }
  return jsonResponse({ received: true });
});
