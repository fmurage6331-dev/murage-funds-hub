import test from "node:test";
import assert from "node:assert/strict";
import { sendViaAfricaTalking, type ProviderOptions } from "./at-provider.ts";

const config: ProviderOptions = {
  username: "sandbox",
  apiKey: "test-only-key",
  environment: "sandbox",
  whatsappNumber: "+254712345679",
  smsSenderId: "MURAGE",
};

function fakeResponse(body: unknown, status = 200) {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const transport: typeof fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, transport };
}

test("SMS uses the AT messaging API, form encoding, configured sender and normalized recipient", async () => {
  const { calls, transport } = fakeResponse({
    SMSMessageData: {
      Recipients: [{ number: "+254712345678", status: "Success", statusCode: 101 }],
    },
  });
  await sendViaAfricaTalking(
    { to: "0712345678", message: "BAL reply", channel: "sms" },
    config,
    transport,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.sandbox.africastalking.com/version1/messaging");
  assert.equal(calls[0].options?.method, "POST");
  const headers = new Headers(calls[0].options?.headers);
  assert.equal(headers.get("apiKey"), "test-only-key");
  assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
  const form = calls[0].options?.body;
  assert.ok(form instanceof URLSearchParams);
  assert.equal(form.get("username"), "sandbox");
  assert.equal(form.get("to"), "+254712345678");
  assert.equal(form.get("from"), "MURAGE");
  assert.equal(form.get("message"), "BAL reply");
});

test("WhatsApp uses the Chat API JSON payload with a distinct registered sender", async () => {
  const { calls, transport } = fakeResponse({ messageId: "ATX-1", status: "SENT" });
  await sendViaAfricaTalking(
    { to: "+254712345678", message: "Welcome", channel: "whatsapp" },
    { ...config, environment: "live", username: "murage-app" },
    transport,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://chat.africastalking.com/whatsapp/message/send");
  assert.equal(new Headers(calls[0].options?.headers).get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)), {
    username: "murage-app",
    waNumber: "+254712345679",
    phoneNumber: "+254712345678",
    body: { message: "Welcome" },
  });
});

test("rejects missing configuration, provider failures and malformed status without contacting AT", async () => {
  const message = { to: "+254712345678", message: "test", channel: "whatsapp" } as const;
  const accepted = fakeResponse({ status: "SENT" });
  await assert.rejects(
    sendViaAfricaTalking(message, { ...config, apiKey: undefined }, accepted.transport),
    /credentials/,
  );
  await assert.rejects(
    sendViaAfricaTalking(message, { ...config, environment: "production" }, accepted.transport),
    /AFRICASTALKING_ENV/,
  );
  await assert.rejects(
    sendViaAfricaTalking(message, { ...config, whatsappNumber: undefined }, accepted.transport),
    /WHATSAPP_NUMBER/,
  );
  await assert.rejects(
    sendViaAfricaTalking({ ...message, to: "not-a-phone" }, config, accepted.transport),
    /Invalid Kenyan phone/,
  );
  assert.equal(accepted.calls.length, 0);

  const rejectedWhatsApp = fakeResponse({ status: "FAILED" });
  await assert.rejects(
    sendViaAfricaTalking(message, config, rejectedWhatsApp.transport),
    /WhatsApp rejected/,
  );
  const rejectedSMS = fakeResponse({ SMSMessageData: { Recipients: [{ statusCode: 401 }] } });
  await assert.rejects(
    sendViaAfricaTalking({ ...message, channel: "sms" }, config, rejectedSMS.transport),
    /SMS rejected/,
  );
  const serverError = fakeResponse({ error: "down" }, 503);
  await assert.rejects(sendViaAfricaTalking(message, config, serverError.transport), /HTTP 503/);
});
