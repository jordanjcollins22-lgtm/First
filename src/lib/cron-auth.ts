import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Whether a scheduled route may run.
 *
 * Vercel sends CRON_SECRET as a bearer token on every scheduled call. The
 * routes used to check it only when it was set, which meant a deployment
 * without the variable ran its crons for anybody who knew the address, and
 * these crons text and email clients. Now a missing secret shuts the route
 * in production rather than opening it. Locally, with no secret, it still
 * runs, because that is how it is tried out.
 *
 * Returns the response to send back when the caller is refused, or null
 * when it may go ahead.
 */
export function authorizeCron(request: NextRequest, route: string): NextResponse | null {
  const secret = env.cronSecret;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      log.error("cron.unconfigured", undefined, { route });
      return NextResponse.json({ error: "CRON_SECRET is not set, so scheduled routes are closed." }, { status: 503 });
    }
    return null;
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    log.warn("cron.unauthorized", { route });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Like authorizeCron, but also lets the database's own timer in.
 *
 * Vercel's crons run once a day on this plan, which is too slow for reminders
 * and alerts. pg_cron calls these routes instead, every few minutes, with a
 * token it was given when the schedule was made. Only the token's SHA-256
 * lives in scheduler_tokens (no policies: service role only), so the token
 * itself never leaves the database's cron table.
 */
export async function authorizeScheduledCall(request: NextRequest, route: string): Promise<NextResponse | null> {
  const token = request.headers.get("x-scheduler-token");
  if (!token) return authorizeCron(request, route);

  const { createHash, timingSafeEqual } = await import("node:crypto");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const hash = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const { data } = await (createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient)
    .from("scheduler_tokens")
    .select("token_hash");
  const ok = (data ?? []).some((row: { token_hash: string }) => {
    const saved = Buffer.from(row.token_hash);
    return saved.length === hash.length && timingSafeEqual(saved, hash);
  });
  if (ok) return null;
  log.warn("cron.bad_scheduler_token", { route });
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
