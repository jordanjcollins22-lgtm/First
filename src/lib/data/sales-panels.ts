import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { loadMoney } from "@/lib/data/commission";
import { readAutopilotSettings, type StoredAutopilot } from "@/lib/data/sales-autopilot";
import { loadTerritories, type TerritoryRow } from "@/lib/data/territories";
import { covers } from "@/lib/sales/territories";
import { zipOf } from "@/lib/material-suppliers";
import { SHARE_PCT } from "@/lib/commission-split";
import { salesKpis, type SalesKpis } from "@/lib/sales/sales-kpis";
import { speedSummary, type SpeedSummary } from "@/lib/sales/speed-to-proposal";
import { buildScorecard, teamTotals, type ScorecardJob, type ScorecardRow } from "@/lib/sales/scorecard";
import { findDuplicates, missingRates, type DuplicateGroup, type ServiceRow } from "@/lib/sales/service-dedupe";

/**
 * What the three sales panels read, under the signed-in owner's own row
 * security. Each loader returns something renderable whatever is missing:
 * no migration, no rows, a failed read. A panel that crashes is worse than
 * one that says it has nothing yet.
 */

const untyped = (c: unknown) => c as SupabaseClient;
const DAY = 86_400_000;
const time = (iso: string) => new Date(iso).getTime();
/** The window every number on the panels covers. */
export const WINDOW_DAYS = 90;

export interface NeedsYouItem {
  id: string;
  kind: "proposal_overdue" | "price_held" | "backlog";
  jobId: string | null;
  summary: string;
  detail: string | null;
  /** Who it is for, by name; null is the office. */
  assignee: string | null;
  openedAt: string | null;
  href: string;
}

export interface AutopilotActivity {
  /** Last 7 days. */
  approved: number;
  sent: number;
  held: number;
  lastCheckAt: string | null;
}

export interface PipelineAutopilotData {
  settings: StoredAutopilot;
  needsYou: NeedsYouItem[];
  kpis: SalesKpis;
  speed: SpeedSummary;
  activity: AutopilotActivity;
  coverage: { missing: ServiceRow[]; duplicates: DuplicateGroup[]; active: number; withRate: number; services: ServiceRow[] };
}

