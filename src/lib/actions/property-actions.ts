"use server";

import { redirect } from "next/navigation";

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
