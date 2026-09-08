import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  summariseProgress,
  type ExceptionKind,
  type ExceptionState,
  type ProgressState,
  type ProgressSummary,
  type ProgressUnit,
  type ScopeChangeStatus,
} from "@/lib/exceptions";

/**
 * Reading the exceptions, the change requests and the progress on a job.
 *
 * Everything here is a read. The writes live in `exception-actions.ts`, where
 * the role checks are, and the split is deliberate: a page that renders a
 * change request should not be able to approve one by accident.
 */

export interface JobException {
  id: string;
  jobId: string;
  kind: ExceptionKind;
  state: ExceptionState;
  summary: string;
  detail: string | null;
  blocksWork: boolean;
  issueId: string | null;
  scopeChangeId: string | null;
  workSessionId: string | null;
  reportedBy: string | null;
  reportedByName: string | null;
  reportedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
}

export interface ScopeChange {
  id: string;
  jobId: string;
  exceptionId: string | null;
  status: ScopeChangeStatus;
  requestedNote: string;
  requestedAt: string;
  requestedByName: string | null;
  proposed: Record<string, unknown>;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  priceCents: number | null;
  pricedAt: string | null;
  terms: string | null;
  clientApprovalRequired: boolean;
  approvalWaivedReason: string | null;
  sentToClientAt: string | null;
  clientDecision: "approved" | "declined" | null;
  clientDecisionAt: string | null;
  clientDecisionNote: string | null;
  clientDecisionChannel: string | null;
  executableAt: string | null;
  supersedesId: string | null;
}

export interface CrewAssignment {
  id: string;
  profileId: string;
  personName: string | null;
  role: "lead" | "technician";
  assignedAt: string;
  assignedByName: string | null;
  unassignedAt: string | null;
  unassignReason: string | null;
  replacedByName: string | null;
}

export interface AuditEvent {
  id: string;
  subjectKind: "exception" | "scope_change" | "progress" | "assignment";
  subjectId: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  actorName: string | null;
  actorRoles: string[];
  note: string | null;
  at: string;
}

/** Everybody's name in one read, so a list of anything is not a list of queries. */
async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", wanted);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name || p.email || "Somebody",
    ])
  );
}

export async function listJobExceptions(jobId: string): Promise<JobException[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_exceptions")
    .select(
      "id, job_id, kind, state, summary, detail, blocks_work, issue_id, scope_change_id, work_session_id, " +
        "reported_by, reported_at, acknowledged_by, acknowledged_at, resolution, resolved_by, resolved_at"
    )
    .eq("job_id", jobId)
    .order("reported_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await nameMap(
    rows.flatMap((r) => [r.reported_by as string | null, r.acknowledged_by as string | null, r.resolved_by as string | null])
  );

  return rows.map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    kind: r.kind as ExceptionKind,
    state: r.state as ExceptionState,
    summary: r.summary as string,
    detail: (r.detail as string | null) ?? null,
    blocksWork: Boolean(r.blocks_work),
    issueId: (r.issue_id as string | null) ?? null,
    scopeChangeId: (r.scope_change_id as string | null) ?? null,
    workSessionId: (r.work_session_id as string | null) ?? null,
    reportedBy: (r.reported_by as string | null) ?? null,
    reportedByName: r.reported_by ? (names.get(r.reported_by as string) ?? null) : null,
    reportedAt: r.reported_at as string,
    acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
    acknowledgedByName: r.acknowledged_by ? (names.get(r.acknowledged_by as string) ?? null) : null,
    resolution: (r.resolution as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolvedByName: r.resolved_by ? (names.get(r.resolved_by as string) ?? null) : null,
  }));
}

