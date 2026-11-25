"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { addWorkDays } from "@/lib/work-days";
import { createClient } from "@/lib/supabase/server";

export type ScheduleResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Put a job on a crew's calendar: the start day, how many work days it takes
 * (Sundays skipped) and whose crew does it. The job gets its dates and lead,
 * the lead goes on the job's crew, and one visit covers the days, which is
 * what puts it on that technician's Today. Doing it again moves the job.
 */
export async function scheduleJob(input: { jobId: string; startsOn: string; days: number; leadId: string }): Promise<ScheduleResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the account manager or the owner can schedule jobs." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) return { ok: false, error: "Pick a start day." };
  if (!input.leadId) return { ok: false, error: "Pick a crew." };
  const days = Math.min(Math.max(Math.round(input.days) || 1, 1), 30);
  const startsOn = addWorkDays(input.startsOn, 0); // a Sunday start moves to Monday
  const endsOn = addWorkDays(startsOn, days - 1);

  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: job } = await sb.from("jobs").select("id, status").eq("id", input.jobId).maybeSingle();
  if (!job) return { ok: false, error: "That job isn't there any more." };

  const { error: jobError } = await sb
    .from("jobs")
    .update({ project_start_date: startsOn, project_end_date: endsOn, assigned_to: input.leadId })
    .eq("id", input.jobId);
  if (jobError) return { ok: false, error: "That didn't save. Try again." };

  // The lead on the job's crew, so the job shows on their Today.
  const { data: onCrew } = await sb.from("job_crew").select("id").eq("job_id", input.jobId).eq("profile_id", input.leadId).maybeSingle();
  if (!onCrew) {
    await sb.from("job_crew").insert({ job_id: input.jobId, organization_id: profile.organization_id, profile_id: input.leadId, is_lead: true, added_by: profile.id });
  }

  // One visit for the whole job: move the open one, or make it.
  const { data: open } = await sb
    .from("job_work_sessions")
    .select("id")
    .eq("job_id", input.jobId)
    .is("subcontractor_id", null)
    .not("status", "in", "(cancelled,done)")
    .order("starts_on", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { error: visitError } = open
    ? await sb.from("job_work_sessions").update({ starts_on: startsOn, ends_on: endsOn, updated_at: new Date().toISOString() }).eq("id", open.id)
    : await sb.from("job_work_sessions").insert({
        job_id: input.jobId,
        organization_id: profile.organization_id,
        starts_on: startsOn,
        ends_on: endsOn,
        status: "scheduled",
        created_by: profile.id,
      });
  if (visitError) return { ok: false, error: "The dates saved, but the crew's day didn't. Try again." };

  revalidatePath("/me");
  revalidatePath("/me/full");
  return { ok: true, message: days === 1 ? `Scheduled for ${startsOn}.` : `Scheduled ${startsOn} to ${endsOn}.` };
}
