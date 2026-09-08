import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";
import { CalendarTab, WeatherTab } from "@/app/(app)/evaluations/page";

/**
 * When the work happens.
 *
 * The calendar and the forecast, side by side, because you check the weather
 * to decide what to book. Availability and the booking links live inside the
 * calendar itself today; splitting them out is the next pass, not a reason to
 * show two empty tabs now.
 */
export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { tab } = await searchParams;
  const canSchedule = await holdsAny(["evaluations"]);

  return (
    <ModuleShell
      module="schedule"
      asked={tab}
      content={
        canSchedule
          ? { calendar: await CalendarTab(), weather: await WeatherTab() }
          : {}
      }
    />
  );
}
