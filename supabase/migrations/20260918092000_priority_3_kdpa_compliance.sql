-- Priority 3: Data Protection Compliance (Kenya Data Protection Act 2019)
-- Capturing consent, data retention policy fields, and subject access/erasure support

-- Extend profiles table with KDPA compliance fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS consent_version text DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS consent_purpose text DEFAULT 'Financial records, loan governance, and statutory audit compliance under Kenya Data Protection Act 2019',
  ADD COLUMN IF NOT EXISTS data_retention_until timestamptz DEFAULT (now() + interval '7 years'),
  ADD COLUMN IF NOT EXISTS is_anonymized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- Update handle_new_user trigger to capture consent from auth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_consent boolean;
  v_consent_version text;
BEGIN
  v_consent := COALESCE((NEW.raw_user_meta_data->>'consent_given')::boolean, false);
  v_consent_version := COALESCE(NEW.raw_user_meta_data->>'consent_version', '1.0');

  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    consent_given,
    consent_timestamp,
    consent_version,
    data_retention_until
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    v_consent,
    CASE WHEN v_consent THEN now() ELSE NULL END,
    v_consent_version,
    now() + interval '7 years'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    consent_given = EXCLUDED.consent_given,
    consent_timestamp = EXCLUDED.consent_timestamp,
    consent_version = EXCLUDED.consent_version;

  IF lower(NEW.email) = 'francismurageweb@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- KDPA Subject Erasure / Anonymization Stored Procedure
CREATE OR REPLACE FUNCTION public.anonymize_member_data(_target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_short_id text;
  v_anon_email text;
  v_anon_name text;
BEGIN
  -- Check caller is admin
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only an administrator can execute KDPA data erasure requests.';
  END IF;

  v_short_id := substr(_target_user_id::text, 1, 8);
  v_anon_email := 'anonymized_' || v_short_id || '@kdpa.murage.internal';
  v_anon_name := 'Anonymized Member (' || v_short_id || ')';

  -- Redact profile PII
  UPDATE public.profiles
  SET
    full_name = v_anon_name,
    email = v_anon_email,
    status = 'rejected',
    is_anonymized = true,
    anonymized_at = now(),
    updated_at = now()
  WHERE id = _target_user_id;

  -- Remove active roles except revoked member placeholder
  DELETE FROM public.user_roles WHERE user_id = _target_user_id;

  -- Redact notes in contributions
  UPDATE public.contributions
  SET
    notes = '[REDACTED UNDER KDPA SECTION 40]',
    reference = '[REDACTED]'
  WHERE member_id = _target_user_id;

  -- Redact loan purposes
  UPDATE public.loans
  SET
    purpose = '[REDACTED UNDER KDPA SECTION 40]'
  WHERE member_id = _target_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_member_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_member_data(uuid) TO authenticated, service_role;
