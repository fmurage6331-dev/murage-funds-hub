import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Leaf, LogOut, Clock } from "lucide-react";

export const Route = createFileRoute("/pending-approval")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });

    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .single();

    if (profile?.status === "approved") throw redirect({ to: "/" });

    return { user: data.user, status: profile?.status ?? "pending" };
  },
  component: PendingApprovalPage,
});

function PendingApprovalPage() {
  const { status } = Route.useRouteContext();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const rejected = status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-gold text-gold-foreground">
          <Leaf className="h-6 w-6" />
        </div>
        <h1 className="font-serif text-xl font-semibold text-primary">Murage Foundation</h1>

        <div className="mt-6 flex flex-col items-center gap-2">
          <Clock className="h-8 w-8 text-muted-foreground" />
          {rejected ? (
            <>
              <h2 className="text-lg font-semibold">Access not granted</h2>
              <p className="text-sm text-muted-foreground">
                An admin has reviewed your signup and did not approve access. If you believe
                this is a mistake, please contact the foundation directly.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Awaiting approval</h2>
              <p className="text-sm text-muted-foreground">
                Your account has been created and is waiting for an admin to approve access.
                You'll be able to sign in normally once approved.
              </p>
            </>
          )}
        </div>

        <Button variant="outline" className="mt-6" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </Card>
    </div>
  );
}
