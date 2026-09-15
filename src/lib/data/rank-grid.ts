import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { ScanPoint } from "@/lib/rank-grid";

export interface Keyword {
  id: string;
  phrase: string;
  active: boolean;
}

export interface Scan {
  id: string;
  keywordId: string;
  phrase: string;
  centreLat: number;
  centreLng: number;
  gridSize: number;
  spacingMiles: number;
  source: "api" | "manual";
  ranAt: string;
  points: ScanPoint[];
}

export async function listKeywords(): Promise<Keyword[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rank_keywords")
    .select("id, phrase, active")
    .eq("active", true)
    .order("phrase");

  if (isMissingTable(error) || error) return [];
  return (data ?? []) as Keyword[];
}

/**
 * The most recent run of each keyword, with its points.
 *
 * Latest only: a rank grid is a photograph of now, and the overlay is asking
 * "where do we stand", not "what has ever been true".
 */
export async function listLatestScans(): Promise<Scan[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("rank_scans")
    .select(
      "id, keyword_id, centre_lat, centre_lng, grid_size, spacing_miles, source, ran_at, rank_keywords(phrase)"
    )
    .order("ran_at", { ascending: false })
    .limit(60);

  if (isMissingTable(error) || error || !data) return [];

  const rows = data as unknown as {
    id: string;
    keyword_id: string;
    centre_lat: number;
    centre_lng: number;
    grid_size: number;
    spacing_miles: number;
    source: string;
    ran_at: string;
    rank_keywords: { phrase: string } | null;
  }[];

  // Newest first already, so the first sighting of a keyword is its latest.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.keyword_id)) latest.set(row.keyword_id, row);
  }

  const ids = [...latest.values()].map((row) => row.id);
  if (ids.length === 0) return [];

  const { data: pointRows } = await supabase
    .from("rank_points")
    .select("scan_id, grid_row, grid_col, lat, lng, rank")
    .in("scan_id", ids);

  const byScan = new Map<string, ScanPoint[]>();
  for (const point of (pointRows ?? []) as unknown as {
    scan_id: string;
    grid_row: number;
    grid_col: number;
    lat: number;
    lng: number;
    rank: number | null;
  }[]) {
    const list = byScan.get(point.scan_id) ?? [];
    list.push({
      row: point.grid_row,
      col: point.grid_col,
      lat: point.lat,
      lng: point.lng,
      rank: point.rank,
    });
    byScan.set(point.scan_id, list);
  }

  return [...latest.values()].map((row) => ({
    id: row.id,
    keywordId: row.keyword_id,
    phrase: row.rank_keywords?.phrase ?? "Keyword",
    centreLat: row.centre_lat,
    centreLng: row.centre_lng,
    gridSize: row.grid_size,
    spacingMiles: Number(row.spacing_miles),
    source: (row.source as "api" | "manual") ?? "manual",
    ranAt: row.ran_at,
    points: byScan.get(row.id) ?? [],
  }));
}

/** The run before the latest one, so a keyword can show which way it moved. */
export async function listPreviousScanPoints(): Promise<Map<string, ScanPoint[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("rank_scans")
    .select("id, keyword_id, ran_at")
    .order("ran_at", { ascending: false })
    .limit(120);

  if (isMissingTable(error) || error || !data) return new Map();

  const rows = data as { id: string; keyword_id: string; ran_at: string }[];
  const seen = new Set<string>();
  const previous = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.keyword_id)) {
      seen.add(row.keyword_id);
      continue;
    }
    if (!previous.has(row.keyword_id)) previous.set(row.keyword_id, row.id);
  }

  const ids = [...previous.values()];
  if (ids.length === 0) return new Map();

  const { data: pointRows } = await supabase
    .from("rank_points")
    .select("scan_id, grid_row, grid_col, lat, lng, rank")
    .in("scan_id", ids);

  const byScan = new Map<string, ScanPoint[]>();
  for (const point of (pointRows ?? []) as unknown as {
    scan_id: string;
    grid_row: number;
    grid_col: number;
    lat: number;
    lng: number;
    rank: number | null;
  }[]) {
    const list = byScan.get(point.scan_id) ?? [];
    list.push({
      row: point.grid_row,
      col: point.grid_col,
      lat: point.lat,
      lng: point.lng,
      rank: point.rank,
    });
    byScan.set(point.scan_id, list);
  }

  const byKeyword = new Map<string, ScanPoint[]>();
  for (const [keywordId, scanId] of previous) {
    byKeyword.set(keywordId, byScan.get(scanId) ?? []);
  }
  return byKeyword;
}
