/**
 * What happens when each fact arrives: the first vertical slice.
 *
 *   lead.created -> book the visit -> appointment.requested -> confirm it ->
 *   appointment.completed -> write the estimate -> estimate.sent -> follow up
 *   while unanswered -> estimate.approved -> deposit, then readiness ->
 *   job.ready_for_scheduling
 *
 * Every handler is safe to run twice. Delivery is at least once, so the same
 * event will arrive again one day, and when it does every task, action and
 * follow-on event it would make is found by its key rather than made anew.
 *
 * Nothing here texts, emails or charges anybody. Tasks are for people;
 * actions are decisions, kept in dry-run unless the owner switches that off,
 * and even then the follow-up rule only proposes: the existing sequence still
 * does the sending until the owner moves it over.
 */

import { CONSUMERS, eventKey, type EventInput, type StoredEvent } from "@/lib/os/contracts";
import {
  appointmentV1,
  estimateApprovedV1,
  estimateDeadlineV1,
  proposalFollowUpV1,
  withParams,
  type RuleDefinition,
} from "@/lib/os/rules";
import { isStale } from "@/lib/os/stage";
import type { ActionRow, AuditEntry, Controls, OsFacts, OsStore } from "@/lib/os/store";
import { evaluateGate } from "@/lib/readiness";
import { followUpPlan, followUpStop } from "@/lib/client-automations/proposal-follow-ups";
import { consentVerdict, type Channel } from "@/lib/client-consent";
import { dedupeKeyFor } from "@/lib/client-reminders";

const HOUR = 60 * 60 * 1000;

export interface Deps {
  store: OsStore;
  facts: OsFacts;
  now: () => Date;
}

const iso = (ms: number) => new Date(ms).toISOString();

async function ruleFor<P extends object>(deps: Deps, organizationId: string, rule: RuleDefinition<P>): Promise<RuleDefinition<P>> {
  const stored = await deps.store.ruleOverride(organizationId, rule.ruleId, rule.version);
  return stored ? withParams(rule, stored.params, stored.mode) : rule;
}

function audit(deps: Deps, event: StoredEvent | null, rule: RuleDefinition<object>, entry: Omit<AuditEntry, "organizationId" | "ruleId" | "ruleVersion" | "eventId"> & { organizationId?: string }) {
  return deps.store.audit({
    organizationId: entry.organizationId ?? event!.organizationId,
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    eventId: event?.eventId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    decision: entry.decision,
    inputs: entry.inputs,
    result: entry.result,
  });
}

/** Record a follow-on fact, chained to the event that caused it. */
function follow<T extends EventInput["type"]>(deps: Deps, cause: StoredEvent, input: Omit<EventInput<T>, "organizationId" | "correlationId" | "causationId" | "actor" | "source">) {
  return deps.store.recordEvent(
    {
      ...input,
      organizationId: cause.organizationId,
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "system", id: null },
      source: "event_backbone",
    } as EventInput,
    CONSUMERS[input.type]
  );
}

// ---------------------------------------------------------------------------
// The workflow consumer: tasks for people, and readiness
// ---------------------------------------------------------------------------

export async function handleWorkflow(deps: Deps, event: StoredEvent): Promise<void> {
  switch (event.type) {
    case "lead.created":
      return onLeadCreated(deps, event as StoredEvent<"lead.created">);
    case "appointment.requested":
      return onAppointmentRequested(deps, event as StoredEvent<"appointment.requested">);
    case "appointment.confirmed":
      return onAppointmentConfirmed(deps, event as StoredEvent<"appointment.confirmed">);
    case "appointment.completed":
      return onAppointmentCompleted(deps, event as StoredEvent<"appointment.completed">);
    case "estimate.sent":
      return onEstimateSent(deps, event as StoredEvent<"estimate.sent">);
    case "estimate.approved":
      return onEstimateApproved(deps, event as StoredEvent<"estimate.approved">);
    case "estimate.declined":
      return onEstimateDeclined(deps, event as StoredEvent<"estimate.declined">);
    case "deposit.settled":
      return onDepositSettled(deps, event as StoredEvent<"deposit.settled">);
    default:
      return;
  }
}

