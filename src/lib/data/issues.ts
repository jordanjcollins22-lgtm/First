import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { Issue, IssueSeverity, IssueType, BlockingStage } from "@/lib/issues";
import type { ConfirmationState, GateKey, GateOverride, JobFacts } from "@/lib/readiness";
import { jobRequirements } from "@/lib/data/job-requirements";
import { describeNet, netAppliedToJob, type Adjustment, type Receipt } from "@/lib/payments-net";

interface IssueRow {
  id: string;
  job_id: string;
  customer_id: string | null;
  property_id: string | null;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  due_at: string | null;
  blocking: boolean;
  blocking_stage: string | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

function toIssue(row: IssueRow, names: Map<string, string>): Issue {
  return {
    id: row.id,
    jobId: row.job_id,
    customerId: row.customer_id,
    propertyId: row.property_id,
    type: row.type as IssueType,
    severity: row.severity as IssueSeverity,
    title: row.title,
    description: row.description,
    status: row.status as Issue["status"],
    ownerId: row.owner_id,
    ownerName: row.owner_id ? (names.get(row.owner_id) ?? null) : null,
    createdBy: row.created_by,
    createdByName: row.created_by ? (names.get(row.created_by) ?? null) : null,
    createdAt: row.created_at,
    dueAt: row.due_at,
    blocking: row.blocking,
    blockingStage: (row.blocking_stage as BlockingStage | null) ?? null,
    resolution: row.resolution,
    resolvedBy: row.resolved_by,
    resolvedByName: row.resolved_by ? (names.get(row.resolved_by) ?? null) : null,
    resolvedAt: row.resolved_at,
  };
}

/** Everybody's name in one read, so a list of issues is not a list of queries. */
async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", wanted);
  return new Map(
    (data ?? []).map((row) => [row.id as string, (row.full_name as string) || (row.email as string) || "Someone"])
  );
}

/** Cached per request: the job page reads the same list from three tabs. */
export const listJobIssues = cache(async function listJobIssues(jobId: string): Promise<Issue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_issues")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as IssueRow[];
  const names = await nameMap(rows.flatMap((row) => [row.owner_id, row.created_by, row.resolved_by]));
  return rows.map((row) => toIssue(row, names));
});

/** Every open issue in the business, for the board and My Day. */
export async function listOpenIssues(): Promise<Issue[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("job_issues")
    .select("*")
    .eq("organization_id", org)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as IssueRow[];
  const names = await nameMap(rows.flatMap((row) => [row.owner_id, row.created_by]));
  return rows.map((row) => toIssue(row, names));
}

/** Cached per request: every gate on the job page asks for the same overrides. */
export const listGateOverrides = cache(async function listGateOverrides(jobId: string): Promise<Record<GateKey, GateOverride[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_gate_overrides")
    .select("gate, check_key, reason, overridden_by, overridden_at, withdrawn_at")
    .eq("job_id", jobId)
    .is("withdrawn_at", null);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    gate: string;
    check_key: string;
    reason: string;
    overridden_by: string | null;
    overridden_at: string;
  }[];
  const names = await nameMap(rows.map((row) => row.overridden_by));

  const byGate = {} as Record<GateKey, GateOverride[]>;
  for (const row of rows) {
    const gate = row.gate as GateKey;
    (byGate[gate] ??= []).push({
      checkKey: row.check_key,
      reason: row.reason,
      byId: row.overridden_by,
      byName: row.overridden_by ? (names.get(row.overridden_by) ?? null) : null,
      at: row.overridden_at,
    });
  }
  return byGate;
});

/**
 * The facts a gate is decided from, gathered from what the business already
 * knows.
 *
 * Every one of these comes from an authoritative record -- the services sold,
 * the stock behind them, the payment plan, the payments received, the photos
 * taken -- or from an explicit confirmation somebody made and signed. None of
 * it is inferred from the absence of a complaint. "Nobody has reported a
 * material problem" is not evidence that the mulch is on the truck, and a crew
 * must never be sent out on it.
 *
 * A confirmation somebody made and a problem somebody later reported are both
 * kept. The confirmation is not erased when an issue opens: the issue fails
 * the gate on its own, and the record still shows that the materials were
 * confirmed on Tuesday and that the supplier rang on Wednesday.
 */
