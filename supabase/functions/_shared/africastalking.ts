import type { Database } from "../../../src/integrations/supabase/types.ts";
import { getServiceClient } from "./supabase.ts";
import { normalizePhone, type Channel } from "./bot-utils.ts";

export { normalizePhone } from "./bot-utils.ts";
export type { Channel } from "./bot-utils.ts";
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** AT's SMS and WhatsApp APIs have DIFFERENT hosts, paths and request formats. */
export async function sendMessage({
  to,
  message,
  channel,
}: {
  to: string;
  message: string;
  channel: Channel;
}): Promise<void> {
  const recipient = `+${normalizePhone(to)}`;
  const username = Deno.env.get("AFRICASTALKING_USERNAME");
  const apiKey = Deno.env.get("AFRICASTALKING_API_KEY");
  if (!username || !apiKey) throw new Error("Africa's Talking credentials are not configured");
  const sandbox = Deno.env.get("AFRICASTALKING_ENV") !== "live";

  try {
    let response: Response;
    if (channel === "sms") {
      const form = new URLSearchParams({ username, to: recipient, message });
      const sender = Deno.env.get("AFRICASTALKING_SMS_SENDER_ID");
      if (sender) form.set("from", sender);
      response = await fetch(
        `${sandbox ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com"}/version1/messaging`,
        {
          method: "POST",
          headers: {
            apiKey,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
        },
      );
    } else {
      // This is the registered AT WhatsApp SENDER, not the admin's contact
      // number. AT currently lists its WhatsApp sandbox as 'coming soon'.
      const waNumber = Deno.env.get("AFRICASTALKING_WHATSAPP_NUMBER");
      if (!waNumber) throw new Error("AFRICASTALKING_WHATSAPP_NUMBER is required for WhatsApp");
      response = await fetch(
        `${sandbox ? "https://chat.sandbox.africastalking.com" : "https://chat.africastalking.com"}/whatsapp/message/send`,
        {
          method: "POST",
          headers: { apiKey, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            waNumber: `+${normalizePhone(waNumber)}`,
            phoneNumber: recipient,
            body: { message },
          }),
        },
      );
    }

    if (!response.ok) throw new Error(`AT ${channel} request failed (HTTP ${response.status})`);
    const result: unknown = await response.json();
    if (channel === "sms") {
      const recipients =
        isObject(result) && isObject(result.SMSMessageData)
          ? result.SMSMessageData.Recipients
          : undefined;
      const first = Array.isArray(recipients) ? (recipients[0] as unknown) : undefined;
      if (!isObject(first) || (first.statusCode !== 101 && first.status !== "Success")) {
        throw new Error("AT SMS rejected the message");
      }
    } else if (
      !isObject(result) ||
      !["SENT", "DELIVERED", "READ"].includes(String(result.status))
    ) {
      throw new Error("AT WhatsApp rejected the message");
    }
  } catch (error) {
    // Never log API credentials or message bodies (may contain account links).
    console.error(`[Africa's Talking] ${channel} delivery failed:`, error);
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getMemberByPhone(phone: string): Promise<Profile | null> {
  const canonical = normalizePhone(phone);
  const local = `0${canonical.slice(3)}`;
  try {
    // Also accept legacy numbers until the migration normalizes them.
    const { data, error } = await getServiceClient()
      .from("profiles")
      .select("*")
      .in("phone_number", [canonical, `+${canonical}`, local, canonical.slice(3)])
      .eq("status", "approved")
      .eq("is_anonymized", false)
      .limit(2);
    if (error) throw error;
    if (data && data.length > 1)
      throw new Error("Duplicate member phone; resolve before using the bot");
    return data?.[0] ?? null;
  } catch (error) {
    console.error("[whatsapp-bot] Member phone lookup failed:", error);
    throw error;
  }
}

export async function isOfficer(phone: string): Promise<boolean> {
  try {
    const member = await getMemberByPhone(phone);
    if (!member) return false;
    const { data, error } = await getServiceClient()
      .from("user_roles")
      .select("role")
      .eq("user_id", member.id)
      .in("role", ["admin", "treasurer"])
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error("[whatsapp-bot] Officer lookup failed:", error);
    throw error;
  }
}