async function onLeadCreated(deps: Deps, event: StoredEvent<"lead.created">) {
  const rule = await ruleFor(deps, event.organizationId, appointmentV1);
  const { jobId, evaluationAt } = event.payload;
  if (evaluationAt) {
    await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: "visit_already_booked", inputs: { evaluationAt }, result: {} });
    return;
  }
  const { task, created } = await deps.store.ensureTask({
    organizationId: event.organizationId,
    jobId,
    kind: "book_evaluation",
    title: "Book an evaluation visit",
    detail: `New lead from ${event.payload.channel}. Offer them a time.`,
    blocking: false,
    dueAt: iso(Date.parse(event.occurredAt) + rule.params.bookWithinHours * HOUR),
    dedupeKey: `book_evaluation:${jobId}`,
    sourceEvent: event.eventId,
  });
  await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: created ? "task_opened" : "task_exists", inputs: event.payload, result: { taskId: task.id } });
}

async function onAppointmentRequested(deps: Deps, event: StoredEvent<"appointment.requested">) {
  const rule = await ruleFor(deps, event.organizationId, appointmentV1);
  const { jobId, startsAt } = event.payload;
  await deps.store.closeTasks(event.organizationId, { jobId, kinds: ["book_evaluation"] }, "A visit was booked.", deps.now());

  // A confirmation (or the visit itself) already recorded after this request
  // means the request is old news arriving late.
  const later = await deps.store.latestEvent(event.organizationId, jobId, ["appointment.confirmed", "appointment.completed"]);
  if (later && isStale(event, later.occurredAt)) {
    await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: "ignored_out_of_order", inputs: event.payload, result: { laterEvent: later.eventId } });
    return;
  }
  const { task, created } = await deps.store.ensureTask({
    organizationId: event.organizationId,
    jobId,
    kind: "confirm_appointment",
    title: "Confirm the evaluation visit with the client",
    detail: `Booked for ${startsAt}. Sending a confirmation is not the client confirming.`,
    blocking: false,
    dueAt: iso(Math.min(Date.parse(startsAt), Date.parse(event.occurredAt) + rule.params.confirmWithinHours * HOUR)),
    dedupeKey: `confirm_appointment:${jobId}:${startsAt}`,
    sourceEvent: event.eventId,
  });
  await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: created ? "task_opened" : "task_exists", inputs: event.payload, result: { taskId: task.id } });
}

async function onAppointmentConfirmed(deps: Deps, event: StoredEvent<"appointment.confirmed">) {
  const rule = await ruleFor(deps, event.organizationId, appointmentV1);
  const { jobId, startsAt } = event.payload;
  const closed = await deps.store.closeTasks(
    event.organizationId,
    { jobId, dedupeKeys: [`confirm_appointment:${jobId}:${startsAt}`] },
    `Confirmed${event.payload.confirmedBy ? ` by ${event.payload.confirmedBy}` : ""}.`,
    deps.now()
  );
  await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: "appointment_confirmed", inputs: event.payload, result: { tasksClosed: closed } });
}

async function onAppointmentCompleted(deps: Deps, event: StoredEvent<"appointment.completed">) {
  const rule = await ruleFor(deps, event.organizationId, estimateDeadlineV1);
  const { jobId, completedAt } = event.payload;
  await deps.store.closeTasks(event.organizationId, { jobId, kinds: ["book_evaluation", "confirm_appointment"] }, "The visit happened.", deps.now());
  const { task, created } = await deps.store.ensureTask({
    organizationId: event.organizationId,
    jobId,
    kind: "prepare_estimate",
    title: "Write and send the estimate",
    detail: `Due ${rule.params.hours} hours after the visit. Escalated to a manager if it is late.`,
    blocking: false,
    dueAt: iso(Date.parse(completedAt) + rule.params.hours * HOUR),
    dedupeKey: `prepare_estimate:${jobId}`,
    sourceEvent: event.eventId,
  });
  await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: created ? "task_opened" : "task_exists", inputs: event.payload, result: { taskId: task.id } });
}

