/**
 * What the business costs to keep open, worked out from the bank.
 *
 * The overhead these prices are built on used to be five round numbers
 * somebody typed from memory: rent 2,700, insurance 300, utilities 650. Close,
 * as it turns out, but close is not the same as true, and nobody could tell
 * which of the five was wrong or by how much. Every one of them is in the
 * transactions already.
 *
 * So it is derived, and derived means it moves on its own. The rent goes up in
 * March and the number the quotes are built on goes up in March, without
 * anybody remembering to edit anything. That is the whole argument for taking
 * the typing away.
 *
 * Grouped, because a single figure is not something anybody can act on. "Four
 * and a half thousand a month" is a fact; "two and a half of that is the unit
 * and five hundred is software" is a decision.
 */

import type { RecurringCharge } from "@/lib/recurring";

export type OverheadGroup =
  | "premises"
  | "vehicles"
  | "insurance"
  | "power"
  | "water"
  | "phone"
  | "software"
  | "finance"
  | "other";

export const GROUP_LABEL: Record<OverheadGroup, string> = {
  premises: "Premises",
  vehicles: "Vehicles",
  insurance: "Insurance",
  power: "Gas and electricity",
  water: "Water and waste",
  phone: "Phone and internet",
  software: "Software and subscriptions",
  finance: "Bank and finance",
  other: "Everything else",
};

/**
 * What a group is worth knowing for, where it is not obvious.
 *
 * Utilities used to be one bucket with the phone bill in it, which made the
 * number useless: gas and electricity move with the weather and the work, the
 * phone bill does not, and a single figure covering both tells you nothing
 * about either. And rent here is not only rent — the landlord bills the water
 * with it some months — so the premises line is a bundle and should read as
 * one rather than as a clean number.
 */
export const GROUP_NOTE: Partial<Record<OverheadGroup, string>> = {
  premises: "Rent, and whatever the landlord bundles into it.",
  power: "Moves with the weather and how much is running.",
  water: "Sometimes billed by the landlord with the rent instead.",
};

/**
 * The order they are shown in: biggest and least negotiable first.
 *
 * Deliberately not sorted by amount. The list is read to find something to
 * cut, and the things at the top are the things you cannot cut — so a reader
 * scans past them to the software, which is where the decisions are.
 */
export const GROUP_ORDER: OverheadGroup[] = [
  "premises",
  "vehicles",
  "insurance",
  "power",
  "water",
  "phone",
  "software",
  "finance",
  "other",
];

const PREMISES = /\b(?:rent|rentals?|lease|leasing|storage|yard|property manage|realty|apartments?)\b/i;
const VEHICLES = /\b(?:auto|vehicle|truck|fleet|fuel|gas ?station|dmv|registration|toll)\b/i;
const INSURANCE = /\b(?:insur|property ?& ?cas|state farm|geico|progressive|liberty mutual|premium)\b/i;
// Gas and electricity arrive on one bill from one supplier, so they are one
// group. Splitting them is not something the bank feed can do.
const POWER = /\b(?:gas ?(?:and|&) ?electric|electric|power|bge|baltimore gas|pepco|delmarva|energy)\b/i;
const WATER = /\b(?:water|sewer|sewage|waste|refuse|sanitation|trash)\b/i;
const PHONE = /\b(?:comcast|verizon|xfinity|t-?mobile|at&t|sprint|internet|broadband|wireless|phone|mobile)\b/i;
const FINANCE = /\b(?:interest|statement fee|annual fee|overdraft|service charge|late fee|bank)\b/i;

/**
 * Which bucket a charge falls in.
 *
 * The bank's own category leads where it says something useful, and the
 * merchant name settles the rest. Neither alone is enough: Plaid files the
 * rent under "Other" and the landlord's name is the only clue, while a card
 * fee has no name worth reading and a perfect category.
 */
