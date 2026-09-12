"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { roleKeysOf } from "@/lib/roles";
import {
  canDecideException,
  canMoveException,
  canMoveScopeChange,
  canReviewScopeChange,
  canWaiveClientApproval,
  blocksSending,
  isExceptionKind,
  OPENS_A_CHANGE_REQUEST,
  progressNeedsReason,
  STOPS_WORK_BY_DEFAULT,
  type ExceptionKind,
  type ExceptionState,
  type ProgressState,
  type ScopeChangeStatus,
} from "@/lib/exceptions";

/**
 * Everything that writes an exception, a change request or a piece of
 * progress.
 *
 * The rule the whole file exists to hold: **a field person can report, and
 * that is all.** They can say what happened, they can say whether they are
 * stopped, and they can record which parts of the work got done. They cannot
 * price anything, cannot agree anything with a client, and cannot enlarge what
 * the crew is contracted to do. Every function below that would change what
 * the client is buying checks the role before it touches a row, and the
 * database holds the same shape in check constraints underneath -- so a call
 * made from somewhere that forgot to check still cannot produce a change
 * request that skipped its review.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function failed(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function touch(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/my-day");
}

interface Actor {
  id: string;
  organization_id: string;
  roles: string[];
}

async function actor(): Promise<Actor | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return {
    id: profile.id as string,
    organization_id: profile.organization_id as string,
    roles: (profile.roles ?? []) as string[],
  };
}

/**
 * Write the history, always, and never let writing it fail the thing it
 * describes.
 *
 * The record is worth a great deal three months later and nothing at all if
 * its absence rolls back a decision somebody just made.
 */
async function logAudit(input: {
  jobId: string;
  who: Actor;
  subjectKind: "exception" | "scope_change" | "progress" | "assignment";
  subjectId: string;
  action: string;
  fromState?: string | null;
  toState?: string | null;
  note?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("job_audit_events").insert({
      organization_id: input.who.organization_id,
      job_id: input.jobId,
      subject_kind: input.subjectKind,
      subject_id: input.subjectId,
      action: input.action,
      from_state: input.fromState ?? null,
      to_state: input.toState ?? null,
      actor: input.who.id,
      // What they were allowed to be at the time. Roles change, and the reason
      // somebody was permitted to approve a thing has to stay readable.
      actor_roles: input.who.roles,
      note: input.note ?? null,
      detail: (input.detail ?? {}) as never,
    });
  } catch (err) {
    console.error("[audit] could not record", input.action, "on", input.subjectId, err);
  }
}

/* -------------------------------------------------------------------------
 * Reporting
 * ---------------------------------------------------------------------- */

/**
 * Somebody in the field says what happened.
 *
 * Not gated: anybody who can open the job can report on it, and a report that
 * is hard to make is a report that becomes a phone call. Where the kind means
 * the sold work changed, a change request is opened in the same breath and
 * linked -- so the crew's report goes straight onto an account manager's desk
 * without anybody having to forward it.
 */
export async function reportException(input: {
  jobId: string;
  kind: string;
  summary: string;
  detail?: string | null;
  blocksWork?: boolean;
  workSessionId?: string | null;
}): Promise<ActionResult<{ id: string; scopeChangeId: string | null }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    if (!isExceptionKind(input.kind)) return { ok: false, error: "That is not a kind of exception." };
    const summary = input.summary.trim();
    if (summary === "") return { ok: false, error: "Say what happened, in a few words." };

    const kind = input.kind as ExceptionKind;
    const blocks = input.blocksWork ?? STOPS_WORK_BY_DEFAULT[kind];

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("job_exceptions")
      .insert({
        organization_id: who.organization_id,
        job_id: input.jobId,
        work_session_id: input.workSessionId ?? null,
        kind,
        summary,
        detail: input.detail?.trim() || null,
        blocks_work: blocks,
        reported_by: who.id,
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = data.id as string;

    let scopeChangeId: string | null = null;
    if (OPENS_A_CHANGE_REQUEST.includes(kind)) {
      const { data: change, error: changeError } = await supabase
        .from("job_scope_changes")
        .insert({
          organization_id: who.organization_id,
          job_id: input.jobId,
          exception_id: id,
          requested_by: who.id,
          requested_note: input.detail?.trim() ? `${summary}\n\n${input.detail.trim()}` : summary,
        })
        .select("id")
        .single();
      if (changeError) throw changeError;
      scopeChangeId = change.id as string;
      await supabase.from("job_exceptions").update({ scope_change_id: scopeChangeId }).eq("id", id);
      await logAudit({
        jobId: input.jobId,
        who,
        subjectKind: "scope_change",
        subjectId: scopeChangeId,
        action: "reported",
        toState: "reported",
        note: summary,
      });
    }

    await logAudit({
      jobId: input.jobId,
      who,
      subjectKind: "exception",
      subjectId: id,
      action: "reported",
      toState: "reported",
      note: summary,
      detail: { kind, blocksWork: blocks },
    });

    touch(input.jobId);
    return { ok: true, value: { id, scopeChangeId } };
  } catch (err) {
    return failed(err);
  }
}

