import { NextResponse, type NextRequest } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { financeDb } from "@/lib/data/finance-settings";
import { isStripeConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { chargeAutopayInvoices, reconcileAutopay } from "@/lib/finance/autopay";
import { log } from "@/lib/log";

/**
 * Autopay's timer. For each business with clients on autopay: makes every
 * finished "save your card or bank" page the client's Stripe default, then
 * charges, once each, the open invoices raised for them since autopay was
 * switched on. Twice in a row charges nothing the second time.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const refused = authorizeCron(request, "finance-autopay");
  if (refused) return refused;
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  if (!isStripeConfigured) return NextResponse.json({ ok: true, skipped: "Stripe is not connected." });

  const { data, error } = await financeDb().from("customer_autopay").select("organization_id").eq("enabled", true);
  if (error) return NextResponse.json({ ok: true, skipped: "customer_autopay is not there yet (migration 0363)." });

  const orgs = [...new Set(((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id))];
  const runs = [];
  for (const organizationId of orgs) {
    try {
      const confirmed = await reconcileAutopay(organizationId);
      const charges = await chargeAutopayInvoices(organizationId);
      runs.push({ organizationId, confirmed, ...charges });
    } catch (err) {
      log.error("autopay.run.crashed", err, { organizationId });
      runs.push({ organizationId, error: "Crashed; see logs." });
    }
  }
  return NextResponse.json({ ok: true, runs });
}
