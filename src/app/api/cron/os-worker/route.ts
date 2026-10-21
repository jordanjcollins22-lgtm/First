import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { backboneEnabled } from "@/lib/os/emit";
import { SupabaseFacts, SupabaseStore } from "@/lib/os/supabase-store";
import { runWorker } from "@/lib/os/worker";

/**
 * The event backbone's worker: deliver recorded facts to their handlers,
 * then the follow-ups, deadlines and readiness rechecks that time sets off.
 *
 * Not on any schedule yet. It does nothing unless OS_EVENT_BACKBONE=on, and
 * every business starts with events off and in dry-run, so calling it early
 * is harmless. To run it every minute, add it to 0365_scheduler.sql's list.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = await authorizeScheduledCall(request, "os-worker");
  if (refused) return refused;
  if (!backboneEnabled()) return NextResponse.json({ skipped: "OS_EVENT_BACKBONE is not on" });

  const started = Date.now();
  try {
    const result = await runWorker({ store: new SupabaseStore(), facts: new SupabaseFacts(), now: () => new Date() });
    log.info("os.worker_ran", { ...result, ms: Date.now() - started });
    return NextResponse.json({ at: new Date().toISOString(), ...result });
  } catch (err) {
    log.error("os.worker_failed", err);
    return NextResponse.json({ error: "The worker failed; nothing it had claimed is lost." }, { status: 500 });
  }
}