async function onEstimateSent(deps: Deps, event: StoredEvent<"estimate.sent">) {
  const rule = await ruleFor(deps, event.organizationId, estimateDeadlineV1);
  const { jobId } = event.payload;
  const closed = await deps.store.closeTasks(event.organizationId, { jobId, kinds: ["prepare_estimate"] }, "The estimate went out.", deps.now());
  await audit(deps, event, rule, { entityType: "job", entityId: jobId, decision: "estimate_sent", inputs: event.payload, result: { tasksClosed: closed } });
}

async function onEstimateDeclined(deps: Deps, event: StoredEvent<"estimate.declined">) {
  const rule = await ruleFor(deps, event.organizationId, estimateApprovedV1);
  const { jobId } = event.payload;
  const closed = await deps.store.closeTasks(event.organizationId, { jobId, kinds: ["prepare_estimate"] }, "The client declined.", deps.now());
  await audit(deps, event, rule, { entityType: "job_proposal", entityId: event.payload.proposalId, decision: "declined_history_kept", inputs: event.payload, result: { tasksClosed: closed } });
}

/**
 * The spec's worked example. Check the approval is for the proposal that is
 * actually current and the person who should have signed it; then money,
 * then readiness. Replayed, it finds everything it made the first time.
 */
async function onEstimateApproved(deps: Deps, event: StoredEvent<"estimate.approved">) {
  const rule = await ruleFor(deps, event.organizationId, estimateApprovedV1);
  const { jobId, proposalId, customerId } = event.payload;
  const proposal = await deps.facts.proposal(proposalId);

  const problem = !proposal
    ? "The proposal this approval names no longer exists."
    : proposal.jobId !== jobId
      ? "The approval names a different job from the proposal's own."
      : !["accepted", "paid"].includes(proposal.status)
        ? `The proposal reads "${proposal.status}", not accepted.`
        : proposal.latestProposalIdForJob && proposal.latestProposalIdForJob !== proposalId
          ? "A newer proposal was sent after this one; the approval is for an old version."
          : customerId && proposal.customerId && customerId !== proposal.customerId
            ? "The approval came from a different customer than the proposal was sent to."
            : null;

  if (problem) {
    const { task } = await deps.store.ensureTask({
      organizationId: event.organizationId,
      jobId,
      kind: "review_approval",
      title: "Check this approval before anything is booked",
      detail: problem,
      blocking: true,
      dueAt: iso(deps.now().getTime() + 24 * HOUR),
      dedupeKey: `review_approval:${proposalId}`,
      sourceEvent: event.eventId,
    });
    await audit(deps, event, rule, { entityType: "job_proposal", entityId: proposalId, decision: "approval_held", inputs: { ...event.payload, proposal }, result: { problem, taskId: task.id } });
    return;
  }

  await deps.store.closeTasks(event.organizationId, { jobId, kinds: ["prepare_estimate"] }, "Approved.", deps.now());
  await assessScheduling(deps, event, jobId, proposalId);
}

async function onDepositSettled(deps: Deps, event: StoredEvent<"deposit.settled">) {
  const rule = await ruleFor(deps, event.organizationId, estimateApprovedV1);
  const { jobId } = event.payload;
  const waiting = (await deps.store.actionsFor(event.organizationId, { ruleId: rule.ruleId })).filter(
    (a) => a.actionType === "await_deposit" && a.jobId === jobId && a.status !== "done"
  );
  for (const action of waiting) {
    await deps.store.updateAction(action.id, { status: "done", observedStatus: "settled", reason: `Settled by ${event.payload.paymentRef}.` });
  }
  await assessScheduling(deps, event, jobId, event.payload.proposalId ?? waiting[0]?.entityId ?? null);
}

