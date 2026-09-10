"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import { freeOf } from "@/lib/busy";
import { SLOT_MINUTES } from "@/lib/booking-availability";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { BUDGET_RANGES } from "@/lib/booking-budget-ranges";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { reconcileProspects } from "@/lib/data/prospect-reconcile";
import { modeForAddress, type EvaluationMode } from "@/lib/evaluation-mode";
import { chooseEvaluator, type EvaluatorDay } from "@/lib/evaluator-choice";

export interface SubmitPublicBookingInput {
  organizationId: string;
  referredByProfileId: string | null;
  /** Every evaluator who was free at this slot when the client picked it — the
   * server re-checks each in order and books the first still free. */
  candidateEvaluatorIds: string[];
  date: string;
  time: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  requestedServiceTypeIds: string[];
  notes: string;
  budgetRange: string;
  /** The code off a posted recommendation link, if this came through one. */
  referralCode?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one write path for the public /book flow — no logged-in user exists,
 * so this runs entirely on the service-role client (same pattern as the GHL
 * webhook). Re-validates everything server-side since none of it can be
 * trusted from the client.
 */
export async function submitPublicBooking(
  input: SubmitPublicBookingInput
): Promise<{ jobId: string; mode: EvaluationMode }> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const address = input.address.trim();

  if (!firstName || !lastName) throw new Error("Enter your first and last name.");
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
  if (!phone) throw new Error("Enter a phone number.");
  if (!address || typeof input.lat !== "number" || typeof input.lng !== "number") {
    throw new Error("Select your address from the search results.");
  }
  // Optional, and it has to actually be optional. The form has said so since
  // the brackets were added, but this refused a blank one — so anybody who
  // skipped the question lost the appointment on the final click, which is
  // the exact failure the "Not sure yet" bracket was added to prevent.
  const budgetRange = input.budgetRange?.trim() ?? "";
  if (budgetRange && !BUDGET_RANGES.includes(budgetRange as (typeof BUDGET_RANGES)[number])) {
    throw new Error("Select a budget range.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    throw new Error("Select a date and time.");
  }
  if (input.candidateEvaluatorIds.length === 0) {
    throw new Error("That time is no longer available — please pick another.");
  }

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (orgError) throw orgError;
  if (!org) throw new Error("This booking link isn't valid anymore.");

  const evaluationDateTime = new Date(`${input.date}T${input.time}:00`);
  if (Number.isNaN(evaluationDateTime.getTime())) throw new Error("Select a date and time.");
  const iso = evaluationDateTime.toISOString();

  // Re-checked at submit, not merely when the slots were drawn: a booking page
  // can sit open on somebody's phone for an hour, and two people can be on it
  // at once. This used to compare the exact timestamp only, so an appointment
  // that merely overlapped — or a whole day the crew were on an install —
  // sailed straight through.
  const end = new Date(evaluationDateTime.getTime() + SLOT_MINUTES * 60_000);
  const blocks = await getBusyBlocksAsAdmin().catch(() => []);

  const stillFree = freeOf(blocks, input.candidateEvaluatorIds, { start: evaluationDateTime, end });
  if (stillFree.length === 0) throw new Error("That time was just booked — please pick another.");

  // Which of the free ones, rather than whichever the database named first.
  // That used to decide it, so one person collected the bookings and the rest
  // waited. Now it goes to whoever is already going that way, and failing
  // that to whoever has the lightest day.
  const choice = chooseEvaluator(stillFree, await daysFor(admin, stillFree, input.date), {
    lat: input.lat,
    lng: input.lng,
  });
  if (!choice) throw new Error("That time was just booked — please pick another.");
  const evaluatorId = choice.evaluatorId;

  const { data: activeServices, error: servicesError } = await admin
    .from("services")
    .select("service_type_id")
    .eq("organization_id", input.organizationId)
    .eq("status", "active");
  if (servicesError) throw servicesError;
  const validServiceIds = new Set((activeServices ?? []).map((s) => s.service_type_id));
  const requestedServiceIds = input.requestedServiceTypeIds.filter((id) => validServiceIds.has(id));

  const { data: existingCustomers, error: existingCustomerError } = await admin
    .from("customers")
    .select("id, name, email, phone")
    .eq("organization_id", input.organizationId);
  if (existingCustomerError) throw existingCustomerError;

  // Same matcher the office uses, so a booking lands on the existing client
  // record whether we know them by email, phone, or name.
  const duplicateCustomer = findDuplicateCustomer(existingCustomers ?? [], {
    name: `${firstName} ${lastName}`,
    email,
    phone,
  });

  let customerId: string;
  if (duplicateCustomer) {
    customerId = duplicateCustomer.id;
    // Fills blanks only. A booking form shouldn't overwrite a phone number or
    // spelling the office already corrected by hand.
    const patch = mergeableFields(
      {
        name: duplicateCustomer.name ?? null,
        email: duplicateCustomer.email ?? null,
        phone: duplicateCustomer.phone ?? null,
      },
      { name: `${firstName} ${lastName}`, email, phone }
    );
    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await admin.from("customers").update(patch).eq("id", customerId);
      if (updateError) throw updateError;
    }
  } else {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ name: `${firstName} ${lastName}`, email, phone, organization_id: input.organizationId })
      .select()
      .single();
    if (customerError) throw customerError;
    customerId = customer.id;
  }

  const { data: existingProperties, error: existingPropertyError } = await admin
    .from("properties")
    .select("id, address")
    .eq("customer_id", customerId);
  if (existingPropertyError) throw existingPropertyError;

  const duplicateProperty = findDuplicateProperty(existingProperties ?? [], address);

  let propertyId: string;
  if (duplicateProperty) {
    propertyId = duplicateProperty.id;
  } else {
    const { data: property, error: propertyError } = await admin
      .from("properties")
      .insert({ customer_id: customerId, address, lat: input.lat, lng: input.lng })
      .select()
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const details = await lookupPropertyDetails(address).catch(() => null);
    if (details) {
      await admin.from("properties").update({ sqft: details.sqft, acreage: details.acreage }).eq("id", propertyId);
    }
  }

  // Decided here as well as in the browser. The client is told which kind of
  // evaluation they are getting before they pick a time, but what is written
  // down is worked out from the coordinates on the server, where nobody can
  // edit it into a free visit three states away.
  const mode = modeForAddress(input.lat, input.lng);

  // Only a code we actually issued. Anybody can put ?rec=whatever in a URL,
  // and a made-up code stored on a job would show up as a booking credited to
  // a group nobody ever posted in.
  const referralCode = await knownReferralCode(admin, input.organizationId, input.referralCode);

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: `${address} — Estimate`,
      assigned_to: evaluatorId,
      evaluation_date: iso,
      evaluation_status: "scheduled",
      evaluation_mode: mode.mode,
      referral_code: referralCode,
      client_notes: input.notes.trim() || null,
      budget_range: budgetRange || null,
      referred_by_profile_id: input.referredByProfileId,
    })
    .select()
    .single();
  if (jobError) throw jobError;

  if (requestedServiceIds.length > 0) {
    const { error: requestedError } = await admin.from("job_requested_services").insert(
      requestedServiceIds.map((serviceTypeId) => ({
        job_id: job.id,
        organization_id: input.organizationId,
        service_type_id: serviceTypeId,
      }))
    );
    if (requestedError) throw requestedError;
  }

  // They've just become a client — take them off the cold-prospect list now
  // rather than at the next nightly sweep.
  await reconcileProspects(admin).catch(() => null);

  return { jobId: job.id, mode: mode.mode };
}

