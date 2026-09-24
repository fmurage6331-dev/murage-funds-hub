import type { Channel } from "./bot-utils.ts";

export type IncomingMessage = { from: string; text: string; channel: Channel };

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function message(from: unknown, text: unknown, channel: Channel): IncomingMessage | null {
  if (typeof from !== "string" || typeof text !== "string") return null;
  const trimmed = text.trim();
  return !from || !trimmed || trimmed.length > 500 ? null : { from, text: trimmed, channel };
}

/**
 * AT's SMS callback is form-encoded (from/text/to/id). Accept simple JSON
 * WhatsApp callbacks and the standard nested WhatsApp messages shape too;
 * verify the live AT WhatsApp callback format with the provider before launch.
 * Unknown channel values or media/delivery events are deliberately ignored.
 */
export function parseInbound(raw: string, contentType: string): IncomingMessage | null {
  if (raw.length > 4096) return null;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(raw);
    const channel = form.get("channel")?.toLowerCase();
    if (channel && channel !== "sms" && channel !== "whatsapp") return null;
    return message(form.get("from"), form.get("text"), channel === "whatsapp" ? "whatsapp" : "sms");
  }
  if (!contentType.includes("application/json")) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record(payload)) return null;

  // A provider-configured flat JSON callback (not an SMS callback).
  if (typeof payload.from === "string") {
    const channel = payload.channel;
    if (channel !== undefined && channel !== "whatsapp") return null;
    return message(payload.from, payload.message ?? payload.text, "whatsapp");
  }

  // Some WhatsApp gateways forward the standard WhatsApp Business payload.
  const entry = Array.isArray(payload.entry) ? payload.entry[0] : undefined;
  const change = record(entry) && Array.isArray(entry.changes) ? entry.changes[0] : undefined;
  const value = record(change) ? change.value : undefined;
  if (!record(value) || value.messaging_product !== "whatsapp") return null;
  const incoming = Array.isArray(value.messages) ? value.messages[0] : undefined;
  if (!record(incoming) || incoming.type !== "text" || !record(incoming.text)) return null;
  return message(incoming.from, incoming.text.body, "whatsapp");
}
