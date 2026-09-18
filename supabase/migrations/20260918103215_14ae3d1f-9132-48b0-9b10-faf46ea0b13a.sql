CREATE OR REPLACE VIEW public.loan_risk_flags
WITH (security_invoker = true) AS
SELECT
  l.id AS loan_id,
  l.member_id,
  p.full_name AS member_name,
  p.email AS member_email,
  l.loan_type,
  l.amount AS loan_amount,
  COALESCE(SUM(r.amount_due - r.amount_paid) FILTER (WHERE r.due_date < CURRENT_DATE AND r.status <> 'paid'), 0) AS total_overdue_amount,
  COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.status <> 'paid'), 0) AS max_days_overdue,
  CASE
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.status <> 'paid'), 0) > 90 THEN 'critical_defaulter'
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.status <> 'paid'), 0) > 30 THEN 'high_risk'
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.status <> 'paid'), 0) > 0 THEN 'watch'
    ELSE 'healthy'
  END AS risk_tier
FROM public.loans l
JOIN public.profiles p ON p.id = l.member_id
LEFT JOIN public.loan_repayments r ON r.loan_id = l.id
WHERE l.status IN ('approved', 'disbursed')
GROUP BY l.id, l.member_id, p.full_name, p.email, l.loan_type, l.amount;

GRANT SELECT ON public.loan_risk_flags TO authenticated;
GRANT ALL ON public.loan_risk_flags TO service_role;