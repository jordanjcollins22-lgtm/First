import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { log, maskPhone } from "@/lib/log";
import { last10Digits } from "@/lib/sms";
import { notifyJobTeam } from "@/lib/notifications";
import { inboundIntent } from "@/lib/client-consent";
import { recordConsent } from "@/lib/data/client-messaging";

/**
 * A client's text, handed on by GoHighLevel.
 *
 * The business's number lives in GoHighLevel, so a client's reply lands in
 * a GoHighLevel conversation and nowhere else. A workflow there, on
 * "Customer Replied", posts the message here, and it goes into the
 * client's thread in the app the way a text to our own line would, so the
 * inbox is one inbox.
 *
 * Field names are matched loosely, because a GoHighLevel webhook's shape
 * depends on how the workflow was built. Send whichever of these you have:
 *   phone / contact.phone / from
 *   message / body / message.body / text
 *   name / full_name / contact.name / first_name + last_name
 *
 * Shared secret: set GHL_WEBHOOK_SECRET and send it as x-webhook-secret.
 * A body that names no message is answered 200 and ignored, so a workflow
 * that fires on the wrong step does nothing rather than retrying forever.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin not configured on the server." }, { status: 500 });
  }
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET;
  if (expectedSecret && request.headers.get("x-webhook-secret") !== expectedSecret) {
    log.warn("ghl.message.rejected", { reason: "bad shared secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contact = (body.contact as Record<string, unknown>) ?? {};
  const messageObject = body.message && typeof body.message === "object" ? (body.message as Record<string, unknown>) : null;
  const text = String(
    (typeof body.message === "string" ? body.message : null) ??
      messageObject?.body ??
      body.body ??
      body.text ??
      ""
  ).trim();
  const phone = String(body.phone ?? contact.phone ?? body.from ?? "").trim();
  const name =
    (contact.name as string) ||
    (body.full_name as string) ||
    [body.first_name, body.last_name].filter(Boolean).join(" ") ||
    (body.name as string) ||
    "";

  if (!text || !phone) {
    return NextResponse.json({ ok: true, ignored: "no message or phone in the payload", receivedKeys: Object.keys(body) });
  }

  // Our own words coming back round. GoHighLevel fires "Customer Replied"
  // only for inbound, but a workflow built on "message received" would not.
  const direction = String(body.direction ?? messageObject?.direction ?? "inbound").toLowerCase();
  if (direction === "outbound") return NextResponse.json({ ok: true, ignored: "outbound" });

  const admin = createAdminClient();
  const digits = last10Digits(phone);
  const { data: customers } = await admin.from("customers").select("id, name, phone, organization_id").not("phone", "is", null);
  const customer = (customers ?? []).find((c) => c.phone && last10Digits(c.phone) === digits) ?? null;
  if (!customer) {
    log.info("ghl.message.unmatched", { from: maskPhone(phone) });
    return NextResponse.json({ ok: true, ignored: "no client with that number" });
  }

  const intent = inboundIntent(text);
  if (intent === "stop" || intent === "start") {
    await recordConsent({
      organizationId: customer.organization_id,
      customerId: customer.id,
      channel: "sms",
      state: intent === "stop" ? "revoked" : "granted",
      source: "reply",
      evidence: `Replied "${text.slice(0, 60)}" via GoHighLevel on ${new Date().toISOString()}`,
    });
  }

  const { data: properties } = await admin.from("properties").select("id").eq("customer_id", customer.id);
  const propertyIds = (properties ?? []).map((p) => p.id);
  const { data: jobs } =
    propertyIds.length > 0
      ? await admin.from("jobs").select("id").in("property_id", propertyIds).order("created_at", { ascending: false }).limit(1)
      : { data: [] };
  const job = jobs?.[0];
  if (!job) return NextResponse.json({ ok: true, ignored: "client has no job to file it on" });

  const { data: saved } = await admin
    .from("job_messages")
    .insert({
      job_id: job.id,
      organization_id: customer.organization_id,
      channel: "external",
      author_type: "client",
      author_name: name.trim() || customer.name,
      body: intent === "message" ? text : `${text} (handled automatically: ${intent})`,
      sent_via: "sms",
    })
    .select("id")
    .maybeSingle();

  await notifyJobTeam(job.id, "client_messages", `${customer.name} texted: ${text.slice(0, 120)}`, {
    dedupeKey: saved?.id ? `message:${saved.id}` : undefined,
  }).catch(() => {});

  log.info("ghl.message.filed", { jobId: job.id, from: maskPhone(phone) });
  return NextResponse.json({ ok: true, jobId: job.id });
}
