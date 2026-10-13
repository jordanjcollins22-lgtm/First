/**
 * Winning back a declined proposal by doing it in two parts.
 *
 * Most of what gets declined is declined on size: nothing over ten thousand
 * has sold, and a lot between four and eight has. So a declined proposal
 * comes back as a Phase 1, the areas that matter most at a price in reach,
 * with the rest kept for later. Every area carries its own price on the
 * proposal (scope_snapshot[].priceCents), so the Phase 1 price is worked out
 * from the areas kept rather than typed. Proposals written before areas were
 * priced have the unpriced remainder shared across their unpriced areas, and
 * the screen says so. Pure, so the choices are tested.
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
  /** Each area with its price in cents (before the discount), from zonePrices. */
  areas: { zoneName: string; serviceLabel: string; priceCents?: number; estimated?: boolean }[];
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
  if (!Number.isFinite(price) || price <= 0) return "The areas ticked have no price on them.";
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

/** One area with the price it carries for Phase 1, and whether that price was shared out rather than recorded. */
export interface PricedArea {
  zoneName: string;
  serviceLabel: string;
  priceCents: number;
  /** True when the proposal never recorded this area's price and it was shared out of the total. */
  estimated: boolean;
}

/**
 * Every area's price, in cents, adding up to the proposal's total.
 *
 * Areas with a recorded price keep it. Whatever of the total is left over
 * is shared evenly across the areas without one, which is the honest guess
 * for a proposal written before areas were priced. When the recorded prices
 * already add up to more than the total (a rounding, an edit), every area is
 * scaled down to fit, so the parts never come to more than the whole.
 */
export function zonePrices(snapshot: ProposalZoneSnapshot[], totalCents: number): PricedArea[] {
  const total = Math.max(0, Math.round(totalCents));
  const recorded = snapshot.map((z) => (typeof z.priceCents === "number" && z.priceCents >= 0 ? Math.round(z.priceCents) : null));
  const known = recorded.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  const unknownCount = recorded.filter((c) => c == null).length;
  const leftover = Math.max(0, total - known);
  const share = unknownCount > 0 ? Math.floor(leftover / unknownCount) : 0;
  let spare = unknownCount > 0 ? leftover - share * unknownCount : 0;
  const scale = known > total && known > 0 ? total / known : 1;

  return snapshot.map((z, index) => {
    const own = recorded[index];
    if (own != null) return { zoneName: z.zoneName, serviceLabel: z.serviceLabel, priceCents: Math.round(own * scale), estimated: false };
    const extra = spare > 0 ? 1 : 0;
    spare -= extra;
    return { zoneName: z.zoneName, serviceLabel: z.serviceLabel, priceCents: share + extra, estimated: true };
  });
}

/**
 * The Phase 1 price for the areas kept: their prices, less the same share of
 * the discount the full proposal had, in dollars. Null when nothing is kept.
 */
export function phaseOnePrice(input: { snapshot: ProposalZoneSnapshot[]; keep: string[]; total: number; discount: number }): number | null {
  const wanted = new Set(input.keep);
  const priced = zonePrices(input.snapshot, input.total * 100).filter((a) => wanted.has(a.zoneName));
  if (priced.length === 0) return null;
  const cents = priced.reduce((sum, a) => sum + a.priceCents, 0);
  return Math.round(cents * discountRatio(input.total, input.discount)) / 100;
}

/** What share of the list price the client was asked to pay. */
export function discountRatio(total: number, discount: number): number {
  return total > 0 ? Math.max(0, total - discount) / total : 1;
}

/**
 * The snapshot to store for Phase 1: the kept areas, each with its price
 * written on (after the same discount), so the Phase 1 proposal can itself
 * be trimmed or split later without anybody typing a number.
 */
export function pricedPhaseOneSnapshot(snapshot: ProposalZoneSnapshot[], keep: string[], totalCents: number, ratio = 1): ProposalZoneSnapshot[] | null {
  const kept = phaseOneSnapshot(snapshot, keep);
  if (!kept) return null;
  const prices = new Map(zonePrices(snapshot, totalCents).map((a) => [a.zoneName, a]));
  return kept.map((z) => {
    const p = prices.get(z.zoneName);
    return {
      ...z,
      priceCents: p ? Math.round(p.priceCents * ratio) : null,
      // A price shared out of a total, or discounted, is ours, not the rate card's.
      priceDerived: Boolean(z.priceDerived && p && !p.estimated && ratio === 1),
    };
  });
}

/**
 * The most a Phase 1 offered without anybody choosing should cost. Nothing
 * over ten thousand has sold and a lot between four and eight has.
 */
export const PHASE_ONE_CAP = 8000;

/**
 * The Phase 1 the automatic win-back offers: the areas in the order they
 * were written (the evaluator writes the important ones first), as many as
 * fit under the smaller of $8,000 and 60% of what was declined. Always at
 * least one area and never all of them, which is the proposal they already
 * said no to. Null for a one-area proposal: there is nothing to split.
 */
export function autoPhaseOne(input: { snapshot: ProposalZoneSnapshot[]; total: number; discount: number }): { keep: string[]; price: number } | null {
  if (input.snapshot.length < 2) return null;
  const owed = Math.max(0, input.total - input.discount);
  const cap = Math.min(PHASE_ONE_CAP, owed * 0.6);
  const ratio = discountRatio(input.total, input.discount);
  const areas = zonePrices(input.snapshot, input.total * 100);
  const keep: string[] = [];
  let cents = 0;
  for (const area of areas.slice(0, -1)) {
    const next = cents + area.priceCents * ratio;
    if (keep.length > 0 && next / 100 > cap) break;
    keep.push(area.zoneName);
    cents = next;
  }
  const price = Math.round(cents) / 100;
  if (keep.length === 0 || !(price > 0) || price >= owed) return null;
  return { keep, price };
}

export function winBackDedupeKey(jobId: string, day: number, channel: "sms" | "email"): string {
  return `win_back:${jobId}:${day}:${channel}`;
}

/** The automatic win-back note for day N after a decline. */
export function winBackMessage(input: {
  day: number;
  channel: "sms" | "email";
  businessName: string;
  clientName: string | null;
  phaseOne: { areas: string[]; price: number } | null;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
}): { subject: string; body: string } {
  const first = (input.clientName ?? "").trim().split(/\s+/)[0] ?? "";
  const hi = first ? `Hi ${first}, ` : "";
  const offer = input.phaseOne
    ? ` We could start with ${input.phaseOne.areas.join(" and ")} for ${money(input.phaseOne.price)} and leave the rest for later.`
    : " We can split it into a smaller first phase and leave the rest for later.";
  const line =
    input.day <= 45
      ? `${hi}I know the full plan was more than you wanted to take on.${offer} Want me to send that over? Just reply.`
      : input.day <= 120
        ? `${hi}checking back in about your landscaping plans.${offer} Reply and we'll put it together.`
        : `${hi}a new season is coming and the schedule fills fast.${offer} Reply if you'd like it priced up.`;
  if (input.channel === "sms") {
    const text = `${input.businessName}: ${line}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.businessName, input.unsubscribeUrl ? `Not want these? ${input.unsubscribeUrl}` : null].filter((p): p is string => Boolean(p));
  return { subject: input.phaseOne ? `A smaller first step, ${money(input.phaseOne.price)}` : "A smaller first step", body: [line, ...foot].join("\n\n") };
}