export async function loadPipelineAutopilot(organizationId: string, now = new Date()): Promise<PipelineAutopilotData> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const settings = await readAutopilotSettings(supabase, organizationId);

  const [exceptions, checks, proposals, evaluations, customers, services, requested, backlog] = await Promise.all([
    loadOpenSalesExceptions(organizationId, ["price_held", "proposal_overdue"]),
    untyped(supabase).from("proposal_guardrail_checks").select("action, sent_at, checked_at").eq("organization_id", organizationId).gte("checked_at", weekAgo).limit(1000),
    supabase
      .from("job_proposals")
      .select("job_id, status, total_cost, discount_amount, sent_at, expires_at, created_at, responded_at, jobs!inner(evaluation_submitted_at)")
      .eq("organization_id", organizationId)
      .or(`created_at.gte."${since}",responded_at.gte."${since}",status.eq.sent`)
      .limit(2000),
    supabase
      .from("jobs")
      .select("id, evaluation_date, evaluation_status, evaluation_submitted_at, properties!inner(customers!inner(organization_id))")
      .eq("properties.customers.organization_id", organizationId)
      .gte("evaluation_date", since)
      .lte("evaluation_date", now.toISOString())
      .limit(2000),
    supabase.from("customers").select("id, created_at").eq("organization_id", organizationId).is("import_batch", null).gte("created_at", since).limit(2000),
    supabase.from("services").select("service_type_id, name, status, cost, cost_unit").eq("organization_id", organizationId),
    supabase.from("job_requested_services").select("service_type_id").eq("organization_id", organizationId).limit(5000),
    supabase
      .from("job_proposals")
      .select("job_id, jobs!inner(evaluation_submitted_at)")
      .eq("organization_id", organizationId)
      .eq("status", "needs_approval")
      .limit(200),
  ]);

  const needsYou: NeedsYouItem[] = [...exceptions];
  // Proposals from before the go-live, still waiting: the autopilot leaves
  // them alone on purpose, so somebody has to see them.
  const before = ((backlog.data ?? []) as unknown as { job_id: string; jobs: { evaluation_submitted_at: string | null } }[]).filter(
    (p) => !settings.startedAt || !p.jobs.evaluation_submitted_at || time(p.jobs.evaluation_submitted_at) < time(settings.startedAt)
  );
  if (before.length > 0) {
    needsYou.push({
      id: "backlog",
      kind: "backlog",
      jobId: null,
      summary: `${before.length} proposal${before.length === 1 ? "" : "s"} from before the autopilot went live still need${before.length === 1 ? "s" : ""} a price approved.`,
      detail: "The autopilot never touches work submitted before it went live. Approve them on the price card.",
      assignee: null,
      openedAt: null,
      href: "/my-day",
    });
  }

  // KPIs.
  const proposalRows = (proposals.data ?? []) as unknown as {
    job_id: string;
    status: string;
    total_cost: number | null;
    discount_amount: number | null;
    sent_at: string | null;
    expires_at: string | null;
    created_at: string;
    responded_at: string | null;
    jobs: { evaluation_submitted_at: string | null };
  }[];
  const customerRows = (customers.data ?? []) as { id: string; created_at: string }[];
  const firstContact = await firstContactFor(supabase, organizationId, customerRows.map((c) => c.id));
  const booked = await bookedCustomers(supabase, customerRows.map((c) => c.id));
  const kpis = salesKpis({
    now,
    leads: customerRows.map((c) => ({ createdAt: c.created_at, firstContactAt: firstContact.get(c.id) ?? null, booked: booked.has(c.id) })),
    evaluations: ((evaluations.data ?? []) as { evaluation_date: string; evaluation_status: string | null; evaluation_submitted_at: string | null }[]).map((e) => ({
      date: e.evaluation_date,
      status: e.evaluation_status,
      submittedAt: e.evaluation_submitted_at,
    })),
    proposals: proposalRows
      .filter((p) => p.status === "sent" || time(p.responded_at ?? p.created_at) >= time(since))
      .map((p) => ({ status: p.status, total: Math.max(0, Number(p.total_cost ?? 0) - Number(p.discount_amount ?? 0)), sentAt: p.sent_at, expiresAt: p.expires_at })),
  });
  const speed = speedSummary(
    proposalRows.filter((p) => p.jobs.evaluation_submitted_at && time(p.jobs.evaluation_submitted_at) >= time(since)).map((p) => ({ submittedAt: p.jobs.evaluation_submitted_at, sentAt: p.sent_at })),
    now,
    settings.speedTargetHours
  );

  const checkRows = (checks.data ?? []) as { action: string; sent_at: string | null; checked_at: string }[];
  const activity: AutopilotActivity = {
    approved: checkRows.filter((c) => c.action === "approve" || c.action === "approve_and_send").length,
    sent: checkRows.filter((c) => c.sent_at).length,
    held: checkRows.filter((c) => c.action === "hold").length,
    lastCheckAt: checkRows.map((c) => c.checked_at).sort().pop() ?? null,
  };

  // Rate coverage.
  const uses = new Map<string, number>();
  for (const r of (requested.data ?? []) as { service_type_id: string }[]) uses.set(r.service_type_id, (uses.get(r.service_type_id) ?? 0) + 1);
  const serviceRows: ServiceRow[] = ((services.data ?? []) as { service_type_id: string; name: string; status: string; cost: number | null; cost_unit: string | null }[]).map((s) => ({
    serviceTypeId: s.service_type_id,
    name: s.name,
    status: s.status,
    cost: s.cost == null ? null : Number(s.cost),
    costUnit: s.cost_unit,
    uses: uses.get(s.service_type_id) ?? 0,
  }));
  const active = serviceRows.filter((s) => s.status === "active");
  const missing = missingRates(serviceRows);

  return {
    settings,
    needsYou,
    kpis,
    speed,
    activity,
    coverage: { missing, duplicates: findDuplicates(serviceRows), active: active.length, withRate: active.length - missing.length, services: serviceRows },
  };
}

