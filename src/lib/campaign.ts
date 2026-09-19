/**
 * An email campaign that books work, without burning the domain.
 *
 * One offer, sent to the list a little at a time, in more than one wording,
 * with the wording that books more getting more of the list as it goes.
 * Everything that decides is here and pure: the price for a lawn, how many
 * go out today, which wording a person gets, and when to stop. The database
 * remembers and the cron sends; neither of them thinks.
 *
 * Reputation first. A domain that lands in spam is a domain that cannot
 * send a proposal either, so the sending ramps up from a few dozen a day,
 * pauses itself on bounces or complaints, never writes to anybody who has
 * unsubscribed, and carries the unsubscribe link and the postal address on
 * every message.
 */

import { renderTemplate } from "@/lib/evaluation-sequence";

/** What aeration and overseeding costs, and what it can never cost less than. */
export interface AerationPricing {
  /** Seed, per thousand square feet of lawn. */
  seedPer1kCents: number;
  /** Crew time, per thousand square feet of lawn. */
  minutesPer1k: number;
  /** What an hour of crew time is charged at. */
  hourlyRateCents: number;
  /** The aerator for the day, whoever's lawn it is. */
  aeratorCents: number;
  /** The least a visit is worth doing for. */
  minimumCents: number;
  /** How much of the lot, after the house, is lawn. */
  lawnShare: number;
}

export const DEFAULT_PRICING: AerationPricing = {
  seedPer1kCents: 1800,
  minutesPer1k: 8,
  hourlyRateCents: 6500,
  aeratorCents: 10000,
  minimumCents: 65000,
  lawnShare: 0.85,
};

export function pricingFrom(raw: unknown): AerationPricing {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof AerationPricing, unknown>>;
  const num = (key: keyof AerationPricing) => {
    const v = r[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_PRICING[key];
  };
  return {
    seedPer1kCents: num("seedPer1kCents"),
    minutesPer1k: num("minutesPer1k"),
    hourlyRateCents: num("hourlyRateCents"),
    aeratorCents: num("aeratorCents"),
    minimumCents: num("minimumCents"),
    lawnShare: Math.min(1, Math.max(0.1, num("lawnShare"))),
  };
}

const SQFT_PER_ACRE = 43560;
const SMALLEST_LAWN = 1500;

/**
 * How much lawn a property has, from what the address lookup knows.
 *
 * The lot minus the house, then the share of that which is grass rather
 * than drive, beds and patio. A guess, but a consistent one, and the crew
 * sees the number on the job so a wild one gets corrected before anybody
 * turns up with a bag of seed.
 */
export function estimateLawnSqft(
  property: { acreage: number | null; sqft: number | null },
  pricing: AerationPricing = DEFAULT_PRICING
): number | null {
  if (property.acreage == null || property.acreage <= 0) return null;
  const lot = property.acreage * SQFT_PER_ACRE;
  const house = property.sqft != null && property.sqft > 0 ? Math.min(property.sqft, lot * 0.8) : lot * 0.15;
  const lawn = Math.round((lot - house) * pricing.lawnShare);
  return Math.max(SMALLEST_LAWN, lawn);
}

export interface AerationPrice {
  lawnSqft: number;
  seedCents: number;
  laborCents: number;
  aeratorCents: number;
  subtotalCents: number;
  totalCents: number;
  minimumApplied: boolean;
}

export function priceAeration(pricing: AerationPricing, lawnSqft: number): AerationPrice {
  const thousands = Math.max(0, lawnSqft) / 1000;
  const seedCents = Math.round(thousands * pricing.seedPer1kCents);
  const laborCents = Math.round((thousands * pricing.minutesPer1k * pricing.hourlyRateCents) / 60);
  const subtotalCents = seedCents + laborCents + pricing.aeratorCents;
  const totalCents = Math.max(pricing.minimumCents, subtotalCents);
  return {
    lawnSqft,
    seedCents,
    laborCents,
    aeratorCents: pricing.aeratorCents,
    subtotalCents,
    totalCents,
    minimumApplied: totalCents > subtotalCents,
  };
}

/** What they pay once the credit has come off. Never below zero. */
export function afterCredit(priceCents: number, creditCents: number): number {
  return Math.max(0, priceCents - creditCents);
}

/** How the sending grows, day by day, and where it stops growing. */
export interface RampPlan {
  steps: number[];
  cap: number;
}

export const DEFAULT_RAMP: RampPlan = { steps: [25, 50, 100, 150], cap: 200 };

export function rampFrom(raw: unknown): RampPlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as { steps?: unknown; cap?: unknown };
  const steps = Array.isArray(r.steps)
    ? r.steps.filter((n): n is number => typeof n === "number" && n > 0).map((n) => Math.floor(n))
    : DEFAULT_RAMP.steps;
  const cap = typeof r.cap === "number" && r.cap > 0 ? Math.floor(r.cap) : DEFAULT_RAMP.cap;
  return { steps: steps.length > 0 ? steps : DEFAULT_RAMP.steps, cap };
}

