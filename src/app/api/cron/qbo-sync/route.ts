import { NextResponse, type NextRequest } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { financeDb } from "@/lib/data/finance-settings";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { runQboSync } from "@/lib/integrations/quickbooks/sync";
import { log } from "@/lib/log";

/**
 * The hourly push to QuickBooks Online, for every business that switched
 * the sync on. Each run sends only what is new or changed since the last,
 * so running it twice in a row sends nothing the second time.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const refused = authorizeCron(request, "qbo-sync");
  if (refused) return refused;
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const { data, error } = await financeDb().from("finance_settings").select("organization_id").eq("qbo_sync_enabled", true);
  if (error) return NextResponse.json({ ok: true, skipped: "finance_settings is not there yet (migration 0363)." });

  const runs = [];
  for (const row of (data ?? []) as { organization_id: string }[]) {
    try {
      runs.push({ organizationId: row.organization_id, ...(await runQboSync(row.organization_id, "cron")) });
    } catch (err) {
      log.error("qbo.sync.crashed", err, { organizationId: row.organization_id });
      runs.push({ organizationId: row.organization_id, ran: false, summary: "Crashed; see logs." });
    }
  }
  return NextResponse.json({ ok: true, runs });
}
