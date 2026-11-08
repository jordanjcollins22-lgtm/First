/**
 * The business's other numbers: the ones the app already runs on that are
 * not part of the project pricing report's own variables. Listed on Admin ›
 * Variables, read only, with where each lives and where (if anywhere) it is
 * already edited, so nothing that sets a price or somebody's pay is hidden
 * in the code without being on that page.
 *
 * Moving each feature to read from Admin › Variables is later work; this is
 * the list of what is left.
 */

import { PRICING_EQUATION } from "@/lib/forward-pricing";
import { GROSS_PROFIT_TARGET } from "@/lib/gross-profit";
import { WORKDAY_HOURS } from "@/lib/job-estimate";
import { POOL_PCT, SHARE_PCT } from "@/lib/commission-split";
import { DEFAULT_SALT_SETTINGS } from "@/lib/salt";
import { DEFAULT_DIVISION_TARGETS } from "@/lib/sales/divisions";
import { DEFAULT_FORMULA_TOLERANCE } from "@/lib/sales/price-guardrails";
import { DEFAULT_SPEED_TARGET_HOURS } from "@/lib/sales/speed-to-proposal";
import { MIN_GOOD_SAVING } from "@/lib/sales/good-better-best";
import { MHIC_DEPOSIT_CAP } from "@/lib/sales/mhic";
import { DEFAULT_PHOTO_QUOTE_LINE } from "@/lib/photo-quote";
import { DEFAULT_TARGETS } from "@/lib/ops";
import { AREA_CREW_LIMIT } from "@/lib/area-work";