/**
 * How many may go out on the nth day of sending.
 *
 * A new sending domain that posts two hundred emails on its first morning
 * is a domain the receivers have never heard of, sending a lot, all at
 * once. That is the shape of spam, and it is judged as spam. A few dozen,
 * then double, then double again, is the shape of a business.
 */
export function todaysCap(ramp: RampPlan, sendDayIndex: number): number {
  const day = Math.max(0, Math.floor(sendDayIndex));
  if (day < ramp.steps.length) return Math.min(ramp.steps[day], ramp.cap);
  return ramp.cap;
}

/** What is known about one wording so far. */
export interface VariantStats {
  id: string;
  key: string;
  enabled: boolean;
  /** True when the wording quotes a price, so it can only go to somebody whose lawn we can size. */
  needsPrice: boolean;
  sent: number;
  clicked: number;
  booked: number;
}

/**
 * How well a wording is doing, with the doubt of a small sample built in.
 *
 * A booking is worth three clicks. The plus-one and plus-four keep a
 * wording that has gone out twice from looking like a winner or a loser
 * on two data points.
 */
export function variantScore(v: Pick<VariantStats, "sent" | "clicked" | "booked">): number {
  return (v.booked * 3 + v.clicked + 1) / (v.sent + 4);
}

const EXPLORE_FLOOR = 0.15;

/**
 * Which wording the next person gets.
 *
 * Each wording's share of the next sends is its score's share of the
 * total, but never below fifteen percent, so the one that is losing keeps
 * getting enough sends to prove it was only unlucky. The roll is passed in
 * so the choice is a function, and tests can make it land where they like.
 */
export function chooseVariant(variants: readonly VariantStats[], roll: number, canPrice: boolean): VariantStats | null {
  const usable = variants.filter((v) => v.enabled && (canPrice || !v.needsPrice));
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  const scores = usable.map(variantScore);
  const total = scores.reduce((a, b) => a + b, 0);
  const raw = scores.map((s) => (total > 0 ? s / total : 1 / usable.length));
  // Lift anything under the floor, then scale the rest to fit.
  const floored = raw.map((share) => Math.max(EXPLORE_FLOOR, share));
  const sum = floored.reduce((a, b) => a + b, 0);
  const shares = floored.map((share) => share / sum);

  let cursor = Math.min(0.999999, Math.max(0, roll));
  for (let i = 0; i < usable.length; i++) {
    if (cursor < shares[i]) return usable[i];
    cursor -= shares[i];
  }
  return usable[usable.length - 1];
}

/** The shares chooseVariant is working to, for the screen. */
export function variantShares(variants: readonly VariantStats[]): Record<string, number> {
  const usable = variants.filter((v) => v.enabled);
  const out: Record<string, number> = {};
  if (usable.length === 0) return out;
  const scores = usable.map(variantScore);
  const total = scores.reduce((a, b) => a + b, 0);
  const floored = scores.map((s) => Math.max(EXPLORE_FLOOR, total > 0 ? s / total : 1 / usable.length));
  const sum = floored.reduce((a, b) => a + b, 0);
  usable.forEach((v, i) => {
    out[v.id] = floored[i] / sum;
  });
  return out;
}

/** The lines the sender will not cross. */
export const GUARDRAILS = {
  /** Above this share of sends bouncing, stop. Receivers stop trusting at about two. */
  maxBounceRate: 0.03,
  /** Above this share complaining, stop. Google's line is one in a thousand. */
  maxComplaintRate: 0.001,
  /** Below this many sends a rate is noise, so only a run of hard failures stops it. */
  minSentForRates: 50,
  /** Even on a small sample, this many complaints is enough. */
  hardComplaints: 2,
};

/** Why the campaign should stop sending, or null to carry on. */
export function pauseReason(stats: { sent: number; bounced: number; complained: number }): string | null {
  if (stats.complained >= GUARDRAILS.hardComplaints) {
    return `${stats.complained} people marked it as spam. Paused before the domain pays for it.`;
  }
  if (stats.sent < GUARDRAILS.minSentForRates) return null;
  const bounceRate = stats.bounced / stats.sent;
  const complaintRate = stats.complained / stats.sent;
  if (bounceRate > GUARDRAILS.maxBounceRate) {
    return `${Math.round(bounceRate * 100)}% of sends bounced. The list needs cleaning before any more go out.`;
  }
  if (complaintRate > GUARDRAILS.maxComplaintRate) {
    return `Spam complaints are above one in a thousand. Paused before the domain pays for it.`;
  }
  return null;
}

