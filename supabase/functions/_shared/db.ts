import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../../src/integrations/supabase/types.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

function serviceFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    // Supabase's new opaque API keys are not bearer JWTs.
    if (key.startsWith("sb_secret_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase URL and service role key are required");

  return createClient<Database>(url, key, {
    global: { fetch: serviceFetch(key) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// PostgREST returns failures in `error` rather than rejecting its promise.
// All database calls go through this handler so errors are logged at the Edge.
export async function dbResult<T>(
  operation: string,
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  try {
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data;
  } catch (error) {
    console.error(`[bot database] ${operation}`, error);
    throw error;
  }
}
