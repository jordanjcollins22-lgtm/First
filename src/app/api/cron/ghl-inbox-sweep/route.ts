import { NextResponse, type NextRequest } from "next/server";

import { authorizeScheduledCall } from "@/lib/cron-auth";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeamMember } from "@/lib/notifications";
import { getConversationMessages, searchRecentConversations } from "@/lib/ghl/client";
import { captureHealth, conversationsToOpen, inboundFromMessages, parseConversation } from "@/lib/ghl/inbox";
import { captureInbound, JS_ORG_ID } from "@/lib/ghl/capture";

export const maxDuration = 55;

/** How far back each run looks. Wide on purpose: a run that was missed or
 * failed is covered by the next ones, and doubles are dropped on save. */
const LOOKBACK_MINUTES = 15;

type StateRow = {
  id: number;
  last_ok_at: string | null;
  failures_in_a_row: number;
  health_alerted_at: string | null;
};

/**
 * The every-minute safety net under the GoHighLevel webhook.
 *
 * pg_cron calls this once a minute. It asks GoHighLevel for the
 * conversations active in the last 15 minutes, reads their newest
 * messages, and saves every inbound one it does not already have. So a
 * message reaches the app within about a minute even if the workflow that
 * posts to the webhook is switched off, edited wrong, or GoHighLevel's
 * delivery fails.
 *
 * It also keeps score. Three failed runs in a row text (or email) the
 * admins once an hour until it works again, so "the watcher quietly
 * stopped" can't happen without somebody hearing.
 */
export async function GET(request: NextRequest) {
  const refused = await authorizeScheduledCall(request, "ghl-inbox-sweep");
  if (refused) return refused;
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin not configured on the server." }, { status: 500 });
  }
  if (!env.ghlApiKey || !env.ghlLocationId) {
    return NextResponse.json({ error: "GHL_API_KEY / GHL_LOCATION_ID are not set." }, { status: 503 });
  }

  const admin = createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  const started = new Date();
  const since = new Date(started.getTime() - LOOKBACK_MINUTES * 60_000);

  let opened = 0;
  let stored = 0;
  let failure: string | null = null;
  try {
    const conversations = (await searchRecentConversations(50))
      .map(parseConversation)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    for (const conversation of conversationsToOpen(conversations, since)) {
      opened += 1;
      const payload = await getConversationMessages(conversation.id, 20);
      for (const message of inboundFromMessages(payload, conversation, since)) {
        const result = await captureInbound(message, "sweep");
        if (result.stored) stored += 1;
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    log.error("ghl.sweep.failed", error);
  }

  const { data: stateRows } = await admin.from("ghl_capture_state").select("*").eq("id", 1).limit(1);
  const state = (stateRows?.[0] as StateRow | undefined) ?? {
    id: 1,
    last_ok_at: null,
    failures_in_a_row: 0,
    health_alerted_at: null,
  };
  const next = {
    id: 1,
    last_run_at: started.toISOString(),
    last_ok_at: failure ? state.last_ok_at : started.toISOString(),
    failures_in_a_row: failure ? state.failures_in_a_row + 1 : 0,
    last_error: failure,
    last_stored: stored,
    health_alerted_at: state.health_alerted_at,
  };

  const health = captureHealth({ lastOkAt: next.last_ok_at, failuresInARow: next.failures_in_a_row }, started);
  const alertedRecently =
    state.health_alerted_at && started.getTime() - new Date(state.health_alerted_at).getTime() < 60 * 60_000;
  if (!health.ok && !alertedRecently) {
    const { data: admins } = await admin
      .from("profile_roles")
      .select("profile_id, profile:profiles!inner(organization_id)")
      .eq("role_name", "admin")
      .eq("profile.organization_id", JS_ORG_ID);
    const text = `${health.reason} Last error: ${failure ?? "none"}. New HighLevel messages may not be reaching the app.`;
    await Promise.all(
      ((admins ?? []) as { profile_id: string }[]).map((a) =>
        notifyTeamMember(a.profile_id, "client_messages", text, { overridesKindPreference: true }).catch(() => false)
      )
    );
    next.health_alerted_at = started.toISOString();
  }

  await admin.from("ghl_capture_state").upsert(next, { onConflict: "id" });

  return NextResponse.json({ ok: !failure, opened, stored, error: failure }, { status: failure ? 502 : 200 });
}
