import { NextResponse, type NextRequest } from "next/server";

import { authorizeScheduledCall } from "@/lib/cron-auth";
import { runGoogleBusiness } from "@/lib/data/google-business-run";
import { runAdsImport } from "@/lib/data/google-ads-run";
import { makeAdDrafts } from "@/lib/data/ad-drafts";
import { loadAutopilot } from "@/lib/data/marketing-autopilot";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Google, once a day, for every business that connected it: reviews pulled
 * and answered, insights read, the weekly post made (Business Profile), and
 * yesterday's spend and leads imported (Google Ads, Local Services Ads), and
 * new ads made from finished-job photos for the owner to approve.
 * A business that hasn't connected Google is skipped with "Not connected".
 * Wants daily, mid-morning (e.g. 13:00 UTC).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = await authorizeScheduledCall(request, "google-daily");
  if (refused) return refused;

  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id");
  const runs: Record<string, unknown>[] = [];
  for (const { id } of orgs ?? []) {
    const autopilot = await loadAutopilot(admin, id);
    const run: Record<string, unknown> = { organizationId: id };
    try {
      run.business = await runGoogleBusiness(admin, id, autopilot);
    } catch (err) {
      log.error("cron.google_business", err, { org: id });
      run.business = { error: err instanceof Error ? err.message : String(err) };
    }
    try {
      run.ads = await runAdsImport(admin, id, autopilot.settings);
    } catch (err) {
      log.error("cron.google_ads", err, { org: id });
      run.ads = { error: err instanceof Error ? err.message : String(err) };
    }
    try {
      // New ads from finished-job photos, waiting for the owner. Nothing goes to Google here.
      run.adDrafts = await makeAdDrafts(admin, id);
    } catch (err) {
      log.error("cron.ad_drafts", err, { org: id });
      run.adDrafts = { error: err instanceof Error ? err.message : String(err) };
    }
    runs.push(run);
  }
  return NextResponse.json({ ok: true, runs });
}
