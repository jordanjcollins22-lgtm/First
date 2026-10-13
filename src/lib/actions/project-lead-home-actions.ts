"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCrewDay } from "@/lib/data/crew-day";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { requestWalkthrough } from "@/lib/actions/walkthrough-actions";
import { completeJob } from "@/lib/actions/job-photo-actions";
import { canRunJobs, isOwnerLevel } from "@/lib/roles";

export type LeadResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * The lead's close-out buttons on their home screen: ask for the final
 * walkthrough, and sign the job off once it is approved.
 *
 * Both run the existing actions underneath, so every rule they enforce
 * (photos, the manager's walk, the client's approval) still holds. What is
 * added here is who may press them: somebody who runs jobs and is on this
 * job's crew, or the owner.
 */
async function mayCloseOut(jobId: string): Promise<{ ok: true; profileId: string } | { ok: false; message: string }> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, message: "Sign in first." };
  if (!canRunJobs(me.roles)) return { ok: false, message: "Only a project lead can close a job out." };
  if (isOwnerLevel(me.roles)) return { ok: true, profileId: me.id };
  const supabase = await createClient();
  const { data } = await supabase.from("job_crew").select("job_id").eq("job_id", jobId).eq("profile_id", me.id).limit(1);
  if (!(data ?? []).length) return { ok: false, message: "You're not on this job's crew." };
  return { ok: true, profileId: me.id };
}

/**
 * Asks the account manager to come and walk the job.
 *
 * The walkthrough rule wants a visit that has begun, and a visit only reads
 * as begun once the overnight sweep has seen the crew's "I've arrived". A
 * lead standing on the site asking for the walk the same afternoon was told
 * to start a visit first. So when they have tapped I've arrived on this job
 * today, today's visit is marked started here, the same thing the sweep
 * would do, and then the walk is asked for.
 */
export async function leadRequestWalkthrough(jobId: string, note: string | null): Promise<LeadResult> {
  const who = await mayCloseOut(jobId);
  if (!who.ok) return who;
  const day = await getCrewDay().catch(() => null);
  const stop = day?.stops.find((s) => s.jobId === jobId);
  const arrived = day?.events.some((e) => e.kind === "arrived_job" && e.jobId === jobId);
  if (stop && arrived) {
    const { error } = await createAdminClient()
      .from("job_work_sessions")
      .update({ status: "in_progress" })
      .eq("id", stop.sessionId)
      .eq("status", "scheduled");
    if (error) console.warn("leadRequestWalkthrough: could not mark the visit started:", error.message);
  }
  return requestWalkthrough(jobId, note);
}

/** Signs the job off: the same checks as anywhere else, with the job's own areas. */
export async function leadSignOff(jobId: string, notes: string | null): Promise<LeadResult> {
  const who = await mayCloseOut(jobId);
  if (!who.ok) return who;
  const sheet = await getWorkOrderForJob(jobId).catch(() => null);
  if (!sheet) return { ok: false, message: "Couldn't find that job." };
  return completeJob(jobId, notes?.trim() || null, sheet.photoZones);
}
