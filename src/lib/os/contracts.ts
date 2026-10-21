/**
 * The facts the event backbone records, and the shape every one of them has.
 *
 * A command asks for something; an event says it happened. Only the second
 * kind lives here. "We asked Stripe for a deposit" is not deposit.settled,
 * and "we asked Twilio to send a text" is not the client having read it, so
 * those are actions (actions.ts) with their own observed outcome, never
 * events.
 *
 * Pure: no database, so the rules can be tested and the same validation runs
 * wherever an event is made.
 */

export const EVENT_TYPES = [
  "lead.created",
  "appointment.requested",
  "appointment.confirmed",
  "appointment.completed",
  "estimate.sent",
  "estimate.approved",
  "estimate.declined",
  "deposit.requested",
  "deposit.settled",
  "job.ready_for_scheduling",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type ActorType = "customer" | "profile" | "system" | "integration";

/** What each event says, beyond who and when. Money is integer cents. */
export interface EventPayloads {
  "lead.created": { jobId: string; customerId: string | null; propertyId: string | null; channel: string; evaluationAt: string | null };
  "appointment.requested": { jobId: string; startsAt: string; evaluatorId: string | null };
  "appointment.confirmed": { jobId: string; startsAt: string; confirmedBy: string | null };
  "appointment.completed": { jobId: string; completedAt: string };
  "estimate.sent": { jobId: string; proposalId: string; customerId: string | null; sentAt: string; totalCents: number };
  "estimate.approved": { jobId: string; proposalId: string; customerId: string | null; acceptedTotalCents: number };
  "estimate.declined": { jobId: string; proposalId: string; reason: string | null };
  "deposit.requested": { jobId: string; proposalId: string; requiredCents: number; receivedCents: number };
  "deposit.settled": { jobId: string; proposalId: string | null; amountCents: number; paymentRef: string };
  "job.ready_for_scheduling": { jobId: string; checks: { key: string; state: string }[] };
}

/** Which kind of record each event is about. */
export const ENTITY_OF: Record<EventType, "job" | "job_proposal"> = {
  "lead.created": "job",
  "appointment.requested": "job",
  "appointment.confirmed": "job",
  "appointment.completed": "job",
  "estimate.sent": "job_proposal",
  "estimate.approved": "job_proposal",
  "estimate.declined": "job_proposal",
  "deposit.requested": "job_proposal",
  "deposit.settled": "job",
  "job.ready_for_scheduling": "job",
};

/** Who has to hear about each event. One outbox row per consumer. */
export type Consumer = "workflow" | "followups";

export const CONSUMERS: Record<EventType, Consumer[]> = {
  "lead.created": ["workflow"],
  "appointment.requested": ["workflow"],
  "appointment.confirmed": ["workflow"],
  "appointment.completed": ["workflow"],
  "estimate.sent": ["workflow", "followups"],
  "estimate.approved": ["workflow", "followups"],
  "estimate.declined": ["workflow", "followups"],
  "deposit.requested": [],
  "deposit.settled": ["workflow"],
  "job.ready_for_scheduling": [],
};

export const SCHEMA_VERSION = 1;

export interface EventInput<T extends EventType = EventType> {
  organizationId: string;
  type: T;
  entityId: string;
  occurredAt: string;
  actor: { type: ActorType; id: string | null };
  source: string;
  idempotencyKey: string;
  payload: EventPayloads[T];
  correlationId?: string | null;
  causationId?: string | null;
}

/** An event as it was stored. */
export interface StoredEvent<T extends EventType = EventType> extends EventInput<T> {
  eventId: string;
  entityType: string;
  recordedAt: string;
  correlationId: string;
  causationId: string | null;
  schemaVersion: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isInstant = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v)) && /T/.test(v);
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isUuidOrNull = (v: unknown) => v === null || isUuid(v);

