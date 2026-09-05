"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { canCompleteJob, canReopenCompleted, type PhotoWaiver } from "@/lib/job-lifecycle";
import { walkthroughGate } from "@/lib/walkthrough";
import type { JobPhotoKind, JobPhotoStage, JobStatus, WalkthroughStatus } from "@/types/domain";

export type PhotoResult = { ok: true; message?: string } | { ok: false; message: string };

/** Carries the new row's id back, so the page can show the photo immediately
 * and still delete it by id without waiting for a refetch. */
export type AttachResult = { ok: true; id: string } | { ok: false; message: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/attractors");
  revalidatePath("/pipeline");
}

/**
 * Records a photo that the browser has already uploaded to storage.
 *
 * The file goes up from the client rather than through here on purpose: a site
 * photo off a phone camera is several megabytes, and pushing that through a
 * server action means holding it in memory twice and hitting the request body
 * limit on exactly the jobs with the most to show.
 */
export async function attachJobPhoto(
  jobId: string,
  path: string,
  kind: JobPhotoKind,
  caption: string | null,
  zone: { id: string; name: string } | null = null
): Promise<AttachResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    // The path decides storage access, so it has to be under this job.
    if (!path.startsWith(`${jobId}/`)) {
      return { ok: false, message: "That photo doesn't belong to this job." };
    }

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("job_photos")
      .insert({
        job_id: jobId,
        organization_id: organizationId,
        path,
        kind,
        zone_id: zone?.id ?? null,
        zone_name: zone?.name ?? null,
        caption: caption?.trim() || null,
        uploaded_by: profile.id,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: describeDbError(error, "Couldn't save that photo.") };

    refresh(jobId);
    return { ok: true, id: data.id };
  } catch (err) {
    console.error("attachJobPhoto failed:", err);
    return { ok: false, message: "Couldn't save that photo." };
  }
}

/** Removes a photo from the record and from storage, so a wrong shot doesn't
 * sit in the bucket costing money and showing the wrong house. */
export async function deleteJobPhoto(id: string): Promise<PhotoResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: photo } = await supabase
      .from("job_photos")
      .select("id, job_id, path")
      .eq("id", id)
      .single();
    if (!photo) return { ok: false, message: "That photo is already gone." };

    const { error } = await supabase.from("job_photos").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    // Best-effort: the row is the record, and a stray file is a smaller
    // problem than a delete that half-failed and reported success.
    await supabase.storage.from("job-photos").remove([photo.path]);

    refresh(photo.job_id);
    return { ok: true, message: "Photo removed." };
  } catch (err) {
    console.error("deleteJobPhoto failed:", err);
    return { ok: false, message: "Couldn't remove that photo." };
  }
}

/**
 * Signs the job off.
 *
 * Two gates, both checked here rather than only in the UI so a stale page
 * cannot route around either: every zone needs a before, a during and an
 * after, and the account manager has to have walked the job and approved it.
 * The zones come from the caller because they live in the canvas design's
 * jsonb rather than a table.
 */
export async function completeJob(
  jobId: string,
  notes: string | null,
  zones: { id: string; name: string }[] = []
): Promise<PhotoResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();

    const [{ data: job }, { data: photos }, { data: walkthroughs }] = await Promise.all([
      supabase.from("jobs").select("id, status").eq("id", jobId).single(),
      supabase.from("job_photos").select("kind, zone_id").eq("job_id", jobId),
      supabase
        .from("job_walkthroughs")
        .select("status, requested_at, reviewed_at, review_notes")
        .eq("job_id", jobId)
        .order("requested_at", { ascending: false }),
    ]);
    if (!job) return { ok: false, message: "Couldn't find that job." };

    // The manager's walk, checked here and not only in the UI: the whole point
    // is that nobody signs off work a second pair of eyes hasn't seen, and a
    // stale page must not be able to route around that.
    const walk = walkthroughGate(
      (walkthroughs ?? []) as {
        status: WalkthroughStatus;
        requested_at: string;
        reviewed_at: string | null;
        review_notes: string | null;
      }[]
    );
    if (!walk.ok) return { ok: false, message: walk.reason };

    const { data: waiverRows } = await supabase
      .from("job_photo_waivers")
      .select("zone_id, stage")
      .eq("job_id", jobId);

    const waivers: PhotoWaiver[] = ((waiverRows ?? []) as { zone_id: string | null; stage: string }[]).map(
      (row) => ({ zoneId: row.zone_id, stage: row.stage as JobPhotoStage })
    );

    const verdict = canCompleteJob(
      { status: job.status as JobStatus },
      ((photos ?? []) as { kind: string; zone_id: string | null }[]).map((p) => ({
        kind: p.kind as JobPhotoKind,
        zoneId: p.zone_id,
      })),
      zones,
      // The waivers count here too. A stage somebody marked as having no
      // photo has to let the job close, or "don't have one" only ever
      // satisfies the screen and the sign-off still refuses.
      waivers
    );
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error } = await supabase
      .from("jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: profile.id,
        completion_notes: notes?.trim() || null,
      })
      .eq("id", jobId);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Job signed off." };
  } catch (err) {
    console.error("completeJob failed:", err);
    return { ok: false, message: "Couldn't complete that job." };
  }
}

/** Puts a signed-off job back to in-progress, for the callback case. The
 * photos and notes stay — they are the record of what was claimed. */
export async function reopenCompletedJob(jobId: string): Promise<PhotoResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: job } = await supabase.from("jobs").select("id, status").eq("id", jobId).single();
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const verdict = canReopenCompleted({ status: job.status as JobStatus });
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error } = await supabase
      .from("jobs")
      .update({ status: "in_progress", completed_at: null, completed_by: null })
      .eq("id", jobId);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Job reopened. The photos and sign-off note are still here." };
  } catch (err) {
    console.error("reopenCompletedJob failed:", err);
    return { ok: false, message: "Couldn't reopen that job." };
  }
}
