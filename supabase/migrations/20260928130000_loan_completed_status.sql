-- Add the completed state for loans and automatically close an approved loan
-- after every repayment installment has been confirmed in full.

DO $$
DECLARE
  status_constraint record;
BEGIN
  -- The original loans migration named this constraint loans_status_check. Look
  -- at the live definition first because completed may already have been added
  -- directly in the hosted database.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c'
      AND t.relname = 'loans'
      AND n.nspname = 'public'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
      AND pg_get_constraintdef(c.oid) ILIKE '%completed%'
  ) THEN
    -- Remove the repository's original status check, regardless of the name
    -- assigned to it by PostgreSQL, before installing the expanded check.
    FOR status_constraint IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'c'
        AND t.relname = 'loans'
        AND n.nspname = 'public'
        AND pg_get_constraintdef(c.oid) ILIKE '%status%'
        AND pg_get_constraintdef(c.oid) ILIKE '%submitted%'
        AND pg_get_constraintdef(c.oid) ILIKE '%approved%'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.loans DROP CONSTRAINT %I',
        status_constraint.conname
      );
    END LOOP;

    ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_status_check;
    ALTER TABLE public.loans
      ADD CONSTRAINT loans_status_check
      CHECK (status IN ('submitted', 'forwarded', 'approved', 'rejected', 'completed'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.auto_complete_loan_after_repayment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  installment_count integer;
  completed_count integer;
BEGIN
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (
      WHERE (
        payment_status = 'confirmed'
        AND amount_paid >= amount_due
      )
      OR status = 'paid'
    )::integer
  INTO installment_count, completed_count
  FROM public.loan_repayments
  WHERE loan_id = NEW.loan_id;

  IF installment_count > 0 AND installment_count = completed_count THEN
    UPDATE public.loans
    SET status = 'completed'
    WHERE id = NEW.loan_id
      AND status = 'approved';
  END IF;

  RETURN NEW;
END;
$$;

-- Install the trigger only when an auto-completion trigger is not already
-- present. This avoids replacing a hosted trigger that may have been added
-- outside the repository migration history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND t.tgname = 'trg_auto_complete_loan_after_repayment'
      AND c.relname = 'loan_repayments'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_auto_complete_loan_after_repayment
    AFTER INSERT OR UPDATE OF amount_paid, status, payment_status ON public.loan_repayments
    FOR EACH ROW EXECUTE FUNCTION public.auto_complete_loan_after_repayment();
  END IF;
END $$;
