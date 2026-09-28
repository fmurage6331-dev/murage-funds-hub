import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];

/** Roles that grant any kind of officer (non-member) capability. */
export const OFFICER_ROLES: Role[] = [
  "admin",
  "treasurer",
  "chairman",
  "secretary",
  "assistant_secretary",
  "board_member",
];

/** Roles that may review contributions, transactions and financial statements. */
export const FINANCE_OFFICER_ROLES: Role[] = ["admin", "treasurer", "chairman"];

/** Roles that may manage meetings and donors. */
export const SECRETARIAT_ROLES: Role[] = ["admin", "secretary", "assistant_secretary"];

export function useRoles(userId: string | undefined) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["roles", userId],
    enabled: !!userId,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId!);
        if (error) throw error;
        return (data?.map((row) => row.role) ?? []) as Role[];
      } catch (error) {
        console.error("Failed to load roles", error);
        return [] as Role[];
      }
    },
  });

  const has = (role: Role) => data.includes(role);
  const hasAny = (roles: Role[]) => roles.some((role) => data.includes(role));

  return {
    roles: data,
    isLoading,
    has,
    hasAny,
    isAdmin: has("admin"),
    isTreasurer: has("treasurer"),
    isChairman: has("chairman"),
    isSecretary: has("secretary"),
    isAssistantSecretary: has("assistant_secretary"),
    isBoardMember: has("board_member"),
    isMember: has("member"),
    isOfficer: hasAny(OFFICER_ROLES),
    isFinanceOfficer: hasAny(FINANCE_OFFICER_ROLES),
    isSecretariat: hasAny(SECRETARIAT_ROLES),
  };
}
