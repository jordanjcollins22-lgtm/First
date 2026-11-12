import { notFound } from "next/navigation";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { reviewScope } from "@/lib/data/review-scope";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { fallback, loadLeadFinder, type FinderData } from "@/lib/data/lead-finder";
import { LEAD_FINDER_LEAD_SCORE, LEAD_FINDER_LETTER_SCORE, LEAD_FINDER_WEEKLY_COUNT, weekOf } from "@/lib/lead-finder";
import { LeadFinder } from "@/components/leads/lead-finder";

/**
 * The lead finder, for reviewing on a preview without signing in: this
 * week's list from the real table when migration 0375 has run, otherwise
 * the 44-place business list as a sample week. The boxes tick and the score
 * moves; nothing on this page saves.
 */
export const dynamic = "force-dynamic";

export default async function ReviewLeadFinderPage() {
  if (!reviewPagesEnabled()) notFound();
  const week = weekOf(new Date());

  let data: FinderData = fallback(week);
  if (isSupabaseAdminConfigured) {
    try {
      const live = await loadLeadFinder(await reviewScope(), week);
      // An empty week on a fresh table shows the sample instead, so there is something to check.
      if (live.ready && live.rows.length > 0) data = live;
    } catch (err) {
      console.error("review lead-finder:", err);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-8 text-sm">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Lead finder · {data.ready ? "real data, read only" : "sample week from the business list"}</p>
        <h1 className="text-2xl font-extrabold">Commercial prospects to look at this week</h1>
        <p className="mt-1 max-w-3xl text-stone-600">
          {LEAD_FINDER_WEEKLY_COUNT} properties a week, from Maryland&apos;s free assessment roll (SDAT) and the business list: commercial, churches, HOAs and
          apartments in Bel Air, Fallston, Forest Hill and Abingdon. Open Street View and satellite, tick what you see, and the 0-10 score follows.{" "}
          {LEAD_FINDER_LEAD_SCORE}+ is offered as a lead (walk-in), {LEAD_FINDER_LETTER_SCORE}-{LEAD_FINDER_LEAD_SCORE - 1} a letter. Preview only: nothing here saves.
        </p>
      </header>
      <LeadFinder
        week={data.week}
        rows={data.rows}
        counts={data.counts}
        canSave={false}
        readOnlyNote="Preview: tick boxes to see the score move. Nothing is saved on this page."
        mapboxToken={env.mapboxToken}
      />
    </main>
  );
}
