# Approval and payment fixes: manual deployment

No remote database or Edge Function deployment was performed by the coding agent.

## Deployment order

1. Verify the target is `cbfciiehhpkpdtxrltrc`. The repository's existing `supabase/config.toml` project ID differs; do not deploy to that ID accidentally.
2. Apply `supabase/migrations/20260927090000_admin_actions.sql` to the target database through your normal reviewed migration process. It explicitly exempts service-role requests from the profile trigger and adds a service-role-only transactional approval helper. **Deploying the Edge Function without this migration will not fix approvals.**
   - The migration expects the existing bot schema (`pending_registrations`, `profiles.phone_number`, `profiles.phone_only_member`) reflected in the checked-in generated types. Its original creation migration is absent from this repository; verify those objects exist on the target before applying. A fresh database cannot reconstruct that bot schema from the current migration history alone.
3. Deploy manually:

   ```sh
   supabase functions deploy admin-actions --project-ref cbfciiehhpkpdtxrltrc --no-verify-jwt
   supabase functions deploy whatsapp-bot --project-ref cbfciiehhpkpdtxrltrc --no-verify-jwt
   ```

4. Deploy the frontend with `VITE_SUPABASE_URL` and its publishable key pointing at the same target. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Edge Function secrets. Verify Supabase Auth's Site URL and invitation redirect allowlist point to the production app.

## Implementation notes

- `admin-actions` validates JWTs via Auth and checks the persisted admin role before privileged writes. Disabling gateway JWT verification does **not** disable handler authentication.
- Bot approvals accept `registrationId`; extra client-supplied identity, role, and actor fields are intentionally ignored. The persisted registration supplies identity/role and the verified JWT supplies `approved_by`.
- Phone-only members need a phone-backed Auth identity because both profile and role foreign keys reference `auth.users`. Their profiles remain marked `phone_only_member`. No password or fabricated email is created; the phone is not marked verified by an admin approval.
- Profile approval, role assignment, and marking a registration approved occur in one SQL transaction. Invitations are external side effects and cannot be rolled back. A finalization failure attempts to delete the newly created Auth identity; an invitation already emailed may then be invalid. Check Edge logs if cleanup fails before retrying.
- Existing Auth email/phone collisions produce an actionable conflict rather than silently merging accounts or granting roles to an unrelated profile.
- Approval does not fabricate consent or WhatsApp opt-in; consent must be collected separately.

## Validation

```sh
npm run lint
npm run build
npx tsc --noEmit
node --test tests/admin-actions.test.mjs
```

The handler tests mock the Supabase boundary; they do not replace deployed database/trigger and invitation tests.

After deployment, verify:

- Missing/expired JWT returns 401; a non-admin gets 403.
- Admin approval/rejection updates a real pending member; role assignment succeeds.
- An approved member lands on `/dashboard` after login.
- A member already on `/pending-approval` is redirected within 30 seconds of approval or upon window focus. Rejection updates the page without signing out.
- Email bot registration sends an invitation, assigns the requested role and marks the registration approved. Phone-only registration creates a profile and role without an invitation.
- Repeating a completed bot approval is a no-op; rejected registrations cannot be approved through this action.
- Payment cards and bot replies show KCB Bank Kenya, Paybill 522522, Account 7989164.
