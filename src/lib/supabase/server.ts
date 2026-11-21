/**
 * server.ts builds a cookie-bound Supabase client for Server Components and route
 * handlers. Session cookies are read and written through Next.js `cookies()` so
 * Auth state stays aligned between SSR and the browser without exposing the
 * service-role key.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * createSupabaseServerClient returns a request-scoped client using the anon key.
 * Await this inside server code only; it depends on Next.js async cookie storage.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components may not allow writes; swallow so reads still work.
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignored when the caller is a read-only Server Component render.
        }
      },
    },
  });
}
