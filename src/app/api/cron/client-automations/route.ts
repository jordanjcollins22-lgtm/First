import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { outboundBaseUrl } from "@/lib/base-url";
import { quietWindowFor } from "@/lib/data/client-messaging";
import { notifyApprovers } from "@/lib/data/outbound-approvals";
import { loadSequenceSettings } from "@/lib/data/client-automations";
import {
  guarded,
  runCollections,
  runHeldMissedCalls,
  runNoShowRebook,
  runReviewRequests,
  runWinBack,
  type Tally,
} from "@/lib/data/client-automation-runs";

/**
 * The timed client sequences added beside the reminders: review requests,
 * no-show rebooking, win-back, the collections hand-off after the last
 * invoice reminder, and missed-call texts held overnight.
 *
 * Wants to run every 15 minutes (pg_cron), because "within two hours" of a
 * sign-off and "the same day" of a no-show mean nothing on a daily timer.
 * Safe to run that often: every send is claimed under a unique key first.
 *
 * Gated twice per business: the master "client messages" switch, and each
 * sequence's own switch, which also dates what it may act on.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = authorizeCron(request, "client-automations");
  if (refused) return refused;

  const admin = createAdminClient();
  const now = new Date();
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name, client_reminders_enabled, reminder_time_zone, reminder_quiet_start, reminder_quiet_end")
    .eq("client_reminders_enabled", true);
  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ note: "No business has client messages switched on." });
  }

  const origin = (await outboundBaseUrl()) || new URL(request.url).origin;
  const tally: Tally = {};

  for (const org of orgs) {
    const settings = await loadSequenceSettings(admin, org.id);
    if (!settings.ready) continue;
    const ctx = { admin, org: { id: org.id, name: org.name }, window: quietWindowFor(org), origin, now, settings };
    await guarded("collections", org.id, () => runCollections(ctx, tally));
    await guarded("reviews", org.id, () => runReviewRequests(ctx, tally));
    await guarded("rebook", org.id, () => runNoShowRebook(ctx, tally));
    await guarded("win_back", org.id, () => runWinBack(ctx, tally));
    await guarded("missed_calls", org.id, () => runHeldMissedCalls(ctx, tally));

    // Emails parked for the owner's OK get one note per business per run.
    const parked = Object.entries(tally).some(([k, v]) => k.endsWith(".awaiting_approval") && v > 0);
    if (parked) await notifyApprovers(admin, org.id).catch(() => {});
  }

  log.info("cron.client_automations", tally);
  return NextResponse.json(tally);
}
