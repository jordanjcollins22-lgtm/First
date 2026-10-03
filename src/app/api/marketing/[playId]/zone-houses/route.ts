import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * Every house in a round's zone, and whether it is currently on the round.
 *
 * The door list can only show what is already on the round, which is why the
 * only edit it ever allowed was taking doors off. To put one back somebody has
 * to be able to see the houses that are not on it — so this returns the whole
 * zone, flagged, and the map draws the difference.
 */
export interface ZoneHouse {
  id: string;
  address: string;
  lat: number;
  lng: number;
  /** True when this door is on the round as it stands. */
  on: boolean;
}

export async function GET(_request: Request, { params }: { params: Promise<{ playId: string }> }) {
  const { playId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ houses: [] as ZoneHouse[] }, { status: 401 });

  const supabase = await createClient();
  const { data: play } = await supabase
    .from("marketing_plays")
    .select("zone_id, targets")
    .eq("id", playId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();

  if (!play?.zone_id) return NextResponse.json({ houses: [] as ZoneHouse[] });

  const targets = new Set(((play.targets ?? []) as string[]).map(String));

  const { data } = await supabase
    .from("zone_houses")
    .select("house_id, houses(id, address, lat, lng)")
    .eq("zone_id", play.zone_id as string)
    .limit(3000);

  const houses: ZoneHouse[] = ((data ?? []) as unknown as {
    house_id: string;
    houses: { id: string; address: string | null; lat: number | null; lng: number | null } | null;
  }[])
    .map((row) => row.houses)
    .filter((h): h is { id: string; address: string | null; lat: number; lng: number } =>
      h != null && h.lat != null && h.lng != null
    )
    .map((h) => ({ id: h.id, address: h.address ?? "", lat: h.lat, lng: h.lng, on: targets.has(h.id) }));

  return NextResponse.json({ houses }, { headers: { "Cache-Control": "no-store" } });
}
