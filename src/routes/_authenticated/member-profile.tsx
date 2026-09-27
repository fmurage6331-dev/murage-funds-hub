import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/member-profile")({
  component: () => <Outlet />,
});
