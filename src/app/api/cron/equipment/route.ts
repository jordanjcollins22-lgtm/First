import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { runEquipment, type EquipmentRun } from "@/lib/data/equipment";
import { untyped } from "@/lib/data/purchasing";
import { log } from "@/lib/log";

/**
 * Equipment's timer: overdue service becomes an alert for the project lead,
 * new visits get their kits filled in from the services sold, and anybody
 * who hasn't ticked the load-out by the time the trucks should be gone
 * becomes an exception on their first job.
 *
 * The load-out check needs to run in the morning after the shop arrival time
 * plus the grace, so this wants every 15 minutes from pg_cron (at minimum
 * every 15 minutes between 6 and 10 am business time). Each part has its own
 * switch, and every write is keyed, so running it often costs nothing.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = await authorizeScheduledCall(request, "equipment");
  if (refused) return refused;

  const admin = untyped(createAdminClient());
  const { data: orgs, error } = await admin.from("equipment_settings").select("organization_id");
  if (error) return NextResponse.json({ ok: true, skipped: "equipment tables not created yet" });

  const runs: EquipmentRun[] = [];
  for (const row of (orgs ?? []) as { organization_id: string }[]) {
    try {
      runs.push(await runEquipment(admin, row.organization_id));
    } catch (err) {
      log.error("cron.equipment.failed", undefined, { organizationId: row.organization_id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, runs });
}
