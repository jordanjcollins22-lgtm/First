"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function addOverheadExpense(input: { name: string; amount: number; note?: string | null }) {
  const supabase = await createClient();
  const { error } = await supabase.from("overhead_expenses").insert({
    name: input.name,
    amount: input.amount,
    note: input.note ?? null,
  });
  if (error) throw error;
  revalidatePath("/admin/overhead");
}

export async function updateOverheadExpense(
  id: string,
  input: { name?: string; amount?: number; note?: string | null }
) {
  const supabase = await createClient();
  const { error } = await supabase.from("overhead_expenses").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/overhead");
}

export async function deleteOverheadExpense(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("overhead_expenses").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/overhead");
}
