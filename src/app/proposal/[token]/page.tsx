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
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLotFromCounty } from "@/lib/data/lot-map";
import type { LotData } from "@/lib/lot-map";

/** Their lot from the county, for a proposal with no site map drawn. Nothing at all when the county can't be reached. */
async function lotForJob(jobId: string): Promise<LotData | null> {
  const { data } = await createAdminClient().from("jobs").select("properties(address, lat, lng)").eq("id", jobId).maybeSingle();
  const place = (data as unknown as { properties: { address: string; lat: number | null; lng: number | null } | null } | null)?.properties;
  if (!place || place.lat == null || place.lng == null) return null;
  return fetchLotFromCounty(place.lat, place.lng, place.address).catch(() => null);
}

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
  const { preview, embed } = await searchParams;
  const data = await getProposalByToken(token);

  if (!data) return <LinkNotValid />;

  // The job id came back with the proposal, so this is one query rather than
  // two — no second lookup of the token to find what we are already holding.
  const hasSiteMap = Boolean(data.proposal.site_image_path && data.proposal.site_image_transform);
  const [messages, lot] = await Promise.all([
    listExternalMessagesForJob(data.proposal.job_id),
    hasSiteMap ? Promise.resolve(null) : lotForJob(data.proposal.job_id),
  ]);

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
      <ProposalView data={data} token={token} messages={messages} preview={previewing} lot={lot} />
      {/* Shown inside the price card, which has its own Send to client. */}
      {sendBar && embed !== "1" && <PreviewSendBar jobId={proposalRow.job_id} sendTo={sendBar.sendTo} sentAt={sendBar.sentAt} />}
    </>
  );
}
