"use server";

import { revalidatePath } from "next/cache";
import type { Feature, Geometry } from "geojson";

import { createClient } from "@/lib/supabase/server";
import { areaDeltaPercent, calculateMeasurements } from "@/lib/measurement";
import { cleanUpShape } from "@/lib/geometry-cleanup";
import type { CalculatedMeasurements } from "@/types/domain";

async function getJobIdForWorkArea(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workAreaId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("work_areas")
    .select("job_id")
    .eq("id", workAreaId)
    .maybeSingle();
  return data?.job_id ?? null;
}

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/crew`);
}

export interface CreateWorkAreaInput {
  jobId: string;
  serviceTemplateId: string;
  geometry: Feature<Geometry>;
}

export async function createWorkArea(input: CreateWorkAreaInput) {
  const supabase = await createClient();
  const measurements = calculateMeasurements(input.geometry);

  const { data, error } = await supabase
    .from("work_areas")
    .insert({
      job_id: input.jobId,
      service_template_id: input.serviceTemplateId,
      geometry: input.geometry,
      calculated_measurements: measurements,
      status: "draft",
    })
    .select()
    .single();

  if (error) throw error;
  revalidateJob(input.jobId);
  return data;
}

export interface UpdateWorkAreaGeometryInput {
  workAreaId: string;
  geometry: Feature<Geometry>;
}

/**
 * Updates a WorkArea's geometry. If the geometry was previously locked
 * (its measurements were already used for a price sent to the customer),
 * the pre-edit locked state is preserved in
 * work_area_geometry_versions before the new geometry is applied, the
 * version counter is bumped, and the lock is cleared — this is a
 * detectable new state, never a silent overwrite of numbers a quote was
 * already based on.
 */
export async function updateWorkAreaGeometry(input: UpdateWorkAreaGeometryInput) {
  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("work_areas")
    .select("*")
    .eq("id", input.workAreaId)
    .single();
  if (fetchError) throw fetchError;

  let nextVersion = existing.geometry_version;

  if (existing.geometry_locked_at) {
    const { error: versionError } = await supabase
      .from("work_area_geometry_versions")
      .insert({
        work_area_id: existing.id,
        version: existing.geometry_version,
        geometry: existing.geometry,
        cleaned_geometry: existing.cleaned_geometry,
        calculated_measurements: existing.calculated_measurements,
        locked_at: existing.geometry_locked_at,
        reason: "Superseded by edit after geometry lock",
      });
    if (versionError) throw versionError;
    nextVersion = existing.geometry_version + 1;
  }

  const measurements = calculateMeasurements(input.geometry, {
    version: nextVersion,
  });

  const { error: updateError } = await supabase
    .from("work_areas")
    .update({
      geometry: input.geometry,
      cleaned_geometry: null,
      calculated_measurements: measurements,
      geometry_version: nextVersion,
      geometry_locked_at: null,
    })
    .eq("id", input.workAreaId);
  if (updateError) throw updateError;

  revalidateJob(existing.job_id);
}

export async function updateWorkAreaServiceTemplate(
  workAreaId: string,
  serviceTemplateId: string
) {
  const supabase = await createClient();
  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  const { error } = await supabase
    .from("work_areas")
    .update({ service_template_id: serviceTemplateId })
    .eq("id", workAreaId);
  if (error) throw error;
  if (jobId) revalidateJob(jobId);
}

export async function updateWorkAreaNotes(workAreaId: string, notes: string) {
  const supabase = await createClient();
  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  const { error } = await supabase
    .from("work_areas")
    .update({ notes })
    .eq("id", workAreaId);
  if (error) throw error;
  if (jobId) revalidateJob(jobId);
}

export async function deleteWorkArea(workAreaId: string) {
  const supabase = await createClient();
  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  const { error } = await supabase.from("work_areas").delete().eq("id", workAreaId);
  if (error) throw error;
  if (jobId) revalidateJob(jobId);
}

export interface CleanupPreview {
  cleanedGeometry: Feature<Geometry>;
  areaDeltaPercent: number | null;
  autoApplied: boolean;
  requiresConfirmation: boolean;
}

export async function previewShapeCleanup(
  workAreaId: string
): Promise<CleanupPreview> {
  const supabase = await createClient();
  const { data: existing, error } = await supabase
    .from("work_areas")
    .select("geometry")
    .eq("id", workAreaId)
    .single();
  if (error) throw error;

  const result = cleanUpShape(existing.geometry as Feature<Geometry>);
  return {
    cleanedGeometry: result.cleaned,
    areaDeltaPercent: result.areaDeltaPercent,
    autoApplied: result.autoApplied,
    requiresConfirmation: result.requiresConfirmation,
  };
}

export async function applyShapeCleanup(
  workAreaId: string,
  cleanedGeometry: Feature<Geometry>
) {
  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("work_areas")
    .select("geometry, geometry_version")
    .eq("id", workAreaId)
    .single();
  if (fetchError) throw fetchError;

  // Re-verify the delta server-side rather than trusting the client value.
  const delta = areaDeltaPercent(
    existing.geometry as Feature<Geometry>,
    cleanedGeometry
  );

  const measurements: CalculatedMeasurements = calculateMeasurements(
    cleanedGeometry,
    { source: "cleaned", version: existing.geometry_version }
  );

  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  const { error } = await supabase
    .from("work_areas")
    .update({
      cleaned_geometry: cleanedGeometry,
      calculated_measurements: measurements,
    })
    .eq("id", workAreaId);
  if (error) throw error;
  if (jobId) revalidateJob(jobId);

  return { areaDeltaPercent: delta };
}

/**
 * Simulates the moment a price is sent to a customer for this WorkArea's
 * current measurements. Locks the geometry so a later edit is forced to
 * go through the versioning path above instead of silently changing the
 * numbers the quote was based on. The pricing engine itself is future
 * work; this lock is the architectural seam it will hang off of.
 */
export async function lockWorkAreaGeometry(workAreaId: string) {
  const supabase = await createClient();
  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  const { error } = await supabase
    .from("work_areas")
    .update({ geometry_locked_at: new Date().toISOString(), status: "priced" })
    .eq("id", workAreaId);
  if (error) throw error;
  if (jobId) revalidateJob(jobId);
}

export async function assignWorkAreaZone(workAreaId: string, zoneId: string | null) {
  const supabase = await createClient();
  const jobId = await getJobIdForWorkArea(supabase, workAreaId);
  const { error } = await supabase
    .from("work_areas")
    .update({ zone_id: zoneId })
    .eq("id", workAreaId);
  if (error) throw error;
  if (jobId) revalidateJob(jobId);
}
