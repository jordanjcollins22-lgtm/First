/**
 * The lead finder: commercial, church, HOA and apartment properties near
 * Forest Hill and Bel Air, taken from the State's free assessment roll, and
 * a weekly hand check of about twenty of them on satellite and Street View.
 *
 * The roll gives the property universe for nothing and with no terms to
 * break (no Google Places, no scrapers). What it cannot say is whether a
 * place looks like it needs us; that is the office's eye, scored 0-10 with
 * the rubric below:
 *
 *   Satellite    up to 3  bare or grey beds, wide lawn strips, a big lot, heavy tree cover
 *   Street View  up to 3  worn asphalt, weeds in curbs, staining, overgrown shrubs
 *   Reviews      up to 2  customers mention the lot, weeds, dirt, "run down"
 *   Property     up to 2  read from the roll: lot over half an acre, a type that
 *                         cares about curb appeal, an owner billed out of state
 *
 * 7 or more gets a walk-in with a one-page quote; 4-6 a letter or email;
 * 0-3 waits for spring.
 *
 * Pure: facts in, ranks, scores and links out.
 */

/** Properties put in front of the office each week. */
export const LEAD_FINDER_WEEKLY_COUNT = 20;
/** A score at or above this is worth a walk-in and is offered as a lead. */
export const LEAD_FINDER_LEAD_SCORE = 7;
/** A score at or above this (and under the lead score) gets a letter or email. */
export const LEAD_FINDER_LETTER_SCORE = 4;
/** Lots smaller than this are left out when the roll knows the size. */
export const LEAD_FINDER_MIN_ACRES = 0.5;
/** Bel Air (21014, 21015), Fallston (21047), Forest Hill (21050), Abingdon (21009). */
export const LEAD_FINDER_ZIPS = ["21014", "21015", "21047", "21050", "21009"] as const;

export type FinderCategory = "commercial" | "church" | "hoa" | "apartments" | "industrial" | "institution";

export const CATEGORY_LABEL: Record<FinderCategory, string> = {
  commercial: "Commercial",
  church: "Church",
  hoa: "HOA / common area",
  apartments: "Apartments",
  industrial: "Industrial",
  institution: "Nonprofit / exempt",
};

export type FinderService = "mowing" | "mulch" | "pressure_washing" | "sealcoating" | "leaf_cleanup";

export const SERVICE_LABEL: Record<FinderService, string> = {
  mowing: "Mowing",
  mulch: "Mulch / beds",
  pressure_washing: "Pressure washing",
  sealcoating: "Sealcoating",
  leaf_cleanup: "Leaf cleanup",
};

export const SERVICE_ORDER: FinderService[] = ["mulch", "pressure_washing", "sealcoating", "mowing", "leaf_cleanup"];

export type RubricGroup = "satellite" | "streetView" | "reviews";

export const GROUP_CAP: Record<RubricGroup | "property", number> = { satellite: 3, streetView: 3, reviews: 2, property: 2 };

export const GROUP_LABEL: Record<RubricGroup | "property", string> = {
  satellite: "Satellite",
  streetView: "Street View",
  reviews: "Reviews",
  property: "Property (from the roll)",
};

export interface RubricCheck {
  key: string;
  group: RubricGroup;
  label: string;
  points: number;
  services: FinderService[];
}

export const RUBRIC: RubricCheck[] = [
  { key: "bedsBare", group: "satellite", label: "Beds with bare soil or grey mulch, no defined edges", points: 1, services: ["mulch"] },
  { key: "lawnStrips", group: "satellite", label: "Wide lawn strips or open turf", points: 1, services: ["mowing"] },
  { key: "bigLot", group: "satellite", label: "Big parking lot", points: 1, services: ["sealcoating"] },
  { key: "treeCover", group: "satellite", label: "Heavy tree cover over lawn, beds or lot", points: 1, services: ["leaf_cleanup"] },
  { key: "asphaltWorn", group: "streetView", label: "Faded or cracked asphalt", points: 1, services: ["sealcoating"] },
  { key: "weeds", group: "streetView", label: "Weeds in curbs, joints or beds", points: 1, services: ["mulch"] },
  { key: "staining", group: "streetView", label: "Green or black staining on walks, dumpster pad or storefront", points: 1, services: ["pressure_washing"] },
  { key: "overgrown", group: "streetView", label: "Overgrown shrubs or leaf litter", points: 1, services: ["mulch", "leaf_cleanup"] },
  { key: "reviewComplaints", group: "reviews", label: "Reviews mention the lot, potholes, weeds, dirt or \"run down\"", points: 2, services: [] },
];

