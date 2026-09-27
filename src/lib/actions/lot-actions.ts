"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { lotForProperty } from "@/lib/data/lot-map";
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
