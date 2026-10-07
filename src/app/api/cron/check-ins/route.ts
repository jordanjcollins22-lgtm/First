import type { NextRequest } from "next/server";

import { flagMissedCheckIns, sendDueCheckIns } from "@/lib/check-ins/service";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Runs every few minutes (vercel.json cron). Sends check-ins that have come
 * due and flags unanswered ones as missed. Vercel Cron authenticates with
 * "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(request: NextRequest) {
  if (!serverEnv.cronSecret || request.headers.get("authorization") !== `Bearer ${serverEnv.cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const sent = await sendDueCheckIns(supabase, now);
  const missed = await flagMissedCheckIns(supabase, now);

  return Response.json({ ok: true, ...sent, ...missed });
}
