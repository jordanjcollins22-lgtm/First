/**
 * The backbone's store, held in memory, for tests and for trying a scenario
 * through without a database. It keeps the same promises the tables do:
 * unique keys, one claim per lease, append-only events.
 */

import { ENTITY_OF, SCHEMA_VERSION, type Consumer, type EventInput, type EventType, type StoredEvent } from "@/lib/os/contracts";
import type { AutomationMode } from "@/lib/os/rules";
import {
  CONTROLS_OFF,
  type ActionPatch,
  type ActionRow,
  type ActionStatus,
  type AuditEntry,
  type Controls,
  type Delivery,
  type DeliveryOutcome,
  type NewAction,
  type NewTask,
  type OsStore,
  type TaskRow,
} from "@/lib/os/store";

interface DeliveryRow extends Delivery {
  status: "pending" | "processing" | "done" | "failed" | "dead";
  nextAttemptAt: number;
  lockedUntil: number | null;
  lastError: string | null;
}

export class MemoryStore implements OsStore {
  events: StoredEvent[] = [];
  deliveries: DeliveryRow[] = [];
  actions: ActionRow[] = [];
  tasks: TaskRow[] = [];
  audits: AuditEntry[] = [];
  controlsByOrg = new Map<string, Controls>();
  rules = new Map<string, { mode: AutomationMode; params: unknown }>();
  /** The store's clock; tests move it. */
  now: () => number = () => Date.now();
  private seq = 0;

