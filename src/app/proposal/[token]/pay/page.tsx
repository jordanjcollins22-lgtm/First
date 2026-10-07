import { redirect } from "next/navigation";

import { env, isStripeConfigured, isStripeInPageReady, isSupabaseConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { getProposalByToken } from "@/lib/data/public-proposal";
import { PayView } from "@/components/proposal/pay-view";
import { isPreview, proposalPath, schedulePath } from "@/lib/proposal-flow";
import { LinkNotValid } from "@/components/proposal/link-not-valid";
import { confirmationFor } from "@/lib/booking-confirmation";

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

  // Settled already, on another device or an earlier visit. Asking again is
  // how a client ends up with two invoices.
  //
  // Keyed on the money rather than on the choice: picking how to pay claims
  // payment_path immediately, so bouncing on that sent anybody who closed
  // the card sheet to a confirmation for a job nobody had paid for. The
  // confirmation screen decides — it is the same call it makes itself, so
  // the two pages cannot disagree and send a client round in a loop.
  const settled = confirmationFor({
    status: proposal.status,
    paymentPath: proposal.payment_path,
    paidAt: proposal.paid_at,
    // Only changes the wording on the confirmation, not whether there is one.
    schedulesAfterFinalPayment: false,
    canCharge: isStripeConfigured,
  });
  if (settled.redirectTo === null && !previewing) redirect(schedulePath(token));

  const discountCents = Math.round((proposal.discount_amount ?? 0) * 100);

  // Where Stripe sends them once the wallet sheet closes. Absolute, because
  // it is a redirect out of somebody else's payment sheet.
  const baseUrl = await outboundBaseUrl();
  const returnUrl = `${absolute(baseUrl, schedulePath(token))}?paid=1`;

  return (
    <PayView
      token={token}
      preview={previewing}
      // Whether tapping the button really takes the money. Without Stripe
      // keys it raises an invoice instead, and a button that says "Pay" and
      // then does not is worse than one that says what it does.
      canCharge={isStripeConfigured}
      // Empty falls back to the hosted checkout, which still works and still
      // offers the wallets, just on Stripe's page instead of ours.
      publishableKey={isStripeInPageReady ? env.stripePublishableKey : ""}
      returnUrl={returnUrl}
      organizationName={data.organizationName}
      context={{
        discountCents,
        totalCents: Math.max(0, Math.round((proposal.total_cost ?? 0) * 100) - discountCents),
      }}
    />
  );
}
