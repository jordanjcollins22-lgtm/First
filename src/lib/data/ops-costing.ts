import type { SupabaseClient } from "@supabase/supabase-js";

import { agreedTotal } from "@/lib/agreed-total";
import { blendedCrewRateCents } from "@/lib/job-costing";
import { budgetFromEstimate } from "@/lib/project-review";
import type { JobEstimate } from "@/lib/job-estimate";
import { hoursForJob, type ClockEntryRow, type CrewEventRow, type JobHours } from "@/lib/ops/crew-hours";
import { costSnapshot, type CostSnapshot } from "@/lib/ops/job-cost";
import type { AutopilotSettings } from "@/lib/ops/autopilot-settings";
import { admin } from "@/lib/data/ops-settings";

/**
 * Job costing from what the crew actually tapped.
 *
 * Reads with the service role: the crew's events are private to each person
 * under RLS, and costing needs everybody's. Callers decide who may see the
 * result (the panels are owner-level; the crew meter shows hours, never pay).
 */

export interface JobCostReading {
  jobId: string;
  hours: JobHours;
  budgetHours: number | null;
  revenueCents: number;
  snapshot: CostSnapshot;
  notes: string[];
}

/** Every event on the days anybody touched this job, so travel from the previous stop is known. */
export async function jobHours(client: SupabaseClient, organizationId: string, jobIds: string[], now: Date | null = null): Promise<Map<string, JobHours>> {
  const out = new Map<string, JobHours>();
  if (jobIds.length === 0) return out;
  const [{ data: touches }, { data: clock }] = await Promise.all([
    client.from("crew_day_events").select("profile_id, day").eq("organization_id", organizationId).in("job_id", jobIds),
    client.from("time_entries").select("profile_id, job_id, clocked_in_at, clocked_out_at").eq("organization_id", organizationId).in("job_id", jobIds),
  ]);
  const pairs = (touches ?? []) as { profile_id: string; day: string }[];
  const profiles = [...new Set(pairs.map((p) => p.profile_id))];
  const days = [...new Set(pairs.map((p) => p.day))];
  let events: CrewEventRow[] = [];
  if (profiles.length > 0 && days.length > 0) {
    const { data } = await client
      .from("crew_day_events")
      .select("profile_id, day, kind, job_id, at")
      .eq("organization_id", organizationId)
      .in("profile_id", profiles)
      .in("day", days)
      .order("at", { ascending: true })
      .limit(10_000);
    const wanted = new Set(pairs.map((p) => `${p.profile_id}|${p.day}`));
    events = ((data ?? []) as { profile_id: string; day: string; kind: CrewEventRow["kind"]; job_id: string | null; at: string }[])
      .filter((e) => wanted.has(`${e.profile_id}|${e.day}`))
      .map((e) => ({ profileId: e.profile_id, day: e.day, kind: e.kind, jobId: e.job_id, at: e.at }));
  }
  const entries: ClockEntryRow[] = ((clock ?? []) as { profile_id: string; job_id: string | null; clocked_in_at: string; clocked_out_at: string | null }[]).map((c) => ({
    profileId: c.profile_id,
    jobId: c.job_id,
    clockedInAt: c.clocked_in_at,
    clockedOutAt: c.clocked_out_at,
  }));
  for (const id of jobIds) out.set(id, hoursForJob(id, events, entries, { now }));
  return out;
}

/** Budgeted crew-hours, off the estimate the client accepted. */
export async function budgetHoursFor(client: SupabaseClient, jobIds: string[]): Promise<Map<string, { hours: number | null; revenueCents: number }>> {
  const out = new Map<string, { hours: number | null; revenueCents: number }>();
  if (jobIds.length === 0) return out;
  const { data } = await client.from("job_proposals").select("job_id, estimate, total_cost, discount_amount").in("job_id", jobIds);
  for (const p of (data ?? []) as { job_id: string; estimate: unknown; total_cost: number | null; discount_amount: number | null }[]) {
    const budget = budgetFromEstimate(p.estimate as JobEstimate | null);
    out.set(p.job_id, { hours: budget?.crewHours ?? null, revenueCents: Math.round((agreedTotal(p) ?? 0) * 100) });
  }
  return out;
}

/** Each person's own rate, and the blended rate for anybody with none. */
async function ratesFor(client: SupabaseClient, organizationId: string): Promise<{ rates: Map<string, number | null>; fallbackCents: number }> {
  const [{ data: people }, { data: org }] = await Promise.all([
    client.from("profiles").select("id, pay_type, pay_rate_per_hour").eq("organization_id", organizationId),
    client.from("organizations").select("crew_cost_per_hour").eq("id", organizationId).maybeSingle(),
  ]);
  const rows = (people ?? []) as { id: string; pay_type: string | null; pay_rate_per_hour: number | null }[];
  const rates = new Map(rows.map((p) => [p.id, p.pay_rate_per_hour != null && p.pay_type !== "commission" ? Math.round(Number(p.pay_rate_per_hour) * 100) : null]));
  const fallbackCents = blendedCrewRateCents(
    rows.map((p) => ({ payType: p.pay_type ?? "hourly", ratePerHour: p.pay_rate_per_hour })),
    (org as { crew_cost_per_hour: number | null } | null)?.crew_cost_per_hour ?? null
  );
  return { rates, fallbackCents };
}

