/**
 * The estimate from the map, one spot at a time.
 *
 * The form's price (instant-price) sizes the work from fixed shares of the
 * county lot and pools every tap by service, so one small bed and six big
 * ones come out the same. Here each spot the client tapped is priced on its
 * own, at its own size, and the sizes come from the best source there is
 * for that spot (spot-sizing.ts):
 *
 *   traced   the client drew round it on the map: measured.
 *   ai       read off the satellite picture and their photos.
 *   history  the median of this business's own measured zones of that service.
 *   typical  instant-price's lot share, for one spot of that part of the yard.
 *
 * A low-confidence reading from the pictures is still used, but only when
 * the business's own history has nothing to say, because a median of real
 * yards beats a guess the model itself doubts.
 *
 * Every size is worked into dollars by the same arithmetic as the form's
 * price (priceWork: rate card timing, materials, markup and overhead), so
 * the two differ only in the sizes, never in what a square foot costs.
 *
 * In place of the form's flat unseen premium, each line carries a cushion
 * for how far its size can be trusted: little on a traced bed, more on a
 * guess. The cushions are the constants below, to be tuned as estimates are
 * compared with what the visits found.
 *
 * Pure, so the pricing is tested without a database or a network.
 */

import {
  AREA_SHARE,
  clamp,
  flatHoursFor,
  PART_NAME,
  priceWork,
  sqft,
  TYPICAL_LOT_SQFT,
  type InstantCatalog,
  type InstantLine,
  type InstantPrice,
  type InstantWork,
} from "@/lib/instant-price";
import { areaChoiceFor } from "@/lib/ai-spot-size";
import { productionService } from "@/lib/forward-pricing";
import { choiceLabel } from "@/lib/tap-estimate";
import type { AiSpotSize, SizeConfidence, SizePriors, SizeSource, SpotSizing } from "@/lib/spot-sizing";

/* ------------------------------------------------------------ the knobs */

/**
 * The cushion on a line's price, by how its size was reached. A traced
 * outline is measured, but the edge a finger draws on a phone is a foot or
 * so out either way, and the ground under the mulch is unseen: a little.
 * A clear reading from the pictures: a little more. The business's own
 * median, or a reading the model wasn't sure of: the middle. A share of the
 * lot: a quarter, more than the form's flat 20% because one spot can be far
 * off a share where a whole yard averages out.
 */
export const CUSHION = {
  traced: 0.06,
  high: 0.08,
  medium: 0.15,
  low: 0.25,
  typical: 0.25,
} as const;

/** Estimates are given in steps of $25, like the form's price. */
const ROUND_TO_CENTS = 2500;

/**
 * Fewer measured zones than this and a median is one or two yards, not a
 * pattern. The same floor size-priors uses, held here too so a prior built
 * some other way can't slip under it.
 */
export const MIN_PRIOR_SAMPLES = 5;

/**
 * How much of one part of the yard a single bed is, for a spot with no other
 * size. The form's price takes 12% of the yard for all the beds; one tapped
 * bed is one of those, in its part. Round the house is different: that strip
 * is mostly beds, so a bed there is half of it.
 */
const BED_SHARE: Record<string, number> = { front: 0.12, back: 0.12, sides: 0.12, foundation: 0.5 };
/** A weedy spot: a quarter of its part, as the form's cleanup. */
const CLEANUP_SHARE = 0.25;
/** A lawn spot is a bare or thin patch: 15% of the lawn, which is 70% of the part. */
const LAWN_PATCH_SHARE = 0.7 * 0.15;
/** A tap with no part of the yard (off the county's lines, or no lot): about a front yard. */
const UNKNOWN_PART_SHARE = 0.25;

/**
 * One spot's guessed size (a share of the lot, or the business's median) is
 * held between these, by what it is. A median is of the zones evaluators
 * drew, and some of those are a whole yard's cleanup or a whole house's
 * wash, so it is held to one spot's worth too.
 */
const SPOT_LIMITS: Record<string, [number, number]> = {
  "landscape-bed": [60, 1000],
  "landscape-cleanup": [60, 2000],
  "lawn-restoration": [50, 5000],
  grading: [100, 600],
  "soft-washing": [200, 6000],
};

