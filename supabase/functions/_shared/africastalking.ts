import type { Database } from "../../../src/integrations/supabase/types.ts";
import { adminClient, dbResult } from "./db.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export type Channel = "whatsapp" | "sms";
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function normalizePhone(phone: string): string {
  if (!/^\+?[\d\s().-]+$/.test(phone.trim())) throw new Error("Invalid phone number");
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("00254")
    ? digits.slice(2)
    : digits.startsWith("254")
      ? digits
      : digits.startsWith("0")
        ? `254${digits.slice(1)}`
        : `254${digits}`;
  if (!/^254\d{9}$/.test(normalized)) throw new Error("Expected a Kenyan phone number");
  return normalized;
}

function environment(): "sandbox" | "live" {
  const value = Deno.env.get("AFRICASTALKING_ENV") ?? "sandbox";
  if (value !== "sandbox" && value !== "live") throw new Error("Invalid AFRICASTALKING_ENV");
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// AT SMS uses the Messaging API. AT WhatsApp uses a *different* Chat API
// host and requires an approved WhatsApp sender number. The official WhatsApp
// sandbox endpoint is not available yet, so sandbox WA traffic uses SMS.
// https://developers.africastalking.com/docs/whatsapp/send_message
export async function sendMessage({
  to,
  message,
  channel,
}: {
  to: string;
  message: string;
  channel: Channel;
}): Promise<void> {
  const destination = `+${normalizePhone(to)}`;
  const key = Deno.env.get("AFRICASTALKING_API_KEY");
  const configuredUsername = Deno.env.get("AFRICASTALKING_USERNAME");
  if (!key || !configuredUsername) throw new Error("Africa's Talking credentials are required");
  if (!message.trim()) throw new Error("Message cannot be empty");
  const env = environment();
  // AT requires the literal username 'sandbox' for SMS in its test environment.
  const username = env === "sandbox" ? "sandbox" : configuredUsername;
  const useSms = channel === "sms" || env === "sandbox";
  let response: Response;
  try {
    if (useSms) {
      const body = new URLSearchParams({ username, to: destination, message });
      response = await fetch(
        `${env === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com"}/version1/messaging`,
        {
          method: "POST",
          headers: {
            apiKey: key,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
    } else {
      const waNumber = Deno.env.get("AFRICASTALKING_WHATSAPP_NUMBER");
      if (!waNumber)
        throw new Error("AFRICASTALKING_WHATSAPP_NUMBER is required for live WhatsApp");
      response = await fetch("https://chat.africastalking.com/whatsapp/message/send", {
        method: "POST",
        headers: { apiKey: key, "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          waNumber: `+${normalizePhone(waNumber)}`,
          phoneNumber: destination,
          body: { message },
        }),
      });
    }
    if (!response.ok) throw new Error(`Africa's Talking HTTP ${response.status}`);
    const result: unknown = await response.json();
    if (!isObject(result)) throw new Error("Africa's Talking returned an invalid response");
    if (useSms) {
      const smsData = result.SMSMessageData;
      const recipients = isObject(smsData) ? smsData.Recipients : undefined;
      if (!Array.isArray(recipients) || recipients.length !== 1 || !isObject(recipients[0])) {
        throw new Error("Africa's Talking did not accept the SMS recipient");
      }
      if (recipients[0].statusCode !== 101) {
        throw new Error(`Africa's Talking SMS rejected (${String(recipients[0].statusCode)})`);
      }
    } else if (result.status !== "SENT" && result.status !== "DELIVERED") {
      // Some AT versions return statusString rather than status.
      if (result.statusString !== "SENT" && result.statusString !== "DELIVERED") {
        throw new Error(
          `Africa's Talking WhatsApp rejected (${String(result.statusString ?? result.status)})`,
        );
      }
    }
  } catch (error) {
    // Do not log message contents, authorization headers or generated auth links.
    console.error(`[bot delivery] ${channel} send failed`, error);
    throw error;
  }
}

export async function getMemberByPhone(phone: string): Promise<Profile | null> {
  const normalized = normalizePhone(phone);
  return dbResult(
    "member lookup",
    adminClient().from("profiles").select("*").eq("phone_number", normalized).maybeSingle(),
  );
}

export async function isOfficer(phone: string): Promise<boolean> {
  const member = await getMemberByPhone(phone);
  if (!member || member.status !== "approved" || member.is_anonymized) return false;
  const roles = await dbResult(
    "officer roles",
    adminClient()
      .from("user_roles")
      .select("id")
      .eq("user_id", member.id)
      .in("role", ["admin", "treasurer"])
      .limit(1),
  );
  return (roles?.length ?? 0) > 0;
}
