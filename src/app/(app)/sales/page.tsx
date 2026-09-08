import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";

// The screens that already exist, rendered where the work happens rather than
// rebuilt. Importing a page's own component is deliberate: every one of these
// keeps its address, its data loading and its permission guard exactly as it
// had them, so this move cannot change what anybody can see.
import PipelinePage from "@/app/(app)/pipeline/page";
import LeadsPage from "@/app/(app)/leads/page";
import EvaluationsPage from "@/app/(app)/evaluations/page";
import ProposalsPage from "@/app/(app)/proposals/page";
import ContactsPage from "@/app/(app)/contacts/page";

/**
 * Selling, in the order it happens.
 *
 * Contacts, Pipeline, Proposals and New Estimate were four entries in the nav
 * for one conversation with one customer: who they are, where the deal is,
 * what we offered, and what came back. They are one module now.
 */
export const dynamic = "force-dynamic";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { tab } = await searchParams;

  const [pipeline, leads, evaluations, proposals, clients] = await Promise.all([
    holdsAny(["pipeline"]),
    holdsAny(["leads"]),
    holdsAny(["evaluations"]),
    holdsAny(["proposals", "invoices"]),
    holdsAny(["contacts"]),
  ]);

  return (
    <ModuleShell
      module="sales"
      asked={tab}
      content={{
        ...(pipeline ? { pipeline: <PipelinePage /> } : {}),
        ...(leads ? { leads: <LeadsPage /> } : {}),
        ...(evaluations ? { evaluations: <EvaluationsPage /> } : {}),
        ...(proposals ? { proposals: <ProposalsPage /> } : {}),
        ...(clients ? { clients: <ContactsPage /> } : {}),
      }}
    />
  );
}
