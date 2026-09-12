import { describe, expect, it } from "vitest";

import {
  decideAlert,
  NAG_HOURS,
  readStripeFailure,
  verdictForConfiguration,
  type StoredHealth,
} from "@/lib/payments-health";

/** A Stripe error, shaped the way the SDK actually throws them. */
function stripeError(fields: Record<string, unknown>) {
  return Object.assign(new Error("stripe said no"), fields);
}

describe("what a failed Stripe call means", () => {
  it("calls a rejected key a disconnection", () => {
    expect(readStripeFailure(stripeError({ type: "StripeAuthenticationError", statusCode: 401 }))).toBe("down");
    expect(readStripeFailure(stripeError({ rawType: "authentication_error" }))).toBe("down");
  });

  it("calls an expired or revoked key a disconnection", () => {
    expect(readStripeFailure(stripeError({ code: "api_key_expired" }))).toBe("down");
    expect(readStripeFailure(stripeError({ code: "account_invalid" }))).toBe("down");
  });

  it("treats a locked-out account as a disconnection", () => {
    expect(readStripeFailure(stripeError({ type: "StripePermissionError", statusCode: 403 }))).toBe("down");
  });

  it("does not call a bad request a disconnection", () => {
    // "No such customer" means Stripe is answering perfectly well and we
    // asked it something wrong. Alerting on this would cry wolf constantly.
    expect(readStripeFailure(stripeError({ type: "StripeInvalidRequestError", statusCode: 400 }))).toBe("ok");
    expect(readStripeFailure(stripeError({ type: "StripeCardError", statusCode: 402 }))).toBe("ok");
  });

  it("will not decide either way about a bad minute", () => {
    // A dropped packet is not a rolled key. Treating them the same means a
    // false alarm every time the network hiccups, or a real outage buried
    // among the false ones.
    for (const type of ["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"]) {
      expect(readStripeFailure(stripeError({ type })), type).toBe("unclear");
    }
    expect(readStripeFailure(stripeError({ statusCode: 500 }))).toBe("unclear");
  });

  it("will not decide either way about something that is not a Stripe error", () => {
    expect(readStripeFailure(null)).toBe("unclear");
    expect(readStripeFailure("went wrong")).toBe("unclear");
    expect(readStripeFailure(new Error("boom"))).toBe("unclear");
  });

  it("knows a missing key without asking Stripe", () => {
    expect(verdictForConfiguration(false)).toBe("down");
    expect(verdictForConfiguration(true)).toBeNull();
  });
});

const NOW = new Date("2026-09-10T12:00:00.000Z");
const ok: StoredHealth = { state: "ok", changedAt: null, lastAlertAt: null };

describe("whether to say something", () => {
  it("says so the first time it goes down", () => {
    const decision = decideAlert({ stored: ok, verdict: "down", businessName: "J's", now: NOW });
    expect(decision.state).toBe("down");
    expect(decision.changed).toBe(true);
    expect(decision.alert).toContain("not answering");
  });

  it("says so when it comes back, so nobody rings Stripe about a fixed problem", () => {
    const down: StoredHealth = { state: "down", changedAt: null, lastAlertAt: NOW.toISOString() };
    const decision = decideAlert({ stored: down, verdict: "ok", businessName: "J's", now: NOW });
    expect(decision.state).toBe("ok");
    expect(decision.changed).toBe(true);
    expect(decision.alert).toContain("answering again");
  });

  it("stays quiet while everything is fine", () => {
    expect(decideAlert({ stored: ok, verdict: "ok", businessName: "J's", now: NOW }).alert).toBeNull();
  });

  it("does not say it twice in the same day", () => {
    const justTold: StoredHealth = {
      state: "down",
      changedAt: null,
      lastAlertAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    };
    expect(decideAlert({ stored: justTold, verdict: "down", businessName: "J's", now: NOW }).alert).toBeNull();
  });

  it("says it again the next day, because an unfixed outage is still an outage", () => {
    const yesterday: StoredHealth = {
      state: "down",
      changedAt: null,
      lastAlertAt: new Date(NOW.getTime() - (NAG_HOURS + 1) * 3_600_000).toISOString(),
    };
    const decision = decideAlert({ stored: yesterday, verdict: "down", businessName: "J's", now: NOW });
    expect(decision.alert).toContain("not answering");
    // Still down, so this is a reminder rather than a change of state.
    expect(decision.changed).toBe(false);
  });

  it("never flips the state on a bad minute", () => {
    // The whole reason "unclear" exists.
    const quiet = decideAlert({ stored: ok, verdict: "unclear", businessName: "J's", now: NOW });
    expect(quiet.state).toBe("ok");
    expect(quiet.alert).toBeNull();

    const down: StoredHealth = { state: "down", changedAt: null, lastAlertAt: NOW.toISOString() };
    expect(decideAlert({ stored: down, verdict: "unclear", businessName: "J's", now: NOW }).state).toBe("down");
  });

  it("assumes it was fine before anybody checked, so the first bad check is news", () => {
    const first = decideAlert({ stored: null, verdict: "down", businessName: "J's", now: NOW });
    expect(first.changed).toBe(true);
    expect(first.alert).not.toBeNull();
    // And a first good check is not news.
    expect(decideAlert({ stored: null, verdict: "ok", businessName: "J's", now: NOW }).alert).toBeNull();
  });

  it("puts the business and the reason in the message", () => {
    const decision = decideAlert({
      stored: ok,
      verdict: "down",
      businessName: "J's Landscaping",
      detail: "The API key was rejected.",
      now: NOW,
    });
    expect(decision.alert).toContain("J's Landscaping");
    expect(decision.alert).toContain("The API key was rejected.");
  });

  it("says what it means rather than naming an error", () => {
    const decision = decideAlert({ stored: ok, verdict: "down", businessName: "J's", now: NOW });
    expect(decision.alert).toContain("nobody can pay by card");
  });
});
