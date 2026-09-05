import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { designsAvailable } from "@/lib/actions/house-coverage-actions";
import { shapeFor } from "@/lib/coverage-shape";
import { RELATIONSHIP_STAGES, STAGE_LABEL } from "@/lib/house-relationship";
import type { AttractorGeometry, AttractorGeometryType } from "@/types/domain";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The door list for a wave, as a spreadsheet.
 *
 * What the person walking it carries: every address inside the shape, where
 * it stands with us, how many hangers it has already had, which design it
 * gets next, and whether to skip it. Sorted by address so a street reads as
 * a run of numbers.
 */
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ waveId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { waveId } = await context.params;
  const supabase = await createClient();
  const { data: wave, error } = await supabase
    .from("attractor_waves")
    .select("name, geometry_type, geometry")
    .eq("id", waveId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!wave) return NextResponse.json({ error: "No such wave." }, { status: 404 });

  const shape = shapeFor(wave.geometry_type as AttractorGeometryType, wave.geometry as AttractorGeometry);
  if (!shape) return NextResponse.json({ error: "This wave has no shape to count inside." }, { status: 400 });

  const { data, error: listError } = await supabase.rpc("houses_door_list", {
    org: profile.organization_id,
    ring: (shape.ring ?? null) as Json,
    zips: (shape.zips ?? null) as Json,
    designs: await designsAvailable(),
    max_rows: 20000,
  });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  const rows = (data ?? []) as [string, string, number, number, boolean, number, number, number][];
  const lines = [
    ["Address", "Where we stand", "Hangers so far", "Design to hang", "Skip", "Latitude", "Longitude"].join(","),
    ...rows.map(([, address, rank, hangs, dnc, design, lat, lng]) =>
      [
        csvCell(address),
        csvCell(STAGE_LABEL[RELATIONSHIP_STAGES[rank] ?? "untouched"]),
        hangs,
        dnc ? "" : design,
        dnc ? "SKIP (asked not to be contacted)" : "",
        lat,
        lng,
      ].join(",")
    ),
  ];

  const safeName = (wave.name as string).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "wave";
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="door-list-${safeName}.csv"`,
      "cache-control": "no-store",
    },
  });
}
