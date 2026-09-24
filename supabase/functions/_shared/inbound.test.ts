import test from "node:test";
import assert from "node:assert/strict";
import { parseInbound } from "./inbound.ts";

test("parses form-encoded SMS callbacks and optional WhatsApp channel", () => {
  assert.deepEqual(
    parseInbound(
      "from=%2B254700000001&text=JOIN&to=123&id=abc",
      "application/x-www-form-urlencoded",
    ),
    {
      from: "+254700000001",
      text: "JOIN",
      channel: "sms",
    },
  );
  assert.deepEqual(
    parseInbound(
      "from=0700000001&text=+BAL+&channel=whatsapp",
      "application/x-www-form-urlencoded",
    ),
    {
      from: "0700000001",
      text: "BAL",
      channel: "whatsapp",
    },
  );
  assert.equal(
    parseInbound("from=0700000001&text=BAL&channel=voice", "application/x-www-form-urlencoded"),
    null,
  );
});

test("parses flat and nested WhatsApp JSON, but ignores delivery/media and invalid bodies", () => {
  assert.deepEqual(parseInbound('{"from":"+254700000001","message":"LOANS"}', "application/json"), {
    from: "+254700000001",
    text: "LOANS",
    channel: "whatsapp",
  });
  const nested = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              messages: [{ from: "254700000001", type: "text", text: { body: "HELP" } }],
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(parseInbound(nested, "application/json"), {
    from: "254700000001",
    text: "HELP",
    channel: "whatsapp",
  });
  assert.equal(
    parseInbound('{"from":"+254700000001","channel":"sms","text":"BAL"}', "application/json"),
    null,
  );
  assert.equal(parseInbound('{"statuses":[{"status":"read"}]}', "application/json"), null);
  assert.equal(
    parseInbound('{"from":"0700000001","message":{"image":"a"}}', "application/json"),
    null,
  );
  assert.equal(parseInbound("{", "application/json"), null);
  assert.equal(parseInbound("from=0700000001&text=HELP", "text/plain"), null);
  assert.equal(parseInbound("x".repeat(4097), "application/json"), null);
});
