import { NextResponse, type NextRequest } from "next/server";

import { computeAvailableSlots } from "@/lib/booking-availability";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import {
  listAvailabilityData,
  listOrgEvaluatorIds,
  listPublicServices,
  resolveBookingContext,
} from "@/lib/data/public-booking";
import { isSupabaseConfigured } from "@/lib/env";

import type { BookingOptions } from "../booking-options";

/**
 * The dynamic half of the public booking page.
 *
 * /book itself is now a prerendered shell: the same bytes for everybody, out
 * of the edge cache, with no database behind it. This is what that shell asks
 * for once it is on screen — who the link belongs to, what that business
 * offers, and which hours are still free.
 *
 * It is deliberately not cached. Open times are the one thing on this page
 * that must not be stale: a client picking an hour that was taken two minutes
 * ago gets sent back to the calendar by the server-side re-check in
 * submitPublicBooking, which is a worse first impression than the second this
 * query costs. Everything that *can* be stale was moved into the shell.
 */
export async function GET(request: NextRequest): Promise<NextResponse<BookingOptions>> {
  const answer = (body: BookingOptions) =>
    NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

  if (!isSupabaseConfigured) {
    return answer({ status: "unavailable" });
  }

  const ref = request.nextUrl.searchParams.get("ref") ?? undefined;
  const org = request.nextUrl.searchParams.get("org") ?? undefined;

  const context = await resolveBookingContext({ ref, org });
  if (!context) {
    return answer({ status: "unknown-link" });
  }

  const evaluatorIds = context.dedicatedEvaluatorId
    ? [context.dedicatedEvaluatorId]
    : await listOrgEvaluatorIds(context.organizationId);

  if (evaluatorIds.length === 0) {
    return answer({ status: "closed" });
  }

  const [services, availability, busy] = await Promise.all([
    listPublicServices(context.organizationId),
    listAvailabilityData(evaluatorIds),
    // Every other calendar these people are on. Without this a client could be
    // offered ten o'clock with somebody who has been on an install since eight.
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

  return answer({
    status: "ok",
    organizationId: context.organizationId,
    organizationName: context.organizationName,
    referredByProfileId: context.referredByProfileId,
    services,
    slots,
  });
}
