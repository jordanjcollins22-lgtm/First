"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function updateCustomerContact(
  customerId: string,
  input: { email: string | null; phone: string | null }
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ email: input.email, phone: input.phone })
    .eq("id", customerId);
  if (error) throw error;
  revalidatePath("/attractors");
}
