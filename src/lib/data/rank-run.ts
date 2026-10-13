import type { SupabaseClient } from "@supabase/supabase-js";

import { placesKeyFor, placesRank } from "@/lib/google/places-rank";
import type { AutopilotSettings } from "@/lib/marketing/autopilot-settings";
import { centreFor, checkedThisWeek, missingPhrases, pickForWeek, seedPhrases } from "@/lib/marketing/rank-seed";
import { buildGrid } from "@/lib/rank-grid";

/**
 * Filling the rank tracker and keeping it current.
 *
 * Seeding adds the town × service phrases that are missing (never removes
 * one a person added or retired). The weekly check runs a small 3×3 grid,
 * a mile apart, round each phrase's town for the phrases checked longest
 * ago, and saves each as an ordinary 'api' scan, so the existing tracker
 * panel shows it like any other.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export async function seedRankKeywords(client: unknown, org: string, settings: AutopilotSettings): Promise<number> {
  const sb = untyped(client);
  const wanted = seedPhrases(settings.rankTowns, settings.rankServices);
  const { data } = await sb.from("rank_keywords").select("phrase").eq("organization_id", org);
  const missing = missingPhrases(wanted, ((data ?? []) as { phrase: string }[]).map((r) => r.phrase));
  if (missing.length === 0) return 0;
  const { error } = await sb
    .from("rank_keywords")
    .upsert(missing.map((phrase) => ({ organization_id: org, phrase, active: true })), { onConflict: "organization_id,phrase", ignoreDuplicates: true });
  if (error) throw error;
  return missing.length;
}

export interface RankRunResult {
  seeded: number;
  checked: number;
  needsKey: boolean;
  error?: string;
}

export async function runWeeklyRank(client: unknown, org: string, settings: AutopilotSettings, now = new Date()): Promise<RankRunResult> {
  const sb = untyped(client);
  const seeded = await seedRankKeywords(client, org, settings).catch(() => 0);
  if (!settings.enabled.rank_weekly) return { seeded, checked: 0, needsKey: false };
  const key = await placesKeyFor(org);
  if (!key) return { seeded, checked: 0, needsKey: true, error: "Not connected — add it in Settings › Integrations (Rank tracker)." };

  const [{ data: keywords }, { data: scans }] = await Promise.all([
    sb.from("rank_keywords").select("id, phrase").eq("organization_id", org).eq("active", true),
    sb.from("rank_scans").select("keyword_id, ran_at").eq("organization_id", org).order("ran_at", { ascending: false }).limit(2000),
  ]);
  const last = new Map<string, string>();
  for (const s of (scans ?? []) as { keyword_id: string; ran_at: string }[]) if (!last.has(s.keyword_id)) last.set(s.keyword_id, s.ran_at);
  const list = ((keywords ?? []) as { id: string; phrase: string }[]).map((k) => ({ ...k, lastScanAt: last.get(k.id) ?? null }));
  const due = pickForWeek(list, settings.rankPerWeek).filter((k) => !checkedThisWeek(k.lastScanAt, now));

  let checked = 0;
  for (const keyword of due) {
    const centre = centreFor(keyword.phrase);
    const grid = buildGrid(centre, 3, 1);
    const points: { row: number; col: number; lat: number; lng: number; rank: number | null }[] = [];
    let failed: string | null = null;
    for (const cell of grid) {
      const r = await placesRank(key, keyword.phrase, cell.lat, cell.lng);
      if (!r.ok) {
        failed = r.error;
        break;
      }
      points.push({ ...cell, rank: r.rank });
    }
    if (failed) return { seeded, checked, needsKey: false, error: failed };
    const { data: scan, error } = await sb
      .from("rank_scans")
      .insert({
        organization_id: org,
        keyword_id: keyword.id,
        centre_lat: centre.lat,
        centre_lng: centre.lng,
        grid_size: 3,
        spacing_miles: 1,
        source: "api",
        note: "Weekly check",
      })
      .select("id")
      .maybeSingle();
    if (error || !scan) return { seeded, checked, needsKey: false, error: error?.message ?? "Could not save the scan." };
    await sb.from("rank_points").insert(
      points.map((p) => ({ scan_id: (scan as { id: string }).id, grid_row: p.row, grid_col: p.col, lat: p.lat, lng: p.lng, rank: p.rank }))
    );
    checked++;
  }
  return { seeded, checked, needsKey: false };
}
