import { createFileRoute, redirect } from "@tanstack/react-router";

// Old member-facing URL; keep bookmarks working and show the payment card.
export const Route = createFileRoute("/_authenticated/contributions")({
  beforeLoad: () => {
    throw redirect({ to: "/my-contributions" });
  },
});
