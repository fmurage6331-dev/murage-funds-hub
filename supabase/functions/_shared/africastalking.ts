const AT_USERNAME = Deno.env.get("AFRICASTALKING_USERNAME") ?? "";
const AT_API_KEY = Deno.env.get("AFRICASTALKING_API_KEY") ?? "";
const AT_ENV = Deno.env.get("AFRICASTALKING_ENV") ?? "sandbox";

const AT_BASE_URL =
  AT_ENV === "sandbox"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";

export interface SendMessageParams {
  to: string;
  message: string;
  channel?: "whatsapp" | "sms";
}

export function normalizePhone(phone: string): string {
  let normalized = phone.replace(/\s+/g, "");
  if (normalized.startsWith("+")) normalized = normalized.slice(1);
  if (normalized.startsWith("0")) normalized = "254" + normalized.slice(1);
  if (normalized.startsWith("7") && normalized.length === 9) normalized = "254" + normalized;
  return normalized;
}

export function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function sendMessage({
  to,
  message,
  channel = "sms",
}: SendMessageParams): Promise<void> {
  const normalizedTo = normalizePhone(to);

  console.log(`[AT] Sending ${channel} to +${normalizedTo}`);
  console.log(`[AT] Username: "${AT_USERNAME}"`);
  console.log(`[AT] ENV: "${AT_ENV}"`);
  console.log(`[AT] Base URL: ${AT_BASE_URL}`);
  console.log(`[AT] API Key length: ${AT_API_KEY.length}`);

  try {
    const endpoint =
      channel === "whatsapp"
        ? `${AT_BASE_URL}/version1/messaging/whatsapp`
        : `${AT_BASE_URL}/version1/messaging`;

    console.log(`[AT] Endpoint: ${endpoint}`);

    const body = new URLSearchParams({
      username: AT_USERNAME,
      to: `+${normalizedTo}`,
      message,
    });

    console.log(`[AT] Body: ${body.toString()}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        apiKey: AT_API_KEY,
      },
      body,
    });

    const responseText = await response.text();
    console.log(`[AT] Status: ${response.status}`);
    console.log(`[AT] Response: ${responseText}`);

    if (!response.ok) {
      console.error(`[AT ${channel} Error] ${response.status} ${responseText}`);
    } else {
      console.log(`[AT ${channel} Success] ${responseText}`);
    }
  } catch (err) {
    console.error(`[AT sendMessage Fatal]`, String(err));
  }
}
