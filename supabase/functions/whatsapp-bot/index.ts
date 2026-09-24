// supabase/functions/whatsapp-bot/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage, normalizePhone, formatKES, formatDate } from "../_shared/africastalking.ts";

// ── Supabase Client ───────────────────────────────
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const ADMIN_PHONE = Deno.env.get("ADMIN_WHATSAPP_NUMBER") ?? "254182528510";
const PAYBILL = "522522";
const ACCOUNT = "798164";

// ── Types ─────────────────────────────────────────
interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  phone_only_member: boolean;
  prefers_sms: boolean;
  whatsapp_opt_in: boolean;
}

interface Session {
  phone_number: string;
  channel: string;
  step: string;
  collected_data: Record<string, string>;
}

// ── Main Handler ──────────────────────────────────
Deno.serve(async (req: Request) => {
  // Always return 200 to Africa's Talking
  // to prevent webhook retries
  try {
    const formData = await req.formData();

    const rawPhone = formData.get("from")?.toString() ?? "";
    const rawMessage = formData.get("text")?.toString() ?? "";
    const channel = (formData.get("channel")?.toString() as "whatsapp" | "sms") ?? "sms";

    const phone = normalizePhone(rawPhone);
    const message = rawMessage.trim().toUpperCase();

    console.log(`[Bot] ${channel} from ${phone}: ${message}`);

    // Check for active session first
    const session = await getSession(phone);

    if (session && session.step !== "start") {
      // User is in middle of JOIN flow
      if (message === "CANCEL") {
        await deleteSession(phone);
        await sendMessage({
          to: phone,
          channel,
          message: "Registration cancelled.\nText JOIN to start again anytime. 🌟",
        });
        return new Response("OK", { status: 200 });
      }

      // Check if they sent a different command mid-registration
      const commands = ["BAL", "LOANS", "DEPOSIT", "SCHEDULE", "HELP", "STOP", "PENDING"];
      if (commands.some((cmd) => message.startsWith(cmd))) {
        await sendMessage({
          to: phone,
          channel,
          message:
            "You have an incomplete registration.\n\nReply YES to continue\nor NO to cancel.",
        });
        return new Response("OK", { status: 200 });
      }

      // Continue JOIN conversation
      await handleJoinStep(phone, channel, message, session);
      return new Response("OK", { status: 200 });
    }

    // No active session — handle commands
    if (message === "JOIN") {
      await handleJoin(phone, channel);
    } else if (message === "BAL" || message === "BALANCE") {
      await handleBalance(phone, channel);
    } else if (message === "LOANS" || message === "LOAN") {
      await handleLoans(phone, channel);
    } else if (message.startsWith("DEPOSIT")) {
      await handleDeposit(phone, channel, message);
    } else if (message === "SCHEDULE") {
      await handleSchedule(phone, channel);
    } else if (message === "PENDING") {
      await handlePending(phone, channel);
    } else if (message.startsWith("CONFIRM")) {
      await handleConfirm(phone, channel, message);
    } else if (message === "STOP") {
      await handleStop(phone, channel);
    } else if (message === "HELP") {
      await handleHelp(phone, channel);
    } else {
      await sendMessage({
        to: phone,
        channel,
        message:
          "❓ Command not recognized.\n\nText HELP to see all available commands.\n\nMurage Foundation 🌟",
      });
    }
  } catch (err) {
    console.error("[Bot Fatal Error]", err);
  }

  return new Response("OK", { status: 200 });
});

// ══════════════════════════════════════════════════
// SESSION HELPERS
// ══════════════════════════════════════════════════

async function getSession(phone: string): Promise<Session | null> {
  try {
    const { data } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("phone_number", phone)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    return data;
  } catch {
    return null;
  }
}

async function saveSession(
  phone: string,
  channel: string,
  step: string,
  data: Record<string, string>,
): Promise<void> {
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await supabase.from("whatsapp_sessions").upsert(
    {
      phone_number: phone,
      channel,
      step,
      collected_data: data,
      last_message_at: new Date().toISOString(),
      expires_at: expires,
    },
    { onConflict: "phone_number" },
  );
}

async function deleteSession(phone: string): Promise<void> {
  await supabase.from("whatsapp_sessions").delete().eq("phone_number", phone);
}

// ══════════════════════════════════════════════════
// MEMBER LOOKUP
// ══════════════════════════════════════════════════

