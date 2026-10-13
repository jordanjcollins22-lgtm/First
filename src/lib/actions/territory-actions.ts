"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { readAreas, readZips, writeAreas } from "@/lib/sales/territories";

/**
 * Saving an evaluator's territory: zip codes typed in, an area drawn on the
 * map, or both. Owner only. Clearing both makes them cover everywhere again,
 * which is what having no territory means.
 */

export type TerritoryResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveTerritory(input: { evaluatorId: string; zips: string; areas: unknown; active: boolean }): Promise<TerritoryResult> {
  const profile = await getRealProfile();
  if (!profile) return { ok: false, error: "Sign in first." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can set territories." };

  const zips = readZips(input.zips ?? "");
  const areas = writeAreas(readAreas(input.areas));
  if (zips.length > 200) return { ok: false, error: "That's more zip codes than a territory needs." };

  try {
    const supabase = await createClient();
    // The evaluator has to be one of ours.
    const { data: person } = await supabase.from("profiles").select("id").eq("id", input.evaluatorId).eq("organization_id", profile.organization_id).maybeSingle();
    if (!person) return { ok: false, error: "That person isn't on the team." };
    const { error } = await (supabase as unknown as SupabaseClient).from("evaluator_territories").upsert(
      {
        organization_id: profile.organization_id,
        evaluator_id: input.evaluatorId,
        zips,
        areas,
        active: Boolean(input.active),
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      },
      { onConflict: "organization_id,evaluator_id" }
    );
    if (error) return { ok: false, error: /evaluator_territories/.test(error.message) ? "Territories aren't set up yet (migration 0361)." : error.message };
    revalidatePath("/v2");
    const parts = [zips.length ? `${zips.length} zip code${zips.length === 1 ? "" : "s"}` : null, areas.length ? `${areas.length} drawn area${areas.length === 1 ? "" : "s"}` : null].filter(Boolean);
    return { ok: true, message: parts.length ? `Saved: ${parts.join(" and ")}.` : "Saved: no territory, so they cover everywhere." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save that territory." };
  }
}
