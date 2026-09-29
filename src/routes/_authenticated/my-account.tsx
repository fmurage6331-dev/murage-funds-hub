import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { defaultPasswordFlagKey, defaultPasswordFlagOptions } from "@/lib/profile-status";
import { DEFAULT_MEMBER_PASSWORD, isSyntheticEmail, phoneFromMetadata } from "@/lib/phoneUtils";
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

/** Same rule as /auth sign-up, so a member can never set a password they could not register with. */
const MIN_PASSWORD_LENGTH = 8;

/** Administrator support line, quoted when a member cannot self-serve. */
const ADMIN_CONTACT = "+254182528510";

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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

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

  /** Drives the "still on the default password" wording here and the banner on every page. */
  const { data: isDefaultPassword } = useQuery(defaultPasswordFlagOptions(user.id));

  // The default-password banner links to /my-account#change-password.
  const hash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    if (hash.replace(/^#/, "") !== "change-password") return;
    document.getElementById("change-password")?.scrollIntoView({ behavior: "smooth" });
    currentPasswordRef.current?.focus({ preventScroll: true });
  }, [hash]);

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

  /**
   * Change the password in place — the only path phone-only members have, since a recovery link
   * would go to an address they never see. Supabase's `updateUser` only proves the session is
   * valid, so the current password is re-checked first: a browser left signed in must not let
   * someone lock the member out of their own account.
   */
  const changePassword = useMutation({
    mutationFn: async ({ current, next }: { current: string; next: string }) => {
      const authEmail = user.email;
      if (!authEmail)
        throw new Error(
          `This account cannot change its password here. Contact admin on ${ADMIN_CONTACT}.`,
        );
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: current,
      });
      if (verifyError) throw new Error("Your current password is incorrect.");

      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError)
        throw new Error(updateError.message || "Unable to change your password. Please retry.");

      // Only a real password change clears profiles.is_default_password (and the banner).
      const { error: flagError } = await supabase
        .from("profiles")
        .update({ is_default_password: false })
        .eq("id", user.id);
      if (flagError) throw new Error(flagError.message);
    },
    onSuccess: () => {
      toast.success("Password changed. Keep your new password somewhere safe.");
      setPasswordError(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Drops the warning banner on this and every other authenticated page immediately.
      void qc.invalidateQueries({ queryKey: defaultPasswordFlagKey(user.id) });
      void qc.invalidateQueries({ queryKey: ["my-account-profile", user.id] });
    },
    onError: (error: Error) => {
      setPasswordError(error.message);
      toast.error(error.message);
    },
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

  // A synthetic @murage.foundation address is an internal Auth identifier: never show it, and
  // never offer a recovery link to it (the member has no mailbox behind it).
  const hasRealEmail = !isSyntheticEmail(profile?.email ?? user.email);
  const accountEmail = hasRealEmail ? (profile?.email ?? user.email ?? "") : "";
  const signInPhone = profile?.phone_number ?? phoneFromMetadata(user.user_metadata) ?? "";
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

  const handlePasswordSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
      );
      return;
    }
    if (newPassword === DEFAULT_MEMBER_PASSWORD) {
      setPasswordError(`Choose a password other than the default ${DEFAULT_MEMBER_PASSWORD}.`);
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Your new password must be different from your current one.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The two new passwords do not match.");
      return;
    }
    changePassword.mutate({ current: currentPassword, next: newPassword });
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
                  {accountEmail || (
                    <span className="font-normal text-muted-foreground">
                      Not on record — you sign in with your phone number
                    </span>
                  )}
                </dd>
              </div>

              {!accountEmail && (
                <div>
                  <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5" /> Sign-in
                  </dt>
                  <dd className="mt-1 font-medium">
                    {signInPhone || "Your phone number"}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      + your password
                    </span>
                  </dd>
                </div>
              )}

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
      <Card id="change-password" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <KeyRound className="h-5 w-5 text-primary" /> Account Security
          </CardTitle>
          <CardDescription>
            {isDefaultPassword ? (
              <>
                You are still using the default password (
                <span className="font-mono">{DEFAULT_MEMBER_PASSWORD}</span>). Choose a new one
                below — it only has to be done once.
              </>
            ) : (
              "Change your password whenever you like. You will need your current password first."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                ref={currentPasswordRef}
                type="password"
                required
                autoComplete="current-password"
                placeholder={isDefaultPassword ? DEFAULT_MEMBER_PASSWORD : undefined}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              {isDefaultPassword && (
                <p className="text-xs text-muted-foreground">
                  Imported members start on{" "}
                  <span className="font-mono">{DEFAULT_MEMBER_PASSWORD}</span>.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Minimum {MIN_PASSWORD_LENGTH} characters, and not the default password.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-new-password">Confirm new password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {passwordError && (
              <p role="alert" className="text-xs text-destructive">
                {passwordError}
              </p>
            )}
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Changing…" : "Change Password"}
            </Button>
          </form>

          {accountEmail ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                Forgot your password? We&apos;ll email {accountEmail} a secure link to choose a new
                one.
              </p>
              <Button
                variant="outline"
                disabled={sendPasswordReset.isPending}
                onClick={() => sendPasswordReset.mutate(accountEmail)}
              >
                {sendPasswordReset.isPending ? "Sending…" : "Email Me a Reset Link"}
              </Button>
              {resetSentTo && (
                <p role="status" className="text-sm text-success">
                  Password reset email sent to {resetSentTo}
                </p>
              )}
            </div>
          ) : (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Forgotten your password? There is no email address on this account, so ask an
              administrator to reset it: you will then sign in with{" "}
              <span className="font-medium text-foreground">
                {signInPhone || "your phone number"}
              </span>{" "}
              and the default password <span className="font-mono">{DEFAULT_MEMBER_PASSWORD}</span>,
              and change it here. Support: {ADMIN_CONTACT}.
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