/**
 * Whether sold work can go to scheduling: Readiness = deposit AND every
 * applicable blocking check AND no blocking issue. Hard constraints, never a
 * score. Each one failing becomes its own task with an owner-facing reason;
 * all passing becomes job.ready_for_scheduling and one "book it" task.
 *
 * Settled money only. An authorised card or a sent invoice is not a deposit.
 */
export async function assessScheduling(deps: Deps, cause: StoredEvent, jobId: string, proposalId: string | null) {
  const rule = await ruleFor(deps, cause.organizationId, estimateApprovedV1);
  const controls = await deps.store.controls(cause.organizationId);
  const { facts, issues, overrides } = await deps.facts.schedulingFacts(jobId);

  const depositOwed = facts.depositRequiredCents > 0 && facts.depositReceivedCents < facts.depositRequiredCents;
  if (depositOwed) {
    const anchor = proposalId ?? jobId;
    const { action } = await deps.store.ensureAction({
      organizationId: cause.organizationId,
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      actionType: "await_deposit",
      entityType: proposalId ? "job_proposal" : "job",
      entityId: anchor,
      jobId,
      dedupeKey: `await_deposit:${anchor}`,
      mode: rule.mode,
      dryRun: controls.dryRun,
      // The app already raises the deposit invoice at signing. This waits for
      // it to settle; it never asks for money a second time.
      status: "proposed",
      desiredOutcome: `Deposit of ${facts.depositRequiredCents} cents settles`,
      reason: facts.depositSource,
      payload: { requiredCents: facts.depositRequiredCents, receivedCents: facts.depositReceivedCents },
      dueAt: deps.now().toISOString(),
      deadlineAt: null,
      causedByEvent: cause.eventId,
      correlationId: cause.correlationId,
    });
    if (proposalId) {
      await follow(deps, cause, {
        type: "deposit.requested",
        entityId: proposalId,
        occurredAt: deps.now().toISOString(),
        idempotencyKey: eventKey.depositRequested(proposalId),
        payload: { jobId, proposalId, requiredCents: facts.depositRequiredCents, receivedCents: facts.depositReceivedCents },
      });
    }
    await deps.store.ensureTask({
      organizationId: cause.organizationId,
      jobId,
      kind: "collect_deposit",
      title: "Deposit not settled yet",
      detail: `${facts.depositReceivedCents} of ${facts.depositRequiredCents} cents received. Scheduling waits for it.`,
      blocking: true,
      dueAt: iso(deps.now().getTime() + 72 * HOUR),
      dedupeKey: `collect_deposit:${jobId}`,
      sourceEvent: cause.eventId,
    });
    await audit(deps, cause, rule, { entityType: "job", entityId: jobId, decision: "waiting_for_deposit", inputs: { depositRequiredCents: facts.depositRequiredCents, depositReceivedCents: facts.depositReceivedCents }, result: { actionId: action.id } });
    return { ready: false as const, waitingFor: ["deposit"] };
  }
  await deps.store.closeTasks(cause.organizationId, { jobId, kinds: ["collect_deposit"] }, "Deposit settled.", deps.now());

  const gate = evaluateGate("ready", facts, issues, overrides);
  const outputs = new Set(rule.params.schedulingOutputs);
  const stoppers = gate.stoppers.filter((c) => !outputs.has(c.key));
  const blockingIssues = gate.blockingIssues;

  if (stoppers.length === 0 && blockingIssues.length === 0) {
    const checks = gate.checks.filter((c) => !outputs.has(c.key)).map((c) => ({ key: c.key, state: c.state }));
    await deps.store.closeTasks(cause.organizationId, { jobId, kindPrefix: "readiness:" }, "Check now passes.", deps.now());
    await follow(deps, cause, {
      type: "job.ready_for_scheduling",
      entityId: jobId,
      occurredAt: deps.now().toISOString(),
      idempotencyKey: eventKey.readyForScheduling(jobId),
      payload: { jobId, checks },
    });
    const { task } = await deps.store.ensureTask({
      organizationId: cause.organizationId,
      jobId,
      kind: "schedule_job",
      title: "Ready to schedule: pick the days and the crew",
      detail: "Deposit, materials, equipment and access are all confirmed.",
      blocking: false,
      dueAt: iso(deps.now().getTime() + 48 * HOUR),
      dedupeKey: `schedule_job:${jobId}`,
      sourceEvent: cause.eventId,
    });
    await audit(deps, cause, rule, { entityType: "job", entityId: jobId, decision: "ready_for_scheduling", inputs: { checks }, result: { taskId: task.id } });
    return { ready: true as const, waitingFor: [] };
  }

  for (const check of stoppers) {
    await deps.store.ensureTask(
      {
        organizationId: cause.organizationId,
        jobId,
        kind: `readiness:${check.key}`,
        title: check.label,
        detail: check.reason ?? null,
        blocking: true,
        dueAt: iso(deps.now().getTime() + 48 * HOUR),
        dedupeKey: `readiness:${check.key}:${jobId}`,
        sourceEvent: cause.eventId,
      },
      { reopen: true }
    );
  }
  const failing = new Set(stoppers.map((c) => `readiness:${c.key}`));
  const passing = gate.checks.filter((c) => !c.stopping).map((c) => `readiness:${c.key}`).filter((k) => !failing.has(k));
  if (passing.length > 0) {
    await deps.store.closeTasks(cause.organizationId, { jobId, kinds: passing }, "Check now passes.", deps.now());
  }
  await audit(deps, cause, rule, {
    entityType: "job",
    entityId: jobId,
    decision: "not_ready",
    inputs: { stoppers: stoppers.map((c) => c.key), blockingIssues: blockingIssues.map((i) => i.id) },
    result: {},
  });
  return { ready: false as const, waitingFor: [...stoppers.map((c) => c.key), ...blockingIssues.map(() => "issue")] };
}