/**
 * Cached for the length of one request.
 *
 * Assembling one job's facts is about eighteen round trips, and the job page
 * asks for them from four different tabs -- the overview, the field screen, the
 * issues list and the closeout gate -- because each one needs to evaluate a
 * different gate against the same job. That was seventy-odd round trips to
 * answer one question four times. The facts cannot change while the request is
 * in flight, so they are worked out once.
 */
export const jobFacts = cache(async function jobFacts(jobId: string): Promise<JobFacts> {
  const supabase = await createClient();

  const [{ data: job }, { data: crew }, { data: photos }, { data: design }, { data: walkthrough }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("status, assigned_to, project_start_date, evaluation_date, completed_at")
        .eq("id", jobId)
        .maybeSingle(),
      supabase.from("job_crew").select("profile_id").eq("job_id", jobId),
      supabase.from("job_photos").select("kind, phase").eq("job_id", jobId),
      supabase.from("canvas_designs").select("id, zones").eq("job_id", jobId).maybeSingle(),
      supabase.from("job_walkthroughs").select("status").eq("job_id", jobId).limit(50),
    ]);

  const [
    requirements,
    { data: confirmations },
    { data: plan },
    { data: paid },
    { data: invoice },
    { data: proposal },
    { data: disposition },
  ] =
    await Promise.all([
      jobRequirements(jobId),
      supabase.from("job_confirmations").select("kind, state").eq("job_id", jobId),
      supabase
        .from("payment_plans")
        .select("deposit_cents, total_cents, status")
        .eq("job_id", jobId)
        .maybeSingle(),
      supabase.from("payments").select("id, job_id, amount_cents, received_at").eq("job_id", jobId),
      supabase.from("invoices").select("id, amount, status, paid_at, sent_at").eq("job_id", jobId).maybeSingle(),
      supabase
        .from("job_proposals")
        .select("status, approved_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("job_financial_dispositions")
        .select("state")
        .eq("job_id", jobId)
        .is("cleared_at", null)
        .maybeSingle(),
    ]);

  // Photos are counted by the phase they were taken in, never by kind alone.
  // A photo from the evaluation is not a photo of the ground as the crew
  // found it this morning, and letting the first stand in for the second is
  // how a job starts with no record of what it looked like beforehand.
  const shots = (photos ?? []) as { kind: string | null; phase: string | null }[];
  const inPhase = (phase: string) => shots.filter((row) => row.phase === phase).length;
  const zones = (design?.zones as unknown[] | null) ?? [];
  const status = (job?.status as string) ?? "estimating";

  // A hand confirmation always wins over the derived state, in both
  // directions: somebody who has looked at the shelf knows more than the
  // stock count does, and somebody who marks a job as needing no materials is
  // telling the truth about a job the service list cannot describe.
  const byKind = new Map(
    ((confirmations ?? []) as { kind: string; state: string }[]).map((row) => [row.kind, row.state as ConfirmationState])
  );
  const confirmed = (kind: string, derived: ConfirmationState, source: string) => {
    const hand = byKind.get(kind);
    return hand
      ? ({ state: hand, source: "Confirmed by hand on the Plan tab" } as const)
      : ({ state: derived, source } as const);
  };

  const materials = confirmed("materials", requirements.materials, requirements.materialsSource);
  const equipment = confirmed("equipment", requirements.equipment, requirements.equipmentSource);
  // Access has no record anywhere else to read, so it starts as required and
  // unconfirmed. That is the point: getting onto a property is not something
  // to discover on the morning.
  const access = confirmed(
    "access",
    "required_unconfirmed",
    "Nobody has recorded gate codes, parking or where the truck goes"
  );

  const depositRequiredCents = Number(plan?.deposit_cents ?? 0);

  // Net money, not gross receipts. A refund, a chargeback or a reversal is
  // written beside the receipt rather than on it, and what counts here is the
  // difference -- otherwise a deposit check goes on saying "paid" for a job
  // whose money left three weeks ago.
  const rows = (paid ?? []) as { id: string; job_id: string | null; amount_cents: number | null; received_at: string | null }[];
  const receipts: Receipt[] = rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    amountCents: Number(row.amount_cents ?? 0),
    receivedAt: row.received_at,
  }));
  const { data: adjustmentRows } = await supabase
    .from("payment_adjustments")
    .select("payment_id, kind, amount_cents")
    .in("payment_id", receipts.length > 0 ? receipts.map((r) => r.id) : ["none"]);
  const adjustments: Adjustment[] = ((adjustmentRows ?? []) as { payment_id: string; kind: string; amount_cents: number }[]).map(
    (row) => ({ paymentId: row.payment_id, kind: row.kind as Adjustment["kind"], amountCents: Number(row.amount_cents) })
  );
  const depositReceivedCents = netAppliedToJob(jobId, receipts, adjustments);

  const settled = Boolean(invoice?.paid_at) || invoice?.status === "paid";
  const outstanding = invoice == null ? null : settled ? 0 : Number(invoice.amount ?? 0);

  // The proposal itself is the strongest answer to "did the client accept".
  // The job's status is the fallback for records written before proposals
  // carried one, and it says which was used.
  const proposalStatus = (proposal?.status as string | null) ?? null;
  const acceptedByProposal = proposalStatus === "accepted" || Boolean(proposal?.approved_at);
  const acceptedByStatus = ["approved", "in_progress", "completed"].includes(status);

  // A crew sheet needs somewhere to go and something to do there. It renders
  // from the job rather than being generated and stored, so this asks whether
  // the job holds enough to render one -- not whether a site plan exists.
  const workOrderReady = Boolean(job?.project_start_date) && requirements.serviceTypeIds.length > 0;

  return {
    status,

    servicesDefined: requirements.serviceTypeIds.length > 0,
    servicesSource: requirements.servicesSource,

    proposalAccepted: acceptedByProposal || acceptedByStatus,
    proposalSource: proposalStatus
      ? `The proposal's own status (${proposalStatus})`
      : "No proposal record; falling back to the job's status",

    measurementRequired: requirements.measurementRequired,
    measurementsPresent: zones.length > 0,

    scheduled: Boolean(job?.project_start_date),
    crewAssigned: Boolean(job?.assigned_to) || (crew ?? []).length > 0,

    workOrderReady,
    workOrderSource: "Whether the job has a date and services to render a crew sheet from",

    materials: materials.state,
    materialsSource: materials.source,
    equipment: equipment.state,
    equipmentSource: equipment.source,
    access: access.state,
    accessSource: access.source,

    depositRequiredCents,
    depositReceivedCents,
    depositSource:
      depositRequiredCents > 0
        ? `The payment plan's deposit, against net money on this job — ${describeNet(receipts, adjustments, jobId)}`
        : "No deposit is required by the payment plan",

    evaluationPhotos: inPhase("evaluation"),
    preworkPhotos: inPhase("prework"),
    afterPhotos: inPhase("after"),
    walkthroughDone: ((walkthrough ?? []) as { status: string }[]).some((row) => row.status === "completed"),
    invoiceRaised: Boolean(invoice?.id),
    balanceOutstanding: outstanding,
    financialDisposition: (disposition?.state as string | null) ?? null,
  };
});

/** When the bill went out, for judging how late a payment is. */
/** Cached per request. */
export const jobInvoicedAt = cache(async function jobInvoicedAt(jobId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select("sent_at, created_at").eq("job_id", jobId).maybeSingle();
  return (data?.sent_at as string | null) ?? (data?.created_at as string | null) ?? null;
});
