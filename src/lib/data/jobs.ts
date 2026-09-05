import { createClient } from "@/lib/supabase/server";
import type { Customer, Job, Property } from "@/types/domain";

export interface JobWithLocation extends Job {
  property: Property & { customer: Customer };
}

/** Every job, with its property (address/lat/lng) and customer joined in — reuses the
 * existing customers/properties/jobs data instead of a separate "project" table. */
export async function listJobsWithLocation(): Promise<JobWithLocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, property:properties(*, customer:customers(*))")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as JobWithLocation[];
}
