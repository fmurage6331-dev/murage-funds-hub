import test from "node:test";
import assert from "node:assert/strict";
import { handleWebhook, type WebhookDependencies } from "./webhook.ts";
import type { Channel } from "./bot-utils.ts";

type Incoming = { phone: string; channel: Channel; text: string };
type Outgoing = { to: string; channel: Channel; message: string };

function harness() {
  const incoming: Incoming[] = [];
  const outgoing: Outgoing[] = [];
  const errors: string[] = [];
  const deps: WebhookDependencies = {
    webhookSecret: "a-long-private-callback-secret",
    handleMessage: async (phone, channel, text) => {
      incoming.push({ phone, channel, text });
      return `Reply: ${text}`;
    },
    sendMessage: async (args) => {
      outgoing.push(args);
    },
    logError: (message) => {
      errors.push(message);
    },
  };
  return { deps, incoming, outgoing, errors };
}

function callback(
  body: string,
  token = "a-long-private-callback-secret",
  type = "application/x-www-form-urlencoded",
) {
  return new Request(`https://example.supabase.co/functions/v1/whatsapp-bot?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });
}

async function acknowledged(response: Response): Promise<void> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await response.json(), { received: true });
}

test("unauthorized and malformed callbacks always return 200 without processing messages", async () => {
  const { deps, incoming, outgoing, errors } = harness();
  const body = "from=%2B254712345678&text=JOIN";
  await acknowledged(await handleWebhook(callback(body, "wrong"), deps));
  await acknowledged(await handleWebhook(callback(body, ""), deps));
  await acknowledged(
    await handleWebhook(callback(body, "wrong", "application/x-www-form-urlencoded"), {
      ...deps,
      webhookSecret: undefined,
    }),
  );
  await acknowledged(
    await handleWebhook(
      new Request("https://example.supabase.co/functions/v1/whatsapp-bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-at-webhook-secret": "a-long-private-callback-secret",
        },
        body,
      }),
      deps,
    ),
  );
  await acknowledged(await handleWebhook(callback("{", undefined, "application/json"), deps));
  await acknowledged(await handleWebhook(callback("from=%2B254312345678&text=HELP"), deps));
  await acknowledged(await handleWebhook(callback("x".repeat(4097)), deps));
  await acknowledged(
    await handleWebhook(new Request("https://example.supabase.co/functions/v1/whatsapp-bot"), deps),
  );
  assert.equal(errors.length, 4); // two bad tokens, missing secret, invalid Kenyan caller
  assert.deepEqual(incoming, [{ phone: "254712345678", channel: "sms", text: "JOIN" }]);
  assert.deepEqual(outgoing, [{ to: "254712345678", channel: "sms", message: "Reply: JOIN" }]);
});

test("authenticated SMS and WhatsApp callbacks normalize callers before sending", async () => {
  const { deps, incoming, outgoing } = harness();
  await acknowledged(await handleWebhook(callback("from=0712345678&text=+BAL+&channel=sms"), deps));
  await acknowledged(
    await handleWebhook(
      callback('{"from":"+254712345678","message":"HELP"}', undefined, "application/json"),
      deps,
    ),
  );
  assert.deepEqual(incoming, [
    { phone: "254712345678", channel: "sms", text: "BAL" },
    { phone: "254712345678", channel: "whatsapp", text: "HELP" },
  ]);
  assert.deepEqual(outgoing, [
    { to: "254712345678", channel: "sms", message: "Reply: BAL" },
    { to: "254712345678", channel: "whatsapp", message: "Reply: HELP" },
  ]);
});

test("message-processing and outbound failures are logged and acknowledged without retries", async () => {
  const { deps, errors, incoming, outgoing } = harness();
  await acknowledged(
    await handleWebhook(callback("from=0712345678&text=JOIN"), {
      ...deps,
      handleMessage: async () => {
        throw new Error("DB unavailable");
      },
    }),
  );
  await acknowledged(
    await handleWebhook(callback("from=0712345678&text=HELP"), {
      ...deps,
      sendMessage: async () => {
        throw new Error("AT unavailable");
      },
    }),
  );
  assert.equal(incoming.length, 1);
  assert.equal(outgoing.length, 0);
  assert.ok(errors.some((message) => message.includes("Webhook error")));
  assert.ok(errors.some((message) => message.includes("Reply delivery failed")));
});
