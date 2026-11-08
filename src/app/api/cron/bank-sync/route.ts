import type { NextRequest } from "next/server";

import { syncAllBankConnections } from "@/lib/accounting/service";
import { isPlaidConfigured, serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Daily (vercel.json cron): pull new transactions from every linked bank.
 * Vercel Cron authenticates with "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(request: NextRequest) {
  if (!serverEnv.cronSecret || request.headers.get("authorization") !== `Bearer ${serverEnv.cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlaidConfigured()) return Response.json({ ok: true, skipped: "Plaid not configured" });

  const results = await syncAllBankConnections(createAdminClient());
  return Response.json({ ok: true, results });
}
