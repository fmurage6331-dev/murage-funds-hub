import { supabase } from "@/integrations/supabase/client";

export type ProfileSummary = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
};

/**
 * `contributions.member_id` and `loans.member_id` reference `auth.users(id)`,
 * not `public.profiles(id)`, so PostgREST cannot resolve a `profiles (...)`
 * embed for them (the generated schema types report
 * `could not find the relation between contributions and profiles`).
 *
 * These pages need member names next to every financial row, so the profiles
 * are fetched separately and merged on the client instead. RLS on `profiles`
 * allows every authenticated user to read them.
 */
export async function attachMemberProfiles<T extends { member_id: string }>(
  rows: T[],
): Promise<Array<T & { profiles: ProfileSummary | null }>> {
  const memberIds = [...new Set(rows.map((row) => row.member_id))];
  if (memberIds.length === 0) {
    return rows.map((row) => ({ ...row, profiles: null }));
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_number")
    .in("id", memberIds);
  if (error) throw error;

  const byId = new Map((data ?? []).map((profile) => [profile.id, profile]));
  return rows.map((row) => ({ ...row, profiles: byId.get(row.member_id) ?? null }));
}

/**
 * Normalise an embedded relation: PostgREST returns a to-one relation as an
 * object, but a schema mismatch yields an array or null.
 */
export function embeddedProfile(value: unknown): ProfileSummary | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return (value[0] as ProfileSummary) ?? null;
  return value as ProfileSummary;
}
