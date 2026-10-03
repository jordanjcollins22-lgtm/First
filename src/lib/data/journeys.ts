import { createClient } from "@/lib/supabase/server";
import type { Journey, JourneyStep } from "@/types/domain";

export async function listJourneys(): Promise<Journey[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("journeys").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as Journey[];
}

export async function listJourneySteps(journeyId: string): Promise<JourneyStep[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journey_steps")
    .select("*")
    .eq("journey_id", journeyId)
    .order("order_index");
  if (error) throw error;
  return (data ?? []) as unknown as JourneyStep[];
}
