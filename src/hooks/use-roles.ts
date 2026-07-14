import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];

export function useRoles(userId: string | undefined) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["roles", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId!);
      return (data?.map((r) => r.role) ?? []) as Role[];
    },
  });

  const has = (r: Role) => data.includes(r);
  const hasAny = (rs: Role[]) => rs.some((r) => data.includes(r));

  return {
    roles: data,
    isLoading,
    has,
    hasAny,
    isAdmin: has("admin"),
    isTreasurer: has("treasurer"),
    isChairman: has("chairman"),
    isSecretary: hasAny(["secretary", "assistant_secretary"]),
    isBoard: has("board_member"),
    canConfirmContribs: hasAny(["admin", "treasurer"]),
    canForwardLoans: hasAny(["admin", "chairman", "treasurer"]),
    canManageMeetings: hasAny(["admin", "secretary", "assistant_secretary"]),
    canViewFinancials: hasAny(["admin", "treasurer", "chairman", "secretary", "assistant_secretary"]),
  };
}
