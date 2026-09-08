"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { canOverrideGate } from "@/lib/affiliate-roles";
import { blocksByDefault, isBlockingStage, isIssueType, isSeverity } from "@/lib/issues";
import { GATE_LABEL, type GateKey } from "@/lib/readiness";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function failed(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function touch(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/my-day");
}

/**
 * Somebody says something is wrong.
 *
 * Anybody on the job can raise one, including from the Field tab with a
 * thumb -- that is the whole point. Whether it stops the work follows from
 * the severity, and a manager can change that afterwards on the issue itself.
 */
export async function raiseIssue(input: {
  jobId: string;
  type: string;
  severity: string;
  title: string;
  description?: string | null;
  blockingStage?: string | null;
  dueAt?: string | null;
}): Promise<ActionResult<{ id: string; blocking: boolean }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!isIssueType(input.type)) return { ok: false, error: "That is not a kind of issue." };
    if (!isSeverity(input.severity)) return { ok: false, error: "That is not a severity." };
    const title = input.title.trim();
    if (title === "") return { ok: false, error: "Say what is wrong, in a few words." };

    const stage = input.blockingStage && isBlockingStage(input.blockingStage) ? input.blockingStage : null;
    const blocking = blocksByDefault(input.severity);

    const supabase = await createClient();
    const { data: job } = await supabase
      .from("jobs")
      .select("property_id, properties(customer_id)")
      .eq("id", input.jobId)
      .maybeSingle();

    const { data, error } = await supabase
      .from("job_issues")
      .insert({
        organization_id: profile.organization_id,
        job_id: input.jobId,
        property_id: (job?.property_id as string) ?? null,
        customer_id: ((job?.properties as { customer_id?: string } | null)?.customer_id as string) ?? null,
        type: input.type,
        severity: input.severity,
        title,
        description: input.description?.trim() || null,
        blocking,
        blocking_stage: stage,
        due_at: input.dueAt ?? null,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: { id: data.id as string, blocking } };
  } catch (err) {
    return failed(err);
  }
}

/**
 * It is dealt with.
 *
 * The resolution is required. An issue that closes with no word on what
 * happened is the thing somebody re-opens in three weeks having learned
 * nothing.
 */
export async function resolveIssue(input: {
  issueId: string;
  jobId: string;
  resolution: string;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    const resolution = input.resolution.trim();
    if (resolution === "") return { ok: false, error: "Say what was done about it." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("job_issues")
      .update({
        status: "resolved",
        resolution,
        resolved_by: profile.id,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.issueId);
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * Whether this issue stops the job, decided by somebody who can say.
 *
 * A crew member's "blocking" and a manager's are the same word meaning
 * different things: one is "I cannot work", the other is "the business
 * accepts this job does not move". Only the second is allowed to change it.
 */
export async function setIssueBlocking(input: {
  issueId: string;
  jobId: string;
  blocking: boolean;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!canOverrideGate(profile.roles ?? [])) {
      return { ok: false, error: "Only a manager, owner or admin can decide whether an issue stops a job." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("job_issues")
      .update({ blocking: input.blocking, updated_at: new Date().toISOString() })
      .eq("id", input.issueId);
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * A failed check is let past, on the record.
 *
 * The check is never altered. This writes a row saying who let it past, when,
 * why and which check -- and the check goes on reading as failed, beside the
 * name of the person who took responsibility for it. That is the true account
 * of what happened, and it is the one somebody wants three weeks later.
 */
export async function overrideCheck(input: {
  jobId: string;
  gate: GateKey;
  checkKey: string;
  reason: string;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!canOverrideGate(profile.roles ?? [])) {
      return {
        ok: false,
        error: "Only a manager, owner or admin can let a job past a failed check. Raise an issue instead.",
      };
    }
    const reason = input.reason.trim();
    if (reason.length < 4) {
      return { ok: false, error: `Say why ${GATE_LABEL[input.gate]} is being let past. This is kept on the job.` };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("job_gate_overrides").upsert(
      {
        organization_id: profile.organization_id,
        job_id: input.jobId,
        gate: input.gate,
        check_key: input.checkKey,
        reason,
        overridden_by: profile.id,
        overridden_at: new Date().toISOString(),
        withdrawn_at: null,
        withdrawn_by: null,
      },
      { onConflict: "job_id,gate,check_key" }
    );
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/** The exception is lifted — usually because the real condition is now met. */
export async function withdrawOverride(input: {
  jobId: string;
  gate: GateKey;
  checkKey: string;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!canOverrideGate(profile.roles ?? [])) {
      return { ok: false, error: "Only a manager, owner or admin can lift an override." };
    }

    const supabase = await createClient();
    // Kept rather than deleted: the record that it was let past once is part
    // of the job's history whether or not it still applies.
    const { error } = await supabase
      .from("job_gate_overrides")
      .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: profile.id })
      .eq("job_id", input.jobId)
      .eq("gate", input.gate)
      .eq("check_key", input.checkKey)
      .is("withdrawn_at", null);
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}
