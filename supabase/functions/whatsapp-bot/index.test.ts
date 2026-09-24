import assert from "node:assert/strict";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
    set(name: string, value: string): void;
    delete(name: string): void;
  };
  serve(handler: (request: Request) => Promise<Response>): void;
  test(name: string, fn: () => Promise<void> | void): void;
};

let webhook: ((request: Request) => Promise<Response>) | undefined;
const originalServe = Deno.serve;
try {
  Deno.serve = (handler) => {
    webhook = handler;
  };
  await import("./index.ts");
} finally {
  Deno.serve = originalServe;
}

Deno.test(
  "unauthorized, malformed and invalid-phone callbacks are always acknowledged with 200",
  async () => {
    if (!webhook) throw new Error("Webhook handler was not registered");
    const previousSecret = Deno.env.get("AFRICASTALKING_WEBHOOK_SECRET");
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("Unexpected network request");
    };
    try {
      Deno.env.set(
        "AFRICASTALKING_WEBHOOK_SECRET",
        "a-very-long-and-unpredictable-test-only-secret",
      );
      const base = "https://example.supabase.co/functions/v1/whatsapp-bot";
      const wrongToken = await webhook(
        new Request(`${base}?token=wrong`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "from=%2B254712345678&text=BAL&channel=sms",
        }),
      );
      assert.equal(wrongToken.status, 200);

      const shortSecret = Deno.env.get("AFRICASTALKING_WEBHOOK_SECRET")?.slice(0, 10);
      Deno.env.set("AFRICASTALKING_WEBHOOK_SECRET", shortSecret ?? "invalid");
      const insecure = await webhook(
        new Request(`${base}?token=${shortSecret}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "from=%2B254712345678&text=HELP&channel=sms",
        }),
      );
      assert.equal(insecure.status, 200);
      Deno.env.set(
        "AFRICASTALKING_WEBHOOK_SECRET",
        "a-very-long-and-unpredictable-test-only-secret",
      );

      const badType = await webhook(
        new Request(`${base}?token=a-very-long-and-unpredictable-test-only-secret`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      assert.equal(badType.status, 200);
      const invalidPhone = await webhook(
        new Request(`${base}?token=a-very-long-and-unpredictable-test-only-secret`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "from=%2B15550000000&text=HELP&channel=sms",
        }),
      );
      assert.equal(invalidPhone.status, 200);
      assert.equal(networkCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousSecret) Deno.env.set("AFRICASTALKING_WEBHOOK_SECRET", previousSecret);
      else Deno.env.delete("AFRICASTALKING_WEBHOOK_SECRET");
    }
  },
);

Deno.test(
  "JOIN collects consent and saves a phone-only application after a paused conversation",
  async () => {
    if (!webhook) throw new Error("Webhook handler was not registered");
    const keys = [
      "AFRICASTALKING_WEBHOOK_SECRET",
      "AFRICASTALKING_ENV",
      "AFRICASTALKING_USERNAME",
      "AFRICASTALKING_API_KEY",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ] as const;
    const original = Object.fromEntries(keys.map((key) => [key, Deno.env.get(key)]));
    const originalFetch = globalThis.fetch;
    const secret = "a-very-long-and-unpredictable-test-only-secret";
    type Session = {
      id: string;
      phone_number: string;
      channel: string;
      step: string;
      collected_data: Record<string, unknown>;
      expires_at: string;
    };
    let session: Session | null = null;
    const applications: Array<Record<string, unknown>> = [];
    const outgoing: Array<{ to: string; text: string }> = [];
    const json = (value: unknown, status = 200): Response =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.hostname === "api.sandbox.africastalking.com") {
        const message = new URLSearchParams(await req.text());
        outgoing.push({ to: message.get("to") ?? "", text: message.get("message") ?? "" });
        return json({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } });
      }
      if (url.hostname !== "example.supabase.co")
        throw new Error(`Unexpected host: ${url.hostname}`);
      const table = url.pathname.split("/").pop();
      if (table === "whatsapp_sessions") {
        if (req.method === "GET") {
          const channel = url.searchParams.get("channel")?.replace(/^eq\./, "");
          return json(session?.channel === channel ? [session] : []);
        }
        if (req.method === "POST") {
          const values: unknown = await req.json();
          if (typeof values !== "object" || values === null || Array.isArray(values))
            throw new Error("Invalid session payload");
          session = { ...values, id: "00000000-0000-4000-8000-000000000001" } as Session;
          return json({}, 201);
        }
        if (req.method === "PATCH") {
          const values: unknown = await req.json();
          if (typeof values !== "object" || values === null || Array.isArray(values))
            throw new Error("Invalid update");
          session = { ...session, ...values } as Session;
          return json({});
        }
        if (req.method === "DELETE") {
          session = null;
          return json({});
        }
      }
      if (table === "profiles") {
        if (req.method === "GET" || req.method === "PATCH") return json([]);
      }
      if (table === "pending_registrations") {
        if (req.method === "GET") {
          const requestedStatus = url.searchParams.get("status")?.replace(/^eq\./, "");
          return json(applications.filter((application) => application.status === requestedStatus));
        }
        if (req.method === "PATCH") {
          for (const application of applications) application.status = "rejected";
          return json({});
        }
        if (req.method === "POST") {
          const row: unknown = await req.json();
          if (typeof row !== "object" || row === null || Array.isArray(row))
            throw new Error("Invalid application");
          applications.push(row as Record<string, unknown>);
          return json({}, 201);
        }
      }
      throw new Error(`Unexpected PostgREST operation: ${req.method} ${table}`);
    };
    try {
      Deno.env.set("AFRICASTALKING_WEBHOOK_SECRET", secret);
      Deno.env.set("AFRICASTALKING_ENV", "sandbox");
      Deno.env.set("AFRICASTALKING_USERNAME", "muragefoundation");
      Deno.env.set("AFRICASTALKING_API_KEY", "not-a-real-key");
      Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test-only");
      const send = async (text: string): Promise<Response> =>
        webhook!(
          new Request(`https://example.supabase.co/functions/v1/whatsapp-bot?token=${secret}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ from: "+254712345678", channel: "sms", text }),
          }),
        );
      for (const text of ["JOIN", "BAL", "YES", "Alice Murage", "1", "SKIP", "YES"]) {
        assert.equal((await send(text)).status, 200);
      }
      assert.equal(applications.length, 1);
      assert.equal(applications[0].phone_number, "254712345678");
      assert.equal(applications[0].full_name, "Alice Murage");
      assert.equal(applications[0].requested_role, "member");
      assert.equal(applications[0].email, null);
      assert.equal(session, null);
      assert.match(outgoing[0].text, /full name/i);
      assert.match(outgoing[1].text, /incomplete registration/i);
      assert.match(outgoing[2].text, /full name/i);
      assert.ok(
        outgoing.some(
          (item) => item.to === "+254182528510" && item.text.includes("New Registration Request"),
        ),
      );
      assert.match(outgoing.at(-1)?.text ?? "", /submitted for review/i);

      // An applicant can opt out on the other channel. Both the pending request
      // and a conversation that was started on SMS must be cancelled.
      session = {
        id: "00000000-0000-4000-8000-000000000002",
        phone_number: "254712345678",
        channel: "sms",
        step: "name",
        collected_data: {},
        expires_at: new Date(Date.now() + 100_000).toISOString(),
      };
      const stopped = await webhook(
        new Request(`https://example.supabase.co/functions/v1/whatsapp-bot?token=${secret}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ from: "+254712345678", channel: "whatsapp", text: "STOP" }),
        }),
      );
      assert.equal(stopped.status, 200);
      assert.equal(session, null);
      assert.equal(applications[0].status, "rejected");
      assert.match(outgoing.at(-1)?.text ?? "", /unsubscribed/i);

      // WhatsApp callbacks may use "message" and omit a body-level channel;
      // the provider URL supplies that distinction from the SMS callback.
      const whatsappJoin = await webhook(
        new Request(
          `https://example.supabase.co/functions/v1/whatsapp-bot?token=${secret}&channel=whatsapp`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ from: "+254712345678", message: "JOIN" }),
          },
        ),
      );
      assert.equal(whatsappJoin.status, 200);
      const currentSession = (): Session | null => session;
      assert.equal(currentSession()?.channel, "whatsapp");
      assert.match(outgoing.at(-1)?.text ?? "", /full name/i);
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of keys) {
        const value = original[key];
        if (typeof value === "string") Deno.env.set(key, value);
        else Deno.env.delete(key);
      }
    }
  },
);
