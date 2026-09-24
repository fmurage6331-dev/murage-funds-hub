import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/set-password")({ ssr: false, component: SetPasswordPage });

function SetPasswordPage() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(!!session);
      setChecking(false);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("[set-password] Could not read session:", error);
      setAuthenticated(!!data.session);
      setChecking(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 12 || password !== confirmation) {
      toast.error("Choose at least 12 characters and make sure both passwords match.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password set. Welcome to Murage Foundation!");
      navigate({ to: "/my-contributions", replace: true });
    } catch (error) {
      console.error("[set-password] Could not save password:", error);
      toast.error(error instanceof Error ? error.message : "Could not set your password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Set your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {checking ? (
            <p className="text-sm text-muted-foreground">Opening your invitation…</p>
          ) : !authenticated ? (
            <p className="text-sm text-muted-foreground">
              Open the invitation link in your WhatsApp or SMS message to continue. The link may
              have expired; ask the admin at +254182528510 for a new one.{" "}
              <Link to="/auth" className="text-primary underline">
                Sign in
              </Link>
            </p>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password (12 characters minimum)</Label>
                <Input
                  id="new-password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving…" : "Set password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