/** The braces a campaign email may use. */
export const CAMPAIGN_PLACEHOLDERS: { key: string; means: string }[] = [
  { key: "first_name", means: "Their first name, or 'there'" },
  { key: "credit", means: "The credit, like $17.43" },
  { key: "expires", means: "When the code expires, like Friday, September 19" },
  { key: "code", means: "Their personal code" },
  { key: "address", means: "The property, street and town" },
  { key: "lawn_size", means: "About how much lawn, like about 6,500 sq ft" },
  { key: "price", means: "The full price for their lawn" },
  { key: "total", means: "The price after the credit" },
  { key: "offer_link", means: "The link to book with the credit applied" },
  { key: "business", means: "The business name" },
  { key: "phone", means: "The business phone" },
  { key: "signoff", means: "Who it is from" },
];

export interface CampaignVars {
  first_name: string;
  credit: string;
  expires: string;
  code: string;
  address: string;
  lawn_size: string;
  price: string;
  total: string;
  offer_link: string;
  business: string;
  phone: string;
  signoff: string;
}

export function renderCampaign(text: string, vars: CampaignVars): string {
  return renderTemplate(text, vars as unknown as Record<string, string>);
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function sayLawn(sqft: number | null): string {
  if (sqft == null) return "your lawn";
  return `about ${sqft.toLocaleString("en-US")} sq ft`;
}

export interface VariantDraft {
  key: string;
  name: string;
  subject: string;
  body: string;
  needsPrice: boolean;
}

/**
 * Three ways to say it. The campaign starts with all three and leans on
 * whichever books. Plain text on purpose: a personal-looking email from a
 * local business is what lands, and what gets replied to.
 */
export const DEFAULT_VARIANTS: VariantDraft[] = [
  {
    key: "A",
    name: "The credit is expiring",
    subject: "Your {credit} credit with {business} expires {expires}",
    body: `Hi {first_name},

You have a {credit} account credit with {business}, and it expires {expires}.

The best use for it this month is aeration and overseeding. Fall is the one window where new grass actually takes: warm soil, cool air, and months of rain before summer. A core aeration opens the soil and the seed goes straight into the holes, which is why it works when spring seeding does not.

Book below with your code and the credit comes off on its own:

{offer_link}

Your code: {code}

We read the lot size from your address and price it on the spot. Seed and crew time, nothing else. If the timing we offer does not work, reply to this email and we will sort it.

{signoff}
{business}
{phone}`,
    needsPrice: false,
  },
  {
    key: "B",
    name: "The window is closing",
    subject: "The two weeks that decide next year's lawn",
    body: `Hi {first_name},

Every fall there is a short window, while the soil is still warm and the air has cooled, when grass seed takes better than at any other time of year. In Harford County that window is now, and it closes when the ground goes cold.

Aeration and overseeding is the one job that uses it: pull cores out of the compacted soil, put seed in the holes, and you get a thicker lawn next spring instead of the same thin one with more weeds.

You have a {credit} credit with us that expires {expires}. Book with the code below and it comes off automatically:

{offer_link}

Your code: {code}

Priced from your lot size, seed and crew time only. Reply if you would rather talk it through first.

{signoff}
{business}
{phone}`,
    needsPrice: false,
  },
  {
    key: "C",
    name: "The price up front",
    subject: "Aeration and overseeding at {address}: {total} after your credit",
    body: `Hi {first_name},

For {address}, which is {lawn_size} of lawn, aeration and overseeding this fall is {price}. Your {credit} credit brings it to {total}.

That is the whole price: core aeration of the lawn, seed rated for this area, and the crew's time. It takes one visit and the lawn is thicker by spring.

The credit expires {expires}. Book here with your code and it comes off on its own:

{offer_link}

Your code: {code}

If the number looks off for your lot, reply and we will check it before anything is booked.

{signoff}
{business}
{phone}`,
    needsPrice: true,
  },
];

/** A campaign as the screen sees it. */
export interface CampaignStats {
  queued: number;
  sent: number;
  skipped: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  clicked: number;
  booked: number;
  bookedCents: number;
  /** Distinct days on which something went out. */
  sendDays: number;
}

export function campaignHeadline(stats: CampaignStats): string {
  if (stats.sent === 0) return `${stats.queued.toLocaleString("en-US")} people queued. Nothing sent yet.`;
  const parts = [`${stats.sent.toLocaleString("en-US")} sent`];
  if (stats.clicked > 0) parts.push(`${stats.clicked} opened the offer`);
  if (stats.booked > 0) parts.push(`${stats.booked} booked, ${money(stats.bookedCents)}`);
  if (stats.queued > 0) parts.push(`${stats.queued.toLocaleString("en-US")} to go`);
  return parts.join(", ") + ".";
}

/** Whether a code may still be used. */
export function offerState(input: {
  campaignStatus: string;
  expiresOn: string;
  bookedAt: string | null;
  today: string;
}): { ok: true } | { ok: false; reason: "booked" | "expired" | "closed" } {
  if (input.bookedAt) return { ok: false, reason: "booked" };
  if (input.campaignStatus === "done") return { ok: false, reason: "closed" };
  if (input.today > input.expiresOn) return { ok: false, reason: "expired" };
  return { ok: true };
}