// ---------------------------------------------------------------------------
// The follow-ups consumer: proposal_followup_v1
// ---------------------------------------------------------------------------

export async function handleFollowUps(deps: Deps, event: StoredEvent): Promise<void> {
  const rule = await ruleFor(deps, event.organizationId, proposalFollowUpV1);
  if (event.type === "estimate.sent") {
    const e = event as StoredEvent<"estimate.sent">;
    const controls = await deps.store.controls(e.organizationId);
    const plan = followUpPlan(rule.params.days).slice(0, rule.params.maxTouches);
    const sentMs = Date.parse(e.payload.sentAt);
    for (const [step, touch] of plan.entries()) {
      await deps.store.ensureAction({
        organizationId: e.organizationId,
        ruleId: rule.ruleId,
        ruleVersion: rule.version,
        actionType: "proposal_followup",
        entityType: "job_proposal",
        entityId: e.payload.proposalId,
        jobId: e.payload.jobId,
        // The spec's key: the proposal, its version, the step.
        dedupeKey: `proposal_followup:v${rule.version}:${e.payload.proposalId}:${e.payload.sentAt}:${step}`,
        mode: rule.mode,
        dryRun: controls.dryRun,
        status: "scheduled",
        desiredOutcome: "The client answers the proposal",
        reason: null,
        payload: {
          step,
          channel: touch.channel,
          offsetHours: touch.offsetHours,
          sentAt: e.payload.sentAt,
          customerId: e.payload.customerId,
          // The key the existing sequence logs this same touch under, so the
          // shadow can say whether the live sequence did what it would have.
          existingKey: dedupeKeyFor("proposal_follow_up", e.payload.proposalId, touch.offsetHours, touch.channel),
        },
        dueAt: iso(sentMs + touch.offsetHours * HOUR),
        deadlineAt: iso(sentMs + (touch.offsetHours + rule.params.lateWindowHours) * HOUR),
        causedByEvent: e.eventId,
        correlationId: e.correlationId,
      });
    }
    await audit(deps, e, rule, { entityType: "job_proposal", entityId: e.payload.proposalId, decision: "followups_scheduled", inputs: { days: rule.params.days }, result: { steps: plan.length } });
    return;
  }
  if (event.type === "estimate.approved" || event.type === "estimate.declined") {
    const proposalId = (event.payload as { proposalId: string }).proposalId;
    const pending = await deps.store.actionsFor(event.organizationId, { entityId: proposalId, ruleId: rule.ruleId, status: ["scheduled"] });
    for (const action of pending) {
      await deps.store.updateAction(action.id, { status: "cancelled", observedStatus: "responded", reason: `Client ${event.type === "estimate.approved" ? "accepted" : "declined"}.` });
    }
    await audit(deps, event, rule, { entityType: "job_proposal", entityId: proposalId, decision: "followups_stopped", inputs: { by: event.type }, result: { cancelled: pending.length } });
  }
}

