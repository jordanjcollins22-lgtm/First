/**
 * How big each spot a client marked is, and where that size came from.
 *
 * The estimate is only as good as the sizes under it. A tap is a point, so a
 * size has to come from somewhere, and these are the sources, best first:
 *
 *   1. "traced":  the client drew round it on the map, so the area is measured.
 *   2. "ai":      read off the satellite picture of that spot and the client's
 *                 photos of it.
 *   3. "history": what this business's own measured jobs say a spot like this
 *                 usually is (the median of the site maps evaluators drew).
 *   4. "typical": a stand-in from the lot size, when there is nothing better.
 *
 * Shared types only; the sources live in their own modules
 * (size-priors, ai-spot-size) and spot-price puts them together.
 */

/** Where a spot's size came from. */
export type SizeSource = "traced" | "ai" | "history" | "typical";

/** How far a size can be trusted. Sets how much cushion the price carries. */
export type SizeConfidence = "high" | "medium" | "low";

/**
 * What this business's measured jobs say a spot is usually like, by the rate
 * card service it is priced as (service_type_id). From the site maps
 * evaluators drew (canvas_designs zones), so it is the business's own yards,
 * not a guess.
 */
export interface SizePrior {
  serviceTypeId: string;
  /** Median area of one zone of this service, in square feet. Null when too few were measured. */
  medianSqft: number | null;
  /** Median count, for counted work (shrubs, plants). Null when not counted or too few. */
  medianCount: number | null;
  /** How many measured zones the medians are from. */
  samples: number;
}

export type SizePriors = Record<string, SizePrior>;

/** One spot's size, as read from the satellite picture and the client's photos. */
export interface AiSpotSize {
  /** The spot's position in the list the client sent. */
  index: number;
  /** The area to be worked, in square feet. Null when it can't be told. */
  areaSqft: number | null;
  /** For counted work: how many shrubs, plants and so on. Null when not counted. */
  count: number | null;
  confidence: SizeConfidence;
  /** One line, for the office: what was seen. Never shown to the client as a promise. */
  notes: string;
}

/** The size a spot was priced at, with where it came from. Kept with the estimate. */
export interface SpotSizing {
  index: number;
  /** The tap choice values priced on this spot. */
  choices: string[];
  areaSqft: number | null;
  count: number | null;
  source: SizeSource;
  confidence: SizeConfidence;
  /** In words, e.g. "Traced on the map", "From the satellite picture and your photos". */
  from: string;
  /** This spot's price, in cents, before the cushion. Null when it can only be priced at the visit. */
  priceCents: number | null;
}
