# WhatsApp & SMS bot — setup and sandbox checklist

The bot runs in Supabase Edge Functions, **not** the Vercel browser bundle. Its
callback (`whatsapp-bot`) accepts form-encoded Africa's Talking (AT) incoming
SMS (and WhatsApp with a `channel=whatsapp` field), plus flat or standard
nested WhatsApp JSON text callbacks. **Confirm the exact live WhatsApp payload
with AT** before pointing their callback at this Function; unsupported media
and delivery receipts are ignored. It acknowledges every callback with HTTP 200, including
unauthorized or failed requests; errors are recorded in the Supabase Edge logs.
Only a callback with the configured shared secret can read or change data.

## Deploy in order

**Read-only preflight:** Run the three queries in
`supabase/preflight/whatsapp_sms_bot.sql` in the target project's SQL editor
_before_ applying the migration. All three should return zero rows: they find
normalized-phone collisions, duplicate M-Pesa codes (including legacy web
`reference` values), and orphaned member foreign keys. Resolve any results
with the member/treasurer rather than deleting financial records. The phone
query may return private contact details; do not post its output in a PR or
public log. Run this against the actual target project, not a local mock.

1. Link the Supabase project `cbfciiehhpkpdtxrltrc` and apply
   `supabase/migrations/20260924120000_whatsapp_sms_bot.sql` **before** the app
   or Functions. Review duplicate legacy phone numbers/M-Pesa references first:
   the migration normalizes phone numbers and creates unique indexes; duplicates
   must be resolved manually. It changes member foreign keys from `auth.users`
   to `public.profiles`, allowing phone-only profiles and their roles, loans and
   contributions without an auth user. It creates the bot tables, an
   admin-only RLS policy for pending registrations, a Realtime publication entry,
   and a service-only, once-per-event notification claim. With the Supabase
   CLI authenticated in your deployment environment, the commands are:

   ```bash
   npx supabase link --project-ref cbfciiehhpkpdtxrltrc
   npx supabase db push
   ```

   Review the SQL Editor preflight results and take a database backup **before**
   `db push`; do not run it against an unexpected project or paste credentials
   into chat. These commands have not been run in this workspace.

2. Deploy `whatsapp-bot`, `review-registration` and `notify-event` from the
   repository root with Supabase CLI. `supabase/config.toml` disables JWT
   verification **only** for `whatsapp-bot`: AT does not send a Supabase JWT.
   Admin review and event notification Functions require a valid signed-in
   officer and check their current role server-side. Never give these Functions
   a public/anonymous service-role endpoint.

   ```bash
   npx supabase functions deploy whatsapp-bot --no-verify-jwt
   npx supabase functions deploy review-registration
   npx supabase functions deploy notify-event
   ```

   Confirm the configured Edge secrets are present in the target project
   before enabling the AT callback. The webhook secret must match the callback
   URL; never paste its value into chat or a public issue.

3. Set the Supabase Auth allowed redirect URL to
   `https://murage-funds-hub.vercel.app/set-password` (and the appropriate
   local preview URL when testing). Email applicants receive a short-lived
   Auth magic link to this page. Verify the applicant's ownership of their
   claimed email and phone before approving an email account; the link is a
   **login credential sent to their phone**. A phone-only approval does not
   create a Supabase Auth user.
4. Configure the AT Incoming Messages callback URL (SMS and, when supported,
   WhatsApp) to:

   `https://cbfciiehhpkpdtxrltrc.supabase.co/functions/v1/whatsapp-bot?token=<AFRICASTALKING_WEBHOOK_SECRET>`

   Keep the token secret. The handler also accepts an `x-at-webhook-secret`
   header where a provider can configure custom headers. Set the AT WhatsApp
   sending number/shortcode in your AT account, and tell members that number;
   the _admin contact_ may not be the bot's sending number.

## Environment variables

