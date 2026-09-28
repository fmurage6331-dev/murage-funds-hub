-- Member loan payment logging and treasurer confirmation workflow.

ALTER TABLE public.loan_repayments
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'not_paid'
    CHECK (payment_status IN ('not_paid', 'pending_confirmation', 'confirmed', 'rejected')),
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_submitted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_rejection_reason text,
  ADD COLUMN IF NOT EXISTS member_notes text;

CREATE INDEX IF NOT EXISTS idx_loan_repayments_payment_status
  ON public.loan_repayments(payment_status);

-- Repayments that were already recorded by an officer before this workflow was
-- introduced are confirmed historical payments, not new member submissions.
UPDATE public.loan_repayments
SET
  payment_status = 'confirmed',
  payment_confirmed_by = COALESCE(payment_confirmed_by, recorded_by),
  payment_confirmed_at = COALESCE(payment_confirmed_at, paid_at)
WHERE status IN ('paid', 'partial')
  AND amount_paid > 0
  AND payment_status = 'not_paid';

-- Members may submit a payment for their own loan only from the not-paid or
-- rejected state. The existing officer policy remains unchanged and continues
-- to cover treasurer/admin updates.
CREATE POLICY "repayments member submit payment"
  ON public.loan_repayments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.id = loan_id
      AND l.member_id = auth.uid()
    )
    AND payment_status IN ('not_paid', 'rejected')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.id = loan_id
      AND l.member_id = auth.uid()
    )
    AND payment_status = 'pending_confirmation'
  );

-- RLS decides which rows a member may update, while this trigger limits the
-- columns that a member can change. Without this guard, PostgreSQL RLS would
-- allow a permitted UPDATE to include officer-controlled columns as well.
CREATE OR REPLACE FUNCTION public.enforce_member_repayment_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() is NULL for trusted service-role jobs. Those jobs retain their
  -- existing ability to administer repayment rows.
  IF auth.uid() IS NOT NULL
    AND NOT public.has_any_role(auth.uid(), ARRAY['admin', 'treasurer']::public.app_role[])
  THEN
    IF OLD.payment_status NOT IN ('not_paid', 'rejected') THEN
      RAISE EXCEPTION 'This repayment is not available for member submission';
    END IF;

    IF NEW.loan_id IS DISTINCT FROM OLD.loan_id
      OR NEW.installment_number IS DISTINCT FROM OLD.installment_number
      OR NEW.amount_due IS DISTINCT FROM OLD.amount_due
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
      OR NEW.reference IS DISTINCT FROM OLD.reference
      OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.payment_confirmed_by IS DISTINCT FROM OLD.payment_confirmed_by
      OR NEW.payment_confirmed_at IS DISTINCT FROM OLD.payment_confirmed_at
      OR NEW.payment_rejection_reason IS DISTINCT FROM OLD.payment_rejection_reason
    THEN
      RAISE EXCEPTION 'Members may only submit payment details';
    END IF;

    IF NEW.payment_status <> 'pending_confirmation'
      OR NEW.payment_submitted_by IS DISTINCT FROM auth.uid()
      OR NEW.payment_submitted_at IS NULL
      OR NULLIF(BTRIM(NEW.payment_reference), '') IS NULL
    THEN
      RAISE EXCEPTION 'A payment submission requires a reference, submitter, and timestamp';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_member_repayment_submission ON public.loan_repayments;
CREATE TRIGGER trg_enforce_member_repayment_submission
BEFORE UPDATE ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_repayment_submission();

-- The original status-sync trigger marks an overdue partial row as overdue.
-- A confirmed payment must expose the review result as paid or partial, so a
-- later trigger restores the confirmation-specific status after that helper.
CREATE OR REPLACE FUNCTION public.sync_confirmed_repayment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_status = 'confirmed' THEN
    IF NEW.amount_paid >= NEW.amount_due THEN
      NEW.status := 'paid';
    ELSE
      NEW.status := 'partial';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_sync_confirmed_repayment_status ON public.loan_repayments;
CREATE TRIGGER zzz_sync_confirmed_repayment_status
BEFORE INSERT OR UPDATE OF amount_paid, amount_due, payment_status ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.sync_confirmed_repayment_status();

COMMENT ON COLUMN public.loan_repayments.payment_status IS
  'Member submission lifecycle: not_paid, pending_confirmation, confirmed, or rejected';
COMMENT ON COLUMN public.loan_repayments.payment_reference IS
  'Reference supplied by the member, such as an M-Pesa confirmation code';
COMMENT ON COLUMN public.loan_repayments.member_notes IS
  'Optional notes supplied with a member payment submission';
