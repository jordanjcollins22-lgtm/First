"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { listScheduledTimes } from "@/lib/data/social";
import { describeSlot, nextPostSlot } from "@/lib/social-post";
import { adoptEvaluationPhotosAsBefores } from "@/lib/data/adopt-befores";

export type SocialResult =
  | { ok: true; message?: string; scheduledFor?: string }
  | { ok: false; message: string };

/**
 * Approves a pair and gives it a time.
 *
 * Approval and scheduling are one press on purpose. Somebody looking at a
 * finished square has already made the only decision that matters; making
 * them pick a date as well is how a queue fills up with approved posts nobody
 * ever sent.
 *
 * The slot is chosen against everything already booked, so approving five in
 * one sitting spreads them over a fortnight.
 */
export async function approveSocialPost(input: {
  jobId: string;
  beforePhotoId: string;
  afterPhotoId: string;
  zoneId?: string | null;
  zoneName?: string | null;
  imagePath: string;
  caption: string;
}): Promise<SocialResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!input.imagePath) return { ok: false, message: "The image hasn't finished uploading." };

    const [supabase, organizationId, booked] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
      listScheduledTimes(),
    ]);

    const slot = nextPostSlot(booked);
    if (!slot) return { ok: false, message: "No free slot in the next three months." };

    const now = new Date().toISOString();
    const { error } = await supabase.from("social_posts").upsert(
      {
        organization_id: organizationId,
        job_id: input.jobId,
        before_photo_id: input.beforePhotoId,
        after_photo_id: input.afterPhotoId,
        zone_id: input.zoneId ?? null,
        zone_name: input.zoneName ?? null,
        image_path: input.imagePath,
        caption: input.caption.trim() || null,
        status: "scheduled",
        scheduled_for: slot.toISOString(),
        approved_by: profile.id,
        approved_at: now,
        updated_at: now,
      },
      { onConflict: "before_photo_id,after_photo_id" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    revalidatePath(`/jobs/${input.jobId}`);

    return {
      ok: true,
      scheduledFor: slot.toISOString(),
      message: `Approved — goes out ${describeSlot(slot)}.`,
    };
  } catch (err) {
    console.error("approveSocialPost failed:", err);
    return { ok: false, message: "Couldn't approve that one." };
  }
}

/**
 * Turns a pair down for good.
 *
 * Recorded rather than ignored, so the same photograph nobody wants to post
 * does not come back to the top of the list every week.
 */
export async function skipSocialPost(input: {
  jobId: string;
  beforePhotoId: string;
  afterPhotoId: string;
}): Promise<SocialResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase.from("social_posts").upsert(
      {
        organization_id: organizationId,
        job_id: input.jobId,
        before_photo_id: input.beforePhotoId,
        after_photo_id: input.afterPhotoId,
        status: "skipped",
        approved_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "before_photo_id,after_photo_id" }
    );

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    return { ok: true, message: "Won't be offered again." };
  } catch (err) {
    console.error("skipSocialPost failed:", err);
    return { ok: false, message: "Couldn't skip that one." };
  }
}

/** Moves a scheduled post to a different time. */
export async function reschedulePost(id: string, when: string): Promise<SocialResult> {
  try {
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return { ok: false, message: "That isn't a time." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("social_posts")
      .update({ scheduled_for: at.toISOString(), status: "scheduled", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    return { ok: true, message: `Moved to ${describeSlot(at)}.` };
  } catch (err) {
    console.error("reschedulePost failed:", err);
    return { ok: false, message: "Couldn't move that one." };
  }
}

/** Records that a post went out — by hand, or by whatever sends it. */
export async function markPosted(id: string, channel?: string): Promise<SocialResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("social_posts")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        channel: channel ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("job_id")
      .maybeSingle();

    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/admin/social");
    if (data?.job_id) revalidatePath(`/jobs/${data.job_id}`);

    return { ok: true, message: "Marked as posted." };
  } catch (err) {
    console.error("markPosted failed:", err);
    return { ok: false, message: "Couldn't mark that one." };
  }
}

/**
 * Takes an already-submitted job's evaluation photos as its befores.
 *
 * New evaluations do this on submission. This is the same thing for the ones
 * that went through before it did — the pictures are sitting there either
 * way, and a job with a folder of before photos should not be on a list of
 * jobs with none.
 */
export async function adoptBeforesForJob(jobId: string): Promise<SocialResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const adopted = await adoptEvaluationPhotosAsBefores(jobId);

    revalidatePath("/admin/social");
    revalidatePath(`/jobs/${jobId}`);

    return adopted === 0
      ? { ok: false, message: "No zone photos on that evaluation to use." }
      : {
          ok: true,
          message: `Took ${adopted} evaluation photo${adopted === 1 ? "" : "s"} as befores.`,
        };
  } catch (err) {
    console.error("adoptBeforesForJob failed:", err);
    return { ok: false, message: "Couldn't use those photos." };
  }
}