| Scope                                   | Name                                                                                        | Purpose                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Edge secrets                   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                                 | Trusted server-side DB/Auth access. Never `VITE_`/browser.                                                                                   |
| Supabase Edge secrets                   | `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_ENV=sandbox` or `live` | AT credentials/endpoints. The sandbox app normally uses the username `sandbox`; confirm that the saved username matches the sandbox API key. |
| Supabase Edge secrets + AT callback URL | `AFRICASTALKING_WEBHOOK_SECRET`                                                             | Required long random token. Without it all incoming callbacks are ignored (and acknowledged).                                                |
| Supabase Edge secrets                   | `AFRICASTALKING_WHATSAPP_NUMBER`                                                            | AT-registered **sender** number. Required for WhatsApp sends. Not automatically the admin contact.                                           |
| Supabase Edge secrets                   | `ADMIN_WHATSAPP_NUMBER=254182528510`                                                        | Admin alerts; optional fallback to the published admin contact.                                                                              |
| Supabase Edge secrets (optional)        | `AFRICASTALKING_SMS_SENDER_ID`                                                              | AT-approved SMS shortcode/name; uses AT default when unset.                                                                                  |
| Vercel app                              | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`                                        | Browser access through RLS; existing variables.                                                                                              |

`RESEND_API_KEY` is optional for the existing email notification Function. AT
API credentials need not be in the Vercel browser environment; the browser
invokes authorized Edge Functions without seeing those secrets.

**Provider limitation:** AT's [WhatsApp send documentation](https://developers.africastalking.com/docs/whatsapp/send_message)
uses `chat.africastalking.com/whatsapp/message/send` (not the SMS API) and still
labels its WhatsApp sandbox as “coming soon.” SMS can be tested in the AT
sandbox; WhatsApp delivery needs an enabled AT WhatsApp account/registered
sender and a working Chat sandbox or live endpoint. The bot does not silently
route a requested WhatsApp message to SMS if WhatsApp rejects it; the error is
logged and the registration/payment stays visible in the admin UI. For
proactive WhatsApp notices outside a conversation window, confirm whether your
AT account requires approved templates; this helper sends plain text, not
provider template IDs.

## Test without real money

Run `npm run test:bot`, `npm run lint`, `npx tsc --noEmit`, `npm run build`
and `npx --yes deno check --no-lock --node-modules-dir=auto` on the Function
entrypoints. There are unit tests for Kenyan phone normalization, DEPOSIT validation, the JOIN
consent/role/email/SKIP steps, interruption handling, session expiry,
Kenyan date boundaries, SMS/WhatsApp callback parsing, outbound AT API
payloads/error responses, and webhook HTTP 200/authentication/delivery-failure
behavior.

Use the AT sandbox SMS simulator to send `JOIN`, complete the prompts, and
approve an applicant at `/users` → **Pending Registrations**. Or submit a
form-encoded test request (use a **test** phone and an environment variable so
no secret appears in shell history):

```bash
curl -s -i -X POST \
  "https://cbfciiehhpkpdtxrltrc.supabase.co/functions/v1/whatsapp-bot?token=${AFRICASTALKING_WEBHOOK_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'from=+254712345678' \
  --data-urlencode 'to=YOUR_AT_SHORTCODE' \
  --data-urlencode 'channel=sms' \
  --data-urlencode 'text=JOIN'
```

AT's incoming SMS callback may omit `channel`; the handler defaults to `sms`.
For a WhatsApp-shaped JSON callback, use `-H 'Content-Type: application/json'`
and `-d '{"from":"+254712345678","message":"HELP"}'` in place of the
form headers/body above (only after AT has provisioned a WhatsApp sender).
This tests parsing; it **does not prove WhatsApp sandbox delivery**. A callback without/wrong token must return HTTP 200 **without** changing any
rows. Try `HELP`, `BAL` and `LOANS` before/after approval. `DEPOSIT 5000
QWE123456` creates a **pending** contribution, never a confirmed payment; an
admin/treasurer can send `PENDING` and `CONFIRM QWE123456` (or confirm it in
`/contributions-review`). Repeat the same deposit/confirmation to verify
idempotency. `SCHEDULE` includes overdue and up to five upcoming installments.
`STOP` turns off outbound messages; a pending applicant's STOP also withdraws
the application. `JOIN` opts an existing approved member back into messaging.

Web signup now asks for a Kenyan mobile number; an administrator must verify
phone ownership before approving the pending web account. Web signup consent
is not the same as message opt-in: an approved web member texts `JOIN` from
that phone to opt into outbound notices. Only bot applicants who reply `YES`
to the JOIN consent prompt are opted in on approval.

This bot **does not collect M-Pesa payments**: members pay KCB Bank Kenya via
M-Pesa Paybill **522522**, Account **798164**, then submit the M-Pesa reference
for a human treasurer to verify. A phone-only member has bot access but no
web login; the admin can inspect their profile and roles on `/users`.

All reads by logged-in app users still use Supabase RLS. Trusted service-role
operations are confined to the Functions and run only after a valid webhook
secret or Auth officer-role check. Automated notices honor `whatsapp_opt_in`
(including STOP), use `prefers_sms` to choose the channel, and are claimed once
per member/event to prevent concurrent board votes from duplicating messages.
Failed invitation delivery is visible in the Pending Registrations tab with a
retry button; check Edge logs for failed member/meeting sends.