async function moveException(
  id: string,
  to: ExceptionState,
  resolution: string | null
): Promise<ActionResult<{ id: string }>> {
  const who = await actor();
  if (!who) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("job_exceptions")
    .select("id, job_id, kind, state")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return { ok: false, error: "That exception is not there any more." };

  const from = row.state as ExceptionState;
  if (!canMoveException(from, to)) {
    return { ok: false, error: `An exception that is ${from} cannot become ${to}.` };
  }
  if (!canDecideException(roleKeysOf(who.roles), row.kind as ExceptionKind)) {
    return { ok: false, error: "That is not your decision to make." };
  }

  const patch: Record<string, unknown> = { state: to, updated_at: new Date().toISOString() };
  if (to === "acknowledged") {
    patch.acknowledged_by = who.id;
    patch.acknowledged_at = new Date().toISOString();
  }
  if (to === "resolved" || to === "dismissed") {
    patch.resolution = resolution;
    patch.resolved_by = who.id;
    patch.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase.from("job_exceptions").update(patch as never).eq("id", id);
  if (error) throw error;

  await logAudit({
    jobId: row.job_id as string,
    who,
    subjectKind: "exception",
    subjectId: id,
    action: to,
    fromState: from,
    toState: to,
    note: resolution,
  });
  touch(row.job_id as string);
  return { ok: true, value: { id } };
}

/** Somebody with the authority has seen it and is dealing with it. */
export async function acknowledgeException(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    return await moveException(id, "acknowledged", null);
  } catch (err) {
    return failed(err);
  }
}

/** Settled. Closing one without saying how is refused by the database as well. */
export async function resolveException(id: string, resolution: string): Promise<ActionResult<{ id: string }>> {
  try {
    const said = resolution.trim();
    if (said === "") return { ok: false, error: "Say what was done about it." };
    return await moveException(id, "resolved", said);
  } catch (err) {
    return failed(err);
  }
}

/** Not a problem after all -- which is still a decision, and still needs a reason. */
export async function dismissException(id: string, reason: string): Promise<ActionResult<{ id: string }>> {
  try {
    const said = reason.trim();
    if (said === "") return { ok: false, error: "Say why this is not a problem." };
    return await moveException(id, "dismissed", said);
  } catch (err) {
    return failed(err);
  }
}

/* -------------------------------------------------------------------------
 * The change request pipeline
 * ---------------------------------------------------------------------- */

