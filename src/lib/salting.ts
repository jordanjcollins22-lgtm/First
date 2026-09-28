import {
  DEFAULT_SALT_SETTINGS,
  MINIMUM_TREATMENTS,
  money,
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
    name: order.petFriendly ? "Calcium chloride, pet safe blend" : "Calcium chloride",
    pounds,
    bags: Math.ceil(pounds / Math.max(1, settings.bagPounds)),
    cents: Math.round(pounds * perPound),
  };
}

/**
 * A salting area's words brought to a new price, when the account manager
 * sets the job's price by hand: "3 treatments at $40 each, $120 in all"
 * becomes the new total, split over the same treatments. Words that are not
 * salting's are returned as they were.
 */
export function repriceSaltingScope(text: string, totalCents: number): string {
  return text.replace(/^Pre-paid salting: (\d+) treatments at \$[\d,.]+ each, \$[\d,.]+ in all/, (_, n: string) => {
    const treatments = Math.max(1, Number(n));
    const each = Math.round(totalCents / treatments);
    return `Pre-paid salting: ${treatments} treatments at ${money(each)} each, ${money(totalCents)} in all`;
  });
}

/** What the proposal says about it, in the client's words. */
export function saltingScope(values: Record<string, string | undefined>, settings: SaltSettings = DEFAULT_SALT_SETTINGS): string {
  const order = saltingOrder(values);
  const quote = quoteOrder(order, settings);
  const where = order.surfaceLabel.toLowerCase();
  return [
    `Pre-paid salting: ${quote.treatments} treatments at ${money(quote.perTreatmentCents)} each, ${money(quote.totalCents)} in all, on the ${where}.`,
    `Each treatment is calcium chloride, never rock salt, so the concrete isn't pitted${order.petFriendly ? ", in the pet safe blend" : ""}. We come out when ice is forecast or after a snow push.`,
    `Three treatments is the minimum to book. They are paid up front so the salt is bought ahead of the season.`,
    SALT_KEPT_LINE,
    `Snow removal, when you want it, is billed after each storm by how much fell.`,
  ].join(" ");
}
