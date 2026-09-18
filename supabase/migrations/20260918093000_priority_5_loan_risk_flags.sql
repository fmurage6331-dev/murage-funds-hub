-- Priority 5: Defaulter / Loan Risk Flagging System
-- Automatically flags loans as at-risk when repayments fall overdue

CREATE OR REPLACE VIEW public.loan_risk_flags AS
SELECT
  l.id AS loan_id,
  l.member_id,
  p.full_name AS member_name,
  p.email AS member_email,
  l.amount AS loan_amount,
  l.loan_type,
  l.status AS loan_status,
  COALESCE(COUNT(r.id) FILTER (WHERE r.due_date < CURRENT_DATE AND r.amount_paid < r.amount_due), 0)::int AS overdue_installments_count,
  COALESCE(SUM(GREATEST(0, r.amount_due - r.amount_paid)) FILTER (WHERE r.due_date < CURRENT_DATE), 0)::numeric AS total_overdue_amount,
  COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.amount_paid < r.amount_due), 0)::int AS max_days_overdue,
  CASE
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.amount_paid < r.amount_due), 0) >= 60 THEN 'critical_defaulter'
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.amount_paid < r.amount_due), 0) >= 30 THEN 'high_risk'
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.amount_paid < r.amount_due), 0) >= 15 THEN 'watch'
    WHEN COALESCE(MAX(CURRENT_DATE - r.due_date) FILTER (WHERE r.due_date < CURRENT_DATE AND r.amount_paid < r.amount_due), 0) > 0 THEN 'early_overdue'
    ELSE 'healthy'
  END AS risk_tier
FROM public.loans l
JOIN public.profiles p ON p.id = l.member_id
LEFT JOIN public.loan_repayments r ON r.loan_id = l.id
WHERE l.status = 'approved'
GROUP BY l.id, l.member_id, p.full_name, p.email, l.amount, l.loan_type, l.status;

-- Grant permissions on view
GRANT SELECT ON public.loan_risk_flags TO authenticated, service_role;
