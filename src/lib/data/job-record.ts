import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { getProposalForJob } from "@/lib/data/proposals";
import { listJobMessages } from "@/lib/data/job-messages";
import { listJobPhotos } from "@/lib/data/job-photos";
import { listEvaluationEdits } from "@/lib/data/evaluation-edits";
import { listJobExceptions, listScopeChanges } from "@/lib/data/exceptions";
import { listJobIssues } from "@/lib/data/issues";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { getInvoiceForJob } from "@/lib/data/invoices";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { viewsForJob } from "@/lib/data/proposal-views";
import { attentionForJob } from "@/lib/data/proposal-attention";
import { withoutEmpty, type CanvasMark } from "@/lib/canvas-marks";
import { objectionById } from "@/lib/objections";
import { SCOPE_STATUS_LABEL, KIND_LABEL, type ExceptionKind, type ScopeChangeStatus } from "@/lib/exceptions";
import { TICKET_CAUSE_LABELS } from "@/lib/scheduling";
import { ISSUE_TYPE_LABEL } from "@/lib/issues";
import { displayLabel } from "@/lib/zone-scope";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { formatJobNumber } from "@/lib/job-number";
import { isMissingColumn } from "@/lib/setup-errors";
import {
  buildJobRecord,
  type JobRecord,
  type JobRecordInput,
  type RecordMessage,
  type RecordSiteMap,
  type RecordZone,
} from "@/lib/job-record";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas-dimensions";
import type { WorkZone } from "@/components/canvas/types";
import type { CanvasDesignRow, JobProposal, ProposalZoneSnapshot } from "@/types/domain";

/**
 * Everything about one job, gathered for the record.
 *
 * Fifteen reads, all at once, each on its own. A table that is not there yet
 * costs its section and nothing else: the record is for the day something has
 * already gone wrong, and a page that will not open because one panel's
 * migration has not run is the wrong kind of help on that day.
 *
 * Reads as the signed-in person, so the same row-level rules that decide what
 * they can see on the job page decide what goes on the paper.
 */
