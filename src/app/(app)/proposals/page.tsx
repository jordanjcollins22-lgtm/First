import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess, requireTab } from "@/lib/data/access";
import { PageTabs } from "@/components/ui/page-tabs";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listAllProposals } from "@/lib/data/all-proposals";
import { ProposalsView } from "@/components/proposal/proposals-view";
import { listInvoices } from "@/lib/data/client-invoices";
import { InvoicesPanel } from "@/components/payments/invoices-panel";

/**
 * What we asked for, in both forms it takes.
 *
 * A proposal is what we offered and an invoice is what we billed — the same
 * conversation about money at two points in time, and the office moves between
 * them constantly. Invoices used to live on the Money page, which meant seeing
 * a client's bill required being trusted with payroll and overhead. Here they
 * need only their own tick.
 */
export default async function ProposalsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("proposals", "/pipeline");

  const invoiceAccess = await checkTabAccess("invoices");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Proposals &amp; Invoices</h1>
      <p className="mb-4 text-sm text-muted-foreground sm:mb-6 sm:text-base">
        What we offered, and what we billed.
      </p>
      <PageTabs
        tabs={[
          { key: "proposals", label: "Proposals", content: await ProposalsTab() },
          {
            key: "invoices",
            label: "Invoices",
            content: invoiceAccess.allowed ? await InvoicesTab() : null,
            visible: invoiceAccess.allowed,
          },
        ]}
      />
    </div>
  );
}

async function ProposalsTab() {
  const proposals = await listAllProposals().catch((err) => {
    console.error("Proposals failed to load:", err);
    return [];
  });

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Proposals generate automatically once an evaluation is submitted — edit the price or scope,
        then approve to send.
      </p>
      <ProposalsView proposals={proposals} />
    </div>
  );
}

/**
 * Invoices on file, and the forms to add one.
 *
 * Loaded on its own and allowed to fail on its own: it reads a table that may
 * not exist yet on a database that has not had the migration run, and that
 * should cost this tab rather than the page.
 */
async function InvoicesTab() {
  const page = await listInvoices().catch((err) => {
    console.error("Invoices failed to load:", err);
    return null;
  });

  if (!page) {
    return (
      <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
        Couldn&apos;t load invoices. If this is a fresh setup, run{" "}
        <code>supabase/migrations/0142_client_invoices.sql</code>.
      </p>
    );
  }

  return <InvoicesPanel initial={page.invoices} hasMore={page.more} />;
}
