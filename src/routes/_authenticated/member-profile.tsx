import { createFileRoute, Outlet } from "@tanstack/react-router";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/member-profile")({
  component: MemberProfileLayout,
});

/**
 * Officer-only directory. The guard lives on the layout route so both the
 * member list and the individual profile views are covered.
 */
function MemberProfileLayout() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin && !r.isTreasurer && !r.isChairman) {
    return <UnauthorizedCard message="This page is restricted to officers." />;
  }

  return <Outlet />;
}
