/**
 * The two owner-started campaigns: next season's renewal proposals, and the
 * snow and salt pre-sell. Both go to people we have worked for, both are one
 * button with a preview in front of it, and both run once a season.
 *
 * Pure: who is in, at what price, saying what.
 */

import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * Services that come back every year. A client who had one of these done
 * last season is a renewal; a patio is not.
 */
const RECURRING = /\bmow|mowing|lawn (care|maintenance|service)|fertili[sz]|weed control|grub|aerat|overseed|leaf|leaves|clean[\s-]?up|mulch|bed maintenance|hedge|shrub trim|pruning|salt|snow|ice/i;

export function isRecurringService(label: string | null | undefined): boolean {
  return RECURRING.test(label ?? "");
}

/** A price raised by the escalator, rounded to the dollar the way a proposal reads. */
export function escalate(cents: number, pct: number): number {
  const raised = Math.max(0, cents) * (1 + Math.max(0, pct) / 100);
  return Math.round(raised / 100) * 100;
}

/**
 * The season a renewal is for and the day its campaign is due: the next
 * season start that is still at least a week away, and that minus the lead.
 */
export function nextSeason(now: Date, seasonStart: string, leadDays: number): { season: string; startsOn: string; dueOn: string } {
  const [mm, dd] = seasonStart.split("-").map(Number);
  let year = now.getUTCFullYear();
  let start = Date.UTC(year, mm - 1, dd);
  if (start - 7 * 86_400_000 < now.getTime()) {
    year += 1;
    start = Date.UTC(year, mm - 1, dd);
  }
  const due = new Date(start - leadDays * 86_400_000);
  return { season: String(year), startsOn: new Date(start).toISOString().slice(0, 10), dueOn: due.toISOString().slice(0, 10) };
}

/** The snow season a pre-sell is for: winter 2026-27 from summer 2026 on. */
export function snowSeason(now: Date): string {
  const y = now.getUTCFullYear();
  // Before June the coming winter is still "this" winter's tail; sell next.
  const start = now.getUTCMonth() >= 5 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export interface RenewalSource {
  customerId: string;
  propertyId: string;
  jobId: string;
  address: string;
  clientName: string;
  acceptedAt: string;
  snapshot: ProposalZoneSnapshot[];
  /** The total the client paid, in dollars, for spreading onto unpriced areas. */
  total: number;
}

export interface RenewalOffer {
  customerId: string;
  propertyId: string;
  fromJobId: string;
  address: string;
  clientName: string;
  areas: ProposalZoneSnapshot[];
  lastCents: number;
  newCents: number;
}

/**
 * A renewal from last season's accepted work: only the recurring areas, each
 * at its price plus the escalator. Areas with no recorded price share what is
 * left of the total, the way win-back does. Null when nothing recurs.
 */
export function renewalOffer(source: RenewalSource, escalatorPct: number): RenewalOffer | null {
  const totalCents = Math.round(source.total * 100);
  const recorded = source.snapshot.reduce((sum, z) => sum + (typeof z.priceCents === "number" ? Math.max(0, z.priceCents) : 0), 0);
  const unpriced = source.snapshot.filter((z) => typeof z.priceCents !== "number").length;
  const share = unpriced > 0 ? Math.max(0, totalCents - recorded) / unpriced : 0;

  const areas = source.snapshot
    .filter((z) => isRecurringService(z.serviceLabel) || isRecurringService(z.zoneName))
    .map((z) => {
      const last = typeof z.priceCents === "number" ? Math.max(0, z.priceCents) : Math.round(share);
      return { ...z, priceCents: escalate(last, escalatorPct), priceDerived: false, photoPaths: [] as string[] };
    });
  if (areas.length === 0) return null;
  const lastCents = source.snapshot
    .filter((z) => isRecurringService(z.serviceLabel) || isRecurringService(z.zoneName))
    .reduce((sum, z) => sum + (typeof z.priceCents === "number" ? Math.max(0, z.priceCents) : Math.round(share)), 0);
  const newCents = areas.reduce((sum, z) => sum + (z.priceCents ?? 0), 0);
  if (newCents <= 0) return null;
  return {
    customerId: source.customerId,
    propertyId: source.propertyId,
    fromJobId: source.jobId,
    address: source.address,
    clientName: source.clientName,
    areas,
    lastCents,
    newCents,
  };
}

/**
 * One renewal per client: the most recent accepted job with recurring work,
 * within the last eighteen months (last season, and the one before for
 * snow clients whose winter straddles the new year).
 */
export function pickRenewals(sources: RenewalSource[], escalatorPct: number, now: Date): RenewalOffer[] {
  const cutoff = now.getTime() - 548 * 86_400_000;
  const latest = new Map<string, RenewalSource>();
  for (const s of sources) {
    if (new Date(s.acceptedAt).getTime() < cutoff) continue;
    const held = latest.get(s.customerId);
    if (!held || held.acceptedAt < s.acceptedAt) {
      if (renewalOffer(s, escalatorPct)) latest.set(s.customerId, s);
    }
  }
  return [...latest.values()].map((s) => renewalOffer(s, escalatorPct)).filter((o): o is RenewalOffer => o != null);
}

export function renewalKey(customerId: string, season: string, channel: "sms" | "email"): string {
  return `renewal:${season}:${customerId}:${channel}`;
}

export function saltPresellKey(customerId: string, season: string, channel: "sms" | "email"): string {
  return `salt_presell:${season}:${customerId}:${channel}`;
}

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

export function renewalMessage(input: {
  channel: "sms" | "email";
  businessName: string;
  clientName: string | null;
  address: string;
  season: string;
  newCents: number;
  link: string;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
}): { subject: string; body: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)}, ` : "";
  const line = `${hi}your ${input.season} season at ${input.address} is ready to renew: the same work as last year for ${money(input.newCents)}. Accept it in one tap to keep your place on the schedule:`;
  if (input.channel === "sms") {
    const text = `${input.businessName}: ${line} ${input.link}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.businessName, input.unsubscribeUrl ? `Not want these? ${input.unsubscribeUrl}` : null].filter((p): p is string => Boolean(p));
  return {
    subject: `Renew your ${input.season} season`,
    body: [line, input.link, "Want anything changed? Reply to this email and we'll adjust it before the season starts.", ...foot].join("\n\n"),
  };
}

export function saltPresellMessage(input: {
  channel: "sms" | "email";
  businessName: string;
  clientName: string | null;
  season: string;
  link: string;
  business: boolean;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
}): { subject: string; body: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)}, ` : "";
  const line = input.business
    ? `${hi}we're booking snow and ice for the ${input.season} winter now. Prepay your salt visits at a fixed price and you're first on the route when it freezes:`
    : `${hi}beat the first freeze: prepay your driveway and walk salting for this winter at a fixed price, and you're on the route before the storm:`;
  if (input.channel === "sms") {
    const text = `${input.businessName}: ${line} ${input.link}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.businessName, input.unsubscribeUrl ? `Not want these? ${input.unsubscribeUrl}` : null].filter((p): p is string => Boolean(p));
  return { subject: `Snow and ice for ${input.season}: prepay and skip the wait`, body: [line, input.link, ...foot].join("\n\n") };
}