/**
 * A measured size (traced, or read off the pictures) is held between these,
 * and never past the whole open yard. Wider than the guessed limits, since a
 * measurement can rightly find a big bed, but a bed bigger than a tennis
 * court is a misreading, a stray outline or a steered answer, not one spot.
 * A size that had to be held is trusted a step less, so it carries more
 * cushion.
 */
const MEASURED_LIMITS: Record<string, [number, number]> = {
  "landscape-bed": [10, 2500],
  "landscape-cleanup": [20, 5000],
  "lawn-restoration": [20, 15_000],
  // The real fix for water is set at the visit. The estimate holds it to a
  // big wet corner, so a reading of the whole back yard can't become a
  // $3,000 regrade and a deposit to match.
  grading: [50, 600],
};

/**
 * A reading from the pictures this many times the business's own median
 * for the service, or this many times smaller, is more likely a misreading
 * (or a picture steering the answer) than an unusual yard, so the median is
 * used instead.
 */
const DISAGREES_WITH_HISTORY = 4;

/**
 * All the guessed spots (history or typical) of one service in one part of
 * the yard together come to no more than this share of that part's open
 * ground. Three taps along one strip are one bed, not three; when the taps
 * add up to more, each is cut back in proportion. Measured spots are left
 * alone: they are their own sizes, and the picture is shown the other pins
 * so it measures only its own part. Round the house the strip is mostly beds.
 */
const PART_CAP: Record<string, number> = { "landscape-bed": 0.35, "landscape-cleanup": 0.5, "lawn-restoration": 0.5 };
const FOUNDATION_BED_CAP = 0.6;

/** A wet corner: what the form's price assumes for a drainage problem. */
const TYPICAL_WATER_SQFT = 300;

/**
 * Counted work on one spot, when nothing says how many. The form's price
 * assumes 8 shrubs trimmed over the whole yard, so one spot is about half
 * that; 2 bushes out of one bed; and the form's 5 plants for a first planting.
 */
const TYPICAL_SPOT_COUNT: Record<string, number> = { trimming: 4, "plant-bush-removal": 2, "plant-installation": 5 };

/**
 * Bushes to trim in a bed whose size is known: about one per 30 sq ft,
 * shrubs a landscaper would plant three to four feet apart with some open
 * ground. Only used for trimming (a client wanting bushes out of a bed may
 * want two of them, not all), and capped at what a bed sensibly holds.
 */
const SQFT_PER_SHRUB = 30;
const MAX_DERIVED_SHRUBS = 40;

/**
 * Weeding a bed that is being re-mulched the same day takes about half as
 * long: the bed prep clears the surface, so only the roots are left to pull.
 */
const WEEDS_UNDER_NEW_BED = 0.5;

/** Siding to wash, as the form's price works it from the house's size. */
const SIDING_PER_HOUSE_SQFT = 0.9;
/** Wall height per storey for a house traced round on the map, to the eaves. */
const WALL_HEIGHT_FT = 10;
/**
 * The county's living area is every floor, and a traced outline is the
 * footprint, so the one over the other is about how many storeys there are.
 * Held to what a crew washes from the ground and ladders.
 */
const MAX_STOREYS = 3;
/** Taller walls take longer, by the form's own factors. */
const STOREY_HOURS: Record<number, number> = { 2: 1.3, 3: 1.6 };

/**
 * Where the rate card has no timing, the production rates (forward-pricing)
 * are the owner's own figures and beat the form's rough ones: hand weed
 * pulling at 600 sq ft a crew-hour, for one, against a light cleanup rate.
 * They are for a crew of two, so a crew-hour there is two person-hours here,
 * where hours are each person's (priced at the blended crew rate).
 */
const PRODUCTION_RATE_FOR: Record<string, string> = {
  "landscape-cleanup": "weed-pulling",
  trimming: "shrub-trimming",
  "plant-bush-removal": "plant-removal-medium",
};
const PRODUCTION_CREW = 2;

/* ------------------------------------------------------- what each is */

