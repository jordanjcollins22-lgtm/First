import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { opsState } from "@/lib/data/ops";
import { jobsWithOpenExceptions } from "@/lib/data/exceptions";
import { bottleneck, growthKpis, type Bottleneck, type GrowthInput, type Kpi } from "@/lib/growth";

/**
 * The Growth view's numbers, assembled from what the business already knows.
 *
 * Nothing new is computed here that the ops pulse does not already compute --
 * the evaluations rate, the weeks booked and the cash position are read off the
 * same assessment the Business screen uses, so the two screens can never
 * disagree about a number they both show. What this adds is the fifth
 * measurement, which nothing was tracking: how much of the business still runs
 * through one person.
 */

export interface OwnerWeek {
  weekStart: string;
  loggedMinutes: number;
  entries: number;
  topCategory: string | null;
  topCategoryMinutes: number;
  /** Decisions that week that only somebody owner-level could make. */
  ownerTouches: number;
}

/** How many weeks of money movement the profit figure covers. */
export const PROFIT_WINDOW_WEEKS = 12;

export async function ownerWeeks(weeks = 8): Promise<OwnerWeek[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const { data, error } = await supabase.rpc("owner_intervention_load", { org, weeks });
  if (error) throw error;

  return ((data ?? []) as unknown as {
    week_start: string;
    logged_minutes: number;
    entries: number;
    top_category: string | null;
    top_category_minutes: number;
    owner_touches: number;
  }[]).map((r) => ({
    weekStart: r.week_start,
    loggedMinutes: r.logged_minutes,
    entries: r.entries,
    topCategory: r.top_category,
    topCategoryMinutes: r.top_category_minutes,
    ownerTouches: r.owner_touches,
  }));
}

export interface GrowthView {
  kpis: Kpi[];
  bottleneck: Bottleneck;
  /** Eight weeks of owner time, for the one small chart this screen has. */
  weeks: OwnerWeek[];
  /** False when the viewer is not allowed the money, so the page can say so. */
  seesMoney: boolean;
  /** The owner's own number, echoed so the screen can show what it is judging against. */
  ownerHoursTarget: number;
}

export async function growthView(): Promise<GrowthView> {
  const [ops, weeks, load] = await Promise.all([
    opsState(),
    ownerWeeks(8).catch(() => [] as OwnerWeek[]),
    jobsWithOpenExceptions().catch(() => new Map()),
  ]);

  // Complete weeks only: the current week is always half a week and would
  // make every figure look like a collapse on a Tuesday.
  const complete = ops.pulse.weeks.slice(0, -1).slice(-PROFIT_WINDOW_WEEKS);
  const moneyIn = complete.reduce((sum, w) => sum + w.cashIn, 0);
  const moneyOut = complete.reduce((sum, w) => sum + w.cashOut, 0);

  const evaluations = ops.assessment.signals.find((s) => s.key === "evaluations");
  const booked = ops.assessment.signals.find((s) => s.key === "booked");

  // Last complete week, for the same reason.
  const lastWeek = weeks.length >= 2 ? weeks[weeks.length - 2] : null;

  let crewsStopped = 0;
  let changesAwaitingReview = 0;
  for (const entry of load.values()) {
    crewsStopped += entry.blocking;
    changesAwaitingReview += entry.awaitingReview;
  }

  const input: GrowthInput = {
    // Money the viewer is not allowed reads as not known rather than as zero,
    // which is the same answer the ops screen gives them.
    cash: ops.canSeeMoney ? ops.assessment.cash : null,
    cashFloor: ops.assessment.cashFloor,
    moneyIn: ops.canSeeMoney ? moneyIn : 0,
    moneyOut: ops.canSeeMoney ? moneyOut : 0,
    windowWeeks: complete.length || PROFIT_WINDOW_WEEKS,
    evaluationsPerWeek: typeof evaluations?.raw === "number" ? evaluations.raw : 0,
    evaluationsTargetPerWeek: ops.targets.evaluationsPerWeek,
    weeksBooked: typeof booked?.raw === "number" ? booked.raw : 0,
    weeksBookedTarget: ops.targets.weeksBookedAhead,
    // Nothing logged is null, never zero. A fabricated zero would make this
    // number improve for the wrong reason.
    ownerHoursLastWeek: lastWeek && lastWeek.entries > 0 ? lastWeek.loggedMinutes / 60 : null,
    ownerHoursTarget: ops.targets.ownerHoursPerWeek,
    ownerTouchesLastWeek: lastWeek?.ownerTouches ?? 0,
    ownerTopCategory: lastWeek?.topCategory ?? null,
    crewsStopped,
    changesAwaitingReview,
  };

  return {
    kpis: growthKpis(input),
    bottleneck: bottleneck(input),
    weeks,
    seesMoney: ops.canSeeMoney,
    ownerHoursTarget: ops.targets.ownerHoursPerWeek,
  };
}
