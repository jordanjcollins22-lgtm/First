/**
 * An advance on commission: money paid to an account manager now, owed back
 * from their commission as it comes due. It is a balance on their account,
 * not a charge against one project: asked for, approved by the owner, paid,
 * and from then on every commission payout goes to paying it back first,
 * with only what is left handed over.
 *
 * What can be asked for is the commission still to come on projects the
 * client has paid for in full -- their rate on the agreed price, or on what
 * came in when that is more, less what has gone out on each -- less what is
 * already owed on advances and anything asked for and not paid yet. So an
 * advance is always covered by commission the money for is already in.
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

/** What can be asked for now: the commission to come on paid-in-full projects, less what is owed and what is asked for. */
export function advanceLimit(rooms: number[], owed: number, pending: number): number {
  return round2(Math.max(0, rooms.reduce((sum, r) => sum + r, 0) - owed - pending));
}

/**
 * A commission payout split between paying back the advance and money handed
 * over: each line pays the advance first, in order, until it is paid back.
 */
export function splitRepayment<T extends { amount: number }>(lines: T[], owed: number): (T & { repay: number; cash: number })[] {
  let left = Math.max(0, round2(owed));
  return lines.map((line) => {
    const repay = round2(Math.min(left, Math.max(0, line.amount)));
    left = round2(left - repay);
    return { ...line, repay, cash: round2(line.amount - repay) };
  });
}

/** Why this amount cannot be asked for, or null when it can. */
export function whyNotAdvance(amount: number, room: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Put in how much, in dollars.";
  if (room <= 0) return "There's nothing to advance on right now: no commission to come on a project the client has paid in full.";
  if (round2(amount) > room + 0.001) return `The most you can ask for right now is $${room.toLocaleString("en-US", Number.isInteger(room) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  return null;
}
