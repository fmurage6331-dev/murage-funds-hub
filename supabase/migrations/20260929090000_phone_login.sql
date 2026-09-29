-- Phone-number sign-in for members imported without an email address
--
-- Members are imported from CSV (/data-import) with a phone number and usually no email, so they
-- had no credential to sign in with. Rather than adding SMS/OTP, a phone-only member is created in
-- Supabase Auth under a *synthetic* email derived from their number:
--
--     +254724344102   ->   254724344102@murage.foundation
--
-- The synthetic address exists only in auth.users (see supabase/functions/_shared/phone.ts and
-- src/lib/phoneUtils.ts, which must stay in sync). public.profiles keeps email = NULL for these
-- members and phone_only_member = false, because they can now use the web app by typing the phone
-- number they already know plus the default password (12345678).
--
-- is_default_password tracks whether a member is still on that issued password:
--   * created/imported member            -> true  (default)
--   * member changes their own password  -> false (see /my-account)
--   * administrator resets the password  -> true  (admin-actions: resetMemberPassword)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_default_password boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.is_default_password IS
  'True while the member still uses the issued default password (12345678). Cleared when they change it themselves, set again by an administrator reset.';

-- RLS: a member may clear the flag on their own row.
-- "profiles update own" (20260713132944) already permits UPDATE on the member's own row; this
-- policy is stated explicitly so the default-password flag keeps working if that policy is ever
-- narrowed. DROP first to keep the migration re-runnable.
DROP POLICY IF EXISTS "members can update own password flag" ON public.profiles;
CREATE POLICY "members can update own password flag"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- guard_profile_updates() only polices status, is_anonymized and data_retention_until, so a member
-- can clear their own is_default_password without touching that trigger.