async function getMemberByPhone(phone: string): Promise<Profile | null> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone_number, phone_only_member, prefers_sms, whatsapp_opt_in")
      .eq("phone_number", phone)
      .eq("status", "approved")
      .maybeSingle();
    return data;
  } catch {
    return null;
  }
}

async function isOfficer(phone: string): Promise<boolean> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone_number", phone)
      .maybeSingle();

    if (!profile) return false;

    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id)
      .in("role", ["admin", "treasurer"])
      .maybeSingle();

    return !!role;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════
// JOIN FLOW
// ══════════════════════════════════════════════════

async function handleJoin(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  // Check already registered
  const existing = await getMemberByPhone(phone);
  if (existing) {
    await sendMessage({
      to: phone,
      channel,
      message: "You are already a registered member! 🎉\n\nText HELP to see available commands.",
    });
    return;
  }

  // Check already pending
  const { data: pending } = await supabase
    .from("pending_registrations")
    .select("status")
    .eq("phone_number", phone)
    .eq("status", "pending")
    .maybeSingle();

  if (pending) {
    await sendMessage({
      to: phone,
      channel,
      message:
        "Your application is already pending review. ⏳\n\nYou will be notified once approved.\n\nQuestions? Call +254182528510",
    });
    return;
  }

  // Start registration
  await saveSession(phone, channel, "name", {});
  await sendMessage({
    to: phone,
    channel,
    message:
      "Welcome to Murage Foundation! 🌟\n\nI will help you register.\n\nWhat is your full name?\n\n(Reply CANCEL to stop)",
  });
}

async function handleJoinStep(
  phone: string,
  channel: "whatsapp" | "sms",
  message: string,
  session: Session,
): Promise<void> {
  const data = session.collected_data;

  switch (session.step) {
    case "name": {
      // Save name, ask for role
      const name = message
        .split(" ")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      await saveSession(phone, channel, "role", { ...data, full_name: name });
      await sendMessage({
        to: phone,
        channel,
        message: `Thank you ${name}! 👋\n\nWhat role are you applying for?\n\n1️⃣  MEMBER\n2️⃣  BOARD MEMBER\n3️⃣  SECRETARY\n4️⃣  ASSISTANT SECRETARY\n\nReply with the number (1-4)`,
      });
      break;
    }

    case "role": {
      const roleMap: Record<string, string> = {
        "1": "member",
        "2": "board_member",
        "3": "secretary",
        "4": "assistant_secretary",
      };

      const role = roleMap[message];
      if (!role) {
        await sendMessage({
          to: phone,
          channel,
          message:
            "Please reply with a number:\n\n1️⃣  MEMBER\n2️⃣  BOARD MEMBER\n3️⃣  SECRETARY\n4️⃣  ASSISTANT SECRETARY",
        });
        return;
      }

      await saveSession(phone, channel, "email", { ...data, role });
      await sendMessage({
        to: phone,
        channel,
        message:
          "Do you have an email address?\n\nAn email gives you full web app access at:\nmurage-funds-hub.vercel.app\n\nReply with your email\nOR reply SKIP for phone access only",
      });
      break;
    }

    case "email": {
      let email: string | null = null;
      let phoneOnly = false;

      if (message === "SKIP") {
        phoneOnly = true;
      } else if (message.includes("@")) {
        email = message.toLowerCase();
      } else {
        await sendMessage({
          to: phone,
          channel,
          message: "Please enter a valid email address\nOR reply SKIP for phone-only access.",
        });
        return;
      }

      await saveSession(phone, channel, "confirm", {
        ...data,
        email: email ?? "",
        phone_only: phoneOnly ? "true" : "false",
      });

      const roleLabels: Record<string, string> = {
        member: "Member",
        board_member: "Board Member",
        secretary: "Secretary",
        assistant_secretary: "Assistant Secretary",
      };

      await sendMessage({
        to: phone,
        channel,
        message:
          `Please confirm your details:\n\n` +
          `Name:  ${data.full_name}\n` +
          `Role:  ${roleLabels[data.role] ?? data.role}\n` +
          `Email: ${email ?? "None - Phone Only"}\n` +
          `Phone: ${phone}\n\n` +
          `Reply YES to confirm\nor NO to start over`,
      });
      break;
    }

    case "confirm": {
      if (message === "YES" || message === "Y") {
        // Save to pending_registrations
        try {
          await supabase.from("pending_registrations").insert({
            phone_number: phone,
            full_name: data.full_name,
            email: data.email || null,
            requested_role: data.role,
            registration_channel: channel,
            status: "pending",
          });

          await deleteSession(phone);

          await sendMessage({
            to: phone,
            channel,
            message:
              "✅ Application Submitted!\n\n" +
              "The admin will review your\n" +
              "application within 24 hours.\n\n" +
              "You will be notified here\nonce approved.\n\n" +
              "Questions? Call +254182528510\n\n" +
              "Murage Foundation 🌟",
          });

          // Notify admin
          await sendMessage({
            to: ADMIN_PHONE,
            channel: "whatsapp",
            message:
              "🔔 New Registration Request\n" +
              "─────────────────────────\n" +
              `Name:    ${data.full_name}\n` +
              `Role:    ${data.role}\n` +
              `Phone:   ${phone}\n` +
              `Email:   ${data.email || "None - Phone Only"}\n` +
              `Channel: ${channel}\n\n` +
              `Review & approve at:\n` +
              `murage-funds-hub.vercel.app/users`,
          });
        } catch (err) {
          console.error("[JOIN Save Error]", err);
          await sendMessage({
            to: phone,
            channel,
            message: "❌ Something went wrong.\nPlease try again or contact:\n+254182528510",
          });
        }
      } else if (message === "NO" || message === "N") {
        await deleteSession(phone);
        await sendMessage({
          to: phone,
          channel,
          message: "Registration restarted.\nText JOIN to begin again. 🌟",
        });
      } else {
        await sendMessage({
          to: phone,
          channel,
          message: "Please reply YES to confirm\nor NO to start over.",
        });
      }
      break;
    }

    default: {
      await deleteSession(phone);
      await handleJoin(phone, channel);
    }
  }
}

