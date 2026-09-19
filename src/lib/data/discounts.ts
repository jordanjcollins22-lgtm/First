import { createClient } from "@/lib/supabase/server";
import type { Discount } from "@/types/domain";

export async function listDiscounts(): Promise<Discount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("discounts").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as Discount[];
}
