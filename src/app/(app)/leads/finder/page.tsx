import Link from "next/link";

import { isSupabaseConfigured, env } from "@/lib/env";
import { requireTab, checkTabAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { loadLeadFinder, fallback, type FinderData } from "@/lib/data/lead-finder";
import { weekOf, LEAD_FINDER_LEAD_SCORE, LEAD_FINDER_LETTER_SCORE, LEAD_FINDER_WEEKLY_COUNT } from "@/lib/lead-finder";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { LeadFinder } from "@/components/leads/lead-finder";

/**
 * The lead finder: this week's commercial, church, HOA and apartment
 * properties to look at on satellite and Street View, scored 0-10 for
 * landscaping need. From the State's free assessment roll and the business
 * list; no Google Places, no scrapers.
 */
export const dynamic = "force-dynamic";

export default async function LeadFinderPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("leads", "/my-day");
  const { profile } = await checkTabAccess("leads");
  const week = weekOf(new Date());

  let data: FinderData;
  try {
    data = profile ? await loadLeadFinder({ client: await createClient(), organizationId: profile.organization_id }, week) : fallback(week);
  } catch (err) {
    console.error("Lead finder failed to load:", err);
    data = fallback(week);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <Link href="/leads" className="text-sm text-muted-foreground underline">
        Lead Generation
      </Link>
      <h1 className="mb-1 mt-1 text-2xl font-bold">Lead finder</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        About {LEAD_FINDER_WEEKLY_COUNT} properties a week from the State&apos;s assessment roll. Look at each on satellite and Street View, tick
        what you see, and the score follows: {LEAD_FINDER_LEAD_SCORE}+ is a walk-in with a one-page quote, {LEAD_FINDER_LETTER_SCORE}-
        {LEAD_FINDER_LEAD_SCORE - 1} a letter or email, below that waits for spring.
      </p>
      <LeadFinder
        week={data.week}
        rows={data.rows}
        counts={data.counts}
        canSave={data.ready}
        readOnlyNote={data.ready ? undefined : "This is the business list as a sample week. Saving needs the database update (supabase/migrations/0375_lead_finder.sql) run first."}
        mapboxToken={env.mapboxToken}
      />
    </div>
  );
}
