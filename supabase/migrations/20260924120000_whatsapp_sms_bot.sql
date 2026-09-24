-- Bot onboarding and phone-only membership. Earlier migrations still link members
-- directly to auth.users; an SMS-only member deliberately has NO auth user.
-- Apply this migration before deploying the Edge Functions.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS whatsapp_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS prefers_sms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_only_member boolean NOT NULL DEFAULT false;

ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS mpesa_transaction_id text,
  ADD COLUMN IF NOT EXISTS mpesa_sender_phone text,
  ADD COLUMN IF NOT EXISTS mpesa_sender_name text,
  ADD COLUMN IF NOT EXISTS paybill_number text;

-- Drop ONLY auth.users FKs on member identifiers, preserving any already
-- migrated profiles FKs in the live database. Roles and financial rows then
-- refer to profiles, not to auth.users.
DO $$
DECLARE
  item record;
  old_fk record;
BEGIN
  FOR item IN
    SELECT 'profiles'::text AS rel, 'id'::text AS col
    UNION ALL SELECT 'user_roles', 'user_id'
    UNION ALL SELECT 'contributions', 'member_id'
    UNION ALL SELECT 'loans', 'member_id'
  LOOP
    FOR old_fk IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = item.col
      WHERE c.conrelid = format('public.%I', item.rel)::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'auth.users'::regclass
        AND c.conkey = ARRAY[a.attnum]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', item.rel, old_fk.conname);
    END LOOP;

    IF item.rel <> 'profiles' AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = item.col
      WHERE c.conrelid = format('public.%I', item.rel)::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.profiles'::regclass
        AND c.conkey = ARRAY[a.attnum]::smallint[]
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE CASCADE',
        item.rel, item.rel || '_' || item.col || '_profiles_fkey', item.col
      );
    END IF;
  END LOOP;
END $$;

-- Keep phones canonical, including legacy local/plus-prefixed values.
-- Resolve any duplicate phone numbers before applying the unique indexes.
UPDATE public.profiles SET phone_number = NULL WHERE btrim(phone_number) = '';
UPDATE public.profiles
SET phone_number = CASE
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^254[17][0-9]{8}$'
    THEN regexp_replace(phone_number, '\D', '', 'g')
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
    THEN '254' || substr(regexp_replace(phone_number, '\D', '', 'g'), 2)
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^[17][0-9]{8}$'
    THEN '254' || regexp_replace(phone_number, '\D', '', 'g')
  ELSE phone_number END
WHERE phone_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_number_unique
  ON public.profiles(phone_number) WHERE phone_number IS NOT NULL;