export async function listScopeChanges(jobId: string): Promise<ScopeChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_scope_changes")
    .select(
      "id, job_id, exception_id, status, requested_note, requested_at, requested_by, proposed, " +
        "reviewed_at, reviewed_by, review_note, price_cents, priced_at, terms, client_approval_required, " +
        "approval_waived_reason, sent_to_client_at, client_decision, client_decision_at, client_decision_note, " +
        "client_decision_channel, executable_at, supersedes_id"
    )
    .eq("job_id", jobId)
    .order("requested_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await nameMap(rows.flatMap((r) => [r.requested_by as string | null, r.reviewed_by as string | null]));

  return rows.map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    exceptionId: (r.exception_id as string | null) ?? null,
    status: r.status as ScopeChangeStatus,
    requestedNote: r.requested_note as string,
    requestedAt: r.requested_at as string,
    requestedByName: r.requested_by ? (names.get(r.requested_by as string) ?? null) : null,
    proposed: (r.proposed ?? {}) as Record<string, unknown>,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewedByName: r.reviewed_by ? (names.get(r.reviewed_by as string) ?? null) : null,
    reviewNote: (r.review_note as string | null) ?? null,
    priceCents: (r.price_cents as number | null) ?? null,
    pricedAt: (r.priced_at as string | null) ?? null,
    terms: (r.terms as string | null) ?? null,
    clientApprovalRequired: Boolean(r.client_approval_required),
    approvalWaivedReason: (r.approval_waived_reason as string | null) ?? null,
    sentToClientAt: (r.sent_to_client_at as string | null) ?? null,
    clientDecision: (r.client_decision as "approved" | "declined" | null) ?? null,
    clientDecisionAt: (r.client_decision_at as string | null) ?? null,
    clientDecisionNote: (r.client_decision_note as string | null) ?? null,
    clientDecisionChannel: (r.client_decision_channel as string | null) ?? null,
    executableAt: (r.executable_at as string | null) ?? null,
    supersedesId: (r.supersedes_id as string | null) ?? null,
  }));
}

/**
 * What the crew is allowed to do today: the sold scope, plus the changes the
 * client has approved.
 *
 * Nothing subtracts from the sold scope and nothing edits it. A zone the
 * client dropped is a change request with its own record, so the job as sold
 * in March is still readable in December.
 */
export async function executableAdditions(jobId: string): Promise<ScopeChange[]> {
  const all = await listScopeChanges(jobId);
  return all.filter((c) => c.status === "client_approved" && c.executableAt != null);
}

export async function listWorkProgress(jobId: string): Promise<ProgressUnit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_work_progress")
    .select("unit_kind, unit_key, unit_label, state, portion_pct, note")
    .eq("job_id", jobId)
    .order("unit_kind")
    .order("unit_key");
  if (error) throw error;

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    unitKind: r.unit_kind as ProgressUnit["unitKind"],
    unitKey: r.unit_key as string,
    unitLabel: (r.unit_label as string | null) ?? null,
    state: r.state as ProgressState,
    portionPct: (r.portion_pct as number | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));
}

/**
 * The zones the job was sold with, whether or not anybody has recorded
 * progress against them yet.
 *
 * A zone with no progress row is "not started", not missing -- otherwise a
 * crew that recorded three of four zones would look like a crew that finished
 * everything they touched.
 */
export async function jobProgress(jobId: string): Promise<{ units: ProgressUnit[]; summary: ProgressSummary }> {
  const supabase = await createClient();
  const [{ data: design }, recorded] = await Promise.all([
    supabase.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    listWorkProgress(jobId),
  ]);

  const zones = ((design?.zones ?? []) as { id?: string; name?: string }[]).filter((z) => z?.id);
  const byKey = new Map(recorded.map((u) => [`${u.unitKind}:${u.unitKey}`, u]));

  const units: ProgressUnit[] = zones.map((zone) => {
    const existing = byKey.get(`zone:${zone.id}`);
    if (existing) return { ...existing, unitLabel: existing.unitLabel ?? zone.name ?? null };
    return {
      unitKind: "zone",
      unitKey: zone.id as string,
      unitLabel: zone.name ?? null,
      state: "not_started",
      portionPct: null,
      note: null,
    };
  });

  // Anything recorded against a unit the site plan does not hold -- a service
  // or a named task -- is kept rather than dropped.
  for (const unit of recorded) {
    if (unit.unitKind === "zone" && zones.some((z) => z.id === unit.unitKey)) continue;
    units.push(unit);
  }

  return { units, summary: summariseProgress(units) };
}

