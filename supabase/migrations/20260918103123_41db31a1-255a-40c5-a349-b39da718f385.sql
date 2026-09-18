REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.board_majority_count() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_loan_majority() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_loan_eligibility() FROM anon, authenticated;