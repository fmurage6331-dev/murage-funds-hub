-- ============ loan_type: split loans/loan_rules into project vs emergency ============

DO $$ BEGIN
  CREATE TYPE public.loan_type AS ENUM ('project', 'emergency');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS loan_type public.loan_type NOT NULL DEFAULT 'project';

ALTER TABLE public.loan_rules
  ADD COLUMN IF NOT EXISTS loan_type public.loan_type;

-- Tag the original singleton row as 'project' if not already tagged
UPDATE public.loan_rules SET loan_type = 'project' WHERE loan_type IS NULL;

-- Seed emergency rules if not already present (adjust values as needed)
INSERT INTO public.loan_rules (max_multiplier, max_amount, min_membership_days, interest_rate_percent, max_repayment_months, active, loan_type)
SELECT 2, 50000, 30, 5, 6, true, 'emergency'
WHERE NOT EXISTS (SELECT 1 FROM public.loan_rules WHERE loan_type = 'emergency');

ALTER TABLE public.loan_rules
  ALTER COLUMN loan_type SET NOT NULL;

DO $$ BEGIN
  CREATE UNIQUE INDEX loan_rules_one_active_per_type
    ON public.loan_rules (loan_type)
    WHERE active = true;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Fix eligibility trigger to match rules by loan_type instead of "most recently updated"
CREATE OR REPLACE FUNCTION public.compute_loan_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.loan_rules%ROWTYPE;
  total_contrib numeric;
  member_since timestamptz;
  reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO r FROM public.loan_rules
    WHERE active = true AND loan_type = NEW.loan_type
    ORDER BY updated_at DESC LIMIT 1;
  SELECT COALESCE(SUM(amount),0) INTO total_contrib FROM public.contributions
    WHERE member_id = NEW.member_id AND status = 'confirmed';
  SELECT created_at INTO member_since FROM auth.users WHERE id = NEW.member_id;

  IF r.id IS NULL THEN
    NEW.auto_eligible := false;
    NEW.eligibility_note := format('No active loan rules configured for %s loans', NEW.loan_type);
    RETURN NEW;
  END IF;

  IF NEW.amount > r.max_amount THEN
    reasons := reasons || format('Exceeds max amount (%s)', r.max_amount);
  END IF;
  IF NEW.amount > total_contrib * r.max_multiplier THEN
    reasons := reasons || format('Exceeds %sx of confirmed contributions (%s)', r.max_multiplier, total_contrib);
  END IF;
  IF member_since IS NOT NULL AND (now() - member_since) < make_interval(days => r.min_membership_days) THEN
    reasons := reasons || format('Membership under %s days', r.min_membership_days);
  END IF;
  IF NEW.repayment_months > r.max_repayment_months THEN
    reasons := reasons || format('Repayment exceeds %s months', r.max_repayment_months);
  END IF;

  IF array_length(reasons, 1) IS NULL THEN
    NEW.auto_eligible := true;
    NEW.eligibility_note := 'Meets all criteria';
  ELSE
    NEW.auto_eligible := false;
    NEW.eligibility_note := array_to_string(reasons, '; ');
  END IF;
  RETURN NEW;
END;
$$;
