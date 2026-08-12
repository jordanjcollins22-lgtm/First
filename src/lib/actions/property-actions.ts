"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface CreatePropertyInput {
  customerName: string;
  address: string;
  lat: number;
  lng: number;
  jobName?: string;
}

/**
 * Creates a Customer + Property + first Job in one step, matching the
 * ADDRESS -> PROPERTY APPEARS golden path: the estimator only ever types
 * a customer name and picks an address off the map search.
 */
export async function createPropertyAndJob(input: CreatePropertyInput) {
  const supabase = await createClient();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({ name: input.customerName })
    .select()
    .single();
  if (customerError) throw customerError;

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .insert({
      customer_id: customer.id,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
    })
    .select()
    .single();
  if (propertyError) throw propertyError;

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      property_id: property.id,
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
  const { error } = await supabase
    .from("properties")
    .update({ address: input.address, lat: input.lat, lng: input.lng })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/attractors");
}

/** Adds another property (address) under an existing client, instead of
 * creating a duplicate customer the way the standalone "New Property" form
 * does. */
export async function addPropertyForCustomer(
  customerId: string,
  input: { address: string; lat: number; lng: number }
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .insert({ customer_id: customerId, address: input.address, lat: input.lat, lng: input.lng });
  if (error) throw error;
  revalidatePath("/attractors");
}
