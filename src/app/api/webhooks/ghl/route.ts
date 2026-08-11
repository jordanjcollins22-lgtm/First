import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
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
 *   address / contact.address1 / location.address
 *   startTime / appointment.startTime / calendar.startTime / date
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
  const location = (body.location as Record<string, unknown>) ?? {};
  const calendar = (body.calendar as Record<string, unknown>) ?? {};

  const name =
    (contact.name as string) ||
    (body.full_name as string) ||
    [body.first_name, body.last_name].filter(Boolean).join(" ") ||
    (body.name as string) ||
    "GHL Lead";
  const email = (contact.email as string) || (body.email as string) || null;
  const phone = (contact.phone as string) || (body.phone as string) || null;
  const address =
    (body.address as string) || (contact.address1 as string) || (location.address as string) || null;
  const startTimeRaw =
    (body.startTime as string) ||
    (appointment.startTime as string) ||
    (calendar.startTime as string) ||
    (body.date as string) ||
    null;

  if (!address || !address.trim()) {
    return NextResponse.json({ error: "An address is required to create a property." }, { status: 400 });
  }

  const matches = await searchAddress(address);
  if (matches.length === 0) {
    return NextResponse.json({ error: `Couldn't geocode address: ${address}` }, { status: 400 });
  }
  const { lat, lng, fullAddress } = matches[0];

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
