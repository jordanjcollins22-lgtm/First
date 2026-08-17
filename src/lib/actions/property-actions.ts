"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Best-effort — a property-data miss shouldn't block adding the property. */
async function attachPropertyDetails(
  supabase: SupabaseClient<Database>,
  propertyId: string,
  address: string
) {
  const details = await lookupPropertyDetails(address);
  if (!details) return;
  await supabase.from("properties").update({ sqft: details.sqft, acreage: details.acreage }).eq("id", propertyId);
}

export interface CreatePropertyInput {
  customerName: string;
  address: string;
  lat: number;
  lng: number;
  jobName?: string;
  /** Optional, but when the form does collect them they make the duplicate
   * check far more reliable than a name on its own. */
  customerEmail?: string | null;
  customerPhone?: string | null;
}

/**
 * Creates a Customer + Property + first Job in one step, matching the
 * ADDRESS -> PROPERTY APPEARS golden path: the estimator only ever types
 * a customer name and picks an address off the map search.
 *
 * Reuses an existing customer with the same name (case-insensitive, exact
 * match — not fuzzy) instead of creating a duplicate, and reuses an existing
 * property/job at the same address under that customer instead of forking a
 * second copy. This is what was silently missing before and produced things
 * like three separate "Amy Willig" records for the same house.
 */
export async function createPropertyAndJob(input: CreatePropertyInput) {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const trimmedName = input.customerName.trim();

  // Match against the whole book rather than an exact-text lookup, so a client
  // who booked online by email isn't entered a second time by name.
  const { data: existingCustomers, error: existingCustomerError } = await supabase
    .from("customers")
    .select("id, name, email, phone");
  if (existingCustomerError) throw existingCustomerError;

  const duplicateCustomer = findDuplicateCustomer(existingCustomers ?? [], {
    name: trimmedName,
    email: input.customerEmail,
    phone: input.customerPhone,
  });

  let customerId: string;
  if (duplicateCustomer) {
    customerId = duplicateCustomer.id;
    const patch = mergeableFields(
      { email: duplicateCustomer.email ?? null, phone: duplicateCustomer.phone ?? null },
      { email: input.customerEmail ?? null, phone: input.customerPhone ?? null }
    );
    if (Object.keys(patch).length > 0) {
      await supabase.from("customers").update(patch).eq("id", customerId);
    }
  } else {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .insert({ name: trimmedName, organization_id: organizationId })
      .select()
      .single();
    if (customerError) throw customerError;
    customerId = customer.id;
  }

  const { data: existingProperties, error: existingPropertyError } = await supabase
    .from("properties")
    .select("id, address")
    .eq("customer_id", customerId);
  if (existingPropertyError) throw existingPropertyError;

  const duplicateProperty = findDuplicateProperty(existingProperties ?? [], input.address);

  let propertyId: string;
  if (duplicateProperty) {
    propertyId = duplicateProperty.id;
  } else {
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .insert({
        customer_id: customerId,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
      })
      .select()
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;
    await attachPropertyDetails(supabase, propertyId, input.address);
  }

  const { data: existingJobs, error: existingJobsError } = await supabase
    .from("jobs")
    .select("id")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingJobsError) throw existingJobsError;

  if (existingJobs && existingJobs.length > 0) {
    redirect(`/jobs/${existingJobs[0].id}`);
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: input.jobName || `${input.address} — Estimate`,
    })
    .select()
    .single();
  if (jobError) throw jobError;

  redirect(`/jobs/${job.id}`);
}

/**
 * Deletes a property along with everything under it (jobs, canvas designs)
 * via cascading foreign keys. This is permanent — there is no undo.
 */
export async function deleteProperty(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("properties").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/attractors");
}

export async function updatePropertyAddress(id: string, input: { address: string; lat: number; lng: number }) {
  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("properties")
    .select("address")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;

  const { error } = await supabase
    .from("properties")
    .update({ address: input.address, lat: input.lat, lng: input.lng })
    .eq("id", id);
  if (error) throw error;

  const { data: jobsForProperty, error: jobsError } = await supabase
    .from("jobs")
    .select("id, name")
    .eq("property_id", id);
  if (jobsError) throw jobsError;

  // Job names are generated as "{address} — Estimate/Evaluation" at creation
  // time — keep them in sync when the address changes, but leave any job
  // whose name no longer starts with the old address (i.e. manually renamed)
  // alone.
  if (existing.address && existing.address !== input.address) {
    for (const job of jobsForProperty ?? []) {
      if (job.name?.startsWith(existing.address)) {
        const suffix = job.name.slice(existing.address.length);
        const { error: renameError } = await supabase
          .from("jobs")
          .update({ name: `${input.address}${suffix}` })
          .eq("id", job.id);
        if (renameError) throw renameError;
      }
    }
  }

  revalidatePath("/attractors");
  // Each job's site map page reads the property address server-side on
  // every load, but its cached route needs to be told to refetch too —
  // otherwise a corrected address (e.g. from a bad webhook value) can keep
  // showing the old one there even though it's already fixed everywhere else.
  for (const job of jobsForProperty ?? []) {
    revalidatePath(`/jobs/${job.id}`);
  }
}

/** Adds another property (address) under an existing client, instead of
 * creating a duplicate customer the way the standalone "New Property" form
 * does. Reuses an existing property at the same address under this customer
 * rather than forking a duplicate. */
export async function addPropertyForCustomer(
  customerId: string,
  input: { address: string; lat: number; lng: number }
) {
  const supabase = await createClient();

  const { data: existingProperties, error: existingPropertyError } = await supabase
    .from("properties")
    .select("id")
    .eq("customer_id", customerId)
    .ilike("address", input.address)
    .limit(1);
  if (existingPropertyError) throw existingPropertyError;
  if (existingProperties && existingProperties.length > 0) {
    revalidatePath("/attractors");
    return;
  }

  const { data: property, error } = await supabase
    .from("properties")
    .insert({ customer_id: customerId, address: input.address, lat: input.lat, lng: input.lng })
    .select()
    .single();
  if (error) throw error;

  await attachPropertyDetails(supabase, property.id, input.address);

  revalidatePath("/attractors");
}