export async function getJobRecord(
  jobId: string,
  options: { clientCopy?: boolean } = {}
): Promise<JobRecord | null> {
  const supabase = await createClient();

  const { data: jobRow } = await supabase
    .from("jobs")
    .select(
      "id, job_number, name, status, assigned_to, evaluation_date, evaluation_status, project_start_date, project_end_date, completed_at, completed_by, completion_notes, client_notes, budget_range, cancelled_at, cancellation_reason, declined_at, declined_reason, dispute_opened_at, dispute_kind, dispute_reason, property:properties(address, customer:customers(id, name, phone, email, account_manager_id))"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!jobRow) return null;

  const job = jobRow as unknown as {
    id: string;
    job_number: number | null;
    name: string;
    status: string;
    assigned_to: string | null;
    evaluation_date: string | null;
    evaluation_status: string;
    project_start_date: string | null;
    project_end_date: string | null;
    completed_at: string | null;
    completed_by: string | null;
    completion_notes: string | null;
    client_notes: string | null;
    budget_range: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    declined_at: string | null;
    declined_reason: string | null;
    dispute_opened_at: string | null;
    dispute_kind: string | null;
    dispute_reason: string | null;
    property: {
      address: string;
      customer: { id: string; name: string; phone: string | null; email: string | null; account_manager_id: string | null } | null;
    } | null;
  };

  const customer = job.property?.customer ?? null;
  const managerId = customer?.account_manager_id ?? job.assigned_to ?? null;

  const [
    organization,
    proposal,
    external,
    internal,
    photos,
    evalEdits,
    exceptions,
    changes,
    issues,
    schedule,
    invoice,
    design,
    catalog,
    requested,
    payments,
    views,
    attention,
    people,
  ] = await Promise.all([
    getCurrentOrganization(),
    getProposalForJob(jobId).catch(() => null),
    listJobMessages(jobId, "external").catch(() => []),
    listJobMessages(jobId, "internal").catch(() => []),
    listJobPhotos(jobId).catch(() => []),
    listEvaluationEdits(jobId).catch(() => []),
    listJobExceptions(jobId).catch(() => []),
    listScopeChanges(jobId).catch(() => []),
    listJobIssues(jobId).catch(() => []),
    getJobSchedule(jobId).catch(() => ({ sessions: [], tickets: [], walkthroughs: [] })),
    getInvoiceForJob(jobId).catch(() => null),
    getCanvasDesignForJob(jobId).catch(() => null),
    getCanvasCatalog().catch(() => null),
    safe(supabase.from("job_requested_services").select("service_type_id").eq("job_id", jobId)),
    safe(
      supabase
        .from("payments")
        .select("received_at, amount_cents, surcharge_cents, method, receipt_number, stripe_invoice_id, external_id")
        .eq("job_id", jobId)
        .order("received_at", { ascending: true })
    ),
    viewsForJob(jobId).catch(() => null),
    attentionForJob(jobId).catch(() => null),
    safe(
      supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .in("id", [managerId, job.completed_by].filter((id): id is string => Boolean(id)))
    ),
  ]);

  const [trims, scopeRequests, objections, automated] = await Promise.all([
    proposal ? listTrims(proposal.id) : Promise.resolve([]),
    proposal ? listScopeRequests(proposal.id) : Promise.resolve([]),
    proposal ? listObjections(proposal.id) : Promise.resolve([]),
    customer ? listAutomatedMessages(customer.id, [jobId, proposal?.id ?? null, invoice?.id ?? null]) : Promise.resolve([]),
  ]);

  const nameOf = new Map(
    (people as { id: string; full_name: string | null; email: string | null; phone: string | null }[]).map((p) => [
      p.id,
      { name: p.full_name || p.email || "Somebody", phone: p.phone ?? null },
    ])
  );
  const manager = managerId ? (nameOf.get(managerId) ?? null) : null;

  const serviceName = new Map((catalog?.servicePricing ?? []).map((s) => [s.service_type_id, s.name]));
  const requestedServices = (requested as { service_type_id: string }[]).map(
    (row) => serviceTypeById(row.service_type_id)?.label ?? serviceName.get(row.service_type_id) ?? row.service_type_id
  );

  const messages: RecordMessage[] = [
    ...external.map<RecordMessage>((m) => ({
      at: m.created_at,
      from: m.author_type === "client" ? "client" : "team",
      name: m.author_name,
      channel: m.author_type === "client" ? "Wrote on the proposal page" : "Replied through the app",
      body: m.body,
      reference: m.reference_label ?? null,
      internal: false,
    })),
    ...internal.map<RecordMessage>((m) => ({
      at: m.created_at,
      from: "team",
      name: m.author_name,
      channel: "Team note",
      body: m.body,
      reference: null,
      internal: true,
    })),
    ...automated,
  ];

  const input: JobRecordInput = {
    generatedAt: new Date().toISOString(),
    siteMap: siteMapFor(proposal, design),
    business: {
      name: organization.name,
      phone: organization.business_phone ?? null,
      email: organization.business_email ?? null,
      address: organization.business_address ?? null,
      website: organization.business_website ?? null,
    },
    job: {
      number: formatJobNumber(job.job_number),
      name: job.name,
      status: job.status,
      evaluationDate: job.evaluation_date,
      evaluationStatus: job.evaluation_status,
      projectStart: job.project_start_date?.slice(0, 10) ?? null,
      projectEnd: job.project_end_date?.slice(0, 10) ?? null,
      completedAt: job.completed_at,
      completedByName: job.completed_by ? (nameOf.get(job.completed_by)?.name ?? null) : null,
      completionNotes: job.completion_notes,
      clientNotes: job.client_notes,
      budgetRange: job.budget_range,
      cancelledAt: job.cancelled_at,
      cancellationReason: job.cancellation_reason,
      declinedAt: job.declined_at,
      declinedReason: job.declined_reason,
      disputeOpenedAt: job.dispute_opened_at,
      disputeKind: job.dispute_kind,
      disputeReason: job.dispute_reason,
    },
    customer: {
      name: customer?.name ?? "Client",
      phone: customer?.phone ?? null,
      email: customer?.email ?? null,
    },
    address: job.property?.address ?? "",
    accountManager: manager,
    requestedServices,
    proposal: proposal ? toRecordProposal(proposal, serviceName) : null,
    trims,
    scopeRequests,
    changes: changes.map((c) => ({
      requestedAt: c.requestedAt,
      requestedByName: c.requestedByName,
      requestedNote: c.requestedNote,
      status: c.status,
      statusLabel: SCOPE_STATUS_LABEL[c.status as ScopeChangeStatus] ?? c.status,
      priceCents: c.priceCents,
      terms: c.terms,
      reviewNote: c.reviewNote,
      clientDecision: c.clientDecision,
      clientDecisionAt: c.clientDecisionAt,
      clientDecisionNote: c.clientDecisionNote,
      clientDecisionChannel: c.clientDecisionChannel,
      executableAt: c.executableAt,
    })),
    messages,
    objections,
    evalEdits: evalEdits.map((e) => ({
      at: e.createdAt,
      byName: e.editedByName,
      changes: e.changes,
      requestedVia: e.requestedVia,
      note: e.note,
    })),
    visits: schedule.sessions.map((s) => ({
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      status: s.status,
      purpose: s.purpose,
      pauseReason: s.pause_reason,
    })),
    tickets: schedule.tickets.map((t) => ({
      at: t.created_at,
      title: t.title,
      detail: t.detail,
      cause: t.cause ? (TICKET_CAUSE_LABELS[t.cause] ?? t.cause) : null,
      severity: t.severity,
      status: t.status,
      billable: t.billable,
      resolution: t.resolution,
      resolvedAt: t.resolved_at,
    })),
    walkthroughs: schedule.walkthroughs.map((w) => ({
      requestedAt: w.requested_at,
      requestedNote: w.requested_note,
      status: w.status,
      reviewedAt: w.reviewed_at,
      reviewNotes: w.review_notes,
    })),
    issues: issues.map((i) => ({
      at: i.createdAt,
      type: ISSUE_TYPE_LABEL[i.type] ?? i.type,
      severity: i.severity,
      title: i.title,
      description: i.description,
      status: i.status,
      resolution: i.resolution,
      resolvedAt: i.resolvedAt,
      ownerName: i.ownerName,
    })),
    exceptions: exceptions.map((e) => ({
      at: e.reportedAt,
      kind: KIND_LABEL[e.kind as ExceptionKind] ?? e.kind,
      summary: e.summary,
      detail: e.detail,
      state: e.state,
      resolution: e.resolution,
      resolvedAt: e.resolvedAt,
      reportedByName: e.reportedByName,
    })),
    payments: (
      payments as {
        received_at: string;
        amount_cents: number;
        surcharge_cents: number | null;
        method: string;
        receipt_number: string | null;
        stripe_invoice_id: string | null;
        external_id: string | null;
      }[]
    ).map((p) => ({
      at: p.received_at,
      amountCents: p.amount_cents - (p.surcharge_cents ?? 0),
      method: p.method === "card" ? "card" : p.method === "check" ? "check" : p.method === "cash" ? "cash" : p.method,
      receiptNumber: p.receipt_number,
      reference: p.stripe_invoice_id ?? p.external_id ?? null,
    })),
    invoices: invoice
      ? [
          {
            amountCents: Math.round(Number(invoice.amount) * 100),
            status: invoice.status,
            sentAt: invoice.sent_at,
            paidAt: invoice.paid_at,
          },
        ]
      : [],
    photos: photos.map((p) => ({
      at: p.created_at,
      phase: (p as { phase?: string | null }).phase ?? p.kind,
      zoneName: p.zone_name,
      caption: p.caption,
      url: p.url,
    })),
    marks: design ? withoutEmpty(((design as { marks?: unknown }).marks ?? []) as CanvasMark[]).map((m) => ({
      note: m.note,
      authorName: m.authorName,
      createdAt: m.createdAt,
    })) : [],
    reading:
      views && views.opens > 0
        ? {
            opens: views.opens,
            firstAt: views.firstAt,
            lastAt: views.lastAt,
            totalSeconds: attention?.summary.totalSeconds ?? 0,
            focus: attention && !attention.summary.thin ? (attention.summary.focus?.label ?? null) : null,
          }
        : null,
  };

  return buildJobRecord(input, options);
}