interface ChoiceWork {
  /** The rate card service it is priced as; null for work set at the visit. */
  typeId: string | null;
  /** The form's service, so the line reads like the form's lines. */
  service: string;
  /** Sized by area, by count, or not at all. */
  kind: "area" | "count" | "visit";
  /** What is counted, plural. */
  countOf?: string;
  values?: Record<string, string>;
  /** The line's words, after "Spot n:". */
  what: string;
  note?: string;
}

const WORK: Record<string, ChoiceWork> = {
  mulch: { typeId: "landscape-bed", service: "beds", kind: "area", values: { material: "Mulch" }, what: "bed prep and fresh mulch" },
  rock: { typeId: "landscape-bed", service: "beds", kind: "area", values: { material: "Rock" }, what: "bed prep and river rock" },
  weeds: { typeId: "landscape-cleanup", service: "cleanup", kind: "area", what: "weeds and cleanup" },
  lawn: { typeId: "lawn-restoration", service: "lawn", kind: "area", what: "fix the bare and thin lawn", note: "Priced as seed. Sod costs more and is priced on the visit." },
  water: { typeId: "grading", service: "drainage", kind: "area", what: "regrade for the water", note: "The real fix is set on the visit." },
  wash: { typeId: "soft-washing", service: "washing", kind: "area", what: "soft wash the house" },
  trim: { typeId: "trimming", service: "cleanup", kind: "count", countOf: "shrubs", what: "trim the bushes" },
  remove: { typeId: "plant-bush-removal", service: "removal", kind: "count", countOf: "shrubs", what: "take out bushes, roots and all" },
  plants: {
    typeId: "plant-installation",
    service: "beds",
    kind: "count",
    countOf: "plants",
    what: "plant new plants",
    note: "Labour only. The plants themselves are picked and priced on the visit.",
  },
  patio: { typeId: null, service: "hardscape", kind: "visit", what: "patio or walkway" },
  other: { typeId: null, service: "other", kind: "visit", what: "take a look" },
};

/**
 * The choices that are one bed: mulch, rock and weeds on a spot are worked
 * on the same ground, so they share one size. A lawn patch, a wet patch and
 * the house are other ground and are sized on their own, never on the bed's
 * size (that priced a bed and the lawn beside it each on the two together).
 */
const BED_CHOICES = ["mulch", "rock", "weeds"];

/** Counted choices, which stand in a bed: the same order ai-spot-size asks its one count in. */
const COUNT_ORDER = ["remove", "trim", "plants"];

/* ------------------------------------------------------------- sizing */

/** One size, with where it came from. */
interface Size {
  value: number;
  source: SizeSource;
  confidence: SizeConfidence;
  /** In words, for the line: "traced on the map". */
  from: string;
}

export interface SpotInput {
  index: number;
  choices: string[];
  /** The area inside what the client drew round it, when they did. */
  tracedSqft: number | null;
  /** front, back, sides or foundation, from the county lot; null when unknown. */
  area: string | null;
}

export interface PriceSpotsInput {
  spots: SpotInput[];
  /**
   * The picture's readings. Each is of the one surface areaChoiceFor names
   * for its spot (the bed, else the lawn patch, and so on), so it sizes only
   * that; the rest of the spot is sized from history or the lot.
   */
  ai: AiSpotSize[];
  priors: SizePriors;
  lot: { lotSqft: number | null; structureSqft: number | null } | null;
  catalog: InstantCatalog;
}

const RANK: Record<SizeConfidence, number> = { high: 2, medium: 1, low: 0 };

function lowerConfidence(c: SizeConfidence): SizeConfidence {
  return c === "high" ? "medium" : "low";
}

/**
 * The cushion a size carries, as a fraction of its line's price. The traced
 * cushion is for a traced size that is still fully trusted; one worked from
 * an outline (bushes counted from a bed's size, walls from a footprint) or
 * held to a limit has had its confidence lowered, and takes that cushion.
 */
export function cushionFor(source: SizeSource, confidence: SizeConfidence): number {
  if (source === "traced" && confidence === "high") return CUSHION.traced;
  if (source === "typical") return CUSHION.typical;
  return CUSHION[confidence];
}

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function usablePrior(priors: SizePriors, typeId: string, read: "medianSqft" | "medianCount"): { value: number; samples: number } | null {
  const prior = priors[typeId];
  if (!prior || prior.samples < MIN_PRIOR_SAMPLES) return null;
  const value = prior[read];
  return positive(value) ? { value, samples: prior.samples } : null;
}

