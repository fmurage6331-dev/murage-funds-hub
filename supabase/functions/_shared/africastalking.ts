// supabase/functions/_shared/africastalking.ts
// Africa's Talking API helper for WhatsApp & SMS

const AT_USERNAME = Deno.env.get("AFRICASTALKING_USERNAME") ?? "";
const AT_API_KEY = Deno.env.get("AFRICASTALKING_API_KEY") ?? "";
const AT_ENV = Deno.env.get("AFRICASTALKING_ENV") ?? "sandbox";

const AT_BASE_URL =
  AT_ENV === "sandbox"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";

// ── Types ────────────────────────────────────────

export interface SendMessageParams {
  to: string;
  message: string;
  channel?: "whatsapp" | "sms";
}

export interface ATResponse {
  SMSMessageData?: {
    Message: string;
    Recipients: Array<{
      statusCode: number;
      number: string;
      status: string;
      cost: string;
      messageId: string;
    }>;
  };
}

// ── Phone Normalization ───────────────────────────

export function normalizePhone(phone: string): string {
  // Remove all spaces
  let normalized = phone.replace(/\s+/g, "");

  // Remove leading +
  if (normalized.startsWith("+")) {
    normalized = normalized.slice(1);
  }

  // Convert 07XXXXXXXX to 2547XXXXXXXX
  if (normalized.startsWith("0")) {
    normalized = "254" + normalized.slice(1);
  }

  // Convert 7XXXXXXXX to 2547XXXXXXXX
  if (normalized.startsWith("7") && normalized.length === 9) {
    normalized = "254" + normalized;
  }

  return normalized;
}

// ── Send Message ──────────────────────────────────

export async function sendMessage({
  to,
  message,
  channel = "sms",
}: SendMessageParams): Promise<void> {
  const normalizedTo = normalizePhone(to);

  try {
    if (channel === "whatsapp") {
      // WhatsApp via Africa's Talking
      const response = await fetch(`${AT_BASE_URL}/version1/messaging/whatsapp`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          apiKey: AT_API_KEY,
        },
        body: new URLSearchParams({
          username: AT_USERNAME,
          to: `+${normalizedTo}`,
          message,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[AT WhatsApp Error]", error);
      }
    } else {
      // SMS via Africa's Talking
      const response = await fetch(`${AT_BASE_URL}/version1/messaging`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          apiKey: AT_API_KEY,
        },
        body: new URLSearchParams({
          username: AT_USERNAME,
          to: `+${normalizedTo}`,
          message,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[AT SMS Error]", error);
      }
    }
  } catch (err) {
    console.error("[AT sendMessage Error]", err);
  }
}

// ── Format Currency ───────────────────────────────

export function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

// ── Format Date ───────────────────────────────────

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
