-- Priority 1: Immutable Audit Trail
-- Append-only audit log table recording financial and governance actions on contributions, loans, and transactions

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  changed_fields text[],
  performed_by uuid,
  performed_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient querying by table, record, actor, and time
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Read policy: Admins and financial officers can audit
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer', 'chairman', 'secretary', 'assistant_secretary']::public.app_role[])
  );

-- Insert policy: Trigger / system / service_role inserts
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Explicitly disallow any UPDATE or DELETE via RLS (no policy granted for UPDATE or DELETE)
-- In addition, enforce immutability at the engine level via trigger:
CREATE OR REPLACE FUNCTION public.prevent_audit_log_tampering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'Security Alert: audit_logs is an immutable, append-only table. Modifications and deletions are strictly prohibited.';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tampering ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_log_tampering
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_tampering();

-- Revoke permissions to edit or delete
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- Master trigger function for auditing
CREATE OR REPLACE FUNCTION public.record_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_record_id uuid;
  v_old_json jsonb := NULL;
  v_new_json jsonb := NULL;
  v_changed text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  -- Determine current user
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    v_record_id := OLD.id;
    v_old_json := to_jsonb(OLD);
    INSERT INTO public.audit_logs (table_name, record_id, action, old_values, new_values, changed_fields, performed_by, performed_by_email)
    VALUES (TG_TABLE_NAME, v_record_id, 'DELETE', v_old_json, NULL, NULL, v_user_id, v_user_email);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_record_id := NEW.id;
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);

    -- Compute list of keys that changed
    FOR v_key IN SELECT jsonb_object_keys(v_new_json)
    LOOP
      IF (v_old_json ->> v_key) IS DISTINCT FROM (v_new_json ->> v_key) AND v_key NOT IN ('updated_at') THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;

    INSERT INTO public.audit_logs (table_name, record_id, action, old_values, new_values, changed_fields, performed_by, performed_by_email)
    VALUES (TG_TABLE_NAME, v_record_id, 'UPDATE', v_old_json, v_new_json, v_changed, v_user_id, v_user_email);
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    v_record_id := NEW.id;
    v_new_json := to_jsonb(NEW);
    INSERT INTO public.audit_logs (table_name, record_id, action, old_values, new_values, changed_fields, performed_by, performed_by_email)
    VALUES (TG_TABLE_NAME, v_record_id, 'INSERT', NULL, v_new_json, NULL, v_user_id, v_user_email);
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Attach triggers to contributions, loans, and transactions
DROP TRIGGER IF EXISTS trg_audit_contributions ON public.contributions;
CREATE TRIGGER trg_audit_contributions
AFTER INSERT OR UPDATE OR DELETE ON public.contributions
FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();

DROP TRIGGER IF EXISTS trg_audit_loans ON public.loans;
CREATE TRIGGER trg_audit_loans
AFTER INSERT OR UPDATE OR DELETE ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();

DROP TRIGGER IF EXISTS trg_audit_transactions ON public.transactions;
CREATE TRIGGER trg_audit_transactions
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