export function groupFor(
  charge: Pick<RecurringCharge, "label" | "kind">,
  category?: string | null,
  /** What somebody said it is. Beats every guess below, because they know. */
  chosen?: OverheadGroup | null
): OverheadGroup {
  if (chosen) return chosen;
  const name = charge.label;

  // Vehicles before premises, because "auto lease" contains "lease" and a
  // truck payment filed under rent is a breakdown nobody can act on.
  if (INSURANCE.test(name)) return "insurance";
  if (VEHICLES.test(name)) return "vehicles";
  if (PREMISES.test(name)) return "premises";
  if (FINANCE.test(name)) return "finance";
  // Phone before power: "Verizon" is a phone bill and contains none of the
  // energy words, but a supplier named for a region can match both.
  if (PHONE.test(name)) return "phone";
  if (POWER.test(name)) return "power";
  if (WATER.test(name)) return "water";

  const bank = (category ?? "").toUpperCase();
  // The bank lumps rent, power, water and the phone into one category, so it
  // can only ever be the fallback for a name that said nothing.
  if (bank === "RENT_AND_UTILITIES") return "other";
  if (bank === "BANK_FEES") return "finance";
  if (bank === "TRANSPORTATION") return "vehicles";

  // Anything left that bills like software is software. A subscription is the
  // same charge every month by definition, which is what this kind means.
  if (charge.kind === "subscription") return "software";
  return "other";
}

export interface OverheadLine {
  key: string;
  label: string;
  group: OverheadGroup;
  monthly: number;
  /** The amount swings; the monthly figure is an average of something moving. */
  variable: boolean;
  /**
   * What somebody wrote about it.
   *
   * The place to record what a charge actually covers, which the bank cannot
   * say: the rent line is rent plus the water some months, and a figure that
   * does not admit that gets read as pure rent and budgeted against wrongly.
   */
  note: string | null;
}

export interface OverheadBreakdown {
  groups: { group: OverheadGroup; label: string; monthly: number; lines: OverheadLine[] }[];
  /** Everything, per month. What it costs to open the doors. */
  monthly: number;
  /** The same as a share of a year, for anybody thinking in seasons. */
  yearly: number;
  /** How much of the total is an average of something that moves. */
  variableShare: number;
}

export interface Countable extends RecurringCharge {
  /** Pushed out by a person: personal, one-off, or wrongly detected. */
  dismissed?: boolean;
  /** Not charged recently enough to still count. */
  live?: boolean;
  category?: string | null;
  /**
   * The bucket somebody put it in.
   *
   * A landlord's trading name says nothing about being rent, so the biggest
   * line in the business lands in "everything else" until a person says
   * otherwise. One tap, and it stays said.
   */
  group?: OverheadGroup | null;
  /** What somebody wrote about what this charge actually covers. */
  note?: string | null;
}

/**
 * The overhead, from the charges that survived a person looking at them.
 *
 * Transfers never count. A card being paid off is money already counted when
 * it was spent, and putting it in the overhead would roughly double what every
 * job is priced to cover.
 */
export function overheadFrom(charges: readonly Countable[]): OverheadBreakdown {
  const lines: OverheadLine[] = [];

  for (const charge of charges) {
    if (charge.kind === "transfer") continue;
    if (charge.dismissed) continue;
    if (charge.live === false) continue;

    lines.push({
      key: charge.key,
      label: charge.label,
      group: groupFor(charge, charge.category, charge.group ?? null),
      monthly: charge.monthlyAmount,
      variable: charge.variableAmount,
      note: charge.note ?? null,
    });
  }

  const byGroup = GROUP_ORDER.map((group) => {
    const inGroup = lines
      .filter((line) => line.group === group)
      .sort((a, b) => b.monthly - a.monthly);
    return {
      group,
      label: GROUP_LABEL[group],
      monthly: round(inGroup.reduce((sum, line) => sum + line.monthly, 0)),
      lines: inGroup,
    };
  }).filter((entry) => entry.lines.length > 0);

  const monthly = round(lines.reduce((sum, line) => sum + line.monthly, 0));
  const variable = round(
    lines.filter((line) => line.variable).reduce((sum, line) => sum + line.monthly, 0)
  );

  return {
    groups: byGroup,
    monthly,
    yearly: round(monthly * 12),
    variableShare: monthly > 0 ? Math.round((variable / monthly) * 100) / 100 : 0,
  };
}

/**
 * What one hour of work has to carry before it has earned anything.
 *
 * The number pricing actually needs. Overhead spread across the hours the crew
 * is expected to be billable, which is never all of them: travel, loading,
 * quoting and the rain are real and are not on an invoice.
 */
export function overheadPerHour(monthly: number, billableHoursPerMonth: number): number | null {
  if (billableHoursPerMonth <= 0) return null;
  return Math.round((monthly / billableHoursPerMonth) * 100) / 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
