"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { findDuplicateCustomer, findDuplicateProperty } from "@/lib/dedupe";
import { lookupAddress } from "@/lib/mapbox-geocoding";
import { log } from "@/lib/log";

export type AddLeadResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * A lead somebody on the team brought in: a neighbor of the job they are on,
 * or more work for the client in front of them. It lands as a new job with
 * their name on it as the referrer, which is what pays them the affiliate's
 * 4% if it sells, and a note on it saying what they were told. The office
 * books the evaluation from the pipeline as with any other new lead.
 *
 * Nothing is sent to the client and nobody is alerted from here.
 */
export async function addBroughtInLead(input: {
  kind: "neighbor" | "more_work";
  name: string;
  phone: string;
  address: string;
  note: string;
  /** For more work: the job they are on, whose client and address it is. */
  jobId?: string | null;
}): Promise<AddLeadResult> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const admin = createAdminClient();
  const who = (profile.full_name || profile.email).split(/\s+/)[0];
  const note = input.note.trim().slice(0, 1000);

  let propertyId: string;
  let label: string;

  if (input.kind === "more_work") {
    if (!input.jobId) return { ok: false, message: "Pick the job you're on." };
    if (!note) return { ok: false, message: "Say what extra work they want." };
    const { data: job } = await admin.from("jobs").select("property_id, properties(address, customers(name, organization_id))").eq("id", input.jobId).maybeSingle();
    const owner = (job?.properties as unknown as { address: string; customers: { name: string; organization_id: string } } | null) ?? null;
    if (!job || !owner || owner.customers.organization_id !== profile.organization_id) return { ok: false, message: "Couldn't find that job." };
    propertyId = job.property_id;
    label = `More work for ${owner.customers.name}`;
  } else {
    const name = input.name.trim();
    const address = input.address.trim();
    if (!name) return { ok: false, message: "Add their name." };
    if (!address) return { ok: false, message: "Add their address." };
    const found = await lookupAddress(address, undefined, { autocomplete: false }).catch(() => null);
    const place = found && found.ok ? found.suggestions[0] : null;
    if (!place) return { ok: false, message: "Couldn't find that address. Check it and try again." };

    const { data: customers } = await admin.from("customers").select("id, name, email, phone").eq("organization_id", profile.organization_id);
    const existing = findDuplicateCustomer(customers ?? [], { name, phone: input.phone.trim() || null, email: null });
    let customerId = existing?.id ?? null;
    if (!customerId) {
      const { data: made, error } = await admin
        .from("customers")
        .insert({ organization_id: profile.organization_id, name, phone: input.phone.trim() || null })
        .select("id")
        .single();
      if (error || !made) return { ok: false, message: "Couldn't save that lead. Try again." };
      customerId = made.id;
    }
    const { data: properties } = await admin.from("properties").select("id, address").eq("customer_id", customerId);
    const sameHouse = findDuplicateProperty(properties ?? [], place.fullAddress);
    if (sameHouse) {
      propertyId = sameHouse.id;
    } else {
      const { data: made, error } = await admin
        .from("properties")
        .insert({ customer_id: customerId, address: place.fullAddress, lat: place.lat, lng: place.lng })
        .select("id")
        .single();
      if (error || !made) return { ok: false, message: "Couldn't save that address. Try again." };
      propertyId = made.id;
    }
    label = `${name}, from ${who}`;
  }

  const { data: job, error } = await admin
    .from("jobs")
    .insert({ property_id: propertyId, name: label, referred_by_profile_id: profile.id })
    .select("id")
    .single();
  if (error || !job) {
    log.warn("brought_in.not_saved", { error: error?.message });
    return { ok: false, message: "Couldn't save that lead. Try again." };
  }

  const said = [
    input.kind === "neighbor" ? `Lead from ${who}: a neighbor of one of our jobs.` : `Lead from ${who}: more work for this client.`,
    input.phone.trim() ? `Phone: ${input.phone.trim()}` : null,
    note ? `What they want: ${note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  await admin.from("job_messages").insert({
    job_id: job.id,
    organization_id: profile.organization_id,
    channel: "internal",
    author_type: "team",
    author_profile_id: profile.id,
    author_name: profile.full_name || profile.email,
    body: said,
  });

  revalidatePath("/my-day");
  return { ok: true, message: "Saved. The office will book their free evaluation, and it's on your list below." };
}
