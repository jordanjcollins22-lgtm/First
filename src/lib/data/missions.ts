import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTable } from "@/lib/setup-errors";

export interface MissionRow {
  id: string;
  category: string;
  missionKey: string;
  title: string;
  goal: number;
  progress: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface MyMissions {
  /** False until the missions table exists; the board says so instead of breaking. */
  ready: boolean;
  current: MissionRow | null;
  /** Finished ones, newest first. */
  done: MissionRow[];
}

/** The mission this person is on, and the ones they have finished. */
export async function getMyMissions(profileId: string): Promise<MyMissions> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("team_missions")
    .select("id, category, mission_key, title, goal, progress, started_at, finished_at, abandoned_at")
    .eq("profile_id", profileId)
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) return { ready: !isMissingTable(error), current: null, done: [] };
  const rows = (data ?? []) as {
    id: string;
    category: string;
    mission_key: string;
    title: string;
    goal: number;
    progress: number;
    started_at: string;
    finished_at: string | null;
    abandoned_at: string | null;
  }[];
  const toRow = (r: (typeof rows)[number]): MissionRow => ({
    id: r.id,
    category: r.category,
    missionKey: r.mission_key,
    title: r.title,
    goal: r.goal,
    progress: r.progress,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  });
  const current = rows.find((r) => !r.finished_at && !r.abandoned_at);
  return { ready: true, current: current ? toRow(current) : null, done: rows.filter((r) => r.finished_at).map(toRow) };
}
