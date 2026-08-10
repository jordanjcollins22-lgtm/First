"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

/**
 * Remembers a value typed into an "Other" field so it shows up as a normal
 * pick next time instead of requiring "Other" + retyping the explanation.
 */
export async function addCustomFieldOption(serviceTypeId: string, fieldKey: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_options")
    .upsert(
      { service_type_id: serviceTypeId, field_key: fieldKey, value: trimmed },
      { onConflict: "service_type_id,field_key,value", ignoreDuplicates: true }
    );
  if (error) throw error;
  revalidatePath("/canvas");
}
