import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/hooks/use-roles";

type AdminAction =
  | { action: "approve_member"; userId: string; role: Role }
  | { action: "reject_member"; userId: string; reason?: string }
  | { action: "approve_bot_registration"; registrationId: string }
  | { action: "reject_bot_registration"; registrationId: string; reason: string }
  | {
      action: "create_manual_member";
      fullName: string;
      phoneNumber: string;
      email: string | null;
      role: string;
    };

export async function adminAction(
  body: AdminAction,
): Promise<{ success?: boolean; memberId?: string; warning?: string }> {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) throw new Error("Please sign in again.");
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-actions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      },
    );
    // The function always answers with JSON once it is deployed, but an undeployed or
    // crashing function returns an HTML/text gateway page, so parse defensively and keep
    // the HTTP status — an admin needs to know "not deployed", not just "failed".
    let result: { success?: boolean; memberId?: string; error?: string; warning?: string } = {};
    try {
      result = (await response.json()) as {
        success?: boolean;
        memberId?: string;
        error?: string;
        warning?: string;
      };
    } catch {
      result = {};
    }
    if (!response.ok || result.success !== true)
      throw new Error(
        result.error ??
          (response.ok
            ? "Admin action failed."
            : `Admin action failed (HTTP ${String(response.status)}). Is the admin-actions Edge Function deployed?`),
      );
    // Non-fatal delivery problems (e.g. a password reset email that did not send).
    return { success: true, memberId: result.memberId, warning: result.warning };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Admin action failed. Please retry.");
  }
}
