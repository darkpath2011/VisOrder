/**
 * route.ts finishes GitHub (and other) OAuth after Supabase redirects back here.
 * Flow: local /auth/login/github → Supabase authorize → GitHub → Supabase callback →
 * this route with ?code= → exchangeCodeForSession → redirect to `next` with session cookies.
 * Provider denials often arrive without a code (query or hash); query errors are forwarded
 * so the header can show verification-pending instead of a bare missing_code.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * redirectAuthFailure sends the browser home with structured auth_error query params.
 * Keeps error_code / description when Supabase supplies them so the UI can branch.
 */
function redirectAuthFailure(
  origin: string,
  params: {
    authError: string;
    errorCode?: string | null;
    errorDescription?: string | null;
  },
): NextResponse {
  const failure = new URL("/", origin);
  failure.searchParams.set("auth_error", params.authError);
  if (params.errorCode) {
    failure.searchParams.set("error_code", params.errorCode);
  }
  if (params.errorDescription) {
    failure.searchParams.set("error_description", params.errorDescription);
  }
  return NextResponse.redirect(failure);
}

/**
 * GET exchanges the authorization code for a session and redirects into the app.
 * Session cookies are copied onto the redirect response so the browser keeps them.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const errorCode = requestUrl.searchParams.get("error_code");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const nextPath = requestUrl.searchParams.get("next") ?? "/train";
  const safeNext = nextPath.startsWith("/") ? nextPath : "/train";
  const origin = requestUrl.origin;

  if (!code) {
    // Provider denied or email still unverified — prefer their codes over missing_code.
    if (oauthError || errorCode || errorDescription) {
      return redirectAuthFailure(origin, {
        authError: oauthError || errorCode || "oauth_denied",
        errorCode,
        errorDescription,
      });
    }
    return redirectAuthFailure(origin, { authError: "missing_code" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return redirectAuthFailure(origin, { authError: "missing_env" });
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectAuthFailure(origin, { authError: error.message });
  }

  const response = NextResponse.redirect(new URL(safeNext, origin));
  cookieJar.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
