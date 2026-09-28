import { supabase } from "@/integrations/supabase/client";

export const LOAN_PAYMENT_ADMIN_PHONE = "254182528510";

type NotificationTemplate =
  | "loan_status_changed"
  | "contribution_reviewed"
  | "meeting_scheduled"
  | "loan_payment_submitted"
  | "loan_payment_confirmed"
  | "loan_payment_rejected";

export async function sendNotificationEmail(params: {
  to: string | string[];
  subject: string;
  template: NotificationTemplate;
  data: Record<string, unknown>;
}) {
  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: params,
    });
    if (error) {
      console.warn(
        "[Notification Service] Edge function error (falling back to mock):",
        error.message,
      );
      return { success: false, error: error.message };
    }
    return data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("[Notification Service] Error sending email notification:", message);
    return { success: false, error: message };
  }
}

type LoanPaymentMessage =
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

async function sendLoanPaymentMessage(payload: LoanPaymentMessage): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("loan-payment-notifications", {
      body: payload,
    });
    if (error) throw error;
  } catch (error: unknown) {
    console.warn("[Notification Service] Loan payment SMS/WhatsApp delivery failed:", error);
  }
}

async function financeOfficerEmails(): Promise<string[]> {
  try {
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "treasurer"]);
    if (roleError) throw roleError;

    const userIds = [...new Set((roleRows ?? []).map((row) => row.user_id))];
    if (userIds.length === 0) return [];

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("email")
      .in("id", userIds);
    if (profileError) throw profileError;

    return (profiles ?? [])
      .map((profile) => profile.email)
      .filter((email): email is string => Boolean(email));
  } catch (error: unknown) {
    console.warn("[Notification Service] Could not find finance officer emails:", error);
    return [];
  }
}

export async function notifyLoanStatusChange({
  memberEmail,
  memberName,
  loanAmount,
  loanType,
  status,
  reason,
  repaymentMonths,
}: {
  memberEmail: string;
  memberName?: string;
  loanAmount: number;
  loanType: string;
  status: string;
  reason?: string;
  repaymentMonths?: number;
}) {
  if (!memberEmail) return;
  return sendNotificationEmail({
    to: memberEmail,
    subject: `Murage Foundation — Loan Application ${status.toUpperCase()}`,
    template: "loan_status_changed",
    data: {
      memberName,
      loanAmount,
      loanType,
      status,
      reason,
      repaymentMonths,
    },
  });
}

export async function notifyContributionReview({
  memberEmail,
  memberName,
  amount,
  status,
  method,
  reference,
  notes,
}: {
  memberEmail: string;
  memberName?: string;
  amount: number;
  status: string;
  method?: string;
  reference?: string;
  notes?: string;
}) {
  if (!memberEmail) return;
  return sendNotificationEmail({
    to: memberEmail,
    subject: `Murage Foundation — Contribution ${status === "confirmed" ? "Confirmed" : "Update"}`,
    template: "contribution_reviewed",
    data: {
      memberName,
      amount,
      status,
      method,
      reference,
      notes,
    },
  });
}

export async function notifyLoanPaymentSubmitted({
  memberName,
  amount,
  reference,
  installmentNumber,
  loanId,
  submittedAt,
}: {
  memberName: string;
  amount: number;
  reference: string;
  installmentNumber: number;
  loanId: string;
  submittedAt: string;
}) {
  await sendLoanPaymentMessage({
    event: "submitted",
    memberName,
    amount,
    reference,
    installmentNumber,
    loanId,
  });

  const officerEmails = await financeOfficerEmails();
  // Finance officers receive the email when their profiles have email addresses.
  // The configured phone is included for the existing WhatsApp/SMS integration
  // and is also a safe fallback for environments without officer email rows.
  const recipients = officerEmails.length > 0 ? officerEmails : [LOAN_PAYMENT_ADMIN_PHONE];
  return sendNotificationEmail({
    to: recipients,
    subject: `Murage Foundation — Loan Payment Awaiting Confirmation (${reference})`,
    template: "loan_payment_submitted",
    data: {
      memberName,
      amount,
      reference,
      installmentNumber,
      loanId,
      submittedAt,
      adminPhone: LOAN_PAYMENT_ADMIN_PHONE,
    },
  });
}

export async function notifyLoanPaymentConfirmed({
  memberEmail,
  memberId,
  memberPhone,
  memberName,
  amount,
  reference,
  installmentNumber,
  outstandingBalance,
  confirmedAt,
}: {
  memberEmail: string;
  memberId: string;
  memberPhone?: string;
  memberName?: string;
  amount: number;
  reference?: string;
  installmentNumber: number;
  outstandingBalance?: number;
  confirmedAt: string;
}) {
  await sendLoanPaymentMessage({
    event: "confirmed",
    memberId,
    memberPhone,
    memberName: memberName ?? "Member",
    amount,
    reference,
    installmentNumber,
    outstandingBalance,
  });
  if (!memberEmail) return;
  return sendNotificationEmail({
    to: memberEmail,
    subject: "Murage Foundation — Loan Payment Confirmed",
    template: "loan_payment_confirmed",
    data: {
      memberName,
      amount,
      reference,
      installmentNumber,
      outstandingBalance,
      confirmedAt,
    },
  });
}

export async function notifyLoanPaymentRejected({
  memberEmail,
  memberId,
  memberPhone,
  memberName,
  amount,
  reference,
  installmentNumber,
  reason,
  rejectedAt,
}: {
  memberEmail: string;
  memberId: string;
  memberPhone?: string;
  memberName?: string;
  amount: number;
  reference?: string;
  installmentNumber: number;
  reason: string;
  rejectedAt: string;
}) {
  await sendLoanPaymentMessage({
    event: "rejected",
    memberId,
    memberPhone,
    memberName: memberName ?? "Member",
    amount,
    reference,
    installmentNumber,
    reason,
  });
  if (!memberEmail) return;
  return sendNotificationEmail({
    to: memberEmail,
    subject: "Murage Foundation — Loan Payment Needs Attention",
    template: "loan_payment_rejected",
    data: {
      memberName,
      amount,
      reference,
      installmentNumber,
      reason,
      rejectedAt,
      adminPhone: LOAN_PAYMENT_ADMIN_PHONE,
    },
  });
}

export async function notifyNewMeeting({
  title,
  scheduledFor,
  location,
  agenda,
}: {
  title: string;
  scheduledFor: string;
  location?: string;
  agenda?: string;
}) {
  try {
    const { data: members } = await supabase
      .from("profiles")
      .select("email")
      .eq("status", "approved");

    const emails = (members || []).map((member) => member.email).filter(Boolean) as string[];
    if (emails.length === 0) return;

    return sendNotificationEmail({
      to: emails,
      subject: `Notice of Foundation Meeting: ${title}`,
      template: "meeting_scheduled",
      data: {
        title,
        scheduledFor,
        location,
        agenda,
      },
    });
  } catch (error: unknown) {
    console.warn("[Notification Service] Failed to broadcast meeting notification:", error);
  }
}
