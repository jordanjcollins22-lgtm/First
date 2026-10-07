import { createClient } from "@/lib/supabase/server";
import type { CheckIn, CheckInSchedule, TeamMember } from "@/types/domain";

export type ScheduleWithJob = CheckInSchedule & { job: { id: string; name: string } | null };
export type TeamMemberWithSchedules = TeamMember & { schedules: ScheduleWithJob[] };
export type CheckInWithRelations = CheckIn & {
  team_member: Pick<TeamMember, "id" | "name"> | null;
  job: { id: string; name: string } | null;
};

export async function listTeamMembers(): Promise<TeamMemberWithSchedules[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("*, schedules:check_in_schedules(*, job:jobs(id, name))")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as TeamMemberWithSchedules[];
}

export async function listOpenJobs(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, name")
    .not("status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listRecentCheckIns(limit = 100): Promise<CheckInWithRelations[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("check_ins")
    .select("*, team_member:team_members(id, name), job:jobs(id, name)")
    .order("scheduled_for", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as CheckInWithRelations[];
}
