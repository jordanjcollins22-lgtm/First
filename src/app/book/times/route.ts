import { NextResponse, type NextRequest } from "next/server";

import { bookingTimesFor, type BookingTimes } from "@/lib/data/booking-times";
import { listOrgEvaluatorIds, resolveBookingContext } from "@/lib/data/public-booking";
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

export type { BookingTimes, OfferedTime } from "@/lib/data/booking-times";

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

  const where = {
    lat: coordinate(params.get("lat"), 90),
    lng: coordinate(params.get("lng"), 180),
  };

  return NextResponse.json<BookingTimes>(await bookingTimesFor(context.organizationId, evaluatorIds, where), {
    headers: { "Cache-Control": "no-store" },
  });
}
