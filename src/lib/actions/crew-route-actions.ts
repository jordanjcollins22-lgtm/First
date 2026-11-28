"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type RouteResult = { ok: true; message: string } | { ok: false; error: string };

/** One crew's day as the office laid it out: the visits in order. A null visit is a job copied onto this crew. */
export interface CrewRouteInput {
  leadId: string;
  stops: { sessionId: string | null; jobId: string }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Save today's routes from the Schedule map: which crew works each job and in
 * what order. Each crew's order is kept exactly (route_locked) instead of the
 * nearest-next rule. A job put on a second crew gets its own visit for the
 * day, so both crews have it; a copy taken off again is cancelled. Every job
 * keeps at least one crew.
 */
export async function saveCrewRoutes(input: { day: string; crews: CrewRouteInput[] }): Promise<RouteResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the account manager or the owner can change the crews' routes." };
  }
  if (!DAY.test(input.day)) return { ok: false, error: "That day isn't right." };
  const crews = input.crews.filter((c) => c.leadId);

  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: today, error: readError } = await sb
    .from("job_work_sessions")
    .select("id, job_id, starts_on, ends_on, status, purpose, meet_on_site")
    .lte("starts_on", input.day)
    .gte("ends_on", input.day)
    .not("status", "in", "(cancelled,done)")
    .is("subcontractor_id", null);
  if (readError) return { ok: false, error: "Couldn't read today's jobs. Try again." };
  type V = { id: string; job_id: string; starts_on: string; ends_on: string; status: string; purpose: string | null; meet_on_site: boolean | null };
  const visits = (today ?? []) as V[];
  const byId = new Map(visits.map((v) => [v.id, v]));

  // Every job on today must still be on somebody's route.
  const placed = new Set(crews.flatMap((c) => c.stops.map((s) => s.jobId)));
  const dropped = visits.filter((v) => !placed.has(v.job_id));
  if (dropped.length) return { ok: false, error: "Every job needs at least one crew. Put it back on a crew before saving." };

  const used = new Set<string>();
  const named = new Set(crews.flatMap((c) => c.stops.map((s) => s.sessionId).filter((id): id is string => !!id && byId.has(id))));
  // A visit nobody named (its crew was taken off) is handed to a crew newly put on the same job, before making a copy.
  const spare = (jobId: string) => visits.find((v) => v.job_id === jobId && !named.has(v.id) && !used.has(v.id));
  for (const crew of crews) {
    for (const [i, stop] of crew.stops.entries()) {
      const existing = (stop.sessionId && !used.has(stop.sessionId) ? byId.get(stop.sessionId) : undefined) ?? spare(stop.jobId);
      if (existing && !used.has(existing.id)) {
        used.add(existing.id);
        const { error } = await sb
          .from("job_work_sessions")
          .update({ crew_lead_id: crew.leadId, stop_order: i + 1, route_locked: true, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) return { ok: false, error: "A change didn't save. Try again." };
        continue;
      }
      // A second crew on the same job today: its own visit for the day.
      const like = visits.find((v) => v.job_id === stop.jobId);
      if (!like) return { ok: false, error: "One of those jobs isn't on today any more. Reload and try again." };
      const { error } = await sb.from("job_work_sessions").insert({
        job_id: stop.jobId,
        organization_id: profile.organization_id,
        starts_on: input.day,
        ends_on: input.day,
        status: "scheduled",
        purpose: like.purpose,
        meet_on_site: like.meet_on_site ?? false,
        crew_lead_id: crew.leadId,
        stop_order: i + 1,
        route_locked: true,
        created_by: profile.id,
      });
      if (error) return { ok: false, error: "A change didn't save. Try again." };
    }
  }

  // A one-day copy that is on no crew now: cancel it (never a multi-day visit).
  for (const v of visits) {
    if (used.has(v.id)) continue;
    if (v.starts_on === input.day && v.ends_on === input.day) {
      await sb.from("job_work_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", v.id);
    }
  }

  revalidatePath("/schedule");
  revalidatePath("/me");
  revalidatePath("/me/full");
  return { ok: true, message: "Routes saved. Each crew's Today shows the new order." };
}

/** Go back to the automatic order: start job, then the nearest job left. */
export async function resetCrewRoutes(input: { day: string }): Promise<RouteResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the account manager or the owner can change the crews' routes." };
  }
  if (!DAY.test(input.day)) return { ok: false, error: "That day isn't right." };
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { error } = await sb
    .from("job_work_sessions")
    .update({ route_locked: false })
    .lte("starts_on", input.day)
    .gte("ends_on", input.day)
    .not("status", "in", "(cancelled,done)");
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidatePath("/schedule");
  return { ok: true, message: "Back to nearest-next routes." };
}
