import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../../../src/integrations/supabase/types.ts";

type Role = Database["public"]["Enums"]["app_role"];
type AdminDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      complete_admin_approval: {
        Args: {
          target_id: string;
          assigned_role: Role;
          registration_id?: string;
          actor_id?: string;
        };
        Returns: undefined;
      };
    };
  };
};
const roles: Role[] = [
  "admin",
  "chairman",
  "treasurer",
  "secretary",
  "assistant_secretary",
  "board_member",
  "member",
];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: { success: true } | { error: string }, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return json({ error: "Authentication required" }, 401);
    const db = createClient<AdminDatabase>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid or expired session" }, 401);
    const { data: admin, error: roleError } = await db
      .from("user_roles")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) throw roleError;
    if (!admin) return json({ error: "Administrator access required" }, 403);
    let body: Record<string, unknown>;
    try {
      const value: unknown = await req.json();
      if (!value || typeof value !== "object" || Array.isArray(value))
        return json({ error: "Invalid JSON body" }, 400);
      body = value as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (body.action === "approve_member" || body.action === "reject_member") {
      if (!uuid(body.userId)) return json({ error: "Valid userId required" }, 400);
      if (
        body.reason !== undefined &&
        (typeof body.reason !== "string" || body.reason.length > 2000)
      )
        return json({ error: "Invalid reason" }, 400);
      if (body.action === "reject_member") {
        const { data, error } = await db
          .from("profiles")
          .update({ status: "rejected" })
          .eq("id", body.userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "Member not found" }, 404);
      } else {
        const role = body.role ?? "member";
        if (!roles.includes(role as Role)) return json({ error: "Invalid role" }, 400);
        const { error } = await db.rpc("complete_admin_approval", {
          target_id: body.userId,
          assigned_role: role as Role,
        });
        if (error) throw error;
      }
    } else if (body.action === "approve_bot_registration") {
      if (!uuid(body.registrationId)) return json({ error: "Valid registrationId required" }, 400);
      // Never trust client-supplied phone, email, role or adminUserId.
      const { data: reg, error } = await db
        .from("pending_registrations")
        .select("*")
        .eq("id", body.registrationId)
        .maybeSingle();
      if (error) throw error;
      if (!reg) return json({ error: "Registration not found" }, 404);
      if (reg.status === "approved") return json({ success: true });
      if (reg.status !== "pending") return json({ error: "Registration is not pending" }, 409);
      if (!roles.includes(reg.requested_role))
        return json({ error: "Invalid requested role" }, 400);
      // Both profiles and user_roles reference auth.users, including phone-only members.
      const metadata = { full_name: reg.full_name, phone_number: reg.phone_number };
      const created = reg.email
        ? await db.auth.admin.inviteUserByEmail(reg.email, { data: metadata })
        : await db.auth.admin.createUser({
            phone: reg.phone_number,
            phone_confirm: false,
            user_metadata: metadata,
          });
      if (created.error) return json({ error: created.error.message }, 409);
      const memberId = created.data.user.id;
      try {
        const { error: profileError } = await db.from("profiles").upsert({
          id: memberId,
          full_name: reg.full_name,
          email: reg.email,
          phone_number: reg.phone_number,
          phone_only_member: !reg.email,
        });
        if (profileError) throw profileError;
        const { error: approvalError } = await db.rpc("complete_admin_approval", {
          target_id: memberId,
          assigned_role: reg.requested_role,
          registration_id: reg.id,
          actor_id: auth.user.id,
        });
        if (approvalError) throw approvalError;
      } catch (error) {
        // Do not leave an orphaned Auth identity blocking a later retry.
        const { error: cleanupError } = await db.auth.admin.deleteUser(memberId);
        if (cleanupError) console.error("Approval cleanup failed", cleanupError);
        throw error;
      }
    } else if (body.action === "reject_bot_registration") {
      if (!uuid(body.registrationId)) return json({ error: "Valid registrationId required" }, 400);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason || reason.length > 2000)
        return json({ error: "A reason of 1-2000 characters is required" }, 400);
      // Never trust client-supplied identity or actor: re-read the persisted registration.
      const { data: reg, error } = await db
        .from("pending_registrations")
        .select("id, status")
        .eq("id", body.registrationId)
        .maybeSingle();
      if (error) throw error;
      if (!reg) return json({ error: "Registration not found" }, 404);
      if (reg.status === "rejected") return json({ success: true });
      if (reg.status !== "pending") return json({ error: "Registration is not pending" }, 409);
      const { data: rejected, error: rejectError } = await db
        .from("pending_registrations")
        .update({
          status: "rejected",
          admin_notes: reason,
          approved_by: auth.user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", body.registrationId)
        .select("id")
        .maybeSingle();
      if (rejectError) throw rejectError;
      if (!rejected) return json({ error: "Registration not found" }, 404);
    } else {
      return json({ error: "Unknown action" }, 400);
    }
    return json({ success: true });
  } catch (error) {
    console.error("Admin action failed", error);
    return json(
      { error: "Unable to complete admin action. Please retry or contact support." },
      500,
    );
  }
});
