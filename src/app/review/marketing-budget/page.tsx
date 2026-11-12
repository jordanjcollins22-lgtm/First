import { notFound } from "next/navigation";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { LeadSourcesPanel } from "@/components/marketing/lead-sources-panel";
import { listGhlLinks, listLeadSources, listMarketingTeam } from "@/lib/data/lead-sources";
import { reviewScope } from "@/lib/data/review-scope";

/** The lead sources panel with its growth budget and content profit pool, on the business's real leads, for reviewing a preview from the Flow Board. */
export const dynamic = "force-dynamic";

export default async function ReviewMarketingBudgetPage() {
  if (!reviewPagesEnabled()) notFound();
  const scope = await reviewScope();
  const [leads, team, ghlLinks] = await Promise.all([listLeadSources(365, scope), listMarketingTeam(scope), listGhlLinks(scope)]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <LeadSourcesPanel leads={leads} team={team} ghlLinks={ghlLinks} now={new Date().toISOString()} />
    </div>
  );
}
