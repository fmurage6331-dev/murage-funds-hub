-- Password-only signup: keep the member's phone number when the auth trigger creates the profile.
--
-- handle_new_user() keeps its existing behaviour — profile row, KDPA consent captured from user
-- metadata, 7-year retention window, 'member' role for everyone and 'admin' for the designated
-- administrator email — and additionally:
--   * stores phone_number from NEW.raw_user_meta_data->>'phone_number' (signup now sends it)
--   * assigns status on INSERT: 'pending' for new members, 'approved' for the administrator email
--
-- Status is set in the INSERT rather than by a follow-up UPDATE on purpose:
-- trg_guard_profile_updates (BEFORE UPDATE) rejects status changes unless the request comes from
-- service_role or a verified admin, and the GoTrue signup trigger runs with neither auth.uid() nor
-- a JWT role set. INSERTs are not guarded, so the administrator is still auto-approved on signup
-- while members land on 'pending' and wait for an admin.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_consent boolean;
  v_consent_version text;
  v_is_admin boolean;
  v_status text;
BEGIN
  v_consent := COALESCE((NEW.raw_user_meta_data->>'consent_given')::boolean, false);
  v_consent_version := COALESCE(NEW.raw_user_meta_data->>'consent_version', '1.0');
  v_is_admin := lower(NEW.email) = 'francismurageweb@gmail.com';
  v_status := CASE WHEN v_is_admin THEN 'approved' ELSE 'pending' END;

  INSERT INTO public.profiles (
    id, full_name, email, phone_number,
    status, consent_given, consent_timestamp,
    consent_version, data_retention_until
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'phone_number',
    v_status,
    v_consent,
    CASE WHEN v_consent THEN now() ELSE NULL END,
    v_consent_version,
    now() + interval '7 years'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone_number = COALESCE(EXCLUDED.phone_number, profiles.phone_number),
    consent_given = EXCLUDED.consent_given,
    consent_timestamp = EXCLUDED.consent_timestamp,
    consent_version = EXCLUDED.consent_version;

  IF v_is_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE keeps the existing ACL; restated so the hardened grants stay explicit.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