/**
 * The property picture with the areas on it.
 *
 * The proposal's own copy first, because that is the picture the client
 * accepted against. A job with no proposal yet falls back to the working
 * design, which is what the evaluator drew.
 */
function siteMapFor(proposal: JobProposal | null, design: CanvasDesignRow | null): RecordSiteMap | null {
  if (proposal?.site_image_path && proposal.site_image_transform) {
    return {
      imagePath: proposal.site_image_path,
      transform: proposal.site_image_transform,
      zones: ((proposal.scope_snapshot ?? []) as ProposalZoneSnapshot[]).map((zone) => ({
        zoneName: zone.zoneName,
        color: zone.color,
        points: zone.points ?? [],
      })),
    };
  }
  if (design?.image_path) {
    const zones = ((design as { zones?: WorkZone[] }).zones ?? []).filter((zone) => zone.service);
    return {
      imagePath: design.image_path,
      transform: {
        x: design.image_x,
        y: design.image_y,
        scale: design.image_scale,
        rotation: design.image_rotation,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
      },
      zones: zones.map((zone) => ({ zoneName: zone.name, color: zone.color, points: zone.points })),
    };
  }
  return null;
}

function toRecordProposal(proposal: JobProposal, serviceName: Map<string, string>) {
  const zones: RecordZone[] = ((proposal.scope_snapshot ?? []) as ProposalZoneSnapshot[]).map((zone) => ({
    name: zone.zoneName,
    service: displayLabel(zone.serviceLabel, serviceName.get(zone.serviceLabel) ? { name: serviceName.get(zone.serviceLabel)! } : undefined),
    scopeText: zone.scopeText ?? "",
    priceCents: zone.priceCents ?? null,
    performedBy: zone.performedBy ?? "own",
    partnerName: zone.partnerName ?? null,
  }));
  return {
    status: proposal.status,
    totalCost: proposal.total_cost,
    discountAmount: Number(proposal.discount_amount ?? 0),
    discountReason: proposal.discount_reason,
    generatedAt: proposal.generated_at,
    approvedAt: proposal.approved_at,
    respondedAt: proposal.responded_at,
    responseNote: proposal.client_response_note,
    paymentPath: proposal.payment_path,
    clientChosenDay: proposal.client_chosen_day,
    paidAt: proposal.paid_at,
    zones,
    recommendedScope: proposal.recommended_scope,
  };
}

