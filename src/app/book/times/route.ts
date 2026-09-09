import { NextResponse, type NextRequest } from "next/server";

import { computeAvailableSlots } from "@/lib/booking-availability";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import { listAvailabilityData, listOrgEvaluatorIds, resolveBookingContext } from "@/lib/data/public-booking";
import { rankSlots, recommendSlots, type RankedSlot } from "@/lib/booking-recommendation";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * The times to offer somebody, once we know where they are.
 *
 * The ranking happens here and not in the browser, and that is the whole
 * reason this endpoint exists. Working out which free hour sits next to an
 * evaluation already booked nearby needs the coordinates of those
 * evaluations — which are people's homes, and the booking page is opened by
 * strangers. So the addresses stay on the server and what goes back is a list
 * of times with a sentence attached.
 *
 * A caller who sends nonsense, or nothing, still gets a usable answer: the
 * same free hours, ranked by how soon they are, with nothing claimed about
 * being nearby.
 */

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

function coordinate(raw: string | null, limit: number): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

export async function GET(request: NextRequest): Promise<NextResponse<BookingTimes>> {
  const empty = NextResponse.json<BookingTimes>(
    { recommended: [], all: [] },
    { headers: { "Cache-Control": "no-store" } }
  );
  if (!isSupabaseConfigured) return empty;

  const params = request.nextUrl.searchParams;
  const context = await resolveBookingContext({
    ref: params.get("ref") ?? undefined,
    org: params.get("org") ?? undefined,
  });
  if (!context) return empty;

  const evaluatorIds = context.dedicatedEvaluatorId
    ? [context.dedicatedEvaluatorId]
    : await listOrgEvaluatorIds(context.organizationId);
  if (evaluatorIds.length === 0) return empty;

  const [availability, busy] = await Promise.all([
    listAvailabilityData(evaluatorIds),
    getBusyBlocksAsAdmin().catch(() => []),
  ]);

  const slots = computeAvailableSlots({
    evaluatorIds,
    weeklyAvailability: availability.weeklyAvailability,
    daysOff: availability.daysOff,
    bookedTimes: availability.bookedTimes,
    busy,
    from: new Date(),
  });

  const where = {
    lat: coordinate(params.get("lat"), 90),
    lng: coordinate(params.get("lng"), 180),
  };

  const ranked = rankSlots(slots, where, availability.bookedPlaces);

  return NextResponse.json<BookingTimes>(
    { recommended: recommendSlots(ranked).map(offered), all: ranked.map(offered) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
