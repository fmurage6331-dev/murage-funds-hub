import { fetchProfileStatus } from "@/lib/profile-status";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AlertCircle, Leaf } from "lucide-react";
import {
  DEFAULT_MEMBER_PASSWORD,
  isEmailAddress,
  isPhoneNumber,
  resolveSignInEmail,
} from "@/lib/phoneUtils";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

const ADMIN_CONTACT = "+254182528510";
const CONSENT_VERSION = "KDPA-2019-V1.0";
const MIN_PASSWORD_LENGTH = 8;

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Sign in: one field accepts either an email address or a phone number.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  // Sign up
  const [fullName, setFullName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) return;
        const profile = await fetchProfileStatus(data.session.user.id);
        if (active)
          await navigate({
            to: profile.status === "approved" ? "/dashboard" : "/pending-approval",
            replace: true,
          });
      } catch (error) {
        console.error("Session check failed", error);
        if (active) toast.error("Unable to check your session. Please sign in again.");
      }
    };
    void checkSession();
    return () => {
      active = false;
    };
  }, [navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const typed = identifier.trim();
    if (!typed) {
      setAuthError("Enter your email address or phone number.");
      return;
    }
    if (!isEmailAddress(typed) && !isPhoneNumber(typed)) {
      setAuthError("Enter a valid email address or phone number, e.g. 0712345678.");
      return;
    }
    // Members without an email address live in Supabase Auth under a synthetic email
    // built from their phone number, so one password sign-in path serves everyone.
    const signedInWithPhone = !isEmailAddress(typed);
    const signInEmail = resolveSignInEmail(typed);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password,
      });
      if (error) throw error;
      // A missing/unreadable profile is treated as pending: that page keeps polling and
      // forwards the member to /dashboard the moment an admin approves them.
      let status = "pending";
      try {
        const profile = await fetchProfileStatus(data.user.id);
        status = profile.status;
      } catch (profileError) {
        console.error("Unable to read membership status after sign in", profileError);
      }
      toast.success("Welcome back");
      await navigate({
        to: status === "approved" ? "/dashboard" : "/pending-approval",
        replace: true,
      });
    } catch (error) {
      console.error("Sign in failed", error);
      const message = error instanceof Error ? error.message : "";
      // Email verification is disabled; a legacy unconfirmed account needs an admin.
      if (/email not confirmed/i.test(message)) {
        setAuthError(`Please contact admin on ${ADMIN_CONTACT} to activate your account`);
        return;
      }
      if (signedInWithPhone && /invalid login credentials/i.test(message)) {
        setAuthError(
          `No account matches ${typed}. Sign in with the phone number the foundation has on ` +
            `record and the password ${DEFAULT_MEMBER_PASSWORD} (or your own, if you changed it).`,
        );
        return;
      }
      setAuthError(message || "Unable to sign in. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (signUpPassword.length < MIN_PASSWORD_LENGTH) {
      setAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (signUpPassword !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    if (!consentGiven) {
      setAuthError(
        "You must accept the Kenya Data Protection Act (KDPA) consent notice to register.",
      );
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          // No emailRedirectTo: email confirmation is disabled, so signup returns a session
          // straight away and the member waits on /pending-approval for admin approval.
          data: {
            full_name: fullName,
            phone_number: phoneNumber.trim() || null,
            consent_given: true,
            consent_version: CONSENT_VERSION,
          },
        },
      });
      if (error) throw error;
      if (!data.session) {
        // Only possible if confirmation is switched back on in Supabase — there is no session
        // to continue with, so point the member at the admin instead of bouncing them.
        setAuthError(`Please contact admin on ${ADMIN_CONTACT} to activate your account`);
        return;
      }
      toast.success("Account created! Please wait for admin approval.");
      await navigate({ to: "/pending-approval", replace: true });
    } catch (error) {
      console.error("Sign up failed", error);
      setAuthError(
        error instanceof Error ? error.message : "Unable to create account. Please retry.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Leaf className="h-5 w-5" />
          </div>
          <span className="font-serif text-lg font-semibold">Murage Foundation</span>
        </Link>

        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <h1 className="font-serif text-2xl font-semibold">Team access</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage financial records.</p>

          {authError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Unable to continue</AlertTitle>
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="signin" className="mt-6" onValueChange={() => setAuthError(null)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4">
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="signin-identifier">Email or Phone Number</Label>
                  <Input
                    id="signin-identifier"
                    type="text"
                    required
                    autoComplete="username"
                    placeholder="email@example.com or 0712345678"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    No email address? Sign in with the phone number the foundation has on record,
                    e.g. 0712345678 or +254712345678.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in..." : "Sign in"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Approved members sign in with their email address or phone number and password. No
                  email or SMS verification is required. Newly imported members start on the default
                  password <span className="font-mono">{DEFAULT_MEMBER_PASSWORD}</span> and are
                  asked to change it after signing in.
                </p>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4">
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="su-name">Full name</Label>
                  <Input
                    id="su-name"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email">Email</Label>
                  <Input
                    id="su-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-password">Password</Label>
                  <Input
                    id="su-password"
                    type="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum {MIN_PASSWORD_LENGTH} characters.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-confirm-password">Confirm password</Label>
                  <Input
                    id="su-confirm-password"
                    type="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-phone">Phone number (for SMS/WhatsApp updates)</Label>
                  <Input
                    id="su-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="e.g. 0712345678"
                    autoComplete="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Optional</p>
                </div>
                <div className="flex items-start space-x-2 pt-2">
                  <Checkbox
                    id="kdpa-consent"
                    checked={consentGiven}
                    onCheckedChange={(c) => setConsentGiven(c === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="kdpa-consent"
                    className="text-xs leading-normal font-normal text-muted-foreground cursor-pointer"
                  >
                    I agree to the collection and processing of my personal data by Murage
                    Foundation in compliance with the{" "}
                    <strong className="text-foreground font-medium">
                      Kenya Data Protection Act (2019)
                    </strong>{" "}
                    for membership verification, financial accounting, and loan governance.
                  </Label>
                </div>
                <Button type="submit" className="w-full" disabled={loading || !consentGiven}>
                  {loading ? "Creating..." : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  No email verification needed. An administrator reviews new accounts and approval
                  usually takes less than 24 hours. Need help? Contact {ADMIN_CONTACT}.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
