/**
 * How long a proposal stands.
 *
 * A price is a price for a while. Materials move, the calendar fills, and a
 * quote from August accepted in October is a job at the wrong number on the
 * wrong week. So every proposal goes out with a life, seven or fourteen days
 * depending on the work, and when it runs out it closes on its own: off the
 * call list, off My Day, and the client's page says so and offers a fresh one.
 *
 * Nothing here reads or writes. It decides and it words.
 */

export const VALID_DAY_OPTIONS = [7, 14] as const;
export type ValidDays = (typeof VALID_DAY_OPTIONS)[number];
export const DEFAULT_VALID_DAYS: ValidDays = 14;

/** Why a proposal that ran out is closed, on the job and in the words. */
export const EXPIRED_REASON = "Ran out of time";

export function isValidDays(value: unknown): value is ValidDays {
  return VALID_DAY_OPTIONS.includes(value as ValidDays);
}

const DAY = 86_400_000;

/** When a proposal sent at a moment stops standing. */
export function expiryOf(sentAt: string | Date, validDays: number): Date {
  const sent = typeof sentAt === "string" ? new Date(sentAt) : sentAt;
  return new Date(sent.getTime() + validDays * DAY);
}

/** Whole days until it runs out. Negative once it has. */
export function daysLeft(expiresAt: string | Date, now: Date): number {
  const at = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return Math.ceil((at.getTime() - now.getTime()) / DAY);
}

export function isExpired(expiresAt: string | Date | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  return daysLeft(expiresAt, now) <= 0;
}

function shortDate(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** For the office: how much life a sent proposal has left. */
export function validityLine(expiresAt: string | Date | null | undefined, now: Date): string | null {
  if (!expiresAt) return null;
  const left = daysLeft(expiresAt, now);
  if (left <= 0) return `Expired ${shortDate(expiresAt)}`;
  if (left === 1) return "Expires tomorrow";
  return `${left} days left, until ${shortDate(expiresAt)}`;
}

/** For the client: how long this price is good for. */
export function clientValidityLine(expiresAt: string | Date | null | undefined, now: Date): string | null {
  if (!expiresAt) return null;
  const left = daysLeft(expiresAt, now);
  if (left <= 0) return null;
  if (left === 1) return "This price is good until tomorrow.";
  return `This price is good for ${left} more days, until ${shortDate(expiresAt)}.`;
}

/** What the client reads once it has run out. */
export function expiredWording(expiresAt: string | Date): { headline: string; detail: string } {
  return {
    headline: `This proposal expired on ${shortDate(expiresAt)}.`,
    detail: "Prices and the calendar move, so message us below and we will send a fresh one.",
  };
}
