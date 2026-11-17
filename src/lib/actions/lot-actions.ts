"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { fetchLotFromCounty, lotForProperty } from "@/lib/data/lot-map";
import type { LotData } from "@/lib/lot-map";

/**
 * The county's lot for a job's property: the property line and the house.
 * Read through the signed-in person's own access to the job, then from our
 * copy, or from the county the first time.
 */
export async function countyLotForJob(jobId: string): Promise<LotData | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("property_id").eq("id", jobId).maybeSingle();
  if (!job?.property_id) return null;
  return lotForProperty(job.property_id);
}

/**
 * The county's lot for any address, for the owner trying the form out.
 * Nothing is kept: this is a look, not a property. Signed in only, so the
 * public demo page is not a way to query the county for strangers.
 */
export async function demoLotForAddress(input: { lat: number; lng: number; address: string }): Promise<{ lot: LotData | null } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to the app to try an address." };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return { error: "That address has no location." };
  const lot = await fetchLotFromCounty(input.lat, input.lng, input.address).catch(() => null);
  return { lot };
}
