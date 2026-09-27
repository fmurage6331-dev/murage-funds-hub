import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/hooks/use-roles";

type AdminAction =
  | { action: "approve_member"; userId: string; role: Role }
  | { action: "reject_member"; userId: string; reason?: string }
  | { action: "approve_bot_registration"; registrationId: string }
  | { action: "reject_bot_registration"; registrationId: string; reason: string };

export async function adminAction(body: AdminAction): Promise<void> {
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
    const result: { success?: boolean; error?: string } = await response.json();
    if (!response.ok || result.success !== true)
      throw new Error(result.error || "Admin action failed.");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Admin action failed. Please retry.");
  }
}
