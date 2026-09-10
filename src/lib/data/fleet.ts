import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getDebtInputs } from "@/lib/data/debt-plan";
import { DEFAULT_RESERVE } from "@/lib/debt-plan";
import {
  affordability,
  fleetWeeklyRiskCost,
  monthlySwap,
  rankRisk,
  tradeInCents,
  upfrontCents,
  type Affordability,
  type AssetKind,
  type AssetRisk,
  type Condition,
  type FleetAsset,
  type FleetTarget,
  type MonthlySwap,
  type TargetKind,
} from "@/lib/fleet";

/**
 * The fleet, the risk it carries, and when the next thing can be bought.
 *
 * The money half comes from the same place the debt plan reads, so "what we
 * can spend" means the same thing on both screens. Two numbers that both claim
 * to be spendable cash and disagree is worse than one number nobody trusts.
 */

export interface FleetBoard {
  assets: FleetAsset[];
  risks: AssetRisk[];
  targets: FleetTarget[];
  /** Expected breakdown cost per week across everything still in service. */
  weeklyRisk: number;
  swap: MonthlySwap;
  /** Spendable cash after the crew and the reserve, in cents. */
  spendableCents: number;
  /** What selling the things being replaced would add, in cents. */
  tradeInCents: number;
  /** Free cash added each week, in cents. Zero when nothing is known. */
  weeklyCents: number;
  /** When each unbought target can be collected, in priority order. */
  plan: { target: FleetTarget; when: Affordability }[];
  /** What could not be read, said plainly rather than shown as a zero. */
  missing: string[];
}

/**
 * How much of the last 90 days' takings to treat as free cash.
 *
 * A deliberate guess, and a conservative one. Money that came in is not money
 * spare — most of it went straight back out on materials, fuel and wages — so
 * a fifth is set aside as what a business could plausibly put towards a truck
 * without noticing. Wrong in a knowable direction beats a date built on
 * revenue, which would always arrive too early.
 */
const FREE_SHARE = 0.2;
const LOOKBACK_DAYS = 90;

export async function getFleetBoard(): Promise<FleetBoard> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const [{ data: assetRows }, { data: targetRows }] = await Promise.all([
    supabase
      .from("fleet_assets")
      .select(
        "id, name, kind, year, make, model, mileage, condition, breakdowns_12mo, last_breakdown_on, monthly_cost, resale_value, notes, retired_on"
      )
      .eq("organization_id", organizationId)
      .order("retired_on", { ascending: true, nullsFirst: true })
      .order("name"),
    supabase
      .from("fleet_targets")
      .select(
        "id, name, kind, cost_cents, deposit_cents, monthly_cents, replaces_asset_id, priority, url, notes, ordered_on, bought_on"
      )
      .eq("organization_id", organizationId)
      .order("bought_on", { ascending: true, nullsFirst: true })
      .order("priority"),
  ]);

  const assets: FleetAsset[] = (assetRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: (row.kind as AssetKind) ?? "other",
    year: row.year,
    make: row.make,
    model: row.model,
    mileage: row.mileage,
    condition: (row.condition as Condition) ?? "fair",
    breakdowns12mo: row.breakdowns_12mo ?? 0,
    lastBreakdownOn: row.last_breakdown_on,
    monthlyCost: row.monthly_cost == null ? null : Number(row.monthly_cost),
    resaleValue: row.resale_value == null ? null : Number(row.resale_value),
    notes: row.notes,
    retiredOn: row.retired_on,
  }));

  const targets: FleetTarget[] = (targetRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: (row.kind as TargetKind) ?? "other",
    costCents: row.cost_cents,
    depositCents: row.deposit_cents,
    monthlyCents: row.monthly_cents,
    replacesAssetId: row.replaces_asset_id,
    priority: row.priority ?? 100,
    url: row.url,
    notes: row.notes,
    orderedOn: row.ordered_on,
    boughtOn: row.bought_on,
  }));

  const missing: string[] = [];

  // Never fatal. A fleet page that will not load because Stripe is down is a
  // fleet page that stops being opened.
  const debt = await getDebtInputs().catch(() => null);
  if (!debt) missing.push("Couldn't read the bank and card balances.");
  else missing.push(...debt.missing);

  const cash = debt?.cash;
  const spendableCents = cash
    ? Math.round(Math.max(0, cash.inBank - cash.owedToCrew - DEFAULT_RESERVE) * 100)
    : 0;

  const weeklyCents = await weeklyFreeCash(organizationId).catch(() => 0);
  if (weeklyCents === 0) {
    missing.push("No takings in the last 90 days, so there is no date to work towards.");
  }

  const weeklyRisk = fleetWeeklyRiskCost(assets);
  const trade = tradeInCents(assets, targets);

  // Running, so the second thing is bought after the first rather than at the
  // same time out of the same money.
  let bank = spendableCents + trade;
  const plan: { target: FleetTarget; when: Affordability }[] = [];
  for (const target of targets.filter((t) => !t.boughtOn)) {
    const need = upfrontCents(target);
    const when = affordability({
      needCents: need,
      haveCents: bank,
      weeklyCents,
      riskPerWeekCents: Math.round(weeklyRisk * 100),
    });
    plan.push({ target, when });
    bank = Math.max(0, bank - need);
  }

  return {
    assets,
    risks: rankRisk(assets),
    targets,
    weeklyRisk,
    swap: monthlySwap(assets, targets),
    spendableCents,
    tradeInCents: trade,
    weeklyCents,
    plan,
    missing,
  };
}

/**
 * Free cash per week, from what actually landed.
 *
 * Payments received rather than work sold: an invoice nobody has paid cannot
 * be put towards a deposit, and a date built on one would arrive before the
 * money did.
 */
async function weeklyFreeCash(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

  const { data } = await supabase
    .from("payments")
    .select("amount_cents, surcharge_cents")
    .eq("organization_id", organizationId)
    .gte("received_at", since.toISOString());

  // The surcharge comes off. It was never the business's money -- it covers
  // the card fee -- and counting it would put a date on the calendar that the
  // bank balance never reaches.
  const totalCents = (data ?? []).reduce(
    (sum, row) => sum + (row.amount_cents ?? 0) - (row.surcharge_cents ?? 0),
    0
  );
  if (totalCents <= 0) return 0;
  return Math.round((totalCents * FREE_SHARE) / (LOOKBACK_DAYS / 7));
}
