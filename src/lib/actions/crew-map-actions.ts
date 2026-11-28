"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAccountManager } from "@/lib/affiliate-roles";
import { CREW_MAP_AREAS, type CrewMap } from "@/lib/crew-map-areas";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * Save which parts of the lot the crew works on, shown on the crew map when
 * no site map was drawn. Only the account manager and up. Kept on the
 * proposal's options (the signed one, else the latest); nothing about the
 * price or the client's wording changes.
 */
export async function saveCrewMap(jobId: string, map: CrewMap): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the account manager or the owner can change the crew map." };
  }
  const areas = [...new Set(map.areas)].filter((a) => CREW_MAP_AREAS.some((x) => x.key === a));
  if (areas.length === 0) return { ok: false, error: "Pick at least one part of the yard." };
  const turn = ((Math.trunc(map.turn) % 4) + 4) % 4;

  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: list, error } = await sb
    .from("job_proposals")
    .select("id, status, options, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: "Couldn't read the proposal. Try again." };
  const rows = (list ?? []) as { id: string; status: string; options: Record<string, unknown> | null }[];
  const chosen = rows.find((p) => p.status === "accepted") ?? rows[0];
  if (!chosen) return { ok: false, error: "This job has no proposal to keep the map on." };

  const { error: saveError } = await sb
    .from("job_proposals")
    .update({ options: { ...(chosen.options ?? {}), crewMap: { areas, turn } } })
    .eq("id", chosen.id);
  if (saveError) return { ok: false, error: "That didn't save. Try again." };
  revalidatePath(`/jobs/${jobId}/crew-map`);
  return { ok: true };
}