const RUBRIC_KEYS = new Set(RUBRIC.map((r) => r.key));

export type RubricChecks = Partial<Record<string, boolean>>;

/** Only the rubric's own keys, and only the ticked ones: what is stored. */
export function cleanChecks(input: unknown): RubricChecks {
  const out: RubricChecks = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (RUBRIC_KEYS.has(key) && value === true) out[key] = true;
  }
  return out;
}

/** What the roll says about a property, enough to score and rank it. */
export interface ParcelFacts {
  category: FinderCategory;
  acreage: number | null;
  /** Two-letter state the tax bill goes to, when the owner is an organization. */
  ownerState: string | null;
  /** A business name or type that says curb appeal matters (medical, restaurant...). */
  name?: string | null;
}

const CURB_APPEAL_CATEGORIES = new Set<FinderCategory>(["church", "hoa", "apartments"]);
const CURB_APPEAL_WORDS = /\b(MEDICAL|HEALTH|DENTAL|DENTIST|CLINIC|URGENT CARE|PHYSICIAN|RESTAURANT|GRILL|TAVERN|PIZZ|CAFE|BANK|HOTEL|INN|FUNERAL|SCHOOL|ACADEMY|DAYCARE|CHILD CARE|STORAGE|PLAZA|CENTER|SHOPPING|RETAIL|OFFICE)/i;

/** The property points (0-2): read from the roll, not ticked by hand. */
export function propertyPoints(facts: ParcelFacts): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  if (facts.acreage != null && facts.acreage >= LEAD_FINDER_MIN_ACRES) reasons.push(`Lot ${formatAcres(facts.acreage)}`);
  if (CURB_APPEAL_CATEGORIES.has(facts.category) || (facts.name && CURB_APPEAL_WORDS.test(facts.name))) {
    reasons.push("Type that cares about curb appeal");
  }
  if (facts.ownerState && facts.ownerState.toUpperCase() !== "MD") reasons.push(`Owner billed in ${facts.ownerState.toUpperCase()} (a manager signs vendor contracts)`);
  return { points: Math.min(GROUP_CAP.property, reasons.length), reasons };
}

export interface ScoreResult {
  score: number;
  byGroup: Record<RubricGroup | "property", number>;
  propertyReasons: string[];
  /** Services the ticked checks point to, in the usual order. */
  services: FinderService[];
  tier: OutreachTier;
}

export type OutreachTier = "walk_in" | "letter" | "park";

export const TIER_LABEL: Record<OutreachTier, string> = {
  walk_in: "Walk in with a one-page quote",
  letter: "Letter or email",
  park: "Park for spring",
};

export function tierOf(score: number, leadScore = LEAD_FINDER_LEAD_SCORE, letterScore = LEAD_FINDER_LETTER_SCORE): OutreachTier {
  if (score >= leadScore) return "walk_in";
  if (score >= letterScore) return "letter";
  return "park";
}

/** The 0-10 score for a property from the boxes ticked and the roll's facts. */
export function scoreProspect(checks: RubricChecks, facts: ParcelFacts): ScoreResult {
  const byGroup: Record<RubricGroup | "property", number> = { satellite: 0, streetView: 0, reviews: 0, property: 0 };
  const services = new Set<FinderService>();
  for (const check of RUBRIC) {
    if (!checks[check.key]) continue;
    byGroup[check.group] += check.points;
    for (const s of check.services) services.add(s);
  }
  for (const group of ["satellite", "streetView", "reviews"] as RubricGroup[]) {
    byGroup[group] = Math.min(GROUP_CAP[group], byGroup[group]);
  }
  const property = propertyPoints(facts);
  byGroup.property = property.points;
  const score = Math.max(0, Math.min(10, byGroup.satellite + byGroup.streetView + byGroup.reviews + byGroup.property));
  return {
    score,
    byGroup,
    propertyReasons: property.reasons,
    services: SERVICE_ORDER.filter((s) => services.has(s)),
    tier: tierOf(score),
  };
}

/** What a property of this type usually buys, for before anyone has looked. */
export const LIKELY_SERVICES: Record<FinderCategory, FinderService[]> = {
  church: ["mulch", "sealcoating", "leaf_cleanup", "pressure_washing"],
  hoa: ["mowing", "mulch", "leaf_cleanup"],
  apartments: ["mulch", "pressure_washing", "sealcoating"],
  commercial: ["pressure_washing", "sealcoating", "mulch"],
  industrial: ["sealcoating", "mowing", "pressure_washing"],
  institution: ["mulch", "mowing", "leaf_cleanup"],
};

