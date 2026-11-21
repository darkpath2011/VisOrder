/**
 * client.ts builds the browser Supabase client from public env vars.
 * Only the anon/publishable key is used here so RLS still gates every table
 * access; the service-role secret must never enter this module or any client bundle.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * readPublicSupabaseEnv returns the URL and anon key required by browser calls.
 * Throws when either value is missing so misconfigured deploys fail fast at use time.
 */
function readPublicSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.",
    );
  }
  return { url, anonKey };
}

/**
 * createSupabaseBrowserClient returns a cookie-aware client for Client Components.
 * Call per request or render; @supabase/ssr reuses the underlying instance safely.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey } = readPublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
