import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { outboundBaseUrl } from "@/lib/base-url";
import { recordRun, runSocialPosting, type PostingRun } from "@/lib/data/social-posting-run";
import { catchUpJobDrafts } from "@/lib/data/social-photo-drafts";
import { writeDraftText } from "@/lib/social/photo-post-writer";

/**
 * Sends the posts whose time has come, for every business, to Facebook and
 * Instagram (and SOCIAL_WEBHOOK_URL when set), after giving approved posts
 * their slots under the cadence. The rules (retries, re-slotting missed
 * posts, what counts as failed) are in lib/data/social-posting-run.ts and
 * lib/social/autopost.ts.
 *
 * Called at five past every hour by the database's timer
 * (0374_social_autopost.sql, x-scheduler-token), and once a day by Vercel's
 * cron (vercel.json, CRON_SECRET) as the fallback. Safe to run more often
 * than needed: a post is claimed before it is sent.
 *
 * First, the catch-up: finished jobs from the last three weeks whose crew
 * photos have no post yet each get a draft (lib/data/social-photo-drafts.ts),
 * which waits on Admin › Social for Approve or Deny. Nothing made here is
 * sent until somebody approves it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }

  const refused = await authorizeScheduledCall(request, "social-posts");
  if (refused) return refused;

  const admin = createAdminClient();
  const appBase = (await outboundBaseUrl()).replace(/\/$/, "");
  const { data: orgs } = await admin.from("organizations").select("id");
  const runs: PostingRun[] = [];
  let drafted = 0;
  for (const { id } of orgs ?? []) {
    try {
      drafted += await catchUpJobDrafts(admin, id, { bookingUrl: `${appBase}/book`, writer: writeDraftText });
    } catch (err) {
      log.error("cron.social_posts.drafts", err, { org: id });
    }
    try {
      const run = await runSocialPosting(admin, id, appBase);
      await recordRun(admin, run).catch((err) => log.error("cron.social_posts.record", err, { org: id }));
      runs.push(run);
    } catch (err) {
      log.error("cron.social_posts", err, { org: id });
      runs.push({ organizationId: id, reslotted: 0, filled: 0, due: 0, sent: 0, retrying: 0, failed: 0, waiting: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const total = (k: "due" | "sent" | "failed" | "waiting" | "filled" | "reslotted") => runs.reduce((n, r) => n + r[k], 0);
  log.info("cron.social_posts", { drafted, due: total("due"), sent: total("sent"), failed: total("failed"), waiting: total("waiting"), filled: total("filled") });
  return NextResponse.json({ drafted, due: total("due"), sent: total("sent"), failed: total("failed"), waiting: total("waiting"), filled: total("filled"), reslotted: total("reslotted"), runs });
}
