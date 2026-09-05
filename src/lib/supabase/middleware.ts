import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, isSupabaseConfigured } from "@/lib/env";
import { decideAccess } from "@/lib/supabase/auth-guard";

import type { Database } from "./database.types";

/**
 * The paths somebody with no account is meant to reach.
 *
 * Each is a page we send to a customer: a booking form, a proposal, a flyer
 * spot for sale. They live outside the (app) route group and have their own
 * root layout, which is the tell.
 *
 * Kept as a list rather than four conditions because adding a public page
 * means remembering two separate places, and the flyer page proved how that
 * ends: we texted local businesses a link that took them straight to a staff
 * sign-in screen.
 */
export const PUBLIC_PREFIXES = ["/login", "/book", "/proposal", "/flyer"] as const;

export function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Whether this request needs us to ask the auth server anything.
 *
 * On a public path the answer changes nothing — decideAccess allows it
 * whoever is asking — so the call was a network round trip to Supabase on
 * every load of a page we hand to customers. The booking page is prerendered
 * and served from the CDN, and then waited on an auth check for a form that
 * has no account behind it.
 *
 * The cost of skipping it is that a session is not refreshed on these
 * requests. That is nothing in practice: a staff member reaches every one of
 * these pages from inside the app, and any page that needs the session
 * refreshes it.
 */
export function needsAuthCheck(pathname: string): boolean {
  return !isPublic(pathname);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) {
    return response;
  }

  // Nothing to ask, so nobody is asked. Checked before the client is built,
  // because building it is most of the cost.
  if (!needsAuthCheck(request.nextUrl.pathname)) {
    return response;
  }

  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() calls Supabase's auth server, so it can fail for reasons that
  // have nothing to do with the session — a cold start, a dead spot, a blip at
  // the other end. The error is kept rather than discarded so a failure to ask
  // is never mistaken for an answer.
  let user: unknown = null;
  let error: { status?: number; name?: string; message?: string } | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    error = result.error ?? null;
  } catch (thrown) {
    error = {
      name: thrown instanceof Error ? thrown.name : "Error",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }

  const decision = decideAccess({
    // Public paths returned above, so anything reaching here is guarded.
    isPublicPath: false,
    cookieNames: request.cookies.getAll().map((c) => c.name),
    user,
    error,
  });

  if (decision === "redirect_to_login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
