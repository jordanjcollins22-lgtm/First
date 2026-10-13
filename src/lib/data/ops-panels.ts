import { dateKeyIn } from "@/lib/time-zone";
import { addDays, weekStartOf } from "@/lib/ops/crew-bonus";
import { budgetMeter, type BudgetMeter } from "@/lib/ops/job-cost";
import { onTimePct, toneAtLeast, toneAtMost, money, hours, type Kpi } from "@/lib/ops/kpis";
import type { AutopilotSettings } from "@/lib/ops/autopilot-settings";
import { admin, ensureSettings } from "@/lib/data/ops-settings";
import { listBacklogSessions, UNCLOSED_KEY, type BacklogSession } from "@/lib/data/ops-sessions";
import { budgetHoursFor, jobHours } from "@/lib/data/ops-costing";
import { bonusesForWeek } from "@/lib/data/ops-bonus";

/**
 * What the Projects autopilot, Job costing and Crew budget panels show,
 * read in one place. Service role, because the crew's events and the cost
 * snapshots are private under RLS; the panels themselves are only rendered
 * for owner-level viewers by the /v2 page.
 */

export interface NeedsYou {
  key: string;
  kind: "unclosed" | "chain" | "placement" | "checkin" | "over_budget";
  title: string;
  detail: string;
  jobId: string | null;
  /** What the one button acts on. */
  sessionId?: string;
  alertId?: string;
}

export interface AutomationStatus {
  key: string;
  name: string;
  on: boolean;
  startedAt: string | null;
  lastWeek: string;
}

export interface ProjectsAutopilotData {
  ready: boolean;
  settings: AutopilotSettings;
  needsYou: NeedsYou[];
  backlog: BacklogSession[];
  kpis: Kpi[];
  automations: AutomationStatus[];
}

const DAY = 86_400_000;