// ══════════════════════════════════════════════════
// BAL COMMAND
// ══════════════════════════════════════════════════

async function handleBalance(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  const member = await getMemberByPhone(phone);
  if (!member) {
    await sendMessage({
      to: phone,
      channel,
      message: "You are not registered.\nText JOIN to apply for membership. 🌟",
    });
    return;
  }

  try {
    const { data: contributions } = await supabase
      .from("contributions")
      .select("amount, contributed_on")
      .eq("member_id", member.id)
      .eq("status", "confirmed")
      .order("contributed_on", { ascending: false });

    const total =
      contributions?.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0) ?? 0;

    const last = contributions?.[0];

    await sendMessage({
      to: phone,
      channel,
      message:
        `💰 Your Balance\n` +
        `────────────────\n` +
        `Name:  ${member.full_name}\n` +
        `Total Contributions: ${formatKES(total)}\n` +
        (last
          ? `Last Contribution: ${formatKES(last.amount)} on ${formatDate(last.contributed_on)}\n`
          : `No contributions yet.\n`) +
        `\nPay via M-Pesa:\n` +
        `Paybill: ${PAYBILL}\n` +
        `Account: ${ACCOUNT}\n\n` +
        `Text HELP for all commands`,
    });
  } catch (err) {
    console.error("[BAL Error]", err);
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Could not fetch balance.\nPlease try again later.",
    });
  }
}

// ══════════════════════════════════════════════════
// LOANS COMMAND
// ══════════════════════════════════════════════════

