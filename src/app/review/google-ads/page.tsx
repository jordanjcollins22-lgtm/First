import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { GoogleAdsTracker } from "@/components/marketing/google-ads-tracker";
import { AdDraftsPanel } from "@/components/marketing/ad-drafts-panel";
import type { AdDraft } from "@/lib/data/ad-drafts";
import { adCopy } from "@/lib/marketing/ad-draft";
import type { DatedAdSpend } from "@/lib/data/ads-tracker";
import type { LeadRecord } from "@/lib/data/lead-sources";

/** The ads to approve and the Google Ads tracker on sample campaigns, for reviewing a preview from the Flow Board. */
export const dynamic = "force-dynamic";

const NOW = "2026-11-08T12:00:00.000Z";
const day = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const SPEND: DatedAdSpend[] = [
  { day: day(5).slice(0, 10), campaign: "Spring cleanups", amountCents: 42000, clicks: 180 },
  { day: day(20).slice(0, 10), campaign: "Spring cleanups", amountCents: 38000, clicks: 150 },
  { day: day(9).slice(0, 10), campaign: "Mulch and beds", amountCents: 25000, clicks: 95 },
  { day: day(14).slice(0, 10), campaign: "Snow removal", amountCents: 18000, clicks: 60 },
];

function lead(id: number, campaign: string | null, paid: number, ago: number): LeadRecord {
  return {
    jobId: `sample-${id}`,
    createdAt: day(ago),
    source: { group: "Google ad", detail: campaign },
    sold: paid > 0,
    revenue: paid,
    collected: paid,
    hasAffiliate: false,
    fromContent: false,
    profit: null,
  };
}

const LEADS: LeadRecord[] = [
  lead(1, "Spring cleanups", 2400, 4),
  lead(2, "Spring cleanups", 1850, 11),
  lead(3, "Spring cleanups", 0, 15),
  lead(4, "Spring cleanups", 0, 22),
  lead(5, "Mulch and beds", 950, 8),
  lead(6, "Mulch and beds", 0, 12),
  lead(7, "Snow removal", 0, 13),
  lead(8, null, 600, 18),
];

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

export default function ReviewGoogleAdsPage() {
  if (!reviewPagesEnabled()) notFound();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <p className="mb-3 text-sm text-muted-foreground">Sample campaigns. On the real Marketing page this is at the top of Attribution.</p>
      <div className="space-y-6">
        <AdDraftsPanel drafts={DRAFTS} spend={SPEND} leads={LEADS} now={NOW} demo />
        <GoogleAdsTracker spend={SPEND} leads={LEADS} now={NOW} />
      </div>
    </div>
  );
}