async function moveScopeChange(
  id: string,
  to: ScopeChangeStatus,
  patch: Record<string, unknown>,
  note: string | null
): Promise<ActionResult<{ id: string }>> {
  const who = await actor();
  if (!who) return { ok: false, error: "Not signed in." };
  if (!canReviewScopeChange(roleKeysOf(who.roles))) {
    // The boundary the whole design turns on: running the work and selling it
    // are different jobs, and only one of them can change what is being sold.
    return { ok: false, error: "Only an account manager or the owner can decide a change request." };
  }

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("job_scope_changes")
    .select("id, job_id, status, price_cents, priced_at, reviewed_at, client_approval_required")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return { ok: false, error: "That change request is not there any more." };

  const from = row.status as ScopeChangeStatus;
  if (!canMoveScopeChange(from, to)) {
    return { ok: false, error: `A change request that is ${from} cannot become ${to}.` };
  }

  const { error } = await supabase
    .from("job_scope_changes")
    .update({ ...patch, status: to, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;

  await logAudit({
    jobId: row.job_id as string,
    who,
    subjectKind: "scope_change",
    subjectId: id,
    action: to,
    fromState: from,
    toState: to,
    note,
  });
  touch(row.job_id as string);
  return { ok: true, value: { id } };
}

/** An account manager picks it up. Nothing reaches a client without this. */
export async function reviewScopeChange(id: string, reviewNote?: string | null): Promise<ActionResult<{ id: string }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    return await moveScopeChange(
      id,
      "in_review",
      { reviewed_by: who.id, reviewed_at: new Date().toISOString(), review_note: reviewNote?.trim() || null },
      reviewNote?.trim() || null
    );
  } catch (err) {
    return failed(err);
  }
}

/**
 * A number and the terms that go with it.
 *
 * A null price means free, and `priced_at` is what makes that a decision
 * somebody took rather than a field nobody filled in. That distinction is the
 * one `blocksSending` reads.
 */
export async function priceScopeChange(input: {
  id: string;
  priceCents: number | null;
  terms?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    if (input.priceCents != null && (!Number.isFinite(input.priceCents) || input.priceCents < 0)) {
      return { ok: false, error: "A price cannot be negative." };
    }
    return await moveScopeChange(
      input.id,
      "priced",
      {
        price_cents: input.priceCents,
        terms: input.terms?.trim() || null,
        priced_by: who.id,
        priced_at: new Date().toISOString(),
      },
      input.priceCents == null ? "No charge" : `${(input.priceCents / 100).toFixed(2)}`
    );
  } catch (err) {
    return failed(err);
  }
}

/** Put it in front of the client. Refused if it has not been reviewed and settled. */
export async function sendScopeChangeToClient(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("job_scope_changes")
      .select("status, reviewed_at, price_cents, priced_at, client_approval_required, approval_waived_reason, client_decision, executable_at")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, error: "That change request is not there any more." };

    const blocked = blocksSending({
      status: row.status as ScopeChangeStatus,
      reviewedAt: (row.reviewed_at as string | null) ?? null,
      priceCents: (row.price_cents as number | null) ?? null,
      pricedAt: (row.priced_at as string | null) ?? null,
      clientApprovalRequired: Boolean(row.client_approval_required),
      approvalWaivedReason: (row.approval_waived_reason as string | null) ?? null,
      clientDecision: (row.client_decision as "approved" | "declined" | null) ?? null,
      executableAt: (row.executable_at as string | null) ?? null,
    });
    if (blocked) return { ok: false, error: blocked };

    return await moveScopeChange(id, "sent_to_client", { sent_to_client_at: new Date().toISOString() }, null);
  } catch (err) {
    return failed(err);
  }
}

/**
 * The client's answer, written down by whoever heard it.
 *
 * A verbal yes is a real yes, and it is worth more when the record says it was
 * verbal and names who took the call. Approving here is what makes the change
 * executable -- the database stamps `executable_at` on the way through, which
 * is the only way that column is ever set.
 */
export async function recordClientDecision(input: {
  id: string;
  decision: "approved" | "declined";
  channel: "portal" | "email" | "sms" | "phone" | "in_person" | "other";
  note?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    const now = new Date().toISOString();
    return await moveScopeChange(
      input.id,
      input.decision === "approved" ? "client_approved" : "client_declined",
      {
        client_decision: input.decision,
        client_decision_at: now,
        client_decision_note: input.note?.trim() || null,
        client_decision_channel: input.channel,
        client_decision_recorded_by: who.id,
      },
      `${input.decision} by ${input.channel.replace("_", " ")}`
    );
  } catch (err) {
    return failed(err);
  }
}

/**
 * Approve a free change without going back to the client.
 *
 * They are the one who asked, standing there, and it costs nothing. Never
 * allowed on something they are being charged for, and the reason is required
 * by the database as well as by this function.
 */
