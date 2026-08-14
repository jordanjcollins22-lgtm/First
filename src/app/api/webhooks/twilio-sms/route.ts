import Twilio from "twilio";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { last10Digits } from "@/lib/sms";
import { env, isTwilioConfigured } from "@/lib/env";

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

  await admin.from("job_messages").insert({
    job_id: job.id,
    organization_id: customer.organization_id,
    channel: "external",
    author_type: "client",
    author_name: customer.name,
    body,
  });

  return EMPTY_TWIML;
}
