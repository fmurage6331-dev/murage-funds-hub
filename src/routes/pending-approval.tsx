import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchProfileStatus, profileStatusOptions } from "@/lib/profile-status";
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

    const profile = await fetchProfileStatus(data.user.id);

    if (profile?.status === "approved") throw redirect({ to: "/dashboard" });

    return { user: data.user, status: profile?.status ?? "pending" };
  },
  component: PendingApprovalPage,
});

function PendingApprovalPage() {
  const { user, status } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: profile, error } = useQuery(profileStatusOptions(user.id));
  const navigate = useNavigate();

  useEffect(() => {
    if (profile?.status === "approved") void navigate({ to: "/dashboard", replace: true });
  }, [profile, navigate]);

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await qc.cancelQueries();
      qc.clear();
      await navigate({ to: "/auth", replace: true });
    } catch {
      toast.error("Unable to sign out. Please retry.");
    }
  };

  const rejected = (profile?.status ?? status) === "rejected";

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
                An admin has reviewed your signup and did not approve access. If you believe this is
                a mistake, please contact the foundation directly.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Awaiting approval</h2>
              <p className="text-sm text-muted-foreground">
                Your account has been created and is waiting for an admin to approve access. You'll
                be able to sign in normally once approved.
              </p>
            </>
          )}
        </div>

        <div className="mt-6 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">KCB Bank Kenya · M-Pesa Paybill</p>
          <p>
            Paybill: <strong>522522</strong>
            <br />
            Account: <strong>7989164</strong>
          </p>
          <p>
            While waiting for approval, you can register via WhatsApp/SMS by texting{" "}
            <strong>JOIN</strong> to our bot.
          </p>
          <p>Admin contact: +254182528510</p>
          <Button asChild className="bg-emerald-700 text-white hover:bg-emerald-800">
            <a href="https://wa.me/254182528510" target="_blank" rel="noopener noreferrer">
              Contact Admin
            </a>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground" role="status">
          {error
            ? "Unable to check approval. We will retry automatically."
            : "Approval status refreshes every 30 seconds. You will be redirected when approved."}
        </p>
        <Button variant="outline" className="mt-6" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </Card>
    </div>
  );
}
