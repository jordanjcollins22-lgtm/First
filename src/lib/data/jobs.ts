import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Customer, Job, Property } from "@/types/domain";

export interface JobWithLocation extends Job {
  property: Property & { customer: Customer };
}

/**
 * Read once per page. My Day asks for every job from four places (the
 * commission, the advances, the work, the reviews), and a page that
 * re-reads itself every minute was asking the database for the whole list
 * four times a minute per phone.
 */
const readJobsWithLocation = cache(async function readJobsWithLocation(): Promise<JobWithLocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, property:properties(*, customer:customers(*))")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as JobWithLocation[];
});

/** Every job, with its property (address/lat/lng) and customer joined in — reuses the
 * existing customers/properties/jobs data instead of a separate "project" table.
 * A list of its own for each caller, so sorting it cannot reorder anybody else's. */
export async function listJobsWithLocation(): Promise<JobWithLocation[]> {
  return [...(await readJobsWithLocation())];
}