async function handleLoans(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  const member = await getMemberByPhone(phone);
  if (!member) {
    await sendMessage({
      to: phone,
      channel,
      message: "You are not registered.\nText JOIN to apply for membership. 🌟",
    });
    return;
  }

  try {
    const { data: loans } = await supabase
      .from("loans")
      .select("id, amount, status, loan_type")
      .eq("member_id", member.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!loans || loans.length === 0) {
      await sendMessage({
        to: phone,
        channel,
        message:
          "You have no active loans.\n\nVisit our web app to apply:\nmurage-funds-hub.vercel.app\n\nText HELP for commands",
      });
      return;
    }

    const loan = loans[0];

    const { data: repayments } = await supabase
      .from("loan_repayments")
      .select("amount_due, amount_paid, due_date, status")
      .eq("loan_id", loan.id)
      .order("due_date", { ascending: true });

    const totalPaid =
      repayments?.reduce((sum: number, r: { amount_paid: number }) => sum + r.amount_paid, 0) ?? 0;

    const remaining = loan.amount - totalPaid;

    const nextPayment = repayments?.find(
      (r: { status: string }) => r.status === "pending" || r.status === "overdue",
    );

    // Get risk tier
    const { data: riskData } = await supabase
      .from("loan_risk_flags")
      .select("risk_tier")
      .eq("loan_id", loan.id)
      .maybeSingle();

    await sendMessage({
      to: phone,
      channel,
      message:
        `🏦 Your Loan Summary\n` +
        `────────────────────\n` +
        `Loan Amount:  ${formatKES(loan.amount)}\n` +
        `Total Paid:   ${formatKES(totalPaid)}\n` +
        `Remaining:    ${formatKES(remaining)}\n` +
        (nextPayment
          ? `Next Payment: ${formatKES(nextPayment.amount_due)} due ${formatDate(nextPayment.due_date)}\n`
          : `All payments up to date! ✅\n`) +
        `Risk Status:  ${riskData?.risk_tier ?? "healthy"}\n\n` +
        `Text SCHEDULE for full schedule\n` +
        `Text HELP for all commands`,
    });
  } catch (err) {
    console.error("[LOANS Error]", err);
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Could not fetch loan info.\nPlease try again later.",
    });
  }
}

// ══════════════════════════════════════════════════
// DEPOSIT COMMAND
// ══════════════════════════════════════════════════

async function handleDeposit(
  phone: string,
  channel: "whatsapp" | "sms",
  message: string,
): Promise<void> {
  const member = await getMemberByPhone(phone);
  if (!member) {
    await sendMessage({
      to: phone,
      channel,
      message: "You are not registered.\nText JOIN to apply for membership. 🌟",
    });
    return;
  }

  // Parse: DEPOSIT 5000 ABC123
  const parts = message.split(/\s+/);
  if (parts.length < 3) {
    await sendMessage({
      to: phone,
      channel,
      message:
        "❌ Invalid format.\n\n" +
        "Correct format:\n" +
        "DEPOSIT {amount} {mpesa_ref}\n\n" +
        "Example:\n" +
        "DEPOSIT 5000 QWE123456\n\n" +
        `Paybill: ${PAYBILL}\n` +
        `Account: ${ACCOUNT}`,
    });
    return;
  }

  const amount = parseFloat(parts[1]);
  const mpesaRef = parts[2].toUpperCase();

  if (isNaN(amount) || amount <= 0) {
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Invalid amount.\n\n" + "Example:\n" + "DEPOSIT 5000 QWE123456",
    });
    return;
  }

  try {
    // Check if ref already submitted
    const { data: existing } = await supabase
      .from("contributions")
      .select("id")
      .eq("mpesa_transaction_id", mpesaRef)
      .maybeSingle();

    if (existing) {
      await sendMessage({
        to: phone,
        channel,
        message:
          "⚠️ This M-Pesa reference has\nalready been submitted.\n\nContact admin if this is an error:\n+254182528510",
      });
      return;
    }

    // Create pending contribution
    await supabase.from("contributions").insert({
      member_id: member.id,
      amount,
      status: "pending",
      method: "mpesa",
      paybill_number: PAYBILL,
      mpesa_transaction_id: mpesaRef,
      mpesa_sender_phone: phone,
      contributed_on: new Date().toISOString().split("T")[0],
    });

    // Confirm to member
    await sendMessage({
      to: phone,
      channel,
      message:
        `✅ Deposit Submitted\n` +
        `──────────────────\n` +
        `Amount:     ${formatKES(amount)}\n` +
        `M-Pesa Ref: ${mpesaRef}\n` +
        `Paybill:    ${PAYBILL}\n` +
        `Account:    ${ACCOUNT}\n` +
        `Status:     Pending confirmation\n\n` +
        `Treasurer will confirm within 24hrs.\n` +
        `You will be notified here. 🙏`,
    });

    // Notify admin
    await sendMessage({
      to: ADMIN_PHONE,
      channel: "whatsapp",
      message:
        `🔔 New Deposit Pending\n` +
        `─────────────────────\n` +
        `Member:     ${member.full_name}\n` +
        `Amount:     ${formatKES(amount)}\n` +
        `M-Pesa Ref: ${mpesaRef}\n` +
        `Phone:      ${phone}\n\n` +
        `Confirm at:\n` +
        `murage-funds-hub.vercel.app/contributions`,
    });
  } catch (err) {
    console.error("[DEPOSIT Error]", err);
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Could not submit deposit.\nPlease try again or contact:\n+254182528510",
    });
  }
}

