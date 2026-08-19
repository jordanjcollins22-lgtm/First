"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { notifyTeamMember } from "@/lib/notifications";
import { canRequestWalkthrough, canReviewWalkthrough } from "@/lib/walkthrough";
import { workHasStarted } from "@/lib/job-stage";
import type { JobStatus, WalkthroughStatus, WorkSessionStatus } from "@/types/domain";

export type WalkthroughResult = { ok: true; message?: string } | { ok: false; message: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/attractors");
  revalidatePath("/pipeline");
}

/** The job's walkthroughs, newest first — the order the rules assume. */
async function loadWalkthroughs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data } = await supabase
    .from("job_walkthroughs")
    .select("status, requested_at, reviewed_at, review_notes")
    .eq("job_id", jobId)
    .order("requested_at", { ascending: false });
  return (data ?? []) as {
    status: WalkthroughStatus;
    requested_at: string;
    reviewed_at: string | null;
    review_notes: string | null;
  }[];
}

/**
 * The crew asks the account manager to come and look, from site.
 *
 * Texts the manager immediately rather than waiting for them to notice a
 * dashboard. The entire value of this step is that it happens before the tools
 * go away, and a notification nobody sees for an hour is the same as no step
 * at all.
 */
export async function requestWalkthrough(jobId: string, note: string | null): Promise<WalkthroughResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();

    const [{ data: job }, { data: sessions }, walkthroughs] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, status, name, property_id, properties(address, customers(name, account_manager_id))")
        .eq("id", jobId)
        .single(),
      supabase.from("job_work_sessions").select("status").eq("job_id", jobId),
      loadWalkthroughs(supabase, jobId),
    ]);
    if (!job) return { ok: false, message: "Couldn't find that job." };

    const started = workHasStarted({
      status: job.status as JobStatus,
      evaluationStatus: "",
      evaluationDate: null,
      proposalStatus: null,
      sessions: ((sessions ?? []) as { status: string }[]).map((s) => ({
        status: s.status as WorkSessionStatus,
      })),
    });

    const verdict = canRequestWalkthrough(started, walkthroughs);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const organizationId = await getCurrentOrganizationId();
    const { error } = await supabase.from("job_walkthroughs").insert({
      job_id: jobId,
      organization_id: organizationId,
      requested_by: profile.id,
      requested_note: note?.trim() || null,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    const property = (job as unknown as {
      properties: { address: string; customers: { name: string; account_manager_id: string | null } | null } | null;
    }).properties;
    const managerId = property?.customers?.account_manager_id ?? null;

    if (managerId) {
      // Best-effort: a text that fails should not stop the request existing.
      await notifyTeamMember(
        managerId,
        "walkthrough_requests",
        `Walkthrough needed at ${property?.address ?? job.name}. The crew is on site waiting to pack up.`
      ).catch(() => null);
    }

    refresh(jobId);
    return {
      ok: true,
      message: managerId
        ? "Manager notified. Keep the tools out until they've walked it."
        : "Requested — but this client has no account manager assigned, so nobody was texted.",
    };
  } catch (err) {
    console.error("requestWalkthrough failed:", err);
    return { ok: false, message: "Couldn't request the walkthrough." };
  }
}

/**
 * The manager's verdict.
 *
 * A rejection carries the punch list, and it is required: "not approved" with
 * no list leaves a crew standing on a site guessing, which is worse than not
 * having walked it at all.
 */
export async function reviewWalkthrough(
  jobId: string,
  approved: boolean,
  notes: string | null
): Promise<WalkthroughResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    if (!approved && !notes?.trim()) {
      return { ok: false, message: "Say what needs fixing — the crew is still on site." };
    }

    const supabase = await createClient();
    const walkthroughs = await loadWalkthroughs(supabase, jobId);

    const verdict = canReviewWalkthrough(walkthroughs);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { data: pending } = await supabase
      .from("job_walkthroughs")
      .select("id, requested_by")
      .eq("job_id", jobId)
      .eq("status", "requested")
      .order("requested_at", { ascending: false })
      .limit(1)
      .single();
    if (!pending) return { ok: false, message: "Nothing is waiting on a decision." };

    const { error } = await supabase
      .from("job_walkthroughs")
      .update({
        status: approved ? "approved" : "rejected",
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes?.trim() || null,
      })
      .eq("id", pending.id);
    if (error) return { ok: false, message: describeDbError(error) };

    // Tell whoever asked, straight away — they are waiting to load the van.
    if (pending.requested_by && pending.requested_by !== profile.id) {
      await notifyTeamMember(
        pending.requested_by,
        "walkthrough_requests",
        approved
          ? "Walkthrough approved — you're clear to pack up."
          : `Walkthrough: changes needed before you leave. ${notes?.trim() ?? ""}`.trim()
      ).catch(() => null);
    }

    refresh(jobId);
    return {
      ok: true,
      message: approved ? "Approved. The crew can sign off." : "Sent back with the changes.",
    };
  } catch (err) {
    console.error("reviewWalkthrough failed:", err);
    return { ok: false, message: "Couldn't record that." };
  }
}

/** Withdraws a request that shouldn't have gone out, leaving the job where it
 * was rather than recording a decision nobody made. */
export async function cancelWalkthroughRequest(jobId: string): Promise<WalkthroughResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: pending } = await supabase
      .from("job_walkthroughs")
      .select("id")
      .eq("job_id", jobId)
      .eq("status", "requested")
      .order("requested_at", { ascending: false })
      .limit(1)
      .single();
    if (!pending) return { ok: false, message: "Nothing to withdraw." };

    const { error } = await supabase
      .from("job_walkthroughs")
      .update({ status: "cancelled" })
      .eq("id", pending.id);
    if (error) return { ok: false, message: describeDbError(error) };

    refresh(jobId);
    return { ok: true, message: "Request withdrawn." };
  } catch (err) {
    console.error("cancelWalkthroughRequest failed:", err);
    return { ok: false, message: "Couldn't withdraw that." };
  }
}
