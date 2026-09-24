# Murage Foundation WhatsApp & SMS bot

## Before enabling the callback

1. Apply `supabase/migrations/20260924090000_bot_membership.sql` to **cbfciiehhpkpdtxrltrc** (after the existing migrations). It reconciles the hosted bot tables with the checked-in schema, adds RLS/unique indexes, and changes member foreign keys to `profiles.id` so phone-only members do **not** need an `auth.users` row. Resolve any duplicate phone numbers or M-Pesa references surfaced by the unique indexes rather than silently merging members. Only the admin can read pending applications in the web app; the callback and approval workflows use the Edge Function service role after authorization.
2. Deploy `whatsapp-bot`, `manage-registration`, `bot-notifications`, and the updated `send-email` Edge Functions to that project. `whatsapp-bot` has `verify_jwt = false` because Africa's Talking does not send a Supabase JWT; the other two new functions require an authenticated Supabase user and check server-side officer roles. Do not turn off JWT verification for them.
3. Configure the Edge Function secrets below (also set the existing Supabase URL and publishable/service-role keys if the platform has not injected them). **Never put `AFRICASTALKING_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in `VITE_*` variables.** The browser calls authenticated Edge Functions; only those functions contact Africa's Talking.
4. Configure Supabase Auth's allowed redirect URLs to include `https://murage-funds-hub.vercel.app/set-password` and set the site URL to `https://murage-funds-hub.vercel.app`. Recovery links in approval messages are one-time, expiring password-setup links. Admins should verify the applicant's phone/email identity before approving an application; an applicant cannot attach a phone to an existing web account simply by typing its email.
5. In the Africa's Talking SMS dashboard, configure the **incoming message** callback (not the delivery-report callback) as `https://cbfciiehhpkpdtxrltrc.supabase.co/functions/v1/whatsapp-bot?token=<AFRICASTALKING_WEBHOOK_SECRET>`. When your live WhatsApp sender is enabled, configure its incoming-message callback as `https://cbfciiehhpkpdtxrltrc.supabase.co/functions/v1/whatsapp-bot?token=<AFRICASTALKING_WEBHOOK_SECRET>&channel=whatsapp`. The channel query parameter is important if AT's callback body has no `channel` field; the SMS callback defaults to SMS. The secret must be a random value of at least 32 characters, stored as a Supabase Edge secret and entered only in the provider's callback configuration. The function also accepts `x-webhook-secret` where supported. Keep this callback URL out of public docs and logs; rotate the secret if exposed. Requests without the secret are acknowledged with HTTP 200 but do nothing.
6. Provide the bot's **actual** SMS shortcode / approved WhatsApp number to members. The administrator's contact number is not automatically an Africa's Talking sender or SMS shortcode.

### Required Edge secrets

| Variable | Usage |
| --- | --- |
| `AFRICASTALKING_API_KEY` | API key for the selected Africa's Talking environment (sandbox and live keys differ). |
| `AFRICASTALKING_USERNAME` | `muragefoundation` for live; the helper uses the literal `sandbox` username for sandbox requests, per AT's API docs. |
| `AFRICASTALKING_ENV` | `sandbox` or `live` (defaults to `sandbox` for safety). |
| `AFRICASTALKING_WEBHOOK_SECRET` | **Additional required secret** for callbacks; not present in the original environment variable list. |
| `AFRICASTALKING_WHATSAPP_NUMBER` | **Additional required variable for live WhatsApp**: the AT-approved sender (254XXXXXXXXX). This is not the admin's notification recipient number unless it is actually the approved business sender. |
| `ADMIN_WHATSAPP_NUMBER` | Admin alert recipient, `254182528510`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge-only database access; never expose service role to browser. |
| `SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY` | Verifying the admin/officer's access token in authenticated Edge Functions. |

Existing web environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` are optional for the existing email path.

**Provider limitation:** The [Africa's Talking WhatsApp API](https://developers.africastalking.com/docs/whatsapp/send_message) uses `https://chat.africastalking.com/whatsapp/message/send`, not the SMS Messaging API. Its WhatsApp sandbox endpoint is marked *coming soon*. In sandbox, WhatsApp-channel replies/notifications deliberately use AT's SMS sandbox endpoint. Live WhatsApp requires an approved sender and, for proactive messages outside the customer-service window, approved message templates/provider authorization; AT may reject a free-form welcome/meeting notice outside that window. Failed welcome deliveries remain visible in Users → Pending Registrations for retry. Never treat an AT acceptance receipt as proof of final handset delivery.

## Sandbox smoke test

Use a test phone registered with the AT sandbox simulator, and ensure the Edge secrets and callback URL are set. Send `JOIN` through the simulator; answer with a full name, `1` (member), an email or `SKIP`, and `YES` (consent). The admin should receive an alert and see the real-time badge on `/users` → **Pending Registrations**. Test `NO`, an unrelated command mid-flow (then `YES` to resume), a second `JOIN` while pending, and a session older than 30 minutes. Reject one application with a reason, then reapply. Approve one email application and one phone-only application; only the former should create an Auth user and receive a one-time `/set-password` link.

From an approved phone send `HELP`, `DEPOSIT 5000 QWE123456` (use a unique *test* ref), and `BAL`. The deposit must be pending until a treasurer/admin uses `PENDING` and `CONFIRM QWE123456` or the Contributions Review web page. `BAL` and the confirmation must show the new **confirmed** total. Try malformed and duplicate deposits, `PENDING` from a non-officer phone, `LOANS`/`SCHEDULE` before and after a loan is approved, an unknown command, and `STOP` (proactive messages stop). Schedule a meeting in the web app and check opted-in phone-only members also receive a notice. Test a majority board loan vote and a direct loan rejection.

A direct form-encoded callback test (use a sandbox number and a *local* shell variable for the secret, never paste a real secret in PRs/logs):

```sh
curl -i -X POST \
  "https://cbfciiehhpkpdtxrltrc.supabase.co/functions/v1/whatsapp-bot?token=${AFRICASTALKING_WEBHOOK_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'from=+254712345678' --data-urlencode 'text=HELP' \
  --data-urlencode 'channel=sms' --data-urlencode 'to=your-test-shortcode'
```

AT receives HTTP **200** (even when the provider/database is unavailable); the answer is sent via the AT Messaging API, not the webhook response body. Unauthorized callbacks also receive a generic 200 and are ignored. Watch the Supabase Edge logs for error details without logging phone message bodies or secret values. The helper and webhook have local mock-provider/PostgREST tests: `npx deno test --no-config --allow-env supabase/functions/_shared/africastalking.test.ts supabase/functions/whatsapp-bot/index.test.ts`. These tests do not replace a migration run or live Africa's Talking smoke test.

Tables used: `profiles`, `user_roles`, `contributions`, `loans`, `loan_repayments`, `loan_risk_flags` (view), `pending_registrations`, `whatsapp_sessions`, `meetings`, `bot_notification_events` (deduplicates outbound events), and the existing append-only `audit_logs` via financial-record triggers. Requests to `bot-notifications` include only an event name and record ID, not arbitrary numbers or message text; the Edge Function checks the actor's role, re-reads authoritative status and honors `whatsapp_opt_in`/`prefers_sms`.
