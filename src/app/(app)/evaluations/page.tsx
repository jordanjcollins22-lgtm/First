import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getMyScheduleData } from "@/lib/data/my-schedule";
import { MyEvaluationsContent } from "@/components/evaluations/my-evaluations-content";
import { listCalendars } from "@/lib/data/calendars";
import { listProfiles } from "@/lib/data/team";
import { getBookingLinksBundle, type BookingLinksBundle } from "@/lib/data/booking-links";

export default async function EvaluationsPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  await requireTab("evaluations", "/attractors");

  const schedule = await getMyScheduleData();
  if (!schedule) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Sign in to see your evaluations.</p>
      </div>
    );
  }

  const [calendarData, booking] = await Promise.all([
    schedule.isAdmin
      ? Promise.all([listCalendars().catch(() => []), listProfiles().catch(() => [])])
      : Promise.resolve(null),
    getBookingLinksBundle().catch((): BookingLinksBundle => ({ myBookingLink: null })),
  ]);

  return (
    <MyEvaluationsContent
      schedule={schedule}
      calendars={calendarData?.[0]}
      teamMembers={calendarData?.[1].map((p) => ({ id: p.id, name: p.full_name || p.email }))}
      bookingLinks={booking.bookingLinks}
      myBookingLink={booking.myBookingLink}
    />
  );
}
