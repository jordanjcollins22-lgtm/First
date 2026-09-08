import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { Issue, IssueSeverity, IssueType, BlockingStage } from "@/lib/issues";
import type { GateKey, GateOverride, JobFacts } from "@/lib/readiness";

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

export async function listJobIssues(jobId: string): Promise<Issue[]> {
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
}

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

export async function listGateOverrides(jobId: string): Promise<Record<GateKey, GateOverride[]>> {
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
}

/**
 * The facts a gate is decided from, gathered from what the job already holds.
 *
 * Nothing new is stored: every one of these is read off a record the app was
 * already keeping. Two are read off issues rather than a field of their own --
 * materials and access are confirmed by the absence of an open issue saying
 * they are not, which is how a crew already reports them.
 */
export async function jobFacts(jobId: string): Promise<JobFacts> {
  const supabase = await createClient();

  const [{ data: job }, { data: crew }, { data: photos }, { data: issues }, { data: design }, { data: walkthrough }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("status, assigned_to, project_start_date, evaluation_date, completed_at")
        .eq("id", jobId)
        .maybeSingle(),
      supabase.from("job_crew").select("profile_id").eq("job_id", jobId),
      supabase.from("job_photos").select("kind").eq("job_id", jobId),
      supabase.from("job_issues").select("type, status").eq("job_id", jobId).eq("status", "open"),
      supabase.from("canvas_designs").select("id, zones").eq("job_id", jobId).maybeSingle(),
      supabase.from("job_walkthroughs").select("status").eq("job_id", jobId).limit(50),
    ]);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, amount, status, paid_at")
    .eq("job_id", jobId)
    .maybeSingle();

  const openTypes = new Set(((issues ?? []) as { type: string }[]).map((row) => row.type));
  const kinds = ((photos ?? []) as { kind: string | null }[]).map((row) => row.kind);
  const zones = (design?.zones as unknown[] | null) ?? [];
  const status = (job?.status as string) ?? "estimating";
  // An invoice marked paid owes nothing; one that is not owes its amount.
  // No invoice at all is "not known", which warns rather than blocks.
  const settled = Boolean(invoice?.paid_at) || invoice?.status === "paid";
  const outstanding = invoice == null ? null : settled ? 0 : Number(invoice.amount ?? 0);

  return {
    status,
    // Sold is sold: the proposal was accepted the moment the job left quoting.
    proposalAccepted: ["approved", "in_progress", "completed"].includes(status),
    // An open payment issue is the only thing that says a deposit is missing.
    depositSatisfied: !openTypes.has("payment"),
    scheduled: Boolean(job?.project_start_date),
    crewAssigned: Boolean(job?.assigned_to) || (crew ?? []).length > 0,
    workOrderReady: zones.length > 0,
    materialsConfirmed: !openTypes.has("material") && !openTypes.has("equipment"),
    accessConfirmed: !openTypes.has("access"),
    measurementsPresent: zones.length > 0,
    scopeDocumented: zones.length > 0,
    beforePhotos: kinds.filter((kind) => kind === "before").length,
    afterPhotos: kinds.filter((kind) => kind === "after").length,
    walkthroughDone: ((walkthrough ?? []) as { status: string }[]).some((row) => row.status === "completed"),
    invoiceRaised: Boolean(invoice?.id),
    balanceOutstanding: outstanding,
  };
}
