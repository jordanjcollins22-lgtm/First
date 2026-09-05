"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { isDisputeKind, kindLabel } from "@/lib/dispute";
import { notifyJobTeam } from "@/lib/notifications";

export type DisputeResponse = { ok: true } | { ok: false; message: string };

/**
 * Putting a job in dispute.
 *
 * Two things happen and both matter. The job moves off the work columns, so
 * nobody picks it up as something to get on with. And the client stops
 * hearing from the app: no proposal update, no booking confirmation, no
 * receipt, until somebody decides otherwise.
 *
 * The reason is asked for rather than optional. A card that says "Legal" and
 * nothing else is a card that gets opened, and the whole point of the column
 * is that the board says what is wrong without anybody opening anything.
 */
export async function openDispute(
  jobId: string,
  kind: string,
  reason: string
): Promise<DisputeResponse> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };
    if (!isDisputeKind(kind)) return { ok: false, message: "Pick what kind of dispute this is." };

    const trimmed = reason.trim();
    if (!trimmed) return { ok: false, message: "Say what the problem is." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("jobs")
      .update({
        dispute_opened_at: new Date().toISOString(),
        // Cleared so a job disputed a second time reads as open rather than
        // as one resolved after it was raised.
        dispute_resolved_at: null,
        dispute_kind: kind,
        dispute_reason: trimmed,
        dispute_opened_by: profile.id,
      })
      .eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    // Everybody on the job, not just whoever is looking at the board. The
    // crew turning up on Tuesday is the thing this has to prevent.
    notifyJobTeam(
      jobId,
      "proposal_responses",
      `${kindLabel(kind)} dispute opened on a job: ${trimmed.slice(0, 120)}. Nothing automatic will go to this client.`,
      { dedupeKey: `${jobId}:dispute` }
    ).catch(() => {});

    revalidateJobViews(jobId);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't do that." };
  }
}

/**
 * Closing one out.
 *
 * Records a date rather than clearing the record. Whoever quotes this client
 * next should be able to find out that the last job ended with a solicitor's
 * letter, and a cleared row cannot tell them.
 */
export async function resolveDispute(jobId: string): Promise<DisputeResponse> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ dispute_resolved_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) return { ok: false, message: error.message };

    revalidateJobViews(jobId);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't do that." };
  }
}
