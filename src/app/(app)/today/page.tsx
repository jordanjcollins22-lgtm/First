import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getCrewDay } from "@/lib/data/crew-day";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { TodayBoard } from "@/components/crew/today-board";

/**
 * The crew's day.
 *
 * Not tab-gated: this is the one screen every person in the field needs, and
 * gating it behind a checkbox somebody has to remember to tick is how a crew
 * member ends up standing in a yard with nothing to press. It only ever shows
 * that person's own stops, so there is nothing here to withhold.
 */
export default async function TodayPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const day = await getCrewDay().catch(() => null);

  if (!day) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">Today</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load your day. If this is a fresh setup, run{" "}
          <code>supabase/migrations/0082_crew_day.sql</code> and reload.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-4 sm:py-6">
      <TodayBoard
        stops={day.stops}
        events={day.events}
        dayTools={day.dayTools}
        personName={profile.full_name || profile.email}
      />
    </div>
  );
}
