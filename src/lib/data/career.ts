import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isMissingTable } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import type { StageProgress } from "@/lib/career/stages";

export interface CareerRows {
  /** False until migration 0392 has been run. */
  ready: boolean;
  byProfile: Map<string, StageProgress[]>;
}

function toProgress(row: {
  stage: number;
  count: number;
  note: string | null;
  completed_at: string | null;
  completed_by: string | null;
}): StageProgress {
  return {
    stage: row.stage,
    count: row.count,
    note: row.note,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
  };
}

/** Everybody's progress in this organization, keyed by profile id. */
export async function listCareerProgress(): Promise<CareerRows> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("career_progress")
    .select("profile_id, stage, count, note, completed_at, completed_by")
    .eq("organization_id", await getCurrentOrganizationId());
  if (error) {
    if (isMissingTable(error)) return { ready: false, byProfile: new Map() };
    throw error;
  }
  const byProfile = new Map<string, StageProgress[]>();
  for (const row of data ?? []) {
    const list = byProfile.get(row.profile_id) ?? [];
    list.push(toProgress(row));
    byProfile.set(row.profile_id, list);
  }
  return { ready: true, byProfile };
}

/** One person's progress, or ready: false before the migration. */
export async function getCareerProgress(profileId: string): Promise<{ ready: boolean; progress: StageProgress[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("career_progress")
    .select("stage, count, note, completed_at, completed_by")
    .eq("profile_id", profileId);
  if (error) {
    if (isMissingTable(error)) return { ready: false, progress: [] };
    throw error;
  }
  return { ready: true, progress: (data ?? []).map(toProgress) };
}
