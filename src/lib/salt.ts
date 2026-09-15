/**
 * Prepaid ice melt, sold three treatments at a time.
 *
 * A salting round is not a landscaping job and pricing it like one gets it
 * wrong in a way that is easy to miss. The product is almost free: calcium
 * chloride goes down thin, and a residential sidewalk takes a pound or two of
 * it, which is under two dollars. What costs money is the trip. Somebody has
 * to get in the truck at five in the morning, drive there, do fifteen minutes
 * of work and drive to the next one, and that is true whether they spread one
 * pound or five.
 *
 * So the price is mostly time, and the thing that makes the round profitable
 * is not charging more per bag, it is having the next house on the same
 * street. That is also why the minimum is three treatments prepaid: a single
 * call-out in a storm is a loss, and three of them booked before the season
 * turns a route into something worth driving.
 *
 * Every input is a setting rather than a constant, because the two that
 * matter most -- what a bag costs and how long a stop takes -- are things
 * only the business knows, and they move. The defaults here are a starting
 * point to be checked against a real invoice, not a claim about what anything
 * costs.
 */

export type Surface = "sidewalks" | "driveway" | "both";

export const SURFACES: Surface[] = ["sidewalks", "driveway", "both"];

export const SURFACE_LABEL: Record<Surface, string> = {
  sidewalks: "Sidewalks and walkways",
  driveway: "Driveway",
  both: "Both",
};

/** The fewest treatments worth putting a truck on the road for. */
export const MINIMUM_TREATMENTS = 3;

export interface SaltSettings {
  /** What a bag of calcium chloride costs us, in cents. */
  bagCostCents: number;
  /** What a bag of the pet safe blend costs us, in cents. */
  petBagCostCents: number;
  /** Pounds in a bag. */
  bagPounds: number;
  /** Product spread on a sidewalk run, in pounds. */
  sidewalkPounds: number;
  /** Product spread on a driveway, in pounds. */
  drivewayPounds: number;
  /** Minutes a sidewalk stop takes, including its share of the driving. */
  sidewalkMinutes: number;
  /** Minutes a driveway adds. */
  drivewayMinutes: number;
  /** What one crew-hour costs us, in cents. */
  crewCostPerHourCents: number;
  /** What one crew-hour owes the overhead, in cents. */
  overheadPerCrewHourCents: number;
  /** What direct cost is multiplied by. The same rule as every other quote. */
  multiplier: number;
  /**
   * What the pet safe blend adds to a treatment, in cents.
   *
   * Zero by default, and deliberately. The blend costs us about a dollar more
   * a stop, and "pet safe at no extra charge" sells better than a dollar
   * recovers. It is a setting rather than a constant because that is a
   * judgement about selling, not a fact about cost, and it may stop being
   * true if the blend gets dear.
   */
  petSurchargeCents: number;
}

/**
 * Where the numbers start before anybody has checked an invoice.
 *
 * Two of these are guesses and are the two worth correcting first: what a bag
 * actually costs, and how long a stop actually takes. The rest follow from
 * them. Calcium chloride is spread far thinner than rock salt, which is why
 * the poundage looks low next to what a hardware store bag suggests.
 */
export const DEFAULT_SALT_SETTINGS: SaltSettings = {
  bagCostCents: 3_200,
  petBagCostCents: 4_500,
  bagPounds: 50,
  sidewalkPounds: 2,
  drivewayPounds: 5,
  sidewalkMinutes: 20,
  drivewayMinutes: 15,
  crewCostPerHourCents: 2_667,
  overheadPerCrewHourCents: 1_583,
  multiplier: 2,
  petSurchargeCents: 0,
};

/** Pounds of product one treatment of this surface takes. */
export function poundsFor(surface: Surface, settings: SaltSettings): number {
  if (surface === "sidewalks") return settings.sidewalkPounds;
  if (surface === "driveway") return settings.drivewayPounds;
  return settings.sidewalkPounds + settings.drivewayPounds;
}

/** Minutes one treatment of this surface takes, driving included. */
export function minutesFor(surface: Surface, settings: SaltSettings): number {
  if (surface === "sidewalks") return settings.sidewalkMinutes;
  // A driveway on its own still needs somebody to get there, so it carries
  // the stop as well as its own work. Only doing both shares the trip.
  if (surface === "driveway") return settings.sidewalkMinutes + settings.drivewayMinutes - 5;
  return settings.sidewalkMinutes + settings.drivewayMinutes;
}

export interface TreatmentPrice {
  surface: Surface;
  petFriendly: boolean;
  /** What the product costs us. Nearly nothing, which is the point. */
  materialCents: number;
  labourCents: number;
  overheadCents: number;
  /** What we charge for one treatment, rounded to something readable. */
  priceCents: number;
  pounds: number;
  minutes: number;
}

/**
 * Prices are rounded to the nearest five dollars.
 *
 * A form selling three treatments for $90.81 looks like a machine worked it
 * out, which invites the question of how, and the answer takes longer than
 * the sale. Round numbers read as a price somebody set.
 */
const ROUND_TO_CENTS = 500;

