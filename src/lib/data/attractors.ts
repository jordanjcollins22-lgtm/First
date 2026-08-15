import { createClient } from "@/lib/supabase/server";
import type { AttractorType, AttractorVariant, AttractorWave } from "@/types/domain";

export async function listAttractorTypes(): Promise<AttractorType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("attractor_types").select("*").order("label");
  if (error) throw error;
  return (data ?? []) as unknown as AttractorType[];
}

export async function listAttractorVariants(): Promise<AttractorVariant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("attractor_variants").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as AttractorVariant[];
}

export async function listAttractorWaves(): Promise<AttractorWave[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attractor_waves")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AttractorWave[];
}
