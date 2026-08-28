import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { offeredWorkDays } from "@/lib/data/work-day-offer";
import { createAdminClient } from "@/lib/supabase/admin";
import { ScheduleView } from "@/components/proposal/schedule-view";
import { LinkNotValid } from "@/components/proposal/link-not-valid";
import { isPreview, payPath, proposalPath } from "@/lib/proposal-flow";
import { settleProposalPayment } from "@/lib/actions/proposal-settlement";

/**
 * Picking the day, once the money is sorted.
 *
 * The days are worked out at read time from the crew's diary and the
 * forecast. A stored list of "available days" would be wrong within a day,
 * because both of those move without anybody remembering to update it.
 */
export default async function ProposalSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!isSupabaseConfigured) return <LinkNotValid />;

  const { token } = await params;
  const { preview, paid } = await searchParams;
  const previewing = isPreview(preview);

  // Ask Stripe on the way back from the card form, so the payment is
  // recorded without a webhook having to carry the news. Before the proposal
  // is read, so this page can say it is settled on the first look.
  if (paid === "1") await settleProposalPayment(token);

  const data = await getProposalByToken(token);
  if (!data) return <LinkNotValid />;

  const { proposal } = data;
  if (proposal.status !== "accepted") {
    redirect(`${proposalPath(token)}${previewing ? "?preview=1" : ""}`);
  }
  if (!proposal.payment_path && !previewing) redirect(payPath(token));

  // A plan that protects a discount books a month after the final payment,
  // so there is no day to offer yet. Told plainly rather than shown a
  // calendar full of days they cannot have.
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("payment_plans")
    .select("schedules_after_final_payment")
    .eq("proposal_id", proposal.id)
    .maybeSingle();
  const waitsForPayoff = plan?.schedules_after_final_payment === true;

  const offer = waitsForPayoff
    ? null
    : await offeredWorkDays({
        jobId: proposal.job_id,
        organizationId: proposal.organization_id,
        chosen: proposal.client_chosen_day,
      });

  return (
    <ScheduleView
      token={token}
      preview={previewing}
      justPaid={paid === "1"}
      organizationName={data.organizationName}
      waitsForPayoff={waitsForPayoff}
      chosen={proposal.client_chosen_day}
      offer={offer}
    />
  );
}