UPDATE public.contributions
SET mpesa_transaction_id = NULLIF(upper(btrim(mpesa_transaction_id)), '')
WHERE mpesa_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contributions_mpesa_ref_unique
  ON public.contributions(upper(mpesa_transaction_id))
  WHERE mpesa_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contributions_member_confirmed
  ON public.contributions(member_id, created_at DESC) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text,
  requested_role public.app_role NOT NULL,
  registration_channel text NOT NULL CHECK (registration_channel IN ('sms', 'whatsapp')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes text,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  invite_sent boolean NOT NULL DEFAULT false,
  invite_sent_at timestamptz,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pending_registrations
  ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_phone_unique
  ON public.pending_registrations(phone_number);
CREATE INDEX IF NOT EXISTS pending_registrations_status_created
  ON public.pending_registrations(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  step text NOT NULL CHECK (step IN ('start', 'name', 'role', 'email', 'confirm')),
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  UNIQUE (phone_number, channel)
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_sessions_phone_channel_unique
  ON public.whatsapp_sessions(phone_number, channel);
CREATE INDEX IF NOT EXISTS whatsapp_sessions_expiry ON public.whatsapp_sessions(expires_at);

-- Normalize any pre-existing application/session/payment phones as well.
UPDATE public.pending_registrations
SET phone_number = CASE
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^254[17][0-9]{8}$'
    THEN regexp_replace(phone_number, '\D', '', 'g')
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
    THEN '254' || substr(regexp_replace(phone_number, '\D', '', 'g'), 2)
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^[17][0-9]{8}$'
    THEN '254' || regexp_replace(phone_number, '\D', '', 'g')
  ELSE phone_number END;
UPDATE public.whatsapp_sessions
SET phone_number = CASE
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^254[17][0-9]{8}$'
    THEN regexp_replace(phone_number, '\D', '', 'g')
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
    THEN '254' || substr(regexp_replace(phone_number, '\D', '', 'g'), 2)
  WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^[17][0-9]{8}$'
    THEN '254' || regexp_replace(phone_number, '\D', '', 'g')
  ELSE phone_number END;
UPDATE public.contributions
SET mpesa_sender_phone = CASE
  WHEN regexp_replace(mpesa_sender_phone, '\D', '', 'g') ~ '^254[17][0-9]{8}$'
    THEN regexp_replace(mpesa_sender_phone, '\D', '', 'g')
  WHEN regexp_replace(mpesa_sender_phone, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
    THEN '254' || substr(regexp_replace(mpesa_sender_phone, '\D', '', 'g'), 2)
  WHEN regexp_replace(mpesa_sender_phone, '\D', '', 'g') ~ '^[17][0-9]{8}$'
    THEN '254' || regexp_replace(mpesa_sender_phone, '\D', '', 'g')
  ELSE mpesa_sender_phone END
WHERE mpesa_sender_phone IS NOT NULL;

-- Only admins may see applicant PII; the webhook/review Functions use the
-- service role AFTER authenticating the sender or the current admin.
ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_registrations, public.whatsapp_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pending_registrations TO authenticated;
GRANT ALL ON public.pending_registrations, public.whatsapp_sessions TO service_role;
DROP POLICY IF EXISTS "pending registrations admin read" ON public.pending_registrations;
CREATE POLICY "pending registrations admin read" ON public.pending_registrations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- The existing /users page manages the profile of another member; retain RLS
-- for regular users, but allow the admin to perform those operations.
GRANT DELETE ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "profiles admin manage" ON public.profiles;
CREATE POLICY "profiles admin manage" ON public.profiles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- An authenticated member may update their own profile, but cannot claim
-- somebody else's phone or change messaging/phone-only/compliance privileges.
CREATE OR REPLACE FUNCTION public.guard_profile_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND current_setting('role', true) IS DISTINCT FROM 'service_role'
    AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.is_anonymized IS DISTINCT FROM OLD.is_anonymized
      OR NEW.data_retention_until IS DISTINCT FROM OLD.data_retention_until
      OR NEW.phone_number IS DISTINCT FROM OLD.phone_number
      OR NEW.phone_only_member IS DISTINCT FROM OLD.phone_only_member
      OR NEW.whatsapp_opt_in IS DISTINCT FROM OLD.whatsapp_opt_in
      OR NEW.prefers_sms IS DISTINCT FROM OLD.prefers_sms THEN
      RAISE EXCEPTION 'Only administrators can change protected membership or phone fields.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The eligibility trigger must use profiles for members without auth.users.
CREATE OR REPLACE FUNCTION public.compute_loan_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.loan_rules%ROWTYPE;
  total_contrib numeric;
  member_since timestamptz;
  reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO r FROM public.loan_rules
    WHERE active AND loan_type = NEW.loan_type ORDER BY updated_at DESC LIMIT 1;
  SELECT COALESCE(SUM(amount), 0) INTO total_contrib FROM public.contributions
    WHERE member_id = NEW.member_id AND status = 'confirmed';
  SELECT created_at INTO member_since FROM public.profiles WHERE id = NEW.member_id;

  IF r.id IS NULL THEN
    NEW.auto_eligible := false;
    NEW.eligibility_note := format('No active loan rules configured for %s loans', NEW.loan_type);
    RETURN NEW;
  END IF;
  IF NEW.amount > r.max_amount THEN
    reasons := reasons || format('Exceeds max amount (%s)', r.max_amount);
  END IF;
  IF NEW.amount > total_contrib * r.max_multiplier THEN
    reasons := reasons || format('Exceeds %sx of confirmed contributions (%s)', r.max_multiplier, total_contrib);
  END IF;
  IF member_since IS NOT NULL AND (now() - member_since) < make_interval(days => r.min_membership_days) THEN
    reasons := reasons || format('Membership under %s days', r.min_membership_days);
  END IF;
  IF NEW.repayment_months > r.max_repayment_months THEN
    reasons := reasons || format('Repayment exceeds %s months', r.max_repayment_months);
  END IF;
  NEW.auto_eligible := array_length(reasons, 1) IS NULL;
  NEW.eligibility_note := CASE WHEN NEW.auto_eligible THEN 'Meets all criteria'
    ELSE array_to_string(reasons, '; ') END;
  RETURN NEW;
END;
$$;

-- Realtime badge count on /users (SELECT is restricted by the policy above).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'pending_registrations'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_registrations;
  END IF;
END $$;

-- Accurate totals for BAL/CONFIRM without PostgREST's default 1,000-row limit.
-- This function is service-role only; the webhook validates the phone first.
CREATE OR REPLACE FUNCTION public.bot_member_balance(_member_id uuid)
RETURNS TABLE(total numeric, last_amount numeric, last_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    COALESCE((SELECT SUM(c.amount) FROM public.contributions c
      WHERE c.member_id = _member_id AND c.status = 'confirmed'), 0),
    (SELECT c.amount FROM public.contributions c
      WHERE c.member_id = _member_id AND c.status = 'confirmed'
      ORDER BY c.contributed_on DESC, c.created_at DESC LIMIT 1),
    (SELECT c.contributed_on FROM public.contributions c
      WHERE c.member_id = _member_id AND c.status = 'confirmed'
      ORDER BY c.contributed_on DESC, c.created_at DESC LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.bot_member_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_member_balance(uuid) TO service_role;

-- Once per recipient/event, even when two board members vote concurrently.
-- A failed delivery may be retried, but a successfully accepted send cannot
-- be re-triggered by a client calling the Edge Function again.
CREATE TABLE IF NOT EXISTS public.bot_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  record_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(event_type, record_id, profile_id)
);
ALTER TABLE public.bot_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bot_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.bot_claim_notification(
  _event_type text, _record_id uuid, _profile_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- EXECUTE is granted only to service_role; check the privilege itself,
  -- not auth.role(), which can be absent for an opaque sb_secret_ API key.
  INSERT INTO public.bot_notification_deliveries(event_type, record_id, profile_id)
  VALUES (_event_type, _record_id, _profile_id)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN true; END IF;
  UPDATE public.bot_notification_deliveries
  SET status = 'sending', claimed_at = now(), sent_at = NULL
  WHERE event_type = _event_type AND record_id = _record_id AND profile_id = _profile_id
    AND (status = 'failed' OR (status = 'sending' AND claimed_at < now() - interval '5 minutes'));
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.bot_claim_notification(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_claim_notification(text, uuid, uuid) TO service_role;

-- New web signups may supply a phone with their consent. They remain pending
-- until the admin verifies ownership and approves them. Members cannot later
-- swap this phone via the self-update RLS policy/guard above.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_consent boolean;
  v_phone text;
BEGIN
  v_consent := COALESCE((NEW.raw_user_meta_data->>'consent_given')::boolean, false);
  v_phone := NEW.raw_user_meta_data->>'phone_number';
  IF v_phone !~ '^254[17][0-9]{8}$' THEN v_phone := NULL; END IF;

  INSERT INTO public.profiles (
    id, full_name, email, phone_number, consent_given, consent_timestamp,
    consent_version, data_retention_until
  ) VALUES (
    NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email,
    v_phone, v_consent, CASE WHEN v_consent THEN now() ELSE NULL END,
    COALESCE(NEW.raw_user_meta_data->>'consent_version', '1.0'),
    now() + interval '7 years'
  ) ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone_number = COALESCE(public.profiles.phone_number, EXCLUDED.phone_number),
    consent_given = EXCLUDED.consent_given,
    consent_timestamp = EXCLUDED.consent_timestamp,
    consent_version = EXCLUDED.consent_version;

  IF lower(NEW.email) = 'francismurageweb@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'member')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
