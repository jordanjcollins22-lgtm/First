/**
 * The backbone's store and facts, read from and written to the database with
 * the service key. Server only: the cron route and the emit helper use it.
 *
 * Every repeatable write is an insert that tolerates its own unique key, then
 * a read of whatever holds that key, so two runs racing each other end with
 * one row and both see it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
  type OsFacts,
  type OsStore,
  type ProposalFacts,
  type TaskRow,
} from "@/lib/os/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobFacts } from "@/lib/data/issues";
import { contactsFor } from "@/lib/data/client-messaging";
import { lastClientContact } from "@/lib/data/client-automations";
import { isResendConfigured, isSmsConfigured } from "@/lib/env";
import type { BlockingStage, Issue, IssueSeverity } from "@/lib/issues";
import type { GateOverride } from "@/lib/readiness";

type Row = Record<string, unknown>;

const UNIQUE_VIOLATION = "23505";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

function toEvent(row: Row): StoredEvent {
  return {
    eventId: row.event_id as string,
    organizationId: row.organization_id as string,
    type: row.event_type as EventType,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    occurredAt: row.occurred_at as string,
    recordedAt: row.recorded_at as string,
    actor: { type: row.actor_type as StoredEvent["actor"]["type"], id: (row.actor_id as string | null) ?? null },
    source: row.source as string,
    correlationId: row.correlation_id as string,
    causationId: (row.causation_id as string | null) ?? null,
    schemaVersion: row.schema_version as number,
    idempotencyKey: row.idempotency_key as string,
    payload: row.payload as StoredEvent["payload"],
  };
}

function toAction(row: Row): ActionRow {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    ruleId: row.rule_id as string,
    ruleVersion: row.rule_version as number,
    actionType: row.action_type as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    jobId: (row.job_id as string | null) ?? null,
    dedupeKey: row.dedupe_key as string,
    mode: row.mode as AutomationMode,
    dryRun: Boolean(row.dry_run),
    status: row.status as ActionStatus,
    sendStatus: (row.send_status as ActionRow["sendStatus"]) ?? null,
    observedStatus: (row.observed_status as ActionRow["observedStatus"]) ?? null,
    desiredOutcome: row.desired_outcome as string,
    reason: (row.reason as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    dueAt: row.due_at as string,
    deadlineAt: (row.deadline_at as string | null) ?? null,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    lastError: (row.last_error as string | null) ?? null,
    causedByEvent: (row.caused_by_event as string | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
  };
}

function toTask(row: Row): TaskRow {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    jobId: (row.job_id as string | null) ?? null,
    kind: row.kind as string,
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    blocking: Boolean(row.blocking),
    state: row.state as TaskRow["state"],
    dueAt: (row.due_at as string | null) ?? null,
    escalatedAt: (row.escalated_at as string | null) ?? null,
    dedupeKey: row.dedupe_key as string,
    sourceEvent: (row.source_event as string | null) ?? null,
    resolution: (row.resolution as string | null) ?? null,
  };
}

export class SupabaseStore implements OsStore {
  constructor(private readonly db: SupabaseClient = createAdminClient() as unknown as SupabaseClient) {}

  async controls(organizationId: string): Promise<Controls> {
    const { data, error } = await this.db
      .from("automation_controls")
      .select("events_enabled, dry_run, paused")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) fail("read automation_controls", error);
    if (!data) return CONTROLS_OFF;
    return { eventsEnabled: Boolean(data.events_enabled), dryRun: data.dry_run !== false, paused: Boolean(data.paused) };
  }

  async ruleOverride(organizationId: string, ruleId: string, version: number) {
    const { data, error } = await this.db
      .from("automation_rules")
      .select("mode, params")
      .eq("organization_id", organizationId)
      .eq("rule_id", ruleId)
      .eq("version", version)
      .maybeSingle();
    if (error) fail("read automation_rules", error);
    return data ? { mode: data.mode as AutomationMode, params: data.params } : null;
  }

  async recordEvent(input: EventInput, consumers: Consumer[]) {
    const { data, error } = await this.db.rpc("record_domain_event", {
      p_organization_id: input.organizationId,
      p_event_type: input.type,
      p_entity_type: ENTITY_OF[input.type],
      p_entity_id: input.entityId,
      p_occurred_at: input.occurredAt,
      p_actor_type: input.actor.type,
      p_actor_id: input.actor.id,
      p_source: input.source,
      p_correlation_id: input.correlationId ?? null,
      p_causation_id: input.causationId ?? null,
      p_schema_version: SCHEMA_VERSION,
      p_idempotency_key: input.idempotencyKey,
      p_payload: input.payload,
      p_consumers: consumers,
    });
    if (error) fail("record_domain_event", error);
    const row = (Array.isArray(data) ? data[0] : data) as { event_id: string; inserted: boolean };
    return { eventId: row.event_id, inserted: Boolean(row.inserted) };
  }

  async getEvent(eventId: string) {
    const { data, error } = await this.db.from("domain_events").select("*").eq("event_id", eventId).maybeSingle();
    if (error) fail("read domain_events", error);
    return data ? toEvent(data) : null;
  }

  async latestEvent(organizationId: string, entityId: string, types: EventType[]) {
    const { data, error } = await this.db
      .from("domain_events")
      .select("*")
      .eq("organization_id", organizationId)
      .in("event_type", types)
      .or(`entity_id.eq.${entityId},payload->>jobId.eq.${entityId}`)
      .order("occurred_at", { ascending: false })
      .limit(1);
    if (error) fail("read domain_events", error);
    return data && data.length > 0 ? toEvent(data[0]) : null;
  }

  async claim(consumer: Consumer, limit: number, leaseSeconds: number): Promise<Delivery[]> {
    const { data, error } = await this.db.rpc("claim_outbox_batch", { p_consumer: consumer, p_limit: limit, p_lease_seconds: leaseSeconds });
    if (error) fail("claim_outbox_batch", error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      eventId: row.event_id as string,
      organizationId: row.organization_id as string,
      consumer: row.consumer as Consumer,
      attempts: row.attempts as number,
      maxAttempts: row.max_attempts as number,
    }));
  }

  async finishDelivery(id: string, outcome: DeliveryOutcome) {
    const now = new Date().toISOString();
    let patch: Row;
    if (outcome.status === "done") patch = { status: "done", processed_at: now, locked_until: null, last_error: null };
    else if (outcome.status === "dead") patch = { status: "dead", locked_until: null, last_error: outcome.error };
    else if (outcome.status === "failed") patch = { status: "failed", locked_until: null, last_error: outcome.error, next_attempt_at: outcome.nextAttemptAt };
    else {
      // Paused: hand it back without spending the attempt the claim took.
      const { data } = await this.db.from("outbox_messages").select("attempts").eq("id", id).maybeSingle();
      patch = { status: "pending", locked_until: null, next_attempt_at: outcome.nextAttemptAt, attempts: Math.max(0, Number(data?.attempts ?? 1) - 1) };
    }
    const { error } = await this.db.from("outbox_messages").update(patch).eq("id", id);
    if (error) fail("update outbox_messages", error);
  }

  async ensureAction(action: NewAction) {
    const { data, error } = await this.db
      .from("automation_actions")
      .insert({
        organization_id: action.organizationId,
        rule_id: action.ruleId,
        rule_version: action.ruleVersion,
        action_type: action.actionType,
        entity_type: action.entityType,
        entity_id: action.entityId,
        job_id: action.jobId,
        dedupe_key: action.dedupeKey,
        mode: action.mode,
        dry_run: action.dryRun,
        status: action.status,
        desired_outcome: action.desiredOutcome,
        reason: action.reason,
        payload: action.payload,
        due_at: action.dueAt,
        deadline_at: action.deadlineAt,
        max_attempts: action.maxAttempts ?? 4,
        caused_by_event: action.causedByEvent,
        correlation_id: action.correlationId,
      })
      .select("*")
      .maybeSingle();
    if (data) return { action: toAction(data), created: true };
    if (error && error.code !== UNIQUE_VIOLATION) fail("insert automation_actions", error);
    const { data: existing, error: readError } = await this.db
      .from("automation_actions")
      .select("*")
      .eq("organization_id", action.organizationId)
      .eq("dedupe_key", action.dedupeKey)
      .single();
    if (readError) fail("read automation_actions", readError);
    return { action: toAction(existing), created: false };
  }

  async updateAction(id: string, patch: ActionPatch) {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.sendStatus !== undefined) row.send_status = patch.sendStatus;
    if (patch.observedStatus !== undefined) row.observed_status = patch.observedStatus;
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.payload !== undefined) row.payload = patch.payload;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.lastError !== undefined) row.last_error = patch.lastError;
    if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
    const { error } = await this.db.from("automation_actions").update(row).eq("id", id);
    if (error) fail("update automation_actions", error);
  }

  async actionsFor(organizationId: string, filter: { entityId?: string; ruleId?: string; status?: ActionStatus[] }) {
    let q = this.db.from("automation_actions").select("*").eq("organization_id", organizationId);
    if (filter.entityId) q = q.eq("entity_id", filter.entityId);
    if (filter.ruleId) q = q.eq("rule_id", filter.ruleId);
    if (filter.status) q = q.in("status", filter.status);
    const { data, error } = await q.limit(500);
    if (error) fail("read automation_actions", error);
    return ((data ?? []) as Row[]).map(toAction);
  }

  async dueActions(ruleId: string, now: Date, limit: number) {
    const { data, error } = await this.db
      .from("automation_actions")
      .select("*")
      .eq("rule_id", ruleId)
      .eq("status", "scheduled")
      .lte("due_at", now.toISOString())
      .order("due_at")
      .limit(limit);
    if (error) fail("read automation_actions", error);
    return ((data ?? []) as Row[]).map(toAction);
  }

  async ensureTask(task: NewTask, opts?: { reopen?: boolean }) {
    const { data, error } = await this.db
      .from("workflow_tasks")
      .insert({
        organization_id: task.organizationId,
        job_id: task.jobId,
        kind: task.kind,
        title: task.title,
        detail: task.detail,
        blocking: task.blocking,
        due_at: task.dueAt,
        dedupe_key: task.dedupeKey,
        source_event: task.sourceEvent,
      })
      .select("*")
      .maybeSingle();
    if (data) return { task: toTask(data), created: true };
    if (error && error.code !== UNIQUE_VIOLATION) fail("insert workflow_tasks", error);
    const { data: existing, error: readError } = await this.db
      .from("workflow_tasks")
      .select("*")
      .eq("organization_id", task.organizationId)
      .eq("dedupe_key", task.dedupeKey)
      .single();
    if (readError) fail("read workflow_tasks", readError);
    if (existing.state !== "open" && opts?.reopen) {
      const { data: reopened, error: reopenError } = await this.db
        .from("workflow_tasks")
        .update({ state: "open", resolved_at: null, resolved_by: null, resolution: null, title: task.title, detail: task.detail, due_at: task.dueAt })
        .eq("id", existing.id)
        .neq("state", "open")
        .select("*")
        .maybeSingle();
      if (reopenError) fail("reopen workflow_tasks", reopenError);
      if (reopened) return { task: toTask(reopened), created: true };
    }
    return { task: toTask(existing), created: false };
  }

  async closeTasks(
    organizationId: string,
    filter: { jobId: string; kinds?: string[]; kindPrefix?: string; dedupeKeys?: string[] },
    resolution: string,
    now: Date
  ) {
    let q = this.db
      .from("workflow_tasks")
      .update({ state: "done", resolved_at: now.toISOString(), resolution })
      .eq("organization_id", organizationId)
      .eq("job_id", filter.jobId)
      .eq("state", "open");
    if (filter.kinds) q = q.in("kind", filter.kinds);
    if (filter.kindPrefix) q = q.like("kind", `${filter.kindPrefix}%`);
    if (filter.dedupeKeys) q = q.in("dedupe_key", filter.dedupeKeys);
    const { data, error } = await q.select("id");
    if (error) fail("close workflow_tasks", error);
    return (data ?? []).length;
  }

  async openTasks(filter: { organizationId?: string; kind?: string; kindPrefix?: string; dueBefore?: Date; unescalated?: boolean; limit: number }) {
    let q = this.db.from("workflow_tasks").select("*").eq("state", "open");
    if (filter.organizationId) q = q.eq("organization_id", filter.organizationId);
    if (filter.kind) q = q.eq("kind", filter.kind);
    if (filter.kindPrefix) q = q.like("kind", `${filter.kindPrefix}%`);
    if (filter.dueBefore) q = q.lt("due_at", filter.dueBefore.toISOString());
    if (filter.unescalated) q = q.is("escalated_at", null);
    const { data, error } = await q.order("created_at").limit(filter.limit);
    if (error) fail("read workflow_tasks", error);
    return ((data ?? []) as Row[]).map(toTask);
  }

  async escalateTask(id: string, now: Date) {
    const { error } = await this.db.from("workflow_tasks").update({ escalated_at: now.toISOString() }).eq("id", id).is("escalated_at", null);
    if (error) fail("escalate workflow_tasks", error);
  }

  async audit(entry: AuditEntry) {
    const { error } = await this.db.from("automation_audit").insert({
      organization_id: entry.organizationId,
      rule_id: entry.ruleId,
      rule_version: entry.ruleVersion,
      event_id: entry.eventId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      decision: entry.decision,
      inputs: entry.inputs,
      result: entry.result,
    });
    if (error) fail("insert automation_audit", error);
  }
}

export class SupabaseFacts implements OsFacts {
  constructor(private readonly db: SupabaseClient = createAdminClient() as unknown as SupabaseClient) {}

  async proposal(proposalId: string): Promise<ProposalFacts | null> {
    const { data, error } = await this.db
      .from("job_proposals")
      .select("id, job_id, organization_id, status, sent_at, expires_at, job:jobs(property:properties(customer_id))")
      .eq("id", proposalId)
      .maybeSingle();
    if (error) fail("read job_proposals", error);
    if (!data) return null;
    const { data: latest } = await this.db
      .from("job_proposals")
      .select("id")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const job = data.job as unknown as { property: { customer_id: string | null } | null } | null;
    return {
      id: data.id,
      jobId: data.job_id,
      organizationId: data.organization_id,
      status: data.status,
      sentAt: data.sent_at ? new Date(data.sent_at).toISOString() : null,
      expiresAt: data.expires_at ?? null,
      customerId: job?.property?.customer_id ?? null,
      latestProposalIdForJob: latest?.id ?? null,
    };
  }

  async schedulingFacts(jobId: string) {
    const [facts, { data: issueRows, error: issueError }, { data: overrideRows, error: overrideError }] = await Promise.all([
      jobFacts(jobId, this.db as unknown as Parameters<typeof jobFacts>[1]),
      this.db.from("job_issues").select("id, job_id, severity, status, blocking, blocking_stage").eq("job_id", jobId).eq("status", "open"),
      this.db
        .from("job_gate_overrides")
        .select("check_key, reason, overridden_by, overridden_at")
        .eq("job_id", jobId)
        .eq("gate", "ready")
        .is("withdrawn_at", null),
    ]);
    if (issueError) fail("read job_issues", issueError);
    if (overrideError) fail("read job_gate_overrides", overrideError);
    const issues = ((issueRows ?? []) as Row[]).map(
      (row) =>
        ({
          id: row.id as string,
          jobId: row.job_id as string,
          severity: row.severity as IssueSeverity,
          status: row.status as Issue["status"],
          blocking: Boolean(row.blocking),
          blockingStage: (row.blocking_stage as BlockingStage | null) ?? null,
        }) as Issue
    );
    const overrides: GateOverride[] = ((overrideRows ?? []) as Row[]).map((row) => ({
      checkKey: row.check_key as string,
      reason: row.reason as string,
      byId: (row.overridden_by as string | null) ?? null,
      byName: null,
      at: row.overridden_at as string,
    }));
    return { facts, issues, overrides };
  }

  async lastClientContact(customerId: string) {
    return (await lastClientContact(this.db, [customerId])).get(customerId) ?? null;
  }

  async contact(customerId: string) {
    const c = (await contactsFor([customerId])).get(customerId);
    if (!c) return null;
    return { doNotContact: c.doNotContact, smsConsent: c.smsConsent, emailConsent: c.emailConsent, phone: c.phone, email: c.email };
  }

  providerReady() {
    return { sms: isSmsConfigured, email: isResendConfigured };
  }

  async existingSend(organizationId: string, dedupeKey: string) {
    const { data, error } = await this.db
      .from("client_message_log")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (error) fail("read client_message_log", error);
    return (data?.status as "sent" | "skipped" | "failed" | undefined) ?? null;
  }
}
