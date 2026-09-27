-- Service-role requests still execute triggers; explicitly allow the trusted backend.
CREATE OR REPLACE FUNCTION public.guard_profile_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Access Denied: Only administrators can modify membership approval status.';
    END IF;
    IF NEW.is_anonymized IS DISTINCT FROM OLD.is_anonymized THEN
      RAISE EXCEPTION 'Access Denied: Only administrators can modify anonymization flags.';
    END IF;
    IF NEW.data_retention_until IS DISTINCT FROM OLD.data_retention_until THEN
      RAISE EXCEPTION 'Access Denied: Only administrators can alter statutory data retention periods.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Keep profile, role and registration updates atomic. Only the Edge Function may call this.
CREATE OR REPLACE FUNCTION public.complete_admin_approval(
  target_id uuid,
  assigned_role public.app_role,
  registration_id uuid DEFAULT NULL,
  actor_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE registration public.pending_registrations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF registration_id IS NOT NULL THEN
    SELECT * INTO registration FROM public.pending_registrations WHERE id = registration_id FOR UPDATE;
    IF NOT FOUND OR registration.status <> 'pending' THEN
      RAISE EXCEPTION 'Registration is no longer pending';
    END IF;
    UPDATE public.profiles SET
      full_name = registration.full_name, email = registration.email,
      phone_number = registration.phone_number,
      phone_only_member = (registration.email IS NULL)
    WHERE id = target_id;
  END IF;
  UPDATE public.profiles SET status = 'approved' WHERE id = target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member profile not found'; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (target_id, assigned_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  IF registration_id IS NOT NULL THEN
    UPDATE public.pending_registrations SET
      status = 'approved', approved_by = actor_id, approved_at = now(),
      invite_sent = (registration.email IS NOT NULL),
      invite_sent_at = CASE WHEN registration.email IS NOT NULL THEN now() ELSE NULL END
    WHERE id = registration_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_admin_approval(uuid, public.app_role, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_admin_approval(uuid, public.app_role, uuid, uuid) TO service_role;
