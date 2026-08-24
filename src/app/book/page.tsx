import { isSupabaseConfigured } from "@/lib/env";
import { resolveBookingContext, listPublicServices, listOrgEvaluatorIds, listAvailabilityData } from "@/lib/data/public-booking";
import { computeAvailableSlots } from "@/lib/booking-availability";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import { BookingWizard } from "@/components/booking/booking-wizard";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">
        Booking isn&apos;t available yet.
      </div>
    );
  }

  const params = await searchParams;
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const org = typeof params.org === "string" ? params.org : undefined;

  const context = await resolveBookingContext({ ref, org });

  if (!context) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">This booking link isn&apos;t valid.</p>
        <p className="mt-1 text-sm text-muted-foreground">Double check the link, or contact us directly.</p>
      </div>
    );
  }

  const evaluatorIds = context.dedicatedEvaluatorId
    ? [context.dedicatedEvaluatorId]
    : await listOrgEvaluatorIds(context.organizationId);

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

  if (evaluatorIds.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">Booking isn&apos;t open right now.</p>
        <p className="mt-1 text-sm text-muted-foreground">Please contact us directly to schedule.</p>
      </div>
    );
  }

  return (
    <BookingWizard
      organizationId={context.organizationId}
      organizationName={context.organizationName}
      referredByProfileId={context.referredByProfileId}
      services={services}
      slots={slots}
    />
  );
}
