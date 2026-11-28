import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { parseWebhook } from "@/lib/ghl/inbox";
import { captureInbound } from "@/lib/ghl/capture";

/**
 * Every message somebody sends the business in GoHighLevel, the moment it
 * arrives.
 *
 * A workflow there, trigger "Customer Replied" (any channel), action
 * Webhook (POST) to https://app.jslandscapingmd.com/api/webhooks/ghl-message,
 * posts each one here. It is saved in ghl_inbound_messages, filed in the
 * client's job thread when they have one, and the account manager hears
 * about it. A text from a number that is not a client yet is kept and
 * announced too: those are new leads.
 *
 * The every-minute sweep (api/cron/ghl-inbox-sweep) picks up anything that
 * never arrives here, and saving is keyed on GoHighLevel's message id, so
 * a message that comes both ways counts once.
 *
 * Shared secret: when GHL_WEBHOOK_SECRET is set, send it as the
 * x-webhook-secret header or ?secret= on the URL.
 */
function secretOk(request: NextRequest): boolean {
  const expected = process.env.GHL_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided = request.headers.get("x-webhook-secret") ?? request.nextUrl.searchParams.get("secret");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin not configured on the server." }, { status: 500 });
  }
  if (!secretOk(request)) {
    log.warn("ghl.message.rejected", { reason: "bad shared secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = parseWebhook(body);
  if (!message) {
    // Answered 200 so a workflow step that fires on the wrong thing does
    // nothing rather than retrying forever.
    const keys = body && typeof body === "object" ? Object.keys(body as object) : [];
    return NextResponse.json({ ok: true, ignored: "not an inbound message", receivedKeys: keys });
  }

  try {
    const result = await captureInbound(message, "webhook", { raw: body });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // A 500 makes GoHighLevel retry, and the sweep is behind it either way.
    log.error("ghl.message.failed", error);
    return NextResponse.json({ error: "Could not save the message" }, { status: 500 });
  }
}