export async function approveWithoutClient(input: { id: string; reason: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const reason = input.reason.trim();
    if (reason === "") return { ok: false, error: "Say why the client does not need to approve this." };

    const supabase = await createClient();
    const { data: row } = await supabase
      .from("job_scope_changes")
      .select("price_cents")
      .eq("id", input.id)
      .maybeSingle();
    if (!row) return { ok: false, error: "That change request is not there any more." };
    if (!canWaiveClientApproval((row.price_cents as number | null) ?? null)) {
      return { ok: false, error: "A change the client is being charged for needs the client's approval." };
    }

    return await moveScopeChange(
      input.id,
      "client_approved",
      { client_approval_required: false, approval_waived_reason: reason, client_decision_recorded_by: null },
      reason
    );
  } catch (err) {
    return failed(err);
  }
}

/** The business says no before the client ever sees it. */
export async function rejectScopeChange(id: string, reason: string): Promise<ActionResult<{ id: string }>> {
  try {
    const said = reason.trim();
    if (said === "") return { ok: false, error: "Say why this is not being offered." };
    return await moveScopeChange(id, "rejected", { review_note: said }, said);
  } catch (err) {
    return failed(err);
  }
}

/** Taken back. Kept, not deleted -- somebody asked for it, and that happened. */
export async function withdrawScopeChange(id: string, reason: string): Promise<ActionResult<{ id: string }>> {
  try {
    const said = reason.trim();
    if (said === "") return { ok: false, error: "Say why it is being withdrawn." };
    return await moveScopeChange(id, "withdrawn", { review_note: said }, said);
  } catch (err) {
    return failed(err);
  }
}

/**
 * A revised version, beside the old one rather than over it.
 *
 * The client declined at four hundred and would say yes at two-fifty. Both
 * numbers are part of the story, so the first request is marked superseded and
 * the new one records what it replaced.
 */
export async function reviseScopeChange(input: {
  id: string;
  requestedNote: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    if (!canReviewScopeChange(roleKeysOf(who.roles))) {
      return { ok: false, error: "Only an account manager or the owner can revise a change request." };
    }
    const note = input.requestedNote.trim();
    if (note === "") return { ok: false, error: "Say what the revised change is." };

    const supabase = await createClient();
    const { data: old } = await supabase
      .from("job_scope_changes")
      .select("id, job_id, status, exception_id, proposed")
      .eq("id", input.id)
      .maybeSingle();
    if (!old) return { ok: false, error: "That change request is not there any more." };

    const { data: fresh, error } = await supabase
      .from("job_scope_changes")
      .insert({
        organization_id: who.organization_id,
        job_id: old.job_id as string,
        exception_id: (old.exception_id as string | null) ?? null,
        requested_by: who.id,
        requested_note: note,
        proposed: (old.proposed ?? {}) as never,
        supersedes_id: old.id as string,
      })
      .select("id")
      .single();
    if (error) throw error;

    await moveScopeChange(input.id, "superseded", {}, `Replaced by a revised request`);
    await logAudit({
      jobId: old.job_id as string,
      who,
      subjectKind: "scope_change",
      subjectId: fresh.id as string,
      action: "revised",
      toState: "reported",
      note,
      detail: { supersedes: old.id },
    });

    touch(old.job_id as string);
    return { ok: true, value: { id: fresh.id as string } };
  } catch (err) {
    return failed(err);
  }
}

/* -------------------------------------------------------------------------
 * Progress
 * ---------------------------------------------------------------------- */

/**
 * A crew records what they actually did to one zone, service or task.
 *
 * Field work, deliberately ungated beyond being on the job: this is the thing
 * that has to be easy with a thumb, in a garden, in the rain. Anything short
 * of done has to say why, here and in the database, because "three of four" on
 * its own still ends in a phone call.
 */
