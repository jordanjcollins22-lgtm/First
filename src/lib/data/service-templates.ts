import { createClient } from "@/lib/supabase/server";
import type { ServiceTemplate } from "@/types/domain";

export async function listServiceTemplates(): Promise<ServiceTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_templates")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as ServiceTemplate[];
}

export async function getServiceTemplate(
  id: string
): Promise<ServiceTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as unknown as ServiceTemplate | null;
}
