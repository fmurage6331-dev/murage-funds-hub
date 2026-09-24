import type { Database } from "../../../src/integrations/supabase/types.ts";
import { getServiceClient } from "./supabase.ts";
import { normalizePhone } from "./bot-utils.ts";
import { sendViaAfricaTalking, type OutboundMessage } from "./at-provider.ts";

export { normalizePhone } from "./bot-utils.ts";
export type { Channel } from "./bot-utils.ts";
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Send with server-only credentials; never log the body (which may contain login links). */
export async function sendMessage(outbound: OutboundMessage): Promise<void> {
  try {
    await sendViaAfricaTalking(outbound, {
      username: Deno.env.get("AFRICASTALKING_USERNAME"),
      apiKey: Deno.env.get("AFRICASTALKING_API_KEY"),
      environment: Deno.env.get("AFRICASTALKING_ENV"),
      whatsappNumber: Deno.env.get("AFRICASTALKING_WHATSAPP_NUMBER"),
      smsSenderId: Deno.env.get("AFRICASTALKING_SMS_SENDER_ID"),
    });
  } catch (error) {
    console.error(`[Africa's Talking] ${outbound.channel} delivery failed:`, error);
    throw error;
  }
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
