import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { organizationsWithWeatherOps, runWeatherCascade } from "@/lib/data/weather-cascade";
import { suggestSnowFromForecast } from "@/lib/data/snow-ops";

/**
 * Every three hours: read the forecast for the crews' next few days and move
 * the days the weather breaks, the whole chain with them; and look for a
 * storm worth starting a snow event for.
 *
 * Every three hours rather than once a day because a forecast at 6am and one
 * at 9pm the night before can disagree about tomorrow, and the client should
 * hear the evening before rather than when the truck does not turn up. Each
 * run is idempotent: a move already made is not made again, a proposal
 * already raised is not raised again, and a client already told is not told
 * twice.
 *
 * Only businesses that have switched one of these on are read.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "weather-cascade");
  if (refused) return refused;

  const now = new Date();
  const orgs = await organizationsWithWeatherOps();
  const results: unknown[] = [];
  for (const org of orgs) {
    const entry: Record<string, unknown> = { organizationId: org.organizationId };
    if (org.cascade) {
      entry.cascade = await runWeatherCascade(org.organizationId, now).catch((err) => {
        log.error("weather_cascade.failed", err, { organizationId: org.organizationId });
        return { error: err instanceof Error ? err.message : String(err) };
      });
    }
    if (org.snow) {
      entry.snow = await suggestSnowFromForecast(org.organizationId, now).catch((err) => {
        log.error("snow_suggest.failed", err, { organizationId: org.organizationId });
        return { error: err instanceof Error ? err.message : String(err) };
      });
    }
    results.push(entry);
  }
  return NextResponse.json({ ran: now.toISOString(), organizations: results });
}
