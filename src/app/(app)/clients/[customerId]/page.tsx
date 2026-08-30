import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listProfiles } from "@/lib/data/team";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { checkTabAccess, requireAnyTab } from "@/lib/data/access";
import { isSupabaseConfigured } from "@/lib/env";
import { ClientDetailPanel } from "@/components/attractors/client-detail-panel";
import { ArchivedProposalsPanel } from "@/components/clients/archived-proposals-panel";
import { listArchivedProposals } from "@/lib/data/archived-proposals";
import type { Customer, JobProposal } from "@/types/domain";
import type { PropertyWithCustomer } from "@/lib/data/properties";

export default async function ClientAccountPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const { allowed } = await checkTabAccess("project-data");
  if (!allowed) redirect("/attractors");
  await requireAnyTab(["client-detail", "contacts", "project-data", "pipeline"], "/attractors");

  const { customerId } = await params;
  const supabase = await createClient();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer) notFound();

  const { data: propertiesRaw, error: propertiesError } = await supabase
    .from("properties")
    .select("*, customer:customers(*)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (propertiesError) throw propertiesError;
  const properties = (propertiesRaw ?? []) as unknown as PropertyWithCustomer[];
  const propertyIds = properties.map((p) => p.id);

  const [allJobs, profiles, archived] = await Promise.all([
    listJobsWithLocation(),
    listProfiles(),
    // The quotes this client got before this app existed, carried over from
    // the old CRM. Loaded here so an empty archive costs nothing.
    listArchivedProposals(customerId),
  ]);
  const clientJobs = allJobs.filter((j) => propertyIds.includes(j.property_id));
  const jobIds = clientJobs.map((j) => j.id);

  let proposalsByJobId: Record<string, JobProposal> = {};
  if (jobIds.length > 0) {
    const { data: proposals, error: proposalsError } = await supabase
      .from("job_proposals")
      .select("*")
      .in("job_id", jobIds);
    if (proposalsError) throw proposalsError;
    proposalsByJobId = Object.fromEntries(
      ((proposals ?? []) as unknown as JobProposal[]).map((p) => [p.job_id, p])
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
      <Link href="/attractors" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to Project Data
      </Link>

      <div className="rounded-2xl border border-white/60 bg-card/70 p-6 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
        <ClientDetailPanel
          customer={customer as unknown as Customer}
          clientProperties={properties}
          jobs={clientJobs}
          profiles={profiles}
          proposalsByJobId={proposalsByJobId}
        />
      </div>

      <div className="rounded-2xl border border-white/60 bg-card/70 p-6 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
        <ArchivedProposalsPanel customerId={customerId} proposals={archived} />
      </div>
    </div>
  );
}
