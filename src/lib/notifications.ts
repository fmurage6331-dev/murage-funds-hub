import { supabase } from "@/integrations/supabase/client";

type EmailTemplate = "loan_status_changed" | "contribution_reviewed" | "meeting_scheduled";
type BotEvent = "contribution_confirmed" | "loan_decided" | "meeting_scheduled";
type DeliveryResult = { success: boolean; sent?: number; failed?: number; error?: string };

function isDeliveryResult(value: unknown): value is DeliveryResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof value.success === "boolean"
  );
}

// The browser never receives an Africa's Talking API key or supplies arbitrary
// phone numbers/message bodies. The authenticated Edge Function checks officer
// roles, fetches the record + member's prefers_sms/opt-in, and sends via AT.
export async function sendWhatsAppSMS({
  event,
  recordId,
}: {
  event: BotEvent;
  recordId: string;
}): Promise<DeliveryResult> {
  try {
    const { data, error } = await supabase.functions.invoke("bot-notifications", {
      body: { event, recordId },
    });
    if (error) {
      if ("context" in error && error.context instanceof Response) {
        const details: unknown = await error.context.json();
        if (isDeliveryResult(details) && details.error) throw new Error(details.error);
      }
      throw error;
    }
    const response: unknown = data;
    if (!isDeliveryResult(response) || !response.success)
      throw new Error("Notification delivery failed");
    if (response.failed)
      throw new Error(`${response.failed} member notifications could not be delivered`);
    return response;
  } catch (error) {
    console.error("[Notification Service] WhatsApp/SMS delivery failed", error);
    throw error;
  }
}

export async function sendNotificationEmail(params: {
  to: string | string[];
  subject: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("send-email", { body: params });
    if (error) throw error;
  } catch (error) {
    console.error("[Notification Service] Email delivery failed", error);
    throw error;
  }
}

export async function notifyLoanStatusChange({
  loanId,
  memberEmail,
  memberName,
  loanAmount,
  loanType,
  status,
  reason,
  repaymentMonths,
}: {
  loanId?: string;
  memberEmail?: string | null;
  memberName?: string;
  loanAmount: number;
  loanType: string;
  status: string;
  reason?: string;
  repaymentMonths?: number;
}): Promise<void> {
  const deliveries: Promise<unknown>[] = [];
  if (memberEmail) {
    deliveries.push(
      sendNotificationEmail({
        to: memberEmail,
        subject: `Murage Foundation — Loan Application ${status.toUpperCase()}`,
        template: "loan_status_changed",
        data: { memberName, loanAmount, loanType, status, reason, repaymentMonths },
      }),
    );
  }
  if (loanId && (status === "approved" || status === "rejected")) {
    deliveries.push(sendWhatsAppSMS({ event: "loan_decided", recordId: loanId }));
  }
  await Promise.all(deliveries);
}

export async function notifyContributionReview({
  contributionId,
  memberEmail,
  memberName,
  amount,
  status,
  method,
  reference,
  notes,
}: {
  contributionId: string;
  memberEmail?: string | null;
  memberName?: string;
  amount: number;
  status: "confirmed" | "rejected";
  method?: string;
  reference?: string;
  notes?: string;
}): Promise<void> {
  const deliveries: Promise<unknown>[] = [];
  if (memberEmail) {
    deliveries.push(
      sendNotificationEmail({
        to: memberEmail,
        subject: `Murage Foundation — Contribution ${status === "confirmed" ? "Confirmed" : "Update"}`,
        template: "contribution_reviewed",
        data: { memberName, amount, status, method, reference, notes },
      }),
    );
  }
  if (status === "confirmed") {
    deliveries.push(sendWhatsAppSMS({ event: "contribution_confirmed", recordId: contributionId }));
  }
  await Promise.all(deliveries);
}

export async function notifyNewMeeting({
  meetingId,
  title,
  scheduledFor,
  location,
  agenda,
}: {
  meetingId: string;
  title: string;
  scheduledFor: string;
  location?: string;
  agenda?: string;
}): Promise<void> {
  try {
    const { data: members, error } = await supabase
      .from("profiles")
      .select("email")
      .eq("status", "approved")
      .eq("is_anonymized", false);
    if (error) throw error;
    const emails = (members ?? []).flatMap((member) => (member.email ? [member.email] : []));
    const phoneDelivery = sendWhatsAppSMS({ event: "meeting_scheduled", recordId: meetingId });
    await Promise.all([
      phoneDelivery,
      ...(emails.length
        ? [
            sendNotificationEmail({
              to: emails,
              subject: `Notice of Foundation Meeting: ${title}`,
              template: "meeting_scheduled",
              data: { title, scheduledFor, location, agenda },
            }),
          ]
        : []),
    ]);
  } catch (error) {
    console.error("[Notification Service] Meeting broadcast failed", error);
    throw error;
  }
}
