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

/**
 * One area of the property drawn each way it is offered: a photo of it today
 * and a rendering of it under each option. The client sees today beside the
 * option they have picked, so tapping between options is seeing the yard
 * change rather than reading a list of what differs.
 */
export interface RenderingZone {
  name: string;
  /** Today's photo. */
  before: string;
  /** Option key to its rendering. "all" stands for an area that looks the same under every option. */
  after: Record<string, string>;
}

export interface ProposalOptions {
  options: ProposalOption[];
  /** Before and after pictures of each area, when the proposal was drawn. */
  renderings?: RenderingZone[];
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
  const renderings = readRenderings((raw as { renderings?: unknown }).renderings);
  return {
    options,
    chosen: typeof chosen === "string" && options.some((o) => o.key === chosen) ? chosen : null,
    ...(renderings.length ? { renderings } : {}),
  };
}

/** The pictures, keeping only areas with a before and at least one after. A bad picture is dropped, never a reason to lose the options. */
export function readRenderings(raw: unknown): RenderingZone[] {
  if (!Array.isArray(raw)) return [];
  const zones: RenderingZone[] = [];
  for (const z of raw) {
    if (!z || typeof z !== "object") continue;
    const r = z as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.before !== "string" || !r.before.trim()) continue;
    const after: Record<string, string> = {};
    if (r.after && typeof r.after === "object") {
      for (const [k, v] of Object.entries(r.after as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) after[k] = v;
      }
    }
    if (Object.keys(after).length === 0) continue;
    zones.push({ name: r.name, before: r.before, after });
  }
  return zones;
}

/** The rendering of an area under an option, or the one shared by every option, or null. */
export function renderingFor(zone: RenderingZone, optionKey: string | null): string | null {
  return (optionKey ? zone.after[optionKey] : undefined) ?? zone.after.all ?? null;
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
