import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { RELATIONSHIP_STAGES } from "@/lib/house-relationship";

/**
 * Every house on the map, as bare points.
 *
 * `[lng, lat, stage]` per house, where stage indexes RELATIONSHIP_STAGES. The
 * map fetches this once when the "every address" switch is turned on and does
 * its own clustering and colouring. Cached for a few minutes in the browser:
 * a house changing stage is worth waiting that long to see, and the county
 * changing is worth an import.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("houses_map_points", { org: profile.organization_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { points: data ?? [], stages: RELATIONSHIP_STAGES, generatedAt: new Date().toISOString() },
    { headers: { "cache-control": "private, max-age=300" } }
  );
}
