
-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.board_majority_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(1, (COUNT(*)/2 + 1)::int) FROM public.user_roles WHERE role = 'board_member';
$$;
REVOKE EXECUTE ON FUNCTION public.board_majority_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.board_majority_count() TO authenticated, service_role;

-- Replace new-user trigger: admin only for the specific email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email);

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

-- Make sure the auth trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill admin role for the designated email if user already exists
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE lower(email) = 'francismurageweb@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- ============ contributions ============
CREATE TABLE public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES',
  contributed_on date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL DEFAULT 'mpesa',
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contributions TO authenticated;
GRANT ALL ON public.contributions TO service_role;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contrib select own or officers" ON public.contributions FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','treasurer','chairman']::public.app_role[]));
CREATE POLICY "contrib insert own" ON public.contributions FOR INSERT TO authenticated
  WITH CHECK (member_id = auth.uid() AND status = 'pending');
CREATE POLICY "contrib update own pending" ON public.contributions FOR UPDATE TO authenticated
  USING (member_id = auth.uid() AND status = 'pending')
  WITH CHECK (member_id = auth.uid() AND status = 'pending');
CREATE POLICY "contrib delete own pending" ON public.contributions FOR DELETE TO authenticated
  USING (member_id = auth.uid() AND status = 'pending');
CREATE POLICY "contrib officers manage" ON public.contributions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','treasurer']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','treasurer']::public.app_role[]));

CREATE TRIGGER trg_contrib_updated BEFORE UPDATE ON public.contributions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ loan_rules (singleton) ============
CREATE TABLE public.loan_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_multiplier numeric NOT NULL DEFAULT 3,
  max_amount numeric NOT NULL DEFAULT 500000,
  min_membership_days integer NOT NULL DEFAULT 90,
  interest_rate_percent numeric NOT NULL DEFAULT 10,
  max_repayment_months integer NOT NULL DEFAULT 12,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.loan_rules TO authenticated;
GRANT ALL ON public.loan_rules TO service_role;
ALTER TABLE public.loan_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rules read all auth" ON public.loan_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "rules admin manage" ON public.loan_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_rules_updated BEFORE UPDATE ON public.loan_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.loan_rules DEFAULT VALUES;

-- ============ loans ============
CREATE TABLE public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  purpose text NOT NULL,
  repayment_months integer NOT NULL CHECK (repayment_months > 0),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','forwarded','approved','rejected')),
  auto_eligible boolean NOT NULL DEFAULT false,
  eligibility_note text,
  forwarded_by uuid,
  forwarded_at timestamptz,
  decision_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loans TO authenticated;
GRANT ALL ON public.loans TO service_role;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

-- Members see their own; officers & board members see relevant ones
CREATE POLICY "loans select own or officers" ON public.loans FOR SELECT TO authenticated
  USING (
    member_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['admin','chairman','treasurer']::public.app_role[])
    OR (public.has_role(auth.uid(), 'board_member') AND status IN ('forwarded','approved','rejected'))
  );

CREATE POLICY "loans insert own" ON public.loans FOR INSERT TO authenticated
  WITH CHECK (member_id = auth.uid() AND status = 'submitted');

-- Chairman/treasurer forward; admin can do anything
CREATE POLICY "loans officers update" ON public.loans FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','chairman','treasurer']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','chairman','treasurer']::public.app_role[]));

CREATE POLICY "loans admin delete" ON public.loans FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Compute auto-eligibility on insert
CREATE OR REPLACE FUNCTION public.compute_loan_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.loan_rules%ROWTYPE;
  total_contrib numeric;
  member_since timestamptz;
  reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO r FROM public.loan_rules WHERE active = true ORDER BY updated_at DESC LIMIT 1;
  SELECT COALESCE(SUM(amount),0) INTO total_contrib FROM public.contributions
    WHERE member_id = NEW.member_id AND status = 'confirmed';
  SELECT created_at INTO member_since FROM auth.users WHERE id = NEW.member_id;

  IF r.id IS NULL THEN
    NEW.auto_eligible := false;
    NEW.eligibility_note := 'No active loan rules configured';
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
REVOKE EXECUTE ON FUNCTION public.compute_loan_eligibility() FROM PUBLIC;

CREATE TRIGGER trg_loan_eligibility BEFORE INSERT ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.compute_loan_eligibility();

CREATE TRIGGER trg_loans_updated BEFORE UPDATE ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ loan_votes ============
CREATE TABLE public.loan_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  board_member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote text NOT NULL CHECK (vote IN ('approve','reject')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, board_member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_votes TO authenticated;
GRANT ALL ON public.loan_votes TO service_role;
ALTER TABLE public.loan_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "votes select relevant" ON public.loan_votes FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','chairman','treasurer','board_member']::public.app_role[])
    OR EXISTS (SELECT 1 FROM public.loans l WHERE l.id = loan_id AND l.member_id = auth.uid())
  );
CREATE POLICY "votes board insert" ON public.loan_votes FOR INSERT TO authenticated
  WITH CHECK (
    board_member_id = auth.uid()
    AND public.has_role(auth.uid(), 'board_member')
    AND EXISTS (SELECT 1 FROM public.loans l WHERE l.id = loan_id AND l.status = 'forwarded')
  );
CREATE POLICY "votes admin manage" ON public.loan_votes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-approve when majority reached
CREATE OR REPLACE FUNCTION public.check_loan_majority()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approve_count int;
  reject_count int;
  needed int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE vote = 'approve'),
         COUNT(*) FILTER (WHERE vote = 'reject')
  INTO approve_count, reject_count
  FROM public.loan_votes WHERE loan_id = NEW.loan_id;

  needed := public.board_majority_count();

  IF approve_count >= needed THEN
    UPDATE public.loans SET status = 'approved', decision_at = now()
      WHERE id = NEW.loan_id AND status = 'forwarded';
  ELSIF reject_count >= needed THEN
    UPDATE public.loans SET status = 'rejected', decision_at = now(),
      rejection_reason = COALESCE(rejection_reason, 'Rejected by board majority')
      WHERE id = NEW.loan_id AND status = 'forwarded';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_loan_majority() FROM PUBLIC;

CREATE TRIGGER trg_loan_vote_majority AFTER INSERT ON public.loan_votes
FOR EACH ROW EXECUTE FUNCTION public.check_loan_majority();

-- ============ meetings ============
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  location text,
  agenda text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meetings select all auth" ON public.meetings FOR SELECT TO authenticated USING (true);
CREATE POLICY "meetings secretary manage" ON public.meetings FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','secretary','assistant_secretary']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','secretary','assistant_secretary']::public.app_role[]));

CREATE TRIGGER trg_meetings_updated BEFORE UPDATE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ meeting_minutes ============
CREATE TABLE public.meeting_minutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  content text NOT NULL,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_minutes TO authenticated;
GRANT ALL ON public.meeting_minutes TO service_role;
ALTER TABLE public.meeting_minutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "minutes select all auth" ON public.meeting_minutes FOR SELECT TO authenticated USING (true);
CREATE POLICY "minutes secretary manage" ON public.meeting_minutes FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','secretary','assistant_secretary']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','secretary','assistant_secretary']::public.app_role[]));

CREATE TRIGGER trg_minutes_updated BEFORE UPDATE ON public.meeting_minutes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
