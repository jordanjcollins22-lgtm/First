import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { sweepApprovals } from "@/lib/data/outbound-approvals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The clock's part of the approval queue, every 15 minutes.
 *
 * Closes held emails that stopped making sense (cancelled booking, answered
 * proposal, moved visit), sends low-risk ones nobody stopped in their
 * window, and closes the ones past their moment. The daily crons call the
 * same sweep, but a "see you tomorrow" with a six-hour window needs a
 * clock that ticks more than once a day.
 *
 * Safe to run at any rate: every step only touches rows still pending, and
 * a send is claimed under the same key as an approval.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = authorizeCron(request, "approvals-sweep");
  if (refused) return refused;
  try {
    const result = await sweepApprovals(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
