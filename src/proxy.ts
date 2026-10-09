import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { websiteRewrite } from "@/lib/website";

export async function proxy(request: NextRequest) {
  // jslandscapingmd.com is the website, not the app: its home page is the
  // site the owner publishes from Marketing › Website. Its buttons go to
  // /book, /mow and /salt, which are public and served as they are.
  const site = websiteRewrite(request.headers.get("host"), request.nextUrl.pathname);
  if (site) return NextResponse.rewrite(new URL(site, request.url));
  return updateSession(request);
}

export const config = {
  matcher: [
    // The service worker and the manifest are fetched signed out too (a
    // client on their pre-eval link, a subcontractor on theirs), so never
    // sent to the login page.
    "/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
