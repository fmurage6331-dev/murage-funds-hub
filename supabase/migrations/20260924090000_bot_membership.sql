-- Bot membership, phone-only profiles and private notification delivery state.
-- The hosted project already has some of these columns/tables; keep this migration
-- additive for those installations while making a fresh checkout deployable.
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

CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  full_name text NOT NULL,
  email text,
  requested_role text NOT NULL CHECK (requested_role IN ('member', 'board_member', 'secretary', 'assistant_secretary')),
  registration_channel text NOT NULL CHECK (registration_channel IN ('whatsapp', 'sms')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes text,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  invite_sent boolean NOT NULL DEFAULT false,
  invite_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pending_registrations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;
-- An early migration revoked PUBLIC execute on has_role without re-granting
-- authenticated. The admin-only policy below (and existing officer RLS) needs it.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
-- Replace any pre-existing permissive policies: applicants' PII is admin-only.
REVOKE ALL ON public.pending_registrations FROM anon, authenticated;
GRANT SELECT ON public.pending_registrations TO authenticated;
GRANT ALL ON public.pending_registrations TO service_role;
DO $$ DECLARE previous_policy text;
BEGIN
  FOR previous_policy IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pending_registrations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.pending_registrations', previous_policy);
  END LOOP;
END $$;
-- Approvals/rejections only run in the Edge Function with a verified admin JWT.
CREATE POLICY "pending registrations admin read" ON public.pending_registrations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  step text NOT NULL DEFAULT 'start',
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes')
);
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_sessions FROM anon, authenticated;
GRANT ALL ON public.whatsapp_sessions TO service_role;

-- Old auth.users foreign keys forbid a bot-only profile (and its contributions,
-- loans and role) from existing. The replacement FKs still enforce membership.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
ALTER TABLE public.contributions DROP CONSTRAINT IF EXISTS contributions_member_id_fkey;
ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_member_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_profiles_fkey' AND conrelid = 'public.user_roles'::regclass) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_profiles_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contributions_member_id_profiles_fkey' AND conrelid = 'public.contributions'::regclass) THEN
    ALTER TABLE public.contributions ADD CONSTRAINT contributions_member_id_profiles_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loans_member_id_profiles_fkey' AND conrelid = 'public.loans'::regclass) THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_member_id_profiles_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Phone-only board members cannot log in to cast a web vote. Do not include
-- their roles in the online-voting quorum or a board decision could deadlock.
CREATE OR REPLACE FUNCTION public.board_majority_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(1, (COUNT(*) / 2 + 1)::integer)
  FROM public.user_roles roles JOIN auth.users voters ON voters.id = roles.user_id
  WHERE roles.role = 'board_member';
$$;
REVOKE EXECUTE ON FUNCTION public.board_majority_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_majority_count() TO authenticated, service_role;

-- Preserve the former auth-user deletion cascade for web members only.
CREATE OR REPLACE FUNCTION public.remove_deleted_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.profiles WHERE id = OLD.id AND phone_only_member = false;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_deleted_remove_profile ON auth.users;
CREATE TRIGGER on_auth_user_deleted_remove_profile AFTER DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.remove_deleted_auth_profile();
REVOKE EXECUTE ON FUNCTION public.remove_deleted_auth_profile() FROM PUBLIC, anon, authenticated;

-- Normalize legacy Kenyan numbers before indexing. Resolve duplicate numbers
-- manually if this migration surfaces one; never silently merge two members.
UPDATE public.profiles SET phone_number = CASE
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^00254[0-9]{9}$'
    THEN substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 3)
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
    THEN '254' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 2)
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
    THEN '254' || regexp_replace(phone_number, '[^0-9]', '', 'g')
  ELSE regexp_replace(phone_number, '[^0-9]', '', 'g') END
WHERE phone_number IS NOT NULL AND phone_number !~ '^254[0-9]{9}$';
UPDATE public.pending_registrations SET phone_number = CASE
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^00254[0-9]{9}$'
    THEN substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 3)
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
    THEN '254' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 2)
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
    THEN '254' || regexp_replace(phone_number, '[^0-9]', '', 'g')
  ELSE regexp_replace(phone_number, '[^0-9]', '', 'g') END
WHERE phone_number !~ '^254[0-9]{9}$';
UPDATE public.whatsapp_sessions SET phone_number = CASE
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^00254[0-9]{9}$'
    THEN substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 3)
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
    THEN '254' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 2)
  WHEN regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
    THEN '254' || regexp_replace(phone_number, '[^0-9]', '', 'g')
  ELSE regexp_replace(phone_number, '[^0-9]', '', 'g') END
WHERE phone_number !~ '^254[0-9]{9}$';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_number_key ON public.profiles(phone_number) WHERE phone_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pending_registration_one_open_phone ON public.pending_registrations(phone_number) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_sessions_phone_channel_key ON public.whatsapp_sessions(phone_number, channel);
CREATE UNIQUE INDEX IF NOT EXISTS contributions_mpesa_transaction_key ON public.contributions(upper(mpesa_transaction_id)) WHERE mpesa_transaction_id IS NOT NULL;

