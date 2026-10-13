import { NextResponse, type NextRequest } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { loadAutopilot } from "@/lib/data/marketing-autopilot";
import { runWeeklyRank } from "@/lib/data/rank-run";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The rank tracker's weekly check: seeds any missing town × service phrase,
 * then, when the weekly check is on and a Places key is saved, runs a small
 * grid for the phrases checked longest ago. Without a key it says so and
 * checks nothing. Wants weekly (e.g. Mondays 12:00 UTC); running it more
 * often costs nothing, as a phrase checked in the last six days is skipped.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "rank-check");
  if (refused) return refused;

  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id");
  const runs: Record<string, unknown>[] = [];
  for (const { id } of orgs ?? []) {
    try {
      const { settings } = await loadAutopilot(admin, id);
      runs.push({ organizationId: id, ...(await runWeeklyRank(admin, id, settings)) });
    } catch (err) {
      log.error("cron.rank_check", err, { org: id });
      runs.push({ organizationId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, runs });
}
