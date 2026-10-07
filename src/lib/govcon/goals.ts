/**
 * Revenue goal engine. Turns "$X per month" into the pipeline volume needed
 * to get there, and tracks progress from won contracts.
 *
 *   active contracts needed = (monthly target × 12) / avg annual contract value
 *   wins per month          = active contracts / (avg contract years × 12)
 *   proposals per month     = wins per month / win rate
 *
 * Defaults come from FY2025 USAspending data for our trades (see
 * docs/govcon/README.md → "Hitting the revenue goal").
 */

export const DEFAULT_WIN_RATE = 0.075; // 5-10% is typical for new primes
export const DEFAULT_CONTRACT_YEARS = 3; // base + options, as actually exercised
/** Award-to-revenue lag: proposal → award → start. */
export const DEFAULT_START_LAG_MONTHS = 2;

/** Contract-size tiers the plan compares. Annual values from FY25 averages. */
export const CONTRACT_TIERS = [
  {
    key: "small",
    label: "Small set-asides ($25k–$350k)",
    avgAnnualValue: 75_000,
    note: "Video playbook. No 50% limit on SB set-asides ≤ $350k. Huge volume needed.",
  },
  {
    key: "mid",
    label: "Mid-size ($350k–$2M)",
    avgAnnualValue: 600_000,
    note: "50% limit applies on SB set-asides (use small, self-performing subs); past performance starts to matter.",
  },
  {
    key: "large",
    label: "Large / facilities support ($2M+)",
    avgAnnualValue: 2_500_000,
    note: "Base-operations & facilities support (NAICS 561210, $47M size standard). Needs past performance, bonding and staff.",
  },
] as const;

export interface GoalPlanInput {
  monthlyRevenueTarget: number;
  avgAnnualContractValue: number;
  winRate?: number;
  contractYears?: number;
}

export interface GoalPlan {
  annualTarget: number;
  activeContractsNeeded: number;
  winsPerMonth: number;
  proposalsPerMonth: number;
  /** Months of steady winning before the backlog reaches the target. */
  monthsToTarget: number;
}

export function planForGoal(input: GoalPlanInput): GoalPlan {
  const winRate = input.winRate ?? DEFAULT_WIN_RATE;
  const years = input.contractYears ?? DEFAULT_CONTRACT_YEARS;
  const annualTarget = input.monthlyRevenueTarget * 12;
  const activeContractsNeeded = annualTarget / Math.max(1, input.avgAnnualContractValue);
  // Contracts roll off after `years`, so steady state needs this many new wins a month.
  const winsPerMonth = activeContractsNeeded / (years * 12);
  return {
    annualTarget,
    activeContractsNeeded: Math.ceil(activeContractsNeeded),
    winsPerMonth: Math.ceil(winsPerMonth * 10) / 10,
    proposalsPerMonth: Math.ceil(winsPerMonth / winRate),
    // Backlog fills linearly at the steady-state win pace, so it takes about
    // one contract term to reach the target if you start at that pace, plus
    // the time from proposal to contract start.
    monthsToTarget: Math.ceil(years * 12 + DEFAULT_START_LAG_MONTHS),
  };
}

export interface ActiveContract {
  annualValue: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

/** Monthly revenue run-rate from contracts in performance today. */
export function revenueRunRate(contracts: ActiveContract[], now = new Date()): number {
  const t = now.getTime();
  return (
    contracts
      .filter((c) => c.status === "active")
      .filter((c) => (!c.startDate || Date.parse(c.startDate) <= t) && (!c.endDate || Date.parse(c.endDate) >= t))
      .reduce((sum, c) => sum + c.annualValue, 0) / 12
  );
}

/** Observed win rate once there's enough history; otherwise the default. */
export function observedWinRate(won: number, lost: number, minDecisions = 10): number {
  const decided = won + lost;
  return decided >= minDecisions ? Math.max(0.01, won / decided) : DEFAULT_WIN_RATE;
}

/**
 * SBA size standards (13 CFR 121.201, average annual receipts) for our trades.
 * Small status is judged on the 5-year average of receipts.
 */
export const SIZE_STANDARDS: Record<string, { label: string; receipts: number }> = {
  "561730": { label: "Landscaping", receipts: 9_500_000 },
  "561790": { label: "Other services to buildings (pressure washing, snow)", receipts: 9_000_000 },
  "561740": { label: "Carpet & upholstery cleaning", receipts: 8_500_000 },
  "561720": { label: "Janitorial", receipts: 22_000_000 },
  "561710": { label: "Pest control", receipts: 17_500_000 },
  "561210": { label: "Facilities support", receipts: 47_000_000 },
  "562111": { label: "Solid waste collection", receipts: 47_000_000 },
  "238220": { label: "Plumbing & HVAC contractors", receipts: 19_000_000 },
  "238210": { label: "Electrical contractors", receipts: 19_000_000 },
  "238160": { label: "Roofing contractors", receipts: 19_000_000 },
  "238320": { label: "Painting contractors", receipts: 19_000_000 },
  "238990": { label: "All other specialty trades", receipts: 19_000_000 },
  "236220": { label: "Commercial building construction", receipts: 45_000_000 },
};

/**
 * Years until the company's 5-year average receipts pass each size standard,
 * assuming receipts ramp linearly to `annualRevenueAtTarget` over
 * `rampYears` and stay there. After that, SB set-asides in that NAICS are
 * closed — the plan has to shift to unrestricted work.
 */
export function sizeStandardRunway(input: {
  priorAnnualReceipts?: number[]; // most recent last
  annualRevenueAtTarget: number;
  rampYears?: number;
}): Array<{ naics: string; label: string; receipts: number; yearsUntilOtherThanSmall: number | null }> {
  const ramp = Math.max(1, input.rampYears ?? 3);
  const history = [...(input.priorAnnualReceipts ?? [])];
  const projected: number[] = [];
  for (let y = 1; y <= 15; y++) projected.push(input.annualRevenueAtTarget * Math.min(1, y / ramp));
  const series = [...history, ...projected];
  const start = history.length;

  return Object.entries(SIZE_STANDARDS).map(([naics, s]) => {
    let years: number | null = null;
    for (let i = start; i < series.length; i++) {
      const window = series.slice(Math.max(0, i - 4), i + 1);
      const avg = window.reduce((a, b) => a + b, 0) / 5; // SBA divides by 5 even for younger firms with 5 yrs of data
      if (avg > s.receipts) {
        years = i - start + 1;
        break;
      }
    }
    return { naics, label: s.label, receipts: s.receipts, yearsUntilOtherThanSmall: years };
  });
}

/**
 * Analysis-queue priority: bid score plus a bonus for contract size, so
 * the limited daily AI reads go where the revenue is. +0 at $50k/yr,
 * +10 at $500k, +20 at $5M; small jobs lose up to 10.
 */
export function priorityScore(score: number, expectedAnnualValue: number | null): number {
  if (!expectedAnnualValue || expectedAnnualValue <= 0) return score;
  const bonus = Math.max(-10, Math.min(25, 10 * Math.log10(expectedAnnualValue / 50_000)));
  return Math.round(score + bonus);
}

/** Daily AI-analysis budget needed to produce the required proposal volume. */
export function analysesPerDayForGoal(proposalsPerMonth: number, analysisToProposalRate = 0.4, ceiling = 40): number {
  return Math.min(ceiling, Math.max(4, Math.ceil(proposalsPerMonth / 30 / analysisToProposalRate)));
}
