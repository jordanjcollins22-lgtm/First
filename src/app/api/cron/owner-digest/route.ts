import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { isDigestTime } from "@/lib/approvals/digest";
import { sendOwnerDigest, type DigestOutcome } from "@/lib/data/owner-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Monday digest to the owner: what is waiting, last week's numbers per
 * department, and the top exceptions.
 *
 * Scheduled for Monday at 11:00 and 12:00 UTC, because 7am Eastern is one
 * or the other depending on daylight saving. The route itself only sends on
 * a Monday at or after 7am on the business's clock, and each owner gets each
 * week's digest once (the week is the dedupe key), so the second run and any
 * retry send nothing. ?force=1 skips the clock check, not the once-a-week.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = await authorizeScheduledCall(request, "owner-digest");
  if (refused) return refused;

  const now = new Date();
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && !isDigestTime(now)) {
    return NextResponse.json({ ok: true, sent: 0, note: "Not Monday 7am yet on the business's clock." });
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin.from("organizations").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: DigestOutcome[] = [];
  for (const org of orgs ?? []) {
    try {
      results.push(await sendOwnerDigest(admin, org.id, now));
    } catch (err) {
      log.error("cron.owner_digest", err, { organizationId: org.id });
      results.push({ organizationId: org.id, sent: 0, skipped: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, sent: results.reduce((t, r) => t + r.sent, 0), results });
}