const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

const FROM_PICTURE = "from the satellite picture and your photos";
const historyFrom = (samples: number, what: string) => `the usual size of ${what} on the ${plural(samples, "yard")} we've measured`;

/** One spot's sizes before pricing: its grounds, each sized once. */
interface Plan {
  spot: SpotInput;
  choices: string[];
  /** The surface the outline and the picture's area are of (areaChoiceFor). */
  measured: string;
  /** The rate card service the bed is sized as: landscape-bed, or landscape-cleanup for weeds alone. */
  bedType: string | null;
  bed: Size | null;
  lawn: Size | null;
  water: Size | null;
}

export function priceSpots(input: PriceSpotsInput): { price: InstantPrice; sizing: SpotSizing[] } {
  const { spots, priors, lot, catalog } = input;
  const aiByIndex = new Map(input.ai.map((a) => [a.index, a]));

  // The lot, worked the way the form's price works it.
  const lotSqft = lot?.lotSqft ?? TYPICAL_LOT_SQFT;
  const structureSqft = lot?.structureSqft ?? 2000;
  const footprint = structureSqft / 1.6;
  const openYard = Math.max(1500, lotSqft - footprint - 800);
  const partOf = (area: string | null) => {
    const share = area && AREA_SHARE[area] != null ? AREA_SHARE[area] : UNKNOWN_PART_SHARE;
    const name = area && PART_NAME[area] ? `the ${PART_NAME[area]}` : "a typical part of the yard";
    return { ground: openYard * share, name };
  };

  /** A size held between limits; a held size is trusted a step less. */
  const hold = (size: Size, [lo, hi]: [number, number]): Size => {
    const value = clamp(size.value, lo, Math.max(lo, hi));
    if (value === size.value) return size;
    return { ...size, value, confidence: lowerConfidence(size.confidence), from: `${size.from}, taken as ${sqft(value)}` };
  };
  const measuredLimits = (typeId: string): [number, number] => {
    const [lo, hi] = MEASURED_LIMITS[typeId] ?? [10, 5000];
    return [lo, Math.min(hi, openYard)];
  };

  /** Whether a reading is far enough off the business's median to be set aside for it. */
  const disagrees = (typeId: string, value: number) => {
    const prior = usablePrior(priors, typeId, "medianSqft");
    return prior != null && (value > prior.value * DISAGREES_WITH_HISTORY || value < prior.value / DISAGREES_WITH_HISTORY);
  };

  /** A typical size for one spot of this service in its part of the yard. */
  const typicalArea = (typeId: string, area: string | null): Size => {
    const [lo, hi] = SPOT_LIMITS[typeId] ?? [50, 2000];
    const part = partOf(area);
    const of = `${part.name} (${sqft(part.ground)} of open ground)`;
    let value: number;
    let from: string;
    switch (typeId) {
      case "landscape-bed": {
        const share = (area ? BED_SHARE[area] : undefined) ?? BED_SHARE.front;
        value = part.ground * share;
        from = `a typical bed, ${Math.round(share * 100)}% of ${of}`;
        break;
      }
      case "landscape-cleanup":
        value = part.ground * CLEANUP_SHARE;
        from = `a typical spot, ${Math.round(CLEANUP_SHARE * 100)}% of ${of}`;
        break;
      case "lawn-restoration":
        value = part.ground * LAWN_PATCH_SHARE;
        from = `a typical bare patch in ${of}`;
        break;
      default:
        value = TYPICAL_WATER_SQFT;
        from = "a typical problem area";
    }
    return { value: clamp(value, lo, hi), source: "typical", confidence: "low", from };
  };

  /** The business's median for one spot of this service, held to one spot's worth in its part of the yard. */
  const priorArea = (typeId: string, area: string | null, what: string): Size | null => {
    const prior = usablePrior(priors, typeId, "medianSqft");
    if (!prior) return null;
    const [lo, hi] = SPOT_LIMITS[typeId] ?? [50, 2000];
    return hold({ value: prior.value, source: "history", confidence: "medium", from: historyFrom(prior.samples, what) }, [lo, Math.min(hi, partOf(area).ground)]);
  };

  /** The spot's own measurement of this surface, traced or clearly read, or null. */
  const measuredArea = (spot: SpotInput, typeId: string): Size | null => {
    const ai = aiByIndex.get(spot.index);
    if (positive(spot.tracedSqft)) return hold({ value: spot.tracedSqft, source: "traced", confidence: "high", from: "traced on the map" }, measuredLimits(typeId));
    if (ai && positive(ai.areaSqft) && ai.confidence !== "low" && !disagrees(typeId, ai.areaSqft)) {
      return hold({ value: ai.areaSqft, source: "ai", confidence: ai.confidence, from: FROM_PICTURE }, measuredLimits(typeId));
    }
    return null;
  };

  /**
   * A spot's area for this service, from the best source. `measured` is
   * whether the spot's own measurements (the outline, the picture's area)
   * are of this surface; they are not for a lawn patch on a bed spot.
   */
  const areaFor = (spot: SpotInput, typeId: string, measured: boolean, what: string): Size => {
    const own = measured ? measuredArea(spot, typeId) : null;
    if (own) return own;
    const prior = priorArea(typeId, spot.area, what);
    if (prior) return prior;
    const ai = aiByIndex.get(spot.index);
    if (measured && ai && positive(ai.areaSqft)) {
      return hold({ value: ai.areaSqft, source: "ai", confidence: "low", from: `${FROM_PICTURE}, hard to make out` }, measuredLimits(typeId));
    }
    return typicalArea(typeId, spot.area);
  };

  /** How many, for one counted choice on a spot. `ground` is the bed the bushes stand in, if known. */
  const countFor = (spot: SpotInput, choice: string, ground: Size | null): Size => {
    const work = WORK[choice];
    const typeId = work.typeId!;
    const ai = aiByIndex.get(spot.index);
    // The picture is asked for one count: the first counted thing on the spot.
    const aiCount = ai && COUNT_ORDER.find((c) => spot.choices.includes(c)) === choice && positive(ai.count) ? ai.count : null;
    if (aiCount != null && ai!.confidence !== "low") return { value: aiCount, source: "ai", confidence: ai!.confidence, from: FROM_PICTURE };
    if (choice === "trim" && ground && (ground.source === "traced" || ground.source === "ai") && ground.confidence !== "low") {
      const shrubs = clamp(Math.round(ground.value / SQFT_PER_SHRUB), 1, MAX_DERIVED_SHRUBS);
      return { value: shrubs, source: ground.source, confidence: lowerConfidence(ground.confidence), from: `about one per ${SQFT_PER_SHRUB} sq ft of the bed, ${ground.from}` };
    }
    const prior = usablePrior(priors, typeId, "medianCount");
    if (prior) return { value: Math.max(1, Math.round(prior.value)), source: "history", confidence: "medium", from: historyFrom(prior.samples, `${work.countOf} on a spot like this`) };
    if (aiCount != null) return { value: aiCount, source: "ai", confidence: "low", from: `${FROM_PICTURE}, hard to make out` };
    return { value: TYPICAL_SPOT_COUNT[typeId] ?? 1, source: "typical", confidence: "low", from: "a typical spot" };
  };

  /** The typical timing from the production rates, for a service the rate card has none for. */
  const productionRate = (typeId: string): InstantWork["typicalRate"] => {
    const key = PRODUCTION_RATE_FOR[typeId];
    const service = key ? productionService(key) : null;
    if (!service?.pr) return undefined;
    return { minutes: (60 * PRODUCTION_CREW) / service.pr, from: `from the production rate for ${service.label.toLowerCase()}` };
  };

  // ---- The house. There is one, however many walls were tapped, so its
  // siding is sized once, from the best of the wash spots, and shared over
  // them. Otherwise each tap (or each reading of the whole house) would wash
  // the house again.
  const siding = clamp(structureSqft * SIDING_PER_HOUSE_SQFT, 800, 6000);
  // A misread wall is held to twice the county's house, or a big house where the county has none.
  const washLimits: [number, number] = [200, lot?.structureSqft ? clamp(siding * 2, 1500, 8000) : 8000];
  const washSpots = spots.filter((s) => s.choices.includes("wash"));
  const houseSiding = (): { size: Size; storeys: number } => {
    // Only where the house is what was traced or read: on a bed spot with a
    // wash, the outline and the picture's area are the bed.
    const own = washSpots.filter((s) => areaChoiceFor(s.choices) === "wash");
    const traced = own
      .map((s) => s.tracedSqft)
      .filter(positive)
      .sort((a, b) => b - a)[0];
    if (traced != null) {
      // Drawn round the house: its walls, as if square, as many storeys as
      // the county's living area over the footprint drawn.
      const storeys = lot?.structureSqft ? clamp(Math.round(lot.structureSqft / traced), 1, MAX_STOREYS) : 1;
      const walls = 4 * Math.sqrt(traced) * WALL_HEIGHT_FT * storeys;
      const from = `the walls of the house traced on the map, ${sqft(traced)} of footprint${storeys > 1 ? `, ${storeys} storeys` : ""}`;
      return { storeys, size: hold({ value: walls, source: "traced", confidence: "medium", from }, washLimits) };
    }
    const reads = own.map((s) => aiByIndex.get(s.index)).filter((a): a is AiSpotSize & { areaSqft: number } => a != null && positive(a.areaSqft));
    const sure = reads.filter((a) => a.confidence !== "low" && !disagrees("soft-washing", a.areaSqft)).sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
    if (sure.length) return { storeys: 1, size: hold({ value: sure[0].areaSqft, source: "ai", confidence: sure[0].confidence, from: FROM_PICTURE }, washLimits) };
    const prior = usablePrior(priors, "soft-washing", "medianSqft");
    if (prior) return { storeys: 1, size: hold({ value: prior.value, source: "history", confidence: "medium", from: historyFrom(prior.samples, "houses") }, SPOT_LIMITS["soft-washing"]) };
    if (reads.length) return { storeys: 1, size: hold({ value: reads[0].areaSqft, source: "ai", confidence: "low", from: `${FROM_PICTURE}, hard to make out` }, washLimits) };
    return { storeys: 1, size: { value: siding, source: "typical", confidence: "low", from: "the house's siding, from its size" } };
  };
  const house = washSpots.length ? houseSiding() : null;
  const washShare = (): Size | null => {
    if (!house) return null;
    const n = washSpots.length;
    return n > 1 ? { ...house.size, value: house.size.value / n, from: `${house.size.from}, shared over the ${n} spots to wash` } : house.size;
  };

  // ---- Each spot's grounds, each sized once.
  const plans: Plan[] = spots.map((spot) => {
    const choices = [...new Set(spot.choices)].filter((c) => WORK[c]);
    const measured = areaChoiceFor(choices);
    const bedLead = BED_CHOICES.find((c) => choices.includes(c)) ?? null;
    const bedType = bedLead ? WORK[bedLead].typeId! : null;
    return {
      spot,
      choices,
      measured,
      bedType,
      // The bed is first in areaChoiceFor's order, so when there is one it is what was measured.
      bed: bedLead && bedType ? areaFor(spot, bedType, true, bedLead === "weeds" ? "weedy beds" : "beds") : null,
      lawn: choices.includes("lawn") ? areaFor(spot, "lawn-restoration", measured === "lawn", "lawn patches") : null,
      water: choices.includes("water") ? areaFor(spot, "grading", measured === "water", "wet ground") : null,
    };
  });

  // ---- Guessed grounds of one service in one part of the yard can't add
  // up to more of it than a yard has: taps along one strip are one strip.
  for (const key of ["bed", "lawn"] as const) {
    const groups = new Map<string, Plan[]>();
    for (const plan of plans) {
      const size = plan[key];
      if (!size || (size.source !== "typical" && size.source !== "history")) continue;
      const typeId = key === "bed" ? plan.bedType! : "lawn-restoration";
      const groupKey = `${typeId}|${plan.spot.area ?? ""}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), plan]);
    }
    for (const [groupKey, group] of groups) {
      if (group.length < 2) continue;
      const typeId = groupKey.split("|")[0];
      const area = group[0].spot.area;
      const part = partOf(area);
      const cap = part.ground * (typeId === "landscape-bed" && area === "foundation" ? FOUNDATION_BED_CAP : PART_CAP[typeId] ?? 1);
      const total = group.reduce((sum, p) => sum + p[key]!.value, 0);
      if (total <= cap) continue;
      for (const p of group) {
        const size = p[key]!;
        p[key] = { ...size, value: (size.value * cap) / total, confidence: "low", from: `${size.from}, shared with the ${plural(group.length - 1, "other spot")} like it in ${part.name}` };
      }
    }
  }

  // ---- The lines, before pricing.
  type Entry = { spotIndex: number; work: InstantWork; size: Size | null };
  const built = plans.map((plan) => {
    const { spot, choices } = plan;
    const label = (what: string) => `Spot ${spot.index + 1}: ${what}`;
    const sizes: Size[] = [plan.bed, plan.lawn, plan.water].filter((s): s is Size => s != null);
    const entries: Entry[] = [];
    const add = (choice: string, size: Size | null, extra: Partial<InstantWork> = {}, what = WORK[choice].what) => {
      const work = WORK[choice];
      entries.push({
        spotIndex: spot.index,
        size,
        work: {
          service: work.service,
          label: label(what),
          typeId: work.typeId,
          sizeFrom: size?.from,
          values: work.values,
          note: work.note,
          typicalRate: work.typeId ? productionRate(work.typeId) : undefined,
          ...(size && work.kind === "area" ? { areaSqft: size.value } : {}),
          ...(size && work.kind === "count" ? { count: size.value, countOf: work.countOf } : {}),
          ...extra,
        },
      });
    };

    // The bed the bushes stand in: the bed's ground, or, when counted work
    // is what the spot is about, what was traced or read round it.
    const countBed = plan.bed ?? (COUNT_ORDER.includes(plan.measured) ? measuredArea(spot, "landscape-bed") : null);
    const firstCounted = COUNT_ORDER.find((c) => choices.includes(c)) ?? null;
    let recordCount: Size | null = null;
    let washSize: Size | null = null;
    const mulch = choices.includes("mulch");
    const rock = choices.includes("rock");
    for (const choice of choices) {
      const work = WORK[choice];
      if (work.kind === "visit") {
        add(choice, null, {}, choiceLabel(choice).toLowerCase());
        continue;
      }
      if (work.kind === "count") {
        const count = countFor(spot, choice, countBed);
        sizes.push(count);
        if (choice === firstCounted) recordCount = count;
        add(choice, count);
        continue;
      }
      if (choice === "wash") {
        const size = washShare()!;
        sizes.push(size);
        washSize = size;
        const storeys = house?.storeys ?? 1;
        add(choice, size, STOREY_HOURS[storeys] ? { hoursFactor: STOREY_HOURS[storeys], hoursWhy: `${storeys} storeys` } : {});
        continue;
      }
      if (choice === "lawn") {
        add(choice, plan.lawn);
        continue;
      }
      if (choice === "water") {
        add(choice, plan.water);
        continue;
      }
      const ground = plan.bed;
      if (!ground) continue;
      if ((choice === "mulch" || choice === "rock") && mulch && rock) {
        // Both asked for on one bed: half of each, as the form's price does.
        add(choice, { ...ground, value: ground.value / 2, from: `half of ${ground.from}` });
        continue;
      }
      if (choice === "weeds" && (mulch || rock)) {
        add(choice, ground, { hoursFactor: WEEDS_UNDER_NEW_BED, hoursWhy: "the bed prep clearing the top" }, "weeds pulled before the new bed");
        continue;
      }
      add(choice, ground);
    }

    // The area kept on the spot's record is of the surface that was measured.
    const byMeasured: Record<string, Size | null> = { lawn: plan.lawn, water: plan.water, wash: washSize };
    const recordArea = BED_CHOICES.includes(plan.measured)
      ? plan.bed
      : COUNT_ORDER.includes(plan.measured)
        ? countBed
        : (byMeasured[plan.measured] ?? plan.bed ?? plan.lawn ?? plan.water ?? washSize);
    return { plan, entries, sizes, recordCount, recordArea };
  });

  // ---- A service the rate card times as flat hours for the job is charged
  // those hours once, split over its spots by size, not once per spot.
  const flat = new Map<string, Entry[]>();
  for (const b of built) {
    for (const e of b.entries) {
      if (e.work.typeId && flatHoursFor(e.work, catalog) != null) flat.set(e.work.typeId, [...(flat.get(e.work.typeId) ?? []), e]);
    }
  }
  for (const group of flat.values()) {
    const spotCount = new Set(group.map((e) => e.spotIndex)).size;
    if (group.length < 2) continue;
    const units = group.map((e) => e.work.areaSqft ?? e.work.count ?? 0);
    const total = units.reduce((a, b) => a + b, 0);
    group.forEach((e, i) => {
      e.work.flatShare = { fraction: total > 0 ? units[i] / total : 1 / group.length, of: spotCount };
    });
  }

  // ---- Priced.
  const lines: InstantLine[] = [];
  const sizing: SpotSizing[] = [];
  let usesTypical = false;
  let cushionCents = 0;
  const sourcesUsed = new Map<SizeSource, number>();
  for (const { plan, entries, sizes, recordCount, recordArea } of built) {
    // Each line's cushion is by its own size; the spot's record carries the
    // weakest size on it, since that is what the price most rests on.
    let spotCents: number | null = null;
    for (const { work, size } of entries) {
      const priced = priceWork(work, catalog);
      if (priced.typical) usesTypical = true;
      const line = priced.line;
      lines.push(line);
      if (line.priceCents == null) continue;
      spotCents = (spotCents ?? 0) + line.priceCents;
      cushionCents += line.priceCents * (size ? cushionFor(size.source, size.confidence) : CUSHION.typical);
    }
    const weakest = sizes.reduce<Size | null>((w, s) => (w == null || RANK[s.confidence] < RANK[w.confidence] ? s : w), null);
    sizing.push({
      index: plan.spot.index,
      choices: plan.choices,
      areaSqft: recordArea ? Math.round(recordArea.value) : null,
      count: recordCount?.value ?? null,
      source: weakest?.source ?? "typical",
      confidence: weakest?.confidence ?? "low",
      from: weakest ? capitalise(weakest.from) : "Nothing to size: priced on the visit",
      priceCents: spotCents,
    });
    if (weakest) sourcesUsed.set(weakest.source, (sourcesUsed.get(weakest.source) ?? 0) + 1);
  }

  const subtotalCents = lines.reduce((sum, l) => sum + (l.priceCents ?? 0), 0);
  const totalCents = subtotalCents > 0 ? Math.ceil((subtotalCents + cushionCents) / ROUND_TO_CENTS) * ROUND_TO_CENTS : 0;
  const m = catalog.markup;
  const overhead = m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0 ? `+ $${(m.overheadPerCrewHourCents / 100).toFixed(2)} per crew-hour overhead` : `+ ${m.overheadPercent}% overhead`;
  return {
    price: {
      lines,
      subtotalCents,
      premiumCents: totalCents - subtotalCents,
      totalCents,
      basis: basisFor(spots.length, sourcesUsed, lot?.lotSqft ? `the county's lot size, ${sqft(lotSqft)}` : `a typical ${sqft(TYPICAL_LOT_SQFT)} lot`),
      crewRateCents: catalog.crewCostPerHourCents,
      markup: `× ${m.multiplier}, then ${overhead}`,
      usesTypical,
    },
    sizing,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SOURCE_WORDS: Record<SizeSource, string> = {
  traced: "traced on the map",
  ai: "read from the satellite picture and photos",
  history: "from our measured yards",
  typical: "a typical size",
};

/** What the sizes were worked from, e.g. "3 spots, each priced on its own: 2 traced on the map, 1 a typical size from the county's lot size, 9,000 sq ft". */
function basisFor(spotCount: number, sources: Map<SizeSource, number>, lotWords: string): string {
  const order: SizeSource[] = ["traced", "ai", "history", "typical"];
  const parts = order
    .filter((s) => sources.get(s))
    .map((s) => `${sources.get(s)} ${SOURCE_WORDS[s]}${s === "typical" ? ` from ${lotWords}` : ""}`);
  const head = `${plural(spotCount, "spot")}, each priced on its own`;
  return parts.length ? `${head}: ${parts.join(", ")}` : head;
}
