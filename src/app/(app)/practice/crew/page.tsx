import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CrewJourney } from "@/components/practice/crew-journey";

/** The crew sheet, every page, for staff inside the app. See CrewJourney. */
export const dynamic = "force-dynamic";

export default async function CrewJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");
  return <CrewJourney backHref="/my-day?tab=system" />;
}
