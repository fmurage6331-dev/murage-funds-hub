-- Security Review & RLS Hardening Migration

-- 1. Prevent Privilege Escalation via profiles update
-- In the base schema, profiles update allowed auth.uid() = id.
-- A malicious member could issue `UPDATE profiles SET status = 'approved'` to bypass admin onboarding.
CREATE OR REPLACE FUNCTION public.guard_profile_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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

DROP TRIGGER IF EXISTS trg_guard_profile_updates ON public.profiles;
CREATE TRIGGER trg_guard_profile_updates
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_updates();

-- 2. Secretary & Assistant Secretary permissions on donors
-- Ensure secretary and assistant_secretary can insert and update donor records as per governance specs
CREATE POLICY "donors_secretariat_insert" ON public.donors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin', 'secretary', 'assistant_secretary']::public.app_role[])
  );

CREATE POLICY "donors_secretariat_update" ON public.donors
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin', 'secretary', 'assistant_secretary']::public.app_role[])
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin', 'secretary', 'assistant_secretary']::public.app_role[])
  );

-- 3. Treasurer permissions on transactions
-- Ensure treasurer can insert and update transactions (income/expenses) alongside admin
CREATE POLICY "tx_treasurer_insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer']::public.app_role[])
  );

CREATE POLICY "tx_treasurer_update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer']::public.app_role[])
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer']::public.app_role[])
  );
