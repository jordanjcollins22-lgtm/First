/**
 * How much to put down, and when a storm is worth starting an event for.
 *
 * Pure, so the numbers can be tested and argued with.
 *
 * The guidance this follows is SIMA's, as far as it is public: base the rate
 * on the *surface* temperature, not the air; rock salt stops working at about
 * 15°F, so below that it is a different product, not more of the same; and
 * pre-treating before the storm (anti-icing) means less goes down after it.
 * SIMA argues against fixed trigger depths for the same reason: a quarter
 * inch of freezing rain is more dangerous than two inches of dry snow.
 *
 * SIMA's own rate tables are a member resource and were not available, so
 * the pounds per thousand square feet below are a starting point in the
 * range public state and watershed guidance gives for parking lots and
 * walks. They are meant to be checked against what the crew actually spreads
 * in the first two storms, and the log this feeds is what makes that check
 * possible. Over-applying is the commoner fault: contractors put down about
 * a fifth more than they need, out of fear of a slip claim.
 */

export type SaltProduct = "rock_salt" | "calcium_chloride" | "pet_safe" | "treated_salt" | "brine" | "none";

export const PRODUCT_LABEL: Record<SaltProduct, string> = {
  rock_salt: "Rock salt",
  calcium_chloride: "Calcium chloride",
  pet_safe: "Pet safe blend",
  treated_salt: "Treated salt",
  brine: "Brine (liquid)",
  none: "No product",
};

export const PRODUCTS: SaltProduct[] = ["calcium_chloride", "pet_safe", "rock_salt", "treated_salt", "brine", "none"];

/**
 * Pounds relative to rock salt for the same job, and the coldest surface it
 * still works on. Calcium chloride goes down thinner and works far colder,
 * which is why this business uses it on concrete already.
 */
export const PRODUCT_FACTOR: Record<Exclude<SaltProduct, "brine" | "none">, { factor: number; worksDownToF: number }> = {
  rock_salt: { factor: 1, worksDownToF: 15 },
  treated_salt: { factor: 0.8, worksDownToF: 0 },
  pet_safe: { factor: 0.75, worksDownToF: 5 },
  calcium_chloride: { factor: 0.65, worksDownToF: -20 },
};

export interface RateBand {
  /** Surface temperature at or above which this band applies, °F. */
  fromF: number;
  /** Rock salt, pounds per 1,000 sq ft, on an untreated surface. */
  lbsPerK: number;
  /** The same, on a surface pre-treated before the storm. */
  pretreatedLbsPerK: number;
}

/** Warmest band first. The last band is the floor. */
export const RATE_BANDS: RateBand[] = [
  { fromF: 30, lbsPerK: 2.5, pretreatedLbsPerK: 1.5 },
  { fromF: 25, lbsPerK: 4, pretreatedLbsPerK: 2.5 },
  { fromF: 20, lbsPerK: 5.5, pretreatedLbsPerK: 3.5 },
  { fromF: 15, lbsPerK: 7.5, pretreatedLbsPerK: 5 },
  { fromF: -100, lbsPerK: 10, pretreatedLbsPerK: 7 },
];

/** Brine, gallons per 1,000 sq ft, laid before the storm. Not below 20°F, where it refreezes. */
export const BRINE_GAL_PER_K = 0.5;
export const BRINE_MIN_F = 20;

export function bandFor(surfaceTempF: number): RateBand {
  return RATE_BANDS.find((b) => surfaceTempF >= b.fromF) ?? RATE_BANDS[RATE_BANDS.length - 1];
}

export interface ApplicationInput {
  surfaceTempF: number;
  product: SaltProduct;
  pretreated: boolean;
  /** Paved area, when the contract records it. */
  areaSqft?: number | null;
  /**
   * What a treatment of this property takes on a mild day, in pounds of this
   * product: the salt settings' sidewalk and driveway pounds. Used when the
   * area is not known, scaled by how much colder it is than the mild band.
   */
  basePounds?: number | null;
  bagPounds?: number;
}

