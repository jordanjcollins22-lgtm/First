import { createClient } from "@/lib/supabase/server";
import type { BusinessLocation, LocationArea } from "@/types/domain";

export async function listBusinessLocations(): Promise<BusinessLocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_locations").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as BusinessLocation[];
}

export async function listLocationAreas(): Promise<LocationArea[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("location_areas").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as LocationArea[];
}
