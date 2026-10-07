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
