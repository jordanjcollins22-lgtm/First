import { isSupabaseConfigured } from "@/lib/env";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { listExternalMessagesForJob } from "@/lib/data/public-job-messages";
import { ProposalView } from "@/components/proposal/proposal-view";
import { LinkNotValid } from "@/components/proposal/link-not-valid";
import { isPreview } from "@/lib/proposal-flow";
import { ViewBeacon } from "@/components/proposal/view-beacon";
import { PreviewSendBar } from "@/components/proposal/preview-send-bar";
import { getCurrentProfile } from "@/lib/data/team";
import { getJobCustomerContact } from "@/lib/job-customer";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";

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

  // The job id came back with the proposal, so this is one query rather than
  // two — no second lookup of the token to find what we are already holding.
  const messages = await listExternalMessagesForJob(data.proposal.job_id);

  const previewing = isPreview(preview);

  // The office's preview, once the price is accepted: Send to client at the
  // bottom, for whoever may send it. The client's own page never has it.
  const proposalRow = data.proposal as unknown as { job_id: string; status: string; approved_at: string | null; sent_at?: string | null };
  const viewer = previewing ? await getCurrentProfile().catch(() => null) : null;
  const maySend = Boolean(viewer && (isOwnerLevel(viewer.roles) || viewer.roles.includes("admin") || isAccountManager(viewer.roles)));
  const sendBar =
    maySend && proposalRow.status === "sent" && proposalRow.approved_at
      ? { sendTo: (await getJobCustomerContact(proposalRow.job_id).catch(() => null))?.email?.trim() || null, sentAt: proposalRow.sent_at ?? null }
      : null;

  return (
    <>
      {/* Internal only, and invisible. Not rendered for the office's own
          preview, which would otherwise count as the client reading it. */}
      {!previewing && <ViewBeacon token={token} />}
      <ProposalView data={data} token={token} messages={messages} preview={previewing} />
      {sendBar && <PreviewSendBar jobId={proposalRow.job_id} sendTo={sendBar.sendTo} sentAt={sendBar.sentAt} />}
    </>
  );
}
