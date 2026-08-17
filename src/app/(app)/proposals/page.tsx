import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listAllProposals } from "@/lib/data/all-proposals";
import { ProposalsView } from "@/components/proposal/proposals-view";

export default async function ProposalsPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const { allowed } = await checkTabAccess("project-data");
  if (!allowed) redirect("/attractors");

  const proposals = await listAllProposals();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Proposals</h1>
      <p className="mb-6 text-muted-foreground">
        Proposals generate automatically once an evaluation is submitted — edit the price or scope, then approve to
        send.
      </p>
      <ProposalsView proposals={proposals} />
    </div>
  );
}
