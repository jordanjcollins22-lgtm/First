import type { Position } from "@/lib/hiring/positions";

/**
 * The Indeed ad for a position, as plain text to paste into Indeed's job
 * description box. Built from the same position the apply form uses, so the
 * ad never promises something the form doesn't ask about.
 */

/** Stands in for the pay until somebody fills it in. Loud on purpose: an ad must not go up with it. */
export const PAY_MISSING = "[ADD PAY RANGE BEFORE POSTING]";

export interface AdInput {
  business: string;
  area: string;
  applyUrl: string;
}

/** The pay, as the ad and our careers page say it. Commission-only roles say so first, so nobody expects a wage. */
function payText(position: Position, missing: string | null): string | null {
  if (position.commissionOnly) return position.commission ? `Commission only, no hourly pay: ${position.commission}` : missing;
  const parts = [position.pay ?? missing, position.commission].filter(Boolean);
  return parts.length ? parts.join(", plus ") : null;
}

export function payLine(position: Position): string {
  return payText(position, PAY_MISSING) ?? PAY_MISSING;
}

/** The pay as an applicant reads it on our own page: never the placeholder. Null when nothing is set. */
export function publicPayLine(position: Position): string | null {
  return payText(position, null);
}

export function needsPay(position: Position): boolean {
  return position.commissionOnly ? !position.commission : position.pay == null;
}

/**
 * What goes in Indeed's own pay fields, which sit apart from the description.
 * Maryland job ads have to show the pay, so an hourly role gives its rate
 * there too; a commission-only role says commission.
 */
export function indeedPayFields(position: Position): string {
  if (position.commissionOnly) {
    return "Pay: commission only, no hourly wage. Under supplemental pay, tick Commission pay. The description states the rate.";
  }
  const rate = position.pay?.match(/\$\s?([\d.,]+)/)?.[1];
  const hourly = rate ? `Exact amount, $${Number(rate.replace(/,/g, "")).toFixed(2)} per hour` : PAY_MISSING;
  return `Pay: ${hourly}.${position.commission ? " Under supplemental pay, tick Commission pay (the description says it's coming soon)." : ""}`;
}

/** Indeed's own benefit tick boxes, named as Indeed names them. */
export function indeedBenefitFields(position: Position): string {
  const boxes = position.benefits.map((b) => (b === "Performance bonuses" ? "Performance bonus (under supplemental pay)" : b));
  return `Benefits: tick ${boxes.join(", ")}.`;
}

export function indeedAd(position: Position, input: AdInput): { title: string; body: string; payFields: string } {
  const bullets = (items: readonly string[]) => items.map((item) => `• ${item}`).join("\n");
  const body = [
    `${input.business} is a growing landscaping company serving ${input.area}. ${position.tagline}`,
    "",
    "What you'll do",
    bullets(position.duties),
    "",
    "What we're looking for",
    bullets(position.lookingFor),
    "",
    "Pay",
    payLine(position),
    "",
    "Benefits",
    bullets(position.benefits),
    "",
    "Schedule",
    position.schedule,
    "",
    "How to apply",
    `Apply here: ${input.applyUrl}`,
    "It takes about 3 minutes. If you're a fit, you'll be asked to record a short video from your phone (about a minute) so we can meet you before an in-person interview.",
  ].join("\n");
  return { title: position.title, body, payFields: `${indeedPayFields(position)}\n${indeedBenefitFields(position)}` };
}
