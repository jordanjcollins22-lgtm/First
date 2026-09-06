import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * Every door-hanger zone as the map draws it: outline, mode, counts, parking.
 *
 * The outlines are a partition -- no two overlap and every house is inside
 * one -- so the county reads as a tiling coloured by how each zone is done:
 * on foot, on a scooter, or from a vehicle.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("zones_geojson", { org: profile.organization_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { type: "FeatureCollection", features: [] }, { headers: { "cache-control": "private, max-age=120" } });
}
