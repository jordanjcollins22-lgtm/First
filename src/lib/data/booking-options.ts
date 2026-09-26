import { computeAvailableSlots } from "@/lib/booking-availability";
import { describeNotice, firstBookableDate, minLeadMinutes } from "@/lib/booking-notice";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import {
  getBookingNotice,
  listAvailabilityData,
  listOrgEvaluatorIds,
  listPublicServices,
  resolveBookingContext,
} from "@/lib/data/public-booking";
import { publicProof, serviceForCode } from "@/lib/data/booking-proof";
import { NO_PROOF } from "@/lib/booking-proof";
import type { BookingOptions } from "@/app/book/booking-options";

/**
 * Everything the booking page needs for one link: whose calendar, what they
 * offer, which hours are free, and what backs up the comment that sent the
 * person here. The public page fetches it through /book/options; the
 * owner's preview calls it directly, so both show the same thing.
 */
export async function loadBookingOptions(params: { ref?: string; org?: string; rec?: string }): Promise<BookingOptions> {
  const context = await resolveBookingContext(params);
  if (!context) return { status: "unknown-link" };

  // Everything that needs only the business starts now, alongside working
  // out who can be booked; only the hours wait for that. Each step used to
  // wait for the one before it.
  const rest = Promise.all([
    listPublicServices(context.organizationId),
    // Every other calendar these people are on. Without this a client could be
    // offered ten o'clock with somebody who has been on an install since eight.
    getBusyBlocksAsAdmin().catch(() => []),
    getBookingNotice(context.organizationId),
    // Never allowed to take the page down: a booking page with no reviews on
    // it still books.
    publicProof(context.organizationId).catch((err) => {
      console.error("Booking page proof failed to load:", err);
      return NO_PROOF;
    }),
    serviceForCode(params.rec).catch(() => null),
  ]);
  // Handled here too, so a page that closes early never leaves it unhandled.
  rest.catch(() => {});

  const evaluatorIds = context.dedicatedEvaluatorId
    ? [context.dedicatedEvaluatorId]
    : await listOrgEvaluatorIds(context.organizationId);

  if (evaluatorIds.length === 0) return { status: "closed" };

  const [[services, busy, notice, proof, service], availability] = await Promise.all([rest, listAvailabilityData(evaluatorIds)]);

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
  });

  return {
    status: "ok",
    organizationId: context.organizationId,
    organizationName: context.organizationName,
    referredByProfileId: context.referredByProfileId,
    services,
    slots,
    noticeText: describeNotice(notice),
    proof,
    service,
  };
}
