import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { houseCounts, listHousesNeedingReview } from "@/lib/data/houses";
import { listPendingMatchReviews } from "@/lib/data/match-reviews";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { HouseReviewList } from "@/components/houses/house-review-list";
import { MatchReviewList } from "@/components/houses/match-review-list";

/**
 * The addresses the map is not drawing, and why.
 *
 * Every house the business knows about is here or on the map, and the counts
 * say which. A held address is not a failure -- it is the system declining to
 * invent a location, which is the whole reason a stranger's parcel never gets
 * welded onto a customer record.
 */
export default async function HouseReviewPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("house-review");
  if (!allowed) redirect("/attractors");

  const [counts, waiting, matches] = await Promise.all([
    houseCounts().catch(() => ({ total: 0, mappable: 0, held: 0, settled: 0 })),
    listHousesNeedingReview().catch(() => []),
    listPendingMatchReviews().catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Address Review</h1>
      <p className="mb-6 text-muted-foreground">
        Addresses held back rather than guessed at. Settle one and it goes on the map.
      </p>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: "On the map", value: counts.mappable },
          { label: "Waiting for you", value: counts.held },
          { label: "Settled", value: counts.settled },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border p-3 text-center">
            <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">County matches to settle</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Addresses the county holds that are close to one of ours but not identical. The import
          did not guess; you decide. {matches.length > 0 && `${matches.length} waiting.`}
        </p>
        <MatchReviewList reviews={matches} />
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Held addresses</h2>
        <p className="mb-3 text-sm text-muted-foreground">Ours, held back rather than drawn.</p>
        <HouseReviewList houses={waiting} />
      </section>
    </div>
  );
}
