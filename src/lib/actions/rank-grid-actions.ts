"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { env } from "@/lib/env";
import { buildGrid, type GridSize, type ScanPoint } from "@/lib/rank-grid";

export type RankResult =
  | { ok: true; message?: string; scanId?: string }
  | { ok: false; message: string };

/** A phrase worth knowing where we stand on. */
export async function addKeyword(phrase: string): Promise<RankResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!phrase.trim()) return { ok: false, message: "What phrase?" };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase
      .from("rank_keywords")
      .upsert(
        {
          organization_id: organizationId,
          phrase: phrase.trim().toLowerCase(),
          active: true,
          created_by: profile.id,
        },
        { onConflict: "organization_id,phrase" }
      );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/attractors");
    return { ok: true, message: "Tracking it." };
  } catch (err) {
    console.error("addKeyword failed:", err);
    return { ok: false, message: "Couldn't add that phrase." };
  }
}

/** Stops tracking a phrase without throwing away what it already told us. */
export async function retireKeyword(id: string): Promise<RankResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("rank_keywords").update({ active: false }).eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/attractors");
    return { ok: true, message: "Stopped tracking it." };
  } catch (err) {
    console.error("retireKeyword failed:", err);
    return { ok: false, message: "Couldn't retire that phrase." };
  }
}

/**
 * Runs the grid for one phrase.
 *
 * Every point is a separate question — "searching from here, where do we
 * come?" — so it is one lookup per point, done one at a time rather than all
 * at once. Forty-nine simultaneous requests is how an API key gets rate
 * limited, and a grid that half-filled is worse than one that took a minute.
 */
export async function runScan(input: {
  keywordId: string;
  centreLat: number;
  centreLng: number;
  gridSize: GridSize;
  spacingMiles: number;
}): Promise<RankResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    if (!env.googlePlacesApiKey || !env.googlePlaceId) {
      return {
        ok: false,
        message:
          "Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID to check rankings automatically. Until then, fill the grid in by hand.",
      };
    }

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { data: keyword } = await supabase
      .from("rank_keywords")
      .select("phrase")
      .eq("id", input.keywordId)
      .maybeSingle();
    if (!keyword) return { ok: false, message: "That phrase isn't being tracked." };

    const grid = buildGrid(
      { lat: input.centreLat, lng: input.centreLng },
      input.gridSize,
      input.spacingMiles
    );

    const points: ScanPoint[] = [];
    for (const cell of grid) {
      points.push({
        ...cell,
        rank: await rankAt(keyword.phrase as string, cell.lat, cell.lng),
      });
    }

    return await saveScan({
      supabase,
      organizationId,
      profileId: profile.id,
      input,
      points,
      source: "api",
    });
  } catch (err) {
    console.error("runScan failed:", err);
    return { ok: false, message: "Couldn't run that check." };
  }
}

/**
 * Records a grid somebody filled in themselves.
 *
 * The honest fallback while there is no API key: a person searching from a
 * few points and typing what they saw is real data, and a grid with five
 * real points beats a grid with forty-nine invented ones.
 */
export async function saveManualScan(input: {
  keywordId: string;
  centreLat: number;
  centreLng: number;
  gridSize: GridSize;
  spacingMiles: number;
  ranks: (number | null)[];
}): Promise<RankResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const grid = buildGrid(
      { lat: input.centreLat, lng: input.centreLng },
      input.gridSize,
      input.spacingMiles
    );
    if (input.ranks.length !== grid.length) {
      return { ok: false, message: `That grid needs ${grid.length} numbers.` };
    }

    const points: ScanPoint[] = grid.map((cell, index) => ({
      ...cell,
      rank: input.ranks[index],
    }));

    return await saveScan({
      supabase,
      organizationId,
      profileId: profile.id,
      input,
      points,
      source: "manual",
    });
  } catch (err) {
    console.error("saveManualScan failed:", err);
    return { ok: false, message: "Couldn't save that grid." };
  }
}

async function saveScan({
  supabase,
  organizationId,
  profileId,
  input,
  points,
  source,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
  profileId: string;
  input: {
    keywordId: string;
    centreLat: number;
    centreLng: number;
    gridSize: number;
    spacingMiles: number;
  };
  points: ScanPoint[];
  source: "api" | "manual";
}): Promise<RankResult> {
  const { data: scan, error } = await supabase
    .from("rank_scans")
    .insert({
      organization_id: organizationId,
      keyword_id: input.keywordId,
      centre_lat: input.centreLat,
      centre_lng: input.centreLng,
      grid_size: input.gridSize,
      spacing_miles: input.spacingMiles,
      source,
      ran_by: profileId,
    })
    .select("id")
    .maybeSingle();

  if (error || !scan) return { ok: false, message: describeDbError(error) };

  const { error: pointError } = await supabase.from("rank_points").insert(
    points.map((point) => ({
      scan_id: scan.id,
      grid_row: point.row,
      grid_col: point.col,
      lat: point.lat,
      lng: point.lng,
      rank: point.rank,
    }))
  );

  if (pointError) return { ok: false, message: describeDbError(pointError) };

  revalidatePath("/attractors");
  return { ok: true, scanId: scan.id, message: "Grid saved." };
}

/**
 * Where our listing comes in the results from one point.
 *
 * Null when we are not in them at all, which is a different answer from
 * being last and has to stay different.
 */
async function rankAt(phrase: string, lat: number, lng: number): Promise<number | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", phrase);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "5000");
  url.searchParams.set("key", env.googlePlacesApiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const json = (await response.json()) as { results?: { place_id?: string }[] };
    const index = (json.results ?? []).findIndex((r) => r.place_id === env.googlePlaceId);
    return index === -1 ? null : index + 1;
  } catch (err) {
    console.error("rankAt failed:", err);
    return null;
  }
}
