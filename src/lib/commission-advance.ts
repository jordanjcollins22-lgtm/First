/**
 * An advance on commission: part of what a project will pay an account
 * manager, asked for before it is payable, approved by the owner, then paid.
 * Only on a project the client has paid for in full: the money is in, so
 * the commission on it is certain, even if the job is not finished yet.
 *
 * What can be asked for on a project is what its commission is expected to
 * come to -- their rate on the price the client agreed to, or on what has
 * been collected when that is more -- less what has already gone out on it
 * (a paid advance is a payout against the project) and less anything asked
 * for and not paid yet. So an advance can never take out more than the
 * project will pay, and it comes off what is owed on it when it is due.
 *
 * Pure, so the rule is tested without a database.
 */

export type AdvanceStatus = "requested" | "approved" | "declined" | "paid" | "cancelled";

export const ADVANCE_STATUS_LABEL: Record<AdvanceStatus, string> = {
  requested: "Waiting on approval",
  approved: "Approved, to be paid",
  declined: "Declined",
  paid: "Paid",
  cancelled: "Withdrawn",
};

/** Asked for and not paid yet: it holds its share of the room. */
export function isPending(status: AdvanceStatus): boolean {
  return status === "requested" || status === "approved";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The client has paid the whole agreed price: the only projects an advance can be asked on. */
export function paidInFull(contractValue: number | null, collected: number): boolean {
  return contractValue != null && contractValue > 0 && collected >= contractValue - 0.01;
}

/** What an advance on this project could still be, in dollars. */
export function advanceRoom(line: { pct: number; contractValue: number | null; collected: number; paidOut: number }, pendingDollars: number): number {
  const expected = (line.pct / 100) * Math.max(line.contractValue ?? 0, line.collected);
  return round2(Math.max(0, expected - line.paidOut - pendingDollars));
}

/** Why this amount cannot be asked for, or null when it can. */
export function whyNotAdvance(amount: number, room: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Put in how much, in dollars.";
  if (room <= 0) return "There's nothing left to advance on this project.";
  if (round2(amount) > room + 0.001) return `The most you can ask for on this project is $${room.toLocaleString("en-US", Number.isInteger(room) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  return null;
}
