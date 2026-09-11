"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { reconcileProspects } from "@/lib/data/prospect-reconcile";
import { getCurrentProfile } from "@/lib/data/team";
import { describeDbError } from "@/lib/setup-errors";
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

  // This address may have been sitting on the cold-prospect list. Retire it
  // now rather than leaving them on a call sheet they've already come off.
  await reconcileProspects(supabase).catch(() => null);

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

/**
 * Where the property actually is, from somebody standing on it.
 *
 * Every address in this system is placed by geocoding what a client typed,
 * and geocoding is wrong often enough to matter. New builds are not in the
 * database. A long driveway puts the pin on the road. Cul-de-sacs are the
 * worst of it: a street named Court frequently geocodes to the mouth rather
 * than the house, so the whole close lands on one point and the satellite
 * photo comes back showing the wrong roof.
 *
 * Until now there was no way to correct that. The coordinates were written
 * once when the property was created and never again, so a bad placement was
 * permanent and every route, every map and every satellite photo inherited
 * it. The evaluator is the one person who can fix it, because they are
 * standing there.
 *
 * The address text is deliberately left alone. What is being corrected is
 * where the house is, not what it is called, and an evaluator's phone
 * reformatting a street name is not an improvement anybody asked for.
 */
export async function setPropertyLocation(input: {
  propertyId: string;
  lat: number;
  lng: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "Those numbers do not make a location." };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, message: "That is outside the range coordinates come in." };
  }
  // What an unfixed GPS reads. Saving it would put the property in the
  // Atlantic, and the next person to look would have no idea why.
  if (lat === 0 && lng === 0) {
    return { ok: false, message: "That reads as zero, zero, which is a GPS that has not fixed yet." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({ lat, lng, updated_at: new Date().toISOString() })
    .eq("id", input.propertyId);
  if (error) return { ok: false, message: error.message };

  // Everything that draws a map, plans a route or fetches a satellite photo
  // reads these two numbers, so the whole job view is stale the moment they
  // change.
  revalidatePath("/attractors");
  return { ok: true };
}

export interface ManualEvaluationInput {
  /** An existing contact, when the office picked one off the book. */
  customerId?: string | null;
  /** Or a new one, typed in. */
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  address: string;
  lat: number;
  lng: number;
  /** Local datetime from the form, as an ISO string. */
  startsAt: string;
  /** How long to hold. The calendar shows it and the clash check uses it. */
  minutes: number;
  /** Who is going. Optional: the office books first and assigns second often. */
  evaluatorId?: string | null;
  notes?: string | null;
}

export type BookedEvaluation =
  | { ok: true; jobId: string; message: string }
  | { ok: false; message: string };

/**
 * Booking an evaluation the way the office actually takes one: on the phone.
 *
 * Every evaluation in this system arrived through the client booking form,
 * which is the wrong shape for the call that actually books most of them.
 * Somebody rings, the person answering has the address and a diary, and the
 * only path open to them was to create a property, land on the job page, find
 * the schedule panel, and set a date there. Three screens for one phone call,
 * and the contact, the property and the appointment each had to be typed
 * somewhere different.
 *
 * So this is one call: who, where, when, and who is going. Everything it
 * touches goes through the same doors the rest of the app uses, so a client
 * booked by phone is indistinguishable from one who booked themselves.
 *
 * The clash check is the same one the calendar enforces. An office booking is
 * the easiest place to double-book somebody, because the person on the phone
 * is looking at a client rather than at a diary.
 */
export async function bookEvaluation(input: ManualEvaluationInput): Promise<BookedEvaluation> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const address = input.address.trim();
    if (!address) return { ok: false, message: "We need an address." };
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
      return { ok: false, message: "Pick the address from the suggestions so we can place it." };
    }

    const start = new Date(input.startsAt);
    if (Number.isNaN(start.getTime())) return { ok: false, message: "That is not a date and time." };

    const minutes = Math.max(15, Math.min(480, Math.round(Number(input.minutes) || 60)));
    const end = new Date(start.getTime() + minutes * 60_000);

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const customerId = await customerFor(supabase, organizationId, input);
    if (!customerId) return { ok: false, message: "We need a name, or a contact to book it under." };

    const propertyId = await propertyFor(supabase, customerId, address, input.lat, input.lng);

    // Checked before writing, not after. A refusal that has already created a
    // job leaves a half-booked appointment nobody asked for.
    if (input.evaluatorId) {
      const clash = await evaluationClash(supabase, input.evaluatorId, start, end);
      if (clash) return { ok: false, message: clash };
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        property_id: propertyId,
        name: `${address} — Estimate`,
        assigned_to: input.evaluatorId || null,
        evaluation_date: start.toISOString(),
        evaluation_end_date: end.toISOString(),
        evaluation_status: "scheduled",
        client_notes: input.notes?.trim() || null,
      })
      .select("id")
      .single();
    if (error || !job) return { ok: false, message: describeDbError(error) };

    // They have just stopped being a cold address on a call sheet.
    await reconcileProspects(supabase).catch(() => null);

    revalidatePath("/evaluations");
    revalidatePath("/attractors");
    revalidatePath("/pipeline");

    return {
      ok: true,
      jobId: job.id,
      message: `Booked for ${start.toLocaleString()}.`,
    };
  } catch (err) {
    console.error("bookEvaluation failed:", err);
    return { ok: false, message: "Couldn't book that." };
  }
}