export async function readJobCosts(organizationId: string, jobIds: string[], settings: AutopilotSettings, client: SupabaseClient = admin()): Promise<JobCostReading[]> {
  if (jobIds.length === 0) return [];
  const [hours, budgets, { rates, fallbackCents }, jobsRes, receiptsRes] = await Promise.all([
    jobHours(client, organizationId, jobIds),
    budgetHoursFor(client, jobIds),
    ratesFor(client, organizationId),
    client.from("jobs").select("id, final_materials_cents, final_other_cents").in("id", jobIds),
    client.from("job_receipts").select("job_id, amount_cents").eq("organization_id", organizationId).in("job_id", jobIds),
  ]);
  const finals = new Map(
    ((jobsRes.data ?? []) as { id: string; final_materials_cents: number | null; final_other_cents: number | null }[]).map((j) => [j.id, j])
  );
  const receipts = new Map<string, number>();
  for (const r of (receiptsRes.data ?? []) as { job_id: string; amount_cents: number | null }[]) {
    receipts.set(r.job_id, (receipts.get(r.job_id) ?? 0) + (r.amount_cents ?? 0));
  }

  return jobIds.map((jobId) => {
    const h = hours.get(jobId)!;
    const b = budgets.get(jobId) ?? { hours: null, revenueCents: 0 };
    const final = finals.get(jobId);
    const notes: string[] = [];
    const materials = final?.final_materials_cents ?? receipts.get(jobId) ?? 0;
    if (final?.final_materials_cents == null) notes.push("Materials from uploaded receipts.");
    if (h.unclosedStops > 0) notes.push(`${h.unclosedStops} stop${h.unclosedStops === 1 ? "" : "s"} with no "Finished here" tap counted as nothing.`);
    if (h.openClockEntries > 0) notes.push(`${h.openClockEntries} clock entr${h.openClockEntries === 1 ? "y" : "ies"} still running, not counted.`);
    if (b.hours == null) notes.push("The estimate has no hours, so there is no budget to compare.");
    const snapshot = costSnapshot({
      revenueCents: b.revenueCents,
      budgetHours: b.hours,
      people: h.people.map((p) => ({ profileId: p.profileId, hours: p.hours, rateCents: rates.get(p.profileId) ?? null })),
      fallbackRateCents: fallbackCents,
      burdenPct: settings.laborBurdenPct,
      materialsCents: materials,
      otherCents: final?.final_other_cents ?? 0,
      overBudgetPct: settings.overBudgetPct,
    });
    if (snapshot.estimatedRates > 0) notes.push(`${snapshot.estimatedRates} ${snapshot.estimatedRates === 1 ? "person has" : "people have"} no pay rate; costed at the blended crew rate.`);
    return { jobId, hours: h, budgetHours: b.hours, revenueCents: b.revenueCents, snapshot, notes };
  });
}

/**
 * Writes the snapshot, and on a final one fills jobs.final_crew_hours when
 * nobody has entered it. A number a person entered at sign-off is theirs and
 * is never overwritten.
 */
export async function writeCostSnapshot(organizationId: string, jobId: string, final: boolean, settings: AutopilotSettings): Promise<JobCostReading | null> {
  const client = admin();
  const [reading] = await readJobCosts(organizationId, [jobId], settings, client);
  if (!reading) return null;
  const s = reading.snapshot;
  const { error } = await client.from("job_cost_snapshots").upsert(
    {
      organization_id: organizationId,
      job_id: jobId,
      computed_at: new Date().toISOString(),
      final,
      revenue_cents: reading.revenueCents,
      budget_hours: s.budgetHours,
      actual_hours: s.actualHours,
      travel_hours: reading.hours.travelHours,
      onsite_hours: reading.hours.onSiteHours,
      efficiency_pct: s.efficiencyPct,
      hours_variance_pct: s.hoursVariancePct,
      over_budget: s.overBudget,
      labor_cents: s.labourCents,
      materials_cents: s.materialsCents,
      other_cents: s.otherCents,
      gross_margin_cents: s.grossMarginCents,
      gross_margin_pct: s.grossMarginPct,
      revenue_per_crew_hour_cents: s.revenuePerCrewHourCents,
      people: reading.hours.people,
      notes: reading.notes,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;
  if (final && s.actualHours > 0) {
    await client.from("jobs").update({ final_crew_hours: s.actualHours }).eq("id", jobId).is("final_crew_hours", null);
  }
  return reading;
}
