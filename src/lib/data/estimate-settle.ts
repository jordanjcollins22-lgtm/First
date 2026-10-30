import { isStripeConfigured } from "@/lib/env";
import { recordCheckoutSession } from "@/lib/actions/stripe-settlement";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient } from "@/lib/stripe-customer";

/**
 * Back from the card page before Stripe's webhook has landed: ask Stripe
 * directly, and record it the way the webhook would (it is idempotent), so
 * the next page can go on as paid rather than leaving them wondering.
 */
export async function settleEstimateIfPaid(jobId: string): Promise<void> {
  if (!isStripeConfigured) return;
  const { data } = await createAdminClient().from("job_estimates").select("checkout_session_id, paid_at").eq("job_id", jobId).maybeSingle();
  if (!data?.checkout_session_id || data.paid_at) return;
  const session = await stripeClient().checkout.sessions.retrieve(data.checkout_session_id);
  if (session.payment_status === "paid") await recordCheckoutSession(session);
}
