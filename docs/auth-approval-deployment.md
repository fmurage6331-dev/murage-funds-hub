# Approval, signup and payment fixes: manual deployment

No remote database or Edge Function deployment was performed by the coding agent.

## Supabase Auth settings (dashboard)

- **Auth → Providers → Email → Confirm email: OFF.** Signup is password-only: `supabase.auth.signUp` returns a session immediately, `/auth` toasts "Account created! Please wait for admin approval." and routes the member to `/pending-approval`. If confirmation is ever switched back on, signup returns no session; `/auth` then stops and tells the member to contact the admin on +254182528510 instead of bouncing them through a redirect loop.
- Site URL and the recovery/reset redirect allowlist must point at the production app (`https://murage-funds-hub.vercel.app`) so the emailed "set your password" link lands on the app.
- `send-email` delivers through Resend only when `RESEND_API_KEY` is set; without it the function logs a simulated dispatch and still returns 200, so approvals succeed but no mail leaves the project.

## Deployment order

1. Verify the target is `cbfciiehhpkpdtxrltrc`. The repository's existing `supabase/config.toml` project ID differs; do not deploy to that ID accidentally.
2. Apply `supabase/migrations/20260927090000_admin_actions.sql` to the target database through your normal reviewed migration process. It explicitly exempts service-role requests from the profile trigger and adds a service-role-only transactional approval helper. **Deploying the Edge Function without this migration will not fix approvals.**
   - The migration expects the existing bot schema (`pending_registrations`, `profiles.phone_number`, `profiles.phone_only_member`) reflected in the checked-in generated types. Its original creation migration is absent from this repository; verify those objects exist on the target before applying. A fresh database cannot reconstruct that bot schema from the current migration history alone.
3. Apply `supabase/migrations/20260927120000_fix_handle_new_user_phone.sql`. It replaces `handle_new_user()` so the profile created by the `on_auth_user_created` trigger also stores `phone_number` from user metadata, and assigns `status` on INSERT (`pending` for new members, `approved` for the designated administrator email). Status is set in the INSERT rather than by a follow-up UPDATE because `trg_guard_profile_updates` (BEFORE UPDATE) rejects status changes outside service-role/admin contexts, and the GoTrue signup trigger runs with neither `auth.uid()` nor a JWT role.
4. Deploy manually:

   ```sh
   supabase functions deploy admin-actions --project-ref cbfciiehhpkpdtxrltrc --no-verify-jwt
   supabase functions deploy whatsapp-bot --project-ref cbfciiehhpkpdtxrltrc --no-verify-jwt
   supabase functions deploy send-email --project-ref cbfciiehhpkpdtxrltrc
   ```

   `send-email` is now part of the approval path: it carries the `password_reset` template that delivers the member's set-password link.

5. Deploy the frontend with `VITE_SUPABASE_URL` and its publishable key pointing at the same target. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Edge Function secrets.

## Implementation notes

- `admin-actions` validates JWTs via Auth and checks the persisted admin role before privileged writes. Disabling gateway JWT verification does **not** disable handler authentication.
- Web signup sends `full_name`, `phone_number` (optional, `null` when left blank), `consent_given: true` and `consent_version: "KDPA-2019-V1.0"` as user metadata. The trigger turns that into a `pending` profile with the phone number, consent timestamp and a 7-year `data_retention_until`, plus the `member` role. No confirmation email is involved.
- Sign-in offers no "resend confirmation" path. An `Email not confirmed` failure (a legacy account created before confirmation was disabled) shows "Please contact admin on +254182528510 to activate your account". An approved profile goes to `/dashboard`, any other status to `/pending-approval`.
- Bot approvals accept `registrationId`; extra client-supplied identity, role, and actor fields are intentionally ignored. The persisted registration supplies identity/role and the verified JWT supplies `approved_by`.
- Approving an **email** bot registration no longer sends an invitation. It creates an already-confirmed Auth user with an unusable random password (`crypto.randomUUID()`), generates a `recovery` link and emails it through `send-email` so the member **sets** a password instead of **confirming** an address. The temporary password is never logged nor emailed, and the generated link is never written to logs either.
  - If the recovery link cannot be generated, the freshly created Auth user is deleted and the action returns 502 so the admin can retry cleanly.
  - If only the email dispatch fails, the approval stands (it is already committed) and the response carries a `warning`, which Users & Roles surfaces as a toast telling the admin to resend from Supabase Auth → Users.
  - `pending_registrations.invite_sent` / `invite_sent_at` now record that the set-password email was issued.
- Bot rejections accept `registrationId` plus a 1-2000 character `reason`, which is stored in `pending_registrations.admin_notes` with `approved_by` taken from the verified JWT. Rejecting an already rejected registration is a no-op; an approved registration returns 409. The rejection runs with the service role, so any notification trigger attached to `pending_registrations` still fires.
- Phone-only members need a phone-backed Auth identity because both profile and role foreign keys reference `auth.users`. Their profiles remain marked `phone_only_member`. No password, email or reset link is created for them, and the phone is not marked verified by an admin approval.
- Profile approval, role assignment, and marking a registration approved occur in one SQL transaction. Email delivery is an external side effect and happens after that transaction commits; it cannot be rolled back. A finalization failure attempts to delete the newly created Auth identity; check Edge logs if cleanup fails before retrying.
- Existing Auth email/phone collisions produce an actionable conflict rather than silently merging accounts or granting roles to an unrelated profile.
- Approval does not fabricate consent or WhatsApp opt-in; consent must be collected separately (the web signup form collects it, the bot flow does not).

## Validation

```sh
npm run lint
npm run build
npx tsc --noEmit
npm test
```

The handler tests mock the Supabase and Resend boundaries; they do not replace deployed database/trigger, email-delivery and Auth tests. `tests/admin-actions.test.mjs` covers the approval/rejection handler, `tests/send-email.test.mjs` covers the `password_reset` template (escaping, unsafe-link rejection and the no-API-key simulation path).

After deployment, verify:

- Missing/expired JWT returns 401; a non-admin gets 403.
- Signing up with a new email and password sends **no** confirmation email, lands on `/pending-approval`, and creates a `profiles` row with `status = 'pending'`, the submitted `phone_number`, `consent_given = true` and `consent_version = 'KDPA-2019-V1.0'`.
- Admin approval/rejection updates a real pending member; role assignment succeeds.
- An approved member lands on `/dashboard` after login; a pending member is routed to `/pending-approval`.
- A member already on `/pending-approval` is redirected within 30 seconds of approval or upon window focus. Rejection updates the page without signing out.
- A legacy unconfirmed account gets the contact-admin message rather than a resend-confirmation link.
- Email bot registration creates an email-confirmed Auth user, emails a working set-password link, assigns the requested role and marks the registration approved; the member can then sign in with the password they chose. Phone-only registration creates a profile and role without any email.
- Rejecting a bot registration from Users & Roles stores the admin reason and removes the registration from the pending list; the applicant is not granted a profile, role or Auth identity.
- Repeating a completed bot approval is a no-op; rejected registrations cannot be approved through this action.
- A member sitting on `/pending-approval` sees the status spinner, the KCB paybill details and the WhatsApp contact button, and is redirected to `/dashboard` within 30 seconds of approval.
- Payment cards and bot replies show KCB Bank Kenya, Paybill 522522, Account 7989164.