-- Only trusted officers/server code may change an identity or re-enable messaging;
-- a member must not be able to take over another person's phone number.
CREATE OR REPLACE FUNCTION public.guard_profile_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_anonymized IS DISTINCT FROM OLD.is_anonymized
     OR NEW.data_retention_until IS DISTINCT FROM OLD.data_retention_until
     OR NEW.phone_number IS DISTINCT FROM OLD.phone_number
     OR NEW.phone_only_member IS DISTINCT FROM OLD.phone_only_member
     OR NEW.whatsapp_verified IS DISTINCT FROM OLD.whatsapp_verified
     OR NEW.whatsapp_opt_in IS DISTINCT FROM OLD.whatsapp_opt_in
     OR NEW.whatsapp_opt_in_at IS DISTINCT FROM OLD.whatsapp_opt_in_at
     OR NEW.prefers_sms IS DISTINCT FROM OLD.prefers_sms THEN
    RAISE EXCEPTION 'Only an administrator can update membership or messaging identity fields.';
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles admin update') THEN
    CREATE POLICY "profiles admin update" ON public.profiles FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Realtime count/list refresh for the admin tab (RLS filters subscribers).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pending_registrations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_registrations;
  END IF;
END $$;

-- Aggregate balances server-side; never rely on the PostgREST 1,000 row default.
CREATE OR REPLACE FUNCTION public.bot_confirmed_total(_member_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(SUM(amount), 0) FROM public.contributions
  WHERE member_id = _member_id AND status = 'confirmed';
$$;
REVOKE EXECUTE ON FUNCTION public.bot_confirmed_total(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_confirmed_total(uuid) TO service_role;

-- Transactional membership approval; the caller must have already created the
-- auth user for email members. No auth account is created for phone-only members.
CREATE OR REPLACE FUNCTION public.approve_bot_registration(
  _registration_id uuid, _approved_by uuid, _auth_user_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  application public.pending_registrations%ROWTYPE;
  member_id uuid;
BEGIN
  SELECT * INTO application FROM public.pending_registrations WHERE id = _registration_id FOR UPDATE;
  IF NOT FOUND OR application.status <> 'pending' THEN
    RAISE EXCEPTION 'Registration is no longer pending';
  END IF;
  IF NOT public.has_role(_approved_by, 'admin') THEN
    RAISE EXCEPTION 'Only an admin may approve registrations';
  END IF;
  IF application.requested_role NOT IN ('member', 'board_member', 'secretary', 'assistant_secretary') THEN
    RAISE EXCEPTION 'Invalid requested role';
  END IF;
  IF lower(application.email) = 'francismurageweb@gmail.com' THEN
    RAISE EXCEPTION 'The administrator email cannot be used for bot registration';
  END IF;
  IF application.email IS NOT NULL AND
     (_auth_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _auth_user_id AND lower(email) = lower(application.email))) THEN
    RAISE EXCEPTION 'A matching auth user is required for email registrations';
  END IF;
  IF application.email IS NULL AND _auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Phone-only registrations must not have an auth user';
  END IF;
  member_id := COALESCE(_auth_user_id, gen_random_uuid());
  IF EXISTS (SELECT 1 FROM public.profiles WHERE phone_number = application.phone_number AND id <> member_id) THEN
    RAISE EXCEPTION 'Phone number already belongs to another profile';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = member_id AND email IS DISTINCT FROM application.email) THEN
    RAISE EXCEPTION 'Auth user profile does not match the registration';
  END IF;

  INSERT INTO public.profiles (
    id, full_name, email, phone_number, status, phone_only_member,
    whatsapp_verified, whatsapp_opt_in, whatsapp_opt_in_at, prefers_sms,
    consent_given, consent_timestamp
  ) VALUES (
    member_id, application.full_name, application.email, application.phone_number,
    'approved', application.email IS NULL, true, true, now(),
    application.registration_channel = 'sms', true, now()
  ) ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, phone_number = EXCLUDED.phone_number,
    status = 'approved', phone_only_member = EXCLUDED.phone_only_member,
    whatsapp_verified = true, whatsapp_opt_in = true,
    whatsapp_opt_in_at = now(), prefers_sms = EXCLUDED.prefers_sms,
    consent_given = true, consent_timestamp = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (member_id, application.requested_role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.pending_registrations
  SET status = 'approved', approved_by = _approved_by, approved_at = now()
  WHERE id = _registration_id;
  RETURN member_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_bot_registration(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_bot_registration(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_bot_registration(
  _registration_id uuid, _admin_id uuid, _reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') OR NULLIF(trim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An admin and a reason are required';
  END IF;
  UPDATE public.pending_registrations
  SET status = 'rejected', admin_notes = trim(_reason), approved_by = _admin_id
  WHERE id = _registration_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration is no longer pending'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_bot_registration(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_bot_registration(uuid, uuid, text) TO service_role;

-- A unique claim prevents a vote/review clicked twice from sending duplicate
-- financial messages. Edge Functions release a claim if delivery fails.
CREATE TABLE IF NOT EXISTS public.bot_notification_events (
  event_key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_notification_events FROM anon, authenticated;
GRANT ALL ON public.bot_notification_events TO service_role;