export function priceTreatment(
  surface: Surface,
  petFriendly: boolean,
  settings: SaltSettings = DEFAULT_SALT_SETTINGS
): TreatmentPrice {
  const pounds = poundsFor(surface, settings);
  const minutes = minutesFor(surface, settings);
  const hours = minutes / 60;

  const perPound =
    (petFriendly ? settings.petBagCostCents : settings.bagCostCents) /
    Math.max(1, settings.bagPounds);
  const materialCents = Math.round(pounds * perPound);
  const labourCents = Math.round(hours * settings.crewCostPerHourCents);

  // The same rule as every other quote: cost, times the multiplier, then the
  // overhead charged on the hours rather than on the dollars.
  const direct = materialCents + labourCents;
  const overheadCents = Math.round(hours * settings.overheadPerCrewHourCents);
  const raw = direct * settings.multiplier + overheadCents;

  return {
    surface,
    petFriendly,
    materialCents,
    labourCents,
    overheadCents,
    // Rounded first, then the surcharge, so ticking the pet safe box moves
    // the price by exactly what the box says it does rather than by whatever
    // the rounding happens to do next.
    priceCents:
      Math.max(ROUND_TO_CENTS, Math.round(raw / ROUND_TO_CENTS) * ROUND_TO_CENTS) +
      (petFriendly ? Math.max(0, settings.petSurchargeCents) : 0),
    pounds,
    minutes,
  };
}

export interface SaltQuote {
  surface: Surface;
  petFriendly: boolean;
  treatments: number;
  perTreatmentCents: number;
  totalCents: number;
  /** Product the whole order will take, in pounds. */
  pounds: number;
}

/**
 * What an order comes to.
 *
 * The treatment count is floored at the minimum rather than rejected. A form
 * that refuses a number is a form somebody abandons; one that quietly holds
 * the floor and shows the price for it is a form somebody finishes.
 */
export function quoteOrder(
  input: { surface: Surface; petFriendly: boolean; treatments: number },
  settings: SaltSettings = DEFAULT_SALT_SETTINGS
): SaltQuote {
  const treatments = Math.max(
    MINIMUM_TREATMENTS,
    Math.min(40, Math.round(Number(input.treatments) || MINIMUM_TREATMENTS))
  );
  const price = priceTreatment(input.surface, input.petFriendly, settings);

  return {
    surface: input.surface,
    petFriendly: input.petFriendly,
    treatments,
    perTreatmentCents: price.priceCents,
    totalCents: price.priceCents * treatments,
    pounds: Math.round(price.pounds * treatments * 10) / 10,
  };
}

/** Whether this is a real surface, for a value that came off a form. */
export function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && (SURFACES as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// What to buy
// ---------------------------------------------------------------------------

export interface OrderedTreatment {
  surface: Surface;
  petFriendly: boolean;
  treatments: number;
  /** Treatments already used. What is left is what still has to be covered. */
  used: number;
}

export interface BuyingList {
  /** Pounds of ordinary calcium chloride still owed. */
  standardPounds: number;
  /** Pounds of the pet safe blend still owed. */
  petPounds: number;
  standardBags: number;
  petBags: number;
  standardCostCents: number;
  petCostCents: number;
  totalCostCents: number;
  /** Treatments sold and not yet delivered. */
  outstanding: number;
}

/**
 * What still has to be bought to cover what has been sold.
 *
 * Counted on treatments owed rather than treatments sold, so a season half
 * delivered does not keep asking for product that is already spread. Bags are
 * rounded up, because half a bag is not a thing anybody can order.
 *
 * The pet safe product is kept apart rather than added in. It is a different
 * bag at a different price and cannot be substituted, and a single figure
 * would send somebody to the supplier with the wrong basket.
 */
export function buyingList(
  orders: readonly OrderedTreatment[],
  settings: SaltSettings = DEFAULT_SALT_SETTINGS
): BuyingList {
  let standardPounds = 0;
  let petPounds = 0;
  let outstanding = 0;

  for (const order of orders) {
    const left = Math.max(0, order.treatments - Math.max(0, order.used));
    if (left === 0) continue;
    outstanding += left;
    const pounds = poundsFor(order.surface, settings) * left;
    if (order.petFriendly) petPounds += pounds;
    else standardPounds += pounds;
  }

  const bagPounds = Math.max(1, settings.bagPounds);
  const standardBags = Math.ceil(standardPounds / bagPounds);
  const petBags = Math.ceil(petPounds / bagPounds);
  const standardCostCents = standardBags * settings.bagCostCents;
  const petCostCents = petBags * settings.petBagCostCents;

  return {
    standardPounds: Math.round(standardPounds * 10) / 10,
    petPounds: Math.round(petPounds * 10) / 10,
    standardBags,
    petBags,
    standardCostCents,
    petCostCents,
    totalCostCents: standardCostCents + petCostCents,
    outstanding,
  };
}

/** Dollars, whole where they are whole. */
export function money(cents: number): string {
  const value = cents / 100;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

/**
 * Why we use calcium chloride, said the way a client would want to hear it.
 *
 * Worth putting on the form rather than in a policy somewhere. Rock salt
 * spalls concrete, and a client who has had a sidewalk wrecked by a previous
 * contractor is looking for exactly this sentence.
 */
export const PRODUCT_NOTE =
  "We use calcium chloride on sidewalks and walkways, never rock salt. Rock salt eats into " +
  "concrete and leaves it pitted and flaking after a couple of winters. Calcium chloride works " +
  "colder, goes down thinner, and does not do that.";

export const PET_NOTE =
  "A pet safe blend instead, for anyone with dogs going out on the walkway. Gentler on paws, and " +
  "we do not charge extra for it.";