/**
 * What each candidate's day already looks like, so the choice is informed.
 *
 * One read for the lot rather than one per person. Coordinates come along
 * because "is anybody already going that way" is the first question, and they
 * never leave the server — the client is told who is coming, not where
 * anybody else lives.
 */
async function daysFor(
  admin: ReturnType<typeof createAdminClient>,
  evaluatorIds: string[],
  date: string
): Promise<EvaluatorDay[]> {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const { data: rows } = await admin
    .from("jobs")
    .select("assigned_to, evaluation_date, properties(lat, lng)")
    .in("assigned_to", evaluatorIds)
    .gte("evaluation_date", dayStart.toISOString())
    .lt("evaluation_date", dayEnd.toISOString());

  const visits = new Map<string, { lat: number | null; lng: number | null }[]>();
  for (const raw of rows ?? []) {
    const row = raw as unknown as {
      assigned_to: string | null;
      properties: { lat: number | null; lng: number | null } | null;
    };
    if (!row.assigned_to) continue;
    const list = visits.get(row.assigned_to) ?? [];
    list.push({ lat: row.properties?.lat ?? null, lng: row.properties?.lng ?? null });
    visits.set(row.assigned_to, list);
  }

  // When nobody is nearby and the days are equally light, it goes to whoever
  // has waited longest, so it rotates instead of settling on one name.
  const { data: latest } = await admin
    .from("jobs")
    .select("assigned_to, created_at")
    .in("assigned_to", evaluatorIds)
    .not("evaluation_date", "is", null)
    .order("created_at", { ascending: false });

  const lastBooked = new Map<string, string>();
  for (const row of (latest ?? []) as { assigned_to: string | null; created_at: string }[]) {
    if (row.assigned_to && !lastBooked.has(row.assigned_to)) {
      lastBooked.set(row.assigned_to, row.created_at);
    }
  }

  return evaluatorIds.map((id) => ({
    evaluatorId: id,
    visits: visits.get(id) ?? [],
    lastBookedAt: lastBooked.get(id) ?? null,
  }));
}

/**
 * The recommendation code off the link, if it is one of ours.
 *
 * Checked rather than trusted. A code nobody issued, stored on a job, becomes
 * a booking credited to a group nobody ever posted in — which is worse than
 * no attribution at all, because somebody would act on it.
 */
async function knownReferralCode(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  code: string | null | undefined
): Promise<string | null> {
  const wanted = (code ?? "").trim().toLowerCase();
  if (!wanted || wanted.length > 32) return null;
  const { data } = await admin
    .from("recommendations")
    .select("code")
    .eq("organization_id", organizationId)
    .eq("code", wanted)
    .maybeSingle();
  return data?.code ?? null;
}