export async function loadProjectsAutopilot(organizationId: string, now: Date = new Date()): Promise<ProjectsAutopilotData> {
  const db = admin();
  const { settings, ready } = await ensureSettings(organizationId, db);
  const today = dateKeyIn(now);
  const since30 = addDays(today, -30);
  const since90iso = new Date(now.getTime() - 90 * DAY).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();

  if (!ready) {
    return { ready, settings, needsYou: [], backlog: [], kpis: [], automations: [] };
  }

  const [unclosed, chains, held, alerts, overBudget, sessions, snaps, tickets, completed, closedWeek, placedWeek, chainWeek, alertsWeek, backlog] = await Promise.all([
    db
      .from("job_exceptions")
      .select("id, job_id, work_session_id, summary, reported_at")
      .eq("organization_id", organizationId)
      .eq("raised_by", UNCLOSED_KEY)
      .in("state", ["reported", "acknowledged"])
      .order("reported_at", { ascending: false })
      .limit(50),
    db.from("job_completion_chain").select("job_id, exception, stage").eq("organization_id", organizationId).not("exception", "is", null).limit(50),
    db.from("auto_placements").select("job_id, held_reason, placed_on").eq("organization_id", organizationId).eq("status", "held").limit(50),
    db
      .from("crew_checkin_alerts")
      .select("id, profile_id, job_id, escalated_at")
      .eq("organization_id", organizationId)
      .eq("day", today)
      .is("acknowledged_at", null)
      .is("resolved_at", null)
      .not("escalated_at", "is", null),
    db.from("job_cost_snapshots").select("job_id, hours_variance_pct").eq("organization_id", organizationId).eq("over_budget", true).gte("computed_at", since90iso).limit(20),
    db.from("job_work_sessions").select("ends_on, status, closed_at, updated_at").eq("organization_id", organizationId).gte("ends_on", since30).lt("ends_on", today),
    db.from("job_cost_snapshots").select("revenue_cents, budget_hours, actual_hours, gross_margin_pct").eq("organization_id", organizationId).gte("computed_at", since90iso),
    db.from("job_tickets").select("id").eq("organization_id", organizationId).gte("created_at", since90iso),
    db.from("job_completion_chain").select("job_id").eq("organization_id", organizationId).gte("triggered_at", since90iso),
    db.from("job_work_sessions").select("id").eq("organization_id", organizationId).eq("close_source", "crew_finished").gte("closed_at", weekAgo),
    db.from("auto_placements").select("id").eq("organization_id", organizationId).eq("status", "placed").gte("decided_at", weekAgo),
    db.from("job_completion_chain").select("job_id").eq("organization_id", organizationId).gte("signoff_requested_at", weekAgo),
    db.from("crew_checkin_alerts").select("id").eq("organization_id", organizationId).gte("alerted_at", weekAgo),
    listBacklogSessions(organizationId, now),
  ]);

  // Names for everything in the strip, in one read.
  const jobIds = [
    ...((unclosed.data ?? []) as { job_id: string }[]).map((r) => r.job_id),
    ...((chains.data ?? []) as { job_id: string }[]).map((r) => r.job_id),
    ...((held.data ?? []) as { job_id: string }[]).map((r) => r.job_id),
    ...((alerts.data ?? []) as { job_id: string | null }[]).map((r) => r.job_id).filter((x): x is string => Boolean(x)),
    ...((overBudget.data ?? []) as { job_id: string }[]).map((r) => r.job_id),
  ];
  const names = await jobNames([...new Set(jobIds)]);
  const personIds = ((alerts.data ?? []) as { profile_id: string }[]).map((a) => a.profile_id);
  const { data: people } = personIds.length ? await db.from("profiles").select("id, full_name, email").in("id", personIds) : { data: [] };
  const personName = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));

  const needsYou: NeedsYou[] = [
    ...((alerts.data ?? []) as { id: string; profile_id: string; job_id: string | null }[]).map((a) => ({
      key: `checkin:${a.id}`,
      kind: "checkin" as const,
      title: `${personName.get(a.profile_id) ?? "Someone"} hasn't opened the app`,
      detail: "The project lead didn't answer, so this came to you.",
      jobId: a.job_id,
      alertId: a.id,
    })),
    ...((unclosed.data ?? []) as { id: string; job_id: string; work_session_id: string | null; summary: string }[]).map((e) => ({
      key: `unclosed:${e.id}`,
      kind: "unclosed" as const,
      title: `Work day not closed: ${names.get(e.job_id) ?? "a job"}`,
      detail: e.summary,
      jobId: e.job_id,
      sessionId: e.work_session_id ?? undefined,
    })),
    ...((chains.data ?? []) as { job_id: string; exception: string }[]).map((c) => ({
      key: `chain:${c.job_id}`,
      kind: "chain" as const,
      title: `Close-out stuck: ${names.get(c.job_id) ?? "a job"}`,
      detail: c.exception,
      jobId: c.job_id,
    })),
    ...((held.data ?? []) as { job_id: string; held_reason: string | null }[]).map((h) => ({
      key: `placement:${h.job_id}`,
      kind: "placement" as const,
      title: `Not placed: ${names.get(h.job_id) ?? "a job"}`,
      detail: h.held_reason ?? "Held for a person to book.",
      jobId: h.job_id,
    })),
    ...((overBudget.data ?? []) as { job_id: string; hours_variance_pct: number | null }[]).map((o) => ({
      key: `over:${o.job_id}`,
      kind: "over_budget" as const,
      title: `Over hours: ${names.get(o.job_id) ?? "a job"}`,
      detail: `${Math.round(Number(o.hours_variance_pct ?? 0))}% over the budgeted hours.`,
      jobId: o.job_id,
    })),
  ];

  // ------------------------------------------------------------------ KPIs
  const sessionRows = (sessions.data ?? []) as { ends_on: string; status: string; closed_at: string | null; updated_at: string }[];
  const onTime = onTimePct(
    sessionRows.map((s) => ({
      endsOn: s.ends_on,
      status: s.status,
      closedOn: s.status === "done" ? dateKeyIn(new Date(s.closed_at ?? s.updated_at)) : null,
    }))
  );
  const snapRows = (snaps.data ?? []) as { revenue_cents: number; budget_hours: number | null; actual_hours: number; gross_margin_pct: number | null }[];
  const withBudget = snapRows.filter((s) => s.budget_hours != null && Number(s.actual_hours) > 0);
  const budgetSum = withBudget.reduce((s, r) => s + Number(r.budget_hours), 0);
  const actualSum = withBudget.reduce((s, r) => s + Number(r.actual_hours), 0);
  const efficiency = actualSum > 0 ? Math.round((budgetSum / actualSum) * 100) : null;
  const margins = snapRows.map((s) => s.gross_margin_pct).filter((m): m is number => m != null);
  const avgMargin = margins.length ? Math.round(margins.reduce((s, m) => s + Number(m), 0) / margins.length) : null;
  const totalHours = snapRows.reduce((s, r) => s + Number(r.actual_hours), 0);
  const totalRevenue = snapRows.reduce((s, r) => s + Number(r.revenue_cents), 0);
  const rph = totalHours > 0 ? Math.round(totalRevenue / totalHours) : null;
  const ticketCount = ((tickets.data ?? []) as unknown[]).length;
  const finishedJobs = ((completed.data ?? []) as unknown[]).length;
  const callbackRate = finishedJobs > 0 ? Math.round((ticketCount / finishedJobs) * 100) : null;

  const kpis: Kpi[] = [
    {
      key: "on_time",
      label: "Work days closed on time",
      value: onTime.pct == null ? "–" : `${onTime.pct}%`,
      target: "100%",
      tone: toneAtLeast(onTime.pct, 95, 80),
      detail: `${onTime.of} work days in the last 30 days.`,
    },
    {
      key: "efficiency",
      label: "Budget vs actual hours",
      value: efficiency == null ? "–" : `${efficiency}%`,
      target: "≥ 100%",
      tone: toneAtLeast(efficiency, 100, 90),
      detail: withBudget.length ? `${hours(budgetSum)} budgeted, ${hours(actualSum)} worked, ${withBudget.length} jobs.` : "No costed jobs with a budget yet.",
    },
    {
      key: "margin",
      label: "Gross margin per job",
      value: avgMargin == null ? "–" : `${avgMargin}%`,
      target: "Maintenance ~50%, install 22–28%",
      tone: toneAtLeast(avgMargin, 35, 22),
      detail: margins.length ? `Average of ${margins.length} costed jobs, 90 days.` : "No costed jobs yet.",
    },
    {
      key: "rph",
      label: "Revenue per crew-hour",
      value: money(rph),
      target: "$65–$145",
      tone: rph == null ? "none" : toneAtLeast(rph / 100, 65, 50),
      detail: totalHours > 0 ? `${money(totalRevenue)} over ${hours(totalHours)}.` : "No logged hours on costed jobs yet.",
    },
    {
      key: "callbacks",
      label: "Callbacks",
      value: String(ticketCount),
      target: "< 3% of jobs",
      tone: callbackRate == null ? "none" : toneAtMost(callbackRate, 3, 6),
      detail: finishedJobs ? `${callbackRate}% of ${finishedJobs} finished jobs, 90 days.` : "Tickets opened in the last 90 days.",
    },
  ];

  const count = (r: { data: unknown[] | null }) => (r.data ?? []).length;
  const automations: AutomationStatus[] = [
    { key: "auto_close", name: "Close work days on \"Finished here\"", on: settings.autoCloseEnabled, startedAt: settings.autoCloseStartedAt, lastWeek: `${count(closedWeek)} closed by the crew` },
    { key: "chain", name: "Completion chain: sign-off → invoice → cost", on: settings.completionChainEnabled, startedAt: settings.completionChainStartedAt, lastWeek: `${count(chainWeek)} sign-offs sent` },
    { key: "checkin", name: "Crew check-in: lead first, owner after 30 min", on: settings.checkinLeadFirstEnabled, startedAt: settings.checkinStartedAt, lastWeek: `${count(alertsWeek)} alerts` },
    { key: "auto_place", name: "Auto-place ready jobs", on: settings.autoPlaceEnabled, startedAt: settings.autoPlaceStartedAt, lastWeek: `${count(placedWeek)} placed` },
    { key: "bonus", name: "Crew bonus under budget", on: settings.crewBonusEnabled, startedAt: settings.crewBonusStartedAt, lastWeek: settings.crewBonusEnabled ? "Settled Mondays" : "Off" },
  ];

  return { ready, settings, needsYou, backlog, kpis, automations };
}

