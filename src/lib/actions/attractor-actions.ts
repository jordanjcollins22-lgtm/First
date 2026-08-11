"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { AttractorGeometry, AttractorGeometryType, AttractorWaveStatus } from "@/types/domain";

const PATH = "/attractors";

export async function addAttractorType(label: string) {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Enter a type name.");
  const id = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!id) throw new Error("Enter a type name.");

  const supabase = await createClient();
  const { error } = await supabase.from("attractor_types").insert({ id, label: trimmed });
  if (error) {
    if (error.code === "23505") throw new Error("That type already exists.");
    throw error;
  }
  revalidatePath(PATH);
}

export async function deleteAttractorType(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("attractor_types").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") throw new Error("A wave is still using this type — change it first.");
    throw error;
  }
  revalidatePath(PATH);
}

export async function addAttractorVariant(typeId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a variant name.");

  const supabase = await createClient();
  const { error } = await supabase.from("attractor_variants").insert({ type_id: typeId, name: trimmed });
  if (error) {
    if (error.code === "23505") throw new Error("That variant already exists for this type.");
    throw error;
  }
  revalidatePath(PATH);
}

export async function deleteAttractorVariant(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("attractor_variants").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") throw new Error("A wave is still using this variant — change it first.");
    throw error;
  }
  revalidatePath(PATH);
}

export interface CreateAttractorWaveInput {
  typeId: string;
  variantId: string | null;
  name: string;
  geometryType: AttractorGeometryType;
  geometry: AttractorGeometry;
  datePlanned: string | null;
  status: AttractorWaveStatus;
  quantityDeployed: number | null;
  notes: string | null;
}

export async function createAttractorWave(input: CreateAttractorWaveInput) {
  if (!input.name.trim()) throw new Error("Name the wave.");

  const supabase = await createClient();
  const { error } = await supabase.from("attractor_waves").insert({
    type_id: input.typeId,
    variant_id: input.variantId,
    name: input.name.trim(),
    geometry_type: input.geometryType,
    geometry: input.geometry,
    date_planned: input.datePlanned,
    status: input.status,
    quantity_deployed: input.quantityDeployed,
    notes: input.notes,
  });
  if (error) throw error;
  revalidatePath(PATH);
}

export interface UpdateAttractorWaveInput {
  name?: string;
  variantId?: string | null;
  geometryType?: AttractorGeometryType;
  geometry?: AttractorGeometry;
  datePlanned?: string | null;
  dateCompleted?: string | null;
  quantityDeployed?: number | null;
  status?: AttractorWaveStatus;
  notes?: string | null;
  leadsGenerated?: number | null;
  projectsGenerated?: number | null;
  revenueGenerated?: number | null;
}

interface AttractorWavePatch {
  name?: string;
  variant_id?: string | null;
  geometry_type?: AttractorGeometryType;
  geometry?: AttractorGeometry;
  date_planned?: string | null;
  date_completed?: string | null;
  quantity_deployed?: number | null;
  status?: AttractorWaveStatus;
  notes?: string | null;
  leads_generated?: number | null;
  projects_generated?: number | null;
  revenue_generated?: number | null;
}

export async function updateAttractorWave(id: string, input: UpdateAttractorWaveInput) {
  const patch: AttractorWavePatch = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.variantId !== undefined) patch.variant_id = input.variantId;
  if (input.geometryType !== undefined) patch.geometry_type = input.geometryType;
  if (input.geometry !== undefined) patch.geometry = input.geometry;
  if (input.datePlanned !== undefined) patch.date_planned = input.datePlanned;
  if (input.dateCompleted !== undefined) patch.date_completed = input.dateCompleted;
  if (input.quantityDeployed !== undefined) patch.quantity_deployed = input.quantityDeployed;
  if (input.status !== undefined) patch.status = input.status;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.leadsGenerated !== undefined) patch.leads_generated = input.leadsGenerated;
  if (input.projectsGenerated !== undefined) patch.projects_generated = input.projectsGenerated;
  if (input.revenueGenerated !== undefined) patch.revenue_generated = input.revenueGenerated;
  if (Object.keys(patch).length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.from("attractor_waves").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath(PATH);
}

export async function deleteAttractorWave(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("attractor_waves").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(PATH);
}

export async function setJobSourceAttractorWave(jobId: string, waveId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ source_attractor_wave_id: waveId }).eq("id", jobId);
  if (error) throw error;
  revalidatePath(PATH);
}