/** The first message that went to each client, from the message log. */
async function firstContactFor(supabase: SupabaseClient, organizationId: string, customerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < customerIds.length; i += 300) {
    const { data } = await supabase
      .from("client_message_log")
      .select("customer_id, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "sent")
      .in("customer_id", customerIds.slice(i, i + 300))
      .order("created_at", { ascending: true })
      .limit(3000);
    for (const row of (data ?? []) as { customer_id: string; created_at: string }[]) {
      if (!out.has(row.customer_id)) out.set(row.customer_id, row.created_at);
    }
  }
  return out;
}

/** Which of these clients have an evaluation booked, ever. */
async function bookedCustomers(supabase: SupabaseClient, customerIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < customerIds.length; i += 300) {
    const { data } = await supabase
      .from("properties")
      .select("customer_id, jobs!inner(id)")
      .in("customer_id", customerIds.slice(i, i + 300))
      .not("jobs.evaluation_date", "is", null)
      .limit(3000);
    for (const row of (data ?? []) as { customer_id: string }[]) out.add(row.customer_id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluator scorecard
// ---------------------------------------------------------------------------

export interface ScorecardData {
  rows: ScorecardRow[];
  team: ReturnType<typeof teamTotals> | null;
  windowDays: number;
  speedTargetHours: number;
  commissionPct: number;
}

export async function loadScorecard(organizationId: string, now = new Date()): Promise<ScorecardData> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const settings = await readAutopilotSettings(supabase, organizationId);
  const [{ data: jobs }, { data: profiles }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, assigned_to, evaluation_date, evaluation_status, evaluation_submitted_at, properties!inner(customers!inner(organization_id))")
      .eq("properties.customers.organization_id", organizationId)
      .not("assigned_to", "is", null)
      .gte("evaluation_date", since.toISOString())
      .limit(3000),
    supabase.from("profiles").select("id, full_name, first_name, email, does_evaluations").eq("organization_id", organizationId),
  ]);
  const jobRows = (jobs ?? []) as { id: string; assigned_to: string; evaluation_date: string | null; evaluation_status: string | null; evaluation_submitted_at: string | null }[];
  const jobIds = jobRows.map((j) => j.id);
  const [proposals, money] = await Promise.all([
    jobIds.length
      ? supabase.from("job_proposals").select("job_id, status, total_cost, discount_amount, sent_at").in("job_id", jobIds.slice(0, 1000))
      : Promise.resolve({ data: [] as { job_id: string; status: string; total_cost: number | null; discount_amount: number | null; sent_at: string | null }[] }),
    loadMoney(jobIds).catch(() => null),
  ]);
  const proposalOf = new Map(((proposals.data ?? []) as { job_id: string; status: string; total_cost: number | null; discount_amount: number | null; sent_at: string | null }[]).map((p) => [p.job_id, p]));
  const input: ScorecardJob[] = jobRows.map((j) => {
    const p = proposalOf.get(j.id);
    return {
      evaluatorId: j.assigned_to,
      evaluationDate: j.evaluation_date,
      evaluationStatus: j.evaluation_status,
      submittedAt: j.evaluation_submitted_at,
      proposalStatus: p?.status ?? null,
      sentAt: p?.sent_at ?? null,
      proposalTotal: p ? Math.max(0, Number(p.total_cost ?? 0) - Number(p.discount_amount ?? 0)) : null,
      collected: money?.collected.get(j.id) ?? 0,
    };
  });
  const assigned = new Set(jobRows.map((j) => j.assigned_to));
  const people = (profiles ?? [])
    .filter((p) => p.does_evaluations || assigned.has(p.id))
    .map((p) => ({ id: p.id, name: (p.full_name ?? p.first_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody" }));
  const rows = buildScorecard(people, input, { now, since, speedTargetHours: settings.speedTargetHours, commissionPct: SHARE_PCT.evaluator });
  return { rows, team: rows.length ? teamTotals(rows) : null, windowDays: WINDOW_DAYS, speedTargetHours: settings.speedTargetHours, commissionPct: SHARE_PCT.evaluator };
}

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

export interface TerritoriesData {
  ready: boolean;
  evaluators: { id: string; name: string; territory: TerritoryRow | null; bookings: number; inTerritory: number }[];
  /** Recent evaluation pins, for seeing where the work is while drawing. */
  pins: { lat: number; lng: number; evaluatorId: string | null }[];
}

export async function loadTerritoriesPanel(organizationId: string, now = new Date()): Promise<TerritoriesData> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
  const [{ territories, ready }, { data: profiles }, { data: jobs }] = await Promise.all([
    loadTerritories(supabase, organizationId),
    supabase.from("profiles").select("id, full_name, first_name, email, does_evaluations").eq("organization_id", organizationId),
    supabase
      .from("jobs")
      .select("assigned_to, properties!inner(lat, lng, address, customers!inner(organization_id))")
      .eq("properties.customers.organization_id", organizationId)
      .gte("evaluation_date", since)
      .limit(1000),
  ]);
  const visits = ((jobs ?? []) as unknown as { assigned_to: string | null; properties: { lat: number | null; lng: number | null; address: string } }[]).map((j) => ({
    evaluatorId: j.assigned_to,
    place: { lat: j.properties.lat, lng: j.properties.lng, zip: zipOf(j.properties.address) },
  }));
  const evaluators = (profiles ?? [])
    .filter((p) => p.does_evaluations || territories.some((t) => t.evaluatorId === p.id))
    .map((p) => {
      const territory = territories.find((t) => t.evaluatorId === p.id) ?? null;
      const mine = visits.filter((v) => v.evaluatorId === p.id);
      return {
        id: p.id,
        name: (p.full_name ?? p.first_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody",
        territory,
        bookings: mine.length,
        inTerritory: territory ? mine.filter((v) => covers(territory, v.place)).length : 0,
      };
    });
  return {
    ready,
    evaluators,
    pins: visits.filter((v) => v.place.lat != null && v.place.lng != null).map((v) => ({ lat: v.place.lat!, lng: v.place.lng!, evaluatorId: v.evaluatorId })),
  };
}

/** Open sales exceptions of some kinds, with the assignee's name, for a panel's needs-you strip. */
export async function loadOpenSalesExceptions(organizationId: string, kinds: ("proposal_overdue" | "price_held")[]): Promise<NeedsYouItem[]> {
  const supabase = await createClient();
  const { data, error } = await untyped(supabase)
    .from("sales_exceptions")
    .select("id, kind, job_id, summary, detail, assigned_to, opened_at")
    .eq("organization_id", organizationId)
    .eq("state", "open")
    .in("kind", kinds)
    .order("opened_at", { ascending: false })
    .limit(50);
  if (error) return [];
  const rows = (data ?? []) as { id: string; kind: "proposal_overdue" | "price_held"; job_id: string | null; summary: string; detail: string | null; assigned_to: string | null; opened_at: string }[];
  const ids = [...new Set(rows.map((r) => r.assigned_to).filter((id): id is string => Boolean(id)))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name, first_name").in("id", ids) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, (p.full_name ?? p.first_name ?? "").trim() || "Somebody"]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    jobId: r.job_id,
    summary: r.summary,
    detail: r.detail,
    assignee: r.assigned_to ? nameOf.get(r.assigned_to) ?? "Somebody" : null,
    openedAt: r.opened_at,
    href: r.job_id ? `/jobs/${r.job_id}` : "/pipeline",
  }));
}