export async function listCrewAssignments(jobId: string): Promise<CrewAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_crew_assignments")
    .select("id, profile_id, role, assigned_at, assigned_by, unassigned_at, unassign_reason, replaced_by_profile_id")
    .eq("job_id", jobId)
    .order("assigned_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await nameMap(
    rows.flatMap((r) => [
      r.profile_id as string | null,
      r.assigned_by as string | null,
      r.replaced_by_profile_id as string | null,
    ])
  );

  return rows.map((r) => ({
    id: r.id as string,
    profileId: r.profile_id as string,
    personName: names.get(r.profile_id as string) ?? null,
    role: r.role as "lead" | "technician",
    assignedAt: r.assigned_at as string,
    assignedByName: r.assigned_by ? (names.get(r.assigned_by as string) ?? null) : null,
    unassignedAt: (r.unassigned_at as string | null) ?? null,
    unassignReason: (r.unassign_reason as string | null) ?? null,
    replacedByName: r.replaced_by_profile_id ? (names.get(r.replaced_by_profile_id as string) ?? null) : null,
  }));
}

export async function listAuditEvents(jobId: string, limit = 200): Promise<AuditEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_audit_events")
    .select("id, subject_kind, subject_id, action, from_state, to_state, actor, actor_roles, note, at")
    .eq("job_id", jobId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await nameMap(rows.map((r) => r.actor as string | null));

  return rows.map((r) => ({
    id: r.id as string,
    subjectKind: r.subject_kind as AuditEvent["subjectKind"],
    subjectId: r.subject_id as string,
    action: r.action as string,
    fromState: (r.from_state as string | null) ?? null,
    toState: (r.to_state as string | null) ?? null,
    actorName: r.actor ? (names.get(r.actor as string) ?? null) : null,
    actorRoles: (r.actor_roles as string[] | null) ?? [],
    note: (r.note as string | null) ?? null,
    at: r.at as string,
  }));
}

/**
 * What is waiting on somebody, across every job.
 *
 * Read by My Day and the Jobs board. Counted rather than listed, because the
 * question at that level is "which jobs need me", and the detail is a click
 * away on the job itself.
 */
export interface ExceptionLoad {
  open: number;
  blocking: number;
  awaitingReview: number;
  awaitingClient: number;
  /** When the oldest change request went to a client, so silence can be aged. */
  oldestSentToClientAt: string | null;
}

/**
 * What is waiting on somebody, across every job.
 *
 * Read by My Day and the Jobs board. Counted rather than listed, because at
 * that level the question is which jobs need somebody, and the detail is one
 * tap away on the job itself.
 */
export async function jobsWithOpenExceptions(): Promise<Map<string, ExceptionLoad>> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();

  const [counted, sent] = await Promise.all([
    supabase.rpc("jobs_with_open_exceptions", { org }),
    supabase
      .from("job_scope_changes")
      .select("job_id, sent_to_client_at")
      .eq("organization_id", org)
      .eq("status", "sent_to_client")
      .not("sent_to_client_at", "is", null),
  ]);
  if (counted.error) throw counted.error;

  // The oldest per job. A change sent this morning is not a problem; one sent
  // last week and never answered is the thing somebody has to chase.
  const oldest = new Map<string, string>();
  for (const row of (sent.data ?? []) as unknown as { job_id: string; sent_to_client_at: string }[]) {
    const held = oldest.get(row.job_id);
    if (!held || row.sent_to_client_at < held) oldest.set(row.job_id, row.sent_to_client_at);
  }

  return new Map(
    ((counted.data ?? []) as unknown as {
      job_id: string;
      open_exceptions: number;
      blocking_exceptions: number;
      awaiting_review: number;
      awaiting_client: number;
    }[]).map((r) => [
      r.job_id,
      {
        open: r.open_exceptions,
        blocking: r.blocking_exceptions,
        awaitingReview: r.awaiting_review,
        awaitingClient: r.awaiting_client,
        oldestSentToClientAt: oldest.get(r.job_id) ?? null,
      },
    ])
  );
}
