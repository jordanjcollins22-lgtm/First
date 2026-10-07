import Twilio from "twilio";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { last10Digits, sendSms } from "@/lib/sms";
import { notifyJobTeam } from "@/lib/notifications";
import { env, isTwilioConfigured } from "@/lib/env";
import { helpReply, inboundIntent, startConfirmation, stopConfirmation } from "@/lib/client-consent";
import { recordConsent } from "@/lib/data/client-messaging";

const EMPTY_TWIML = new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
  status: 200,
  headers: { "Content-Type": "text/xml" },
});

/**
 * Twilio's inbound-SMS webhook — set this URL (https://yourdomain/api/webhooks/twilio-sms)
 * as the number's "A message comes in" webhook in the Twilio console.
 *
 * Matches the sender's phone number against a customer's phone on file
 * (last 10 digits, format-insensitive), then posts the text into that
 * customer's most recently created job's external (client-visible)
 * conversation thread. A number that doesn't match any customer is dropped.
 */
export async function POST(request: NextRequest) {
  if (!isTwilioConfigured) {
    return NextResponse.json({ error: "Twilio isn't configured on the server." }, { status: 503 });
  }

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "";
  const url = `${proto}://${host}${request.nextUrl.pathname}`;

  const isValid = Twilio.validateRequest(env.twilioAuthToken, signature, url, params);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = params.From;
  const body = (params.Body ?? "").trim();
  if (!from || !body) return EMPTY_TWIML;

  const admin = createAdminClient();
  const senderDigits = last10Digits(from);

  const { data: customers } = await admin.from("customers").select("id, name, phone, organization_id").not("phone", "is", null);
  const customer = (customers ?? []).find((c) => c.phone && last10Digits(c.phone) === senderDigits);
  if (!customer) return EMPTY_TWIML;

  /**
   * STOP, START and HELP, before anything else.
   *
   * These have to work on every number a business texts from, whatever the
   * app thinks, and they have to work first: a person who has just typed STOP
   * is not starting a conversation, and filing it as one and carrying on
   * texting them is the exact failure the word exists to prevent.
   *
   * The reply is sent from here rather than left to the carrier, so that what
   * a client hears has our name on it, and so the answer and the record of it
   * happen together.
   */
  const intent = inboundIntent(body);
  if (intent !== "message") {
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", customer.organization_id)
      .maybeSingle();
    const business = org?.name ?? "Us";

    if (intent === "stop" || intent === "start") {
      await recordConsent({
        organizationId: customer.organization_id,
        customerId: customer.id,
        channel: "sms",
        state: intent === "stop" ? "revoked" : "granted",
        source: "reply",
        // The words themselves, and when. This is the sentence that answers
        // the only question anybody ever asks about a text somebody got.
        evidence: `Replied "${body.slice(0, 60)}" from ${from} on ${new Date().toISOString()}`,
      });
    }

    const reply =
      intent === "stop"
        ? stopConfirmation(business)
        : intent === "start"
          ? startConfirmation(business)
          : helpReply(business, env.twilioPhoneNumber || null);
    // Best effort: the opt-out is recorded either way, and a recorded opt-out
    // with no confirmation beats a confirmation with no opt-out.
    await sendSms(from, reply).catch(() => {});

    // Written into the thread as well, so the office sees it happen rather
    // than wondering why a client went quiet.
    await noteInThread(admin, customer, `${body} (handled automatically: ${intent})`).catch(() => {});
    return EMPTY_TWIML;
  }

  const { data: properties } = await admin.from("properties").select("id").eq("customer_id", customer.id);
  const propertyIds = (properties ?? []).map((p) => p.id);
  if (propertyIds.length === 0) return EMPTY_TWIML;

  const { data: jobs } = await admin
    .from("jobs")
    .select("id")
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false })
    .limit(1);
  const job = jobs?.[0];
  if (!job) return EMPTY_TWIML;

  await noteInThread(admin, customer, body);

  // Best-effort — the message is already saved either way.
  await notifyJobTeam(
    job.id,
    "client_messages",
    `${customer.name} replied: ${body.slice(0, 120)}`
  ).catch(() => {});

  return EMPTY_TWIML;
}

/**
 * A client's words, in the thread for their most recent job.
 *
 * An opt-out goes in here as well as into the consent record. The office
 * seeing "they replied STOP" is the difference between knowing why a client
 * went quiet and wondering.
 */
async function noteInThread(
  admin: ReturnType<typeof createAdminClient>,
  customer: { id: string; name: string; organization_id: string },
  body: string
): Promise<void> {
  const { data: properties } = await admin.from("properties").select("id").eq("customer_id", customer.id);
  const propertyIds = (properties ?? []).map((p) => p.id);
  if (propertyIds.length === 0) return;

  const { data: jobs } = await admin
    .from("jobs")
    .select("id")
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false })
    .limit(1);
  const job = jobs?.[0];
  if (!job) return;

  await admin.from("job_messages").insert({
    job_id: job.id,
    organization_id: customer.organization_id,
    channel: "external",
    author_type: "client",
    author_name: customer.name,
    body,
  });
}
