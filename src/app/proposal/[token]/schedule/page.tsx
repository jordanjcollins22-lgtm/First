import { redirect } from "next/navigation";

import { isStripeConfigured, isSupabaseConfigured } from "@/lib/env";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookedView } from "@/components/proposal/booked-view";
import { LinkNotValid } from "@/components/proposal/link-not-valid";
import { confirmationFor } from "@/lib/booking-confirmation";
import { isPreview, payPath, proposalPath } from "@/lib/proposal-flow";
import { settleProposalPayment } from "@/lib/actions/proposal-settlement";

/**
 * The last screen: what has happened, and who picks it up next.
 *
 * It used to offer a calendar, which was reachable by closing the card sheet
 * without paying — the payment path is claimed when they choose how to pay,
 * not when the money lands. So a client could back out and book a day for a
 * job nobody had been paid for. Nothing here books anything now; a team
 * member does that once the proposal is accepted and paid.
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

  // A plan that protects a discount books a month after the final payment,
  // which changes what this page says rather than what it offers.
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("payment_plans")
    .select("schedules_after_final_payment")
    .eq("proposal_id", proposal.id)
    .maybeSingle();

  const confirmation = confirmationFor({
    status: proposal.status,
    paymentPath: proposal.payment_path,
    paidAt: proposal.paid_at,
    schedulesAfterFinalPayment: plan?.schedules_after_final_payment === true,
    canCharge: isStripeConfigured,
  });

  // Preview walks the whole road without paying for anything, so it sees the
  // screen rather than being bounced to a card form it cannot use.
  if (confirmation.redirectTo && !previewing) {
    redirect(confirmation.redirectTo === "pay" ? payPath(token) : proposalPath(token));
  }

  return (
    <BookedView
      preview={previewing}
      organizationName={data.organizationName}
      heading={confirmation.heading || "Your booking is processed."}
      body={
        confirmation.body ||
        "We have just processed your booking. A team member will reach out and get your service booked in as soon as possible."
      }
    />
  );
}
