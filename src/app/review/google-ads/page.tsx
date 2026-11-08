import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { GoogleAdsTracker } from "@/components/marketing/google-ads-tracker";
import { AdDraftsPanel } from "@/components/marketing/ad-drafts-panel";
import type { AdDraft } from "@/lib/data/ad-drafts";
import { adCopy } from "@/lib/marketing/ad-draft";
import { listGoogleAdsSpend } from "@/lib/data/ads-tracker";
import { listLeadSources } from "@/lib/data/lead-sources";
import { reviewScope } from "@/lib/data/review-scope";

/** The ads to approve and the Google Ads tracker on sample campaigns, for reviewing a preview from the Flow Board. */
export const dynamic = "force-dynamic";

const NOW = "2026-11-08T12:00:00.000Z";

const DRAFTS: AdDraft[] = [
  {
    id: "sample-draft-1",
    jobId: "sample-job-1",
    name: "Bel Air Mulching 2026-11-08",
    ...adCopy({ services: ["Mulching"], town: "Bel Air", business: "JS Landscaping" }),
    keywords: ["mulching bel air", "landscaping bel air"],
    zip: "21014",
    photoUrl: "/booking-work/front-bed-mulch-trim.jpg",
    createdAt: NOW,
  },
];

export default async function ReviewGoogleAdsPage() {
  if (!reviewPagesEnabled()) notFound();
  // The tracker shows your real Google Ads spend and leads. The ad to approve stays a sample until its table exists (it is added on Approve).
  const scope = await reviewScope();
  const [spend, allLeads] = await Promise.all([listGoogleAdsSpend(365, scope), listLeadSources(365, scope)]);
  const leads = allLeads.filter((l) => l.source.group === "Google ad");
  const now = new Date().toISOString();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <p className="mb-3 text-sm text-muted-foreground">The ad below is a sample (real ones are made from crew photos once this is approved). The tracker under it is your real Google Ads data. On the real Marketing page both are at the top of Attribution.</p>
      <div className="space-y-6">
        <AdDraftsPanel drafts={DRAFTS} spend={spend} leads={leads} now={now} demo />
        <GoogleAdsTracker spend={spend} leads={leads} now={now} />
      </div>
    </div>
  );
}
