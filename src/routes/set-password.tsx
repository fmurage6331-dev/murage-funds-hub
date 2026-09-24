import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Leaf } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/set-password")({ ssr: false, component: SetPasswordPage });

function SetPasswordPage() {
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) {
        setHasSession(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.error("[set-password] session verification failed", error);
      setHasSession(Boolean(data.session));
      setChecking(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function setNewPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password set. Welcome to Murage Foundation!");
    navigate({ to: "/my-contributions", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md space-y-5 p-8">
        <div className="flex items-center gap-2 text-primary">
          <Leaf className="h-5 w-5" />
          <span className="font-serif text-lg font-semibold">Murage Foundation</span>
        </div>
        <div>
          <h1 className="font-serif text-2xl font-semibold">Set your password</h1>
          <p className="text-sm text-muted-foreground">
            Use the one-time link sent to your phone to activate your web account.
          </p>
        </div>
        {checking ? (
          <p className="text-sm">Checking your link…</p>
        ) : !hasSession ? (
          <div className="space-y-3 text-sm">
            <p className="text-destructive">
              This link is invalid or expired. Please ask an administrator to resend your welcome
              message.
            </p>
            <Link to="/auth" className="text-primary underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={setNewPassword} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Saving…" : "Save password"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
