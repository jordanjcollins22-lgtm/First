import { redirect } from "next/navigation";

import { isStripeConfigured, isSupabaseConfigured } from "@/lib/env";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { PayView } from "@/components/proposal/pay-view";
import { isPreview, proposalPath, schedulePath } from "@/lib/proposal-flow";
import { LinkNotValid } from "@/components/proposal/link-not-valid";

/**
 * How they are paying, on a page of its own.
 *
 * It used to be a panel under the proposal, which meant a client who had
 * already decided could scroll back up, re-read the price and talk
 * themselves out of it. There is nothing on this page but the amount and
 * the ways to settle it.
 */
export default async function ProposalPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!isSupabaseConfigured) return <LinkNotValid />;

  const { token } = await params;
  const { preview } = await searchParams;
  const previewing = isPreview(preview);

  const data = await getProposalByToken(token);
  if (!data) return <LinkNotValid />;

  const { proposal } = data;

  // Nothing to pay for until they have accepted. Sent back rather than shown
  // an error, because the only reason to be here early is a bookmarked URL.
  if (proposal.status !== "accepted") {
    redirect(`${proposalPath(token)}${previewing ? "?preview=1" : ""}`);
  }

  // Answered already, on another device or an earlier visit. Asking again is
  // how a client ends up with two invoices.
  if (proposal.payment_path && !previewing) redirect(schedulePath(token));

  const discountCents = Math.round((proposal.discount_amount ?? 0) * 100);

  return (
    <PayView
      token={token}
      preview={previewing}
      // Whether tapping the button really takes the money. Without Stripe
      // keys it raises an invoice instead, and a button that says "Pay" and
      // then does not is worse than one that says what it does.
      canCharge={isStripeConfigured}
      organizationName={data.organizationName}
      context={{
        discountCents,
        totalCents: Math.max(0, Math.round((proposal.total_cost ?? 0) * 100) - discountCents),
      }}
    />
  );
}
