"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCrewDay } from "@/lib/data/crew-day";
import { canRecord, type CrewEventKind } from "@/lib/crew-day";

export type CrewDayResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Records one step of the day.
 *
 * The sequence is re-checked here against freshly read state, not trusted from
 * the page. A phone that has been in a pocket since this morning is holding a
 * stale screen, and a stale screen must not be able to report a step the day
 * has not reached — that is the whole guarantee this feature offers the office.
 */
export async function recordCrewEvent(
  kind: CrewEventKind,
  jobId: string | null,
  position?: { lat: number; lng: number } | null
): Promise<CrewDayResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const day = await getCrewDay();
    if (!day) return { ok: false, message: "Couldn't load your day." };

    const verdict = canRecord(day.events, day.stops, kind, jobId);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const { error } = await supabase.from("crew_day_events").insert({
      organization_id: organizationId,
      profile_id: profile.id,
      day: day.day,
      kind,
      job_id: jobId,
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
    });
    if (error) return { ok: false, message: error.message };

    revalidatePath("/today");
    return { ok: true };
  } catch (err) {
    console.error("recordCrewEvent failed:", err);
    return { ok: false, message: "Couldn't record that — try again." };
  }
}

/**
 * Takes back the last thing they tapped.
 *
 * Fat fingers exist and the sequence is strict, so without this a mis-tap
 * would strand somebody for the rest of the day. Only the most recent event
 * goes, and only their own — this is an undo, not an edit.
 */
export async function undoLastCrewEvent(): Promise<CrewDayResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const day = await getCrewDay();
    if (!day || day.events.length === 0) return { ok: false, message: "Nothing to undo." };

    const supabase = await createClient();
    const { data: latest } = await supabase
      .from("crew_day_events")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("day", day.day)
      .order("at", { ascending: false })
      .limit(1)
      .single();
    if (!latest) return { ok: false, message: "Nothing to undo." };

    const { error } = await supabase.from("crew_day_events").delete().eq("id", latest.id);
    if (error) return { ok: false, message: error.message };

    revalidatePath("/today");
    return { ok: true, message: "Undone." };
  } catch (err) {
    console.error("undoLastCrewEvent failed:", err);
    return { ok: false, message: "Couldn't undo that." };
  }
}
