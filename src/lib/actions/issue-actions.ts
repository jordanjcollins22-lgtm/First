"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { canOverrideGate, canSeeMoney } from "@/lib/affiliate-roles";
import { blocksByDefault, isBlockingStage, isIssueType, isSeverity } from "@/lib/issues";
import { GATE_LABEL, type GateKey } from "@/lib/readiness";
import { isAdjustmentKind } from "@/lib/payments-net";

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

/**
 * Somebody confirms a thing is actually in hand.
 *
 * This is the positive evidence the readiness engine wants, and it is
 * deliberately a separate act from resolving an issue. A confirmation answers
 * "have we verified what needs to be true"; an issue answers "is there a known
 * problem". Both can be true at once: the materials were confirmed on Tuesday
 * and the supplier rang on Wednesday, and the job stops for the second without
 * the first being rubbed out.
 */
export async function setConfirmation(input: {
  jobId: string;
  kind: "materials" | "equipment" | "access";
  state: "not_required" | "required_unconfirmed" | "confirmed";
  note?: string | null;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };

    const supabase = await createClient();
    const { error } = await supabase.from("job_confirmations").upsert(
      {
        organization_id: profile.organization_id,
        job_id: input.jobId,
        kind: input.kind,
        state: input.state,
        note: input.note?.trim() || null,
        confirmed_by: profile.id,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,kind" }
    );
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * What is happening about money the business is not going to be paid in the
 * ordinary way.
 *
 * A balance does not stop a job being Completed -- the landscaping really is
 * finished -- but it does not get to disappear either. It keeps the job in
 * Needs attention until it is settled or until somebody records, here, that it
 * is waived, written off, refunded, on a plan, disputed or with collections.
 * There is no way to make it quiet by pretending it was paid.
 */
export async function setFinancialDisposition(input: {
  jobId: string;
  state: "waived" | "written_off" | "refunded" | "payment_plan" | "disputed" | "collections";
  reason: string;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!canSeeMoney(profile.roles ?? [])) {
      return { ok: false, error: "Only somebody trusted with the money can decide what happens to a balance." };
    }
    const reason = input.reason.trim();
    if (reason.length < 4) return { ok: false, error: "Say why. This is kept on the job." };

    const supabase = await createClient();
    // The previous decision is closed rather than deleted: what the business
    // decided in March is part of the job's history in June.
    await supabase
      .from("job_financial_dispositions")
      .update({ cleared_at: new Date().toISOString(), cleared_by: profile.id })
      .eq("job_id", input.jobId)
      .is("cleared_at", null);

    const { error } = await supabase.from("job_financial_dispositions").insert({
      organization_id: profile.organization_id,
      job_id: input.jobId,
      state: input.state,
      reason,
      decided_by: profile.id,
    });
    if (error) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * Money that has gone back out again.
 *
 * The receipt is never edited and never deleted: the money really was taken on
 * the day, and that is part of the job's history. What left is written beside
 * it, and the readiness engine reads the difference -- so a deposit stops being
 * satisfied the moment it is refunded, without anybody having to remember to
 * un-tick something.
 *
 * `externalId` is the processor's own id where there is one. It is unique in
 * the database, so the same webhook delivered twice takes the money off once.
 */
export async function recordPaymentAdjustment(input: {
  paymentId: string;
  jobId: string;
  kind: string;
  amountCents: number;
  reason: string;
  externalId?: string | null;
}): Promise<ActionResult<null>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    if (!canSeeMoney(profile.roles ?? [])) {
      return { ok: false, error: "Only somebody trusted with the money can record a refund or a reversal." };
    }
    if (!isAdjustmentKind(input.kind)) return { ok: false, error: "That is not a kind of adjustment." };
    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Say how much went back out." };
    }
    const reason = input.reason.trim();
    if (reason.length < 4) return { ok: false, error: "Say why. This is kept on the job." };

    const supabase = await createClient();
    const { error } = await supabase.from("payment_adjustments").insert({
      organization_id: profile.organization_id,
      payment_id: input.paymentId,
      job_id: input.jobId,
      kind: input.kind,
      amount_cents: Math.round(input.amountCents),
      reason,
      external_id: input.externalId ?? null,
      recorded_by: profile.id,
    });
    // A repeat of a webhook we have already accounted for is not a failure.
    if (error && !/duplicate key|unique constraint/i.test(error.message)) throw error;

    touch(input.jobId);
    return { ok: true, value: null };
  } catch (err) {
    return failed(err);
  }
}