export async function recordProgress(input: {
  jobId: string;
  unitKind: "zone" | "service" | "task";
  unitKey: string;
  unitLabel?: string | null;
  state: ProgressState;
  portionPct?: number | null;
  note?: string | null;
  workSessionId?: string | null;
  exceptionId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    const note = input.note?.trim() || null;
    if (progressNeedsReason(input.state) && !note) {
      return { ok: false, error: "Say what stopped this part being finished." };
    }
    if (input.portionPct != null && (input.portionPct < 0 || input.portionPct > 100)) {
      return { ok: false, error: "A portion is between 0 and 100." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("job_work_progress")
      .upsert(
        {
          organization_id: who.organization_id,
          job_id: input.jobId,
          unit_kind: input.unitKind,
          unit_key: input.unitKey,
          unit_label: input.unitLabel ?? null,
          state: input.state,
          portion_pct: input.portionPct ?? null,
          note,
          work_session_id: input.workSessionId ?? null,
          exception_id: input.exceptionId ?? null,
          recorded_by: who.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id,unit_kind,unit_key" }
      )
      .select("id")
      .single();
    if (error) throw error;

    await logAudit({
      jobId: input.jobId,
      who,
      subjectKind: "progress",
      subjectId: data.id as string,
      action: "recorded",
      toState: input.state,
      note,
      detail: { unitKind: input.unitKind, unitKey: input.unitKey, portionPct: input.portionPct ?? null },
    });

    touch(input.jobId);
    return { ok: true, value: { id: data.id as string } };
  } catch (err) {
    return failed(err);
  }
}

/* -------------------------------------------------------------------------
 * Who is on the job
 * ---------------------------------------------------------------------- */

/**
 * Somebody comes off a job and somebody else goes on.
 *
 * `job_crew` keeps saying who is on it now; the history is written beside it
 * by a database trigger, so no path can take a person off a job without
 * leaving a record. What this adds is the two things a trigger cannot know:
 * why they came off, and who took it over. Without those the history is a list
 * of comings and goings; with them it says "Dave called out and Marcus
 * covered".
 */
export async function reassignCrew(input: {
  jobId: string;
  offProfileId: string;
  ontoProfileId?: string | null;
  reason: string;
  asLead?: boolean;
  exceptionId?: string | null;
}): Promise<ActionResult<{ replaced: boolean }>> {
  try {
    const who = await actor();
    if (!who) return { ok: false, error: "Not signed in." };
    const keys = roleKeysOf(who.roles);
    if (!keys.includes("owner") && !keys.includes("account-manager") && !keys.includes("project-lead")) {
      return { ok: false, error: "Only a project lead, an account manager or the owner can change a crew." };
    }
    const reason = input.reason.trim();
    if (reason === "") return { ok: false, error: "Say why they are coming off." };

    const supabase = await createClient();

    if (input.ontoProfileId) {
      const { error } = await supabase.from("job_crew").insert({
        organization_id: who.organization_id,
        job_id: input.jobId,
        profile_id: input.ontoProfileId,
        is_lead: input.asLead ?? false,
        added_by: who.id,
      });
      if (error) throw error;
    }

    // Removing closes the open assignment row by trigger; this fills in the
    // parts the trigger cannot know.
    const { error: removeError } = await supabase
      .from("job_crew")
      .delete()
      .eq("job_id", input.jobId)
      .eq("profile_id", input.offProfileId);
    if (removeError) throw removeError;

    const { data: closed } = await supabase
      .from("job_crew_assignments")
      .select("id")
      .eq("job_id", input.jobId)
      .eq("profile_id", input.offProfileId)
      .not("unassigned_at", "is", null)
      .order("unassigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (closed) {
      await supabase
        .from("job_crew_assignments")
        .update({
          unassigned_by: who.id,
          unassign_reason: reason,
          replaced_by_profile_id: input.ontoProfileId ?? null,
          exception_id: input.exceptionId ?? null,
        })
        .eq("id", closed.id as string);

      await logAudit({
        jobId: input.jobId,
        who,
        subjectKind: "assignment",
        subjectId: closed.id as string,
        action: input.ontoProfileId ? "replaced" : "removed",
        note: reason,
        detail: { off: input.offProfileId, onto: input.ontoProfileId ?? null },
      });
    }

    touch(input.jobId);
    return { ok: true, value: { replaced: Boolean(input.ontoProfileId) } };
  } catch (err) {
    return failed(err);
  }
}
