import Stripe from "stripe";

import { demoSendFetch } from "@/lib/demo-mode";

/**
 * How every Stripe client is made: in a demo, Stripe is looked at and never
 * charged or changed (lib/demo-guard.ts). Left to Stripe's own defaults where
 * the library cannot take a fetch of ours.
 */
export function stripeOptions(): Stripe.StripeConfig {
  return typeof Stripe.createFetchHttpClient === "function" ? { httpClient: Stripe.createFetchHttpClient(demoSendFetch) } : {};
}
