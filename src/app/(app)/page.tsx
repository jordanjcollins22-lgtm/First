import { redirect } from "next/navigation";
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
import { isAccountManager, isCommenterOnly, isFieldOnly } from "@/lib/affiliate-roles";
import { MOVED } from "@/lib/moved-routes";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { new: wantsForm } = await searchParams;
  const { allowed, profile } = await checkTabAccess("new-property");

  // Anybody who only works in the field lands on their day and stays there.
  // The office view is noise to somebody standing in a yard with a mower.
  if (profile && isFieldOnly(profile.roles)) redirect("/today");
  // Somebody who only answers posts has one screen, and it is My Day.
  if (profile && isCommenterOnly(profile.roles)) redirect("/my-day");

  // Admins land on the business, not on a form. Whoever opens this app first
  // thing wants to know what is happening today before they want to start
  // anything new. ?new=1 is how the nav still reaches the form — without it
  // the redirect would swallow the only link to it.
  // Straight to where /dashboard now lives, rather than to /dashboard and
  // letting next.config bounce it on. Opening the app was three round trips --
  // this page, the redirect, then the destination -- and the first two of them
  // are a full server render and a wasted hop before anything is drawn. The
  // address is read from the same table the redirect uses, so the two can
  // never disagree about where the dashboard went.
  if (!wantsForm && profile?.roles.includes("admin")) {
    const { allowed: canSeeDashboard } = await checkTabAccess("dashboard");
    if (canSeeDashboard) redirect(MOVED["/dashboard"] ?? "/dashboard");
  }

  // And an account manager lands on their own version of it, for the same
  // reason: the first question of the morning is what is left today.
  if (!wantsForm && profile && isAccountManager(profile.roles)) redirect("/my-day");

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

    // Nothing to start here and no evaluations to run: their day is on My
    // Day. A page titled New Estimate that says "no access" was the first
    // thing somebody who answers posts saw every time they opened the app.
    redirect("/my-day");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-bold">New Estimate</h1>
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
