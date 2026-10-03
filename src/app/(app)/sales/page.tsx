import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";

// The screens that already exist, rendered where the work happens rather than
// rebuilt. Importing a page's own component is deliberate: every one of these
// keeps its address, its data loading and its permission guard exactly as it
// had them, so this move cannot change what anybody can see.
import PipelinePage from "@/app/(app)/pipeline/page";
import LeadsPage from "@/app/(app)/leads/page";
import ProposalsPage from "@/app/(app)/proposals/page";
import ContactsPage from "@/app/(app)/contacts/page";
import MowOrdersPage from "@/app/(app)/mow-orders/page";
import { getCurrentProfile } from "@/lib/data/team";
import { getEvaluationsToday } from "@/lib/data/evaluations-today";
import { EvaluationsToday } from "@/components/evaluations/evaluations-today";
import { isOwnerLevel } from "@/lib/roles";
import { getPriceApprovals } from "@/lib/data/price-approvals";
import { PriceQueue } from "@/components/proposal/price-queue";

/**
 * Selling, in the order it happens.
 *
 * Contacts, Pipeline, Proposals and New Estimate were four entries in the nav
 * for one conversation with one customer: who they are, where the deal is,
 * what we offered, and what came back. They are one department now. The
 * evaluations moved to Operations, beside the calendar they are booked on.
 */
export const dynamic = "force-dynamic";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string; price?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { tab, price } = await searchParams;

  const [pipeline, leads, proposals, clients, mows] = await Promise.all([
    holdsAny(["pipeline"]),
    holdsAny(["leads"]),
    holdsAny(["proposals", "invoices"]),
    holdsAny(["contacts"]),
    holdsAny(["mow-orders"]),
  ]);

  return (
    <ModuleShell
      module="sales"
      asked={tab}
      content={{
        ...(pipeline ? { today: <EvaluationsTodayTab price={price ?? null} />, pipeline: <PipelinePage /> } : {}),
        ...(leads ? { leads: <LeadsPage /> } : {}),
        ...(proposals ? { proposals: <ProposalsPage /> } : {}),
        ...(clients ? { clients: <ContactsPage /> } : {}),
        ...(mows ? { mows: <MowOrdersPage /> } : {}),
      }}
    />
  );
}

/**
 * First, every walkthrough whose proposal hasn't gone out, whatever day it
 * was done, each opening to its price service by service. Then every
 * evaluation out today with its progress bar: all of them for the office,
 * their own for anybody else.
 */
async function EvaluationsTodayTab({ price }: { price: string | null }) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const [approvals, evaluations] = await Promise.all([
    getPriceApprovals().catch((err) => {
      console.error("Price approvals failed to load:", err);
      return null;
    }),
    getEvaluationsToday({ id: profile.id, seesAll: isOwnerLevel(profile.roles) || profile.roles.includes("admin") }).catch((err) => {
      console.error("Evaluations today failed to load:", err);
      return null;
    }),
  ]);
  return (
    <>
      {approvals && <PriceQueue items={approvals} initialOpen={price} />}
      <h2 className="mb-2 text-lg font-bold">Evaluations today</h2>
      {evaluations ? <EvaluationsToday evaluations={evaluations} /> : <p className="text-sm text-muted-foreground">Couldn&apos;t load today&apos;s evaluations. Try again in a moment.</p>}
    </>
  );
}