/** What the office trimmed off after the proposal went out. */
async function listTrims(proposalId: string) {
  const supabase = await createClient();
  const read = (columns: string) =>
    supabase.from("proposal_edits").select(columns).eq("proposal_id", proposalId).order("created_at", { ascending: true });
  try {
    let { data, error } = await read(
      "created_at, edited_by_name, removed_zones, removed_lines, previous_total_cents, new_total_cents, note, requested_via"
    );
    if (isMissingColumn(error)) {
      ({ data, error } = await read("created_at, edited_by_name, removed_zones, removed_lines, previous_total_cents, new_total_cents, note"));
    }
    if (error) return [];
    return ((data ?? []) as unknown as {
      created_at: string;
      edited_by_name: string | null;
      removed_zones: { zoneName: string; serviceLabel: string; priceCents: number | null }[] | null;
      removed_lines: { zoneName: string; line: string }[] | null;
      previous_total_cents: number | null;
      new_total_cents: number | null;
      note: string | null;
      requested_via?: string | null;
    }[]).map((row) => ({
      at: row.created_at,
      byName: row.edited_by_name,
      removedZones: row.removed_zones ?? [],
      removedLines: row.removed_lines ?? [],
      previousTotalCents: row.previous_total_cents,
      newTotalCents: row.new_total_cents,
      note: row.note,
      requestedVia: row.requested_via ?? null,
    }));
  } catch {
    return [];
  }
}

/** Areas the client kept or dropped themselves, from the proposal page. */
async function listScopeRequests(proposalId: string) {
  const supabase = await createClient();
  const rows = await safe(
    supabase
      .from("proposal_scope_requests")
      .select("requested_at, kept_zones, dropped_zones, status, previous_total_cents, new_total_cents")
      .eq("proposal_id", proposalId)
      .order("requested_at", { ascending: true })
  );
  return (rows as {
    requested_at: string;
    kept_zones: string[] | null;
    dropped_zones: string[] | null;
    status: string;
    previous_total_cents: number | null;
    new_total_cents: number | null;
  }[]).map((row) => ({
    at: row.requested_at,
    kept: row.kept_zones ?? [],
    dropped: row.dropped_zones ?? [],
    status: row.status,
    previousTotalCents: row.previous_total_cents,
    newTotalCents: row.new_total_cents,
  }));
}

/** The questions they tapped on the proposal, and what we offered back. */
async function listObjections(proposalId: string) {
  const supabase = await createClient();
  const rows = await safe(
    supabase
      .from("proposal_objections")
      .select("objection_id, note, resolution, resolved, raised_at")
      .eq("proposal_id", proposalId)
      .order("raised_at", { ascending: true })
  );
  return (rows as {
    objection_id: string;
    note: string | null;
    resolution: string | null;
    resolved: boolean | null;
    raised_at: string;
  }[]).map((row) => ({
    at: row.raised_at,
    question: objectionById(row.objection_id)?.label ?? row.objection_id.replace(/_/g, " "),
    note: row.note,
    resolution: row.resolution,
    resolved: row.resolved,
  }));
}

/**
 * Texts and emails the app sent them on its own: reminders, receipts, the
 * proposal link. Only the ones that actually went; a skipped reminder is
 * not a communication.
 */
async function listAutomatedMessages(customerId: string, referenceIds: (string | null)[]): Promise<RecordMessage[]> {
  const supabase = await createClient();
  const rows = await safe(
    supabase
      .from("client_message_log")
      .select("channel, kind, reference_id, body, created_at, status")
      .eq("customer_id", customerId)
      .eq("status", "sent")
      .order("created_at", { ascending: true })
      .limit(200)
  );
  const wanted = new Set(referenceIds.filter((id): id is string => Boolean(id)));
  return (rows as { channel: "sms" | "email"; kind: string; reference_id: string | null; body: string | null; created_at: string }[])
    .filter((row) => !row.reference_id || wanted.has(row.reference_id))
    .map((row) => ({
      at: row.created_at,
      from: "system" as const,
      name: "Automatic",
      channel: `${row.channel === "sms" ? "Text" : "Email"} (${row.kind.replace(/_/g, " ")})`,
      body: row.body ?? "",
      reference: null,
      internal: false,
    }));
}

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}
