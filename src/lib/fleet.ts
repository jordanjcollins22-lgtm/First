/**
 * The odds of being stranded, and what waiting costs.
 *
 * This business runs on one truck and two trailers, all old. That is not a
 * maintenance problem, it is the largest single risk it carries: a truck that
 * dies on a Tuesday does not cost a repair bill, it costs the week's work and
 * every client who was promised that week.
 *
 * Two numbers come out of here, and the second is the one that decides
 * anything.
 *
 * The chance of a failure in the next N days. Rising every day, because that
 * is how wear works and because "it's fine so far" gets quieter the longer it
 * has been true.
 *
 * And what that chance costs per week of waiting. A probability is an argument
 * nobody acts on; "every week you wait has an expected cost of two hundred and
 * eighty dollars" is one somebody can weigh against a deposit.
 *
 * None of it is a diagnosis. It is an actuarial guess built from age, miles,
 * somebody's honest opinion of the condition, and what has already gone wrong,
 * and it is worth exactly what those four things are worth. It is here because
 * a rough number that gets looked at beats a precise one nobody has.
 */

export type AssetKind = "truck" | "trailer" | "mower" | "other";
export type Condition = "good" | "fair" | "poor" | "failing";

export const CONDITIONS: { key: Condition; label: string; blurb: string }[] = [
  { key: "good", label: "Good", blurb: "Nothing wrong with it." },
  { key: "fair", label: "Fair", blurb: "Age-appropriate niggles, nothing that stops it." },
  { key: "poor", label: "Poor", blurb: "Known faults being lived with." },
  { key: "failing", label: "On its last legs", blurb: "Expect it to let you down." },
];

export const ASSET_KINDS: { key: AssetKind; label: string }[] = [
  { key: "truck", label: "Truck" },
  { key: "trailer", label: "Trailer" },
  { key: "mower", label: "Mower" },
  { key: "other", label: "Something else" },
];

export interface FleetAsset {
  id: string;
  name: string;
  kind: AssetKind;
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  condition: Condition;
  /** Times it has stranded somebody in the last twelve months. */
  breakdowns12mo: number;
  lastBreakdownOn: string | null;
  monthlyCost: number | null;
  resaleValue: number | null;
  /** What it is rated to tow, in pounds. Null on trailers. */
  towRatingLb: number | null;
  notes: string | null;
  retiredOn: string | null;
}

/**
 * Roughly what one failure costs, all in.
 *
 * Not the repair. The tow, the repair, the day the crew stood around, and the
 * job that moved to next week and annoyed somebody. A truck is worse than a
 * trailer because a dead trailer can be worked around and a dead truck cannot.
 *
 * Deliberately named constants: when somebody says a tow is three hundred
 * round here, these are the three lines that change.
 */
export const FAILURE_COST: Record<AssetKind, number> = {
  truck: 1800,
  trailer: 700,
  mower: 500,
  other: 500,
};

/**
 * The baseline chance of a failure in a year, by condition.
 *
 * From somebody's opinion rather than a diagnostic, which is the only input
 * that exists. The gap between "poor" and "on its last legs" is deliberately
 * large: the difference between a known fault being lived with and a thing
 * expected to let you down is the difference the owner already feels.
 */
const YEARLY_BY_CONDITION: Record<Condition, number> = {
  good: 0.08,
  fair: 0.2,
  poor: 0.45,
  failing: 0.75,
};

/** Beyond this, another year adds nothing the condition has not already said. */
const AGE_CAP_YEARS = 25;
/** Miles at which a truck is doing well to be ordinary. */
const HIGH_MILES = 150_000;

/**
 * The chance this thing fails in the next year.
 *
 * Condition leads, because it is somebody looking at the actual vehicle. Age
 * and miles nudge it, and recorded breakdowns nudge it hardest — a truck that
 * has already stranded a crew twice is not a truck with a theoretical problem.
 *
 * Capped below 1. Nothing is certain to break, and a 100% that turns out fine
 * is how a model loses the reader for good.
 */
export function yearlyFailureChance(asset: FleetAsset, today = new Date()): number {
  let chance = YEARLY_BY_CONDITION[asset.condition] ?? YEARLY_BY_CONDITION.fair;

  const age = asset.year != null ? Math.max(0, today.getUTCFullYear() - asset.year) : 0;
  // Roughly two per cent a year, flattening off: the twentieth year is not
  // twice the tenth, whatever a straight line would say.
  chance += Math.min(age, AGE_CAP_YEARS) * 0.02;

  if (asset.mileage != null && asset.mileage > HIGH_MILES) {
    chance += Math.min(0.2, ((asset.mileage - HIGH_MILES) / 100_000) * 0.15);
  }

  // The strongest signal on the list, and the only one that is a fact rather
  // than an estimate.
  chance += Math.min(0.35, asset.breakdowns12mo * 0.15);

  return clamp(chance, 0.02, 0.95);
}

