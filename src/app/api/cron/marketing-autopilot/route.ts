import { NextResponse, type NextRequest } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { loadAutopilot } from "@/lib/data/marketing-autopilot";
import { runPlayAutopilot } from "@/lib/data/marketing-plays-run";
import { runSeasonal } from "@/lib/data/seasonal-run";
import { runSocialAutopilot } from "@/lib/data/social-autopost-run";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The marketing autopilot's frequent pass, for every business:
 *
 * - plays: approve the ones that look like what is approved, close the ones
 *   walked or finished, expire the forgotten ones, cost each as it closes;
 * - social: schedule posts from crew-approved photos, move stuck ones on;
 * - seasonal email: start an automatic season past its go-live, send the
 *   next batch of any running season.
 *
 * Every step has its own switch and its own "first switched on" moment
 * (marketing_autopilot_settings), and every step is safe to run twice.
 * Wants every 15 minutes; hourly is fine.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "marketing-autopilot");
  if (refused) return refused;

  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id");
  const runs: Record<string, unknown>[] = [];
  for (const { id } of orgs ?? []) {
    const autopilot = await loadAutopilot(admin, id);
    if (!autopilot.ready) {
      runs.push({ organizationId: id, skipped: "marketing_autopilot_settings table missing" });
      continue;
    }
    const run: Record<string, unknown> = { organizationId: id };
    try {
      run.plays = await runPlayAutopilot(admin, id, autopilot);
    } catch (err) {
      log.error("cron.marketing_autopilot.plays", err, { org: id });
      run.plays = { error: err instanceof Error ? err.message : String(err) };
    }
    try {
      run.social = await runSocialAutopilot(admin, id, autopilot);
    } catch (err) {
      log.error("cron.marketing_autopilot.social", err, { org: id });
      run.social = { error: err instanceof Error ? err.message : String(err) };
    }
    try {
      run.seasonal = await runSeasonal(admin, id, autopilot);
    } catch (err) {
      log.error("cron.marketing_autopilot.seasonal", err, { org: id });
      run.seasonal = { error: err instanceof Error ? err.message : String(err) };
    }
    runs.push(run);
  }
  log.info("cron.marketing_autopilot", { orgs: runs.length });
  return NextResponse.json({ ok: true, runs });
}
