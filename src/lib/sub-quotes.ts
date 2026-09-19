/**
 * A price request to a subcontractor.
 *
 * A proposal is written in zones because that is how the ground is drawn
 * and priced. A subcontractor does not care about zones. A soft washer
 * wants to know what needs washing, see it, and say a number. So a request
 * is one service's worth of a proposal: every area that needs that service,
 * described in our words with its photos, and one price back.
 */

import type { ProposalZoneSnapshot } from "@/types/domain";

export interface QuoteArea {
  scopeText: string;
  photoPaths: string[];
}

export interface ServiceGroup {
  serviceLabel: string;
  areas: QuoteArea[];
}

type ZoneLike = Pick<ProposalZoneSnapshot, "serviceLabel" | "scopeText" | "photoPaths">;

/** The proposal's zones folded into one group per service, in the order the services first appear. */
export function serviceGroups(zones: readonly ZoneLike[]): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  for (const zone of zones) {
    const label = (zone.serviceLabel ?? "").trim();
    if (!label) continue;
    const group = groups.get(label) ?? { serviceLabel: label, areas: [] };
    group.areas.push({ scopeText: (zone.scopeText ?? "").trim(), photoPaths: [...(zone.photoPaths ?? [])] });
    groups.set(label, group);
  }
  return [...groups.values()];
}

/**
 * The scope wording with the zone talk taken out.
 *
 * The office writes "we will clear the weeds from both sides of Zone 5".
 * A contractor reading a page with no zones on it is told about an area
 * instead.
 */
export function withoutZoneTalk(text: string): string {
  return text
    .replace(/\bin\s+zones?\s+\d+[a-z]?\b/gi, "in this area")
    .replace(/\bof\s+zones?\s+\d+[a-z]?\b/gi, "of this area")
    .replace(/\bzones?\s+\d+[a-z]?\b/gi, "this area")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 24 hex characters, the same shape as every other link handed to somebody without an account. */
export function quoteToken(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 24; i++) out += Math.floor(random() * 16).toString(16);
  return out;
}

export function isQuoteToken(value: string): boolean {
  return /^[0-9a-f]{24}$/.test(value);
}

/** A price from whatever somebody typed, in dollars, or null when it is not one. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export type SubQuoteStatus = "open" | "quoted" | "closed";

export const SUB_QUOTE_STATUS_LABEL: Record<SubQuoteStatus, string> = {
  open: "Waiting on a price",
  quoted: "Priced",
  closed: "Closed",
};
