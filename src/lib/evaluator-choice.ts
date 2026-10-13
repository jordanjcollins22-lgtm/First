/**
 * Which evaluator gets the job, when several are free.
 *
 * The slot was already chosen well: the times offered to a client are ranked
 * by whether we are going to be near that address anyway. Who then does it was
 * not chosen at all — the first free id in an array won, and that array's
 * order came out of a database read, so in practice one person collected the
 * bookings and everybody else waited.
 *
 * Three things decide it, in order, after one optional filter.
 *
 * **Whose territory it is.** When evaluators have territories (zip codes or
 * an area drawn on the map) and one or more of the free ones covers this
 * address, only they are considered. Nobody with the territory free means
 * everybody free is considered, so a territory never takes a time away from
 * a client. See `@/lib/sales/territories`.
 *
 * **Who is already going that way.** An evaluator with a visit four streets
 * over at eleven should take the twelve o'clock, and it does not matter what
 * the rest of their day looks like — that is one trip out instead of two.
 *
 * **Who has the lighter day.** Nobody nearby, so give it to whoever is least
 * committed. This is what actually spreads the work.
 *
 * **Who has waited longest for one.** A tie between two empty diaries is
 * settled by whoever was booked least recently, so it rotates rather than
 * landing on whoever the database happens to name first.
 *
 * Distance is straight-line and only ever compares candidates. Nothing here is
 * shown to a client, so no rule needs to be defensible to one — but every rule
 * has to be defensible to the person who did not get the job.
 */

import { metresBetween } from "@/lib/navigation";
import { inTerritory, type Place, type Territory } from "@/lib/sales/territories";

/** Near enough that a second visit is the same trip out. */
export const SAME_TRIP_MILES = 5;

const METRES_PER_MILE = 1609.344;

export interface EvaluatorDay {
  evaluatorId: string;
  /** Visits already on this person's calendar that day, in any order. */
  visits: { lat: number | null; lng: number | null }[];
  /** When they were last given a booking. Null means never. */
  lastBookedAt: string | null;
}

export interface Choice {
  evaluatorId: string;
  /** Why this one, for the office. Never seen by a client. */
  why: string;
}

/**
 * The best of the people who are free, and the reason.
 *
 * Candidates are the ones already confirmed free for the slot; this only
 * decides between them. An empty list is null rather than a throw, because the
 * caller's next move is to tell somebody the time just went, not to crash.
 */
export function chooseEvaluator(
  candidateIds: string[],
  days: EvaluatorDay[],
  where: { lat: number | null; lng: number | null; zip?: string | null },
  territories: Territory[] = []
): Choice | null {
  if (candidateIds.length === 0) return null;
  if (candidateIds.length === 1) {
    return { evaluatorId: candidateIds[0], why: "The only one free at that time." };
  }

  // Their patch first, when it is somebody's and they are free.
  const place: Place = { lat: where.lat, lng: where.lng, zip: where.zip ?? null };
  const local = territories.length > 0 ? inTerritory(candidateIds, territories, place) : [];
  if (local.length === 1) {
    return { evaluatorId: local[0], why: "Their territory, and free at that time." };
  }
  if (local.length > 1 && local.length < candidateIds.length) {
    const choice = chooseEvaluator(local, days, where);
    return choice ? { ...choice, why: `In their territory. ${choice.why}` } : null;
  }

  const byId = new Map(days.map((day) => [day.evaluatorId, day]));
  const scored = candidateIds.map((id) => {
    const day = byId.get(id) ?? { evaluatorId: id, visits: [], lastBookedAt: null };
    return {
      id,
      nearestMiles: nearestMiles(day.visits, where),
      load: day.visits.length,
      waited: day.lastBookedAt ? new Date(day.lastBookedAt).getTime() : 0,
    };
  });

  const nearby = scored
    .filter((c) => c.nearestMiles != null && c.nearestMiles <= SAME_TRIP_MILES)
    .sort((a, b) => (a.nearestMiles ?? 0) - (b.nearestMiles ?? 0));

  if (nearby.length > 0) {
    const winner = nearby[0];
    return {
      evaluatorId: winner.id,
      why: `Already has a visit ${round(winner.nearestMiles ?? 0)} miles away that day.`,
    };
  }

  // Nobody is going that way, so spread the work: lightest day first, and a
  // tie goes to whoever has waited longest for one.
  const rest = scored.slice().sort((a, b) => a.load - b.load || a.waited - b.waited);
  const winner = rest[0];
  return {
    evaluatorId: winner.id,
    why:
      winner.load === 0
        ? "Nothing else booked that day."
        : `The lightest day of the ${candidateIds.length} free, ${winner.load} already booked.`,
  };
}

/** Miles to the closest visit already on that day, or null when unknowable. */
function nearestMiles(
  visits: { lat: number | null; lng: number | null }[],
  where: { lat: number | null; lng: number | null }
): number | null {
  if (where.lat == null || where.lng == null) return null;
  let best: number | null = null;
  for (const visit of visits) {
    if (visit.lat == null || visit.lng == null) continue;
    const miles =
      metresBetween({ lat: where.lat, lng: where.lng }, { lat: visit.lat, lng: visit.lng }) /
      METRES_PER_MILE;
    if (best == null || miles < best) best = miles;
  }
  return best;
}

function round(miles: number): number {
  return Math.round(miles * 10) / 10;
}
