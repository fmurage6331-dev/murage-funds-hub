import { normalizePhone, type Channel } from "./bot-utils.ts";
import { jsonResponse } from "./http.ts";
import { parseInbound } from "./inbound.ts";

export type WebhookDependencies = {
  webhookSecret: string | undefined;
  handleMessage: (phone: string, channel: Channel, text: string) => Promise<string>;
  sendMessage: (args: { to: string; message: string; channel: Channel }) => Promise<void>;
  logError: (message: string, error?: unknown) => void;
};

function sameSecret(expected: string, provided: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

const acknowledge = () => jsonResponse({ received: true });

/** AT must always receive HTTP 200, even for invalid credentials or failures.
 * No processing or outbound send is attempted until the callback is verified.
 */
export async function handleWebhook(req: Request, deps: WebhookDependencies): Promise<Response> {
  try {
    if (req.method !== "POST") return acknowledge();
    const provided =
      new URL(req.url).searchParams.get("token") ?? req.headers.get("x-at-webhook-secret") ?? "";
    if (!deps.webhookSecret || !sameSecret(deps.webhookSecret, provided)) {
      deps.logError("[whatsapp-bot] Webhook authentication missing or invalid");
      return acknowledge();
    }
    if (Number(req.headers.get("content-length") ?? 0) > 4096) return acknowledge();
    const inbound = parseInbound(
      await req.text(),
      (req.headers.get("content-type") ?? "").toLowerCase(),
    );
    if (!inbound) return acknowledge();
    const phone = normalizePhone(inbound.from);
    const reply = await deps.handleMessage(phone, inbound.channel, inbound.text);
    try {
      await deps.sendMessage({ to: phone, message: reply, channel: inbound.channel });
    } catch (error) {
      deps.logError("[whatsapp-bot] Reply delivery failed:", error);
    }
  } catch (error) {
    deps.logError("[whatsapp-bot] Webhook error (acknowledging AT):", error);
  }
  return acknowledge();
}
