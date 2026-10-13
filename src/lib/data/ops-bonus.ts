import type { SupabaseClient } from "@supabase/supabase-js";

import { dateKeyIn, zonedToUtc } from "@/lib/time-zone";
import { addDays, weekStartOf, weeklyBonuses, type FinishedJobWeek, type PersonBonus } from "@/lib/ops/crew-bonus";
import { admin, ensureSettings } from "@/lib/data/ops-settings";
import { budgetHoursFor, jobHours } from "@/lib/data/ops-costing";

/**
 * The weekly crew bonus, worked out from the same hours job costing uses.
 *
 * A job counts in the week its last work day closed. Only jobs finished after
 * the bonus was switched on count, so turning it on never pays out for last
 * month. Rows are written as "accrued"; a row somebody has approved or paid
 * is never rewritten.
 */

/** Jobs whose last open work day closed inside [from, to). */
async function jobsFinishedBetween(client: SupabaseClient, organizationId: string, from: string, to: string, notBefore: string): Promise<string[]> {
  const { data } = await client
    .from("job_work_sessions")
    .select("job_id, closed_at")
    .eq("organization_id", organizationId)
    .eq("status", "done")
    .gte("closed_at", from < notBefore ? notBefore : from)
    .lt("closed_at", to);
  const touched = [...new Set(((data ?? []) as { job_id: string }[]).map((r) => r.job_id))];
  if (touched.length === 0) return [];
  const { data: all } = await client.from("job_work_sessions").select("job_id, status, closed_at").in("job_id", touched).neq("status", "cancelled");
  const byJob = new Map<string, { status: string; closed_at: string | null }[]>();
  for (const s of (all ?? []) as { job_id: string; status: string; closed_at: string | null }[]) byJob.set(s.job_id, [...(byJob.get(s.job_id) ?? []), s]);
  return touched.filter((id) => {
    const list = byJob.get(id) ?? [];
    if (!list.every((s) => s.status === "done")) return false;
    const last = list.map((s) => s.closed_at ?? "").sort().pop() ?? "";
    return last >= from && last < to;
  });
}

export async function bonusesForWeek(organizationId: string, weekStart: string, client: SupabaseClient = admin()): Promise<{ rows: PersonBonus[]; enabled: boolean; perMemberCents: number }> {
  const { settings } = await ensureSettings(organizationId, client);
  const rule = { enabled: settings.crewBonusEnabled, perMemberCents: settings.crewBonusPerMemberCents };
  // Midnight to midnight on the business's clock, whatever the season.
  const from = zonedToUtc(weekStart, "00:00").toISOString();
  const to = zonedToUtc(addDays(weekStart, 7), "00:00").toISOString();
  // Only what finished after the bonus was turned on. While it is off there
  // is no start, and the preview uses the week itself.
  const notBefore = settings.crewBonusStartedAt ?? from;
  const jobIds = await jobsFinishedBetween(client, organizationId, from, to, notBefore);
  if (jobIds.length === 0) return { rows: [], ...rule };
  const [hours, budgets] = await Promise.all([jobHours(client, organizationId, jobIds), budgetHoursFor(client, jobIds)]);
  const week: FinishedJobWeek[] = jobIds.map((id) => {
    const h = hours.get(id)!;
    return { jobId: id, budgetHours: budgets.get(id)?.hours ?? null, actualHours: h.totalHours, crew: h.people.filter((p) => p.hours > 0).map((p) => p.profileId) };
  });
  return { rows: weeklyBonuses(rule, week), ...rule };
}

/** Monday's run: settle last week. */
export async function runWeeklyBonus(organizationId: string, now: Date = new Date()): Promise<{ week: string; accrued: number; total: number }> {
  const client = admin();
  const { settings, ready } = await ensureSettings(organizationId, client);
  const week = addDays(weekStartOf(dateKeyIn(now)), -7);
  if (!ready || !settings.crewBonusEnabled || !settings.crewBonusStartedAt) return { week, accrued: 0, total: 0 };

  const { rows } = await bonusesForWeek(organizationId, week, client);
  const { data: settled } = await client
    .from("crew_bonus_weeks")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .eq("week_start", week)
    .in("status", ["approved", "paid"]);
  const locked = new Set(((settled ?? []) as { profile_id: string }[]).map((r) => r.profile_id));
  const writable = rows.filter((r) => !locked.has(r.profileId));
  if (writable.length > 0) {
    const { error } = await client.from("crew_bonus_weeks").upsert(
      writable.map((r) => ({
        organization_id: organizationId,
        week_start: week,
        profile_id: r.profileId,
        job_ids: r.jobIds,
        budget_hours: r.budgetHours,
        actual_hours: r.actualHours,
        amount_cents: r.amountCents,
        status: "accrued",
        reason: r.reason,
        computed_at: now.toISOString(),
      })),
      { onConflict: "organization_id,week_start,profile_id" }
    );
    if (error) throw error;
  }
  return { week, accrued: writable.filter((r) => r.earned).length, total: writable.reduce((s, r) => s + r.amountCents, 0) };
}
