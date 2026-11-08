import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { LeadSourcesPanel } from "@/components/marketing/lead-sources-panel";
import type { LeadRecord } from "@/lib/data/lead-sources";

/** The lead sources panel with its growth budget, on sample leads, for reviewing a preview from the Flow Board. */
export const dynamic = "force-dynamic";

const NOW = "2026-11-08T12:00:00.000Z";
const day = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

function lead(id: number, group: string, detail: string | null, paid: number, hasAffiliate: boolean, ago: number): LeadRecord {
  return { jobId: `sample-${id}`, createdAt: day(ago), source: { group, detail }, sold: paid > 0, revenue: paid, collected: paid, hasAffiliate };
}

const SAMPLE: LeadRecord[] = [
  lead(1, "Google ad", "Spring cleanups", 4800, false, 12),
  lead(2, "Google ad", "Spring cleanups", 2650, false, 20),
  lead(3, "Google ad", null, 0, false, 25),
  lead(4, "Affiliate's booking link", "Sam", 6200, true, 8),
  lead(5, "Facebook post", "Alex", 3100, true, 15),
  lead(6, "Yard sign", null, 1900, false, 30),
  lead(7, "Flyer", null, 2400, false, 40),
  lead(8, "Flyer", null, 0, false, 41),
  lead(9, "Booked online, no trail", null, 1250, false, 50),
];

export default function ReviewMarketingBudgetPage() {
  if (!reviewPagesEnabled()) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <p className="mb-3 text-sm text-muted-foreground">Sample leads. On the real Marketing page this is under Attribution.</p>
      <LeadSourcesPanel leads={SAMPLE} now={NOW} />
    </div>
  );
}
