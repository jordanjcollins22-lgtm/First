import { isSupabaseConfigured } from "@/lib/env";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { listPublicExternalMessages } from "@/lib/data/public-job-messages";
import { ProposalView } from "@/components/proposal/proposal-view";
import { LinkNotValid } from "@/components/proposal/link-not-valid";
import { isPreview } from "@/lib/proposal-flow";

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">
        This isn&apos;t available yet.
      </div>
    );
  }

  const { token } = await params;
  const { preview } = await searchParams;
  const data = await getProposalByToken(token);

  if (!data) return <LinkNotValid />;

  const messages = await listPublicExternalMessages(token);

  return <ProposalView data={data} token={token} messages={messages} preview={isPreview(preview)} />;
}
