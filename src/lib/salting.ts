import { billedHours, priceForTarget } from "@/lib/gross-profit";
import {
  DEFAULT_SALT_SETTINGS,
  MINIMUM_TREATMENTS,
  money,
  ON_SITE_MINUTES,
  poundsFor,
  priceTreatment,
  quoteOrder,
  SALT_KEPT_LINE,
  type SaltQuote,
  type SaltSettings,
  type Surface,
} from "@/lib/salt";

/**
 * Salting sold off the site map, the same way the salt page sells it.
 *
 * A salting area on a property is priced by the salt route's own rules --
 * what is treated, how many treatments, whether it is the pet safe blend --
 * not by the square foot like a landscaping job, because what it costs is
 * the trip, not the ground. Three treatments is the minimum to book, and
 * they are paid up front, which is what lets the salt be bought before the
 * season rather than in the week of the first storm.
 *
 * Pure, so the pricing is tested without a database.
 */

export const SALTING_TYPE_ID = "salting";

/** The snow melts as they are named in the inventory, with their photo and where to buy. */
export const SNOW_MELT = "Calcium chloride snow melt";
export const SNOW_MELT_PET = "Pet friendly snow melt (calcium chloride)";

/** What the evaluator picks on the site map, and the surface each one is priced as. */
export const SALTING_SURFACES: { label: string; surface: Surface }[] = [
  { label: "Driveway and walkways", surface: "both" },
  { label: "Driveway", surface: "driveway" },
  { label: "Sidewalks and walkways", surface: "sidewalks" },
];

export const SALTING_TREATMENT_OPTIONS = ["3", "4", "5", "6", "8", "10"];

export interface SaltingOrder {
  surface: Surface;
  surfaceLabel: string;
  treatments: number;
  petFriendly: boolean;
}

export function isSalting(typeId: string | null | undefined): boolean {
  return typeId === SALTING_TYPE_ID;
}

/** The order an area's answers describe, held to the minimum. */
export function saltingOrder(values: Record<string, string | undefined> = {}): SaltingOrder {
  const picked = SALTING_SURFACES.find((s) => s.label === values.surface) ?? SALTING_SURFACES[0];
  const treatments = Math.max(MINIMUM_TREATMENTS, Math.round(Number(values.treatments) || MINIMUM_TREATMENTS));
  return { surface: picked.surface, surfaceLabel: picked.label, treatments, petFriendly: values.petSafe === "Yes" };
}

export interface SaltingCost {
  quote: SaltQuote;
  /** What the product costs us for the whole order, in cents. */
  materialsCents: number;
  labourCents: number;
  overheadCents: number;
  /** What the client is quoted: the per-treatment price times the treatments. */
  priceCents: number;
  /** Crew-hours across every treatment. */
  crewHours: number;
  pounds: number;
}

/** An area's salting, priced exactly as the salt page would price the same order. */
export function costSalting(values: Record<string, string | undefined>, settings: SaltSettings = DEFAULT_SALT_SETTINGS): SaltingCost {
  const order = saltingOrder(values);
  const quote = quoteOrder(order, settings);
  const one = priceTreatment(order.surface, order.petFriendly, settings);
  return {
    quote,
    materialsCents: one.materialCents * quote.treatments,
    labourCents: one.labourCents * quote.treatments,
    overheadCents: one.overheadCents * quote.treatments,
    priceCents: quote.totalCents,
    crewHours: (one.minutes / 60) * quote.treatments,
    pounds: quote.pounds,
  };
}

/** The product to buy ahead for this order, named the way the supplier sells it. */
export function saltingMaterial(values: Record<string, string | undefined>, settings: SaltSettings = DEFAULT_SALT_SETTINGS) {
  const order = saltingOrder(values);
  const pounds = Math.round(poundsFor(order.surface, settings) * Math.max(MINIMUM_TREATMENTS, order.treatments) * 10) / 10;
  const perPound = (order.petFriendly ? settings.petBagCostCents : settings.bagCostCents) / Math.max(1, settings.bagPounds);
  return {
    // Named as it is in the inventory, so the price approval finds its photo and link.
    name: order.petFriendly ? SNOW_MELT_PET : SNOW_MELT,
    pounds,
    bags: Math.ceil(pounds / Math.max(1, settings.bagPounds)),
    cents: Math.round(pounds * perPound),
  };
}

