import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { defaultPasswordFlagOptions } from "@/lib/profile-status";
import { DEFAULT_MEMBER_PASSWORD } from "@/lib/phoneUtils";
import { useQuery } from "@tanstack/react-query";

/**
 * Dismissal key. Dismissing only hides the banner for this browser session — the underlying
 * `profiles.is_default_password` flag is cleared by a real password change and nothing else.
 */
const DISMISS_KEY = "default-password-banner-dismissed";

/**
 * Warning shown on every authenticated page while a member is still on the issued default
 * password (12345678). Imported and admin-created members start on it, so this is the prompt that
 * moves them onto a password only they know.
 */
export function DefaultPasswordBanner({ userId }: { userId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const { data: isDefaultPassword } = useQuery(defaultPasswordFlagOptions(userId));

  // Read the session flag in an effect so server rendering never touches sessionStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(DISMISS_KEY) === "true") setDismissed(true);
  }, []);

  if (!isDefaultPassword || dismissed) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") window.sessionStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          You are using the default password ({DEFAULT_MEMBER_PASSWORD}). Please change your
          password for security.
        </p>
        <p className="mt-0.5 text-xs text-amber-800">
          Anyone who knows the default password could open your account. Changing it takes a moment
          and only has to be done once.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" className="bg-amber-600 text-white hover:bg-amber-700">
          <Link to="/my-account" hash="change-password">
            Change Password Now
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-amber-800 hover:bg-amber-100 hover:text-amber-900"
          onClick={dismiss}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
