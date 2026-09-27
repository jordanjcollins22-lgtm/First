import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { areaNeeds, boardState, stepsFor, tipsFor, type AreaNeeds, type AreaState, type AreaStep, type Tip } from "@/lib/area-work";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { WorkZone } from "@/components/canvas/types";

export interface AreaBoardData {
  meId: string | null;
  /** The area this person is in now, if any. */
  myZoneId: string | null;
  states: AreaState[];
  /** zoneId -> the service's steps with who ticked them. */
  steps: Record<string, { step: AreaStep; doneBy: string | null }[]>;
  tips: Record<string, Tip[]>;
  tools: Record<string, string[]>;
}

/**
 * The on-site board for one job: who is in which area, which kits are where,
 * and each area's steps. Read fresh every time, because two phones are
 * changing it. Shared by the crew sheet and the actions that change it, so
 * a tap is judged against the same board the screen showed.
 */
export async function loadAreaBoard(
  jobId: string,
  loaded: { zones: WorkZone[]; catalog: Pick<CanvasCatalog, "tools" | "serviceTools">; photos: { zone_id: string | null; kind: string }[] }
): Promise<AreaBoardData> {
  const supabase = await createClient();
  const { zones, catalog, photos } = loaded;
  // The board: who is where, which kit is in which area, and each area's
  // steps. Read fresh every time, because two phones are changing it.
  const [{ data: workRows }, { data: stepRows }, me] = await Promise.all([
    supabase.from("job_area_work").select("zone_id, profile_id, kits, profiles:profile_id(full_name, email)").eq("job_id", jobId).is("left_at", null),
    supabase.from("job_area_steps").select("zone_id, step_key, profiles:done_by(full_name, email)").eq("job_id", jobId),
    getCurrentProfile().catch(() => null),
  ]);
  const personName = (p: { full_name: string | null; email: string } | null) => (p?.full_name || p?.email || "Somebody").split(/\s+/)[0];
  const working = ((workRows ?? []) as unknown as { zone_id: string; profile_id: string; kits: number[]; profiles: { full_name: string | null; email: string } | null }[]).map((row) => ({
    zoneId: row.zone_id,
    profileId: row.profile_id,
    name: personName(row.profiles),
    kits: row.kits ?? [],
  }));
  const tickRows = (stepRows ?? []) as unknown as { zone_id: string; step_key: string; profiles: { full_name: string | null; email: string } | null }[];
  const ticked = new Map<string, Set<string>>();
  for (const row of tickRows) ticked.set(row.zone_id, new Set([...(ticked.get(row.zone_id) ?? []), row.step_key]));
  const toolRefs = catalog.tools.map((t) => ({ id: t.id, name: t.name, kits: ((t as unknown as { kits?: number[] | null }).kits ?? []) as number[] }));
  const needs = new Map<string, AreaNeeds>(zones.map((zone) => [zone.id, areaNeeds(zone.service!.typeId, catalog.serviceTools, toolRefs)]));
  return {
    meId: me?.id ?? null,
    myZoneId: working.find((w) => w.profileId === me?.id)?.zoneId ?? null,
    states: boardState({
      zones: zones.map((zone) => ({ id: zone.id, name: zone.name, serviceTypeId: zone.service!.typeId })),
      needs,
      working,
      ticked,
      photos: photos.map((photo) => ({ zoneId: photo.zone_id, kind: photo.kind })),
    }),
    steps: Object.fromEntries(
      zones.map((zone) => [
        zone.id,
        stepsFor(zone.service!.typeId).map((step) => ({
          step,
          doneBy: (() => {
            const row = tickRows.find((r) => r.zone_id === zone.id && r.step_key === step.key);
            return row ? personName(row.profiles) : null;
          })(),
        })),
      ])
    ),
    tips: Object.fromEntries(zones.map((zone) => [zone.id, tipsFor(zone.service!.typeId)])),
    tools: Object.fromEntries(zones.map((zone) => [zone.id, needs.get(zone.id)?.tools ?? []])),
  };
}