/** The services to suggest: what was seen when anything was, otherwise the type's usual. */
export function suggestedServices(checks: RubricChecks, category: FinderCategory, acreage: number | null): FinderService[] {
  const seen = new Set<FinderService>();
  for (const check of RUBRIC) if (checks[check.key]) for (const s of check.services) seen.add(s);
  if (seen.size === 0) for (const s of LIKELY_SERVICES[category]) seen.add(s);
  // An acre or more of open ground is a mowing contract whatever else it needs.
  if (acreage != null && acreage >= 1 && checks.lawnStrips) seen.add("mowing");
  return SERVICE_ORDER.filter((s) => seen.has(s));
}

/* ------------------------------------------------------------ the week */

const CATEGORY_WEIGHT: Record<FinderCategory, number> = {
  apartments: 3,
  church: 3,
  hoa: 3,
  commercial: 2,
  institution: 1,
  industrial: 1,
};

export interface RankInput extends ParcelFacts {
  assessedValue: number | null;
  /** A, B or C from a hand-made list; null for parcels from the roll. */
  seedPriority?: string | null;
}

/**
 * Which properties to look at first, before anyone has looked: the property
 * points, the type, the lot size (bigger lots are bigger tickets, up to five
 * acres) and the assessed value. A hand-made list's A/B/C counts for more,
 * because somebody already judged it.
 */
export function rankParcel(p: RankInput): number {
  let rank = propertyPoints(p).points * 2 + CATEGORY_WEIGHT[p.category];
  if (p.acreage != null) rank += Math.min(5, p.acreage);
  if (p.assessedValue != null && p.assessedValue > 0) rank += Math.min(2, Math.log10(p.assessedValue / 100_000 + 1) * 2);
  const seed = (p.seedPriority ?? "").toUpperCase();
  if (seed === "A") rank += 4;
  else if (seed === "B") rank += 2;
  else if (seed === "C") rank += 0.5;
  return Math.round(rank * 100) / 100;
}

/** The Monday a date falls in, as YYYY-MM-DD, in the business's time zone. */
export function weekOf(date: Date, timeZone = "America/New_York"): string {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const [y, m, d] = local.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const back = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

export interface WeekCandidate {
  id: string;
  status: string;
  weekOf: string | null;
  priority: number;
  acreage: number | null;
}

/**
 * This week's list: whatever is already on it, topped up from the best
 * properties nobody has looked at, up to the weekly count. A lot the roll
 * knows is under half an acre is not worth an hour's look.
 */
export function pickWeek<T extends WeekCandidate>(all: T[], week: string, count = LEAD_FINDER_WEEKLY_COUNT): { onList: T[]; added: T[] } {
  const onList = all.filter((p) => p.weekOf === week);
  const room = Math.max(0, count - onList.length);
  const added = all
    .filter((p) => p.status === "new" && !p.weekOf && (p.acreage == null || p.acreage >= LEAD_FINDER_MIN_ACRES))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, room);
  return { onList, added };
}

/* ------------------------------------------------------------ links */

/** Street View at the property: a plain Google Maps URL, no API key, nothing stored. */
export function streetViewUrl(p: { lat: number | null; lng: number | null; address: string; city?: string | null; zip?: string | null }): string {
  if (p.lat != null && p.lng != null) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress(p))}`;
}

/** The property on Google's satellite view, for when there is no Mapbox picture. */
export function satelliteLink(p: { lat: number | null; lng: number | null; address: string; city?: string | null; zip?: string | null }): string {
  if (p.lat != null && p.lng != null) {
    return `https://www.google.com/maps/@?api=1&map_action=map&center=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&zoom=19&basemap=satellite`;
  }
  return `https://maps.google.com/?q=${encodeURIComponent(fullAddress(p))}&t=k`;
}

/** A web search for the business, to find its site and phone by hand. */
export function contactSearchUrl(p: { name: string; city?: string | null }): string {
  return `https://www.google.com/search?q=${encodeURIComponent([p.name, p.city, "MD"].filter(Boolean).join(" "))}`;
}

/** The Mapbox satellite zoom for a lot: closer for small lots, wider for big ones. */
export function satelliteZoom(acreage: number | null): number {
  if (acreage == null) return 18;
  if (acreage < 1) return 19;
  if (acreage < 4) return 18;
  if (acreage < 15) return 17;
  return 16;
}

export function fullAddress(p: { address: string; city?: string | null; zip?: string | null }): string {
  return [p.address, p.city, ["MD", p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function formatAcres(acres: number): string {
  return `${acres >= 10 ? Math.round(acres) : Math.round(acres * 10) / 10} ac`;
}
