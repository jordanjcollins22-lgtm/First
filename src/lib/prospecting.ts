/**
 * Deciding where the prospect list should grow next.
 *
 * The list feeds itself from work that already happened. Every job the crew
 * finishes becomes a seed, and the houses around it become candidates —
 * neighbours of a happy customer share the street, the lot sizes, and a clear
 * view of the work. Business locations act as fallback seeds so a brand-new
 * install still has somewhere to start.
 *
 * Growth is capped rather than exhaustive: the property API bills per request,
 * and a list that adds a few good streets a night is more useful than one that
 * swallows the county in an evening and can never be called through.
 */

export interface Seed {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Higher grows first. */
  weight: number;
  kind: "won_job" | "job" | "location";
}

export interface SeedCandidate {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Proposal total when the job was won, which is what makes a seed good. */
  wonValue: number | null;
  /** ISO date of the work, so recent streets get worked first. */
  date: string | null;
}

export interface GrowthPlan {
  seeds: Seed[];
  /** Radius searched around each seed. */
  radiusMiles: number;
  /** Properties requested per seed. */
  perSeed: number;
}

/** Around a finished job, the useful radius is the few streets somebody could
 * walk past — not a whole town. */
export const DEFAULT_RADIUS_MILES = 0.5;
/** Wider for a depot or yard, where there's no specific street to work. */
export const LOCATION_RADIUS_MILES = 2;

export interface GrowthBudget {
  /** Seeds to work in one run. Each is one billed API call. */
  maxSeeds: number;
  /** Properties requested from each seed. */
  perSeed: number;
}

export const NIGHTLY_BUDGET: GrowthBudget = { maxSeeds: 3, perSeed: 50 };
export const MANUAL_BUDGET: GrowthBudget = { maxSeeds: 5, perSeed: 50 };

function daysBetween(iso: string | null, today: Date): number {
  if (!iso) return 9999;
  const then = new Date(iso.length > 10 ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(then.getTime())) return 9999;
  return Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86_400_000));
}

/**
 * Ranks seeds so the best streets get worked first.
 *
 * A big job beats a small one, and a recent job beats an old one — the work is
 * still visible from the road and the neighbours have been watching it happen.
 * Seeds already worked are excluded by the caller, so this only ever ranks
 * what's left.
 */
export function rankSeeds(
  candidates: SeedCandidate[],
  targetTicket: number,
  today = new Date()
): Seed[] {
  return candidates
    .map((c) => {
      let weight = 10;
      if (c.wonValue != null) {
        weight += 30;
        if (c.wonValue >= targetTicket * 2) weight += 25;
        else if (c.wonValue >= targetTicket) weight += 15;
      }

      const age = daysBetween(c.date, today);
      if (age <= 60) weight += 20;
      else if (age <= 180) weight += 10;
      else if (age > 730) weight -= 15;

      return {
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        label: c.label,
        weight,
        kind: (c.wonValue != null ? "won_job" : "job") as Seed["kind"],
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

export function planGrowth(
  jobSeeds: SeedCandidate[],
  locationSeeds: SeedCandidate[],
  targetTicket: number,
  budget: GrowthBudget,
  today = new Date()
): GrowthPlan {
  const ranked = rankSeeds(jobSeeds, targetTicket, today);

  if (ranked.length > 0) {
    return {
      seeds: ranked.slice(0, budget.maxSeeds),
      radiusMiles: DEFAULT_RADIUS_MILES,
      perSeed: budget.perSeed,
    };
  }

  // Nothing finished yet — fall back to the yard so a new install can still
  // build a list.
  return {
    seeds: locationSeeds.slice(0, budget.maxSeeds).map((c) => ({
      id: c.id,
      lat: c.lat,
      lng: c.lng,
      label: c.label,
      weight: 1,
      kind: "location" as const,
    })),
    radiusMiles: LOCATION_RADIUS_MILES,
    perSeed: budget.perSeed,
  };
}
