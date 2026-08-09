import { createClient } from "@/lib/supabase/server";
import type {
  CalculatedMeasurements,
  Job,
  Photo,
  WorkArea,
  WorkAreaGeometry,
  Zone,
} from "@/types/domain";

import type { PropertyWithCustomer } from "./properties";

export interface JobWithProperty extends Job {
  property: PropertyWithCustomer;
}

export interface WorkAreaWithPhotos extends WorkArea {
  photos: Photo[];
}

export interface JobWorkspace {
  job: JobWithProperty;
  zones: Zone[];
  workAreas: WorkAreaWithPhotos[];
}

export async function getJobWorkspace(
  jobId: string
): Promise<JobWorkspace | null> {
  const supabase = await createClient();

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("*, property:properties(*, customer:customers(*))")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) throw jobError;
  if (!jobRow) return null;

  const [{ data: zoneRows, error: zoneError }, { data: waRows, error: waError }] =
    await Promise.all([
      supabase
        .from("zones")
        .select("*")
        .eq("job_id", jobId)
        .order("sequence_order", { ascending: true, nullsFirst: false }),
      supabase
        .from("work_areas")
        .select("*, photos(*)")
        .eq("job_id", jobId)
        .order("sequence_order", { ascending: true, nullsFirst: false }),
    ]);

  if (zoneError) throw zoneError;
  if (waError) throw waError;

  return {
    job: jobRow as unknown as JobWithProperty,
    zones: (zoneRows ?? []) as unknown as Zone[],
    workAreas: (waRows ?? []) as unknown as WorkAreaWithPhotos[],
  };
}

export function parseWorkAreaGeometry(row: WorkArea): WorkAreaGeometry {
  return row.geometry;
}

export function parseCalculatedMeasurements(
  row: WorkArea
): CalculatedMeasurements | null {
  return row.calculated_measurements;
}
