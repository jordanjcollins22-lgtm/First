/**
 * Options on a proposal: the same job offered more than one way, a basic
 * version and a full-service one, each with its own price and its own list
 * of what is and is not included. Shown side by side, so a client who would
 * have turned down the full price has a yes to give, and one who wants it
 * done properly can see exactly what the difference buys.
 *
 * The proposal's own price and areas stay whichever option is the base, so
 * every list and total that reads a proposal keeps working. Accepting with an
 * option chosen writes that option's price and areas onto the proposal.
 *
 * Pure, so it is tested without a database.
 */
import type { PriceLine } from "@/lib/forward-pricing";

export interface OptionArea {
  /** This area's price under the option, in cents. */
  priceCents: number;
  /** The services it was priced from, for the crew's sheet once chosen. */
  lines?: PriceLine[];
}

export interface ProposalOption {
  key: string;
  name: string;
  /** One line under the name: who it is for. */
  tagline: string;
  totalCents: number;
  includes: string[];
  notIncluded: string[];
  /** Something given free with it, said plainly with what it is worth. */
  bonus?: string | null;
  /** The one we would pick. */
  recommended?: boolean;
  /** In the proposal's area order. */
  areas: OptionArea[];
  /** For a salting package: how many applications the option buys. */
  treatments?: number | null;
}

export interface ProposalOptions {
  options: ProposalOption[];
  /** The option accepted, once one has been. */
  chosen?: string | null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);

/** The options on a proposal, or null when it has one price. Anything malformed is treated as no options. */
export function readOptions(raw: unknown, areaCount: number): ProposalOptions | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { options?: unknown }).options;
  if (!Array.isArray(list)) return null;
  const options: ProposalOption[] = [];
  for (const o of list) {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const areas = Array.isArray(r.areas) ? r.areas : [];
    if (typeof r.key !== "string" || typeof r.name !== "string" || !Number.isFinite(r.totalCents) || areas.length !== areaCount) return null;
    if (!areas.every((a) => a && typeof a === "object" && Number.isFinite((a as OptionArea).priceCents))) return null;
    options.push({
      key: r.key,
      name: r.name,
      tagline: typeof r.tagline === "string" ? r.tagline : "",
      totalCents: Math.round(r.totalCents as number),
      includes: strings(r.includes),
      notIncluded: strings(r.notIncluded),
      bonus: typeof r.bonus === "string" && r.bonus.trim() ? r.bonus : null,
      recommended: r.recommended === true,
      areas: areas as OptionArea[],
      treatments: Number.isFinite(r.treatments) && (r.treatments as number) > 0 ? Math.round(r.treatments as number) : null,
    });
  }
  if (options.length < 2 || new Set(options.map((o) => o.key)).size !== options.length) return null;
  const chosen = (raw as { chosen?: unknown }).chosen;
  return { options, chosen: typeof chosen === "string" && options.some((o) => o.key === chosen) ? chosen : null };
}

/**
 * The proposal as it stands once an option is chosen: its price, and each
 * area's price and services. The areas' wording and photos are left alone.
 */
export function applyOption<Z extends { priceCents?: number | null; lines?: PriceLine[] }>(
  snapshot: Z[],
  option: ProposalOption
): { totalCost: number; snapshot: Z[] } {
  return {
    totalCost: option.totalCents / 100,
    snapshot: snapshot.map((zone, i) => {
      const area = option.areas[i];
      return { ...zone, priceCents: area.priceCents, priceDerived: true, ...(area.lines ? { lines: area.lines } : {}) };
    }),
  };
}