/** What a payload must hold. Unknown is never filled in with zero. */
const PAYLOAD_RULES: { [T in EventType]: { [K in keyof EventPayloads[T]]: (v: unknown) => boolean } } = {
  "lead.created": {
    jobId: isUuid,
    customerId: isUuidOrNull,
    propertyId: isUuidOrNull,
    channel: (v) => typeof v === "string" && v.length > 0,
    evaluationAt: (v) => v === null || isInstant(v),
  },
  "appointment.requested": { jobId: isUuid, startsAt: isInstant, evaluatorId: isUuidOrNull },
  "appointment.confirmed": { jobId: isUuid, startsAt: isInstant, confirmedBy: (v) => v === null || typeof v === "string" },
  "appointment.completed": { jobId: isUuid, completedAt: isInstant },
  "estimate.sent": { jobId: isUuid, proposalId: isUuid, customerId: isUuidOrNull, sentAt: isInstant, totalCents: isCents },
  "estimate.approved": { jobId: isUuid, proposalId: isUuid, customerId: isUuidOrNull, acceptedTotalCents: isCents },
  "estimate.declined": { jobId: isUuid, proposalId: isUuid, reason: (v) => v === null || typeof v === "string" },
  "deposit.requested": { jobId: isUuid, proposalId: isUuid, requiredCents: isCents, receivedCents: isCents },
  "deposit.settled": {
    jobId: isUuid,
    proposalId: isUuidOrNull,
    amountCents: (v) => isCents(v) && (v as number) > 0,
    paymentRef: (v) => typeof v === "string" && v.length > 0,
  },
  "job.ready_for_scheduling": { jobId: isUuid, checks: Array.isArray },
};

export type Validation = { ok: true } | { ok: false; problems: string[] };

/** Everything wrong with an event, or ok. Checked before anything is written. */
export function validateEvent(input: EventInput): Validation {
  const problems: string[] = [];
  if (!(EVENT_TYPES as readonly string[]).includes(input.type)) problems.push(`unknown event type ${String(input.type)}`);
  if (!isUuid(input.organizationId)) problems.push("organizationId is not a uuid");
  if (!isUuid(input.entityId)) problems.push("entityId is not a uuid");
  if (!isInstant(input.occurredAt)) problems.push("occurredAt is not an ISO instant");
  if (!input.source?.trim()) problems.push("source is empty");
  if (!input.idempotencyKey?.trim()) problems.push("idempotencyKey is empty");
  if (!["customer", "profile", "system", "integration"].includes(input.actor?.type)) problems.push("actor.type is not known");
  if (input.correlationId != null && !isUuid(input.correlationId)) problems.push("correlationId is not a uuid");
  if (input.causationId != null && !isUuid(input.causationId)) problems.push("causationId is not a uuid");

  const rules = PAYLOAD_RULES[input.type as EventType] as Record<string, (v: unknown) => boolean> | undefined;
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  if (rules) {
    for (const [key, ok] of Object.entries(rules)) {
      if (!(key in payload)) problems.push(`payload.${key} is missing`);
      else if (!ok(payload[key])) problems.push(`payload.${key} is not valid`);
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * The idempotency key for each event: what makes two reports the same fact.
 *
 * A key names the fact, not the report of it. Two webhooks for one payment
 * are one settlement; one proposal accepted twice (a double tap) is one
 * acceptance. A proposal re-sent is a new fact, so sending carries its time.
 */
export const eventKey = {
  leadCreated: (jobId: string) => `lead.created:${jobId}`,
  appointmentRequested: (jobId: string, startsAt: string) => `appointment.requested:${jobId}:${startsAt}`,
  appointmentConfirmed: (jobId: string, startsAt: string) => `appointment.confirmed:${jobId}:${startsAt}`,
  appointmentCompleted: (jobId: string) => `appointment.completed:${jobId}`,
  estimateSent: (proposalId: string, sentAt: string) => `estimate.sent:${proposalId}:${sentAt}`,
  estimateApproved: (proposalId: string) => `estimate.approved:${proposalId}`,
  estimateDeclined: (proposalId: string) => `estimate.declined:${proposalId}`,
  depositRequested: (proposalId: string) => `deposit.requested:${proposalId}`,
  depositSettled: (paymentRef: string) => `deposit.settled:${paymentRef}`,
  readyForScheduling: (jobId: string) => `job.ready_for_scheduling:${jobId}`,
};
