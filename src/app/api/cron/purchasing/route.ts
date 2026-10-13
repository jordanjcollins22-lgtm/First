import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { runPurchasing, untyped, type PurchasingRun } from "@/lib/data/purchasing";
import { log } from "@/lib/log";

/**
 * Purchasing's timer: accepted and scheduled jobs become draft orders,
 * low materials become reorders, approved orders go to suppliers when
 * auto-send is on, and materials not in hand two days out become an
 * exception for the project lead.
 *
 * Only for businesses that have opened the purchasing settings, and each
 * part only when its switch is on. Safe to run as often as it is called:
 * every write is keyed, so a second run in the same minute does nothing.
 * Wants every 15 minutes from pg_cron; hourly is fine.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "purchasing");
  if (refused) return refused;

  const admin = untyped(createAdminClient());
  const { data: orgs, error } = await admin.from("purchasing_settings").select("organization_id");
  if (error) return NextResponse.json({ ok: true, skipped: "purchasing tables not created yet" });

  const runs: PurchasingRun[] = [];
  for (const row of (orgs ?? []) as { organization_id: string }[]) {
    try {
      runs.push(await runPurchasing(admin, row.organization_id));
    } catch (err) {
      log.error("cron.purchasing.failed", undefined, { organizationId: row.organization_id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, runs });
}
