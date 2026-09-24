import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.110.2";
import type { Database } from "../../../src/integrations/supabase/types.ts";

type ServiceClient = SupabaseClient<Database>;
let serviceClient: ServiceClient | undefined;

export function getServiceClient(): ServiceClient {
  if (serviceClient) return serviceClient;

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase Edge Function secrets");

  // Supabase's new sb_secret_ keys are opaque, not JWTs. Never send them as a
  // Bearer token; PostgREST still needs the apikey header (see client.server.ts).
  const serviceFetch: typeof fetch = (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (key.startsWith("sb_secret_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };

  serviceClient = createClient<Database>(url, key, {
    global: { fetch: serviceFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

export async function requireOfficer(
  req: Request,
  roles: Array<
    "admin" | "chairman" | "treasurer" | "secretary" | "assistant_secretary" | "board_member"
  >,
): Promise<string> {
  const match = /^Bearer (\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new Error("Sign in to perform this action");

  try {
    // getUser(token) checks the session with Supabase Auth. Never accept a
    // caller-supplied user ID or a decoded but unverified JWT for authorization.
    const client = getServiceClient();
    const { data: auth, error: authError } = await client.auth.getUser(match[1]);
    if (authError || !auth.user) throw new Error("Invalid session");

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("status, is_anonymized")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.status !== "approved" || profile.is_anonymized) {
      throw new Error("Account is not approved");
    }

    const { data: grants, error: roleError } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id)
      .in("role", roles);
    if (roleError) throw roleError;
    if (!grants?.length) throw new Error("Officer access required");
    return auth.user.id;
  } catch (error) {
    console.error("[bot authorization] Failed to verify officer:", error);
    throw error;
  }
}

export { corsHeaders, jsonResponse } from "./http.ts";
