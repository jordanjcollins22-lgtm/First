import { isSupabaseConfigured } from "@/lib/env";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { listPublicExternalMessages } from "@/lib/data/public-job-messages";
import { ProposalView } from "@/components/proposal/proposal-view";

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">
        This isn&apos;t available yet.
      </div>
    );
  }

  const { token } = await params;
  const data = await getProposalByToken(token);

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">This proposal link isn&apos;t valid.</p>
        <p className="mt-1 text-sm text-muted-foreground">Double check the link, or contact us directly.</p>
      </div>
    );
  }

  const messages = await listPublicExternalMessages(token);

  return <ProposalView data={data} token={token} messages={messages} />;
}
