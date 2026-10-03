"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { mergeableFields, normalizeName } from "@/lib/dedupe";
import type { AttractorGeometry, LocationAreaGeometryType } from "@/types/domain";

const PATH = "/attractors";

export async function createBusinessLocation(input: { name: string; address: string | null; lat: number; lng: number }) {
  if (!input.name.trim()) throw new Error("Name the location.");
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw new Error("Pick a location on the map.");

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  // "The Shop" typed again from the inline picker shouldn't become a second
  // location — reuse the existing one and fill in anything it was missing.
  const { data: existing } = await supabase.from("business_locations").select("id, name, address");
  const duplicate = (existing ?? []).find((l) => normalizeName(l.name) === normalizeName(input.name));

  if (duplicate) {
    const patch = mergeableFields({ address: duplicate.address ?? null }, { address: input.address ?? null });
    if (Object.keys(patch).length > 0) {
      await supabase.from("business_locations").update(patch).eq("id", duplicate.id);
    }
  } else {
    const { error } = await supabase.from("business_locations").insert({
      organization_id: organizationId,
      name: input.name.trim(),
      address: input.address,
      lat: input.lat,
      lng: input.lng,
    });
    if (error) throw error;
  }
  revalidatePath(PATH);
  // Inventory's "Stored at" picker reads the same locations.
  revalidatePath("/admin/tools");
  revalidatePath("/admin/inventory-setup");
}

export async function updateBusinessLocation(id: string, input: { name?: string; address?: string | null }) {
  const patch: { name?: string; address?: string | null } = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.address !== undefined) patch.address = input.address;
  if (Object.keys(patch).length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.from("business_locations").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath(PATH);
}

export async function deleteBusinessLocation(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("business_locations").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(PATH);
}

export interface CreateLocationAreaInput {
  locationId: string;
  name: string;
  geometryType: LocationAreaGeometryType;
  geometry: AttractorGeometry;
  notes: string | null;
}

export async function createLocationArea(input: CreateLocationAreaInput) {
  if (!input.name.trim()) throw new Error("Name the area.");

  const supabase = await createClient();
  const { error } = await supabase.from("location_areas").insert({
    location_id: input.locationId,
    name: input.name.trim(),
    geometry_type: input.geometryType,
    geometry: input.geometry,
    notes: input.notes,
  });
  if (error) throw error;
  revalidatePath(PATH);
}

interface LocationAreaPatch {
  name?: string;
  geometry_type?: LocationAreaGeometryType;
  geometry?: AttractorGeometry;
  notes?: string | null;
}

export async function updateLocationArea(
  id: string,
  input: { name?: string; geometryType?: LocationAreaGeometryType; geometry?: AttractorGeometry; notes?: string | null }
) {
  const patch: LocationAreaPatch = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.geometryType !== undefined) patch.geometry_type = input.geometryType;
  if (input.geometry !== undefined) patch.geometry = input.geometry;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.from("location_areas").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath(PATH);
}

export async function deleteLocationArea(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("location_areas").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(PATH);
}
