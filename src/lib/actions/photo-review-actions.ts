"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { markIsUsable } from "@/lib/photo-review";
import { listPhotoMarks } from "@/lib/data/photo-review";
import { canApprove } from "@/lib/photo-review";

export type ReviewResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Pins a touch-up to a spot on a photo.
 *
 * The note is required here as well as in the database, so the refusal reads
 * as a sentence rather than as a constraint violation. It is the whole value
 * of the step: a pin without it is somebody pointing at a photograph.
 */
export async function addPhotoMark(input: {
  jobId: string;
  photoId: string;
  x: number;
  y: number;
  note: string;
}): Promise<ReviewResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    if (!markIsUsable(input.note)) {
      return { ok: false, message: "Say what needs doing — the crew can't act on a pin alone." };
    }

    const [supabase, organizationId] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
    ]);

    const { error } = await supabase.from("job_photo_marks").insert({
      organization_id: organizationId,
      job_id: input.jobId,
      photo_id: input.photoId,
      x: Math.min(1, Math.max(0, input.x)),
      y: Math.min(1, Math.max(0, input.y)),
      note: input.note.trim(),
      created_by: profile.id,
    });

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(input.jobId);
    return { ok: true, message: "Sent to the crew." };
  } catch (err) {
    console.error("addPhotoMark failed:", err);
    return { ok: false, message: "Couldn't add that." };
  }
}

/** Takes a mark back — for the one that turned out to be a shadow. */
export async function removePhotoMark(jobId: string, id: string): Promise<ReviewResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase.from("job_photo_marks").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Removed." };
  } catch (err) {
    console.error("removePhotoMark failed:", err);
    return { ok: false, message: "Couldn't remove that." };
  }
}

/** The crew saying they have been back and done it. */
export async function resolvePhotoMark(jobId: string, id: string): Promise<ReviewResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("job_photo_marks")
      .update({ resolved_at: new Date().toISOString(), resolved_by: profile.id })
      .eq("id", id);

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Marked as done." };
  } catch (err) {
    console.error("resolvePhotoMark failed:", err);
    return { ok: false, message: "Couldn't mark that done." };
  }
}

/**
 * Signing the photos off.
 *
 * Refused while anything is outstanding, and checked against the database
 * rather than against what the screen was showing — a manager on a stale page
 * must not approve past a punch list somebody added a minute ago.
 */
export async function approvePhotos(jobId: string): Promise<ReviewResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const marks = await listPhotoMarks(jobId);
    if (!canApprove(marks)) {
      return {
        ok: false,
        message: "There are touch-ups still outstanding. Clear them first, or take the marks back.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ photos_approved_at: new Date().toISOString(), photos_approved_by: profile.id })
      .eq("id", jobId);

    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Approved — book the walkthrough." };
  } catch (err) {
    console.error("approvePhotos failed:", err);
    return { ok: false, message: "Couldn't approve those." };
  }
}

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work-order`);
  revalidatePath("/my-day");
}