/**
 * The chance of a failure within so many days.
 *
 * Compounded from a constant daily hazard, which is what makes tomorrow worse
 * than today without anybody editing anything. It is the honest shape for
 * "every day it gets more likely": not because the truck ages overnight, but
 * because every day is another roll of the same dice and the chance of getting
 * through all of them keeps falling.
 */
export function failureChanceWithin(asset: FleetAsset, days: number, today = new Date()): number {
  if (days <= 0) return 0;
  const yearly = yearlyFailureChance(asset, today);
  const survivesADay = Math.pow(1 - yearly, 1 / 365);
  return 1 - Math.pow(survivesADay, days);
}

/** What another week of waiting is expected to cost, on this one thing. */
export function weeklyRiskCost(asset: FleetAsset, today = new Date()): number {
  const chance = failureChanceWithin(asset, 7, today);
  return round(chance * (FAILURE_COST[asset.kind] ?? FAILURE_COST.other));
}

/** The same across everything still in service. The number that argues. */
export function fleetWeeklyRiskCost(assets: readonly FleetAsset[], today = new Date()): number {
  return round(
    assets
      .filter((asset) => !asset.retiredOn)
      .reduce((sum, asset) => sum + weeklyRiskCost(asset, today), 0)
  );
}

/**
 * Which one to worry about, and how much.
 *
 * Ordered by what it would cost rather than by how likely it is, because a
 * trailer that is nearly certain to need a bearing is a smaller problem than a
 * truck that probably will not die but would take the week with it.
 */
export interface AssetRisk {
  asset: FleetAsset;
  yearly: number;
  in30Days: number;
  in90Days: number;
  weeklyCost: number;
}

export function rankRisk(assets: readonly FleetAsset[], today = new Date()): AssetRisk[] {
  return assets
    .filter((asset) => !asset.retiredOn)
    .map((asset) => ({
      asset,
      yearly: yearlyFailureChance(asset, today),
      in30Days: failureChanceWithin(asset, 30, today),
      in90Days: failureChanceWithin(asset, 90, today),
      weeklyCost: weeklyRiskCost(asset, today),
    }))
    .sort((a, b) => b.weeklyCost - a.weeklyCost || b.yearly - a.yearly);
}

// ---------------------------------------------------------------------------
// When the money is there
// ---------------------------------------------------------------------------

export type TargetKind = "truck" | "trailer" | "mower" | "service" | "other";

export interface FleetTarget {
  id: string;
  name: string;
  kind: TargetKind;
  costCents: number | null;
  depositCents: number | null;
  monthlyCents: number | null;
  replacesAssetId: string | null;
  priority: number;
  /** What the replacement is rated to tow, in pounds. */
  towRatingLb: number | null;
  url: string | null;
  notes: string | null;
  orderedOn: string | null;
  boughtOn: string | null;
}

export interface Affordability {
  /** What has to be found. */
  needCents: number;
  /** What is spendable today. */
  haveCents: number;
  /** Whether today is the day. */
  affordableNow: boolean;
  /** Weeks until it is, or null when nothing is coming in to close the gap. */
  weeks: number | null;
  /** The date that lands on, as an ISO day. Null for the same reason. */
  on: string | null;
  /** Expected cost of the breakdowns between now and then. */
  waitingCostCents: number;
}

/**
 * When this can actually be bought, and what waiting for it costs.
 *
 * Two questions people confuse. Can we afford it, and can we afford it without
 * being unable to make payroll on Friday — so what goes in as `haveCents` is
 * spendable cash after the crew and the reserve, not the bank balance.
 *
 * The waiting cost is the point of putting them together. A deposit eight
 * weeks away, against a truck that costs two hundred a week in expected
 * breakdowns, is sixteen hundred dollars of waiting -- which is the argument
 * for financing it sooner, and it is not visible from either number alone.
 */
