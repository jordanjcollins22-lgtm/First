import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { handleInboundSms } from "@/lib/check-ins/service";
import { serverEnv } from "@/lib/env";
import { parseInboundSms } from "@/lib/ghl/inbound";
import { createAdminClient } from "@/lib/supabase/admin";

function secretMatches(provided: string | null): boolean {
  const expected = serverEnv.ghlWebhookSecret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GoHighLevel posts inbound SMS here (workflow "Customer Replied" -> Webhook,
 * URL https://<app>/api/ghl/inbound?secret=<GHL_WEBHOOK_SECRET>).
 * Texts from numbers that aren't team members are acknowledged and ignored, so
 * this is safe to point at the same GHL number you use for clients.
 */
export async function POST(request: NextRequest) {
  const provided =
    request.nextUrl.searchParams.get("secret") ?? request.headers.get("x-webhook-secret");
  if (!secretMatches(provided)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const inbound = parseInboundSms(payload);
  if (!inbound) return Response.json({ ok: true, ignored: "not an inbound SMS" });

  const result = await handleInboundSms(createAdminClient(), inbound);
  return Response.json({ ok: true, ...result });
}
