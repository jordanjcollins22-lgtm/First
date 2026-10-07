/**
 * Whether we can still take money, and when to say so.
 *
 * Stripe going away is silent. The key gets rolled, or the account gets
 * restricted, and nothing in the app changes: proposals still go out, clients
 * still accept, and the first anybody hears is a client saying the payment
 * page would not load — if they bother to say anything at all. One client
 * already went five days with an unpaid job because a Stripe failure was
 * caught and thrown away.
 *
 * So the connection is checked rather than assumed, and the checking is
 * separated from the doing: what a failure means, and whether it is worth
 * waking somebody over, are decided here where they can be tested. Talking to
 * Stripe and sending the text happen elsewhere.
 */

/** What we believe right now. */
export type PaymentsState = "ok" | "down";

/**
 * What one failure tells us about the connection.
 *
 * "unclear" is the important one. A timeout or a rate limit is Stripe having
 * a bad minute, not Stripe being disconnected, and treating the two the same
 * means either a false alarm every time a packet drops or a real outage lost
 * among them.
 */
export type Verdict = "ok" | "down" | "unclear";

/** Stripe's own names for "your credentials are no good". */
const CREDENTIAL_TYPES = new Set([
  "StripeAuthenticationError",
  "StripePermissionError",
  "authentication_error",
  "invalid_grant",
]);

const CREDENTIAL_CODES = new Set([
  "api_key_expired",
  "account_invalid",
  "authentication_required",
  "platform_account_required",
]);

/** Stripe having a bad minute. Says nothing about whether we are connected. */
const TRANSIENT_TYPES = new Set([
  "StripeConnectionError",
  "StripeAPIError",
  "StripeRateLimitError",
  "api_connection_error",
  "api_error",
  "rate_limit_error",
  "idempotency_error",
]);

interface Stripeish {
  type?: unknown;
  rawType?: unknown;
  code?: unknown;
  statusCode?: unknown;
  status?: unknown;
}

/**
 * What a failed Stripe call says about the connection itself.
 *
 * A refused card or a malformed request means Stripe is answering perfectly
 * well and we asked it something wrong, which is not an outage. Only a
 * credential or account problem is.
 */
export function readStripeFailure(err: unknown): Verdict {
  if (!err || typeof err !== "object") return "unclear";
  const e = err as Stripeish;

  const status = Number(e.statusCode ?? e.status ?? 0);
  if (status === 401 || status === 403) return "down";

  const names = [e.type, e.rawType].filter((v): v is string => typeof v === "string");
  if (names.some((name) => CREDENTIAL_TYPES.has(name))) return "down";
  if (typeof e.code === "string" && CREDENTIAL_CODES.has(e.code)) return "down";
  if (names.some((name) => TRANSIENT_TYPES.has(name))) return "unclear";

  // Everything left is Stripe telling us our request was wrong, which it
  // could only do by being connected.
  return status >= 400 && status < 500 ? "ok" : "unclear";
}

/** What we know before a single call is made. */
export function verdictForConfiguration(hasKey: boolean): Verdict | null {
  return hasKey ? null : "down";
}

/** What is on file about the connection. Null before it has ever been checked. */
export interface StoredHealth {
  state: PaymentsState;
  /** When it last changed, not when it was last looked at. */
  changedAt: string | null;
  lastAlertAt: string | null;
}

export interface HealthDecision {
  /** What to store. Unchanged when the verdict was unclear. */
  state: PaymentsState;
  /** Whether this is a change of state, worth recording a new date against. */
  changed: boolean;
  /** The text to send, or null to stay quiet. */
  alert: string | null;
}

/** How long to wait before saying it again while it is still down. */
export const NAG_HOURS = 20;

/**
 * Whether to say something, and what.
 *
 * Alerts on the change, both ways: a business that is told its card payments
 * are down should also be told when they come back, or somebody spends a
 * morning on the phone to Stripe about a problem that fixed itself.
 *
 * Then once a day while it stays down, because an outage nobody has fixed is
 * still an outage, and a single text on a Friday night is a text that gets
 * read on Monday.
 */
export function decideAlert(input: {
  stored: StoredHealth | null;
  verdict: Verdict;
  businessName: string;
  detail?: string | null;
  now: Date;
  nagHours?: number;
}): HealthDecision {
  const previous: PaymentsState = input.stored?.state ?? "ok";

  // A bad minute is not a disconnection and must never flip the state, or a
  // dropped packet at seven in the morning texts the owner that the till is
  // broken.
  if (input.verdict === "unclear") {
    return { state: previous, changed: false, alert: null };
  }

  const state: PaymentsState = input.verdict === "down" ? "down" : "ok";

  if (state !== previous) {
    return { state, changed: true, alert: message(state, input.businessName, input.detail) };
  }

  if (state === "down") {
    const since = input.stored?.lastAlertAt ? new Date(input.stored.lastAlertAt).getTime() : 0;
    const hours = (input.now.getTime() - since) / 3_600_000;
    if (hours >= (input.nagHours ?? NAG_HOURS)) {
      return { state, changed: false, alert: message(state, input.businessName, input.detail) };
    }
  }

  return { state, changed: false, alert: null };
}

function message(state: PaymentsState, businessName: string, detail?: string | null): string {
  if (state === "ok") {
    return `Stripe is answering again for ${businessName}. Card payments are working.`;
  }
  const because = detail?.trim() ? ` ${detail.trim()}` : "";
  return (
    `Stripe is not answering for ${businessName}, so nobody can pay by card.${because}` +
    ` Check the Stripe key and the account, then this clears on its own.`
  );
}
