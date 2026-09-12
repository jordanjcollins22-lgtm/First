import { createClient } from "@/lib/supabase/server";

/** service_type_id -> field_key -> previously-typed "Other" values, in the order they were added. */
export type CustomFieldOptions = Record<string, Record<string, string[]>>;

export async function listCustomFieldOptions(): Promise<CustomFieldOptions> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_field_options")
    .select("service_type_id, field_key, value")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const options: CustomFieldOptions = {};
  for (const row of data ?? []) {
    const byField = (options[row.service_type_id] ??= {});
    (byField[row.field_key] ??= []).push(row.value);
  }
  return options;
}
