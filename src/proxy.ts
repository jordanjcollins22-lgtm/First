import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
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
