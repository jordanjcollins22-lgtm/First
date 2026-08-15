import { createClient } from "@/lib/supabase/server";
import type { OverheadExpense } from "@/types/domain";

export async function listOverheadExpenses(): Promise<OverheadExpense[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("overhead_expenses").select("*").order("created_at");

  if (error) throw error;
  return (data ?? []) as unknown as OverheadExpense[];
}
