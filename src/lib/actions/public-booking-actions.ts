"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { BUDGET_RANGES } from "@/lib/booking-budget-ranges";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { reconcileProspects } from "@/lib/data/prospect-reconcile";

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
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one write path for the public /book flow — no logged-in user exists,
 * so this runs entirely on the service-role client (same pattern as the GHL
 * webhook). Re-validates everything server-side since none of it can be
 * trusted from the client.
 */
export async function submitPublicBooking(input: SubmitPublicBookingInput): Promise<{ jobId: string }> {
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
  if (!BUDGET_RANGES.includes(input.budgetRange as (typeof BUDGET_RANGES)[number])) {
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

  let evaluatorId: string | null = null;
  for (const candidate of input.candidateEvaluatorIds) {
    const { data: conflict, error } = await admin
      .from("jobs")
      .select("id")
      .eq("assigned_to", candidate)
      .eq("evaluation_date", iso)
      .neq("status", "cancelled")
      .limit(1);
    if (error) throw error;
    if (!conflict || conflict.length === 0) {
      evaluatorId = candidate;
      break;
    }
  }
  if (!evaluatorId) throw new Error("That time was just booked — please pick another.");

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

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: `${address} — Estimate`,
      assigned_to: evaluatorId,
      evaluation_date: iso,
      evaluation_status: "scheduled",
      client_notes: input.notes.trim() || null,
      budget_range: input.budgetRange,
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

  return { jobId: job.id };
}