export function affordability(input: {
  needCents: number;
  haveCents: number;
  /** Free cash the business adds each week, after everything. */
  weeklyCents: number;
  /** Expected breakdown cost per week, in cents, while waiting. */
  riskPerWeekCents: number;
  today?: Date;
}): Affordability {
  const today = input.today ?? new Date();
  const need = Math.max(0, Math.round(input.needCents));
  const have = Math.round(input.haveCents);
  const gap = need - have;

  if (gap <= 0) {
    return {
      needCents: need,
      haveCents: have,
      affordableNow: true,
      weeks: 0,
      on: isoDay(today),
      waitingCostCents: 0,
    };
  }

  // Nothing coming in is a real answer and has to read as one. A date invented
  // from a weekly figure of zero would be a date somebody plans around.
  if (input.weeklyCents <= 0) {
    return {
      needCents: need,
      haveCents: have,
      affordableNow: false,
      weeks: null,
      on: null,
      waitingCostCents: 0,
    };
  }

  const weeks = Math.ceil(gap / input.weeklyCents);
  const on = new Date(today.getTime());
  on.setUTCDate(on.getUTCDate() + weeks * 7);

  return {
    needCents: need,
    haveCents: have,
    affordableNow: false,
    weeks,
    on: isoDay(on),
    waitingCostCents: Math.round(weeks * Math.max(0, input.riskPerWeekCents)),
  };
}

/**
 * What a target needs found before it can be collected.
 *
 * The deposit where there is one, because that is the number that gets
 * somebody into the seat. Where nobody has said, the whole price, because a
 * plan built on a deposit nobody has agreed is a plan built on nothing.
 */
export function upfrontCents(target: FleetTarget): number {
  if (target.depositCents != null && target.depositCents > 0) return target.depositCents;
  return target.costCents ?? 0;
}

/**
 * What the fleet costs each month, before and after.
 *
 * The comparison somebody actually has to make, and the one that is hardest to
 * hold in your head: a payment on a new truck is not a new cost, it is a
 * swap for insurance, repairs and a trailer that is about to need a floor.
 */
export interface MonthlySwap {
  nowCents: number;
  afterCents: number;
  /** Positive means the new arrangement costs more each month. */
  differenceCents: number;
}

export function monthlySwap(
  assets: readonly FleetAsset[],
  targets: readonly FleetTarget[]
): MonthlySwap {
  const live = assets.filter((asset) => !asset.retiredOn);
  const nowCents = Math.round(
    live.reduce((sum, asset) => sum + (asset.monthlyCost ?? 0) * 100, 0)
  );

  const planned = targets.filter((target) => !target.boughtOn);
  const retiring = new Set(
    planned.map((target) => target.replacesAssetId).filter((id): id is string => Boolean(id))
  );

  const keptCents = Math.round(
    live
      .filter((asset) => !retiring.has(asset.id))
      .reduce((sum, asset) => sum + (asset.monthlyCost ?? 0) * 100, 0)
  );
  const addedCents = planned.reduce((sum, target) => sum + (target.monthlyCents ?? 0), 0);
  const afterCents = keptCents + addedCents;

  return { nowCents, afterCents, differenceCents: afterCents - nowCents };
}

/** What selling the things being replaced would put towards the deposit. */
export function tradeInCents(
  assets: readonly FleetAsset[],
  targets: readonly FleetTarget[]
): number {
  const retiring = new Set(
    targets
      .filter((target) => !target.boughtOn)
      .map((target) => target.replacesAssetId)
      .filter((id): id is string => Boolean(id))
  );
  return Math.round(
    assets
      .filter((asset) => retiring.has(asset.id) && !asset.retiredOn)
      .reduce((sum, asset) => sum + (asset.resaleValue ?? 0) * 100, 0)
  );
}

/**
 * A replacement that cannot do the job of the thing it replaces.
 *
 * The one mistake in a plan like this that is expensive to undo. Everything
 * else is a number that can be edited; a truck in the drive that will not pull
 * the trailer is a truck that has to be sold again at a loss.
 *
 * Only ever reported when both ratings are known. Guessing that an unstated
 * rating is zero would cry wolf on every trailer in the list, and a warning
 * that fires on everything is a warning nobody reads.
 */
export interface TowShortfall {
  target: FleetTarget;
  asset: FleetAsset;
  targetLb: number;
  assetLb: number;
  shortLb: number;
}

export function towShortfalls(
  assets: readonly FleetAsset[],
  targets: readonly FleetTarget[]
): TowShortfall[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const out: TowShortfall[] = [];

  for (const target of targets) {
    if (target.boughtOn || !target.replacesAssetId) continue;
    const asset = byId.get(target.replacesAssetId);
    if (!asset) continue;
    if (target.towRatingLb == null || asset.towRatingLb == null) continue;
    if (target.towRatingLb >= asset.towRatingLb) continue;

    out.push({
      target,
      asset,
      targetLb: target.towRatingLb,
      assetLb: asset.towRatingLb,
      shortLb: asset.towRatingLb - target.towRatingLb,
    });
  }

  return out.sort((a, b) => b.shortLb - a.shortLb);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A chance, said the way somebody would say it. */
export function percent(fraction: number): string {
  const shown = fraction * 100;
  if (shown > 0 && shown < 1) return "under 1%";
  return `${Math.round(shown)}%`;
}
