/**
 * Which times to put in front of somebody booking an evaluation.
 *
 * A booking form that lists every free hour for the next fortnight is asking a
 * stranger to solve our scheduling problem for us. They cannot: they do not
 * know that Tuesday morning already has us four streets away, or that the
 * Thursday slot they picked means an hour of driving between two jobs. So they
 * pick the first one, or they pick nothing.
 *
 * This picks. It reads the evaluations already booked, works out which free
 * hours sit next to one near the caller's address, and offers those first with
 * a reason attached. The business gets a tighter round; the client gets an
 * earlier appointment and a form that feels like it knows something.
 *
 * Two rules it does not break.
 *
 * **It never says where anybody else lives.** The reasons are written from the
 * caller's side -- "we're already nearby that morning" -- and carry no address,
 * no name and no other client's time. An appointment is somebody's home.
 *
 * **It never recommends a time we cannot keep.** A slot forty minutes after an
 * evaluation twenty-five miles away is not a convenient slot, it is a late
 * arrival. Those are pushed down rather than dressed up, because the fastest
 * way to lose the second job is to be late to the first.
 *
 * No model. Distance, minutes, and rules somebody can argue with.
 */

import type { AvailableSlotGroup } from "@/lib/booking-availability";

/** Within this, a second visit is genuinely the same trip out. */
export const NEIGHBOUR_MILES = 5;

/**
 * What a van averages on county roads, door to door.
 *
 * Deliberately pessimistic. Being wrong in this direction costs a slot that
 * could have been offered; being wrong the other way costs a client standing
 * in a garden wondering where we are.
 */
export const DRIVE_MPH = 30;

/** Getting into the van, writing the last one up, parking at the next. */
export const TURNAROUND_MINUTES = 15;

export interface BookedNearby {
  /** When the existing evaluation starts. */
  iso: string;
  /** When it ends, where that is known. */
  endIso: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RankedSlot extends AvailableSlotGroup {
  score: number;
  /** Shown to the client. Never mentions another client. Null when there is nothing true to say. */
  says: string | null;
  /** Miles to the nearest evaluation already booked that day, when both ends are known. */
  nearestMiles: number | null;
  /** Minutes between this slot and that evaluation. Negative means this one is first. */
  gapMinutes: number | null;
  /** False when the drive between the two cannot be made in the gap. */
  reachable: boolean;
}

/** Straight-line miles. Used only to compare candidates, never shown as a driving distance. */
export function milesBetween(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null }
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const mid = ((a.lat + b.lat) / 2) * toRad;
  const x = dLng * Math.cos(mid);
  return Math.sqrt(dLat * dLat + x * x) * 3958.8;
}

/** Minutes the drive needs, turnaround included. */
export function driveMinutes(miles: number): number {
  return (miles / DRIVE_MPH) * 60 + TURNAROUND_MINUTES;
}

function slotStart(slot: AvailableSlotGroup): number {
  const [h, m] = slot.time.split(":").map(Number);
  const [y, mo, d] = slot.date.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
}

function daysOut(slot: AvailableSlotGroup, now: Date): number {
  const [y, mo, d] = slot.date.split("-").map(Number);
  const start = Date.UTC(y, mo - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((start - today) / 86_400_000);
}

/**
 * How well one free hour suits both sides, and what to say about it.
 *
 * The caller's coordinates are optional and their absence is handled honestly:
 * with no address there is no cluster to find, so every slot scores on
 * soonness alone and none of them claims to be nearby.
 */
export function rankSlot(
  slot: AvailableSlotGroup,
  where: { lat: number | null; lng: number | null },
  booked: readonly BookedNearby[],
  now: Date
): RankedSlot {
  const start = slotStart(slot);

  // The nearest evaluation already on the books that same day. Same day
  // matters: being four miles from tomorrow's work saves nobody anything.
  let nearestMiles: number | null = null;
  let gapMinutes: number | null = null;
  for (const other of booked) {
    const when = new Date(other.iso);
    if (Number.isNaN(when.getTime())) continue;
    if (
      when.getFullYear() !== new Date(start).getFullYear() ||
      when.getMonth() !== new Date(start).getMonth() ||
      when.getDate() !== new Date(start).getDate()
    ) {
      continue;
    }
    const miles = milesBetween(where, other);
    if (miles == null) continue;
    if (nearestMiles == null || miles < nearestMiles) {
      nearestMiles = miles;
      // From the end of theirs to the start of ours when they are first;
      // from the end of ours to the start of theirs when we are.
      const theirEnd = other.endIso ? new Date(other.endIso).getTime() : when.getTime() + 60 * 60_000;
      gapMinutes = start >= theirEnd ? (start - theirEnd) / 60_000 : (when.getTime() - (start + 60 * 60_000)) / 60_000;
    }
  }

  const needed = nearestMiles == null ? null : driveMinutes(nearestMiles);
  const reachable = needed == null || gapMinutes == null ? true : Math.abs(gapMinutes) >= needed;

  let score = 0;
  let says: string | null = null;

  // Sooner is better, gently and always. An evaluation that happens this week
  // is worth more than a better-routed one a fortnight out.
  score -= daysOut(slot, now) * 1.5;

  if (nearestMiles != null && gapMinutes != null) {
    if (!reachable) {
      // We would be arriving late, or leaving the one before early. Not a
      // convenience -- a promise we would break.
      score -= 50;
    } else if (nearestMiles <= NEIGHBOUR_MILES) {
      // Closer is better, and so is tighter: a four-hour gap on the same day
      // is not a round, it is two trips.
      score += 40 * (1 - nearestMiles / NEIGHBOUR_MILES);
      const slack = Math.abs(gapMinutes) - needed!;
      score += Math.max(0, 30 - slack / 4);
      // Said carefully. "On your street" is a claim we cannot make from a
      // straight-line mile, and an afternoon slot is not "that morning" --
      // copy that overstates by a little is copy somebody catches out.
      says =
        nearestMiles <= 1
          ? "We're minutes away just before this"
          : "We're already close by around then";
    }
  }

  return { ...slot, score, says, nearestMiles, gapMinutes, reachable };
}

export function rankSlots(
  slots: readonly AvailableSlotGroup[],
  where: { lat: number | null; lng: number | null },
  booked: readonly BookedNearby[],
  now: Date = new Date()
): RankedSlot[] {
  return slots
    .map((slot) => rankSlot(slot, where, booked, now))
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/**
 * The two or three to put in front of somebody, at most one a day.
 *
 * Three times on one morning is one option wearing three hats, and it reads as
 * a business with an empty diary. One good time on each of three days is a
 * choice, and it is the shape that gets picked.
 *
 * The soonest available is always among them even when it routes badly: plenty
 * of people booking an evaluation want the earliest date and nothing else, and
 * hiding it to save ourselves a drive is optimising the wrong side of the
 * transaction.
 */
export function recommendSlots(ranked: readonly RankedSlot[], count = 3): RankedSlot[] {
  const picked: RankedSlot[] = [];
  const days = new Set<string>();

  const soonest = [...ranked].sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
  )[0];
  if (soonest) {
    picked.push({ ...soonest, says: soonest.says ?? "Soonest we can get to you" });
    days.add(soonest.date);
  }

  for (const slot of ranked) {
    if (picked.length >= count) break;
    if (days.has(slot.date)) continue;
    // Never recommend a time we would arrive late to.
    if (!slot.reachable) continue;
    picked.push(slot);
    days.add(slot.date);
  }

  return picked.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