  private id(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${this.seq.toString(16).padStart(12, "0")}`;
  }

  async controls(organizationId: string): Promise<Controls> {
    return this.controlsByOrg.get(organizationId) ?? CONTROLS_OFF;
  }

  async ruleOverride(organizationId: string, ruleId: string, version: number) {
    return this.rules.get(`${organizationId}:${ruleId}:${version}`) ?? null;
  }

  async recordEvent(input: EventInput, consumers: Consumer[]) {
    const existing = this.events.find((e) => e.organizationId === input.organizationId && e.idempotencyKey === input.idempotencyKey);
    if (existing) return { eventId: existing.eventId, inserted: false };
    const eventId = this.id();
    this.events.push({
      ...input,
      eventId,
      entityType: ENTITY_OF[input.type],
      recordedAt: new Date(this.now()).toISOString(),
      correlationId: input.correlationId ?? eventId,
      causationId: input.causationId ?? null,
      schemaVersion: SCHEMA_VERSION,
    });
    for (const consumer of new Set(consumers)) {
      this.deliveries.push({
        id: this.id(),
        eventId,
        organizationId: input.organizationId,
        consumer,
        attempts: 0,
        maxAttempts: 5,
        status: "pending",
        nextAttemptAt: this.now(),
        lockedUntil: null,
        lastError: null,
      });
    }
    return { eventId, inserted: true };
  }

  async getEvent(eventId: string) {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }

  async latestEvent(organizationId: string, entityId: string, types: EventType[]) {
    const matching = this.events.filter(
      (e) =>
        e.organizationId === organizationId &&
        types.includes(e.type) &&
        (e.entityId === entityId || (e.payload as { jobId?: string }).jobId === entityId)
    );
    matching.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return matching[0] ?? null;
  }

  async claim(consumer: Consumer, limit: number, leaseSeconds: number) {
    const now = this.now();
    const due = this.deliveries
      .filter(
        (d) =>
          d.consumer === consumer &&
          d.nextAttemptAt <= now &&
          (d.status === "pending" || d.status === "failed" || (d.status === "processing" && (d.lockedUntil ?? 0) < now))
      )
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);
    for (const d of due) {
      d.status = "processing";
      d.attempts += 1;
      d.lockedUntil = now + leaseSeconds * 1000;
    }
    return due.map(({ id, eventId, organizationId, consumer: c, attempts, maxAttempts }) => ({ id, eventId, organizationId, consumer: c, attempts, maxAttempts }));
  }

  async finishDelivery(id: string, outcome: DeliveryOutcome) {
    const d = this.deliveries.find((row) => row.id === id);
    if (!d) return;
    d.lockedUntil = null;
    if (outcome.status === "done") d.status = "done";
    else if (outcome.status === "dead") {
      d.status = "dead";
      d.lastError = outcome.error;
    } else if (outcome.status === "failed") {
      d.status = "failed";
      d.lastError = outcome.error;
      d.nextAttemptAt = Date.parse(outcome.nextAttemptAt);
    } else {
      d.status = "pending";
      d.attempts = Math.max(0, d.attempts - 1);
      d.nextAttemptAt = Date.parse(outcome.nextAttemptAt);
    }
  }

  async ensureAction(action: NewAction) {
    const existing = this.actions.find((a) => a.organizationId === action.organizationId && a.dedupeKey === action.dedupeKey);
    if (existing) return { action: existing, created: false };
    const row: ActionRow = {
      ...action,
      id: this.id(),
      attempts: 0,
      maxAttempts: action.maxAttempts ?? 4,
      sendStatus: null,
      observedStatus: null,
      lastError: null,
    };
    this.actions.push(row);
    return { action: row, created: true };
  }

  async updateAction(id: string, patch: ActionPatch) {
    const a = this.actions.find((row) => row.id === id);
    if (a) Object.assign(a, patch);
  }

  async actionsFor(organizationId: string, filter: { entityId?: string; ruleId?: string; status?: ActionStatus[] }) {
    return this.actions.filter(
      (a) =>
        a.organizationId === organizationId &&
        (!filter.entityId || a.entityId === filter.entityId) &&
        (!filter.ruleId || a.ruleId === filter.ruleId) &&
        (!filter.status || filter.status.includes(a.status))
    );
  }

  async dueActions(ruleId: string, now: Date, limit: number) {
    return this.actions
      .filter((a) => a.ruleId === ruleId && a.status === "scheduled" && Date.parse(a.dueAt) <= now.getTime())
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(0, limit);
  }

  async ensureTask(task: NewTask, opts?: { reopen?: boolean }) {
    const existing = this.tasks.find((t) => t.organizationId === task.organizationId && t.dedupeKey === task.dedupeKey);
    if (existing) {
      if (existing.state !== "open" && opts?.reopen) {
        Object.assign(existing, { state: "open", resolution: null, title: task.title, detail: task.detail, dueAt: task.dueAt });
        return { task: existing, created: true };
      }
      return { task: existing, created: false };
    }
    const row: TaskRow = { ...task, id: this.id(), state: "open", escalatedAt: null, resolution: null };
    this.tasks.push(row);
    return { task: row, created: true };
  }

  async closeTasks(
    organizationId: string,
    filter: { jobId: string; kinds?: string[]; kindPrefix?: string; dedupeKeys?: string[] },
    resolution: string
  ) {
    let n = 0;
    for (const t of this.tasks) {
      if (t.organizationId !== organizationId || t.jobId !== filter.jobId || t.state !== "open") continue;
      if (filter.kinds && !filter.kinds.includes(t.kind)) continue;
      if (filter.kindPrefix && !t.kind.startsWith(filter.kindPrefix)) continue;
      if (filter.dedupeKeys && !filter.dedupeKeys.includes(t.dedupeKey)) continue;
      t.state = "done";
      t.resolution = resolution;
      n += 1;
    }
    return n;
  }

  async openTasks(filter: { organizationId?: string; kind?: string; kindPrefix?: string; dueBefore?: Date; unescalated?: boolean; limit: number }) {
    return this.tasks
      .filter(
        (t) =>
          t.state === "open" &&
          (!filter.organizationId || t.organizationId === filter.organizationId) &&
          (!filter.kind || t.kind === filter.kind) &&
          (!filter.kindPrefix || t.kind.startsWith(filter.kindPrefix)) &&
          (!filter.dueBefore || (t.dueAt != null && Date.parse(t.dueAt) < filter.dueBefore.getTime())) &&
          (!filter.unescalated || t.escalatedAt == null)
      )
      .slice(0, filter.limit);
  }

  async escalateTask(id: string, now: Date) {
    const t = this.tasks.find((row) => row.id === id);
    if (t) t.escalatedAt = now.toISOString();
  }

  async audit(entry: AuditEntry) {
    this.audits.push(entry);
  }
}