export interface ApplicationAdvice {
  /** Pounds of product to put down. Zero for brine or no product. */
  pounds: number;
  bags: number;
  /** Gallons, for brine. */
  gallons: number;
  /** False when the product will not work at this temperature. */
  works: boolean;
  /** One line for the crew, said plainly. */
  note: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What to put down at this stop.
 *
 * Says so when the product is wrong for the temperature rather than giving a
 * bigger number: more rock salt at 10°F is wasted salt and a slippery lot.
 */
export function recommendApplication(input: ApplicationInput): ApplicationAdvice {
  const bagPounds = Math.max(1, input.bagPounds ?? 50);
  const temp = input.surfaceTempF;

  if (input.product === "none") return { pounds: 0, bags: 0, gallons: 0, works: true, note: "No product: plow or shovel only." };

  if (input.product === "brine") {
    if (temp < BRINE_MIN_F) {
      return { pounds: 0, bags: 0, gallons: 0, works: false, note: `Too cold for brine (${temp}°F surface); it refreezes below ${BRINE_MIN_F}°F. Use calcium chloride.` };
    }
    const area = input.areaSqft && input.areaSqft > 0 ? input.areaSqft : null;
    const gallons = area ? round1((area / 1000) * BRINE_GAL_PER_K) : 0;
    return {
      pounds: 0,
      bags: 0,
      gallons,
      works: true,
      note: area ? `Pre-treat: about ${gallons} gal of brine (${BRINE_GAL_PER_K} gal per 1,000 sq ft).` : `Pre-treat at ${BRINE_GAL_PER_K} gal per 1,000 sq ft.`,
    };
  }

  const product = PRODUCT_FACTOR[input.product];
  if (temp < product.worksDownToF) {
    return {
      pounds: 0,
      bags: 0,
      gallons: 0,
      works: false,
      note: `${PRODUCT_LABEL[input.product]} stops working below about ${product.worksDownToF}°F (surface is ${temp}°F). Use calcium chloride, or sand for traction.`,
    };
  }

  const band = bandFor(temp);
  const perK = (input.pretreated ? band.pretreatedLbsPerK : band.lbsPerK) * product.factor;
  let pounds: number;
  if (input.areaSqft && input.areaSqft > 0) {
    pounds = (input.areaSqft / 1000) * perK;
  } else if (input.basePounds && input.basePounds > 0) {
    // The base is a mild-day, untreated amount of this product already.
    const mild = RATE_BANDS[0].lbsPerK;
    pounds = input.basePounds * ((input.pretreated ? band.pretreatedLbsPerK : band.lbsPerK) / mild);
  } else {
    pounds = 0;
  }
  pounds = round1(pounds);
  const bags = pounds > 0 ? Math.ceil((pounds / bagPounds) * 10) / 10 : 0;
  const rate = `${round1(perK)} lb per 1,000 sq ft`;
  return {
    pounds,
    bags,
    gallons: 0,
    works: true,
    note:
      pounds > 0
        ? `About ${pounds} lb of ${PRODUCT_LABEL[input.product].toLowerCase()} at ${temp}°F${input.pretreated ? ", pre-treated" : ""} (${rate}).`
        : `${rate} at ${temp}°F${input.pretreated ? ", pre-treated" : ""}.`,
  };
}

/* -------------------------------------------------------------------------
 * Whether the forecast is worth an event
 * ---------------------------------------------------------------------- */

export interface ForecastDay {
  date: string;
  snowIn: number;
  rainIn: number;
  code: number;
  tempMinF: number;
  tempMaxF: number;
}

export interface SnowSuggestion {
  date: string;
  service: "salt" | "plow";
  snowIn: number;
  lowF: number;
  /** Why, in a sentence, with the pre-treat advice when it applies. */
  note: string;
}

const FREEZING_RAIN = new Set([56, 57, 66, 67]);

/**
 * The first day in the forecast that needs the crew out.
 *
 * Not a fixed trigger depth, because SIMA argues against them: freezing rain
 * or any snow on a day that gets to freezing suggests a salt event, and only
 * whether to plow as well depends on depth.
 */
export function suggestSnowEvent(days: readonly ForecastDay[], triggerIn: number): SnowSuggestion | null {
  for (const day of days) {
    const freezingRain = FREEZING_RAIN.has(day.code);
    const freezingSnow = day.snowIn > 0 && day.tempMinF <= 32;
    if (!freezingRain && !freezingSnow) continue;
    const plow = day.snowIn >= triggerIn;
    const what = freezingRain ? "freezing rain" : `${Math.round(day.snowIn * 10) / 10} in of snow`;
    const pretreat =
      day.tempMinF >= BRINE_MIN_F
        ? " Pre-treat with brine the afternoon before if the lots are dry."
        : " Too cold to pre-treat with brine; go straight to calcium chloride.";
    return {
      date: day.date,
      service: plow ? "plow" : "salt",
      snowIn: day.snowIn,
      lowF: day.tempMinF,
      note: `${what} forecast, low of ${Math.round(day.tempMinF)}°F.${plow ? ` Over the ${triggerIn} in plow trigger.` : ""}${pretreat}`,
    };
  }
  return null;
}
