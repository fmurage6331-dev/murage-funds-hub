-- 1. KDPA columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_timestamp timestamp with time zone,
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS data_retention_until timestamp with time zone,
  ADD COLUMN IF NOT EXISTS is_anonymized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamp with time zone;

-- Admins can delete profiles (for members with no financial records)
CREATE POLICY "profiles admin delete" ON public.profiles FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. Append-only audit log
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name text NOT NULL,
  action text NOT NULL,
  record_id text,
  performed_by uuid,
  performed_by_email text,
  changed_fields text[],
  old_values jsonb,
  new_values jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit select officers" ON public.audit_logs FOR SELECT TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'treasurer'::app_role, 'chairman'::app_role]));

-- 3. Audit trigger function (security definer; runs as owner so any permitted write is logged)
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _changed text[];
BEGIN
  SELECT email INTO _email FROM auth.users WHERE id = auth.uid();
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key) INTO _changed
    FROM jsonb_each(to_jsonb(OLD)) o
    WHERE to_jsonb(OLD) -> key IS DISTINCT FROM to_jsonb(NEW) -> o.key;
  ELSE
    _changed := NULL;
  END IF;
  INSERT INTO public.audit_logs (table_name, action, record_id, performed_by, performed_by_email, changed_fields, old_values, new_values)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id::text, OLD.id::text),
    auth.uid(),
    _email,
    _changed,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_audit_event() FROM anon, authenticated;

CREATE TRIGGER audit_contributions AFTER INSERT OR UPDATE OR DELETE ON public.contributions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_loan_repayments AFTER INSERT OR UPDATE OR DELETE ON public.loan_repayments FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();