/** One salting area's visits priced by the rules every service is held to. */
export interface SaltingVisits {
  treatments: number;
  /** This area's time on site for one treatment. */
  onSiteMinutes: number;
  /** Shop to the house and back, for one visit: once for the house, however many areas. */
  travelMinutes: number;
  /** This area's share of the visit on the clock, in hours. */
  billedHours: number;
  /** The whole visit on the clock, in whole hours, one at the least. */
  visitBilledHours?: number;
  /** How many salting areas are done on the one visit. */
  areasOnVisit?: number;
  /** This area's share of a visit's labour, in cents. */
  labourCents: number;
  materialCents: number;
  /** What the salt page charges a treatment. */
  saltPageCents: number;
  /** What a treatment is priced at: the salt page's, or more to reach the gross profit floor. */
  perVisitCents: number;
  totalCents: number;
  /** Raised over the salt page's price to reach the floor. */
  lifted: boolean;
}

type SaltingTrip = { toSiteMinutes: number | null; fromSiteMinutes: number | null; crewCostPerHourCents: number; feePct: number; fallbackDriveMinutes?: number };

/**
 * Salting a visit at a time, held to the same rules as every service: the
 * crew's time from the shop to the house, the treatment and back, charged in
 * whole hours, an hour at the least; the salt; and never under half the
 * price as gross profit after the account manager's or affiliate's share.
 * The salt page's price stands when it is already over that.
 */
export function priceSaltingVisits(values: Record<string, string | undefined>, settings: SaltSettings, trip: SaltingTrip): SaltingVisits {
  return priceSaltingTogether([values], settings, trip)[0];
}

/**
 * Every salting area at one house, salted on the one visit: one drive there
 * and back, one hour's minimum, the time on site added up. Each area carries
 * its share of that visit's labour by its time on site, so a driveway and two
 * walkways are one stop, not three.
 */
export function priceSaltingTogether(areas: Record<string, string | undefined>[], settings: SaltSettings, trip: SaltingTrip): SaltingVisits[] {
  const fallback = trip.fallbackDriveMinutes ?? 30;
  const to = trip.toSiteMinutes ?? fallback;
  const back = trip.fromSiteMinutes ?? trip.toSiteMinutes ?? fallback;
  const each = areas.map((values) => {
    const order = saltingOrder(values);
    const treatment = priceTreatment(order.surface, order.petFriendly, settings);
    // On the ground only: the drive is added once below, for the whole house.
    return { quote: quoteOrder(order, settings), one: { ...treatment, minutes: ON_SITE_MINUTES[order.surface] } };
  });
  const onSite = each.reduce((sum, a) => sum + a.one.minutes, 0);
  const hours = billedHours((onSite + to + back) / 60);
  const visitLabourCents = Math.round(hours * Math.max(0, trip.crewCostPerHourCents));
  let labourLeft = visitLabourCents;
  return each.map(({ quote, one }, index) => {
    const share = onSite > 0 ? one.minutes / onSite : 1 / each.length;
    // The last area takes what rounding left, so the shares add up to the visit.
    const labourCents = index === each.length - 1 ? labourLeft : Math.round(visitLabourCents * share);
    labourLeft -= labourCents;
    const floor = priceForTarget(labourCents, one.materialCents, trip.feePct) ?? 0;
    const perVisitCents = Math.max(quote.perTreatmentCents, floor);
    return {
      treatments: quote.treatments,
      onSiteMinutes: one.minutes,
      travelMinutes: Math.round(to + back),
      billedHours: hours * share,
      visitBilledHours: hours,
      areasOnVisit: each.length,
      labourCents,
      materialCents: one.materialCents,
      saltPageCents: quote.perTreatmentCents,
      perVisitCents,
      totalCents: perVisitCents * quote.treatments,
      lifted: perVisitCents > quote.perTreatmentCents,
    };
  });
}

