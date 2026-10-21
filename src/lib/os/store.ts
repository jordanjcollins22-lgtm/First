/**
 * What the backbone reads and writes, as an interface.
 *
 * The handlers only ever talk to this, so they run the same against the
 * database (supabase-store.ts) and against memory in tests (memory-store.ts).
 * Every write that could be repeated -- an event, an action, a task -- is
 * keyed, and repeating it returns what is already there.
 */

import type { Consumer, EventInput, EventType, StoredEvent } from "@/lib/os/contracts";
import type { AutomationMode } from "@/lib/os/rules";
import type { Issue } from "@/lib/issues";
import type { GateOverride, JobFacts } from "@/lib/readiness";
import type { ConsentState } from "@/lib/client-consent";

/** The owner's switch. No row means everything off. */
export interface Controls {
  eventsEnabled: boolean;
  dryRun: boolean;
  paused: boolean;
}

export const CONTROLS_OFF: Controls = { eventsEnabled: false, dryRun: true, paused: false };

export interface Delivery {
  id: string;
  eventId: string;
  organizationId: string;
  consumer: Consumer;
  attempts: number;
  maxAttempts: number;
}

export type DeliveryOutcome =
  | { status: "done" }
  | { status: "failed"; error: string; nextAttemptAt: string }
  | { status: "dead"; error: string }
  /** Handed back without counting the attempt: the business is paused. */
  | { status: "deferred"; nextAttemptAt: string };

export type ActionStatus =
  | "scheduled"
  | "proposed"
  | "awaiting_approval"
  | "queued"
  | "sent"
  | "skipped"
  | "failed"
  | "dead"
  | "cancelled"
  | "done";

export interface ActionRow {
  id: string;
  organizationId: string;
  ruleId: string;
  ruleVersion: number;
  actionType: string;
  entityType: string;
  entityId: string;
  jobId: string | null;
  dedupeKey: string;
  mode: AutomationMode;
  dryRun: boolean;
  status: ActionStatus;
  sendStatus: "accepted" | "delivered" | "undelivered" | "unknown" | null;
  observedStatus: "responded" | "no_response" | "confirmed" | "settled" | null;
  desiredOutcome: string;
  reason: string | null;
  payload: Record<string, unknown>;
  dueAt: string;
  deadlineAt: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  causedByEvent: string | null;
  correlationId: string | null;
}

export type NewAction = Omit<ActionRow, "id" | "attempts" | "sendStatus" | "observedStatus" | "lastError" | "maxAttempts"> & {
  maxAttempts?: number;
};

export type ActionPatch = Partial<Pick<ActionRow, "status" | "sendStatus" | "observedStatus" | "reason" | "payload" | "attempts" | "lastError" | "dueAt">>;

export interface TaskRow {
  id: string;
  organizationId: string;
  jobId: string | null;
  kind: string;
  title: string;
  detail: string | null;
  blocking: boolean;
  state: "open" | "done" | "cancelled";
  dueAt: string | null;
  escalatedAt: string | null;
  dedupeKey: string;
  sourceEvent: string | null;
  resolution: string | null;
}

export type NewTask = Pick<TaskRow, "organizationId" | "jobId" | "kind" | "title" | "detail" | "blocking" | "dueAt" | "dedupeKey" | "sourceEvent">;

export interface AuditEntry {
  organizationId: string;
  ruleId: string;
  ruleVersion: number;
  eventId: string | null;
  entityType: string;
  entityId: string;
  decision: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface OsStore {
  controls(organizationId: string): Promise<Controls>;
  ruleOverride(organizationId: string, ruleId: string, version: number): Promise<{ mode: AutomationMode; params: unknown } | null>;

  recordEvent(input: EventInput, consumers: Consumer[]): Promise<{ eventId: string; inserted: boolean }>;
  getEvent(eventId: string): Promise<StoredEvent | null>;
  /** The latest event of these types about this entity, by when it happened. */
  latestEvent(organizationId: string, entityId: string, types: EventType[]): Promise<StoredEvent | null>;

  claim(consumer: Consumer, limit: number, leaseSeconds: number): Promise<Delivery[]>;
  finishDelivery(id: string, outcome: DeliveryOutcome): Promise<void>;

  /** Insert by dedupe key, or return the one already there. */
  ensureAction(action: NewAction): Promise<{ action: ActionRow; created: boolean }>;
  updateAction(id: string, patch: ActionPatch): Promise<void>;
  actionsFor(organizationId: string, filter: { entityId?: string; ruleId?: string; status?: ActionStatus[] }): Promise<ActionRow[]>;
  dueActions(ruleId: string, now: Date, limit: number): Promise<ActionRow[]>;

  /**
   * Insert by dedupe key, or return the one already there. A closed task is
   * reopened only when asked: a replayed event must never undo a person
   * closing it, but a readiness check that fails again should.
   */
  ensureTask(task: NewTask, opts?: { reopen?: boolean }): Promise<{ task: TaskRow; created: boolean }>;
  closeTasks(
    organizationId: string,
    filter: { jobId: string; kinds?: string[]; kindPrefix?: string; dedupeKeys?: string[] },
    resolution: string,
    now: Date
  ): Promise<number>;
  openTasks(filter: { organizationId?: string; kind?: string; kindPrefix?: string; dueBefore?: Date; unescalated?: boolean; limit: number }): Promise<TaskRow[]>;
  escalateTask(id: string, now: Date): Promise<void>;

  audit(entry: AuditEntry): Promise<void>;
}

/** What the handlers need to know about the business's own records. */
export interface ProposalFacts {
  id: string;
  jobId: string;
  organizationId: string;
  status: string;
  sentAt: string | null;
  expiresAt: string | null;
  customerId: string | null;
  /** The newest proposal on the job. A different id means this one was superseded. */
  latestProposalIdForJob: string | null;
}

export interface ContactFacts {
  doNotContact: boolean;
  smsConsent: ConsentState;
  emailConsent: ConsentState;
  phone: string | null;
  email: string | null;
}

export interface OsFacts {
  proposal(proposalId: string): Promise<ProposalFacts | null>;
  schedulingFacts(jobId: string): Promise<{ facts: JobFacts; issues: Issue[]; overrides: GateOverride[] }>;
  lastClientContact(customerId: string): Promise<Date | null>;
  contact(customerId: string): Promise<ContactFacts | null>;
  providerReady(): { sms: boolean; email: boolean };
  /** What the existing message log says about a send, if anything. */
  existingSend(organizationId: string, dedupeKey: string): Promise<"sent" | "skipped" | "failed" | null>;
}
