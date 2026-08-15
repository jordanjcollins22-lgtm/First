import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { listCalendars } from "@/lib/data/calendars";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CalendarSettings } from "@/components/calendars/calendar-settings";
import type { CalendarWithMembers } from "@/types/domain";

// Admin-only, gated on the role directly rather than a tab permission —
// same as Permissions and Organizations.
export default async function CalendarsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) redirect("/attractors");

  let calendars: CalendarWithMembers[] = [];
  let migrationMissing = false;
  try {
    calendars = await listCalendars();
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Calendar Settings</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          This page needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0064_calendars.sql</code>, then reload this page.
        </p>
      </div>
    );
  }

  const profiles = await listProfiles();
  const teamMembers = profiles.map((p) => ({ id: p.id, name: p.full_name || p.email }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Calendar Settings</h1>
      <p className="mb-6 text-muted-foreground">
        Name the calendars your business runs on and assign who belongs to each one.
      </p>
      <CalendarSettings calendars={calendars} teamMembers={teamMembers} />
    </div>
  );
}
