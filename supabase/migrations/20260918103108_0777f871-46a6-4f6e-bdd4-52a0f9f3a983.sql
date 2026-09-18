CREATE TABLE public.loan_repayments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  amount_due numeric NOT NULL,
  due_date date NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  paid_at timestamp with time zone,
  payment_method text,
  reference text,
  recorded_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (loan_id, installment_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_repayments TO authenticated;
GRANT ALL ON public.loan_repayments TO service_role;
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repayments select own or officers" ON public.loan_repayments FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM public.loans l WHERE l.id = loan_repayments.loan_id AND l.member_id = auth.uid())) OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'chairman'::app_role, 'treasurer'::app_role]));
CREATE POLICY "repayments officers insert" ON public.loan_repayments FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'chairman'::app_role, 'treasurer'::app_role]));
CREATE POLICY "repayments officers update" ON public.loan_repayments FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'chairman'::app_role, 'treasurer'::app_role])) WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'chairman'::app_role, 'treasurer'::app_role]));
CREATE POLICY "repayments admin delete" ON public.loan_repayments FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER update_loan_repayments_updated_at BEFORE UPDATE ON public.loan_repayments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();