// ══════════════════════════════════════════════════
// SCHEDULE COMMAND
// ══════════════════════════════════════════════════

async function handleSchedule(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  const member = await getMemberByPhone(phone);
  if (!member) {
    await sendMessage({
      to: phone,
      channel,
      message: "You are not registered.\nText JOIN to apply for membership. 🌟",
    });
    return;
  }

  try {
    const { data: loans } = await supabase
      .from("loans")
      .select("id, amount")
      .eq("member_id", member.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!loans || loans.length === 0) {
      await sendMessage({
        to: phone,
        channel,
        message: "You have no active loans.\n\nText HELP for all commands",
      });
      return;
    }

    const loan = loans[0];

    const { data: repayments } = await supabase
      .from("loan_repayments")
      .select("installment_number, amount_due, due_date, status")
      .eq("loan_id", loan.id)
      .order("due_date", { ascending: true })
      .limit(5);

    if (!repayments || repayments.length === 0) {
      await sendMessage({
        to: phone,
        channel,
        message: "No repayment schedule found.\nContact admin: +254182528510",
      });
      return;
    }

    const statusEmoji: Record<string, string> = {
      paid: "✅",
      pending: "⏳",
      overdue: "❌",
      partial: "🔸",
    };

    const scheduleLines = repayments
      .map(
        (r: { installment_number: number; due_date: string; amount_due: number; status: string }) =>
          `${r.installment_number}. ${formatDate(r.due_date)} ${formatKES(r.amount_due)} ${statusEmoji[r.status] ?? "⏳"}`,
      )
      .join("\n");

    await sendMessage({
      to: phone,
      channel,
      message:
        `📅 Repayment Schedule\n` +
        `────────────────────\n` +
        `Loan Total: ${formatKES(loan.amount)}\n\n` +
        scheduleLines +
        `\n\n✅ Paid  ⏳ Pending  ❌ Overdue\n\n` +
        `Text LOANS for loan summary`,
    });
  } catch (err) {
    console.error("[SCHEDULE Error]", err);
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Could not fetch schedule.\nPlease try again later.",
    });
  }
}

// ══════════════════════════════════════════════════
// PENDING COMMAND (Officers Only)
// ══════════════════════════════════════════════════

async function handlePending(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  const officer = await isOfficer(phone);
  if (!officer) {
    await sendMessage({
      to: phone,
      channel,
      message: "⛔ This command is for officers only.\n\nText HELP for available commands.",
    });
    return;
  }

  try {
    const { data: pending } = await supabase
      .from("contributions")
      .select("id, amount, mpesa_transaction_id, profiles(full_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (!pending || pending.length === 0) {
      await sendMessage({
        to: phone,
        channel,
        message: "✅ No pending contributions.\n\nAll contributions are confirmed!",
      });
      return;
    }

    const lines = pending
      .map(
        (
          c: {
            amount: number;
            mpesa_transaction_id: string;
            profiles: { full_name: string } | null;
          },
          i: number,
        ) =>
          `${i + 1}. ${c.profiles?.full_name ?? "Unknown"} ${formatKES(c.amount)} Ref:${c.mpesa_transaction_id ?? "N/A"}`,
      )
      .join("\n");

    await sendMessage({
      to: phone,
      channel,
      message:
        `📋 Pending Contributions (${pending.length})\n` +
        `──────────────────────────────────\n` +
        lines +
        `\n\nReply: CONFIRM {ref} to approve`,
    });
  } catch (err) {
    console.error("[PENDING Error]", err);
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Could not fetch pending list.\nPlease try again later.",
    });
  }
}

// ══════════════════════════════════════════════════
// CONFIRM COMMAND (Officers Only)
// ══════════════════════════════════════════════════

