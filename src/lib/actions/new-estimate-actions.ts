"use server";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { modeForAddress } from "@/lib/evaluation-mode";
import { lookupAddress } from "@/lib/mapbox-geocoding";
import { isOwnerLevel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export interface NewEstimateInput {
  /** An existing client, when started from their page. */
  customerId?: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
}

export type NewEstimateResult = { ok: true; token: string; jobId: string } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The account manager starts an estimate for anyone: a new client or one we
 * already have. Finds or makes the client, their property (placed on the map
 * from the address) and a new job, then hands back the estimate map's link,
 * the same map and prices a client gets from the booking page.
 */
export async function startNewEstimate(input: NewEstimateInput): Promise<NewEstimateResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again, then try." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the owner or an account manager can start an estimate." };
  }

  const name = input.name.trim().replace(/\s+/g, " ");
  const phone = input.phone.trim() || null;
  const email = input.email.trim().toLowerCase() || null;
  const typed = input.address.trim();
  if (!name) return { ok: false, error: "Put in the client's name." };
  if (!typed) return { ok: false, error: "Put in the property's address." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look right." };

  // The map needs the house on it, so the address has to be found first.
  const found = await lookupAddress(typed, undefined, { autocomplete: false });
  if (!found.ok) return { ok: false, error: "The address lookup isn't answering right now. Try again in a minute." };
  const place = found.suggestions[0];
  if (!place) return { ok: false, error: "Couldn't find that address. Add the town and zip and try again." };
  const address = place.fullAddress.replace(/, United States$/, "");

  const admin = createAdminClient();
  const org = profile.organization_id;

  // The client: the one they started from, or a match on name, email or phone, or a new one.
  let customerId: string | null = null;
  if (input.customerId) {
    const { data } = await admin.from("customers").select("id, name, email, phone").eq("id", input.customerId).eq("organization_id", org).maybeSingle();
    if (data) {
      customerId = data.id;
      const patch = mergeableFields({ name: data.name ?? null, email: data.email ?? null, phone: data.phone ?? null }, { name, email, phone });
      if (Object.keys(patch).length) await admin.from("customers").update(patch).eq("id", data.id);
    }
  }
  if (!customerId) {
    const { data: existing, error } = await admin.from("customers").select("id, name, email, phone").eq("organization_id", org);
    if (error) return { ok: false, error: "Couldn't read the client list. Try again." };
    const dupe = findDuplicateCustomer(existing ?? [], { name, email, phone });
    if (dupe) {
      customerId = dupe.id;
      const patch = mergeableFields({ name: dupe.name ?? null, email: dupe.email ?? null, phone: dupe.phone ?? null }, { name, email, phone });
      if (Object.keys(patch).length) await admin.from("customers").update(patch).eq("id", dupe.id);
    } else {
      const { data: made, error: madeError } = await admin
        .from("customers")
        .insert({
          name,
          email,
          phone,
          organization_id: org,
          source: "Added by account manager",
          ...(isAccountManager(profile.roles) ? { account_manager_id: profile.id } : {}),
        })
        .select("id")
        .single();
      if (madeError || !made) return { ok: false, error: "Couldn't save the client. Try again." };
      customerId = made.id;
    }
  }

  // Their property at that address.
  const { data: props } = await admin.from("properties").select("id, address").eq("customer_id", customerId);
  let propertyId = findDuplicateProperty(props ?? [], address)?.id ?? null;
  if (!propertyId) {
    const { data: prop, error } = await admin.from("properties").insert({ customer_id: customerId, address, lat: place.lat, lng: place.lng }).select("id").single();
    if (error || !prop) return { ok: false, error: "Couldn't save the address. Try again." };
    propertyId = prop.id;
  }

  // An estimate already open at this house, with no proposal on it yet, is
  // the one to carry on with. Pressing New estimate again used to start a
  // fresh empty job each time, and the client's page filled up with copies.
  const { data: open } = await admin
    .from("jobs")
    .select("id, job_proposals(id)")
    .eq("property_id", propertyId)
    .eq("status", "estimating")
    .order("created_at", { ascending: false });
  const unproposed = (open ?? []).filter((j) => !(j.job_proposals ?? []).length).map((j) => j.id);
  const { data: paid } = unproposed.length
    ? await admin.from("job_estimates").select("job_id").in("job_id", unproposed).not("paid_at", "is", null)
    : { data: [] };
  const paidIds = new Set((paid ?? []).map((e) => e.job_id));
  const reuse = unproposed.find((id) => !paidIds.has(id));
  if (reuse) {
    const { data: intake } = await admin.from("evaluation_intakes").upsert({ organization_id: org, job_id: reuse }, { onConflict: "job_id" }).select("token").single();
    if (intake) return { ok: true, token: intake.token, jobId: reuse };
  }

  // A new job to price.
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({ property_id: propertyId, name: `${address}, Estimate`, evaluation_mode: modeForAddress(place.lat, place.lng, address).mode })
    .select("id")
    .single();
  if (jobError || !job) return { ok: false, error: "Couldn't start the job. Try again." };

  const { data: intake, error: intakeError } = await admin
    .from("evaluation_intakes")
    .upsert({ organization_id: org, job_id: job.id }, { onConflict: "job_id" })
    .select("token")
    .single();
  if (intakeError || !intake) return { ok: false, error: "Couldn't open the estimate map. Try again." };
  return { ok: true, token: intake.token, jobId: job.id };
}