async function jobNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin().from("jobs").select("id, name, property:properties(address)").in("id", ids);
  return new Map(((data ?? []) as unknown as { id: string; name: string; property: { address: string | null } | null }[]).map((j) => [j.id, j.property?.address || j.name]));
}

/* ------------------------------------------------------------- costing */

export interface CostRow {
  jobId: string;
  name: string;
  computedAt: string;
  final: boolean;
  revenueCents: number;
  budgetHours: number | null;
  actualHours: number;
  laborCents: number;
  materialsCents: number;
  grossMarginCents: number;
  grossMarginPct: number | null;
  overBudget: boolean;
  hoursVariancePct: number | null;
  notes: string[];
}

export interface JobCostingData {
  ready: boolean;
  rows: CostRow[];
  /** Completed jobs with no snapshot: the gap the chain is closing. */
  uncosted: { jobId: string; name: string }[];
  totals: { revenueCents: number; laborCents: number; materialsCents: number; marginCents: number; hours: number };
}

export async function loadJobCosting(organizationId: string): Promise<JobCostingData> {
  const db = admin();
  const { data, error } = await db
    .from("job_cost_snapshots")
    .select("job_id, computed_at, final, revenue_cents, budget_hours, actual_hours, labor_cents, materials_cents, gross_margin_cents, gross_margin_pct, over_budget, hours_variance_pct, notes")
    .eq("organization_id", organizationId)
    .order("computed_at", { ascending: false })
    .limit(100);
  if (error) return { ready: false, rows: [], uncosted: [], totals: { revenueCents: 0, laborCents: 0, materialsCents: 0, marginCents: 0, hours: 0 } };
  type Snap = {
    job_id: string;
    computed_at: string;
    final: boolean;
    revenue_cents: number;
    budget_hours: number | null;
    actual_hours: number;
    labor_cents: number;
    materials_cents: number;
    gross_margin_cents: number;
    gross_margin_pct: number | null;
    over_budget: boolean;
    hours_variance_pct: number | null;
    notes: string[] | null;
  };
  const snaps = (data ?? []) as Snap[];

  const { data: completedJobs } = await db
    .from("jobs")
    .select("id, name, property:properties!inner(address, customers!inner(organization_id))")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(200);
  const mine = ((completedJobs ?? []) as unknown as { id: string; name: string; property: { address: string | null; customers: { organization_id: string } | null } | null }[]).filter(
    (j) => j.property?.customers?.organization_id === organizationId
  );
  const costed = new Set(snaps.map((s) => s.job_id));
  const names = await jobNames(snaps.map((s) => s.job_id));

  const rows: CostRow[] = snaps.map((s) => ({
    jobId: s.job_id,
    name: names.get(s.job_id) ?? "Job",
    computedAt: s.computed_at,
    final: s.final,
    revenueCents: Number(s.revenue_cents),
    budgetHours: s.budget_hours == null ? null : Number(s.budget_hours),
    actualHours: Number(s.actual_hours),
    laborCents: Number(s.labor_cents),
    materialsCents: Number(s.materials_cents),
    grossMarginCents: Number(s.gross_margin_cents),
    grossMarginPct: s.gross_margin_pct == null ? null : Number(s.gross_margin_pct),
    overBudget: s.over_budget,
    hoursVariancePct: s.hours_variance_pct == null ? null : Number(s.hours_variance_pct),
    notes: Array.isArray(s.notes) ? s.notes : [],
  }));
  const sum = (f: (r: CostRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    ready: true,
    rows,
    uncosted: mine.filter((j) => !costed.has(j.id)).map((j) => ({ jobId: j.id, name: j.property?.address || j.name })),
    totals: {
      revenueCents: sum((r) => r.revenueCents),
      laborCents: sum((r) => r.laborCents),
      materialsCents: sum((r) => r.materialsCents),
      marginCents: sum((r) => r.grossMarginCents),
      hours: Math.round(sum((r) => r.actualHours) * 10) / 10,
    },
  };
}

/* --------------------------------------------------------- crew budget */

export interface CrewBudgetJob {
  jobId: string;
  name: string;
  meter: BudgetMeter;
  leadId: string | null;
  onSiteNow: number;
}

/**
 * Today's jobs, hours budgeted against hours used so far (live). Hours only:
 * this is what a crew lead sees, and pay is not their business. Pass
 * `leadId` to see only the jobs that person leads.
 */
export async function loadCrewBudgets(organizationId: string, options: { leadId?: string; now?: Date } = {}): Promise<CrewBudgetJob[]> {
  const db = admin();
  const now = options.now ?? new Date();
  const today = dateKeyIn(now);
  const { data: sessions } = await db
    .from("job_work_sessions")
    .select("job_id")
    .eq("organization_id", organizationId)
    .lte("starts_on", today)
    .gte("ends_on", today)
    .neq("status", "cancelled");
  let jobIds = [...new Set(((sessions ?? []) as { job_id: string }[]).map((s) => s.job_id))];
  if (jobIds.length === 0) return [];
  const { data: leads } = await db.from("job_crew").select("job_id, profile_id").in("job_id", jobIds).eq("is_lead", true);
  const leadOf = new Map(((leads ?? []) as { job_id: string; profile_id: string }[]).map((l) => [l.job_id, l.profile_id]));
  if (options.leadId) jobIds = jobIds.filter((id) => leadOf.get(id) === options.leadId);
  if (jobIds.length === 0) return [];

  const [hoursBy, budgets, names] = await Promise.all([jobHours(db, organizationId, jobIds, now), budgetHoursFor(db, jobIds), jobNames(jobIds)]);
  return jobIds.map((id) => {
    const h = hoursBy.get(id)!;
    return {
      jobId: id,
      name: names.get(id) ?? "Job",
      meter: budgetMeter(budgets.get(id)?.hours ?? null, h.totalHours),
      leadId: leadOf.get(id) ?? null,
      onSiteNow: h.people.length,
    };
  });
}

export async function loadBonusPreview(organizationId: string, now: Date = new Date()) {
  const week = weekStartOf(dateKeyIn(now));
  const lastWeek = addDays(week, -7);
  const db = admin();
  const [{ rows, enabled, perMemberCents }, { data: settled }] = await Promise.all([
    bonusesForWeek(organizationId, week, db),
    db.from("crew_bonus_weeks").select("profile_id, amount_cents, status, reason").eq("organization_id", organizationId).eq("week_start", lastWeek),
  ]);
  const ids = [...new Set([...rows.map((r) => r.profileId), ...((settled ?? []) as { profile_id: string }[]).map((r) => r.profile_id)])];
  const { data: people } = ids.length ? await db.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const name = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  return {
    enabled,
    perMemberCents,
    week,
    lastWeek,
    thisWeek: rows.map((r) => ({ ...r, name: name.get(r.profileId) ?? "Someone" })),
    settled: ((settled ?? []) as { profile_id: string; amount_cents: number; status: string; reason: string | null }[]).map((r) => ({
      name: name.get(r.profile_id) ?? "Someone",
      amountCents: r.amount_cents,
      status: r.status,
      reason: r.reason,
    })),
  };
}
