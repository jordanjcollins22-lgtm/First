/**
 * Turning someone's pay structure into what they're owed.
 *
 * Pay structure already lives on the profile — pay_type is hourly, commission,
 * or both, with pay_rate_per_hour and commission_pct alongside it. This is the
 * one place that reads those and produces a number, so the payments screen and
 * anything added later agree.
 *
 * Everything here is a suggestion, not a rule: the amount recorded on a
 * payment is always whatever the admin actually enters. Real pay periods have
 * bonuses, advances, and corrections that no formula predicts.
 */

import type { Profile } from "@/types/domain";

export interface PayInputs {
  /** Hours worked in the period — only used when there's an hourly component. */
  hours: number | null;
  /** Sales the commission is calculated against, in dollars. */
  commissionBasis: number | null;
}

export interface PayBreakdown {
  hourlyAmount: number;
  commissionAmount: number;
  total: number;
  /** Plain-language lines explaining each part, shown under the amount so the
   * person paying can see where the number came from. */
  lines: string[];
  /** Set when the structure needs a number the profile doesn't have. */
  warning: string | null;
}

export function hasHourlyComponent(payType: Profile["pay_type"]): boolean {
  return payType === "hourly" || payType === "both";
}

export function hasCommissionComponent(payType: Profile["pay_type"]): boolean {
  return payType === "commission" || payType === "both";
}

/** One-line description of how someone is paid, for the picker. */
export function describePayStructure(profile: Pick<Profile, "pay_type" | "pay_rate_per_hour" | "commission_pct">): string {
  const hourly = profile.pay_rate_per_hour != null ? `$${profile.pay_rate_per_hour}/hr` : "hourly rate not set";
  const commission = profile.commission_pct != null ? `${profile.commission_pct}% commission` : "commission % not set";

  switch (profile.pay_type) {
    case "hourly":
      return hourly;
    case "commission":
      return commission;
    case "both":
      return `${hourly} + ${commission}`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculatePay(
  profile: Pick<Profile, "pay_type" | "pay_rate_per_hour" | "commission_pct">,
  inputs: PayInputs
): PayBreakdown {
  const lines: string[] = [];
  let hourlyAmount = 0;
  let commissionAmount = 0;
  let warning: string | null = null;

  if (hasHourlyComponent(profile.pay_type)) {
    const rate = profile.pay_rate_per_hour;
    const hours = inputs.hours ?? 0;
    if (rate == null) {
      warning = "No hourly rate on this person's account — set one on the Team page, or enter the amount by hand.";
    } else if (hours > 0) {
      hourlyAmount = round2(rate * hours);
      lines.push(`${hours} hr × $${rate}/hr = $${hourlyAmount.toFixed(2)}`);
    }
  }

  if (hasCommissionComponent(profile.pay_type)) {
    const pct = profile.commission_pct;
    const basis = inputs.commissionBasis ?? 0;
    if (pct == null) {
      warning = warning ?? "No commission % on this person's account — set one on the Team page, or enter the amount by hand.";
    } else if (basis > 0) {
      commissionAmount = round2((pct / 100) * basis);
      lines.push(`${pct}% of $${basis.toFixed(2)} = $${commissionAmount.toFixed(2)}`);
    }
  }

  return {
    hourlyAmount,
    commissionAmount,
    total: round2(hourlyAmount + commissionAmount),
    lines,
    warning,
  };
}
