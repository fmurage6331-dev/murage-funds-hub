import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
  User as UserIcon,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoles } from "@/hooks/use-roles";
import { downloadCsv } from "@/lib/csv-import";
import {
  ALL_STATEMENT_SECTIONS,
  buildMemberStatementCsv,
  buildMemberStatementHtml,
  openPrintWindow,
  resolvePeriod,
  statementFileName,
} from "@/lib/export-documents";
import { loadMemberStatementData } from "@/lib/financial-data";

/** Shared cache key for the member's own statement data. */
const MY_STATEMENT_KEY = "my-statement";

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
  const [statementBusy, setStatementBusy] = useState<"pdf" | "csv" | null>(null);

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

  /** Shared cache key for the member's own statement data. */
  const MY_STATEMENT_KEY = "my-statement";

  /** Keep the member's own statement records warm so the download buttons can open the print window immediately. */
  const { data: statementData } = useQuery({
    queryKey: [MY_STATEMENT_KEY, user.id],
    queryFn: () => loadMemberStatementData(user.id),
    staleTime: 60_000,
  });

  const generateStatement = async (format: "pdf" | "csv") => {
    setStatementBusy(format);
    try {
      const data = statementData ?? (await loadMemberStatementData(user.id));

      // Members download their own complete record: all time, every section.
      const options = {
        period: resolvePeriod({ key: "all" }),
        sections: ALL_STATEMENT_SECTIONS,
        generatedBy: data.profile?.full_name ?? profile?.full_name ?? "Member",
      };

      if (format === "pdf") {
        const opened = openPrintWindow(
          "Murage Foundation - Member Financial Statement",
          buildMemberStatementHtml(data, options),
          "portrait",
        );
        if (!opened) {
          toast.error("Allow pop-ups for this site to open your statement.");
          return;
        }
        toast.success("Your statement is ready — print or save it as PDF.");
        return;
      }

      downloadCsv(
        statementFileName(data.profile?.full_name ?? profile?.full_name),
        buildMemberStatementCsv(data, options),
      );
      toast.success("Your statement has been downloaded (opens in Excel).");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate your statement.");
    } finally {
      setStatementBusy(null);
    }
  };

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

      {/* ── Section 4 · Download own financial statement ────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <Download className="h-5 w-5 text-primary" /> My Financial Statement
          </CardTitle>
          <CardDescription>
            Download your complete contribution history, loan summary, repayment schedule and
            account standing — no need to ask the treasurer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            onClick={() => void generateStatement("pdf")}
            disabled={statementBusy !== null}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {statementBusy === "pdf" ? "Preparing…" : "Download My Statement (PDF)"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void generateStatement("csv")}
            disabled={statementBusy !== null}
            className="gap-2 border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {statementBusy === "csv" ? "Preparing…" : "Download as Excel"}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Statement covers all time and is generated by your browser — the PDF opens the system
            print dialog (choose "Save as PDF").
          </p>
        </CardContent>
      </Card>

      {/* ── Section 5 · About This App ─────────────────────────────── */}
      <Card className="border border-dashed border-dashed border-gold/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <Info className="h-5 w-5 text-primary" /> About This App
          </CardTitle>
          <CardDescription>Version, developer credit, and platform details.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">App Name</dt>
              <dd className="font-medium text-right">Murage Foundation — Funds Hub</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium text-right">1.0.0</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Developed by</dt>
              <dd className="font-medium text-right">Francis Murage Muhoro</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Copyright</dt>
              <dd className="font-medium text-right">
                © {new Date().getFullYear()} Murage Foundation. All rights reserved.
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Platform</dt>
              <dd className="font-medium text-right">Web + PWA</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="font-medium text-right">+254182528510</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
