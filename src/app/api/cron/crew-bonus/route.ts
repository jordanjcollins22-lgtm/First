import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { allOrganizationIds } from "@/lib/data/ops-settings";
import { runWeeklyBonus } from "@/lib/data/ops-bonus";

/**
 * Settles last week's crew bonus, once a week (Monday morning). Off unless a
 * business switched the bonus on; re-running rewrites only rows nobody has
 * approved or paid yet.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "crew-bonus");
  if (refused) return refused;

  const now = new Date();
  const results: Record<string, unknown>[] = [];
  for (const organizationId of await allOrganizationIds()) {
    try {
      results.push({ organizationId, ...(await runWeeklyBonus(organizationId, now)) });
    } catch (err) {
      log.error("ops.crew_bonus_failed", err, { organizationId });
    }
  }
  return NextResponse.json({ at: now.toISOString(), results });
}
