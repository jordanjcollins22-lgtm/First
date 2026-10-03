import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getSubQuoteByToken } from "@/lib/data/sub-quotes";
import { THUMBNAIL } from "@/lib/storage-image-url";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ResizedImage } from "@/components/proposal/resized-image";
import { QuoteForm } from "@/components/quote/quote-form";

/**
 * One service's worth of a job, for the contractor who will price it.
 *
 * Every area that needs this service, in our words, with its photos. No
 * zone names, no client, no other services. Then a box for their price.
 */
export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const request = await getSubQuoteByToken(token);
  if (!request) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{request.businessName}</p>
      <h1 className="mt-0.5 text-2xl font-semibold">{request.serviceLabel}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We need a price for the work below. Have a look at each area and the photos, then put your number at the bottom.
      </p>
      {request.address && <p className="mt-2 text-sm">{request.address}</p>}
      {request.note && <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">{request.note}</p>}

      <ol className="mt-6 flex flex-col gap-5">
        {request.areas.map((area, i) => (
          <li key={i} className="rounded-xl border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Area {i + 1} of {request.areas.length}
            </p>
            {area.scopeText && <p className="mt-1 text-sm leading-relaxed">{area.scopeText}</p>}
            {area.photoPaths.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {area.photoPaths.map((path) => (
                  <ResizedImage key={path} path={path} transform={THUMBNAIL} alt={`${request.serviceLabel} area ${i + 1}`} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <QuoteForm
          token={request.token}
          serviceLabel={request.serviceLabel}
          areaCount={request.areas.length}
          closed={request.status === "closed"}
          existing={
            request.quoteAmount != null
              ? { name: request.contractorName ?? "", amount: request.quoteAmount, note: request.quoteNote ?? "", at: request.quotedAt }
              : null
          }
          businessPhone={request.businessPhone}
        />
      </div>
    </main>
  );
}
