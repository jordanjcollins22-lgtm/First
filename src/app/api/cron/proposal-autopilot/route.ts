import { NextResponse, type NextRequest } from "next/server";

import { authorizeCron } from "@/lib/cron-auth";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { runAutopilotEverywhere } from "@/lib/data/sales-autopilot";
import { log } from "@/lib/log";

/**
 * The pipeline autopilot's timer, every 15 minutes from pg_cron.
 *
 * The evaluator's Submit already runs the autopilot for that one proposal;
 * this is the net under it. It approves and sends drafts inside the price
 * guardrails that the submit missed, retries sends held by quiet hours,
 * picks up sends approved on My Day, raises an exception to the evaluator
 * when a proposal is past the speed target, and closes exceptions that have
 * been dealt with. Only work submitted after each business's go-live moment
 * is touched, and every send is keyed, so running it twice sends nothing
 * twice.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const refused = authorizeCron(request, "proposal-autopilot");
  if (refused) return refused;
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const runs = await runAutopilotEverywhere();
  log.info("autopilot.run", { orgs: runs.length, sent: runs.reduce((s, r) => s + r.sent, 0), held: runs.reduce((s, r) => s + r.held, 0) });
  return NextResponse.json({ ok: true, runs });
}