async function handleConfirm(
  phone: string,
  channel: "whatsapp" | "sms",
  message: string,
): Promise<void> {
  const officer = await isOfficer(phone);
  if (!officer) {
    await sendMessage({
      to: phone,
      channel,
      message: "⛔ This command is for officers only.\n\nText HELP for available commands.",
    });
    return;
  }

  const parts = message.split(/\s+/);
  if (parts.length < 2) {
    await sendMessage({
      to: phone,
      channel,
      message:
        "❌ Invalid format.\n\nCorrect format:\nCONFIRM {mpesa_ref}\n\nExample:\nCONFIRM QWE123456",
    });
    return;
  }

  const ref = parts[1].toUpperCase();

  try {
    // Find contribution
    const { data: contribution } = await supabase
      .from("contributions")
      .select("id, amount, member_id, status")
      .eq("mpesa_transaction_id", ref)
      .eq("status", "pending")
      .maybeSingle();

    if (!contribution) {
      await sendMessage({
        to: phone,
        channel,
        message: `❌ No pending contribution found\nwith ref: ${ref}\n\nText PENDING to see all pending`,
      });
      return;
    }

    // Get officer profile for confirmed_by
    const { data: officerProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone_number", phone)
      .maybeSingle();

    // Confirm the contribution
    await supabase
      .from("contributions")
      .update({
        status: "confirmed",
        confirmed_by: officerProfile?.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", contribution.id);

    // Get member new total
    const { data: allContribs } = await supabase
      .from("contributions")
      .select("amount")
      .eq("member_id", contribution.member_id)
      .eq("status", "confirmed");

    const newTotal =
      allContribs?.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0) ?? 0;

    // Get member phone
    const { data: memberProfile } = await supabase
      .from("profiles")
      .select("phone_number, full_name, prefers_sms")
      .eq("id", contribution.member_id)
      .maybeSingle();

    // Notify member
    if (memberProfile?.phone_number) {
      const memberChannel = memberProfile.prefers_sms ? "sms" : "whatsapp";
      await sendMessage({
        to: memberProfile.phone_number,
        channel: memberChannel,
        message:
          `✅ Contribution Confirmed!\n` +
          `─────────────────────────\n` +
          `Amount:     ${formatKES(contribution.amount)}\n` +
          `M-Pesa Ref: ${ref}\n` +
          `Date:       ${formatDate(new Date().toISOString())}\n` +
          `New Total:  ${formatKES(newTotal)}\n\n` +
          `Thank you! 🙏\n` +
          `Murage Foundation`,
      });
    }

    // Confirm to officer
    await sendMessage({
      to: phone,
      channel,
      message:
        `✅ Contribution Confirmed!\n\n` +
        `Member: ${memberProfile?.full_name ?? "Unknown"}\n` +
        `Amount: ${formatKES(contribution.amount)}\n` +
        `Ref:    ${ref}\n\n` +
        `Member has been notified.`,
    });
  } catch (err) {
    console.error("[CONFIRM Error]", err);
    await sendMessage({
      to: phone,
      channel,
      message: "❌ Could not confirm contribution.\nPlease try again later.",
    });
  }
}

// ══════════════════════════════════════════════════
// STOP COMMAND
// ══════════════════════════════════════════════════

async function handleStop(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  try {
    await supabase.from("profiles").update({ whatsapp_opt_in: false }).eq("phone_number", phone);

    await sendMessage({
      to: phone,
      channel,
      message:
        "You have been unsubscribed from\nMurage Foundation messages.\n\nText JOIN to re-register anytime.\nAdmin: +254182528510",
    });
  } catch (err) {
    console.error("[STOP Error]", err);
  }
}

// ══════════════════════════════════════════════════
// HELP COMMAND
// ══════════════════════════════════════════════════

async function handleHelp(phone: string, channel: "whatsapp" | "sms"): Promise<void> {
  await sendMessage({
    to: phone,
    channel,
    message:
      `📱 Murage Foundation Bot\n` +
      `────────────────────────\n` +
      `Commands:\n\n` +
      `JOIN     - Register as a member\n` +
      `BAL      - Check your balance\n` +
      `LOANS    - View loan status\n` +
      `DEPOSIT  - Submit a payment\n` +
      `           e.g. DEPOSIT 5000 ABC123\n` +
      `SCHEDULE - Repayment schedule\n` +
      `HELP     - Show this menu\n` +
      `STOP     - Unsubscribe\n\n` +
      `Pay via M-Pesa:\n` +
      `Paybill: ${PAYBILL}\n` +
      `Account: ${ACCOUNT}\n\n` +
      `Web App:\n` +
      `murage-funds-hub.vercel.app\n\n` +
      `Admin: +254182528510\n` +
      `Murage Foundation 🌟`,
  });
}
