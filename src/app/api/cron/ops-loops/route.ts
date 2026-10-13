import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { allOrganizationIds } from "@/lib/data/ops-settings";
import { sweepSessions } from "@/lib/data/ops-sessions";
import { runCompletionChain } from "@/lib/data/ops-completion";

/**
 * The operations loops, every 15 minutes.
 *
 * First the work days: anything the crew's "Finished here" should have
 * closed is closed, and anything still open after the cutoff (9pm) becomes an
 * exception for the job's project lead. Then the completion chain moves each
 * finished job one step on: sign-off request, invoice, cost snapshot, and the
 * review-request hook.
 *
 * Each business separately, each automation behind its own switch and start
 * time, and every step idempotent, so a run twice in a row does nothing twice.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = await authorizeScheduledCall(request, "ops-loops");
  if (refused) return refused;

  const now = new Date();
  const results: Record<string, unknown>[] = [];
  for (const organizationId of await allOrganizationIds()) {
    const row: Record<string, unknown> = { organizationId };
    try {
      row.sessions = await sweepSessions(organizationId, now);
    } catch (err) {
      log.error("ops.sweep_failed", err, { organizationId });
      row.sessions = "failed";
    }
    try {
      row.chain = await runCompletionChain(organizationId, now);
    } catch (err) {
      log.error("ops.chain_run_failed", err, { organizationId });
      row.chain = "failed";
    }
    results.push(row);
  }
  return NextResponse.json({ at: now.toISOString(), results });
}
