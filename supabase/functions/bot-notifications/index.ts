import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { adminClient, dbResult } from "../_shared/db.ts";
import {
  notifyContributionConfirmed,
  notifyLoanDecision,
  notifyMeetingScheduled,
} from "../_shared/notifications.ts";
import type { Database } from "../../../src/integrations/supabase/types.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

type Event = "contribution_confirmed" | "loan_decided" | "meeting_scheduled";
type DeliveryRequest = { event: Event; recordId: string };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(
  body: { success: boolean; sent?: number; failed?: number; error?: string },
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function parseRequest(input: unknown): DeliveryRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("Invalid event");
  const data: Record<string, unknown> = input as Record<string, unknown>;
  if (
    data.event !== "contribution_confirmed" &&
    data.event !== "loan_decided" &&
    data.event !== "meeting_scheduled"
  ) {
    throw new Error("Unsupported notification event");
  }
  if (typeof data.recordId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.recordId)) {
    throw new Error("Invalid record ID");
  }
  return { event: data.event, recordId: data.recordId };
}

async function authorize(request: Request, event: Event): Promise<void> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!token || !url || !anonKey) throw new Error("Unauthorized");
  const auth = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await auth.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const profile = await dbResult(
    "notification actor",
    adminClient().from("profiles").select("status,is_anonymized").eq("id", user.id).single(),
  );
  if (profile?.status !== "approved" || profile.is_anonymized) throw new Error("Unauthorized");
  const allowedRoles: Database["public"]["Enums"]["app_role"][] =
    event === "contribution_confirmed"
      ? ["admin", "treasurer"]
      : event === "loan_decided"
        ? ["admin", "treasurer", "chairman", "board_member"]
        : ["admin", "secretary", "assistant_secretary"];
  const roles = await dbResult(
    "notification role",
    adminClient()
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .in("role", allowedRoles)
      .limit(1),
  );
  if (!roles?.length) throw new Error("Officer access required");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return reply({ success: true });
  if (request.method !== "POST") return reply({ success: false, error: "Method not allowed" }, 405);
  try {
    const action = parseRequest(await request.json());
    await authorize(request, action.event);
    if (action.event === "contribution_confirmed") {
      const sent = await notifyContributionConfirmed(action.recordId);
      return reply({ success: true, sent: Number(sent), failed: 0 });
    }
    if (action.event === "loan_decided") {
      const sent = await notifyLoanDecision(action.recordId);
      return reply({ success: true, sent: Number(sent), failed: 0 });
    }
    const { sent, failed } = await notifyMeetingScheduled(action.recordId);
    return reply({ success: true, sent, failed });
  } catch (error) {
    console.error("[bot-notifications] delivery request failed", error);
    const message = error instanceof Error ? error.message : "Delivery failed";
    return reply(
      { success: false, error: message },
      message === "Unauthorized" || message === "Officer access required" ? 403 : 400,
    );
  }
});
