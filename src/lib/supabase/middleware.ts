import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, isSupabaseConfigured } from "@/lib/env";
import { decideAccess } from "@/lib/supabase/auth-guard";

import type { Database } from "./database.types";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) {
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

  const isPublicPath =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/book") ||
    request.nextUrl.pathname.startsWith("/proposal");

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
    isPublicPath,
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
