/**
 * The app's existing actions, reporting what they just did to the backbone.
 *
 * One line at each place a fact becomes true: a booking made, a visit
 * scheduled or written up, a proposal sent or answered, a deposit settled.
 * Each reads the row it is reporting on, so the event says what the database
 * now holds rather than what the caller believed, and each is shadow-safe:
 * it never throws and never slows the action down beyond one read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { eventKey } from "@/lib/os/contracts";
import { backboneEnabled, emitEvent, toCents, toInstant } from "@/lib/os/emit";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

type Db = SupabaseClient;
const admin = () => createAdminClient() as unknown as Db;

async function quietly(what: string, run: () => Promise<unknown>): Promise<void> {
  if (!backboneEnabled()) return;
  try {
    await run();
  } catch (err) {
    log.warn("os.app_event_failed", { what, error: err instanceof Error ? err.message : String(err) });
  }
}

interface JobRow {
  id: string;
  organization_id: string;
  property_id: string | null;
  evaluation_date: string | null;
  assigned_to: string | null;
  property: { customer_id: string | null } | null;
}

async function job(db: Db, jobId: string): Promise<JobRow | null> {
  const { data } = await db
    .from("jobs")
    .select("id, organization_id, property_id, evaluation_date, assigned_to, property:properties(customer_id)")
    .eq("id", jobId)
    .maybeSingle();
  return (data as unknown as JobRow | null) ?? null;
}

/** A booking came in: the lead, and the visit if a time was picked. */
export function recordBooking(jobId: string, channel: string): Promise<void> {
  return quietly("booking", async () => {
    const db = admin();
    const row = await job(db, jobId);
    if (!row) return;
    const now = new Date().toISOString();
    const startsAt = toInstant(row.evaluation_date);
    const customerId = row.property?.customer_id ?? null;
    await emitEvent({
      organizationId: row.organization_id,
      type: "lead.created",
      entityId: jobId,
      occurredAt: now,
      actor: { type: "customer", id: customerId },
      source: channel,
      idempotencyKey: eventKey.leadCreated(jobId),
      payload: { jobId, customerId, propertyId: row.property_id, channel, evaluationAt: startsAt },
    });
    if (startsAt) {
      await emitEvent({
        organizationId: row.organization_id,
        type: "appointment.requested",
        entityId: jobId,
        occurredAt: now,
        actor: { type: "customer", id: customerId },
        source: channel,
        idempotencyKey: eventKey.appointmentRequested(jobId, startsAt),
        payload: { jobId, startsAt, evaluatorId: row.assigned_to },
      });
    }
  });
}

/** The office put the visit on the calendar, or moved it. */
export function recordVisitScheduled(jobId: string, profileId: string | null): Promise<void> {
  return quietly("visit_scheduled", async () => {
    const row = await job(admin(), jobId);
    const startsAt = toInstant(row?.evaluation_date);
    if (!row || !startsAt) return;
    await emitEvent({
      organizationId: row.organization_id,
      type: "appointment.requested",
      entityId: jobId,
      occurredAt: new Date().toISOString(),
      actor: { type: "profile", id: profileId },
      source: "job_page",
      idempotencyKey: eventKey.appointmentRequested(jobId, startsAt),
      payload: { jobId, startsAt, evaluatorId: row.assigned_to },
    });
  });
}

/** The evaluator submitted the visit. */
export function recordVisitCompleted(jobId: string, profileId: string | null): Promise<void> {
  return quietly("visit_completed", async () => {
    const row = await job(admin(), jobId);
    if (!row) return;
    const now = new Date().toISOString();
    await emitEvent({
      organizationId: row.organization_id,
      type: "appointment.completed",
      entityId: jobId,
      occurredAt: now,
      actor: { type: "profile", id: profileId },
      source: "evaluation",
      idempotencyKey: eventKey.appointmentCompleted(jobId),
      payload: { jobId, completedAt: now },
    });
  });
}

interface ProposalRow {
  id: string;
  job_id: string;
  organization_id: string;
  status: string;
  sent_at: string | null;
  total_cost: number | null;
  discount_amount: number | null;
  client_response_note: string | null;
  job: { property: { customer_id: string | null } | null } | null;
}

async function proposalOfJob(db: Db, jobId: string): Promise<ProposalRow | null> {
  const { data } = await db
    .from("job_proposals")
    .select("id, job_id, organization_id, status, sent_at, total_cost, discount_amount, client_response_note, job:jobs(property:properties(customer_id))")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as ProposalRow | null) ?? null;
}

const owed = (p: ProposalRow) => toCents(Math.max(0, (p.total_cost ?? 0) - (p.discount_amount ?? 0)));

/** The proposal reached the client's inbox, or somebody handed them the link. */
export function recordEstimateSent(jobId: string, source: string): Promise<void> {
  return quietly("estimate_sent", async () => {
    const p = await proposalOfJob(admin(), jobId);
    const sentAt = toInstant(p?.sent_at);
    if (!p || !sentAt) return;
    await emitEvent({
      organizationId: p.organization_id,
      type: "estimate.sent",
      entityId: p.id,
      occurredAt: sentAt,
      actor: { type: "system", id: null },
      source,
      idempotencyKey: eventKey.estimateSent(p.id, sentAt),
      payload: { jobId, proposalId: p.id, customerId: p.job?.property?.customer_id ?? null, sentAt, totalCents: owed(p) },
    });
  });
}

/** The client accepted or declined on the proposal page. */
export function recordEstimateResponse(jobId: string, response: "accepted" | "declined"): Promise<void> {
  return quietly("estimate_response", async () => {
    const p = await proposalOfJob(admin(), jobId);
    if (!p || p.status !== response) return;
    const customerId = p.job?.property?.customer_id ?? null;
    const base = {
      organizationId: p.organization_id,
      entityId: p.id,
      occurredAt: new Date().toISOString(),
      actor: { type: "customer" as const, id: customerId },
      source: "proposal_page",
    };
    if (response === "accepted") {
      await emitEvent({
        ...base,
        type: "estimate.approved",
        idempotencyKey: eventKey.estimateApproved(p.id),
        payload: { jobId, proposalId: p.id, customerId, acceptedTotalCents: owed(p) },
      });
    } else {
      await emitEvent({
        ...base,
        type: "estimate.declined",
        idempotencyKey: eventKey.estimateDeclined(p.id),
        payload: { jobId, proposalId: p.id, reason: p.client_response_note },
      });
    }
  });
}

/**
 * Money that has actually settled on a job. Called from the Stripe webhook
 * on a succeeded payment, never on an authorisation or a checkout started.
 */
export function recordPaymentSettled(input: {
  organizationId: string;
  jobId: string;
  proposalId: string | null;
  amountCents: number;
  paymentRef: string;
}): Promise<void> {
  return quietly("payment_settled", async () => {
    if (!(input.amountCents > 0)) return;
    await emitEvent({
      organizationId: input.organizationId,
      type: "deposit.settled",
      entityId: input.jobId,
      occurredAt: new Date().toISOString(),
      actor: { type: "integration", id: "stripe" },
      source: "stripe_webhook",
      idempotencyKey: eventKey.depositSettled(input.paymentRef),
      payload: { jobId: input.jobId, proposalId: input.proposalId, amountCents: input.amountCents, paymentRef: input.paymentRef },
    });
  });
}
