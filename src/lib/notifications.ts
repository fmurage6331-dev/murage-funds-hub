import { supabase } from "@/integrations/supabase/client";

type NotificationEvent =
  "contribution_confirmed" | "loan_approved" | "loan_rejected" | "meeting_scheduled";
type DeliveryResult = {
  success: boolean;
  sent?: number;
  failed?: number;
  skipped?: number;
  error?: string;
};

/**
 * Requests an officer-authorized event notification. The Edge Function loads
 * the actual recipient phone, prefers_sms/opt-in and message from the database
 * before calling AT. Never put the AT API key (or arbitrary outbound text) in
 * browser code; otherwise any signed-in member could send messages as us.
 */
export async function sendWhatsAppSMS({
  type,
  recordId,
}: {
  type: NotificationEvent;
  recordId: string;
}): Promise<DeliveryResult> {
  try {
    const { data, error } = await supabase.functions.invoke<DeliveryResult>("notify-event", {
      body: { type, recordId },
    });
    if (error) throw error;
    if (!data) throw new Error("No delivery response");
    if (!data.success)
      console.error(
        "[Notification Service] AT delivery was not accepted:",
        data.error ?? data.failed,
      );
    return data;
  } catch (error) {
    console.error("[Notification Service] WhatsApp/SMS event failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Notification failed",
    };
  }
}

export async function sendNotificationEmail(params: {
  to: string | string[];
  subject: string;
  template: "loan_status_changed" | "contribution_reviewed" | "meeting_scheduled";
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[Notification Service] Error sending email notification:", msg);
    return { success: false, error: msg };
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
    // Fetch all active approved members to receive meeting notification
    const { data: members } = await supabase
      .from("profiles")
      .select("email")
      .eq("status", "approved");

    const emails = (members || []).map((m) => m.email).filter(Boolean) as string[];
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
  } catch (err) {
    console.warn("[Notification Service] Failed to broadcast meeting notification:", err);
  }
}
