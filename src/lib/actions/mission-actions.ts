"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { categoryFor, pickMission } from "@/lib/missions";
import { isMissingTable } from "@/lib/setup-errors";

export type MissionResult = { ok: true } | { ok: false; message: string };

const NOT_SET_UP = "Missions aren't switched on yet. Ask the office.";

/**
 * Pick a square on the board: the app chooses the mission from that
 * category and the clock starts. One mission at a time; picking another
 * while one is going asks them to finish or drop it first.
 */
export async function startMission(categoryKey: string): Promise<MissionResult> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!categoryFor(categoryKey)) return { ok: false, message: "Pick a category." };
  const admin = createAdminClient();

  const { data: mine, error } = await admin
    .from("team_missions")
    .select("mission_key, started_at, finished_at, abandoned_at")
    .eq("profile_id", profile.id)
    .eq("category", categoryKey);
  if (error) return { ok: false, message: isMissingTable(error) ? NOT_SET_UP : "Couldn't start it. Try again." };

  const { data: going } = await admin
    .from("team_missions")
    .select("id")
    .eq("profile_id", profile.id)
    .is("finished_at", null)
    .is("abandoned_at", null)
    .limit(1);
  if ((going ?? []).length > 0) return { ok: false, message: "Finish or drop the mission you're on first." };

  const mission = pickMission(
    categoryKey,
    ((mine ?? []) as { mission_key: string; started_at: string }[]).map((m) => ({ missionKey: m.mission_key, startedAt: m.started_at }))
  );
  if (!mission) return { ok: false, message: "Nothing in that category yet." };

  const { error: insertError } = await admin.from("team_missions").insert({
    organization_id: profile.organization_id,
    profile_id: profile.id,
    category: categoryKey,
    mission_key: mission.key,
    title: mission.title,
    goal: mission.goal,
  });
  if (insertError) return { ok: false, message: isMissingTable(insertError) ? NOT_SET_UP : "Couldn't start it. Try again." };
  revalidatePath("/my-day");
  return { ok: true };
}

/** +1 (or more) toward the goal. Reaching the goal finishes it and stops the clock. */
export async function countMission(missionId: string, by: number): Promise<MissionResult> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("team_missions")
    .select("id, goal, progress, finished_at, abandoned_at")
    .eq("id", missionId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!row || row.finished_at || row.abandoned_at) return { ok: false, message: "That mission is over." };
  const progress = Math.max(0, Math.min(row.goal, row.progress + Math.trunc(by)));
  const { error } = await admin
    .from("team_missions")
    .update({ progress, finished_at: progress >= row.goal ? new Date().toISOString() : null })
    .eq("id", row.id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath("/my-day");
  return { ok: true };
}

/** Drop the mission they're on, so they can pick another square. */
export async function dropMission(missionId: string): Promise<MissionResult> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("team_missions")
    .update({ abandoned_at: new Date().toISOString() })
    .eq("id", missionId)
    .eq("profile_id", profile.id)
    .is("finished_at", null);
  if (error) return { ok: false, message: "Couldn't drop it. Try again." };
  revalidatePath("/my-day");
  return { ok: true };
}
