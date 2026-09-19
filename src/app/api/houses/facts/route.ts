import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

/**
 * Everything we know about one house, for the map's card.
 *
 * By id when the dot carried one, or by the point that was clicked when it
 * did not (the county's hundred thousand dots carry only their colour). One
 * database call either way.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const org = profile.organization_id;
  const supabase = await createClient();
  const params = request.nextUrl.searchParams;

  let id = params.get("id");
  if (!id) {
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "id, or lat and lng, is needed." }, { status: 400 });
    const { data, error } = await supabase.rpc("house_nearest", { org, at_lat: lat, at_lng: lng });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    id = data ?? null;
    if (!id) return NextResponse.json({ facts: null }, { headers: { "cache-control": "no-store" } });
  }

  const { data, error } = await supabase.rpc("house_facts", { org, the_house: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ facts: data ?? null }, { headers: { "cache-control": "no-store" } });
}
