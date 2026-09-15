import { createClient } from "@/lib/supabase/server";
import type { ServicePricing } from "@/types/domain";

export async function listServicePricing(): Promise<ServicePricing[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("services").select("*");

  if (error) throw error;
  return (data ?? []) as unknown as ServicePricing[];
}
