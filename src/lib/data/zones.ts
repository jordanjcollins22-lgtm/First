import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { ZoneProperties } from "@/lib/zones";

export interface ZoneRow extends ZoneProperties {
  builtAt: string | null;
  /** How many of the zone's doors are homes, apartments, businesses, and so on. */
  kinds?: Record<string, number>;
}

/** Every built zone, without its outline: what the list needs. */
export async function listZones(): Promise<ZoneRow[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return [];
  // Kept by the database and refreshed after builds, not worked out per page.
  const { data, error } = await supabase.rpc("summary_get", { org, the_key: "zones_list" });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as ZoneRow[];
}
