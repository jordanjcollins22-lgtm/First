/**
 * Whether Stripe can actually tell this app anything.
 *
 * The app's payment path depends on a webhook. Stripe takes the money, then
 * posts to our endpoint, and that post is what writes the payment down, marks
 * the proposal paid, puts a salt order on the round, and settles a tip. For
 * an unknown stretch of time there was no endpoint registered on the Stripe
 * account at all, so Stripe took a thousand dollars and told nobody, and the
 * office found out from the client.
 *
 * The existing health check asks Stripe whether it is there. That is a
 * different question from whether it is talking to us, and a key that works
 * perfectly with no endpoint behind it passes the first and fails the
 * second. So this asks the second one, and it is pure: the caller fetches
 * the endpoint list and the configuration, and this says what they mean.
 */

export type WebhookState =
  /** An enabled endpoint points at us and we hold a secret. */
  | "ok"
  /** No endpoint on the account points at this app. Stripe tells nobody. */
  | "missing"
  /** There is one, but Stripe has switched it off, usually after days of failures. */
  | "disabled"
  /** An endpoint exists but this deployment holds no secret to verify it with. Every delivery is rejected. */
  | "no_secret"
  /** Stripe is not configured at all. Nothing to check. */
  | "unconfigured";

export interface EndpointSummary {
  url: string;
  status: string;
  enabledEvents: string[];
}

export interface WebhookVerdict {
  state: WebhookState;
  /** What is wrong and what fixes it, for the person who can. */
  message: string | null;
  /** Events the app handles that the endpoint is not subscribed to. */
  missingEvents: string[];
}

/** What the route actually handles. A subscription short of these is a silent gap. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "customer.subscription.deleted",
] as const;

/** Whether an endpoint URL is ours, ignoring scheme, trailing slash and case. */
export function pointsAtUs(endpointUrl: string, ourUrl: string): boolean {
  const norm = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
  return norm(endpointUrl) === norm(ourUrl);
}

export function webhookVerdict(input: {
  configured: boolean;
  secretSet: boolean;
  ourUrl: string;
  endpoints: EndpointSummary[];
}): WebhookVerdict {
  if (!input.configured) {
    return { state: "unconfigured", message: null, missingEvents: [] };
  }

  const ours = input.endpoints.filter((endpoint) => pointsAtUs(endpoint.url, input.ourUrl));

  if (ours.length === 0) {
    return {
      state: "missing",
      message:
        "Stripe has no webhook endpoint pointing at this app, so it takes payments and tells nobody. " +
        `Add one in Stripe for ${input.ourUrl}, then put its signing secret in STRIPE_WEBHOOK_SECRET and redeploy.`,
      missingEvents: [...HANDLED_EVENTS],
    };
  }

  // Prefer a live one. A disabled endpoint next to an enabled one is history.
  const live = ours.find((endpoint) => endpoint.status === "enabled") ?? ours[0];

  if (live.status !== "enabled") {
    return {
      state: "disabled",
      message:
        "Stripe has switched our webhook endpoint off, which it does after days of failed deliveries. " +
        "Re-enable it in Stripe and check the signing secret matches STRIPE_WEBHOOK_SECRET.",
      missingEvents: [],
    };
  }

  const subscribed = new Set(live.enabledEvents);
  // "*" means everything, which is more than enough.
  const missingEvents = subscribed.has("*")
    ? []
    : HANDLED_EVENTS.filter((event) => !subscribed.has(event));

  if (!input.secretSet) {
    return {
      state: "no_secret",
      message:
        "The webhook endpoint exists but this deployment has no STRIPE_WEBHOOK_SECRET, so every delivery is rejected as unsigned. " +
        "Copy the endpoint's signing secret from Stripe into the deployment and redeploy.",
      missingEvents,
    };
  }

  return {
    state: "ok",
    message:
      missingEvents.length > 0
        ? `The endpoint is not subscribed to ${missingEvents.join(", ")}, so those will never arrive.`
        : null,
    missingEvents,
  };
}

/**
 * Whether the state is one somebody has to act on today.
 *
 * Unconfigured is not: a business with no Stripe key is not losing payments
 * it cannot take. Everything else is money arriving with nobody told.
 */
export function needsAttention(verdict: WebhookVerdict): boolean {
  if (verdict.state === "ok") return verdict.missingEvents.length > 0;
  return verdict.state !== "unconfigured";
}
