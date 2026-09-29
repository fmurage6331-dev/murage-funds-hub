import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export async function fetchProfileStatus(userId: string) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Unable to check membership status. Please retry.",
    );
  }
}

export const profileStatusOptions = (userId: string) =>
  queryOptions({
    queryKey: ["profile-status", userId],
    queryFn: () => fetchProfileStatus(userId),
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
    staleTime: 0,
  });

/**
 * Whether the member is still using the issued default password (12345678).
 *
 * The flag arrives with the `phone_login` migration and only drives a warning banner, so an
 * unreadable or not-yet-migrated column resolves to `false` instead of breaking the page. It is
 * cleared when the member changes their own password and set again by an administrator reset.
 */
export async function fetchDefaultPasswordFlag(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_default_password")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.is_default_password ?? false;
  } catch (error) {
    console.error("Unable to read the default-password flag", error);
    return false;
  }
}

/** Shared cache key so /my-account can drop the banner right after a password change. */
export const defaultPasswordFlagKey = (userId: string) =>
  ["default-password-flag", userId] as const;

export const defaultPasswordFlagOptions = (userId: string) =>
  queryOptions({
    queryKey: [...defaultPasswordFlagKey(userId)],
    queryFn: () => fetchDefaultPasswordFlag(userId),
    staleTime: 0,
  });
