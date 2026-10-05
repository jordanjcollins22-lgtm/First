import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { outboundBaseUrl } from "@/lib/base-url";
import { runPmOutreach, type PmRun } from "@/lib/data/pm-run";
import { log } from "@/lib/log";

/**
 * The property manager pipeline's timer: finds companies, reads their sites
 * for an email, writes sequences and sends what is due, for every business
 * that has it set up. The database calls it every 15 minutes with the same
 * token the finder uses; Vercel's cron secret works too. Sending itself only
 * happens on weekdays inside the sending hours, and only once the owner has
 * switched it on.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
      log.warn("pm.bad_token", {});
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    orgFilter = match.organization_id;
  } else {
    const refused = authorizeCron(request, "pm-outreach");
    if (refused) return refused;
  }

  let query = admin.from("pm_outreach_settings").select("organization_id");
  if (orgFilter) query = query.eq("organization_id", orgFilter);
  const { data: orgs } = await query;

  const baseUrl = await outboundBaseUrl();
  const runs: ({ organizationId: string } & PmRun)[] = [];
  for (const org of orgs ?? []) {
    runs.push({ organizationId: org.organization_id, ...(await runPmOutreach(admin, org.organization_id, baseUrl)) });
  }
  return NextResponse.json({ ok: true, runs });
}
