import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Mail, Phone, ShieldCheck, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/my-account")({
  component: MyAccountPage,
});

const PHONE_PATTERN = /^[+\d][\d\s-]{6,19}$/;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function MyAccountPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const r = useRoles(user.id);

  const [newPhone, setNewPhone] = useState("");
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-account-profile", user.id],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;
        return data;
      } catch (error) {
        console.error("Failed to load your profile", error);
        toast.error("Could not load your profile details.");
        return null;
      }
    },
  });

  const updatePhone = useMutation({
    mutationFn: async (phone: string) => {
      const { error } = await supabase
        .from("profiles")
        .update({ phone_number: phone })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Phone number updated!");
      setNewPhone("");
      void qc.invalidateQueries({ queryKey: ["my-account-profile", user.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendPasswordReset = useMutation({
    mutationFn: async (email: string) => {
      const redirectTo =
        typeof window === "undefined" ? undefined : `${window.location.origin}/auth`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },
    onSuccess: (_result, email) => {
      setResetSentTo(email);
      toast.success(`Password reset email sent to ${email}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const accountEmail = profile?.email ?? user.email ?? "";
  const currentPhone = profile?.phone_number ?? "";
  const trimmedPhone = newPhone.trim();
  const phoneInvalid = trimmedPhone.length > 0 && !PHONE_PATTERN.test(trimmedPhone);

  const handlePhoneSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedPhone) {
      toast.error("Enter a phone number to save.");
      return;
    }
    if (!PHONE_PATTERN.test(trimmedPhone)) {
      toast.error("Enter a valid phone number, e.g. 0712345678.");
      return;
    }
    updatePhone.mutate(trimmedPhone);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">My Account</h2>
        <p className="text-sm text-muted-foreground">
          Your own membership record, contact number and sign-in security.
        </p>
      </div>

      {/* ── Section 1 · Profile details (read only) ─────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <UserIcon className="h-5 w-5 text-primary" /> Profile Details
          </CardTitle>
          <CardDescription>Managed by the foundation secretariat.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading your profile…</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Full Name
                </dt>
                <dd className="mt-1 font-medium">{profile?.full_name ?? "—"}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Email</dt>
                <dd className="mt-1 flex items-center gap-2 font-medium">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {accountEmail || "—"}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Member Since
                </dt>
                <dd className="mt-1 font-medium">{formatDate(profile?.created_at)}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Status</dt>
                <dd className="mt-1">
                  <Badge
                    className={
                      profile?.status === "approved"
                        ? "bg-success text-success-foreground"
                        : "bg-gold/20 text-gold"
                    }
                  >
                    {profile?.status ?? "unknown"}
                  </Badge>
                </dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Role{r.roles.length === 1 ? "" : "s"}
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {r.isLoading ? (
                    <span className="text-sm text-muted-foreground">Loading roles…</span>
                  ) : r.roles.length === 0 ? (
                    <Badge variant="secondary">Member</Badge>
                  ) : (
                    r.roles.map((role) => (
                      <Badge key={role} variant="outline" className="capitalize">
                        {role.replace(/_/g, " ")}
                      </Badge>
                    ))
                  )}
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" /> KDPA Consent
                </dt>
                <dd className="mt-1">
                  <Badge
                    variant={profile?.consent_given ? "default" : "secondary"}
                    className={profile?.consent_given ? "bg-success text-success-foreground" : ""}
                  >
                    {profile?.consent_given ? "Yes" : "No"}
                  </Badge>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {formatDateTime(profile?.consent_timestamp)}
                  </span>
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  Data Retention Until
                </dt>
                <dd className="mt-1 font-medium">{formatDate(profile?.data_retention_until)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* ── Section 2 · Update phone number ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <Phone className="h-5 w-5 text-primary" /> Update Phone Number
          </CardTitle>
          <CardDescription>
            Current number:{" "}
            <span className="font-medium text-foreground">{currentPhone || "not set"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePhoneSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="my-account-phone">New phone number</Label>
              <Input
                id="my-account-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="e.g. 0712345678"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                aria-invalid={phoneInvalid}
              />
              <p className="text-xs text-muted-foreground">Used for WhatsApp/SMS updates</p>
              {phoneInvalid && (
                <p role="alert" className="text-xs text-destructive">
                  Enter a valid phone number, e.g. 0712345678.
                </p>
              )}
            </div>
            <Button type="submit" disabled={updatePhone.isPending || !trimmedPhone || phoneInvalid}>
              {updatePhone.isPending ? "Saving…" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Section 3 · Account security ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <KeyRound className="h-5 w-5 text-primary" /> Account Security
          </CardTitle>
          <CardDescription>
            We&apos;ll email {accountEmail || "your registered address"} a secure link to choose a
            new password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            disabled={sendPasswordReset.isPending || !accountEmail}
            onClick={() => sendPasswordReset.mutate(accountEmail)}
          >
            {sendPasswordReset.isPending ? "Sending…" : "Change Password"}
          </Button>
          {resetSentTo && (
            <p role="status" className="text-sm text-success">
              Password reset email sent to {resetSentTo}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