export interface RegisteredVariable {
  group: "Pay" | "Commissions" | "Pricing" | "Sales" | "Operations";
  label: string;
  value: string;
  /** The file (and constant) it lives in. */
  where: string;
  /** Where it is changed in the app today; null when only in the code. */
  editAt: string | null;
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function otherVariables(): RegisteredVariable[] {
  const eq = PRICING_EQUATION;
  const salt = DEFAULT_SALT_SETTINGS;
  return [
    { group: "Pay", label: "Lead pay (forward pricing, hourly)", value: `${usd(eq.leadRateCents)}/h`, where: "src/lib/forward-pricing.ts PRICING_EQUATION", editAt: "Admin › Production rates" },
    { group: "Pay", label: "Technician pay (forward pricing, hourly)", value: `${usd(eq.technicianRateCents)}/h`, where: "src/lib/forward-pricing.ts PRICING_EQUATION", editAt: "Admin › Production rates" },
    { group: "Pay", label: "Salt crew cost", value: `${usd(salt.crewCostPerHourCents)}/h`, where: "src/lib/salt.ts DEFAULT_SALT_SETTINGS", editAt: "Admin › Salt route" },
    { group: "Commissions", label: "Commission pool", value: `${POOL_PCT}% of the project`, where: "src/lib/commission-split.ts POOL_PCT", editAt: null },
    { group: "Commissions", label: "Pool shares: account manager / evaluator / affiliate", value: `${SHARE_PCT.account_manager}% / ${SHARE_PCT.evaluator}% / ${SHARE_PCT.affiliate}%`, where: "src/lib/commission-split.ts SHARE_PCT", editAt: null },
    {
      group: "Commissions",
      label: "Marketing channel budget (the affiliate share, CHANNEL_PCT) and its start date (COMMISSIONS_FROM 2026-11-08)",
      value: `${SHARE_PCT.affiliate}%`,
      where: "src/lib/channel-budget.ts, on branch claude/marketing-affiliate-cut (not merged here)",
      editAt: null,
    },
    { group: "Commissions", label: "Account manager's own pre-pool rate", value: "per person", where: "profiles.commission_pct", editAt: "Team" },
    { group: "Commissions", label: "Forward pricing allocations: affiliate / evaluator / account manager / reserve", value: `${pct(eq.affiliate)} / ${pct(eq.evaluator)} / ${pct(eq.accountManager)} / ${pct(eq.reserve)}`, where: "src/lib/forward-pricing.ts PRICING_EQUATION", editAt: null },
    { group: "Pricing", label: "Gross profit target (forward pricing and site map floor)", value: pct(GROSS_PROFIT_TARGET), where: "src/lib/gross-profit.ts GROSS_PROFIT_TARGET, forward-pricing.ts grossProfit", editAt: null },
    { group: "Pricing", label: "Forward pricing workday / time on the job", value: `${eq.workdayHours} h / ${pct(eq.onJobShare)}`, where: "src/lib/forward-pricing.ts PRICING_EQUATION", editAt: null },
    { group: "Pricing", label: "Site map estimate workday", value: `${WORKDAY_HOURS} h`, where: "src/lib/job-estimate.ts WORKDAY_HOURS", editAt: null },
    { group: "Pricing", label: "Site map fallback drive / pickup", value: "30 min / 30 min", where: "src/lib/job-estimate.ts buildEstimate", editAt: null },
    { group: "Pricing", label: "Price multiplier on the rate card", value: "per business", where: "organizations.price_multiplier", editAt: "Settings" },
    { group: "Pricing", label: "Salt: overhead, multiplier, bag costs", value: `${usd(salt.overheadPerCrewHourCents)}/crew h, ×${salt.multiplier}, ${usd(salt.bagCostCents)} a bag`, where: "src/lib/salt.ts DEFAULT_SALT_SETTINGS", editAt: "Admin › Salt route" },
    {
      group: "Sales",
      label: "Autopilot margin floors: maintenance / install / snow / irrigation",
      value: `${pct(DEFAULT_DIVISION_TARGETS.maintenance)} / ${pct(DEFAULT_DIVISION_TARGETS.install)} / ${pct(DEFAULT_DIVISION_TARGETS.snow)} / ${pct(DEFAULT_DIVISION_TARGETS.irrigation)}`,
      where: "src/lib/sales/divisions.ts DEFAULT_DIVISION_TARGETS → sales_autopilot_settings",
      editAt: "Sales › Pipeline › Automatic",
    },
    { group: "Sales", label: "Autopilot formula tolerance", value: pct(DEFAULT_FORMULA_TOLERANCE), where: "src/lib/sales/price-guardrails.ts → sales_autopilot_settings", editAt: "Sales › Pipeline › Automatic" },
    { group: "Sales", label: "Speed to proposal target", value: `${DEFAULT_SPEED_TARGET_HOURS} h`, where: "src/lib/sales/speed-to-proposal.ts → sales_autopilot_settings", editAt: "Sales › Pipeline › Automatic" },
    { group: "Sales", label: "Photo quote line", value: `$${DEFAULT_PHOTO_QUOTE_LINE.toLocaleString("en-US")}`, where: "src/lib/photo-quote.ts → sales_autopilot_settings", editAt: "Sales › Pipeline › Automatic" },
    { group: "Sales", label: "Good / Better / Best: smallest saving on Good", value: pct(MIN_GOOD_SAVING), where: "src/lib/sales/good-better-best.ts", editAt: null },
    { group: "Sales", label: "MHIC deposit cap (Maryland law)", value: pct(MHIC_DEPOSIT_CAP), where: "src/lib/sales/mhic.ts", editAt: null },
    { group: "Sales", label: "Tip suggestions", value: "10/15/20%, or $20/$40/$60 over $1,500", where: "src/lib/tips.ts", editAt: null },
    { group: "Operations", label: "Weeks booked ahead / evaluations a week / close rate", value: `${DEFAULT_TARGETS.weeksBookedAhead} / ${DEFAULT_TARGETS.evaluationsPerWeek} / ${pct(DEFAULT_TARGETS.closeRate)}`, where: "src/lib/ops.ts DEFAULT_TARGETS → ops_targets", editAt: "Operations autopilot" },
    { group: "Operations", label: "Marketing share", value: pct(DEFAULT_TARGETS.marketingShare), where: "src/lib/ops.ts DEFAULT_TARGETS → ops_targets", editAt: "Operations autopilot" },
    { group: "Operations", label: "Most crew on one area", value: String(AREA_CREW_LIMIT), where: "src/lib/area-work.ts AREA_CREW_LIMIT", editAt: null },
    { group: "Operations", label: "Late fee / days sales outstanding target", value: "1.5% after 15 days (off) / 30 days", where: "finance_settings (migration 0363)", editAt: "Money" },
  ];
}
