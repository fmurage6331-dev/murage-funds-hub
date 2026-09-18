-- Priority 2: Loan Repayment Tracking
-- Repayment schedule table linked to approved loans

CREATE TABLE IF NOT EXISTS public.loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  amount_due numeric(14,2) NOT NULL CHECK (amount_due > 0),
  due_date date NOT NULL,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial', 'overdue')),
  payment_method text DEFAULT 'mpesa',
  reference text,
  recorded_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(loan_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON public.loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_due_date ON public.loan_repayments(due_date);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_status ON public.loan_repayments(status);

-- Enable RLS
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;

-- Select policy: Borrowing member or authorized officers
CREATE POLICY "loan_repayments_select" ON public.loan_repayments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.loans l WHERE l.id = loan_id AND l.member_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer', 'chairman', 'board_member']::public.app_role[])
  );

-- Insert/Update/Delete policy: Treasurer and Admin
CREATE POLICY "loan_repayments_officer_manage" ON public.loan_repayments
  FOR ALL TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer']::public.app_role[])
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer']::public.app_role[])
  );

-- Trigger to update updated_at
CREATE TRIGGER trg_loan_repayments_updated
BEFORE UPDATE ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit log trigger on loan_repayments
DROP TRIGGER IF EXISTS trg_audit_loan_repayments ON public.loan_repayments;
CREATE TRIGGER trg_audit_loan_repayments
AFTER INSERT OR UPDATE OR DELETE ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();

-- Function to auto-generate repayment schedule when loan is approved
CREATE OR REPLACE FUNCTION public.generate_loan_repayment_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_months integer;
  v_total_amount numeric;
  v_monthly_due numeric;
  v_start_date date;
  v_i integer;
  v_due_date date;
BEGIN
  -- Only trigger when status flips to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    -- Check if schedule already exists
    IF NOT EXISTS (SELECT 1 FROM public.loan_repayments WHERE loan_id = NEW.id) THEN
      v_months := GREATEST(1, NEW.repayment_months);
      v_total_amount := NEW.amount;
      v_monthly_due := ROUND(v_total_amount / v_months, 2);
      v_start_date := COALESCE(NEW.decision_at::date, CURRENT_DATE);

      FOR v_i IN 1..v_months LOOP
        v_due_date := v_start_date + make_interval(months => v_i);
        
        -- Adjust last installment for rounding discrepancies
        IF v_i = v_months THEN
          v_monthly_due := v_total_amount - (v_monthly_due * (v_months - 1));
        END IF;

        INSERT INTO public.loan_repayments (
          loan_id,
          installment_number,
          amount_due,
          due_date,
          amount_paid,
          status
        ) VALUES (
          NEW.id,
          v_i,
          v_monthly_due,
          v_due_date,
          0,
          'pending'
        );
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_loan_repayments ON public.loans;
CREATE TRIGGER trg_generate_loan_repayments
AFTER UPDATE OF status ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.generate_loan_repayment_schedule();

-- Auto-update repayment status helper
CREATE OR REPLACE FUNCTION public.sync_repayment_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.amount_paid >= NEW.amount_due THEN
    NEW.status := 'paid';
  ELSIF NEW.amount_paid > 0 THEN
    IF NEW.due_date < CURRENT_DATE THEN
      NEW.status := 'overdue';
    ELSE
      NEW.status := 'partial';
    END IF;
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'overdue';
  ELSE
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_repayment_status ON public.loan_repayments;
CREATE TRIGGER trg_sync_repayment_status
BEFORE INSERT OR UPDATE OF amount_paid, amount_due, due_date ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.sync_repayment_status();
