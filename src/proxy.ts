import { NextResponse, type NextRequest } from "next/server";

import { GOVCON_AUTH_COOKIE, isGovconAuthorized } from "@/lib/govcon/auth";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/govcon") && pathname !== "/govcon/login") {
    if (!isGovconAuthorized(request.cookies.get(GOVCON_AUTH_COOKIE)?.value)) {
      const url = new URL("/govcon/login", request.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
