/**
 * proxy.ts runs updateSession on app navigations so Auth cookies stay fresh.
 * Static assets and Next internals are excluded to avoid unnecessary Supabase calls.
 * Renamed from the deprecated middleware file convention (Next.js 16+).
 */

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * proxy delegates every matched request to the Supabase session refresher.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and image optimization.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
