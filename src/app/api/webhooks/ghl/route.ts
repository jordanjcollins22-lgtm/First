import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { firstAcceptable } from "@/lib/geocode-guard";
import { searchAddress } from "@/lib/mapbox-geocoding";
import { isSupabaseAdminConfigured } from "@/lib/env";

/**
 * GoHighLevel webhook — call this from a GHL workflow on "Appointment
 * Booked" (evaluation booked) to auto-create the customer/property/job
 * here, with the appointment time saved as the job's evaluation date.
 *
 * Payload field names are matched loosely since GHL's webhook shape varies
 * by workflow/trigger config — send whichever of these you have:
 *   name / full_name / first_name+last_name / contact.name
 *   email / contact.email
 *   phone / contact.phone
 *   address / full_address / contact.address1 / contact.full_address
 *   startTime / appointment.startTime / calendar.startTime / date
 *
 * NOTE: "location" in a GHL payload is your own business/sub-account, not
 * the customer — location.address is deliberately never used as a
 * customer-address fallback here.
 *
 * Optional shared-secret check: set GHL_WEBHOOK_SECRET in the environment,
 * then send it back as the "x-webhook-secret" header on the GHL side.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin not configured on the server." }, { status: 500 });
  }

  const expectedSecret = process.env.GHL_WEBHOOK_SECRET;
  if (expectedSecret && request.headers.get("x-webhook-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contact = (body.contact as Record<string, unknown>) ?? {};
  const appointment = (body.appointment as Record<string, unknown>) ?? {};
  const calendar = (body.calendar as Record<string, unknown>) ?? {};

  const name =
    (contact.name as string) ||
    (body.full_name as string) ||
    [body.first_name, body.last_name].filter(Boolean).join(" ") ||
    (body.name as string) ||
    "GHL Lead";
  const email = (contact.email as string) || (body.email as string) || null;
  const phone = (contact.phone as string) || (body.phone as string) || null;
  // Deliberately does NOT fall back to location.address — in a GHL payload
  // "location" is your own business/sub-account, not the customer, and
  // using it here previously created properties at the company's own
  // address instead of the customer's.
  const address =
    (body.address as string) ||
    (body.full_address as string) ||
    (contact.address1 as string) ||
    (contact.full_address as string) ||
    (contact.address as string) ||
    null;
  const startTimeRaw =
    (body.startTime as string) ||
    (appointment.startTime as string) ||
    (calendar.startTime as string) ||
    (body.date as string) ||
    null;

  if (!address || !address.trim()) {
    return NextResponse.json(
      {
        error: "No customer address found in the payload. Add the contact's address field to the GHL workflow.",
        receivedKeys: Object.keys(body),
        receivedContactKeys: Object.keys(contact),
      },
      { status: 400 }
    );
  }

  // Checked rather than taken. A thin address matches a real street in the
  // wrong state, and this path writes a property with nobody looking — which
  // is how pins for a Harford County business ended up across the continent.
  const matches = await searchAddress(address, undefined, { autocomplete: false });
  const checked = firstAcceptable(address, matches);
  if (!checked.match) {
    return NextResponse.json(
      { error: `Couldn't place that address: ${address}. ${checked.reason ?? ""}`.trim() },
      { status: 400 }
    );
  }
  const { lat, lng, fullAddress } = checked.match;

  const evaluationDate = startTimeRaw && !isNaN(Date.parse(startTimeRaw)) ? new Date(startTimeRaw).toISOString() : null;

  const supabase = createAdminClient();

  let customerId: string | null = null;
  if (email) {
    const { data: existing } = await supabase.from("customers").select("id").eq("email", email).maybeSingle();
    customerId = existing?.id ?? null;
  }
  if (!customerId) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .insert({ name, email, phone })
      .select()
      .single();
    if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 });
    customerId = customer.id;
  }

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .insert({ customer_id: customerId, address: fullAddress, lat, lng })
    .select()
    .single();
  if (propertyError) return NextResponse.json({ error: propertyError.message }, { status: 500 });

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      property_id: property.id,
      name: `${fullAddress} — Evaluation`,
      status: "estimating",
      evaluation_date: evaluationDate,
    })
    .select()
    .single();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  return NextResponse.json({ ok: true, customerId, propertyId: property.id, jobId: job.id });
}
