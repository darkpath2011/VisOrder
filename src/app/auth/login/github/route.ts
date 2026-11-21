/**
 * route.ts starts GitHub OAuth from the Next.js server so the PKCE code verifier
 * is written onto the redirect response as a Set-Cookie header. A browser-only
 * signInWithOAuth call can lose that cookie; without it, /auth/callback cannot
 * exchange the returned code for a session.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * GET builds a server Supabase client, requests a GitHub OAuth URL, and 303-redirects
 * there while attaching any auth cookies Supabase needs for the later code exchange.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const nextPath = requestUrl.searchParams.get("next") ?? "/train";
  const safeNext = nextPath.startsWith("/") ? nextPath : "/train";
  const redirectTo = `${requestUrl.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.redirect(new URL("/?auth_error=missing_env", requestUrl.origin));
  }

  const cookieJar: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieJar.push({ name, value, options });
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo,
      scopes: "read:user user:email",
    },
  });

  if (error || !data.url) {
    const failure = new URL("/", requestUrl.origin);
    failure.searchParams.set(
      "auth_error",
      error?.message ?? "github_oauth_unavailable",
    );
    return NextResponse.redirect(failure);
  }

  // 303 keeps the browser on a GET to GitHub/Supabase after storing the verifier cookie.
  const response = NextResponse.redirect(data.url, { status: 303 });
  cookieJar.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
