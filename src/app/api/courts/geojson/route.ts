import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { COURT_COLUMNS, courtFromRow } from "@/lib/data/operations-targets";
import { rankCourts, courtTitle, topReasons } from "@/lib/court-score";

/**
 * The courts as the map draws them: an outline each, coloured by verdict,
 * best first. Fetched only when the layer is switched on, because thirteen
 * hundred rings is more than a page should carry on the off chance.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const top = Math.max(10, Math.min(2000, Number(request.nextUrl.searchParams.get("top")) || 300));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("court_targets")
    .select(`${COURT_COLUMNS}, outline, custom_outline`)
    .eq("organization_id", profile.organization_id)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = Parameters<typeof courtFromRow>[0] & { outline: number[][]; custom_outline: number[][] | null };
  const rows = (data ?? []) as unknown as Row[];
  // A ring somebody drew beats the one the build guessed.
  const outlines = new Map(rows.map((r) => [r.id, r.custom_outline ?? r.outline]));
  const edited = new Set(rows.filter((r) => r.custom_outline).map((r) => r.id));
  const ranked = rankCourts(rows.map(courtFromRow)).filter((c) => !c.skip).slice(0, top);

  const features = ranked.map((c) => ({
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [outlines.get(c.id) ?? []] },
    properties: {
      id: c.id,
      rank: c.rank,
      score: c.score,
      verdict: c.verdict,
      title: courtTitle(c),
      houses: c.houseCount,
      clients: c.clients,
      value: c.assessedMedian,
      reasons: topReasons(c.parts).join(" · "),
      edited: edited.has(c.id),
      touched: c.touched,
      jobsDone: c.jobsDone,
      ownerPct: c.ownershipKnown > 0 ? Math.round((100 * c.ownerOccupied) / c.ownershipKnown) : null,
      detached: c.detached,
      townhouse: c.townhouse,
      condo: c.condo,
      spreadM: c.spreadM,
      shopKm: c.shopKm,
      parts: c.parts,
      lat: c.lat,
      lng: c.lng,
    },
  }));

  return NextResponse.json({ type: "FeatureCollection", features }, { headers: { "cache-control": "private, max-age=300" } });
}
