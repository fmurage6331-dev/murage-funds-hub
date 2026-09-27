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
