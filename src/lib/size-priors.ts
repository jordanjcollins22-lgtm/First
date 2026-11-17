import type { WorkZone } from "@/components/canvas/types";
import { kindOfSaved } from "@/lib/zone-measurement";
import type { SizePrior, SizePriors } from "@/lib/spot-sizing";

/**
 * What this business's own measured jobs say a spot is usually like.
 *
 * The "history" size source (see spot-sizing). When a client taps a bed and
 * gives no measurement, and the satellite picture can't tell either, the next
 * best guess is not a share of the county lot -- it is what the beds on this
 * business's own jobs have measured. Evaluators measure every zone on site, so
 * the saved site maps (canvas_designs.zones) are a record of real yards in
 * this business's own area.
 *
 * Kept pure, apart from where the zones come from (lib/data/size-priors), so
 * the arithmetic that decides a client's price can be read and tested alone.
 *
 * Where the numbers live on a saved zone, found by reading the canvas:
 *
 *  - Area: `areaSqFt`, derived from the length x width the evaluator typed.
 *    Older zones may only have length and width, so those are multiplied
 *    when the area is missing. A zone measured as a run (`kindOfSaved` is
 *    "linear", e.g. edging) has a length and no area; it is not a size for an
 *    area spot and is left out of the area median.
 *  - Count: counted services (plant / bush removal, plant installation,
 *    trimming) ask for a "Quantity" field, saved as a string in
 *    `service.values.quantity`. It is the only place counted work is stored.
 *    Pricing reads a blank as 1 (zoneServiceCount) so a zone is never free,
 *    but a blank is not a measurement, so here it is left out rather than
 *    counted as 1 -- otherwise every unfilled form would drag the median down.
 *  - There is no separate "point zone" type: a zone placed with a dot has an
 *    `anchor` and an outline drawn to its measurements, and its numbers sit in
 *    the same fields as a drawn one. Its `points` are canvas pixels, not feet,
 *    so they are never read as a size.
 */

/** Below this many measured zones a median is one or two yards, not a pattern. */
export const MIN_SAMPLES = 5;

/**
 * Beyond these a number is a typo (an extra zero, feet typed as inches), not
 * a yard. Generous on purpose -- a big lawn is real -- because the median
 * deals with the merely unusual.
 */
export const MAX_AREA_SQFT = 200_000;
export const MAX_COUNT = 500;

/** One zone an evaluator measured, reduced to what the priors need. */
export interface MeasuredZone {
  serviceTypeId: string;
  areaSqFt: number | null;
  count?: number | null;
  /**
   * Whether the job it came from was sold (approved, under way or done).
   * Those yards were measured with a price riding on them and the client
   * agreed, so they are preferred when there are enough of them.
   */
  sold?: boolean;
}

function usable(n: number | null | undefined, cap: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= cap;
}

/**
 * The middle value, or null when there are fewer than MIN_SAMPLES.
 *
 * Not trimmed first, though trimming the top and bottom tenth was the obvious
 * idea: cutting the same number off each end of a sorted list leaves the same
 * middle, so it would change nothing. The median is already the outlier-proof
 * part; the caps above deal with the typos, which a median can only shrug off
 * while they are a minority.
 */
export function median(values: number[]): number | null {
  if (values.length < MIN_SAMPLES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A saved zone as a MeasuredZone, or null when it says nothing about size:
 * no service, a run rather than an area, and no count either.
 */
export function measuredZoneFrom(zone: WorkZone, sold = false): MeasuredZone | null {
  const serviceTypeId = zone.service?.typeId;
  if (!serviceTypeId) return null;

  let areaSqFt: number | null = null;
  if (kindOfSaved(zone) === "area") {
    if ((zone.areaSqFt ?? 0) > 0) areaSqFt = zone.areaSqFt;
    else if ((zone.lengthFt ?? 0) > 0 && (zone.widthFt ?? 0) > 0) areaSqFt = zone.lengthFt! * zone.widthFt!;
  }

  // Number("") is 0 and Number("abc") is NaN; both are "not filled in".
  const rawCount = zone.service?.values?.quantity;
  const parsed = rawCount == null || String(rawCount).trim() === "" ? NaN : Number(rawCount);
  const count = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  if (areaSqFt == null && count == null) return null;
  return { serviceTypeId, areaSqFt, count, sold };
}

/**
 * Medians per service from the zones evaluators measured.
 *
 * Per service, if the sold jobs alone have MIN_SAMPLES usable zones, only
 * they are used; otherwise every job is, because a median of the business's
 * own quotes still beats a share of the county lot. Area and count are judged
 * separately, so a service with plenty of counts but few areas gets a count
 * median and a null area, and the pricer falls through to the next source
 * for the one it lacks.
 */
export function sizePriorsFrom(zones: MeasuredZone[]): SizePriors {
  const byService = new Map<string, MeasuredZone[]>();
  for (const z of zones) {
    if (!z.serviceTypeId) continue;
    const area = usable(z.areaSqFt, MAX_AREA_SQFT) ? z.areaSqFt : null;
    const count = usable(z.count, MAX_COUNT) ? z.count : null;
    if (area == null && count == null) continue;
    const list = byService.get(z.serviceTypeId) ?? [];
    list.push({ serviceTypeId: z.serviceTypeId, areaSqFt: area, count, sold: z.sold });
    byService.set(z.serviceTypeId, list);
  }

  const priors: SizePriors = {};
  for (const [serviceTypeId, list] of byService) {
    const pick = (read: (z: MeasuredZone) => number | null | undefined): number[] => {
      const sold = list.filter((z) => z.sold).map(read).filter((n): n is number => n != null);
      if (sold.length >= MIN_SAMPLES) return sold;
      return list.map(read).filter((n): n is number => n != null);
    };
    const areas = pick((z) => z.areaSqFt);
    const counts = pick((z) => z.count);
    const prior: SizePrior = {
      serviceTypeId,
      medianSqft: median(areas),
      medianCount: median(counts),
      samples: Math.max(areas.length, counts.length),
    };
    priors[serviceTypeId] = prior;
  }
  return priors;
}
