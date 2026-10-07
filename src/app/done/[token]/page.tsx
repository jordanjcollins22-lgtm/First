import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { clientReviewByToken } from "@/lib/data/client-review";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ClientReviewForm } from "@/components/closeout/client-review-form";

/**
 * Where the client says whether they are happy.
 *
 * Each area's before beside its after, then two buttons: approve, or say
 * what is not right. The job is not signed off until they approve.
 */
export const dynamic = "force-dynamic";

export default async function ClientReviewPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const page = await clientReviewByToken(token);
  if (!page) notFound();

  const first = (page.clientName ?? "").trim().split(/\s+/)[0];
  const street = page.address.split(",")[0];

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{page.businessName}</p>
        <h1 className="mt-0.5 text-2xl font-semibold">{first ? `${first}, your` : "Your"} project is finished</h1>
        <p className="mt-1 text-sm text-muted-foreground">{street}. Here is each area before and after.</p>
      </header>

      {page.pairs.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">The photos are not ready to show yet. We will send them shortly.</p>
      ) : (
        <ol className="flex flex-col gap-5">
          {page.pairs.map((pair) => (
            <li key={pair.zoneId} className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">{pair.zoneName}</h2>
              <div className="grid grid-cols-2 gap-2">
                {(["before", "after"] as const).map((side) => (
                  <figure key={side} className="flex flex-col gap-1">
                    {pair[side] ? (
                      // Signed storage URLs, which next/image cannot optimise.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pair[side]!} alt={`${pair.zoneName}, ${side}`} className="aspect-[4/3] w-full rounded-lg border border-border object-cover" />
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">No photo</div>
                    )}
                    <figcaption className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{side}</figcaption>
                  </figure>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      <ClientReviewForm
        token={page.token}
        status={page.review.status}
        note={page.review.clientNote}
        superseded={page.superseded}
        hasPhotos={page.pairs.length > 0}
      />
    </main>
  );
}
