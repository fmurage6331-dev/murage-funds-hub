import { normalizePhone, type Channel } from "./bot-utils.ts";

export type OutboundMessage = { to: string; message: string; channel: Channel };
export type ProviderOptions = {
  username?: string;
  apiKey?: string;
  environment?: string;
  whatsappNumber?: string;
  smsSenderId?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** AT's SMS and WhatsApp APIs have different hosts and request formats.
 * Fetch is injectable for contract tests: tests never need live API keys.
 */
export async function sendViaAfricaTalking(
  { to, message, channel }: OutboundMessage,
  config: ProviderOptions,
  transport: typeof fetch = fetch,
): Promise<void> {
  const recipient = `+${normalizePhone(to)}`;
  const { username, apiKey } = config;
  if (!username || !apiKey) throw new Error("Africa's Talking credentials are not configured");
  if (config.environment && config.environment !== "sandbox" && config.environment !== "live") {
    throw new Error("AFRICASTALKING_ENV must be sandbox or live");
  }
  const sandbox = config.environment !== "live";

  let response: Response;
  if (channel === "sms") {
    const form = new URLSearchParams({ username, to: recipient, message });
    if (config.smsSenderId) form.set("from", config.smsSenderId);
    response = await transport(
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
    // AT currently labels its WhatsApp sandbox as 'coming soon'. The registered
    // sender is distinct from the Foundation admin's contact phone.
    if (!config.whatsappNumber)
      throw new Error("AFRICASTALKING_WHATSAPP_NUMBER is required for WhatsApp");
    response = await transport(
      `${sandbox ? "https://chat.sandbox.africastalking.com" : "https://chat.africastalking.com"}/whatsapp/message/send`,
      {
        method: "POST",
        headers: { apiKey, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          waNumber: `+${normalizePhone(config.whatsappNumber)}`,
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
    const first: unknown = Array.isArray(recipients) ? recipients[0] : undefined;
    if (!isObject(first) || (first.statusCode !== 101 && first.status !== "Success")) {
      throw new Error("AT SMS rejected the message");
    }
  } else if (!isObject(result) || !["SENT", "DELIVERED", "READ"].includes(String(result.status))) {
    throw new Error("AT WhatsApp rejected the message");
  }
}
