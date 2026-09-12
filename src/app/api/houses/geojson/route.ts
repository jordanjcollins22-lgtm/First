import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { parseBbox } from "@/lib/house-geojson";

/**
 * Every house inside a viewport, for the map's "all addresses" toggle.
 *
 * Asked for by the map itself as it moves, once it is zoomed in far enough
 * for dots to be doors. Each answer is capped, so a viewport that somehow
 * covers half the county gets a sample rather than a stall. Only for people
 * who are signed in; the county's addresses are public, but our map of them
 * is not.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const bbox = parseBbox(request.nextUrl.searchParams);
  if (!bbox) return NextResponse.json({ error: "A viewport is needed: minLat, minLng, maxLat, maxLng." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("houses_in_bbox", {
    org: profile.organization_id,
    min_lat: bbox.minLat,
    min_lng: bbox.minLng,
    max_lat: bbox.maxLat,
    max_lng: bbox.maxLng,
    max_rows: 8000,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { id: string; address: string; lat: number; lng: number; untouched: boolean }[];
  return NextResponse.json(
    {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [row.lng, row.lat] },
        properties: { id: row.id, address: row.address, untouched: row.untouched },
      })),
      capped: rows.length >= 8000,
    },
    { headers: { "cache-control": "private, max-age=30" } }
  );
}
