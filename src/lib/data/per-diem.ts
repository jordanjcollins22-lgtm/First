import { cache } from "react";

import { getRecurringBoard } from "@/lib/data/recurring";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { GROUP_LABEL } from "@/lib/overhead";
import {
  DEFAULT_PATTERN,
  perDiemFrom,
  perDiemLines,
  type PerDiem,
  type PerDiemLine,
  type WorkingPattern,
} from "@/lib/per-diem";

/**
 * What a day of work has to earn before the business has made anything.
 *
 * Both halves come from somewhere already: the monthly figure off the bank,
 * the working pattern off the organization. All this does is put them together
 * and keep the result on one read, because the quote needs it, the money
 * screen shows it, and two ways of working out the same per diem would
 * eventually disagree in front of a client.
 */

export interface PerDiemBoard {
  pattern: WorkingPattern;
  perDiem: PerDiem;
  /** What each part of the overhead costs a day, biggest first. */
  lines: PerDiemLine[];
  /** Whether quotes are charging this or the old flat percentage. */
  basis: "percent" | "per_diem";
  /** The flat percentage, for showing what it collects instead. */
  overheadPercent: number;
  multiplier: number;
}

export const getPerDiem = cache(async function getPerDiem(): Promise<PerDiemBoard> {
  const [organization, board] = await Promise.all([getCurrentOrganization(), getRecurringBoard()]);

  const pattern: WorkingPattern = {
    billableDaysPerMonth:
      organization.billable_days_per_month ?? DEFAULT_PATTERN.billableDaysPerMonth,
    hoursPerDay: Number(organization.crew_hours_per_day ?? DEFAULT_PATTERN.hoursPerDay),
    crewSize: organization.crew_size ?? DEFAULT_PATTERN.crewSize,
  };

  return {
    pattern,
    perDiem: perDiemFrom(board.overhead.monthly, pattern),
    lines: perDiemLines(
      board.overhead.groups.map((group) => ({
        label: GROUP_LABEL[group.group],
        monthly: group.monthly,
      })),
      pattern
    ),
    basis: organization.overhead_basis === "percent" ? "percent" : "per_diem",
    overheadPercent: organization.overhead_percent ?? 0,
    multiplier: organization.price_multiplier ?? 1,
  };
});

/**
 * What a quote should charge per crew-hour, in cents. Null when it should use
 * the flat percentage instead.
 *
 * Null rather than zero for two different situations that both mean "do not
 * use a per diem": somebody has chosen the percentage, or no overhead has been
 * worked out yet. A business whose banks are not connected has nothing to
 * spread and must keep quoting the way it always has.
 */
export async function overheadPerCrewHourCents(): Promise<number | null> {
  const board = await getPerDiem().catch(() => null);
  if (!board) return null;
  if (board.basis !== "per_diem") return null;
  if (board.perDiem.perCrewHour <= 0) return null;
  return Math.round(board.perDiem.perCrewHour * 100);
}