/**
 * Due follow-ups, decided. In order: the business paused, the proposal
 * answered or expired, a reply on any channel, a newer version, consent, too
 * late, the ceiling on touches. What survives is proposed, never sent: the
 * existing sequence sends until this rule is moved out of shadow.
 */
export async function runDueFollowUps(deps: Deps, limit = 100): Promise<{ proposed: number; skipped: number; failed: number }> {
  const now = deps.now();
  const due = await deps.store.dueActions(proposalFollowUpV1.ruleId, now, limit);
  const counts = { proposed: 0, skipped: 0, failed: 0 };
  for (const action of due) {
    try {
      const outcome = await decideFollowUp(deps, action, now);
      counts[outcome === "proposed" ? "proposed" : "skipped"] += 1;
    } catch (err) {
      counts.failed += 1;
      const attempts = action.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      await deps.store.updateAction(action.id, {
        attempts,
        lastError: message,
        ...(attempts >= action.maxAttempts
          ? { status: "dead" as const }
          : { dueAt: iso(now.getTime() + 4 ** (attempts - 1) * 60_000) }),
      });
    }
  }
  return counts;
}

async function decideFollowUp(deps: Deps, action: ActionRow, now: Date): Promise<"proposed" | "skipped"> {
  const rule = await ruleFor(deps, action.organizationId, proposalFollowUpV1);
  const controls: Controls = await deps.store.controls(action.organizationId);
  if (controls.paused) return "skipped";
  const p = action.payload as { step: number; channel: Channel; sentAt: string; customerId: string | null; existingKey: string };

  const skip = async (reason: string, inputs: Record<string, unknown> = {}) => {
    await deps.store.updateAction(action.id, { status: "skipped", reason });
    await audit(deps, null, rule, { organizationId: action.organizationId, entityType: "job_proposal", entityId: action.entityId, decision: "followup_skipped", inputs: { step: p.step, ...inputs }, result: { reason } });
    return "skipped" as const;
  };

  const proposal = await deps.facts.proposal(action.entityId);
  if (!proposal) return skip("The proposal is gone.");
  if (proposal.latestProposalIdForJob && proposal.latestProposalIdForJob !== proposal.id) return skip("A newer proposal was sent.");
  if (proposal.sentAt && proposal.sentAt !== p.sentAt) return skip("This proposal was re-sent; the new sending has its own follow-ups.");

  const lastContact = p.customerId ? await deps.facts.lastClientContact(p.customerId) : null;
  const stop = followUpStop(
    {
      status: proposal.status,
      sentAt: new Date(p.sentAt),
      expiresAt: proposal.expiresAt ? new Date(proposal.expiresAt) : null,
      lastClientContactAt: lastContact,
    },
    now
  );
  if (stop) {
    if (stop === "replied") await deps.store.updateAction(action.id, { observedStatus: "responded" });
    return skip(stop === "answered" ? "The client answered the proposal." : stop === "expired" ? "The proposal expired." : "The client replied.");
  }
  if (action.deadlineAt && Date.parse(action.deadlineAt) < now.getTime()) return skip("Too late: a follow-up days overdue reads as a mistake.");
  if (p.step >= rule.params.maxTouches) return skip("The most touches this business allows have gone.");

  const contact = p.customerId ? await deps.facts.contact(p.customerId) : null;
  if (!contact) return skip("No customer on file to write to.");
  const ready = deps.facts.providerReady();
  const verdict = consentVerdict({
    basis: "service",
    channel: p.channel,
    state: p.channel === "sms" ? contact.smsConsent : contact.emailConsent,
    doNotContact: contact.doNotContact,
    providerReady: p.channel === "sms" ? ready.sms : ready.email,
    address: p.channel === "sms" ? contact.phone : contact.email,
  });
  if (!verdict.send) return skip(verdict.detail, { consent: verdict.reason });

  const existing = await deps.facts.existingSend(action.organizationId, p.existingKey);
  // Dry run: on paper only. Live and needing approval: waits for a person.
  // Live and allowed: still only proposed, because the existing sequence does
  // the sending until this rule is moved out of shadow.
  const status = !action.dryRun && action.mode === "approval_required" ? "awaiting_approval" : "proposed";
  await deps.store.updateAction(action.id, {
    status,
    reason: action.dryRun ? "Dry run: would send this touch." : "Proposed; the existing sequence still does the sending.",
    payload: { ...action.payload, existingSequence: existing ?? "not_logged" },
  });
  await audit(deps, null, rule, {
    organizationId: action.organizationId,
    entityType: "job_proposal",
    entityId: action.entityId,
    decision: "followup_proposed",
    inputs: { step: p.step, channel: p.channel },
    result: { status, existingSequence: existing ?? "not_logged" },
  });
  return "proposed";
}

