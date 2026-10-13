import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { allOrganizationIds } from "@/lib/data/ops-settings";
import { runAutoPlacement } from "@/lib/data/ops-auto-place";

/**
 * Auto-placement: ready jobs onto the calendar, with the client told.
 *
 * Hourly is plenty: a job sold at ten is on the calendar by eleven. Only
 * jobs sold after the switch went live, at most the daily cap, never sooner
 * than the notice period; conflicts are held for a person.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "ops-auto-place");
  if (refused) return refused;

  const now = new Date();
  const results: Record<string, unknown>[] = [];
  for (const organizationId of await allOrganizationIds()) {
    try {
      results.push({ organizationId, ...(await runAutoPlacement(organizationId, now)) });
    } catch (err) {
      log.error("ops.auto_place_run_failed", err, { organizationId });
    }
  }
  return NextResponse.json({ at: now.toISOString(), results });
}
