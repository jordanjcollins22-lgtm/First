/**
 * The pre-evaluation as a map: the client taps each spot they want worked
 * on, says what they want done there in one tap, and adds a photo. From
 * that, an estimate straight away, with a third down to hold it.
 *
 * The taps become the ordinary pre-evaluation answers (services, areas and
 * the detail questions), so everything that already reads those keeps
 * working: the evaluator's site map is seeded from them, and the instant
 * price is worked from them the same way it is for the long form.
 *
 * Pure, so the mapping from taps to answers is tested without a database.
 */

import { cleanAnswers, type IntakeAnswers } from "@/lib/evaluation-intake";
import { groundRegions, pointInRing, type AreaKey, type LngLat, type LotData } from "@/lib/lot-map";

/** One thing a client can ask for on a spot, said the way they would say it. */
export interface TapChoice {
  value: string;
  label: string;
  /** The pre-evaluation form's service it is. */
  service: string;
  /** The detail answers it implies, by question id. */
  details?: Record<string, string>;
}

export const TAP_CHOICES: TapChoice[] = [
  { value: "mulch", label: "Fresh mulch", service: "beds", details: { beds_add: "mulch" } },
  { value: "rock", label: "River rock", service: "beds", details: { beds_add: "stone" } },
  { value: "plants", label: "New plants", service: "beds", details: { beds_add: "plants" } },
  { value: "weeds", label: "Weeds and cleanup", service: "cleanup", details: { cleanup_what: "weeds" } },
  { value: "trim", label: "Trim bushes", service: "cleanup", details: { cleanup_what: "trim" } },
  { value: "remove", label: "Take out bushes", service: "removal", details: { remove_what: "small" } },
  { value: "lawn", label: "Fix the lawn", service: "lawn", details: { lawn_need: "patch" } },
  { value: "wash", label: "Wash the house", service: "washing", details: { wash_what: "siding" } },
  { value: "water", label: "Water problem", service: "drainage", details: { water: "pools" } },
  { value: "patio", label: "Patio or walkway", service: "hardscape", details: { hard_what: "patio" } },
  { value: "other", label: "Not sure, take a look", service: "other" },
];

const CHOICE = new Map(TAP_CHOICES.map((c) => [c.value, c]));

export function choiceLabel(value: string): string {
  return CHOICE.get(value)?.label ?? value;
}

/** One spot the client tapped. */
export interface TapSpot {
  lng: number;
  lat: number;
  /** TAP_CHOICES values. */
  choices: string[];
  /** Storage paths of this spot's photos, in the job-photos bucket. */
  photos: string[];
}

export const MAX_SPOTS = 20;
/** The form keeps three photos per part of the yard; a spot never needs more. */
export const MAX_PHOTOS_PER_SPOT = 3;
// Further than this from the house is a mis-tap or a map panned away, not the job.
const MAX_SPOT_METERS = 400;

/** The share of the estimate paid to hold it. */
export const DEPOSIT_SHARE = 1 / 3;

/** A third of the estimate, rounded up to a whole dollar. */
export function depositCents(totalCents: number): number {
  if (!(totalCents > 0)) return 0;
  return Math.ceil((totalCents * DEPOSIT_SHARE) / 100) * 100;
}

/** Whole dollars, e.g. "$1,250": estimates and their deposits are whole dollars. */
export function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function metersBetween([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * Spots from the page, made safe, or null when anything is off so a bad
 * request never half-saves. Photos are checked to be this job's form
 * photos; that they are on the form at all is the caller's check.
 */
export function parseTapSpots(input: unknown, ctx: { jobId: string; home: LngLat }): TapSpot[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SPOTS) return null;
  const photoPath = new RegExp(`^${ctx.jobId}/intake-[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  const spots: TapSpot[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { lng, lat, choices, photos } = raw as Record<string, unknown>;
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (metersBetween(ctx.home, [lng, lat]) > MAX_SPOT_METERS) return null;
    if (!Array.isArray(choices) || choices.length === 0 || !choices.every((c) => typeof c === "string" && CHOICE.has(c))) return null;
    if (!Array.isArray(photos) || photos.length > MAX_PHOTOS_PER_SPOT) return null;
    if (!photos.every((p) => typeof p === "string" && photoPath.test(p))) return null;
    spots.push({ lng, lat, choices: [...new Set(choices as string[])], photos: [...new Set(photos as string[])] });
  }
  return spots;
}

/** Spots as stored, with anything malformed dropped. */
export function readTapSpots(value: unknown): TapSpot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s): TapSpot[] => {
    if (!s || typeof s !== "object") return [];
    const { lng, lat, choices, photos } = s as Record<string, unknown>;
    if (typeof lng !== "number" || typeof lat !== "number") return [];
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return [{ lng, lat, choices: strings(choices), photos: strings(photos) }];
  });
}

/**
 * Which part of the yard a spot is in, by the county lot: around the house
 * first (it sits inside the others), then front, back and sides. Null with
 * no lot, or for a spot off the parcel.
 */
export function areaForPoint(point: LngLat, regions: Record<AreaKey, LngLat[][]> | null): Exclude<AreaKey, "whole"> | null {
  if (!regions) return null;
  for (const key of ["foundation", "front", "back", "sides"] as const) {
    if (regions[key]?.some((ring) => pointInRing(point, ring))) return key;
  }
  return null;
}

export function regionsFor(lot: LotData | null): Record<AreaKey, LngLat[][]> | null {
  if (!lot) return null;
  try {
    return groundRegions(lot);
  } catch {
    return null;
  }
}

/**
 * The pre-evaluation answers the spots stand for, on top of whatever the
 * form already holds (a client who started the long form keeps what they
 * wrote). Services, areas and details are added to, never taken away.
 */
export function answersFromSpots(base: IntakeAnswers, spots: TapSpot[], areaOf: (spot: TapSpot) => string | null): IntakeAnswers {
  const services = new Set(base.services);
  const areas = new Set(base.areas);
  const details: Record<string, string | string[]> = { ...base.details };
  for (const spot of spots) {
    const area = areaOf(spot);
    if (area) areas.add(area);
    for (const value of spot.choices) {
      const choice = CHOICE.get(value);
      if (!choice) continue;
      services.add(choice.service);
      for (const [id, answer] of Object.entries(choice.details ?? {})) {
        const now = details[id];
        const list = Array.isArray(now) ? now : now ? [now] : [];
        details[id] = list.includes(answer) ? list : [...list, answer];
      }
    }
  }
  // Through the form's own cleaner, so only answers the form knows survive.
  return cleanAnswers({
    ...base,
    property: base.property || "home",
    services: [...services],
    areas: [...areas],
    details,
  });
}
