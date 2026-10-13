import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCurrentProfile } from "@/lib/data/team";
import { loadAssets } from "@/lib/data/equipment";
import { untyped } from "@/lib/data/purchasing";
import { dateKeyIn } from "@/lib/time-zone";
import { EquipmentUsageLog, type UsageLogMachine } from "@/components/equipment/equipment-usage-log";

/**
 * The crew's end-of-day hours and miles form, ready to drop onto a page.
 *
 * Loads the business's machines and what this person already logged today,
 * and renders nothing when there are no machines or the equipment tables
 * aren't there yet, so mounting it early is harmless.
 */
export async function CrewEquipmentLog() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const organizationId = await getCurrentOrganizationId();
  const sb = untyped(await createClient());
  const assets = await loadAssets(sb, organizationId);
  if (assets.length === 0) return null;

  const { data: logs, error } = await sb
    .from("equipment_usage_logs")
    .select("asset_id, reading, used_hours")
    .eq("profile_id", profile.id)
    .eq("day", dateKeyIn(new Date()));
  if (error) return null;
  const mine = new Map(((logs ?? []) as { asset_id: string; reading: number | null; used_hours: number | null }[]).map((l) => [l.asset_id, l]));

  const machines: UsageLogMachine[] = assets.map((a) => {
    const log = mine.get(a.id);
    return {
      id: a.id,
      name: a.name,
      meter: a.meter,
      current: a.meter === "miles" ? a.mileage : a.engineHours,
      loggedToday: log ? Number((a.meter === "none" ? log.used_hours : log.reading) ?? null) || null : null,
    };
  });
  return <EquipmentUsageLog machines={machines} />;
}
