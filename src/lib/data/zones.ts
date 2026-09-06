import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { ZoneProperties } from "@/lib/zones";

export interface ZoneRow extends ZoneProperties {
  builtAt: string | null;
}

/** Every built zone, without its outline: what the list needs. */
export async function listZones(): Promise<ZoneRow[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return [];
  const { data, error } = await supabase.rpc("zones_list", { org });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as ZoneRow[];
}
