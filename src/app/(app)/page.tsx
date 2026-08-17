import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPropertyForm } from "@/components/property/new-property-form";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MyEvaluationsContent } from "@/components/evaluations/my-evaluations-content";
import { listCalendars } from "@/lib/data/calendars";
import { listProfiles } from "@/lib/data/team";
import { getBookingLinksBundle, type BookingLinksBundle } from "@/lib/data/booking-links";
import { checkTabAccess } from "@/lib/data/access";
import { getMyScheduleData } from "@/lib/data/my-schedule";
import { isMapboxConfigured, isSupabaseConfigured } from "@/lib/env";

export default async function Home() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed, profile } = await checkTabAccess("new-property");

  if (profile && !allowed) {
    const { allowed: canSeeEvaluations } = await checkTabAccess("evaluations");
    if (canSeeEvaluations) {
      const schedule = await getMyScheduleData();
      if (schedule) {
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
    }

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:py-10">
        <h1 className="text-2xl font-bold">New Property Estimate</h1>
        <p className="text-sm text-muted-foreground">
          Your account doesn&apos;t have access to this page. Ask an admin to grant it under Databases &rarr;
          Permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-bold">New Property Estimate</h1>
        <p className="text-muted-foreground">
          Enter an address to load satellite imagery and start mapping work areas.
        </p>
      </div>

      {!isMapboxConfigured && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Setup required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Mapbox is not configured. Fill in <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> in{" "}
              <code>.env.local</code>.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <NewPropertyForm />
        </CardContent>
      </Card>

      <div className="text-center">
        <Button variant="link" asChild>
          <Link href="/attractors">View project data &rarr;</Link>
        </Button>
      </div>
    </div>
  );
}
