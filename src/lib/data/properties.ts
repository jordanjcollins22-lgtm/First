import { createClient } from "@/lib/supabase/server";
import type { Customer, Property } from "@/types/domain";

export interface PropertyWithCustomer extends Property {
  customer: Customer;
}

export async function listProperties(): Promise<PropertyWithCustomer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*, customer:customers(*)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as PropertyWithCustomer[];
}

export async function getProperty(
  id: string
): Promise<PropertyWithCustomer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*, customer:customers(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as unknown as PropertyWithCustomer | null;
}
