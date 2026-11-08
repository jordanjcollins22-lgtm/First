import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { LeadSourcesPanel } from "@/components/marketing/lead-sources-panel";
import { listLeadSources, listMarketingTeam } from "@/lib/data/lead-sources";
import { reviewScope } from "@/lib/data/review-scope";

/** The lead sources panel with its growth budget and content profit pool, on the business's real leads, for reviewing a preview from the Flow Board. */
export const dynamic = "force-dynamic";

export default async function ReviewMarketingBudgetPage() {
  if (!reviewPagesEnabled()) notFound();
  const scope = await reviewScope();
  const [leads, team] = await Promise.all([listLeadSources(365, scope), listMarketingTeam(scope)]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <p className="mb-3 text-sm text-muted-foreground">Your real leads from the last year. On the real Marketing page this is under Attribution.</p>
      <LeadSourcesPanel leads={leads} team={team} now={new Date().toISOString()} />
    </div>
  );
}