/** Estimates not out by their deadline go to a manager, once. */
export async function escalateLateEstimates(deps: Deps, limit = 100): Promise<number> {
  const now = deps.now();
  const late = await deps.store.openTasks({ kind: "prepare_estimate", dueBefore: now, unescalated: true, limit });
  for (const task of late) {
    await deps.store.escalateTask(task.id, now);
    await audit(deps, null, estimateDeadlineV1, {
      organizationId: task.organizationId,
      entityType: "job",
      entityId: task.jobId ?? task.id,
      decision: "estimate_late_escalated",
      inputs: { dueAt: task.dueAt },
      result: { taskId: task.id },
    });
  }
  return late.length;
}

/**
 * Readiness again for jobs still held by a check. A confirmation made on the
 * Plan tab is not an event yet, so this is the reconciliation that notices.
 */
export async function recheckHeldJobs(deps: Deps, limit = 50): Promise<number> {
  const held = await deps.store.openTasks({ kindPrefix: "readiness:", limit: limit * 4 });
  const jobs = new Map<string, { organizationId: string; sourceEvent: string | null }>();
  for (const t of held) if (t.jobId && !jobs.has(t.jobId)) jobs.set(t.jobId, { organizationId: t.organizationId, sourceEvent: t.sourceEvent });
  let n = 0;
  for (const [jobId, { sourceEvent }] of [...jobs].slice(0, limit)) {
    const cause = sourceEvent ? await deps.store.getEvent(sourceEvent) : null;
    if (!cause) continue;
    const proposalId = (cause.payload as { proposalId?: string | null }).proposalId ?? null;
    await assessScheduling(deps, cause, jobId, proposalId);
    n += 1;
  }
  return n;
}
