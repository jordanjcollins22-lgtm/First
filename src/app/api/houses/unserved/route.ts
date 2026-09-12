import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * The houses no USPS route's streets come near, as bare points.
 *
 * `[lng, lat, id, address]` per house. A few thousand at most, so one
 * answer; the map draws them in their own colour so a walker can see the
 * doors beside a route that the route misses, and a subdivision that no
 * route has caught up with yet reads as a patch of them.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("summary_get", { org: profile.organization_id, the_key: "houses_unserved_points" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { points: data ?? [], generatedAt: new Date().toISOString() },
    { headers: { "cache-control": "private, max-age=120" } }
  );
}
