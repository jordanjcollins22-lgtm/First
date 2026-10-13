/**
 * What a finished job really cost, set against what it was priced on.
 *
 * Budgeted hours come off the estimate the client accepted. Actual hours come
 * off the crew's own taps (see crew-hours.ts). Labour is each person's hours
 * times their own pay rate from their profile; a person with no rate is costed
 * at the blended crew rate the pricing uses, and the snapshot says how many
 * were, because an estimated rate is a weaker number than a real one.
 *
 * Whole cents throughout, for the reason job-costing.ts gives: dollars as
 * floats make two ways of totalling one job disagree by a cent.
 */

export interface CostPerson {
  profileId: string;
  hours: number;
  /** Their own hourly pay in cents, or null when none is set. */
  rateCents: number | null;
}

export interface CostInput {
  /** What the client agreed to pay, after discount. */
  revenueCents: number;
  /** Crew-hours the job was priced at. Null when the estimate says nothing. */
  budgetHours: number | null;
  people: CostPerson[];
  /** Used for anybody with no rate of their own. */
  fallbackRateCents: number;
  /** Payroll tax and insurance on top of wages, as a percentage. 0 by default. */
  burdenPct: number;
  materialsCents: number;
  otherCents: number;
  /** A job this far over its hours is flagged. 10 means 10%. */
  overBudgetPct: number;
}

export interface CostSnapshot {
  budgetHours: number | null;
  actualHours: number;
  /** Budget ÷ actual, as a percentage. Over 100 is under budget. */
  efficiencyPct: number | null;
  /** How far over (positive) or under (negative) the budget, as a percentage. */
  hoursVariancePct: number | null;
  labourCents: number;
  materialsCents: number;
  otherCents: number;
  directCostCents: number;
  grossMarginCents: number;
  /** Null when there is no revenue to take a margin of. */
  grossMarginPct: number | null;
  /** Null when nobody logged any hours. */
  revenuePerCrewHourCents: number | null;
  overBudget: boolean;
  /** People costed at the fallback rate because they have none of their own. */
  estimatedRates: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function labourCents(people: readonly CostPerson[], fallbackRateCents: number, burdenPct = 0): { cents: number; estimatedRates: number } {
  let cents = 0;
  let estimatedRates = 0;
  for (const p of people) {
    if (!(p.hours > 0)) continue;
    const rate = p.rateCents != null && p.rateCents > 0 ? p.rateCents : fallbackRateCents;
    if (!(p.rateCents != null && p.rateCents > 0)) estimatedRates++;
    cents += p.hours * rate;
  }
  const burden = Math.max(0, burdenPct) / 100;
  return { cents: Math.round(cents * (1 + burden)), estimatedRates };
}

export function costSnapshot(input: CostInput): CostSnapshot {
  const actualHours = round2(input.people.reduce((s, p) => s + Math.max(0, p.hours), 0));
  const budget = input.budgetHours != null && input.budgetHours > 0 ? round2(input.budgetHours) : null;
  const labour = labourCents(input.people, input.fallbackRateCents, input.burdenPct);
  const materials = Math.max(0, Math.round(input.materialsCents));
  const other = Math.max(0, Math.round(input.otherCents));
  const direct = labour.cents + materials + other;
  const revenue = Math.max(0, Math.round(input.revenueCents));
  const margin = revenue - direct;

  const efficiencyPct = budget != null && actualHours > 0 ? round1((budget / actualHours) * 100) : null;
  const hoursVariancePct = budget != null && actualHours > 0 ? round1(((actualHours - budget) / budget) * 100) : null;

  return {
    budgetHours: budget,
    actualHours,
    efficiencyPct,
    hoursVariancePct,
    labourCents: labour.cents,
    materialsCents: materials,
    otherCents: other,
    directCostCents: direct,
    grossMarginCents: margin,
    grossMarginPct: revenue > 0 ? round1((margin / revenue) * 100) : null,
    revenuePerCrewHourCents: actualHours > 0 ? Math.round(revenue / actualHours) : null,
    overBudget: hoursVariancePct != null && hoursVariancePct > input.overBudgetPct,
    estimatedRates: labour.estimatedRates,
  };
}

/** Live, for the crew lead: how much of the budget is left. Never money. */
export interface BudgetMeter {
  budgetHours: number | null;
  usedHours: number;
  remainingHours: number | null;
  /** 0–100+, for the bar. Null with no budget. */
  usedPct: number | null;
  tone: "good" | "warn" | "over" | "unknown";
  line: string;
}

export function budgetMeter(budgetHours: number | null, usedHours: number): BudgetMeter {
  const used = round1(Math.max(0, usedHours));
  if (budgetHours == null || !(budgetHours > 0)) {
    return { budgetHours: null, usedHours: used, remainingHours: null, usedPct: null, tone: "unknown", line: `${used}h used. No hours budgeted on this job.` };
  }
  const budget = round1(budgetHours);
  const remaining = round1(budget - used);
  const pct = Math.round((used / budget) * 100);
  const tone: BudgetMeter["tone"] = pct > 100 ? "over" : pct >= 85 ? "warn" : "good";
  const line =
    remaining >= 0
      ? `${remaining}h left of ${budget}h budgeted.`
      : `${Math.abs(remaining)}h over the ${budget}h budgeted.`;
  return { budgetHours: budget, usedHours: used, remainingHours: remaining, usedPct: pct, tone, line };
}
