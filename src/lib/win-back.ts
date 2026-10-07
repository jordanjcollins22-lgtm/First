/**
 * Winning back a declined proposal by doing it in two parts.
 *
 * Most of what gets declined is declined on size: nothing over ten thousand
 * has sold, and a lot between four and eight has. So a declined proposal
 * comes back as a Phase 1, the areas that matter most at a price in reach,
 * with the rest kept for later. Each area's own price was never recorded on
 * these proposals, so the Phase 1 price is typed by a person rather than
 * worked out here. Pure, so the choices are tested.
 */

import type { ProposalZoneSnapshot } from "@/types/domain";

export interface WinBackInput {
  jobId: string;
  client: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  total: number;
  discount: number;
  declinedAt: string | null;
  note: string | null;
  officeDeclined: boolean;
  jobStatus: string;
  areas: { zoneName: string; serviceLabel: string }[];
}

export interface WinBackRow extends WinBackInput {
  /** What they were asked to pay, after the discount. */
  owed: number;
}

/** Declined by the client, priced, and not called off: biggest first. */
export function winBackRows(rows: WinBackInput[]): WinBackRow[] {
  return rows
    .filter((r) => !r.officeDeclined && r.jobStatus !== "cancelled" && r.total > 0)
    .map((r) => ({ ...r, owed: Math.max(0, r.total - r.discount) }))
    .sort((a, b) => b.owed - a.owed);
}

/** The areas kept for Phase 1, in the order they were written, or null when the choice doesn't work. */
export function phaseOneSnapshot(snapshot: ProposalZoneSnapshot[], keep: string[]): ProposalZoneSnapshot[] | null {
  const wanted = new Set(keep);
  const kept = snapshot.filter((z) => wanted.has(z.zoneName));
  if (kept.length === 0) return null;
  return kept;
}

/** What a Phase 1 price has to be: more than nothing, and less than what was declined. */
export function phaseOnePriceProblem(price: number, declinedTotal: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return "Type the Phase 1 price.";
  if (price >= declinedTotal) return "Phase 1 should cost less than the proposal they declined.";
  return null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The note left on the job, so anybody opening it knows what was split off and why. */
export function phaseNote(input: { declinedTotal: number; price: number; kept: string[]; later: string[]; by: string }): string {
  const later = input.later.length > 0 ? ` Phase 2, for later: ${input.later.join(", ")}.` : "";
  return `Phase 1 made from the ${money(input.declinedTotal)} proposal they declined, by ${input.by}: ${input.kept.join(", ")} at ${money(input.price)}.${later}`;
}

/** A text the account manager can send from their own phone before the proposal email goes. */
export function winBackText(input: { first: string; sender: string; price: number | null }): string {
  const price = input.price ? ` for ${money(input.price)}` : "";
  return `Hi ${input.first}, it's ${input.sender} with JS Landscaping. I know the full plan was more than you wanted to spend right now. We can do the most important part first${price} this fall and leave the rest for spring. Want me to send that over?`;
}
