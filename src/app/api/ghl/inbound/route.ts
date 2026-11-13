import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";

import { handleInboundMessage } from "@/lib/agent/handle-inbound";
import { serverEnv } from "@/lib/env";
import { parseInboundMessage } from "@/lib/ghl/inbound";
import { createAdminClient } from "@/lib/supabase/admin";

// The agent can take a while (several Claude + GHL calls). It runs after the
// response is sent, within this limit.
export const maxDuration = 120;

function secretMatches(provided: string | null): boolean {
  const expected = serverEnv.ghlWebhookSecret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GoHighLevel posts every inbound message here, on any channel (workflow
 * "Customer Replied" -> Webhook, URL
 * https://<app>/api/ghl/inbound?secret=<GHL_WEBHOOK_SECRET>).
 * We answer GHL right away and let the comms agent work afterwards.
 */
export async function POST(request: NextRequest) {
  const provided =
    request.nextUrl.searchParams.get("secret") ?? request.headers.get("x-webhook-secret");
  if (!secretMatches(provided)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const inbound = parseInboundMessage(payload);
  if (!inbound) return Response.json({ ok: true, ignored: "not an inbound message" });

  const supabase = createAdminClient();
  after(async () => {
    try {
      await handleInboundMessage(supabase, inbound);
    } catch (error) {
      console.error("[ghl/inbound] failed to handle message", error);
    }
  });

  return Response.json({ ok: true, queued: true, channel: inbound.channel });
}
