import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { getAgentSettings } from "@/lib/data/outreach-agent";
import { runRedditFinder, type RedditLook } from "@/lib/data/reddit-finder";
import { log } from "@/lib/log";

/**
 * The finder's server-side run: every platform that can be read without a
 * browser, for every business that has it on. Reddit today.
 *
 * Called two ways. The database's own timer calls it every half hour with a
 * token whose hash is kept on the business's settings, so it runs whether
 * or not anybody has Chrome open. Vercel's daily cron calls it too, with the
 * cron secret, as a floor if the database timer ever stops. Either way it
 * only reads and keeps posts; it never posts anything anywhere.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const admin = createAdminClient();

  const token = request.headers.get("x-finder-token");
  let orgFilter: string | null = null;
  if (token) {
    const { data } = await admin.from("outreach_agent_settings").select("organization_id, finder_token_hash").not("finder_token_hash", "is", null);
    const match = (data ?? []).find((row) => row.finder_token_hash && sameHash(row.finder_token_hash, hashOf(token)));
    if (!match) {
      log.warn("finder.bad_token", {});
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    orgFilter = match.organization_id;
  } else {
    const refused = authorizeCron(request, "social-finder");
    if (refused) return refused;
  }

  let query = admin.from("outreach_agent_settings").select("organization_id, reddit_enabled, paused_until").eq("reddit_enabled", true);
  if (orgFilter) query = query.eq("organization_id", orgFilter);
  const { data: orgs } = await query;

  const looks: { organizationId: string; look?: RedditLook; skipped?: string }[] = [];
  for (const org of orgs ?? []) {
    // Paused is paused, for every platform.
    if (org.paused_until && new Date(org.paused_until).getTime() > Date.now()) {
      looks.push({ organizationId: org.organization_id, skipped: "paused" });
      continue;
    }
    try {
      const settings = await getAgentSettings(org.organization_id, admin);
      looks.push({ organizationId: org.organization_id, look: await runRedditFinder(org.organization_id, settings, admin) });
    } catch (err) {
      log.error("finder.run_failed", err, { organizationId: org.organization_id });
      looks.push({ organizationId: org.organization_id, skipped: "error" });
    }
  }
  return NextResponse.json({ ok: true, looks });
}
