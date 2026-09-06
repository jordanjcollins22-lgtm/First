import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * One zone's walk: where to park, and the doors in the order to take them.
 *
 * Kept off the zones layer because a walk is hundreds of points and only
 * one zone is looked at at a time.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ zoneId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { zoneId } = await context.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hanger_zones")
    .select("id, name, mode, house_count, path_km, est_minutes, median_gap_m, walk_path, park_point, start_point, end_point, start_address")
    .eq("id", zoneId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such zone." }, { status: 404 });
  return NextResponse.json({ zone: data }, { headers: { "cache-control": "private, max-age=120" } });
}
