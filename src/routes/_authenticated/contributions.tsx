import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep the /contributions member URL working; the actual form and payment
// instructions live on My Contributions.
export const Route = createFileRoute("/_authenticated/contributions")({
  beforeLoad: () => { throw redirect({ to: "/my-contributions" }); },
});
