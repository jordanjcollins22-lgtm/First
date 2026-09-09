import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";
import { CalendarTab, WeatherTab } from "@/app/(app)/evaluations/page";
import { SuggestionsPanel } from "@/components/schedule/suggestions-panel";
import { scheduleSuggestions } from "@/lib/data/schedule-engine";
import { getCurrentProfile } from "@/lib/data/team";
import { canRunJobs, isOwnerLevel } from "@/lib/roles";

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
              suggestions: await SuggestionsTab(),
            }
          : {}
      }
    />
  );
}

/**
 * The engine's opinion, and nothing more than that.
 *
 * It fails on its own: a forecast that will not answer or a site plan that
 * will not read costs this subtab a caveat, not the calendar beside it.
 */
async function SuggestionsTab() {
  const [output, viewer] = await Promise.all([
    scheduleSuggestions().catch((err) => {
      console.error("Schedule suggestions failed to load:", err);
      return { enabled: false, suggestions: [], moves: [], caveats: [] };
    }),
    getCurrentProfile().catch(() => null),
  ]);
  const roles = (viewer?.roles ?? []) as string[];
  return (
    <SuggestionsPanel
      enabled={output.enabled}
      suggestions={output.suggestions}
      moves={output.moves}
      caveats={output.caveats}
      canAccept={canRunJobs(roles)}
      canToggle={isOwnerLevel(roles)}
    />
  );
}
