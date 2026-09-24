import assert from "node:assert/strict";
import { normalizePhone, sendMessage } from "./africastalking.ts";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
    set(name: string, value: string): void;
    delete(name: string): void;
  };
  test(name: string, fn: () => Promise<void> | void): void;
};

Deno.test("normalizes Kenyan local and international phone numbers", () => {
  assert.equal(normalizePhone("0712 345 678"), "254712345678");
  assert.equal(normalizePhone("712-345-678"), "254712345678");
  assert.equal(normalizePhone("+254 (712) 345-678"), "254712345678");
  assert.equal(normalizePhone("00254712345678"), "254712345678");
  assert.equal(normalizePhone("254182528510"), "254182528510");
  assert.throws(() => normalizePhone("+44712345678"));
  assert.throws(() => normalizePhone("0712 bogus 678"));
});

const KEYS = [
  "AFRICASTALKING_USERNAME",
  "AFRICASTALKING_API_KEY",
  "AFRICASTALKING_ENV",
  "AFRICASTALKING_WHATSAPP_NUMBER",
] as const;
async function withProvider(
  environment: "live" | "sandbox",
  reply: Record<string, unknown>,
  test: (request: Request) => Promise<void>,
): Promise<void> {
  const original = Object.fromEntries(KEYS.map((key) => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const request = new Request(input, init);
    await test(request);
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    Deno.env.set("AFRICASTALKING_USERNAME", "muragefoundation");
    Deno.env.set("AFRICASTALKING_API_KEY", "test-not-a-real-key");
    Deno.env.set("AFRICASTALKING_ENV", environment);
    Deno.env.set("AFRICASTALKING_WHATSAPP_NUMBER", "254711111111");
    await sendMessage({ to: "+254712345678", message: "BAL", channel: "whatsapp" });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of KEYS) {
      const value = original[key];
      if (typeof value === "string") Deno.env.set(key, value);
      else Deno.env.delete(key);
    }
  }
}

Deno.test("sandbox WhatsApp falls back to the AT SMS endpoint with sandbox username", async () => {
  await withProvider(
    "sandbox",
    { SMSMessageData: { Recipients: [{ statusCode: 101 }] } },
    async (request) => {
      assert.equal(request.url, "https://api.sandbox.africastalking.com/version1/messaging");
      assert.equal(request.headers.get("apikey"), "test-not-a-real-key");
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("username"), "sandbox");
      assert.equal(body.get("to"), "+254712345678");
      assert.equal(body.get("message"), "BAL");
    },
  );
});

Deno.test("live WhatsApp uses the Chat API and configured approved sender", async () => {
  await withProvider(
    "live",
    { statusString: "SENT", messageId: "test-message" },
    async (request) => {
      assert.equal(request.url, "https://chat.africastalking.com/whatsapp/message/send");
      const body: unknown = await request.json();
      assert.deepEqual(body, {
        username: "muragefoundation",
        waNumber: "+254711111111",
        phoneNumber: "+254712345678",
        body: { message: "BAL" },
      });
    },
  );
});

Deno.test("provider rejections are errors, not successful deliveries", async () => {
  const originalFetch = globalThis.fetch;
  const previous = Object.fromEntries(KEYS.map((key) => [key, Deno.env.get(key)]));
  try {
    Deno.env.set("AFRICASTALKING_USERNAME", "sandbox");
    Deno.env.set("AFRICASTALKING_API_KEY", "test-not-a-real-key");
    Deno.env.set("AFRICASTALKING_ENV", "sandbox");
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 401 }] } }), {
        status: 200,
      });
    await assert.rejects(
      sendMessage({ to: "0712345678", message: "Hi", channel: "sms" }),
      /rejected/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of KEYS) {
      const value = previous[key];
      if (typeof value === "string") Deno.env.set(key, value);
      else Deno.env.delete(key);
    }
  }
});
