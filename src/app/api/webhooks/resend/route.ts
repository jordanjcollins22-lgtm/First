import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { recordConsent } from "@/lib/data/client-messaging";
import { log } from "@/lib/log";

/**
 * What the email provider tells us about mail we sent.
 *
 * Bounces and complaints are the two numbers a sending domain lives or
 * dies by, and they only arrive this way. A bounce marks the recipient so
 * the campaign's rate is right; a complaint also takes the person off
 * every future email, because somebody who pressed "spam" has said no in
 * the loudest way there is. Opens and clicks are noted for the numbers.
 *
 * Signed by the provider (Svix). Without the signing secret set, the
 * route is closed in production: a forged call could unsubscribe people.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ ok: false }, { status: 503 });

  const raw = await request.text();
  const secret = env.resendWebhookSecret;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      log.error("resend.webhook.unconfigured", undefined, { fix: "Set RESEND_WEBHOOK_SECRET from the Resend webhook page." });
      return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not set." }, { status: 503 });
    }
  } else if (!verify(request, raw, secret)) {
    log.warn("resend.webhook.rejected", { reason: "bad signature" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let event: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const type = event.type ?? "";
  const emailId = event.data?.email_id;
  if (!emailId) return NextResponse.json({ ok: true, ignored: "no email id" });

  const admin = createAdminClient();
  const { data: recipient } = await admin
    .from("email_campaign_recipients")
    .select("id, organization_id, customer_id, status")
    .eq("provider_id", emailId)
    .maybeSingle();
  if (!recipient) {
    log.info("resend.webhook.unmatched", { type });
    return NextResponse.json({ ok: true, ignored: "not a campaign email" });
  }

  const now = new Date().toISOString();
  if (type === "email.bounced") {
    await admin.from("email_campaign_recipients").update({ status: "bounced", skip_reason: "bounced" }).eq("id", recipient.id);
    log.warn("campaign.bounced", { recipientId: recipient.id });
  } else if (type === "email.complained") {
    await admin.from("email_campaign_recipients").update({ status: "complained", skip_reason: "marked as spam" }).eq("id", recipient.id);
    if (recipient.customer_id) {
      await recordConsent({
        organizationId: recipient.organization_id,
        customerId: recipient.customer_id,
        channel: "email",
        state: "revoked",
        source: "complaint",
        evidence: `Marked a campaign email as spam on ${now.slice(0, 10)}.`,
      }).catch(() => null);
    }
    log.warn("campaign.complained", { recipientId: recipient.id });
  } else if (type === "email.opened") {
    await admin.from("email_campaign_recipients").update({ opened_at: now }).eq("id", recipient.id).is("opened_at", null);
  } else if (type === "email.clicked") {
    await admin.from("email_campaign_recipients").update({ clicked_at: now }).eq("id", recipient.id).is("clicked_at", null);
  }

  return NextResponse.json({ ok: true });
}

/** Svix's signature: HMAC-SHA256 of "id.timestamp.body" with the base64 secret. */
function verify(request: NextRequest, raw: string, secret: string): boolean {
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signatures = request.headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !signatures) return false;
  // Five minutes either way, so a captured call cannot be replayed later.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
