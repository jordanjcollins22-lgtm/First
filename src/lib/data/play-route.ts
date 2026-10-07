import { createClient } from "@/lib/supabase/server";

/**
 * One round's doors, in the order somebody should walk them.
 *
 * The order comes from the zone's own walk — the same optimal path the map
 * draws — rather than from the order the doors were chosen in, which is
 * nearest-the-client-first and would have somebody crossing the same street
 * eleven times.
 */

export interface RouteDoor {
  id: string;
  address: string;
  lat: number;
  lng: number;
}

export interface PlayRoute {
  zoneName: string | null;
  mode: string | null;
  /** Where to leave the van, when the zone has been walked. */
  park: { lat: number; lng: number } | null;
  /** False when the zone has never been walked, so the order is the fallback one. */
  walked: boolean;
  /** True when a person said what order this is walked in. */
  byHand: boolean;
  doors: RouteDoor[];
}

export async function playRoute(playId: string): Promise<PlayRoute | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("marketing_play_route", { the_play: playId });
  if (error) throw error;
  const raw = (data ?? null) as PlayRoute | null;
  if (!raw || !Array.isArray(raw.doors)) return null;
  return {
    zoneName: raw.zoneName ?? null,
    mode: raw.mode ?? null,
    park: raw.park ?? null,
    walked: Boolean(raw.walked),
    byHand: Boolean(raw.byHand),
    doors: raw.doors,
  };
}
