import {
  CONTRACT_TIERS,
  analysesPerDayForGoal,
  observedWinRate,
  planForGoal,
  revenueRunRate,
  sizeStandardRunway,
  type GoalPlan,
} from "./goals";
import type { Db } from "./pipeline/context";
import type { CompanyProfile } from "./types";

export interface GoalStatus {
  target: number;
  runRate: number;
  activeContracts: number;
  winRate: number;
  winRateObserved: boolean;
  avgAnnualValue: number;
  avgAnnualValueSource: string;
  plan: GoalPlan;
  tiers: Array<(typeof CONTRACT_TIERS)[number] & { plan: GoalPlan }>;
  proposalsThisMonth: number;
  effectiveProposalTarget: number;
  effectiveAnalysesPerDay: number;
  sizeRunway: ReturnType<typeof sizeStandardRunway>;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Where we stand against the monthly revenue goal, from live data:
 * active contracts → run-rate, decided bids → win rate, what we're actually
 * bidding → average contract size → required proposal volume.
 */
export async function getGoalStatus(db: Db, profile: CompanyProfile, now = new Date()): Promise<GoalStatus> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString();
  const [contracts, won, lost, submitted, bidding] = await Promise.all([
    db.from("govcon_contracts").select("annual_value, start_date, end_date, status"),
    db.from("govcon_bids").select("id", { count: "exact", head: true }).eq("status", "won"),
    db.from("govcon_bids").select("id", { count: "exact", head: true }).eq("status", "lost"),
    db.from("govcon_bids").select("id", { count: "exact", head: true }).gte("submitted_at", monthStart),
    db
      .from("govcon_opportunities")
      .select("expected_annual_value")
      .in("status", ["sourcing", "awaiting_quotes", "ready", "submitted", "won", "lost"])
      .gte("updated_at", since)
      .not("expected_annual_value", "is", null)
      .limit(500),
  ]);

  const active = (contracts.data ?? []).map((c) => ({
    annualValue: Number(c.annual_value),
    startDate: c.start_date,
    endDate: c.end_date,
    status: c.status,
  }));
  const decided = (won.count ?? 0) + (lost.count ?? 0);
  const winRate = observedWinRate(won.count ?? 0, lost.count ?? 0);
  const pipelineMedian = median((bidding.data ?? []).map((r) => Number(r.expected_annual_value)).filter((n) => n > 0));
  const avgAnnualValue = pipelineMedian ?? CONTRACT_TIERS[0].avgAnnualValue;
  const plan = planForGoal({ monthlyRevenueTarget: profile.monthlyRevenueTarget, avgAnnualContractValue: avgAnnualValue, winRate });

  const effectiveProposalTarget = profile.autoScale ? Math.max(profile.monthlyProposalTarget, plan.proposalsPerMonth) : profile.monthlyProposalTarget;
  const effectiveAnalysesPerDay = profile.autoScale
    ? Math.max(profile.maxAnalysesPerDay, analysesPerDayForGoal(effectiveProposalTarget, 0.4, profile.maxAnalysesPerDayCeiling))
    : profile.maxAnalysesPerDay;

  return {
    target: profile.monthlyRevenueTarget,
    runRate: revenueRunRate(active, now),
    activeContracts: active.filter((c) => c.status === "active").length,
    winRate,
    winRateObserved: decided >= 10,
    avgAnnualValue,
    avgAnnualValueSource: pipelineMedian ? "median of what we're bidding (last 120 days)" : "default small set-aside size",
    plan,
    tiers: CONTRACT_TIERS.map((t) => ({ ...t, plan: planForGoal({ monthlyRevenueTarget: profile.monthlyRevenueTarget, avgAnnualContractValue: t.avgAnnualValue, winRate }) })),
    proposalsThisMonth: submitted.count ?? 0,
    effectiveProposalTarget,
    effectiveAnalysesPerDay,
    sizeRunway: sizeStandardRunway({ annualRevenueAtTarget: profile.monthlyRevenueTarget * 12 }),
  };
}
