import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { designsAvailable } from "@/lib/actions/house-coverage-actions";
import { nextDesign } from "@/lib/hanger-design";
import { houseTargetsOf, KIND_LABEL, shortAddress, type MarketingPlay, type PlayKind } from "@/lib/marketing-plays";

/**
 * The doors of one play, as a spreadsheet to carry.
 *
 * For the hangers: every door in the order the walk reaches them from the
 * house, with how many it has had and which design it gets. For the
 * knocks: the five doors. Sorted as chosen, not by address, because the
 * order is the walk.
 */
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ playId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { playId } = await context.params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("marketing_plays_list", { org: profile.organization_id, include_done: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const play = ((Array.isArray(data) ? data : []) as unknown as MarketingPlay[]).find((p) => p.id === playId);
  if (!play) return NextResponse.json({ error: "No such play." }, { status: 404 });
  const ids = houseTargetsOf(play);
  if (ids.length === 0) return NextResponse.json({ error: "This play has no doors." }, { status: 400 });

  const [{ data: houses, error: housesError }, { data: hangs }, designs] = await Promise.all([
    supabase.from("houses").select("id, address, lat, lng").in("id", ids),
    supabase.from("door_hanger_events").select("house_id").in("house_id", ids),
    designsAvailable(),
  ]);
  if (housesError) return NextResponse.json({ error: housesError.message }, { status: 500 });
  const byId = new Map((houses ?? []).map((h) => [h.id, h]));
  const counts = new Map<string, number>();
  for (const h of hangs ?? []) counts.set(h.house_id, (counts.get(h.house_id) ?? 0) + 1);

  const lines = [
    ["Order", "Address", "Hangers so far", "Design to hang", "Latitude", "Longitude"].join(","),
    ...ids.map((id, index) => {
      const house = byId.get(id);
      const had = counts.get(id) ?? 0;
      return [index + 1, csvCell(house?.address ?? ""), had, nextDesign(had, designs), house?.lat ?? "", house?.lng ?? ""].join(",");
    }),
  ];

  const label = KIND_LABEL[play.kind as PlayKind] ?? play.kind;
  const safeName = `${label} ${shortAddress(play.address)}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "doors";
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}.csv"`,
      "cache-control": "no-store",
    },
  });
}
