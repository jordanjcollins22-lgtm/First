import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";
import { CalendarTab, WeatherTab } from "@/app/(app)/evaluations/page";

/**
 * When the work happens.
 *
 * The calendar and the forecast side by side, because you check the weather to
 * decide what to book, and the booking links beside them.
 *
 * Availability stays on the calendar rather than becoming a tab: the weekly
 * hours and days off are drawn on the grid, which is where somebody reads
 * them, and separating them would mean rewriting the grid to satisfy a tab.
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
          ? {
              calendar: await CalendarTab({ section: "calendar" }),
              weather: await WeatherTab(),
              booking: await CalendarTab({ section: "booking" }),
            }
          : {}
      }
    />
  );
}
