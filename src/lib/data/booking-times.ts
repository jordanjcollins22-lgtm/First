import { computeAvailableSlots } from "@/lib/booking-availability";
import { firstBookableDate, minLeadMinutes } from "@/lib/booking-notice";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import { getBookingNotice, listAvailabilityData } from "@/lib/data/public-booking";
import { rankSlots, recommendSlots, type RankedSlot } from "@/lib/booking-recommendation";

export interface OfferedTime {
  date: string;
  time: string;
  evaluatorIds: string[];
  /** Why this one, in the client's language. Null when there is nothing true to say. */
  says: string | null;
}

export interface BookingTimes {
  /** The two or three to put in front of somebody, at most one a day. */
  recommended: OfferedTime[];
  /** Everything free, in the order we would rather they were taken. */
  all: OfferedTime[];
}

/** What crosses the wire: the time and the reason, never the distance or whose it is. */
function offered(slot: RankedSlot): OfferedTime {
  return { date: slot.date, time: slot.time, evaluatorIds: slot.evaluatorIds, says: slot.says };
}

/**
 * The free evaluation times for these evaluators, ranked for a property at
 * `where`: the hours next to a visit already booked nearby first. Used by the
 * booking page's times endpoint and by the visit pick after paying.
 */
export async function bookingTimesFor(
  organizationId: string,
  evaluatorIds: string[],
  where: { lat: number | null; lng: number | null }
): Promise<BookingTimes> {
  if (evaluatorIds.length === 0) return { recommended: [], all: [] };
  const [availability, busy, notice] = await Promise.all([
    listAvailabilityData(evaluatorIds),
    getBusyBlocksAsAdmin().catch(() => []),
    getBookingNotice(organizationId),
  ]);

  const now = new Date();
  const slots = computeAvailableSlots({
    evaluatorIds,
    weeklyAvailability: availability.weeklyAvailability,
    daysOff: availability.daysOff,
    bookedTimes: availability.bookedTimes,
    busy,
    from: now,
    // The business's notice rule: no same-day visits unless allowed, and
    // never inside its hours of notice.
    firstDate: firstBookableDate(notice, now),
    minLeadMinutes: minLeadMinutes(notice),
    // The evaluators' hours are on the business's clock, not the server's.
    timeZone: notice.timeZone,
  });

  const ranked = rankSlots(slots, where, availability.bookedPlaces);
  return { recommended: recommendSlots(ranked).map(offered), all: ranked.map(offered) };
}
