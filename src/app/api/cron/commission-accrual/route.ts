import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { log, describeError } from "@/lib/log";
import { organizationsWith } from "@/lib/data/back-office-settings";
import { buildWeeklyBatch, listBatches, sweepAccruals } from "@/lib/data/commission-accrual";
import { tellOwner } from "@/lib/data/back-office-owners";

/**
 * Commissions' timer, once a day.
 *
 * 1. Sweep: accrue any money that landed since accrual was switched on and
 *    has no commission rows yet (the webhook was down, or it was a cheque).
 * 2. Batch: once last Monday-to-Sunday week has ended, build its payout
 *    statements and one total for the owner to approve, and tell the owner
 *    once. A week already batched is skipped, so running twice does nothing.
 *
 * Only businesses that switched accrual on, and only money since they did.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const refused = authorizeCron(request, "commission-accrual");
  if (refused) return refused;
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const results: Record<string, unknown>[] = [];
  for (const { organizationId, settings } of await organizationsWith("commission_accrual_on")) {
    try {
      const accrued = await sweepAccruals(organizationId, settings);
      const batchId = await buildWeeklyBatch(organizationId, settings);
      if (batchId) {
        const batch = (await listBatches(organizationId, 3)).find((b) => b.id === batchId);
        if (batch && batch.total > 0) {
          await tellOwner(
            organizationId,
            `Commission for the week of ${batch.weekStart}: $${batch.total.toFixed(2)} to ${batch.statements.length} ${batch.statements.length === 1 ? "person" : "people"}. Approve it in Admin › Finance.`,
            `commission_batch:${batchId}`
          );
        }
      }
      results.push({ organizationId, accrued, batchId });
    } catch (err) {
      log.error("cron.commission_accrual_failed", err, { organizationId, error: describeError(err) });
      results.push({ organizationId, error: true });
    }
  }
  return NextResponse.json({ ok: true, results });
}