/** The contact this is for: one they picked, or one they typed. */
async function customerFor(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  input: ManualEvaluationInput
): Promise<string | null> {
  if (input.customerId) return input.customerId;

  const name = input.customerName?.trim();
  if (!name) return null;

  // The same matcher every other door uses, so a client who rang in March does
  // not become a second person when they ring again in June.
  const { data: existing } = await supabase.from("customers").select("id, name, email, phone");
  const duplicate = findDuplicateCustomer(existing ?? [], {
    name,
    email: input.customerEmail ?? null,
    phone: input.customerPhone ?? null,
  });

  if (duplicate) {
    const patch = mergeableFields(
      { email: duplicate.email ?? null, phone: duplicate.phone ?? null },
      { email: input.customerEmail ?? null, phone: input.customerPhone ?? null }
    );
    if (Object.keys(patch).length > 0) {
      await supabase.from("customers").update(patch).eq("id", duplicate.id);
    }
    return duplicate.id;
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      organization_id: organizationId,
      name,
      email: input.customerEmail?.trim() || null,
      phone: input.customerPhone?.trim() || null,
      // Somebody with an evaluation booked is a lead until the work is sold.
      contact_type: "lead",
      source: "Booked by phone",
    })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("no customer");
  return created.id;
}

/** Their property at this address, reused rather than duplicated. */
async function propertyFor(
  supabase: SupabaseClient<Database>,
  customerId: string,
  address: string,
  lat: number,
  lng: number
): Promise<string> {
  const { data: properties } = await supabase
    .from("properties")
    .select("id, address")
    .eq("customer_id", customerId);

  const duplicate = findDuplicateProperty(properties ?? [], address);
  if (duplicate) return duplicate.id;

  const { data: property, error } = await supabase
    .from("properties")
    .insert({ customer_id: customerId, address, lat, lng })
    .select("id")
    .single();
  if (error || !property) throw error ?? new Error("no property");

  await attachPropertyDetails(supabase, property.id, address).catch(() => null);
  return property.id;
}

/**
 * Whether this evaluator is already out somewhere at that time.
 *
 * The same rule the calendar enforces, applied here because an office booking
 * is the easiest place to create a double booking: the person on the phone is
 * looking at a client, not at a diary.
 */
async function evaluationClash(
  supabase: SupabaseClient<Database>,
  evaluatorId: string,
  start: Date,
  end: Date
): Promise<string | null> {
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const { data } = await supabase
    .from("jobs")
    .select("id, name, evaluation_date, evaluation_end_date, assigned_to, evaluation_status")
    .eq("assigned_to", evaluatorId)
    .not("evaluation_date", "is", null)
    .gte("evaluation_date", dayStart.toISOString())
    .lte("evaluation_date", dayEnd.toISOString());

  for (const row of data ?? []) {
    if (row.evaluation_status === "cancelled") continue;
    const theirStart = new Date(row.evaluation_date as string);
    const theirEnd = row.evaluation_end_date
      ? new Date(row.evaluation_end_date as string)
      : new Date(theirStart.getTime() + 60 * 60_000);
    // Touching is not overlapping: a visit ending at ten and the next starting
    // at ten is a back-to-back day, not a double booking.
    if (start < theirEnd && theirStart < end) {
      return `They are already out at ${theirStart.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })} that day. Pick another time or another evaluator.`;
    }
  }
  return null;
}
