/**
 * Data loading for the export features.
 *
 * `contributions.member_id` and `loans.member_id` reference `auth.users(id)`
 * rather than `public.profiles(id)`, so PostgREST cannot resolve a
 * `profiles (...)` embed for those tables. Every loader here therefore fetches
 * the financial rows first and merges the profile data on the client — the
 * same approach used by the contributions review page.
 */

import { supabase } from "@/integrations/supabase/client";
import type { MemberStatementInput } from "@/lib/export-documents";

/** Member profile columns needed on exports and statements. */
const PROFILE_COLUMNS = "id, full_name, email, phone_number, created_at, status";

/**
 * Everything printed on a member statement: profile, contributions, loans and
 * the installments belonging to those loans.
 */
export async function loadMemberStatementData(memberId: string): Promise<MemberStatementInput> {
  const [profileResult, contributionResult, loanResult] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", memberId).maybeSingle(),
    supabase
      .from("contributions")
      .select(
        "amount, contributed_on, method, reference, mpesa_transaction_id, status, notes, on_behalf_of",
      )
      .eq("member_id", memberId)
      .order("contributed_on", { ascending: false }),
    supabase
      .from("loans")
      .select("id, loan_type, amount, repayment_months, status, purpose, created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (contributionResult.error) throw contributionResult.error;
  if (loanResult.error) throw loanResult.error;

  const loans = loanResult.data ?? [];
  const loanIds = loans.map((loan) => loan.id);

  let repayments: MemberStatementInput["repayments"] = [];
  if (loanIds.length > 0) {
    const { data, error } = await supabase
      .from("loan_repayments")
      .select(
        "loan_id, installment_number, due_date, amount_due, amount_paid, status, payment_status, paid_at",
      )
      .in("loan_id", loanIds)
      .order("due_date", { ascending: true });
    if (error) throw error;
    repayments = data ?? [];
  }

  return {
    profile: profileResult.data,
    contributions: contributionResult.data ?? [],
    loans,
    repayments,
  };
}

/**
 * Resolve `profiles.full_name` for a set of user ids — used to print the
 * "Confirmed By" column without relying on an unresolvable PostgREST embed.
 */
export async function loadProfileNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  if (error) throw error;

  return new Map(
    (data ?? []).map((profile) => [profile.id, profile.full_name ?? "Officer"] as const),
  );
}