/**
 * A salting area's words brought to a new price, when the account manager
 * sets the job's price by hand: "3 applications included in this quote,
 * $120 in all" becomes the new total. The client is told the total, never a
 * price a visit. Words that are not salting's are returned as they were.
 */
export function repriceSaltingScope(text: string, totalCents: number): string {
  return text.replace(
    /^Pre-paid salting: (\d+) (?:treatments at \$[\d,.]+ each|applications included in this quote(?:, at \$[\d,.]+ each)?), \$[\d,.]+ in all/,
    (_, n: string) => `Pre-paid salting: ${Math.max(1, Number(n))} applications included in this quote, ${money(totalCents)} in all`
  );
}

/** What the proposal says about it, in the client's words: the total at the salt page's price, or at the one given a treatment. */
export function saltingScope(
  values: Record<string, string | undefined>,
  settings: SaltSettings = DEFAULT_SALT_SETTINGS,
  perTreatmentCents?: number,
  /** Where it goes, in the client's words, when it is more than one area: "the driveway and the back deck". */
  areas?: string
): string {
  const order = saltingOrder(values);
  const quote = quoteOrder(order, settings);
  const where = areas ?? `the ${order.surfaceLabel.toLowerCase()}`;
  const each = perTreatmentCents ?? quote.perTreatmentCents;
  return [
    `Pre-paid salting: ${quote.treatments} applications included in this quote, ${money(each * quote.treatments)} in all, on ${where}.`,
    // The pet blend is named for what it is to the client: a pet friendly snow melt.
    order.petFriendly
      ? `Each application is a pet friendly snow melt, never rock salt, so the concrete isn't pitted. We come out when ice is forecast or after a snow push.`
      : `Each application is calcium chloride, never rock salt, so the concrete isn't pitted. We come out when ice is forecast or after a snow push.`,
    `Three applications is the minimum to book. They are paid up front, so your salt is bought and set aside before the season.`,
    // Stored for them until a storm, and again after it if it isn't used: part of the price.
    SALT_KEPT_LINE,
    `Snow removal, when you want it, is billed after each storm by how much fell.`,
  ].join(" ");
}

/**
 * Every salting area at one house, sold as one: one line on the proposal,
 * one price, one visit. The surface is what they add up to (a driveway and
 * a walk is "Driveway and walkways"), the pet blend if any area wants it,
 * and the most treatments any area was given.
 */
export function combinedSaltingValues(areas: Record<string, string | undefined>[]): Record<string, string> {
  const orders = areas.map((values) => ({ values, order: saltingOrder(values) }));
  // An area named in its own words ("Back deck", "Stairs") is walked and
  // salted like a walkway.
  const surfaces = new Set(orders.map(({ values, order }) => (values.surface === "Other" ? "sidewalks" : order.surface)));
  const surface: Surface =
    surfaces.has("both") || (surfaces.has("driveway") && surfaces.has("sidewalks")) ? "both" : surfaces.has("driveway") ? "driveway" : "sidewalks";
  return {
    surface: SALTING_SURFACES.find((s) => s.surface === surface)!.label,
    petSafe: orders.some(({ order }) => order.petFriendly) ? "Yes" : "No",
    treatments: String(Math.max(MINIMUM_TREATMENTS, ...orders.map(({ order }) => order.treatments))),
  };
}

/** The areas in the client's words: "the driveway, the sidewalks and walkways and the back deck". */
export function saltingAreas(areas: Record<string, string | undefined>[]): string {
  const names: string[] = [];
  for (const values of areas) {
    const own = values.surface === "Other" ? values.surface__other?.trim() : null;
    const name = (own || saltingOrder(values).surfaceLabel).toLowerCase();
    if (!names.includes(name)) names.push(name);
  }
  const the = names.map((n) => `the ${n}`);
  return the.length <= 1 ? (the[0] ?? "the driveway and walkways") : `${the.slice(0, -1).join(", ")} and ${the[the.length - 1]}`;
}
