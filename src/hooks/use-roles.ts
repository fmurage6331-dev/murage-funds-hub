import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasAnyRole, hasRole, roleFlags, type Role } from "@/lib/rbac";

export type { Role, RoleFlags } from "@/lib/rbac";

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

  return {
    ...roleFlags(data),
    isLoading,
    has: (role: Role) => hasRole(data, role),
    hasAny: (roles: Role[]) => hasAnyRole(data, roles),
  };
}
