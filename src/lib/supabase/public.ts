/**
 * public.ts builds a cookie-free Supabase client for anonymous public RPCs.
 * Leaderboards and athlete profiles do not need a user session; avoiding
 * next/headers keeps marketing routes prerenderable and out of Client bundles.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * createSupabasePublicClient returns an anon-key client with no persisted session.
 * Use only for security-definer public RPCs that intentionally bypass per-row RLS.
 */
export function createSupabasePublicClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.",
    );
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      // Revalidate public rankings periodically so marketing pages can stream.
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          next: { revalidate: 30 },
        }),
    },
  });
}
