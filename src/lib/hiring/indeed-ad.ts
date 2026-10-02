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

export function payLine(position: Position): string {
  const parts = [position.pay ?? PAY_MISSING, position.commission].filter(Boolean);
  return parts.join(", plus ");
}

/** The pay as an applicant reads it on our own page: never the placeholder. Null when nothing is set. */
export function publicPayLine(position: Position): string | null {
  const parts = [position.pay, position.commission].filter(Boolean);
  return parts.length ? parts.join(", plus ") : null;
}

export function needsPay(position: Position): boolean {
  return position.pay == null;
}

export function indeedAd(position: Position, input: AdInput): { title: string; body: string } {
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
    "Schedule",
    position.schedule,
    "",
    "How to apply",
    `Apply here: ${input.applyUrl}`,
    "It takes about 3 minutes. If you're a fit, you'll be asked to record a short video from your phone (about a minute) so we can meet you before an in-person interview.",
  ].join("\n");
  return { title: position.title, body };
}
